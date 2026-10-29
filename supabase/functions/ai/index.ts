import { createClient } from "jsr:@supabase/supabase-js@2";
import { linkedinSemana, linkedinReescrever } from "./linkedin.ts";
import { arenaGerar, arenaAjustar, arenaRegrasSugerir } from "./arena.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-arena-teste",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const WORKSPACE_ID_ENV = Deno.env.get("ANTHROPIC_WORKSPACE_ID") ?? "";
// Modelos (29/10/2026): MODEL = Sonnet atual para geração que pede qualidade (perguntas à Base, LinkedIn, Arenas);
// MODEL_RAPIDO = Haiku atual para tarefa mecânica e curta (classify: sugerir a seção de um documento).
const MODEL = Deno.env.get("AI_MODEL") ?? "claude-sonnet-5-5";
const MODEL_RAPIDO = Deno.env.get("AI_MODEL_RAPIDO") ?? "claude-haiku-5-5";

// ---------------------------------------------------------------------------
// Custo estimado (para o card/gráfico de uso de tokens do Início) + botão de
// pausa de emergência. Preço de tabela Anthropic (USD, publicado) × câmbio
// fixo de referência — NÃO é uma cotação ao vivo, só uma estimativa pra dar
// controle de custo. Ajuste USD_BRL_REF manualmente se o câmbio mudar muito.
// ---------------------------------------------------------------------------
const USD_BRL_REF = 5.15; // referência fixa, documentada — não é câmbio ao vivo (checado em 2026-09-16)
// US$ por milhão de tokens (preços da API Anthropic, 29/10/2026): entrada, saída, escrita de cache do prompt
// (5 min = 1,25x a entrada) e leitura de cache. Haiku 5.5: tabela de prompts até 100K tokens (acima, 0,50/2,50).
// Mesma tabela na Edge Function "hotmart".
const PRECOS_USD_POR_MTOK: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-sonnet-5-5": { input: 2.0, output: 10.0, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2.0, output: 10.0, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4.0, output: 20.0, cacheWrite: 5.0, cacheRead: 0.2 },
};
function precoModelo(modelo: string) {
  return PRECOS_USD_POR_MTOK[modelo] || PRECOS_USD_POR_MTOK["claude-sonnet-5-5"];
}
type Uso = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; modelo?: string };
// modelo: o usage devolvido por anthropic() traz o modelo realmente usado (usage.modelo), que vale mais que o parâmetro.
async function logAiUsage(sb: any, origem: string, modelo: string, usage: Partial<Uso> | undefined, userId: string | null = null) {
  try {
    const inputTok = usage?.input_tokens || 0;
    const outputTok = usage?.output_tokens || 0;
    const cacheW = usage?.cache_creation_input_tokens || 0;
    const cacheR = usage?.cache_read_input_tokens || 0;
    const mod = usage?.modelo || modelo;
    const p = precoModelo(mod);
    const custoUsd = (inputTok / 1e6) * p.input + (outputTok / 1e6) * p.output + (cacheW / 1e6) * p.cacheWrite + (cacheR / 1e6) * p.cacheRead;
    await sb.from("ai_usage_log").insert({
      origem, modelo: mod, input_tokens: inputTok, output_tokens: outputTok,
      cache_write_tokens: cacheW, cache_read_tokens: cacheR, user_id: userId,
      custo_usd: Math.round(custoUsd * 10000) / 10000,
      custo_brl: Math.round(custoUsd * USD_BRL_REF * 10000) / 10000,
    });
  } catch (e) {
    console.error("logAiUsage error:", String((e as Error).message || e));
  }
}
async function iaPausada(sb: any): Promise<boolean> {
  try {
    const { data } = await sb.from("automacao_estado").select("pausado").eq("id", 1).maybeSingle();
    return !!data?.pausado;
  } catch { return false; }
}
const MSG_PAUSADO = "As automações de IA estão pausadas no momento (botão de emergência em Início). Peça para um admin retomar em Início → Uso de IA.";
const MSG_TETO = "Você atingiu o limite diário de uso da IA. Fale com um administrador.";

// Teto diário opcional por usuário: app_config.ia_teto_diario_brl_por_usuario (valor em R$, texto). Sem a chave,
// vazia ou <= 0 = sem teto. Soma custo_brl de ai_usage_log do usuário desde 00:00 de hoje em Brasília (todas as
// funções que gravam user_id, inclusive a "hotmart"). ADM fica de fora. Erro na leitura não bloqueia (fail-open).
async function tetoAtingido(sbService: any, uid: string): Promise<boolean> {
  try {
    const { data: cfg } = await sbService.from("app_config").select("valor").eq("chave", "ia_teto_diario_brl_por_usuario").maybeSingle();
    const teto = Number(String(cfg?.valor ?? "").replace(",", ".").trim());
    if (!cfg?.valor || !Number.isFinite(teto) || teto <= 0) return false;
    const dia = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const { data, error } = await sbService.from("ai_usage_log").select("custo_brl").eq("user_id", uid).gte("criado_em", `${dia}T00:00:00-03:00`);
    if (error) throw error;
    const gasto = (data || []).reduce((t: number, r: any) => t + (Number(r.custo_brl) || 0), 0);
    return gasto >= teto;
  } catch (e) {
    console.error("tetoAtingido:", String((e as Error).message || e));
    return false;
  }
}

// Respostas reaproveitadas (ai_respostas_cache, só service_role): pergunta idêntica (normalizada) com o MESMO prompt
// de sistema e modelo nas últimas 24 h devolve a resposta guardada, sem chamar a IA. O hash inclui o system inteiro,
// então qualquer mudança nos documentos, correções ou panorama gera outra chave.
const CACHE_RESPOSTA_MS = 24 * 3600 * 1000;
function normPergunta(q: string) {
  return q.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim().replace(/[\s?!.]+$/, "");
}
async function sha256(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function lerRespostaCache(sbService: any, hash: string): Promise<any | null> {
  try {
    const { data } = await sbService.from("ai_respostas_cache").select("resposta")
      .eq("hash", hash).gte("criado_em", new Date(Date.now() - CACHE_RESPOSTA_MS).toISOString()).maybeSingle();
    return data?.resposta ?? null;
  } catch { return null; }
}
async function gravarRespostaCache(sbService: any, hash: string, acao: string, resposta: unknown) {
  try {
    await sbService.from("ai_respostas_cache").upsert({ hash, acao, resposta, criado_em: new Date().toISOString() });
    // Limpeza de vez em quando (expiradas há mais de 1 dia).
    if (Math.random() < 0.1) await sbService.from("ai_respostas_cache").delete().lt("criado_em", new Date(Date.now() - 2 * CACHE_RESPOSTA_MS).toISOString());
  } catch (e) { console.error("gravarRespostaCache:", String((e as Error).message || e)); }
}

// Cache do prompt (prompt caching da Anthropic): o system vai como bloco de texto com cache_control quando passa de
// ~2.000 caracteres (o mínimo cacheável do Sonnet 5.5/Haiku 5.5 é 512 tokens; abaixo disso a API só ignora).
// system como { fixo, variavel }: só o prefixo fixo (igual entre chamadas) leva o breakpoint; a parte que muda a
// cada pergunta vem depois, sem cache.
const CACHE_MIN_CHARS = 2000;
type SystemPrompt = string | { fixo: string; variavel?: string };
function blocosSystem(system: SystemPrompt) {
  const fixo = typeof system === "string" ? system : system.fixo;
  const variavel = typeof system === "string" ? "" : (system.variavel || "");
  const blocos: Record<string, unknown>[] = [{ type: "text", text: fixo, ...(fixo.length >= CACHE_MIN_CHARS ? { cache_control: { type: "ephemeral" } } : {}) }];
  if (variavel) blocos.push({ type: "text", text: variavel });
  return blocos;
}

// opts.schema: structured outputs (output_config.format json_schema => JSON garantido); opts.effort: low|medium|high;
// opts.model: modelo da chamada (padrão MODEL). usage volta com os tokens de cache e o modelo usado (usage.modelo).
async function anthropic(system: SystemPrompt, user: string, maxTokens: number, workspaceId: string, opts: { schema?: unknown; effort?: string; model?: string } = {}): Promise<{ text: string; usage: Uso; stop_reason?: string }> {
  const modelo = opts.model || MODEL;
  const headers: Record<string, string> = {
    "x-api-key": ANTHROPIC_KEY,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
  if (workspaceId) headers["anthropic-workspace-id"] = workspaceId;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: modelo, max_tokens: maxTokens, system: blocosSystem(system), messages: [{ role: "user", content: user }],
      ...(opts.schema || opts.effort ? { output_config: {
        ...(opts.effort ? { effort: opts.effort } : {}),
        ...(opts.schema ? { format: { type: "json_schema", schema: opts.schema } } : {}),
      } } : {}),
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Anthropic HTTP ${r.status}`);
  const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  return {
    text,
    usage: {
      input_tokens: data.usage?.input_tokens || 0, output_tokens: data.usage?.output_tokens || 0,
      cache_creation_input_tokens: data.usage?.cache_creation_input_tokens || 0, cache_read_input_tokens: data.usage?.cache_read_input_tokens || 0,
      modelo,
    },
    stop_reason: data.stop_reason,
  };
}

const STOP = new Set("para pelo pela como qual quais onde quando porque sobre nossa nosso nossas nossos esse essa este esta isso aqui tem ter uma outro outra mais menos entre desde ate".split(/\s+/));
function keywords(q: string): string[] {
  return [...new Set(q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)))];
}
function norm(s: string) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Extrai as linhas de controle "CONFIANCA: alta|baixa" e "TEMA: ..." do fim da
// resposta do modelo (instruidas no prompt do FAQ de secao) e devolve o texto
// limpo + os valores. Tolerante a ordem/ausencia de qualquer uma das duas.
function extrairControle(texto: string): { resposta: string; confianca: "alta" | "baixa"; tema: string | null } {
  let resposta = texto;
  let confianca: "alta" | "baixa" = "alta";
  let tema: string | null = null;

  const mConf = resposta.match(/\n?\s*CONFIANCA:\s*(alta|baixa)\s*$/i);
  if (mConf) {
    confianca = mConf[1].toLowerCase() === "baixa" ? "baixa" : "alta";
    resposta = resposta.slice(0, mConf.index).trimEnd();
  }
  const mTema = resposta.match(/\n?\s*TEMA:\s*(.+)\s*$/i);
  if (mTema) {
    tema = mTema[1].trim().slice(0, 80) || null;
    resposta = resposta.slice(0, mTema.index).trimEnd();
  }
  // Ordem invertida (TEMA antes de CONFIANCA) — tenta de novo caso a 1a passada nao tenha pego a CONFIANCA por estar acima do TEMA.
  if (!mConf) {
    const mConf2 = resposta.match(/\n?\s*CONFIANCA:\s*(alta|baixa)\s*$/i);
    if (mConf2) {
      confianca = mConf2[1].toLowerCase() === "baixa" ? "baixa" : "alta";
      resposta = resposta.slice(0, mConf2.index).trimEnd();
    }
  }
  return { resposta: resposta.trim(), confianca, tema };
}

const SOBRE_A_OS = `
O "Sistema Operacional" (OS) é a plataforma interna da empresa Tia do Inglês
(Método Tia do Inglês / Mentoria Fluent Mind Academy). É um app web hospedado no
GitHub Pages, com back-end no Supabase (banco, login, arquivos e funções).

MENU / SETORES: Base de Conhecimento, Pedir a IA (esta função), Ferramentas,
Financeiro, Comercial, CS / Suporte e Conteúdo. Os quatro últimos ainda estão
"em construção" (só a estrutura no menu).

BASE DE CONHECIMENTO: reúne a documentação da empresa em 7 seções — Sobre a
Empresa; Metodologia; Produto / Mentoria Fluent Mind; Cliente e Avatar;
Resultados e Provas; Documentação e Processos; Skills e Playbooks. Cada documento
tem histórico de versões, tags, responsável e status (rascunho / publicado /
arquivado). Um documento pode ser um arquivo enviado (PDF, DOCX, TXT, imagem,
áudio, vídeo — até 50 MB), um link externo, ou um texto em Markdown escrito no
próprio sistema. Para criar: abrir uma seção e clicar "Novo documento" (precisa
da aba Base de Conhecimento); há um botão "Sugerir categoria (IA)" que propõe a seção.

SKILLS E PLAYBOOKS: skills do Claude da empresa, publicadas como documentos e
sincronizadas automaticamente a partir dos arquivos-fonte (script sync_skills.py,
rodando por tarefa agendada). As de metodologia, avatar, marca e provas foram
distribuídas para as seções correspondentes; ficam em Skills e Playbooks apenas
os playbooks operacionais de vendas e conteúdo.

FERRAMENTAS: registro de tudo que fica conectado à OS (infra própria + Notion,
Google Drive, ClickUp, Canva, etc.), com o status atual (conectada / erro /
desconectada / não configurada) e o que cada uma faz. Supabase, GitHub Pages e as
Edge Functions têm checagem automática ao vivo; o resto é status manual.

ACESSO POR ABA: cada pessoa tem uma ou mais abas liberadas (Base de Conhecimento,
Agenda, Pedagógico, CS / Suporte, Comercial, Financeiro, Conteúdo) e, dentro delas,
pode cadastrar, editar e gerar. O ADM vê e altera tudo, inclusive Início, Farol do
Lucro, Pedir a IA, Squad, Ferramentas e Administração (usuários e abas). A entrada é
por e-mail e senha, com contas criadas pelo ADM.

ESTA FUNÇÃO ("Pedir a IA"): responde perguntas sobre o sistema, sobre o conteúdo
da Base de Conhecimento, e também perguntas gerais. Usa o modelo ${MODEL} e
consome créditos da conta Anthropic da empresa.
`.trim();

async function snapshotSistema(sb: any): Promise<string> {
  const [secsRes, docsRes, ferrRes, usersRes] = await Promise.all([
    sb.from("kb_sections").select("nome,descricao,ordem").order("ordem"),
    sb.from("kb_documents").select("titulo,status,updated_at,tags, section:section_id(nome)").order("updated_at", { ascending: false }).limit(500),
    sb.from("os_ferramentas").select("nome,categoria,check_type,status_manual,ultimo_status").order("ordem"),
    sb.from("profiles").select("role"),
  ]);
  const secs = secsRes.data || [];
  const docs = docsRes.data || [];
  const ferr = ferrRes.data || [];
  const users = usersRes.data || [];

  const bySec: Record<string, any[]> = {};
  for (const d of docs) {
    const n = d.section?.nome || "(sem seção)";
    (bySec[n] = bySec[n] || []).push(d);
  }
  const blocoSecoes = secs.map((s: any) => {
    const list = (bySec[s.nome] || []);
    const linhas = list.length
      ? list.map((d: any) => `    · ${d.titulo}${d.status !== "publicado" ? ` [${d.status}]` : ""}`).join("\n")
      : "    (nenhum documento ainda)";
    return `  ${s.nome} — ${list.filter((d) => d.status === "publicado").length} publicado(s):\n${linhas}`;
  }).join("\n");

  const blocoFerr = ferr.map((t: any) => {
    const st = t.check_type === "auto" ? (t.ultimo_status || "desconhecido") : t.status_manual;
    return `  · ${t.nome} [${t.categoria}]: ${st}`;
  }).join("\n");

  const papeis: Record<string, number> = {};
  for (const u of users) papeis[u.role] = (papeis[u.role] || 0) + 1;

  return [
    `Total de documentos: ${docs.length}. Usuários: ${users.length} (` +
      Object.entries(papeis).map(([k, v]) => `${v} ${k}`).join(", ") + ").",
    `\nDOCUMENTOS POR SEÇÃO (todos os títulos):\n${blocoSecoes}`,
    `\nFERRAMENTAS E STATUS ATUAL:\n${blocoFerr}`,
  ].join("\n");
}

// app_config agora é admin-only no SELECT (guarda segredos — ver migração
// restringir_select_app_config). O cliente principal desta função (`sb`)
// encaminha o JWT de quem chamou e respeita RLS, então uma leitura de
// app_config por um editor/leitor falharia. Usa a service role só pra esse
// fallback (não-secreto, é só o workspace id da Anthropic).
async function getWorkspaceId(sbService: any): Promise<string> {
  if (WORKSPACE_ID_ENV) return WORKSPACE_ID_ENV;
  try {
    const { data } = await sbService.from("app_config").select("valor").eq("chave", "anthropic_workspace_id").maybeSingle();
    return (data?.valor || "").trim();
  } catch { return ""; }
}

const NOME_AREA: Record<string, string> = {
  bc: "Base de Conhecimento", agenda: "Agenda", pedagogico: "Pedagógico", cs: "CS / Suporte",
  comercial: "Comercial", financeiro: "Financeiro", conteudo: "Conteúdo",
};
function areaDaAcao(action: unknown, body: Record<string, any>): string | null {
  if (action === "classify") return "bc";
  if (action === "ask") {
    const s = body.secao_slug ? String(body.secao_slug).trim() : "";
    if (!s) return "conteudo";
    return s === "cs-suporte" ? "cs" : "bc";
  }
  if (action === "linkedin_semana" || action === "linkedin_reescrever") return "conteudo";
  if (action === "arena_gerar" || action === "arena_ajustar" || action === "arena_regras_sugerir") return "pedagogico";
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const sb = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const sbService = createClient(url, serviceKey);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* vazio */ }
  const action = body.action;
  const ehArena = action === "arena_gerar" || action === "arena_ajustar" || action === "arena_regras_sugerir";

  // Modo de teste das ações arena_* (sem senha de usuário): header x-arena-teste igual ao token guardado em
  // app_config.chave='arena_teste_token' (tabela só-admin, lida com service_role). Sem essa linha na tabela,
  // o modo não existe. Usado só para testar prompt/validação; apague a linha depois do teste.
  let modoTeste = false;
  const tokenTeste = req.headers.get("x-arena-teste") ?? "";
  if (ehArena && tokenTeste.length >= 32) {
    const { data: cfgT } = await sbService.from("app_config").select("valor").eq("chave", "arena_teste_token").maybeSingle();
    const esperado = String(cfgT?.valor || "");
    if (esperado.length >= 32 && esperado.length === tokenTeste.length) {
      let dif = 0;
      for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ tokenTeste.charCodeAt(i);
      modoTeste = dif === 0;
    }
  }

  const { data: u } = modoTeste ? { data: null as any } : await sb.auth.getUser();
  if (!modoTeste && !u?.user) return json({ error: "Nao autenticado" }, 401);

  // Acesso por aba, conferido aqui no servidor (ADM tem todas). Cada ação exige a aba da tela que a usa:
  // classify (sugerir seção) = Base; ask com secao_slug cs-suporte (FAQ) = CS; ask com outra seção = Base;
  // ask sem seção (Gerador de conteúdos; Pedir a IA é só do ADM) = Conteúdo; linkedin_* = Conteúdo;
  // arena_* = Pedagógico. "status" só pede login.
  let ehAdmin = false;
  if (!modoTeste) {
    const precisa = areaDaAcao(action, body);
    if (precisa) {
      const { data: perfil } = await sbService.from("profiles").select("role, areas").eq("id", u.user.id).maybeSingle();
      ehAdmin = perfil?.role === "admin";
      const ok = !!perfil && (perfil.role === "admin" || (Array.isArray(perfil.areas) && perfil.areas.includes(precisa)));
      if (!ok) return json({ error: `Sem permissão: esta ação é da aba ${NOME_AREA[precisa] || precisa}.` }, 403);
    }
  }
  const uid: string | null = modoTeste ? null : u.user.id;
  // Teto diário por usuário (ADM e modo de teste ficam de fora). Em "ask" é conferido só se a resposta não vier do cache.
  const tetoBloqueia = async () => !modoTeste && !ehAdmin && !!uid && await tetoAtingido(sbService, uid);
  const RESP_TETO = () => json({ configured: true, limite_diario: true, error: MSG_TETO });

  if (action === "status") {
    const ws = await getWorkspaceId(sbService);
    return json({ configured: !!ANTHROPIC_KEY, model: MODEL, model_rapido: MODEL_RAPIDO, workspace_set: !!ws, paused: await iaPausada(sb) });
  }

  if (!ANTHROPIC_KEY) {
    return json({ configured: false, error: "IA nao conectada. Um admin precisa definir o segredo ANTHROPIC_API_KEY nas Edge Functions do Supabase." });
  }

  if ((action === "classify" || action === "ask" || action === "linkedin_semana" || action === "linkedin_reescrever" || ehArena) && (await iaPausada(modoTeste ? sbService : sb))) {
    return json({ configured: true, paused: true, error: MSG_PAUSADO });
  }

  const wsId = await getWorkspaceId(sbService);
  if ((action === "classify" || action === "linkedin_semana" || action === "linkedin_reescrever" || ehArena) && await tetoBloqueia()) return RESP_TETO();

  try {
    // ---- LinkedIn da Tia (Conteúdo > LinkedIn): fila semanal e reescrita (ver linkedin.ts) ----
    if (action === "linkedin_semana" || action === "linkedin_reescrever") {
      const chamar = (system: string, user: string, maxTokens: number) => anthropic(system, user, maxTokens, wsId);
      const log = (origem: string, usage: any) => logAiUsage(sbService, origem, MODEL, usage, uid);
      const r = action === "linkedin_semana"
        ? await linkedinSemana(sb, u.user.id, body, chamar, log, sbService)
        : await linkedinReescrever(sb, u.user.id, body, chamar, log, sbService);
      return json(r.body, r.status);
    }

    // ---- Gerador de Materiais das Arenas (Pedagógico): 1 material por chamada (ver arena.ts) ----
    if (ehArena) {
      const ctx = {
        sb: modoTeste ? sbService : sb,
        uid: modoTeste ? null : u.user.id,
        teste: modoTeste,
        anthropic: (system: string, user: string, maxTokens: number, opts?: { schema?: unknown; effort?: string }) => anthropic(system, user, maxTokens, wsId, opts),
        log: (origem: string, usage: any) => logAiUsage(sbService, origem + (modoTeste ? ":teste" : ""), MODEL, usage, uid),
      };
      const r = action === "arena_gerar" ? await arenaGerar(ctx, body)
        : action === "arena_ajustar" ? await arenaAjustar(ctx, body)
        : await arenaRegrasSugerir(ctx, body);
      return json(r.body, r.status);
    }

    if (action === "classify") {
      const titulo = String(body.titulo ?? "").trim();
      const texto = String(body.texto ?? "").slice(0, 12000);
      if (!titulo && !texto) return json({ error: "Envie titulo e/ou texto" }, 400);

      const { data: secs } = await sb.from("kb_sections").select("slug,nome,descricao").order("ordem");
      const lista = (secs || []).map((s: any) => `- ${s.slug} (\"${s.nome}\"): ${s.descricao}`).join("\n");

      const system =
        "Voce classifica documentos internos da empresa Tia do Ingles em uma das secoes da Base de Conhecimento.\n" +
        "Secoes disponiveis (slug (\"nome\"): descricao):\n" + lista + "\n\n" +
        "Responda APENAS com um objeto JSON valido, sem texto antes ou depois, no formato:\n" +
        `{\"secao_slug\":\"<slug>\",\"secao_nome\":\"<nome>\",\"confianca\":<0..1>,\"motivo\":\"<frase curta em pt-BR>\",\"tags_sugeridas\":[\"tag1\",\"tag2\"]}`;
      const user = `TITULO: ${titulo}\n\nCONTEUDO (inicio):\n${texto || "(sem conteudo textual; classifique pelo titulo)"}`;

      // Haiku (tarefa mecânica). Thinking adaptativo conta no max_tokens: effort low + folga para o JSON curto.
      const { text: raw, usage } = await anthropic(system, user, 1024, wsId, { model: MODEL_RAPIDO, effort: "low" });
      await logAiUsage(sbService, "ai:classify", MODEL_RAPIDO, usage, uid);
      const m = raw.match(/\{[\s\S]*\}/);
      let parsed: any;
      try { parsed = JSON.parse(m ? m[0] : raw); } catch { return json({ error: "Nao consegui interpretar a resposta da IA", raw }); }
      const ok = (secs || []).find((s: any) => s.slug === parsed.secao_slug);
      return json({
        configured: true,
        secao_slug: ok ? parsed.secao_slug : null,
        secao_nome: ok ? ok.nome : (parsed.secao_nome ?? null),
        confianca: typeof parsed.confianca === "number" ? parsed.confianca : null,
        motivo: String(parsed.motivo ?? "").slice(0, 300),
        tags_sugeridas: Array.isArray(parsed.tags_sugeridas) ? parsed.tags_sugeridas.slice(0, 6).map((t: any) => String(t)) : [],
      });
    }

    if (action === "ask") {
      const pergunta = String(body.pergunta ?? "").trim();
      if (!pergunta) return json({ error: "Escreva a pergunta" }, 400);
      const secaoSlug = body.secao_slug ? String(body.secao_slug).trim() : "";

      // ---- Modo FAQ de seção: restringe tudo aos documentos de UMA seção ----
      if (secaoSlug) {
        const { data: sec } = await sb.from("kb_sections").select("id,nome").eq("slug", secaoSlug).maybeSingle();
        if (!sec) return json({ error: `Secao '${secaoSlug}' nao encontrada` }, 400);

        const { data: docs } = await sb
          .from("kb_documents")
          .select("titulo,descricao,tags,status, current:current_version_id(conteudo_md)")
          .eq("status", "publicado").eq("section_id", sec.id).limit(300);

        const total = (docs || []).length;
        const kw = keywords(pergunta);
        const scored = (docs || []).map((d: any) => {
          const hay = norm(d.titulo + " " + (d.descricao || "") + " " + (d.tags || []).join(" ") + " " + (d.current?.conteudo_md || "").slice(0, 2000));
          const score = kw.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
          return { d, score };
        }).sort((a, b) => b.score - a.score);

        // Sem hit por palavra-chave (sinonimo, pergunta generica) -> usa os primeiros
        // documentos da secao mesmo assim, em vez de responder "sem contexto".
        const comHit = scored.filter((x) => x.score > 0);
        const usados = (comHit.length ? comHit : scored).slice(0, 6);

        let ctx = "";
        const fontes: any[] = [];
        for (const { d } of usados) {
          const corpo = (d.current?.conteudo_md || d.descricao || "").slice(0, 6000);
          if (!corpo.trim()) continue;
          ctx += `\n\n## ${d.titulo}\n${corpo}`;
          fontes.push({ titulo: d.titulo, secao: sec.nome });
          if (ctx.length > 28000) break;
        }

        // Correções já confirmadas pela equipe para esta seção — valem mais que os
        // documentos quando a pergunta for igual ou parecida a uma já corrigida.
        const { data: correcoes } = await sb
          .from("faq_interacoes")
          .select("pergunta,resposta_corrigida,tema")
          .eq("secao_slug", secaoSlug).eq("status", "corrigida")
          .order("corrigida_em", { ascending: false }).limit(50);

        let blocoCorrecoes = "";
        if (correcoes && correcoes.length) {
          blocoCorrecoes = "\n\n=== CORREÇÕES JÁ CONFIRMADAS PELA EQUIPE (valem MAIS que os documentos abaixo; se a pergunta " +
            "atual for igual ou parecida com uma destas, use a resposta corrigida como fonte da verdade) ===\n" +
            correcoes.map((c: any) => `- Pergunta: ${c.pergunta}${c.tema ? ` (tema: ${c.tema})` : ""}\n  Resposta corrigida: ${c.resposta_corrigida}`).join("\n");
        }

        // Prefixo fixo por seção (instruções + correções) primeiro, com cache; os documentos escolhidos pelas
        // palavras-chave da pergunta mudam a cada chamada e vêm depois.
        const fixo =
          `Voce e o FAQ de ${sec.nome} da Tia do Ingles. Responda em portugues do Brasil, de forma direta, ` +
          "acolhedora e pratica, como quem conhece bem o processo do setor.\n\n" +
          "Responda SOMENTE com base nos documentos e correcoes abaixo. Cite o titulo do documento entre parenteses quando usar uma informacao dele. " +
          "Se a pergunta for parecida com uma das CORREÇÕES JÁ CONFIRMADAS, priorize sempre a resposta corrigida, mesmo que o documento diga algo diferente. " +
          "Se a resposta nao estiver nos documentos nem nas correcoes, voce pode responder com base no seu melhor entendimento do assunto, " +
          "mas deixe MUITO claro, em uma frase dentro da propria resposta, que isso nao esta confirmado na base " +
          `(pasta "CS:Suporte" dentro de "00. OS TIA DO INGLES" no Google Drive) e que alguem deveria confirmar/adicionar o documento la. ` +
          `Se a pergunta nao tiver nada a ver com ${sec.nome}, diga isso educadamente em vez de responder por conta propria.\n\n` +
          "Ao final da resposta, em DUAS linhas separadas, exatamente neste formato (sem nada depois delas), adicione:\n" +
          "CONFIANCA: alta\n" +
          "TEMA: <2 a 4 palavras resumindo o tema da pergunta>\n" +
          "Troque 'alta' por 'baixa' sempre que voce tiver respondido por inferencia/melhor entendimento porque o documento nao cobre isso com clareza " +
          "(ou seja, sempre que a resposta nao vier claramente de um documento ou de uma correcao confirmada)." +
          blocoCorrecoes + "\n\n";
        const variavel =
          `=== DOCUMENTOS DE ${sec.nome.toUpperCase()} (${total} no total, ${fontes.length} usados nesta resposta) ===` +
          (ctx || "\n(esta secao ainda nao tem nenhum documento)");

        // Resposta reaproveitada: mesma pergunta normalizada + mesmo prompt (documentos e correções iguais) em 24 h.
        // body.cache === false força uma resposta nova. O registro em faq_interacoes continua (feedback/correção).
        const usarCache = body.cache !== false;
        const hash = await sha256(JSON.stringify(["ask_secao", MODEL, secaoSlug, fixo, variavel, normPergunta(pergunta)]));
        let doCache = usarCache ? await lerRespostaCache(sbService, hash) : null;
        let resposta: string, confianca: "alta" | "baixa", tema: string | null;
        if (doCache && typeof doCache.resposta === "string") {
          ({ resposta, confianca, tema } = doCache);
          await logAiUsage(sbService, "ai:ask_secao:cache", MODEL, { input_tokens: 0, output_tokens: 0 }, uid);
        } else {
          doCache = null;
          if (await tetoBloqueia()) return RESP_TETO();
          const { text: bruto, usage } = await anthropic({ fixo, variavel }, pergunta, 2000, wsId);
          await logAiUsage(sbService, "ai:ask_secao", MODEL, usage, uid);
          ({ resposta, confianca, tema } = extrairControle(bruto));
          await gravarRespostaCache(sbService, hash, "ask_secao", { resposta, confianca, tema });
        }

        let interacaoId: string | null = null;
        try {
          const { data: ins } = await sb.from("faq_interacoes").insert({
            secao_slug: secaoSlug,
            pergunta,
            resposta_ia: resposta,
            confianca,
            tema,
            fontes,
            criado_por: u.user.id,
          }).select("id").maybeSingle();
          interacaoId = ins?.id ?? null;
        } catch { /* log e' best-effort; nao bloqueia a resposta */ }

        return json({ configured: true, resposta, fontes, secao: sec.nome, total_docs: total, confianca, tema, interacao_id: interacaoId, ...(doCache ? { cache: true } : {}) });
      }

      // ---- Modo geral (Pedir a IA) — inalterado ----
      const snap = await snapshotSistema(sb).catch(() => "(indisponivel)");

      const { data: docs } = await sb
        .from("kb_documents")
        .select("titulo,descricao,tags,status,section:section_id(nome), current:current_version_id(conteudo_md)")
        .eq("status", "publicado").limit(300);

      const kw = keywords(pergunta);
      const scored = (docs || []).map((d: any) => {
        const hay = norm(d.titulo + " " + (d.descricao || "") + " " + (d.tags || []).join(" "));
        const score = kw.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
        return { d, score };
      }).sort((a, b) => b.score - a.score);

      const hits = scored.filter((x) => x.score > 0).slice(0, 5);
      let ctx = "";
      const fontes: any[] = [];
      for (const { d } of hits) {
        const corpo = (d.current?.conteudo_md || d.descricao || "").slice(0, 5000);
        ctx += `\n\n## ${d.titulo} (secao: ${d.section?.nome || "-"})\n${corpo}`;
        fontes.push({ titulo: d.titulo, secao: d.section?.nome || null });
        if (ctx.length > 24000) break;
      }

      // Prefixo fixo (instruções + sobre o sistema + panorama ao vivo, que muda pouco) com cache; trechos da base,
      // escolhidos pela pergunta, depois.
      const fixo =
        "Voce e a IA do Sistema Operacional da Tia do Ingles. Responda em portugues do Brasil, de forma direta e util.\n\n" +
        "Voce pode responder QUALQUER pergunta:\n" +
        "1) Sobre o proprio sistema (setores, secoes, documentos, ferramentas, status, papeis): use 'SOBRE O SISTEMA' e 'PANORAMA ATUAL' abaixo — eles listam TODOS os documentos por secao e o status de cada ferramenta.\n" +
        "2) Sobre a empresa / metodologia / clientes / etc.: use os 'TRECHOS DA BASE DE CONHECIMENTO' e cite o titulo do documento entre parenteses.\n" +
        "3) Perguntas gerais (fora da empresa): responda normalmente com seu conhecimento, e deixe claro que a resposta nao vem da base da empresa.\n" +
        "Se a base nao cobrir algo especifico da empresa, diga o que falta em vez de inventar.\n\n" +
        "=== SOBRE O SISTEMA ===\n" + SOBRE_A_OS + "\n\n" +
        "=== PANORAMA ATUAL (dados ao vivo) ===\n" + snap + "\n\n";
      const variavel = "=== TRECHOS DA BASE DE CONHECIMENTO ===" + (ctx || "\n(nenhum documento relevante para esta pergunta especifica)");

      // Resposta reaproveitada só para pergunta livre curta (<= 600 caracteres). Pedidos longos de geração (ex.:
      // Gerador de conteúdos, que manda as instruções na própria pergunta) sempre geram de novo. body.cache === false
      // também força resposta nova.
      const usarCache = body.cache !== false && pergunta.length <= 600;
      const hash = usarCache ? await sha256(JSON.stringify(["ask_geral", MODEL, fixo, variavel, normPergunta(pergunta)])) : "";
      const doCache = usarCache ? await lerRespostaCache(sbService, hash) : null;
      if (doCache && typeof doCache.resposta === "string") {
        await logAiUsage(sbService, "ai:ask_geral:cache", MODEL, { input_tokens: 0, output_tokens: 0 }, uid);
        return json({ configured: true, resposta: doCache.resposta, fontes, cache: true });
      }
      if (await tetoBloqueia()) return RESP_TETO();
      const { text: resposta, usage } = await anthropic({ fixo, variavel }, pergunta, 3000, wsId);
      await logAiUsage(sbService, "ai:ask_geral", MODEL, usage, uid);
      if (usarCache && resposta) await gravarRespostaCache(sbService, hash, "ask_geral", { resposta });
      return json({ configured: true, resposta, fontes });
    }

    return json({ error: "Acao desconhecida" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502);
  }
});

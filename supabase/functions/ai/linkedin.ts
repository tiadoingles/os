// LinkedIn da Tia (aba Conteúdo > LinkedIn): geração da fila semanal e reescrita de um post.
// Fase 2 = só fila com aprovação; nada aqui publica no LinkedIn.
// Tudo usa o cliente `sb` com o JWT de quem chamou (RLS de linkedin_posts: aba Conteúdo), menos o guia editorial.

type Anthropic = (system: string, user: string, maxTokens: number) => Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } }>;

export const CHAVE_GUIA = "linkedin:guia-editorial";

// Grade do guia editorial (seção 6). dia: 0 = segunda ... 4 = sexta.
const GRADE = [
  { dia: 0, hora: "08:00", pilar: 1, opcional: false, dica: "Pilar 1 — Dor" },
  { dia: 1, hora: "08:00", pilar: 2, opcional: false, dica: "Pilar 2 — Trabalho" },
  { dia: 2, hora: "08:00", pilar: 3, opcional: false, dica: "Pilar 3 — Ciência" },
  { dia: 3, hora: "08:00", pilar: 4, opcional: false, dica: "Pilar 4 — Bloqueio" },
  { dia: 4, hora: "08:00", pilar: 5, opcional: false, dica: "Pilar 5 — Autoridade/História" },
  { dia: 1, hora: "17:30", pilar: 4, opcional: true, dica: "Pilar 4 — Bloqueio" },
  { dia: 2, hora: "17:30", pilar: 5, opcional: true, dica: "Pilar 5 — Case (sem nome de aluna real)" },
  { dia: 3, hora: "17:30", pilar: 2, opcional: true, dica: "Pilar 2 — Mini-aula" },
];
const DIAS = ["segunda", "terça", "quarta", "quinta", "sexta"];

// ---------- tamanho por formato (guia v2, seção 4.1/5) ----------
// História (inclui "História pessoal"), Case de aluna (inclui "Case de aluna anônimo") e Depoimento
// seguem a estrutura de roteiro e vão de 1.500 a 2.500 caracteres; os demais formatos, de 900 a 1.500.
// Mesma regra do front (liFaixaTamanho em app.js).
export function ehFormatoRoteiro(formato: string): boolean {
  const f = String(formato || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /historia|case|depoimento/.test(f);
}
export function faixaTamanho(formato: string): { min: number; max: number } {
  return ehFormatoRoteiro(formato) ? { min: 1500, max: 2500 } : { min: 900, max: 1500 };
}

export const REGRAS_LINKEDIN = [
  "REGRAS OBRIGATÓRIAS DE CADA POST (LinkedIn pessoal da Marcela Miranda, a Tia do Inglês, em primeira pessoa):",
  "- Português do Brasil impecável, tom adulto, acolhedor e direto, linguagem falada. Parágrafos de 1 a 2 linhas.",
  "- Tamanho por formato (contando hashtags): História, Case de aluna e Depoimento entre 1.500 e 2.500 caracteres (estrutura de roteiro abaixo); todos os outros formatos entre 900 e 1.500 caracteres.",
  "- Gancho (primeiras 1 a 2 linhas, antes da primeira linha em branco) com no máximo 200 caracteres: tem que parar o dedo sozinho.",
  "- Uma ideia só por post. Estrutura: gancho → desenvolvimento → virada/lição → 1 pergunta aberta → 0 a 3 hashtags.",
  "- O texto (antes das hashtags) TERMINA com uma pergunta aberta para comentário.",
  "- De 0 a 3 hashtags, no fim, escolhidas entre: #inglês #inglêsparaadultos #inglêsnotrabalho #aprendizagemacelerada #carreira #desenvolvimentopessoal #fluência.",
  "- No máximo 1 emoji no post inteiro, e só destes: \u{1f680} \u{1f9e0} \u{1f1fa}\u{1f1f8} \u{1f64f} \u{2764}\u{fe0f} (de preferência nenhum).",
  "- NUNCA link no corpo do post (se precisar de link, ele vai no primeiro comentário).",
  "- NUNCA mencionar idade, nem positivamente (nada de 'depois dos 40', 'na minha idade', 'maduras').",
  "- NUNCA usar estatística ou número de pesquisa ('X% das alunas', 'pesquisas mostram que 7 em cada 10').",
  "- NUNCA diminutivo nem linguagem infantil (nada de 'inglesinho', 'rapidinho', 'pouquinho', 'aluninha').",
  "- NUNCA religião, política ou tema polêmico.",
  "- Não inventar nome de aluna nem case com nome: case só de forma anônima ('uma aluna me contou').",
  "- Todo exemplo em inglês tem que ser 100% correto e natural.",
  "- Sem exclamação em excesso. Bullets só no formato passo a passo.",
].join("\n");

// Estrutura de roteiro (filme/série/novela) para História / Case de aluna / Depoimento — guia v2, seção 4.1.
export const REGRAS_ROTEIRO = [
  "FORMATO HISTÓRIA / CASE DE ALUNA / DEPOIMENTO — ESTRUTURA DE ROTEIRO (filme, série, novela). Vale sempre que o formato do post for História, Case de aluna ou Depoimento:",
  "1. Cena de abertura: uma frase forte (de preferência uma fala ou uma imagem concreta).",
  "2. Contexto / rotina da personagem: quem ela é, onde trabalha, o que faz bem.",
  "3. Escalada da tensão, com detalhes sensoriais e concretos.",
  "4. Fundo do poço: o custo emocional (culpa, vergonha, a \"conta\" de anos de curso e de dinheiro investido).",
  "5. Espelho para o leitor (\"Talvez você conheça…\").",
  "6. Só então a virada: o encontro com a Tia / o Método, explicado em linguagem humana, sem jargão.",
  "7. Resolução sem mágica: recaídas, dias ruins, \"não foi mágica\".",
  "8. Momento-símbolo da vitória: uma cena pequena e concreta que mostra a mudança.",
  "9. Fechamento com leveza.",
  "10. CTA: uma pergunta aberta.",
  "- Mais desenvolvimento do que resolução: a maior parte do texto fica nos passos 2 a 5.",
  "- Detalhes que pareçam verdadeiros e parecidos com a vida de quem lê. NUNCA soar como depoimento simples \"não conseguia → agora consegue\".",
  "- Frases curtas, muitas quebras de linha.",
  "- Tamanho: de 1.500 a 2.500 caracteres (contando hashtags).",
  "- Se o post for sobre uma aluna real (com nome) e tiver detalhes dramatizados que ela não disse, sinalize na observação: \"Detalhes dramatizados — confirmar com a aluna: <lista curta dos detalhes>\".",
].join("\n");

// Exemplo aprovado pela Tia (15/10/2026). Referência de ESTRUTURA e RITMO, não de tema.
export const EXEMPLO_ROTEIRO = `"Eu me escondia no banheiro."

A Ananda me contou isso rindo.
Mas eu sabia que não tinha graça nenhuma.

Ela era a pessoa que resolvia o que ninguém resolvia na empresa. Respeitada, competente, segura.
Em português.

O problema era o time de Londres.

Quase toda manhã, lá estava no calendário: reunião em inglês, câmera ligada.

Quinze minutos antes, começava.
O estômago fechava. A mão gelava no mouse.
Ela abria as anotações com as frases que tinha ensaiado na noite anterior, e elas pareciam escritas em outra língua.

A call começava.
Os ingleses falavam rápido, emendavam as palavras, riam de uma piada que ela não pegou.
Ela ria junto. Meio segundo atrasada.

E por dentro, uma única frase se repetia:
"Por favor, que ninguém fale o meu nome."

Foi assim que nasceu a famosa "internet do Brasil".
A conexão que caía exatamente quando chegava a vez dela.
Câmera congelada. Microfone mudo. "Sorry, my connection is terrible."

Nos dias piores, nem isso.
Ela saía da mesa, trancava a porta do banheiro e esperava a reunião acabar.

Do outro lado do oceano, os colegas deviam achar que no Brasil o wi-fi não funcionava nunca.

Mas o pior não era a call.
Era depois.
Fechar o notebook e fazer a conta: anos de curso, dinheiro investido, livros pela metade.
E a pergunta que doía mais que a vergonha:
"Se eu estudei tanto, por que eu não consigo?"

Talvez você conheça essa conta.
A certeza silenciosa de que o problema é você.

Quando a Ananda chegou até mim, a primeira coisa que eu disse foi:
"Você não tem um problema de inglês. Você tem um corpo que aprendeu que falar inglês é perigoso."

Mais uma lista de vocabulário não ia resolver.
A gente precisava ensinar o cérebro dela que aquilo não era ameaça.
Ambiente seguro para errar. Frases treinadas até saírem sem pensar. Repetição, dia após dia.

Não foi mágica.
Teve dia de travar de novo. Teve call em que a voz tremeu.

Até que, numa manhã qualquer, alguém em Londres disse o nome dela.

E ela respondeu.

Sem banheiro. Sem queda de conexão.

Hoje ela entra nas reuniões, entende e participa.
E, segundo ela, o wi-fi do Brasil milagrosamente voltou a funcionar.

Se você já inventou uma desculpa para fugir de uma call em inglês, não é falta de capacidade. E tem saída.

Qual foi a desculpa que você já usou?

#inglêsnotrabalho #carreira #fluência`;

const BLOCO_EXEMPLO_ROTEIRO = [
  "=== EXEMPLO APROVADO PELA TIA — FORMATO HISTÓRIA/CASE (copie a ESTRUTURA, o ritmo e o nível de detalhe; NÃO copie o tema, a cena, as frases nem o nome da aluna) ===",
  EXEMPLO_ROTEIRO,
].join("\n");

// ---------- verificação automática das regras (vira aviso na observacao) ----------
const EMOJIS_OK = ["\u{1f680}", "\u{1f9e0}", "\u{1f1fa}\u{1f1f8}", "\u{1f64f}", "\u{2764}\u{fe0f}", "\u{2764}"];
const fmtN = (n: number) => n.toLocaleString("pt-BR");
export function checarPost(texto: string, formato = ""): string[] {
  const avisos: string[] = [];
  const t = (texto || "").trim();
  const n = [...t].length;
  const { min, max } = faixaTamanho(formato);
  const qual = ehFormatoRoteiro(formato) ? " para história/case/depoimento" : "";
  if (n < min) avisos.push(`curto (${n} caracteres; mínimo ${fmtN(min)}${qual})`);
  if (n > max) avisos.push(`longo (${n} caracteres; máximo ${fmtN(max)}${qual})`);
  const gancho = t.split(/\n\s*\n/)[0] || "";
  if ([...gancho].length > 200) avisos.push(`gancho com ${[...gancho].length} caracteres (máximo 200)`);
  if (/https?:\/\/|www\.|\b[\w-]+\.(com|com\.br|br|ly|io|me)\b/i.test(t)) avisos.push("tem link no corpo");
  const tags = t.match(/#[\p{L}\p{N}_]+/gu) || [];
  if (tags.length > 3) avisos.push(`${tags.length} hashtags (máximo 3)`);
  const semTags = t.split("\n").filter((l) => !/^\s*(#[\p{L}\p{N}_]+\s*)+$/u.test(l)).join("\n").trim();
  if (!/\?\s*$/.test(semTags)) avisos.push("não termina com pergunta");
  const flags = t.match(/\p{Regional_Indicator}{2}/gu) || [];
  const picto = (t.replace(/\p{Regional_Indicator}/gu, "").match(/\p{Extended_Pictographic}/gu) || []);
  const emojis = [...flags, ...picto];
  if (emojis.length > 1) avisos.push(`${emojis.length} emojis (máximo 1)`);
  const fora = emojis.filter((e) => !EMOJIS_OK.includes(e) && !(e === "\u{1f1fa}\u{1f1f8}"));
  if (fora.length) avisos.push(`emoji fora da marca (${fora.join(" ")})`);
  if (/\b\d{1,3}\s?%/.test(t)) avisos.push("parece ter estatística (%)");
  return avisos;
}

// Observação de detalhes dramatizados vinda do modelo: só aceita o formato combinado.
function obsDramatizados(v: unknown): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!s || /^null$/i.test(s)) return null;
  if (!/^detalhes dramatizados/i.test(s)) return null;
  return s.slice(0, 600);
}

// ---------- datas (America/Sao_Paulo; sem horário de verão desde 2019 => UTC-03:00) ----------
function somaDiasISO(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}
function ehSegunda(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && dt.getUTCDay() === 1;
}
const TZ = "-03:00";
function slotISO(inicio: string, dia: number, hora: string) { return `${somaDiasISO(inicio, dia)}T${hora}:00${TZ}`; }

// Acesso por aba: aba Conteúdo (ou ADM). O index.ts já confere antes; aqui é a segunda trava.
async function exigirEditor(sb: any, uid: string): Promise<string | null> {
  const { data } = await sb.from("profiles").select("role, areas").eq("id", uid).maybeSingle();
  if (!data || !(data.role === "admin" || (Array.isArray(data.areas) && data.areas.includes("conteudo"))))
    return "Só quem tem a aba Conteúdo pode gerar ou reescrever posts do LinkedIn.";
  return null;
}

async function lerGuia(sb: any): Promise<string> {
  const { data } = await sb.from("kb_documents")
    .select("titulo, current:current_version_id(conteudo_md)")
    .eq("chave_externa", CHAVE_GUIA).maybeSingle();
  return (data?.current?.conteudo_md || "").trim();
}

function extrairJSONArray(raw: string): any[] | null {
  const i = raw.indexOf("["), j = raw.lastIndexOf("]");
  if (i < 0 || j <= i) return null;
  try { const v = JSON.parse(raw.slice(i, j + 1)); return Array.isArray(v) ? v : null; } catch { return null; }
}

export async function linkedinSemana(
  sb: any, uid: string, body: Record<string, any>, anthropic: Anthropic, log: (origem: string, usage: any) => Promise<void>,
  sbGuia?: any, // service_role, só para ler o guia editorial (Base de Conhecimento) depois da checagem da aba
) {
  const erroPapel = await exigirEditor(sb, uid);
  if (erroPapel) return { status: 403, body: { error: erroPapel } };

  const inicio = String(body.inicio ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !ehSegunda(inicio))
    return { status: 400, body: { error: "Envie 'inicio' no formato AAAA-MM-DD, numa segunda-feira." } };
  const incluirOpcionais = !!body.incluir_opcionais;

  const guia = await lerGuia(sbGuia || sb);
  if (!guia) return { status: 400, body: { error: `Guia editorial não encontrado na Base (chave_externa '${CHAVE_GUIA}').` } };

  // Slots da semana que ainda não têm post (ignora descartados): não duplica se rodar 2x.
  const ini = `${inicio}T00:00:00${TZ}`;
  const fim = `${somaDiasISO(inicio, 7)}T00:00:00${TZ}`;
  const { data: existentes, error: eEx } = await sb.from("linkedin_posts").select("agendado_para,status")
    .gte("agendado_para", ini).lt("agendado_para", fim).neq("status", "descartado");
  if (eEx) return { status: 500, body: { error: eEx.message } };
  // Horário ocupado = já existe post no mesmo dia e no mesmo turno (manhã < 12h ≤ tarde, horário de Brasília),
  // para não duplicar quando um post foi movido de 08:00 para 08:30, por exemplo.
  const turno = (ms: number) => { const d = new Date(ms - 3 * 3600 * 1000); return d.toISOString().slice(0, 10) + (d.getUTCHours() < 12 ? "M" : "T"); };
  const ocupados = new Set((existentes || []).map((r: any) => turno(new Date(r.agendado_para).getTime())));
  const slots = GRADE.filter((g) => incluirOpcionais || !g.opcional)
    .map((g) => ({ ...g, iso: slotISO(inicio, g.dia, g.hora) }))
    .filter((g) => !ocupados.has(turno(new Date(g.iso).getTime())))
    .sort((a, b) => a.iso.localeCompare(b.iso));
  if (!slots.length) return { status: 200, body: { configured: true, criados: [], pulados: (existentes || []).length, mensagem: "Todos os horários desta semana já têm post." } };

  const [insRes, recRes, exRes] = await Promise.all([
    sb.from("conteudo_insights").select("categoria,texto,detalhe").order("categoria").order("ordem"),
    sb.from("linkedin_posts").select("pilar,formato,texto,status").order("created_at", { ascending: false }).limit(20),
    sb.from("linkedin_posts").select("pilar,formato,texto").in("status", ["aprovado", "publicado"])
      .order("updated_at", { ascending: false }).limit(4),
  ]);
  const insights = (insRes.data || []).map((r: any) => `- [${r.categoria}] ${r.texto}${r.detalhe ? ` (${r.detalhe})` : ""}`).join("\n");
  const recentes = (recRes.data || []).map((r: any) => {
    const gancho = String(r.texto || "").split(/\n\s*\n/)[0].replace(/\s+/g, " ").slice(0, 180);
    return `- Pilar ${r.pilar} · ${r.formato} · ${r.status}: ${gancho}`;
  }).join("\n");
  const exemplos = (exRes.data || []).map((r: any, i: number) =>
    `### Exemplo ${i + 1} (Pilar ${r.pilar} · ${r.formato})\n${r.texto}`).join("\n\n");

  const listaSlots = slots.map((s, i) =>
    `${i + 1}. ${DIAS[s.dia]} ${somaDiasISO(inicio, s.dia).split("-").reverse().join("/")} ${s.hora} — pilar ${s.pilar} (${s.dica})`).join("\n");

  const system = [
    "Você é a redatora do LinkedIn pessoal da Marcela Miranda (a Tia do Inglês), especialista em como o adulto aprende e destrava o inglês.",
    "Escreve em primeira pessoa, como ela, para profissionais que estudaram inglês mas travam para falar no trabalho (e para RH/líderes).",
    "",
    "=== GUIA EDITORIAL (fonte da verdade) ===",
    guia,
    "",
    REGRAS_LINKEDIN,
    "",
    REGRAS_ROTEIRO,
    "",
    BLOCO_EXEMPLO_ROTEIRO,
    "",
    "=== POSTS JÁ APROVADOS (copie o TOM e o ritmo; NÃO copie os temas; o tamanho segue a regra por formato: história/case/depoimento de 1.500 a 2.500 caracteres, demais de 900 a 1.500) ===",
    exemplos || "(ainda não há posts aprovados)",
  ].join("\n");

  const user = [
    `Escreva ${slots.length} post(s) para a semana que começa em ${inicio.split("-").reverse().join("/")}, um para cada horário abaixo, no pilar indicado:`,
    listaSlots,
    "",
    "Varie os formatos ao longo da semana (História, Mito × Verdade, Passo a passo, Case de aluna anônimo, Opinião contrária, Mini-aula, Reflexão).",
    "Se o formato for História, Case de aluna ou Depoimento, siga a ESTRUTURA DE ROTEIRO e escreva de 1.500 a 2.500 caracteres; nos demais formatos, de 900 a 1.500.",
    "Use os insights das pesquisas com alunas como matéria-prima (dores, desejos, mitos), sem citar números.",
    "",
    "=== INSIGHTS DAS PESQUISAS COM ALUNAS ===",
    insights || "(sem insights)",
    "",
    "=== ÚLTIMOS POSTS DA FILA (NÃO repetir estes temas nem ganchos) ===",
    recentes || "(fila vazia)",
    "",
    "Responda APENAS com um array JSON válido, sem texto antes ou depois, um objeto por horário, na mesma ordem:",
    `[{"slot":1,"pilar":1,"formato":"<formato>","texto":"<post completo, com quebras de linha \\n e hashtags no fim>","primeiro_comentario":null,"observacao":null}]`,
    "primeiro_comentario: só se fizer sentido um complemento (sem link inventado); senão null.",
    "observacao: null, exceto se o post contar a história de uma aluna real com detalhes dramatizados que ela não disse; aí \"Detalhes dramatizados — confirmar com a aluna: <lista curta>\".",
  ].join("\n");

  const { text: raw, usage } = await anthropic(system, user, Math.min(12000, 1800 * slots.length + 800));
  await log("ai:linkedin_semana", usage);
  const arr = extrairJSONArray(raw);
  if (!arr || !arr.length) return { status: 502, body: { error: "Não consegui interpretar a resposta da IA. Tente de novo.", raw: raw.slice(0, 2000) } };

  const linhas: any[] = [];
  slots.forEach((s, i) => {
    // Casa pelo campo "slot"; só usa a posição quando o modelo não mandou "slot" em nenhum item.
    const temSlot = arr.some((x: any) => x && x.slot != null);
    const p = temSlot ? arr.find((x: any) => Number(x?.slot) === i + 1) : arr[i];
    const texto = String(p?.texto ?? "").trim();
    if (!texto) return;
    const formato = String(p?.formato ?? "").trim().slice(0, 60) || "Reflexão";
    const avisos = checarPost(texto, formato);
    const obs = [
      obsDramatizados(p?.observacao),
      avisos.length ? "Revisar (checagem automática): " + avisos.join("; ") + "." : null,
    ].filter(Boolean).join(" ");
    linhas.push({
      pilar: s.pilar, // a grade manda; o modelo não muda o pilar do horário
      formato,
      texto,
      primeiro_comentario: p?.primeiro_comentario ? String(p.primeiro_comentario).trim() : null,
      agendado_para: s.iso,
      status: "rascunho",
      observacao: obs || null,
    });
  });
  if (!linhas.length) return { status: 502, body: { error: "A IA não devolveu nenhum post. Tente de novo." } };

  const { data: criados, error: eIns } = await sb.from("linkedin_posts").insert(linhas).select("*");
  if (eIns) return { status: 500, body: { error: eIns.message } };
  return { status: 200, body: { configured: true, criados: criados || [], pulados: GRADE.filter((g) => incluirOpcionais || !g.opcional).length - slots.length } };
}

export async function linkedinReescrever(
  sb: any, uid: string, body: Record<string, any>, anthropic: Anthropic, log: (origem: string, usage: any) => Promise<void>,
  sbGuia?: any, // service_role, só para ler o guia editorial (Base de Conhecimento) depois da checagem da aba
) {
  const erroPapel = await exigirEditor(sb, uid);
  if (erroPapel) return { status: 403, body: { error: erroPapel } };
  const id = String(body.id ?? "").trim();
  const instrucao = String(body.instrucao ?? "").trim().slice(0, 1500);
  if (!id) return { status: 400, body: { error: "Envie o id do post." } };
  if (!instrucao) return { status: 400, body: { error: "Escreva a instrução (o que mudar no post)." } };

  const { data: post, error } = await sb.from("linkedin_posts").select("id,pilar,formato,texto").eq("id", id).maybeSingle();
  if (error) return { status: 500, body: { error: error.message } };
  if (!post) return { status: 404, body: { error: "Post não encontrado." } };
  // Texto atual vindo do front (edição ainda não salva) tem prioridade sobre o do banco.
  const atual = typeof body.texto === "string" && body.texto.trim() ? body.texto : post.texto;
  const guia = await lerGuia(sbGuia || sb);
  const roteiro = ehFormatoRoteiro(post.formato);

  const system = [
    "Você revisa e reescreve posts do LinkedIn pessoal da Marcela Miranda (a Tia do Inglês), em primeira pessoa, mantendo a voz dela.",
    guia ? "=== GUIA EDITORIAL ===\n" + guia : "",
    REGRAS_LINKEDIN,
    roteiro ? REGRAS_ROTEIRO : "",
    roteiro ? BLOCO_EXEMPLO_ROTEIRO : "",
    "Aplique a instrução da editora sem quebrar nenhuma regra. Mantenha pilar e ideia central, salvo se a instrução pedir outra coisa.",
    roteiro
      ? "Este post é do formato " + post.formato + ": aplique a ESTRUTURA DE ROTEIRO e escreva de 1.500 a 2.500 caracteres. " +
        "Responda com o texto final do post (sem aspas, sem comentários, sem título). Se o post for sobre uma aluna real (com nome) e você " +
        "tiver acrescentado detalhes dramatizados que não estavam no texto original, adicione no fim, depois de uma linha em branco, UMA linha " +
        "exatamente assim: OBSERVACAO: Detalhes dramatizados — confirmar com a aluna: <lista curta>. Caso contrário, não escreva essa linha."
      : "Responda SOMENTE com o texto final do post (sem aspas, sem comentários, sem título).",
  ].filter(Boolean).join("\n\n");
  const user = `Pilar ${post.pilar} · Formato: ${post.formato}\n\nINSTRUÇÃO: ${instrucao}\n\n=== POST ATUAL ===\n${atual}`;

  const { text, usage } = await anthropic(system, user, 2500);
  await log("ai:linkedin_reescrever", usage);
  let texto = text.replace(/^```[a-z]*\n?|\n?```$/g, "").trim();
  let observacao: string | null = null;
  const mObs = texto.match(/\n?\s*OBSERVA[CÇ][AÃ]O:\s*(.+)\s*$/i);
  if (mObs) {
    observacao = obsDramatizados(mObs[1]);
    texto = texto.slice(0, mObs.index).trim();
  }
  if (!texto) return { status: 502, body: { error: "A IA não devolveu texto. Tente de novo." } };
  return { status: 200, body: { configured: true, texto, avisos: checarPost(texto, post.formato), observacao } };
}

// Financeiro · Hotmart — perguntas livres, consultas e ações na API oficial da Hotmart, na hora.
// Não existe no Craft: segue a linguagem visual das outras telas (comum.js). Base: ./comum.js (não editar lá).
// Tudo passa pela Edge Function `hotmart` (supabase/functions/hotmart): op 'consulta' | 'acao' | 'pergunta'
// (Claude com as consultas como ferramentas; custo em ai_usage_log). A função grava cada chamada em
// public.fin_hotmart_pedidos, que esta tela lista como Histórico (só leitura). Ações exigem confirmação explícita
// (confirmado:true). Sem DESFAZER: as ações alteram dados na Hotmart, fora do banco do OS.
// Credenciais (segredos da função): HOTMART_CLIENT_ID, HOTMART_CLIENT_SECRET, HOTMART_BASIC.
import { html } from "htm/preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { os, podeEditarFin, FinPage, Icone, Pill, cn, parseValorBR, useLocalState } from "./comum.js";

const LINK_REEMBOLSO = "https://app-vlc.hotmart.com/sales";
export const LINK_SEGREDOS = "https://supabase.com/dashboard/project/hmvlkltyvyhlxfyaovpe/settings/functions";

/** Chama a Edge Function `hotmart`. Sempre devolve um objeto { ok, ... } (erros de rede viram { ok:false, error }). */
export async function chamarHotmart(body) {
  const { data, error } = await os.sb.functions.invoke("hotmart", { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j && j.error) return { ok: false, ...j }; } catch (_) { /* ignore */ }
    return { ok: false, error: msg };
  }
  return data || { ok: false, error: "sem resposta" };
}

/* ============================ Catálogo ============================ */
// Campo: { k, rotulo, tipo: date|text|email|select|int|checkbox|lista, obrig, opcoes, min, max, maxLen, padrao, dica }
const D_INI = { k: "data_inicio", rotulo: "Data inicial", tipo: "date", obrig: true };
const D_FIM = { k: "data_fim", rotulo: "Data final", tipo: "date", obrig: true };
const EMAIL = { k: "email", rotulo: "E-mail do cliente", tipo: "email", obrig: true };
const PRODUTO = { k: "produto", rotulo: "Produto (nome ou ID)", tipo: "text", obrig: true };
const SUB = { k: "subscriber_code", rotulo: "Código do assinante (subscriber code)", tipo: "text", obrig: true, dica: "Aparece em Assinaturas e parcelamentos ou nas Parcelas de um cliente." };
// Área de membros (Hotmart Club): a API pede o subdomínio (o que vem antes de .club.hotmart.com).
const SUBDOMINIO = { k: "subdomain", rotulo: "Área de membros (subdomínio)", tipo: "text", obrig: true, subdominio: true, dica: "O que vem antes de .club.hotmart.com. Fica salvo neste navegador." };

export const CONSULTAS = [
  { slug: "vendas_periodo", rotulo: "Vendas do período", campos: [D_INI, D_FIM,
    { k: "status", rotulo: "Status", tipo: "select", opcoes: [["", "Todas"], ["APPROVED", "Aprovadas"], ["COMPLETE", "Completas"], ["WAITING_PAYMENT", "Aguardando pagamento"], ["OVERDUE", "Vencidas"], ["CANCELLED", "Canceladas"], ["REFUNDED", "Reembolsadas"], ["CHARGEBACK", "Chargeback"]] },
    { k: "produto", rotulo: "Produto (opcional)", tipo: "text" }] },
  { slug: "resumo_vendas", rotulo: "Resumo de vendas", campos: [D_INI, D_FIM] },
  { slug: "detalhe_venda", rotulo: "Detalhes de uma venda (taxas e participantes)", campos: [{ k: "transacao", rotulo: "Código da transação", tipo: "text", obrig: true, dica: "Ex.: HP1234567890" }] },
  { slug: "comissoes", rotulo: "Comissões (coprodução e afiliados)", campos: [D_INI, D_FIM] },
  { slug: "compras_cliente", rotulo: "Compras de um cliente", campos: [EMAIL] },
  { slug: "assinaturas", rotulo: "Assinaturas e parcelamentos", campos: [
    { k: "status", rotulo: "Status", tipo: "select", opcoes: [["", "Todas"], ["ACTIVE", "Ativas"], ["DELAYED", "Atrasadas"], ["CANCELLED_BY_CUSTOMER", "Canceladas"]] },
    { k: "email", rotulo: "E-mail do cliente (opcional)", tipo: "email" }] },
  { slug: "resumo_assinaturas", rotulo: "Resumo de assinaturas", campos: [] },
  { slug: "parcelas_cliente", rotulo: "Parcelas de um cliente", campos: [EMAIL] },
  { slug: "saude_assinaturas", rotulo: "Saúde das assinaturas (atrasos e cancelamentos)", campos: [] },
  { slug: "alunos", rotulo: "Alunos de um produto", campos: [SUBDOMINIO] },
  { slug: "progresso_aluno", rotulo: "Progresso de um aluno", campos: [{ ...EMAIL, rotulo: "E-mail do aluno" }, SUBDOMINIO] },
  { slug: "modulos", rotulo: "Módulos e páginas da área de membros", campos: [SUBDOMINIO] },
  { slug: "produtos", rotulo: "Produtos, ofertas e planos", campos: [] },
  { slug: "cupons", rotulo: "Cupons de um produto", campos: [PRODUTO] },
  { slug: "eventos", rotulo: "Eventos e participantes", campos: [] },
];
export const ACOES = [
  { slug: "cancelar_assinatura", rotulo: "Cancelar assinatura", campos: [SUB, { k: "enviar_email", rotulo: "Enviar e-mail de cancelamento ao assinante", tipo: "checkbox", padrao: true }] },
  { slug: "reativar_assinatura", rotulo: "Reativar assinatura", campos: [SUB, { k: "cobrar_agora", rotulo: "Cobrar agora", tipo: "checkbox", padrao: false }] },
  { slug: "mudar_dia_cobranca", rotulo: "Mudar dia de cobrança", campos: [SUB, { k: "dia", rotulo: "Novo dia de cobrança (1 a 31)", tipo: "int", obrig: true, min: 1, max: 31 }] },
  { slug: "criar_cupom", rotulo: "Criar cupom", campos: [
    { k: "produto_id", rotulo: "ID do produto", tipo: "int", obrig: true, min: 1, dica: "Número do produto na Hotmart (veja em Produtos, ofertas e planos)." },
    { k: "codigo", rotulo: "Código do cupom", tipo: "text", obrig: true, maxLen: 25 },
    { k: "desconto_pct", rotulo: "Desconto (%)", tipo: "int", obrig: true, min: 1, max: 98, dica: "A Hotmart aceita de 1% a 98%. Não vale para produtos de assinatura." },
    { k: "validade_fim", rotulo: "Válido até (opcional)", tipo: "date" }] },
  { slug: "apagar_cupom", rotulo: "Apagar cupom", campos: [{ k: "cupom_id", rotulo: "ID do cupom", tipo: "int", obrig: true, min: 1, dica: "Veja em Cupons de um produto." }] },
  { slug: "gerar_negociacao", rotulo: "Gerar negociação de parcelas em atraso (Pix)", campos: [
    { k: "subscription_id", rotulo: "ID da assinatura (subscription id)", tipo: "int", obrig: true, min: 1 },
    { k: "recorrencias", rotulo: "Recorrências em atraso", tipo: "lista", obrig: true, dica: "Números separados por vírgula, de 1 a 5 itens. Ex.: 3, 4" },
    { k: "desconto_valor", rotulo: "Desconto em R$ (opcional)", tipo: "decimal", min: 0, dica: "A Hotmart só aceita desconto em valor absoluto na negociação." }] },
];
const POR_SLUG = Object.fromEntries([...CONSULTAS.map((c) => [c.slug, { ...c, tipo: "consulta" }]), ...ACOES.map((a) => [a.slug, { ...a, tipo: "acao" }])]);

/** Valida os valores do formulário e devolve { parametros } ou { erro }. Números viram number, datas AAAA-MM-DD. */
export function montarParametros(campos, valores) {
  const p = {};
  for (const c of campos) {
    const v = valores[c.k];
    if (c.tipo === "checkbox") { p[c.k] = !!v; continue; }
    const t = String(v ?? "").trim();
    if (!t) { if (c.obrig) return { erro: `Preencha: ${c.rotulo}.` }; continue; }
    if (c.tipo === "int") {
      if (!/^-?\d+$/.test(t)) return { erro: `${c.rotulo}: informe um número inteiro.` };
      const n = Number(t);
      if ((c.min != null && n < c.min) || (c.max != null && n > c.max)) return { erro: `${c.rotulo}: use um valor entre ${c.min ?? "-"} e ${c.max ?? "-"}.` };
      p[c.k] = n;
    } else if (c.tipo === "decimal") {
      const n = parseValorBR(t); // "10.50" = 10,50 (não 1050); "1.234,56" = 1234,56
      if (!Number.isFinite(n) || (c.min != null && n < c.min)) return { erro: `${c.rotulo}: valor inválido.` };
      p[c.k] = Math.round(n * 100) / 100;
    } else if (c.tipo === "lista") {
      const partes = t.split(/[,;\s]+/).filter(Boolean);
      if (!partes.every((x) => /^\d+$/.test(x))) return { erro: `${c.rotulo}: use só números separados por vírgula.` };
      const nums = [...new Set(partes.map(Number))].filter((n) => n > 0);
      if (nums.length < 1 || nums.length > 5) return { erro: `${c.rotulo}: informe de 1 a 5 números.` };
      p[c.k] = nums;
    } else if (c.tipo === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return { erro: `${c.rotulo}: data inválida.` };
      p[c.k] = t;
    } else if (c.tipo === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { erro: `${c.rotulo}: e-mail inválido.` };
      p[c.k] = t.toLowerCase();
    } else if (c.subdominio) {
      const sub = t.toLowerCase().replace(/^https?:\/\//, "").replace(/\.club\.hotmart\.com.*$/, "").replace(/\/.*$/, "");
      if (!/^[a-z0-9][a-z0-9-]*$/.test(sub)) return { erro: `${c.rotulo}: use só letras, números e hífen (ex.: tiadoingles).` };
      p[c.k] = sub;
    } else {
      if (c.maxLen && t.length > c.maxLen) return { erro: `${c.rotulo}: no máximo ${c.maxLen} caracteres.` };
      p[c.k] = t;
    }
  }
  if (p.data_inicio && p.data_fim && p.data_inicio > p.data_fim) return { erro: "A data inicial precisa ser anterior ou igual à data final." };
  return { parametros: p };
}

/* ============================ Markdown simples (seguro) ============================ */
const escapar = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
function inline(s) {
  return escapar(s)
    .replace(/`([^`]+)`/g, '<code class="rounded bg-slate-100 px-1 text-[0.95em]">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
}
/** Parágrafos, títulos (#), listas (-, *, 1.) e negrito/itálico. Todo texto é escapado antes; sem links nem HTML. */
export function markdownSimples(md) {
  const out = [];
  let lista = null, par = [];
  const fecharPar = () => { if (par.length) { out.push(`<p>${par.map(inline).join("<br>")}</p>`); par = []; } };
  const fecharLista = () => { if (lista) { out.push(`<${lista.tag} class="${lista.tag === "ol" ? "list-decimal" : "list-disc"} space-y-1 pl-6">${lista.itens.map((i) => `<li>${inline(i)}</li>`).join("")}</${lista.tag}>`); lista = null; } };
  for (const bruta of String(md || "").replace(/\r/g, "").split("\n")) {
    const l = bruta.trimEnd();
    let m;
    if (!l.trim()) { fecharPar(); fecharLista(); continue; }
    if ((m = l.match(/^\s*#{1,6}\s+(.*)$/))) { fecharPar(); fecharLista(); out.push(`<p class="mt-2 font-black text-slate-900">${inline(m[1])}</p>`); continue; }
    if ((m = l.match(/^\s*[-*•]\s+(.*)$/)) || (m = l.match(/^\s*\d+[.)]\s+(.*)$/))) {
      const tag = /^\s*\d/.test(l) ? "ol" : "ul";
      fecharPar();
      if (!lista || lista.tag !== tag) { fecharLista(); lista = { tag, itens: [] }; }
      lista.itens.push(m[1]); continue;
    }
    if (/^\s*\|/.test(l)) { fecharLista(); par.push(l.trim()); continue; }
    fecharLista(); par.push(l.trim());
  }
  fecharPar(); fecharLista();
  return out.join("");
}

/* ============================ Utilidades ============================ */
function baixarCsv(nome, cab, linhas) {
  const esc = (v) => { const t = typeof v === "number" ? String(v).replace(".", ",") : v && typeof v === "object" ? JSON.stringify(v) : String(v ?? ""); return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = "﻿" + [cab.map(esc).join(";"), ...linhas.map((l) => l.map(esc).join(";"))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = nome + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const dataHoraBR = (ts) => (ts ? new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const nomeDe = (me) => (me && (me.nome || me.email)) || null;
const STATUS = {
  pendente: ["Pendente", "ambar"], processando: ["Processando", "verde"], concluido: ["Concluído", "escuro"],
  erro: ["Erro", "rosa"], cancelado: ["Cancelado", "neutro"],
};
function resumoParametros(p) {
  const e = Object.entries(p || {}).filter(([, v]) => v !== "" && v != null);
  if (!e.length) return "";
  return e.map(([k, v]) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "sim" : "não") : v}`).join(" · ");
}

async function fetchPedidos() {
  const { data, error } = await os.sb.from("fin_hotmart_pedidos").select("*").order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return data || [];
}

/* ============================ Tela ============================ */
/** Aviso quando os segredos da Hotmart ainda não estão no Supabase. */
export function BannerSemCredenciais() {
  return html`<div role="alert" class="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-bold text-amber-900">
    <${Icone} nome="alert" class="h-5 w-5 shrink-0" />
    <div class="space-y-1.5">
      <p class="text-sm font-black">Credenciais da Hotmart ainda não configuradas</p>
      <p class="font-semibold">Para conectar, crie uma credencial em Hotmart › Ferramentas › Credenciais Hotmart (API) e cadastre 3 segredos nas Edge Functions do Supabase:
        <code class="rounded bg-white px-1">HOTMART_CLIENT_ID</code> (Client ID), <code class="rounded bg-white px-1">HOTMART_CLIENT_SECRET</code> (Client Secret) e
        <code class="rounded bg-white px-1">HOTMART_BASIC</code> (o token "Basic" da mesma credencial).</p>
      <a href=${LINK_SEGREDOS} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 font-black text-emerald-700 underline">
        Abrir os segredos das Edge Functions no Supabase<${Icone} nome="arrow-up-right" class="h-3.5 w-3.5" /></a>
    </div>
  </div>`;
}

export function HotmartPage({ me }) {
  const pode = podeEditarFin(me);
  const [pergunta, setPergunta] = useState("");
  const [ocupado, setOcupado] = useState(null); // rótulo do que está rodando
  const [resultado, setResultado] = useState(null); // { titulo, tipo, ok, resposta, dados, error }
  const [semCred, setSemCred] = useState(false);
  const [pedidos, setPedidos] = useState(null);
  const [erroCarga, setErroCarga] = useState(false);
  const [aberto, setAberto] = useState(null); // slug do formulário
  const [expandido, setExpandido] = useState(() => new Set());
  const [subdominio, setSubdominio] = useLocalState("hotmart:subdominio", "");
  const vivo = useRef(true);
  const resultadoRef = useRef(null);

  async function carregar() {
    try { const p = await fetchPedidos(); if (vivo.current) { setPedidos(p); setErroCarga(false); } }
    catch (e) { if (vivo.current) { setErroCarga(true); setPedidos((x) => x || []); os.notify(os.errMsg(e), "err"); } }
  }
  useEffect(() => { vivo.current = true; carregar(); return () => { vivo.current = false; }; }, []);

  /** Executa na hora; devolve a resposta da função. Mostra o resultado no painel e recarrega o histórico. */
  async function executar(body, titulo) {
    setOcupado(titulo); setResultado(null);
    const r = await chamarHotmart(body);
    if (!vivo.current) return r;
    setOcupado(null);
    if (r.semCredenciais) setSemCred(true);
    else if (r.ok) setSemCred(false);
    setResultado({ titulo, tipo: body.op, ...r });
    carregar();
    setTimeout(() => resultadoRef.current && resultadoRef.current.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    return r;
  }
  async function enviarPergunta() {
    const t = pergunta.trim();
    if (!t || ocupado) return;
    if (t.length > 4000) return os.notify("A pergunta pode ter no máximo 4.000 caracteres.", "err");
    const r = await executar({ op: "pergunta", pergunta: t }, t);
    if (r.ok) setPergunta("");
  }
  const alternar = (id) => setExpandido((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const botao = "flex min-h-[3.25rem] items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50";

  return html`<${FinPage} class="space-y-6">
    <section>
      <p class="text-[16px] font-black uppercase tracking-[0.2em] text-emerald-700">Integração</p>
      <h1 class="mt-2 text-3xl font-black tracking-[-0.045em] text-[#07110e]">Hotmart</h1>
      <p class="mt-2 flex items-start gap-2 text-sm font-medium text-slate-500">
        <${Icone} nome="info" class="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
        <span>As respostas vêm na hora, direto da API oficial da Hotmart. Os botões de consulta não têm custo; as perguntas livres usam IA e têm um custo pequeno por pergunta.</span>
      </p>
    </section>

    ${semCred ? html`<${BannerSemCredenciais} />` : null}

    <section class="rounded-[1.6rem] border border-slate-200 bg-white p-5 md:p-7">
      <label for="fin-hm-pergunta" class="text-xl font-black tracking-tight">Pergunte à Hotmart</label>
      <p class="mt-1 text-sm font-medium text-slate-500">Ex.: "Quanto vendemos em outubro?" ou "Quais assinaturas estão atrasadas?". Usa IA (custo pequeno por pergunta).</p>
      <textarea id="fin-hm-pergunta" value=${pergunta} onInput=${(e) => setPergunta(e.target.value)} disabled=${!pode || !!ocupado} rows="5" maxLength="4000"
        onKeyDown=${(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) enviarPergunta(); }}
        placeholder="Escreva sua pergunta..." class="filter-select mt-4 min-h-[9rem] py-3 font-semibold"></textarea>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span class="text-xs font-semibold text-slate-400">${pergunta.length}/4000 · Ctrl+Enter envia</span>
        <button type="button" onClick=${enviarPergunta} disabled=${!pode || !pergunta.trim() || !!ocupado} class="premium-button-primary h-12 px-6 text-xs disabled:cursor-not-allowed disabled:opacity-50">
          <${Icone} nome=${ocupado ? "loader" : "arrow-right"} class=${cn("h-4 w-4", ocupado && "fin-spin")} />Enviar</button>
      </div>
      ${!pode ? html`<p class="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">Você pode consultar o histórico, mas não tem permissão para usar a integração.</p>` : null}
    </section>

    <div ref=${resultadoRef}>
      ${ocupado ? html`<section role="status" class="flex items-center gap-3 rounded-[1.6rem] border border-emerald-200 bg-emerald-50 p-5 text-sm font-bold text-emerald-900 md:p-7">
          <${Icone} nome="loader" class="h-5 w-5 shrink-0 fin-spin" /><span class="min-w-0 truncate">Consultando a Hotmart: ${ocupado}</span></section>`
        : resultado && !resultado.semCredenciais ? html`<${PainelResultado} r=${resultado} onFechar=${() => setResultado(null)} />` : null}
    </div>

    <section class="rounded-[1.6rem] border border-slate-200 bg-white p-5 md:p-7">
      <h2 class="text-xl font-black tracking-tight">Consultas</h2>
      <p class="mt-1 text-sm font-medium text-slate-500">Só leitura: nada muda na Hotmart. Sem custo de IA.</p>
      <div class="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        ${CONSULTAS.map((c) => html`<button type="button" key=${c.slug} disabled=${!pode || !!ocupado} onClick=${() => setAberto(c.slug)}
          class=${cn(botao, "border-slate-200 bg-white text-slate-800 hover:border-emerald-300 hover:bg-emerald-50/40")}>
          <span>${c.rotulo}</span><${Icone} nome="chevron-right" class="h-4 w-4 shrink-0 text-slate-400" /></button>`)}
      </div>
    </section>

    <section class="rounded-[1.6rem] border border-rose-200 bg-white p-5 md:p-7">
      <h2 class="flex items-center gap-2 text-xl font-black tracking-tight text-rose-800"><${Icone} nome="alert" class="h-5 w-5" />Ações na Hotmart</h2>
      <p class="mt-1 text-sm font-medium text-slate-500">Estas ações alteram dados reais na Hotmart (assinaturas, cupons, cobranças) na hora. Cada uma pede confirmação.</p>
      <div class="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        ${ACOES.map((a) => html`<button type="button" key=${a.slug} disabled=${!pode || !!ocupado} onClick=${() => setAberto(a.slug)}
          class=${cn(botao, "border-rose-200 bg-rose-50/40 text-rose-800 hover:border-rose-300 hover:bg-rose-50")}>
          <span>${a.rotulo}</span><${Icone} nome="chevron-right" class="h-4 w-4 shrink-0 text-rose-400" /></button>`)}
        <div class=${cn(botao, "cursor-default flex-col items-start border-dashed border-slate-300 bg-slate-50 text-slate-600")} role="note">
          <span class="flex items-center gap-2"><${Icone} nome="info" class="h-4 w-4" />Reembolsar venda</span>
          <span class="text-xs font-semibold text-slate-500">Não é automatizado: reembolsos são feitos direto no painel da Hotmart.
            <a href=${LINK_REEMBOLSO} target="_blank" rel="noopener noreferrer" class="ml-1 font-black text-emerald-700 underline">Abrir Minhas vendas</a></span>
        </div>
      </div>
    </section>

    <section class="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4 md:px-7">
        <h2 class="text-xl font-black tracking-tight">Histórico</h2>
        <button type="button" onClick=${carregar} class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-emerald-200"><${Icone} nome="rotate" class="h-3.5 w-3.5" />Atualizar</button>
      </div>
      ${pedidos === null ? html`<div class="p-12 text-center text-xs font-bold text-slate-400"><${Icone} nome="loader" class="mx-auto mb-3 h-6 w-6 fin-spin text-emerald-600" />Carregando histórico...</div>`
        : !pedidos.length ? html`<div class="p-12 text-center">
            <p class="text-sm font-black text-slate-600">${erroCarga ? "Não foi possível carregar o histórico" : "Nenhuma consulta ainda"}</p>
            <p class="mt-1 text-xs font-medium text-slate-400">${erroCarga ? "Nenhum dado foi alterado." : "Faça uma pergunta ou use uma das consultas acima."}</p></div>`
        : html`<ul class="divide-y divide-slate-100">${pedidos.map((p) => html`<${ItemHistorico} key=${p.id} p=${p} aberto=${expandido.has(p.id)} onAlternar=${() => alternar(p.id)} />`)}</ul>`}
    </section>

    ${aberto ? html`<${ModalPedido} item=${POR_SLUG[aberto]} subdominio=${subdominio} onClose=${() => setAberto(null)}
      onEnviar=${async (item, parametros) => {
        if (parametros.subdomain) setSubdominio(parametros.subdomain);
        const r = await executar(item.tipo === "acao" ? { op: "acao", acao: item.slug, parametros, confirmado: true } : { op: "consulta", acao: item.slug, parametros }, item.rotulo);
        if (r.ok || r.semCredenciais) setAberto(null);
        return r;
      }} />` : null}
  <//>`;
}

/** Resultado da última consulta/ação/pergunta, logo abaixo da pergunta. */
function PainelResultado({ r, onFechar }) {
  return html`<section aria-live="polite" class=${cn("space-y-4 rounded-[1.6rem] border bg-white p-5 md:p-7", r.ok ? "border-emerald-200" : "border-rose-200")}>
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class=${cn("text-[13.5px] font-black uppercase tracking-widest", r.ok ? "text-emerald-700" : "text-rose-700")}>${r.ok ? "Resposta da Hotmart" : "Não foi possível concluir"}</p>
        <p class="mt-1 line-clamp-2 text-sm font-black text-slate-800">${r.titulo}</p>
      </div>
      <button type="button" onClick=${onFechar} aria-label="Fechar resultado" class="rounded-xl p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-900"><${Icone} nome="x" class="h-4 w-4" /></button>
    </div>
    ${!r.ok ? html`<p role="alert" class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800">${r.error || "Erro desconhecido."}</p>` : null}
    ${r.resposta ? html`<div class="space-y-2 rounded-2xl border border-slate-100 bg-[#f8faf9] p-4 text-sm leading-relaxed text-slate-700" dangerouslySetInnerHTML=${{ __html: markdownSimples(r.resposta) }}></div>` : null}
    ${r.dados && Array.isArray(r.dados.colunas) && Array.isArray(r.dados.linhas) && r.dados.linhas.length ? html`<${TabelaDados} dados=${r.dados} nome=${r.titulo} />` : null}
  </section>`;
}

function ItemHistorico({ p, aberto, onAlternar }) {
  const [rot, tom] = STATUS[p.status] || [p.status, "neutro"];
  const titulo = p.tipo === "pergunta" ? p.pergunta : p.rotulo || p.acao || "Consulta";
  const tipoTxt = { pergunta: "Pergunta", consulta: "Consulta", acao: "Ação", sync: "Sincronização" }[p.tipo] || p.tipo;
  const temDetalhe = !!(p.resposta || p.resposta_dados || p.erro);
  return html`<li class="px-4 py-4 md:px-7">
    <div class="flex items-start justify-between gap-3">
      <button type="button" onClick=${onAlternar} disabled=${!temDetalhe} aria-expanded=${aberto} class="min-w-0 flex-1 text-left">
        <div class="flex flex-wrap items-center gap-2">
          <span class=${cn("text-[13.5px] font-black uppercase tracking-widest", p.tipo === "acao" ? "text-rose-700" : "text-slate-400")}>${tipoTxt}</span>
          <${Pill} tom=${tom} class="!px-2 !py-0.5">${rot}<//>
        </div>
        <p class=${cn("mt-1 text-sm font-black text-slate-800", !aberto && "line-clamp-2")}>${titulo}</p>
        ${resumoParametros(p.parametros) ? html`<p class="mt-1 text-xs font-semibold text-slate-500">${resumoParametros(p.parametros)}</p>` : null}
        <p class="mt-1 text-xs font-medium text-slate-400">${p.criado_por_nome || "Equipe"} · ${dataHoraBR(p.created_at)}</p>
      </button>
      ${temDetalhe ? html`<button type="button" onClick=${onAlternar} aria-label=${aberto ? "Recolher" : "Expandir"} class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:text-slate-700">
        <${Icone} nome=${aberto ? "chevron-down" : "chevron-right"} class="h-4 w-4" /></button>` : null}
    </div>
    ${aberto ? html`<div class="mt-4 space-y-4">
      ${p.status === "erro" ? html`<p role="alert" class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800">${p.erro || "Não foi possível concluir."}</p>` : null}
      ${p.resposta ? html`<div class="space-y-2 rounded-2xl border border-slate-100 bg-[#f8faf9] p-4 text-sm leading-relaxed text-slate-700" dangerouslySetInnerHTML=${{ __html: markdownSimples(p.resposta) }}></div>` : null}
      ${p.resposta_dados && Array.isArray(p.resposta_dados.colunas) && Array.isArray(p.resposta_dados.linhas) ? html`<${TabelaDados} dados=${p.resposta_dados} nome=${titulo} />` : null}
    </div>` : null}
  </li>`;
}

function TabelaDados({ dados, nome }) {
  const { colunas, linhas } = dados;
  const celula = (v) => (v == null ? "" : typeof v === "number" ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : typeof v === "object" ? JSON.stringify(v) : String(v));
  const arquivo = "Hotmart_" + String(nome || "dados").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40);
  return html`<div class="overflow-hidden rounded-2xl border border-slate-200">
    <div class="flex items-center justify-between gap-2 border-b border-slate-100 bg-white px-4 py-2">
      <span class="text-xs font-bold text-slate-400">${linhas.length} linha${linhas.length === 1 ? "" : "s"}</span>
      <button type="button" onClick=${() => baixarCsv(arquivo, colunas, linhas)} disabled=${!linhas.length}
        class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-emerald-200 disabled:opacity-40"><${Icone} nome="download" class="h-3.5 w-3.5" />Exportar CSV</button>
    </div>
    <div class="max-h-[32rem] overflow-auto"><table class="w-full text-left text-xs">
      <thead class="sticky top-0"><tr class="bg-[#f5f8f6] font-bold text-slate-600">${colunas.map((c) => html`<th scope="col" class="whitespace-nowrap px-4 py-3">${c}</th>`)}</tr></thead>
      <tbody>${linhas.map((l, i) => html`<tr key=${i} class="border-t border-slate-100 font-semibold text-slate-700 hover:bg-[#f8faf9]">
        ${colunas.map((_, j) => html`<td class=${cn("px-4 py-2.5", typeof l[j] === "number" && "whitespace-nowrap text-right tabular-nums")}>${celula(l[j])}</td>`)}</tr>`)}</tbody>
    </table></div>
  </div>`;
}

function ModalPedido({ item, subdominio, onClose, onEnviar }) {
  const ehAcao = item.tipo === "acao";
  const [v, setV] = useState(() => Object.fromEntries(item.campos.map((c) => [c.k, c.tipo === "checkbox" ? !!c.padrao : c.subdominio ? (subdominio || "") : ""])));
  const [confirmo, setConfirmo] = useState(false);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { const on = (e) => e.key === "Escape" && !enviando && onClose(); addEventListener("keydown", on); return () => removeEventListener("keydown", on); }, [enviando]);

  async function enviar(e) {
    e.preventDefault();
    if (enviando) return;
    const r = montarParametros(item.campos, v);
    if (r.erro) return setErro(r.erro);
    if (ehAcao && !confirmo) return setErro("Marque a confirmação para executar esta ação.");
    setEnviando(true); setErro("");
    try {
      const res = await onEnviar(item, r.parametros);
      if (res && !res.ok && !res.semCredenciais) { setErro(res.error || "Não foi possível concluir."); setEnviando(false); setConfirmo(false); }
    } catch (err) { setErro(os.errMsg(err)); setEnviando(false); setConfirmo(false); }
  }
  const rot = "mb-2 block text-[14.5px] font-black uppercase tracking-widest text-slate-500";
  return html`<div class="fin-page fixed inset-0 z-[100] flex items-center justify-center p-4" style="padding:1rem">
    <div class="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick=${() => !enviando && onClose()}></div>
    <form onSubmit=${enviar} role="dialog" aria-modal="true" aria-label=${item.rotulo}
      class="relative max-h-[92vh] w-full max-w-[560px] overflow-y-auto rounded-[2.5rem] border border-white/20 bg-white p-8 shadow-[0_32px_80px_-20px_rgba(0,0,0,0.15)]"
      style=${`border-top:4px solid ${ehAcao ? "#f43f5e" : "#10b981"}`}>
      <button type="button" onClick=${onClose} disabled=${enviando} aria-label="Fechar" class="absolute right-6 top-6 rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-900"><${Icone} nome="x" class="h-5 w-5" /></button>
      <p class=${cn("text-[16px] font-black uppercase tracking-[0.2em]", ehAcao ? "text-rose-700" : "text-emerald-700")}>${ehAcao ? "Ação na Hotmart" : "Consulta"}</p>
      <h3 class="mt-2 pr-8 text-xl font-black tracking-tight text-slate-900">${item.rotulo}</h3>
      ${ehAcao ? html`<p class="mt-2 text-sm font-medium text-slate-500">Esta ação altera dados reais na Hotmart na hora e não pode ser desfeita por aqui.</p>`
        : !item.campos.length ? html`<p class="mt-2 text-sm font-medium text-slate-500">Esta consulta não precisa de parâmetros.</p>` : null}
      <div class="mt-6 grid gap-4">
        ${item.campos.map((c) => c.tipo === "checkbox"
          ? html`<label key=${c.k} class="flex cursor-pointer items-center gap-3 text-sm font-bold text-slate-700">
              <input type="checkbox" checked=${!!v[c.k]} onChange=${(e) => setV((o) => ({ ...o, [c.k]: e.target.checked }))} class="h-4 w-4 accent-emerald-500" />${c.rotulo}</label>`
          : html`<label key=${c.k}><span class=${rot}>${c.rotulo}${c.obrig ? " *" : ""}</span>
              ${c.tipo === "select"
                ? html`<select value=${v[c.k]} onChange=${(e) => setV((o) => ({ ...o, [c.k]: e.target.value }))} class="filter-select h-12 py-0">${c.opcoes.map(([val, r]) => html`<option value=${val}>${r}</option>`)}</select>`
                : html`<input type=${c.tipo === "date" ? "date" : c.tipo === "email" ? "email" : c.tipo === "int" ? "number" : "text"} value=${v[c.k]}
                    min=${c.min} max=${c.max} maxLength=${c.maxLen} inputMode=${c.tipo === "int" ? "numeric" : c.tipo === "decimal" ? "decimal" : undefined}
                    onInput=${(e) => setV((o) => ({ ...o, [c.k]: e.target.value }))} class="filter-select h-12 py-0" />`}
              ${c.dica ? html`<span class="mt-1.5 block text-xs font-medium text-slate-400">${c.dica}</span>` : null}</label>`)}
      </div>
      ${ehAcao ? html`<label class="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-900">
        <input type="checkbox" checked=${confirmo} onChange=${(e) => setConfirmo(e.target.checked)} class="mt-0.5 h-4 w-4 accent-rose-600" />
        Confirmo que quero executar esta ação na Hotmart</label>` : null}
      ${erro ? html`<p role="alert" class="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800">${erro}</p>` : null}
      <div class="mt-6 flex w-full gap-3">
        <button type="button" onClick=${onClose} disabled=${enviando} class="flex-1 rounded-2xl border border-slate-100 bg-slate-50 py-4 text-[17px] font-black uppercase tracking-widest text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900">Cancelar</button>
        ${ehAcao ? html`<button type="submit" disabled=${!confirmo || enviando}
            class="flex-1 rounded-2xl bg-rose-600 py-4 text-[17px] font-black uppercase tracking-widest text-white shadow-lg shadow-rose-600/20 transition-all hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40">${enviando ? "Executando..." : "Executar"}</button>`
          : html`<button type="submit" disabled=${enviando} class="premium-button-primary flex-1 py-4 text-[17px] uppercase tracking-widest disabled:opacity-50">${enviando ? "Consultando..." : "Consultar"}</button>`}
      </div>
    </form>
  </div>`;
}

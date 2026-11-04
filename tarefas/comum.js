// Gestão de Tarefas — base compartilhada pelas telas (#/tarefas/*). Plano: docs/tarefas-spec.md.
// Sem import de app.js (circular): o app injeta sb, notify, Modal, DESFAZER etc. por configurarTarefas().
// A barreira real é o RLS (scripts/migrations/20261104_tarefas_base.sql): aqui só escondemos botões
// que o banco recusaria (quem não está envolvido na tarefa vê, comenta e pode "Seguir", mas não altera).
import { html } from "htm/preact";
import { useState, useEffect, useCallback, useMemo, useRef } from "preact/hooks";

/* ============================ Dependências do app ============================ */
// sb, notify, errMsg, ehAdmin, Modal, Btn, cx, inputCls, Markdown,
// registrarDesfazer, useAoDesfazer, desfazerCriacao, desfazerEdicao, desfazerExclusao.
export const os = {};
export function configurarTarefas(deps) { Object.assign(os, deps); }

/** Um único escopo de DESFAZER para a aba toda (escopoDesfazer em app.js devolve "tarefas"). */
export const ESCOPO = "tarefas";

/* ============================ Datas ============================ */
export function isoDia(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function hoje() { return isoDia(new Date()); }
export function somaDias(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDia(new Date(y, m - 1, d + n));
}
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function fmtDia(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const anoAtual = new Date().getFullYear();
  return `${d} ${MESES_CURTOS[m - 1]}` + (y !== anoAtual ? ` ${y}` : "");
}
/** Prazo amigável + tom: "Hoje", "Amanhã", "Atrasada há 3 dias", "12 nov". */
export function infoPrazo(t) {
  if (!t.prazo) return null;
  if (t.concluida_em) return { texto: fmtDia(t.prazo), tom: "neutro" };
  const h = hoje();
  if (t.prazo < h) {
    const local = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
    const dias = Math.round((local(h) - local(t.prazo)) / 86400000);
    return { texto: dias === 1 ? "Atrasada (ontem)" : `Atrasada há ${dias} dias`, tom: "atraso" };
  }
  if (t.prazo === h) return { texto: "Hoje", tom: "hoje" };
  if (t.prazo === somaDias(h, 1)) return { texto: "Amanhã", tom: "breve" };
  return { texto: fmtDia(t.prazo), tom: t.prazo <= somaDias(h, 7) ? "breve" : "neutro" };
}
export function fmtQuando(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) + " às " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/* ============================ Constantes visuais ============================ */
export const PRIORIDADES = {
  urgente: { rotulo: "Urgente", cls: "bg-rose-50 text-rose-700 ring-rose-200", ponto: "#e11d48", peso: 0 },
  alta: { rotulo: "Alta", cls: "bg-amber-50 text-amber-800 ring-amber-200", ponto: "#f59e0b", peso: 1 },
  normal: { rotulo: "Normal", cls: "bg-slate-100 text-slate-600 ring-slate-200", ponto: "#94a3b8", peso: 2 },
  baixa: { rotulo: "Baixa", cls: "bg-sky-50 text-sky-700 ring-sky-200", ponto: "#38bdf8", peso: 3 },
};
const TOM_PRAZO = {
  atraso: "text-rose-700 bg-rose-50 ring-rose-200",
  hoje: "text-amber-800 bg-amber-50 ring-amber-200",
  breve: "text-emerald-800 bg-emerald-50 ring-emerald-100",
  neutro: "text-slate-600 bg-slate-100 ring-slate-200",
};
export const CORES = ["#07110e", "#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#0ea5e9", "#e11d48", "#64748b"];

/* ============================ Dados ============================ */
export async function fetchBase() {
  const sb = os.sb;
  const [setores, membros, projetos, status, pessoas] = await Promise.all([
    sb.from("tarefas_setores").select("*").order("ordem").order("nome"),
    sb.from("tarefas_setor_membros").select("*"),
    sb.from("tarefas_projetos").select("*").order("ordem").order("nome"),
    sb.from("tarefas_status").select("*").order("ordem").order("created_at"),
    sb.rpc("tarefas_pessoas"),
  ]);
  for (const r of [setores, membros, projetos, status, pessoas]) if (r.error) throw r.error;
  return { setores: setores.data || [], membros: membros.data || [], projetos: projetos.data || [],
    status: status.data || [], pessoas: pessoas.data || [] };
}

/** Base da aba (setores, projetos, status, pessoas) + derivados para a pessoa logada. */
export function useBase(me) {
  const [base, setBase] = useState(null);
  const [erro, setErro] = useState(null);
  const carregar = useCallback(async () => {
    try { setBase(await fetchBase()); setErro(null); }
    catch (e) { setErro(os.errMsg(e)); os.notify(os.errMsg(e), "err"); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const derivado = useMemo(() => {
    if (!base) return null;
    const adm = os.ehAdmin(me);
    const minhasLinhas = base.membros.filter((m) => m.user_id === me.id);
    const meusSetores = adm ? base.setores.filter((s) => s.ativo)
      : base.setores.filter((s) => s.ativo && minhasLinhas.some((m) => m.setor_id === s.id));
    const gestorDe = (setorId) => adm || minhasLinhas.some((m) => m.setor_id === setorId && m.papel === "gestor");
    const pessoa = (id) => base.pessoas.find((p) => p.id === id) || null;
    const projeto = (id) => base.projetos.find((p) => p.id === id) || null;
    const setor = (id) => base.setores.find((s) => s.id === id) || null;
    const statusDe = (projetoId) => base.status.filter((s) => s.projeto_id === projetoId).sort((a, b) => a.ordem - b.ordem);
    const status = (id) => base.status.find((s) => s.id === id) || null;
    return { ...base, adm, meusSetores, gestorDe, pessoa, projeto, setor, statusDe, status };
  }, [base, me]);
  return { base: derivado, erro, recarregar: carregar };
}

const COLS_TAREFA = "*";
export async function fetchTarefas({ setorId, projetoId, incluirConcluidas = true } = {}) {
  let q = os.sb.from("tarefas").select(COLS_TAREFA).is("excluida_em", null).is("parent_id", null);
  if (setorId) q = q.eq("setor_id", setorId);
  if (projetoId) q = q.eq("projeto_id", projetoId);
  if (!incluirConcluidas) q = q.is("concluida_em", null);
  const { data, error } = await q.order("ordem").order("created_at").limit(2000);
  if (error) throw error;
  return data || [];
}
/** Tarefas (e subtarefas) em que a pessoa é responsável ou participante. */
export async function fetchMinhas(meId) {
  const sb = os.sb;
  const { data: parts, error: e1 } = await sb.from("tarefas_participantes").select("tarefa_id").eq("user_id", meId);
  if (e1) throw e1;
  const ids = (parts || []).map((p) => p.tarefa_id);
  let q = sb.from("tarefas").select(COLS_TAREFA).is("excluida_em", null);
  q = ids.length ? q.or(`responsavel_id.eq.${meId},id.in.(${ids.join(",")})`) : q.eq("responsavel_id", meId);
  const { data, error } = await q.order("prazo", { ascending: true, nullsFirst: false }).limit(1000);
  if (error) throw error;
  // Subtarefa de tarefa excluída (exclusão lógica marca só a mãe) sai da lista.
  const maes = [...new Set((data || []).filter((t) => t.parent_id).map((t) => t.parent_id))];
  if (maes.length) {
    const { data: exc, error: e2 } = await sb.from("tarefas").select("id").in("id", maes).not("excluida_em", "is", null);
    if (e2) throw e2;
    const fora = new Set((exc || []).map((x) => x.id));
    return data.filter((t) => !fora.has(t.parent_id));
  }
  return data || [];
}
/** Quantas subtarefas/checklist cada tarefa tem (para os cartões). */
export async function fetchContagens(ids) {
  if (!ids.length) return {};
  const sb = os.sb, out = {};
  const lotes = [];
  for (let i = 0; i < ids.length; i += 150) lotes.push(ids.slice(i, i + 150));
  for (const l of lotes) {
    const [subs, chk, com] = await Promise.all([
      sb.from("tarefas").select("parent_id,concluida_em").in("parent_id", l).is("excluida_em", null),
      sb.from("tarefas_checklist").select("tarefa_id,feito").in("tarefa_id", l),
      sb.from("tarefas_comentarios").select("tarefa_id").in("tarefa_id", l),
    ]);
    for (const r of [subs, chk, com]) if (r.error) throw r.error;
    const c = (id) => (out[id] = out[id] || { sub: 0, subOk: 0, chk: 0, chkOk: 0, com: 0 });
    for (const s of subs.data || []) { const o = c(s.parent_id); o.sub++; if (s.concluida_em) o.subOk++; }
    for (const s of chk.data || []) { const o = c(s.tarefa_id); o.chk++; if (s.feito) o.chkOk++; }
    for (const s of com.data || []) c(s.tarefa_id).com++;
  }
  return out;
}

/* ============================ Escrita (com DESFAZER) ============================ */
export async function criarTarefa(dados, { rotulo = "criar tarefa", toast = true } = {}) {
  const { data, error } = await os.sb.from("tarefas").insert(dados).select("*").single();
  if (error) throw error;
  os.registrarDesfazer(ESCOPO, rotulo + ` "${data.titulo}"`, os.desfazerCriacao("tarefas", data, rotulo),
    { toast, mensagem: "Tarefa criada" });
  return data;
}
/** antes = linha completa (select "*"). Devolve a linha nova. */
export async function atualizarTarefa(antes, patch, { rotulo = "alterar tarefa", toast = true, mensagem } = {}) {
  const { data, error } = await os.sb.from("tarefas").update(patch).eq("id", antes.id).select("*");
  if (error) throw error;
  if (!data || !data.length) throw new Error("Só quem está envolvido na tarefa pode alterá-la. Use Seguir para participar.");
  const depois = data[0];
  os.registrarDesfazer(ESCOPO, `${rotulo} "${antes.titulo}"`, os.desfazerEdicao("tarefas", antes, depois, rotulo),
    { toast, mensagem });
  return depois;
}
/** Concluir/reabrir: usa o 1º status "concluido" (ou o 1º "aberto") do projeto. */
export function statusParaConcluir(base, t, concluir) {
  const lista = base.statusDe(t.projeto_id);
  if (concluir && !lista.some((s) => s.tipo === "concluido")) throw new Error("Este projeto não tem coluna que conclui a tarefa (Configurações > Status).");
  const alvo = lista.find((s) => s.tipo === (concluir ? "concluido" : "aberto")) || lista[0];
  return alvo ? alvo.id : null;
}
export async function alternarConclusao(base, t) {
  const concluir = !t.concluida_em;
  return atualizarTarefa(t, { status_id: statusParaConcluir(base, t, concluir) },
    { rotulo: concluir ? "concluir" : "reabrir", mensagem: concluir ? "Tarefa concluída" : "Tarefa reaberta" });
}
/** Gravação genérica em tabela-filha com DESFAZER. */
export async function inserirFilha(tabela, dados, rotulo, toast = false) {
  const { data, error } = await os.sb.from(tabela).insert(dados).select("*").single();
  if (error) throw error;
  os.registrarDesfazer(ESCOPO, rotulo, os.desfazerCriacao(tabela, data, rotulo), { toast });
  return data;
}
export async function editarFilha(tabela, antes, patch, rotulo, toast = false) {
  const { data, error } = await os.sb.from(tabela).update(patch).eq("id", antes.id).select("*");
  if (error) throw error;
  if (!data || !data.length) throw new Error("Sem permissão para alterar este item.");
  os.registrarDesfazer(ESCOPO, rotulo, os.desfazerEdicao(tabela, antes, data[0], rotulo), { toast });
  return data[0];
}
export async function excluirFilha(tabela, antes, rotulo, toast = true) {
  const { data, error } = await os.sb.from(tabela).delete().eq("id", antes.id).select("id");
  if (error) throw error;
  if (!data || !data.length) throw new Error("Sem permissão para excluir este item.");
  os.registrarDesfazer(ESCOPO, rotulo, os.desfazerExclusao(tabela, antes, rotulo), { toast, mensagem: "Excluído" });
}

/** A pessoa pode alterar a tarefa? (o banco confere de novo). participantes = lista de user_id. */
export function podeEditar(me, base, t, participantes = [], mae = null, participantesMae = []) {
  if (!t) return false;
  if (base.adm) return true;
  const env = (x, parts) => x && (x.criado_por === me.id || x.responsavel_id === me.id || parts.includes(me.id));
  return !!(env(t, participantes) || env(mae, participantesMae));
}

/* ============================ Componentes ============================ */
export function Avatar({ pessoa, tamanho = "h-7 w-7", titulo }) {
  const nome = pessoa ? pessoa.nome || pessoa.email : "";
  if (!pessoa) return html`<span class=${os.cx("grid shrink-0 place-items-center rounded-full border border-dashed border-slate-300 text-[10px] font-black text-slate-400", tamanho)} title=${titulo || "Sem responsável"}>?</span>`;
  const p = nome.trim().split(/\s+/);
  const ini = ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase();
  return html`<span class=${os.cx("grid shrink-0 place-items-center rounded-full bg-[#07110e] text-[10px] font-black text-emerald-400 ring-2 ring-white", tamanho)} title=${titulo || nome}>${ini}</span>`;
}

export function PillPrioridade({ p }) {
  const x = PRIORIDADES[p] || PRIORIDADES.normal;
  return html`<span class=${os.cx("inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset", x.cls)}>
    <span class="h-1.5 w-1.5 rounded-full" style=${`background:${x.ponto}`}></span>${x.rotulo}</span>`;
}
export function PillPrazo({ t }) {
  const i = infoPrazo(t);
  if (!i) return null;
  return html`<span class=${os.cx("inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset", TOM_PRAZO[i.tom])}>
    <${Icone} nome="calendario" class="h-3 w-3" />${i.texto}</span>`;
}
export function PillStatus({ status }) {
  if (!status) return null;
  return html`<span class="inline-flex items-center gap-1.5 rounded-lg bg-white px-2 py-0.5 text-[11px] font-bold text-slate-700 ring-1 ring-inset ring-slate-200">
    <span class="h-2 w-2 rounded-full" style=${`background:${status.cor}`}></span>${status.nome}</span>`;
}

const ICONES = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  calendario: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  mais: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  lista: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  quadro: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  pessoa: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  engrenagem: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  comentario: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  subtarefa: '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>',
  checklist: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  olho: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  lixo: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  cadeado: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  busca: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  caixa: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
};
export function Icone({ nome, class: cls = "h-4 w-4" }) {
  return html`<svg class=${cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICONES[nome] || "" }}></svg>`;
}

/** Bolinha de concluir (estilo Asana). */
export function BotaoConcluir({ t, desabilitado, onClick, tamanho = "h-5 w-5" }) {
  const feito = !!t.concluida_em;
  return html`<button type="button" disabled=${desabilitado}
    title=${desabilitado ? "Só quem está envolvido pode concluir" : feito ? "Reabrir" : "Concluir"}
    onClick=${(e) => { e.stopPropagation(); onClick && onClick(); }}
    class=${os.cx("grid shrink-0 place-items-center rounded-full border-2 transition disabled:cursor-not-allowed", tamanho,
      feito ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500")}>
    <${Icone} nome="check" class="h-3 w-3" /></button>`;
}

/** Seletor de pessoa (select simples, acessível). */
export function SelectPessoa({ pessoas, valor, onChange, vazio = "Sem responsável", disabled, class: cls }) {
  return html`<select class=${os.cx(os.inputCls, cls)} value=${valor || ""} disabled=${disabled}
    onChange=${(e) => onChange(e.target.value || null)}>
    <option value="">${vazio}</option>
    ${pessoas.map((p) => html`<option key=${p.id} value=${p.id}>${p.nome}</option>`)}
  </select>`;
}

/** Abas segmentadas do topo da Gestão de Tarefas. */
export function AbasTarefas({ tela, base }) {
  const abas = [
    ["minhas", "Minhas tarefas", "caixa"],
    ["quadro", "Quadro", "quadro"],
    ["lista", "Lista", "lista"],
  ];
  if (base && (base.adm || base.meusSetores.some((s) => base.gestorDe(s.id)))) abas.push(["configuracoes", "Configurações", "engrenagem"]);
  return html`<div class="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
    ${abas.map(([slug, nome, ic]) => html`<a key=${slug} href=${"#/tarefas/" + slug}
      class=${os.cx("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-bold transition",
        tela === slug ? "bg-[#07110e] text-white shadow-sm" : "text-slate-600 hover:text-slate-900")}>
      <${Icone} nome=${ic} class="h-3.5 w-3.5" />${nome}</a>`)}
  </div>`;
}

export function Cabecalho({ titulo, descricao, children }) {
  return html`<div class="mb-5 flex flex-wrap items-end justify-between gap-4">
    <div>
      <p class="os-eyebrow">Gestão de Tarefas</p>
      <h1 class="os-titulo mt-1 text-2xl text-[#07110e] md:text-3xl">${titulo}</h1>
      ${descricao ? html`<p class="mt-1 max-w-2xl text-sm font-medium text-slate-500">${descricao}</p>` : null}
    </div>
    <div class="flex flex-wrap items-center gap-2">${children}</div>
  </div>`;
}

export function SemSetor({ me }) {
  return html`<div class="rounded-[1.6rem] border border-dashed border-slate-200 bg-white/80 px-6 py-12 text-center">
    <div class="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><${Icone} nome="pessoa" class="h-5 w-5" /></div>
    <div class="mt-4 font-black tracking-tight text-[#07110e]">Você ainda não está em nenhum setor</div>
    <div class="mx-auto mt-1 max-w-md text-sm font-medium text-slate-500">
      Peça ao ADM para incluir ${me.nome || me.email} no seu setor em Gestão de Tarefas → Configurações.
      Enquanto isso, as tarefas atribuídas a você aparecem em Minhas tarefas.</div>
  </div>`;
}

/* ============================ Setor / projeto escolhidos (Quadro e Lista) ============================ */
function lerLocal(k) { try { return localStorage.getItem(k); } catch { return null; } }
function gravarLocal(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* sem storage */ } }

/** Setor/projeto da URL (?setor=&projeto=) ou o último usado. projeto "" = todos os projetos do setor. */
export function useEscopo(base, query, tela, { exigeProjeto = false } = {}) {
  const setores = base.meusSetores;
  let setorId = query.setor || lerLocal("os.tarefas.setor") || "";
  if (!setores.some((s) => s.id === setorId)) setorId = setores[0] ? setores[0].id : "";
  const projetos = base.projetos.filter((p) => p.setor_id === setorId && !p.arquivado);
  let projetoId = query.projeto !== undefined ? query.projeto : (lerLocal("os.tarefas.projeto") || "");
  if (projetoId && !projetos.some((p) => p.id === projetoId)) projetoId = "";
  if (exigeProjeto && !projetoId && projetos[0]) projetoId = projetos[0].id;
  useEffect(() => { gravarLocal("os.tarefas.setor", setorId); gravarLocal("os.tarefas.projeto", projetoId); }, [setorId, projetoId]);
  const ir = (s, p) => { location.hash = `#/tarefas/${tela}?setor=${s || ""}&projeto=${p || ""}`; };
  return { setorId, projetoId, projetos, ir };
}

export function SeletorEscopo({ base, escopo, todosProjetos = true }) {
  const { setorId, projetoId, projetos, ir } = escopo;
  return html`<div class="flex flex-wrap items-center gap-2">
    <div class="flex flex-wrap gap-1">
      ${base.meusSetores.map((s) => html`<button key=${s.id} type="button" onClick=${() => ir(s.id, "")}
        class=${os.cx("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold ring-1 ring-inset transition",
          s.id === setorId ? "bg-[#07110e] text-white ring-[#07110e]" : "bg-white text-slate-600 ring-slate-200 hover:text-slate-900")}>
        <span class="h-2 w-2 rounded-full" style=${`background:${s.cor}`}></span>${s.nome}</button>`)}
    </div>
    ${projetos.length ? html`<select class=${os.inputCls + " !w-auto !py-1.5"} value=${projetoId} onChange=${(e) => ir(setorId, e.target.value)}>
      ${todosProjetos ? html`<option value="">Todos os projetos</option>` : null}
      ${projetos.map((p) => html`<option key=${p.id} value=${p.id}>${p.nome}</option>`)}
    </select>` : null}
  </div>`;
}

/* ============================ Nova tarefa (modal) ============================ */
export function NovaTarefaModal({ me, base, padrao = {}, onClose, onCriada }) {
  const projetosPossiveis = base.projetos.filter((p) => !p.arquivado && base.meusSetores.some((s) => s.id === p.setor_id));
  const [f, setF] = useState({
    titulo: "", projeto_id: padrao.projeto_id || (projetosPossiveis[0] && projetosPossiveis[0].id) || "",
    responsavel_id: padrao.responsavel_id === undefined ? me.id : padrao.responsavel_id,
    prazo: padrao.prazo || "", prioridade: "normal", status_id: padrao.status_id || null, descricao_md: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e && e.target ? e.target.value : e }));
  const ref = useRef(null);
  useEffect(() => { ref.current && ref.current.focus(); }, []);
  const salvar = async (e) => {
    e.preventDefault();
    if (!f.titulo.trim() || !f.projeto_id) return;
    setBusy(true);
    try {
      const t = await criarTarefa({
        titulo: f.titulo.trim(), projeto_id: f.projeto_id, responsavel_id: f.responsavel_id || null,
        prazo: f.prazo || null, prioridade: f.prioridade, status_id: f.status_id || null,
        descricao_md: f.descricao_md.trim() || null, ordem: Date.now(),
      });
      onCriada && onCriada(t);
      onClose();
    } catch (err) { os.notify(os.errMsg(err), "err"); }
    finally { setBusy(false); }
  };
  if (!projetosPossiveis.length) {
    return html`<${os.Modal} title="Nova tarefa" onClose=${onClose}>
      <p class="text-sm font-medium text-slate-600">Ainda não há projeto nos seus setores. Um gestor do setor (ou o ADM) cria o primeiro projeto em Configurações.</p>
    <//>`;
  }
  return html`<${os.Modal} title="Nova tarefa" onClose=${onClose} wide>
    <form onSubmit=${salvar} class="space-y-4">
      <input ref=${ref} class=${os.inputCls + " text-base"} placeholder="O que precisa ser feito?" value=${f.titulo} onInput=${set("titulo")} maxlength="300" required />
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block"><span class="mb-1 block text-[12px] font-bold text-slate-600">Projeto</span>
          <select class=${os.inputCls} value=${f.projeto_id} onChange=${(e) => setF((x) => ({ ...x, projeto_id: e.target.value, status_id: null }))}>
            ${base.meusSetores.map((s) => {
              const ps = projetosPossiveis.filter((p) => p.setor_id === s.id);
              return ps.length ? html`<optgroup key=${s.id} label=${s.nome}>${ps.map((p) => html`<option key=${p.id} value=${p.id}>${p.nome}</option>`)}</optgroup>` : null;
            })}
          </select></label>
        <label class="block"><span class="mb-1 block text-[12px] font-bold text-slate-600">Responsável</span>
          <${SelectPessoa} pessoas=${base.pessoas} valor=${f.responsavel_id} onChange=${set("responsavel_id")} /></label>
        <label class="block"><span class="mb-1 block text-[12px] font-bold text-slate-600">Prazo</span>
          <input type="date" class=${os.inputCls} value=${f.prazo} onInput=${set("prazo")} /></label>
        <label class="block"><span class="mb-1 block text-[12px] font-bold text-slate-600">Prioridade</span>
          <select class=${os.inputCls} value=${f.prioridade} onChange=${set("prioridade")}>
            ${Object.entries(PRIORIDADES).map(([k, v]) => html`<option key=${k} value=${k}>${v.rotulo}</option>`)}
          </select></label>
      </div>
      <label class="block"><span class="mb-1 block text-[12px] font-bold text-slate-600">Descrição (opcional, aceita Markdown)</span>
        <textarea class=${os.inputCls} rows="3" value=${f.descricao_md} onInput=${set("descricao_md")}></textarea></label>
      <div class="flex justify-end gap-2">
        <${os.Btn} variant="ghost" type="button" onClick=${onClose}>Cancelar<//>
        <${os.Btn} type="submit" loading=${busy} disabled=${!f.titulo.trim()}>Criar tarefa<//>
      </div>
    </form>
  <//>`;
}

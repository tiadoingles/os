// Gestão de Tarefas — ponto de entrada importado por app.js (#/tarefas/<tela>) e peças usadas fora da aba
// (sino de avisos e "+ Tarefa" no topo, cartão da Início, bloco da Ficha do Mentorado).
// Novos arquivos .js nesta pasta precisam de uma linha no importmap do index.html (mesmo ?v=N).
import { html } from "htm/preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import {
  os, useBase, ESCOPO, hoje, fetchMinhas, contarAvisosNaoLidos, NovaTarefaModal, Icone, PillPrazo, Avatar,
} from "./comum.js";
import { MinhasPage } from "./minhas.js";
import { AvisosPage } from "./avisos.js";
import { QuadroPage } from "./quadro.js";
import { ListaPage } from "./lista.js";
import { CalendarioPage } from "./calendario.js";
import { PainelPage } from "./painel.js";
import { LixeiraPage } from "./lixeira.js";
import { HistoricoPage } from "./historico.js";
import { ConfiguracoesPage } from "./configuracoes.js";
import { DetalheTarefa } from "./detalhe.js";
export { configurarTarefas } from "./comum.js";

// Mantenha igual a TELAS_TAREFAS no bloco <permissoes> do app.js.
export const TELAS_TAR = {
  minhas: MinhasPage, avisos: AvisosPage, quadro: QuadroPage, lista: ListaPage, calendario: CalendarioPage,
  painel: PainelPage, historico: HistoricoPage, lixeira: LixeiraPage, configuracoes: ConfiguracoesPage,
};

export function TarefasPage({ me, tela, query }) {
  const Tela = Object.hasOwn(TELAS_TAR, tela || "") ? TELAS_TAR[tela] : null;
  useEffect(() => { if (!Tela) location.replace("#/tarefas/minhas"); }, [Tela]);
  const { base, erro, recarregar } = useBase(me);
  os.useAoDesfazer(ESCOPO, recarregar);
  if (!Tela) return null;
  if (erro && !base) return html`<div class="rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700 ring-1 ring-rose-200">Não foi possível carregar a Gestão de Tarefas: ${erro}</div>`;
  if (!base) return html`<div class="py-16 text-center text-sm font-semibold text-slate-500"><span class="spinner mr-2"></span>Carregando…</div>`;
  return html`<${Tela} me=${me} base=${base} query=${query || {}} recarregar=${recarregar} />`;
}

/* ============================ Topo do OS ============================ */
/** Sino com o número de avisos não lidos (confere a cada minuto, ao focar a aba e quando a aba Avisos muda algo). */
export function SinoTarefas() {
  const [n, setN] = useState(0);
  const atualizar = useCallback(() => { contarAvisosNaoLidos().then(setN).catch(() => {}); }, []);
  useEffect(() => {
    atualizar();
    const t = setInterval(atualizar, 60000);
    addEventListener("focus", atualizar);
    addEventListener("tarefas:avisos", atualizar);
    addEventListener("hashchange", atualizar);
    return () => { clearInterval(t); removeEventListener("focus", atualizar); removeEventListener("tarefas:avisos", atualizar); removeEventListener("hashchange", atualizar); };
  }, [atualizar]);
  const dica = n ? `${n} aviso${n > 1 ? "s" : ""} não lido${n > 1 ? "s" : ""}` : "Avisos das tarefas";
  return html`<a href="#/tarefas/avisos" title=${dica} aria-label=${dica}
    class="relative flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700">
    <${Icone} nome="sino" class="h-[18px] w-[18px]" />
    ${n ? html`<span class="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white ring-2 ring-white">${n > 99 ? "99+" : n}</span>` : null}
  </a>`;
}

/** Abre o "Nova tarefa" carregando a base só quando precisa (não pesa nas outras telas). */
function NovaTarefaComBase({ me, padrao, onClose, onCriada }) {
  const { base, erro } = useBase(me);
  useEffect(() => { if (erro) onClose(); }, [erro]);
  if (!base) return html`<${os.Modal} title="Nova tarefa" onClose=${onClose}><div class="py-6 text-center text-sm font-semibold text-slate-500"><span class="spinner mr-2"></span>Carregando…</div><//>`;
  return html`<${NovaTarefaModal} me=${me} base=${base} padrao=${padrao || {}} onClose=${onClose} onCriada=${onCriada} />`;
}

/** Botão "+ Tarefa" do topo de qualquer tela. */
export function BotaoNovaTarefa({ me }) {
  const [aberto, setAberto] = useState(false);
  return html`<button type="button" onClick=${() => setAberto(true)} title="Nova tarefa (de qualquer tela)" aria-label="Nova tarefa"
      class="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black tracking-wide text-slate-700 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700">
      <${Icone} nome="mais" class="h-3.5 w-3.5" /><span class="hidden sm:inline">Tarefa</span>
    </button>
    ${aberto ? html`<${NovaTarefaComBase} me=${me} onClose=${() => setAberto(false)}
      onCriada=${() => dispatchEvent(new CustomEvent("app:desfeito", { detail: { escopo: ESCOPO } }))} />` : null}`;
}

/* ============================ Início ============================ */
export function ResumoTarefasHome({ me }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    Promise.all([fetchMinhas(me.id), contarAvisosNaoLidos()]).then(([ts, avisos]) => {
      const h = hoje(), abertas = ts.filter((t) => !t.concluida_em);
      setD({ abertas: abertas.length, atrasadas: abertas.filter((t) => t.prazo && t.prazo < h).length,
        hoje: abertas.filter((t) => t.prazo === h).length, avisos });
    }).catch(() => setD(false));
  }, [me.id]);
  if (d === false) return null;
  return html`<a href="#/tarefas/minhas" class=${os.cx("mt-4 block rounded-[1.6rem] border p-5 shadow-card transition hover:border-emerald-200",
      d && d.atrasadas ? "border-[#fda4af] bg-[#fff1f2]" : "border-slate-200 bg-white")}>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="text-sm font-semibold uppercase tracking-wider text-muted">Minhas tarefas</div>
      <span class="text-xs font-medium text-emerald-700">Abrir a Gestão de Tarefas →</span>
    </div>
    ${!d ? html`<div class="mt-3 text-sm text-muted"><span class="spinner mr-2"></span>Carregando…</div>` : html`
      <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        ${[["Atrasadas", d.atrasadas, d.atrasadas ? "text-rose-700" : "text-ink"], ["Vencem hoje", d.hoje, "text-amber-700"],
           ["Em aberto", d.abertas, "text-ink"], ["Avisos não lidos", d.avisos, d.avisos ? "text-emerald-700" : "text-ink"]].map(([r, n, c]) => html`
          <div key=${r}><div class=${os.cx("text-2xl font-black", c)}>${n}</div><div class="text-xs text-muted">${r}</div></div>`)}
      </div>`}
  </a>`;
}

/* ============================ Ficha do Mentorado ============================ */
export function TarefasDoMentorado({ me, email }) {
  const [itens, setItens] = useState(null);
  const [nova, setNova] = useState(false);
  const [aberta, setAberta] = useState(null);
  const [base, setBase] = useState(null);
  const carregar = useCallback(async () => {
    const { data, error } = await os.sb.from("tarefas").select("*").eq("mentorado_email", String(email || "").trim().toLowerCase())
      .is("excluida_em", null).order("concluida_em", { ascending: false, nullsFirst: true }).order("prazo", { nullsFirst: false }).limit(200);
    if (error) { os.notify(os.errMsg(error), "err"); setItens([]); } else setItens(data || []);
  }, [email]);
  useEffect(() => { setItens(null); carregar(); }, [carregar]);
  os.useAoDesfazer(ESCOPO, carregar);
  const abertas = (itens || []).filter((t) => !t.concluida_em);
  const pessoa = (id) => (base && base.pessoa(id)) || null;
  return html`<div>
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
      <span class="text-sm text-muted">${itens === null ? "Carregando…" : `${abertas.length} em aberto · ${(itens || []).length - abertas.length} concluída(s)`}</span>
      <button type="button" class="text-sm font-medium text-emerald-700 hover:underline" onClick=${() => setNova(true)}>+ Nova tarefa para esta mentorada</button>
    </div>
    ${itens && itens.length ? html`<ul class="divide-y divide-slate-100 rounded-2xl border border-slate-200">
      ${itens.map((t) => html`<li key=${t.id}><button type="button" onClick=${() => setAberta(t.id)}
        class="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50">
        <span class=${os.cx("h-2.5 w-2.5 shrink-0 rounded-full", t.concluida_em ? "bg-emerald-500" : "bg-slate-300")}></span>
        <span class=${os.cx("min-w-0 flex-1 truncate text-sm font-semibold", t.concluida_em ? "text-slate-400 line-through" : "text-slate-800")}>${t.titulo}</span>
        <${PillPrazo} t=${t} />
        ${base ? html`<${Avatar} pessoa=${pessoa(t.responsavel_id)} tamanho="h-6 w-6" />` : null}
      </button></li>`)}
    </ul>` : itens ? html`<p class="text-sm text-muted">Nenhuma tarefa vinculada a esta mentorada.</p>` : null}
    ${nova ? html`<${NovaTarefaComBase} me=${me} padrao=${{ mentorado_email: email }} onClose=${() => setNova(false)} onCriada=${carregar} />` : null}
    ${aberta ? html`<${DetalheComBase} me=${me} tarefaId=${aberta} onAbrir=${setAberta} onClose=${() => setAberta(null)} onMudou=${carregar} onBase=${setBase} />` : null}
  </div>`;
}
function DetalheComBase({ me, onBase, ...props }) {
  const { base } = useBase(me);
  useEffect(() => { if (base && onBase) onBase(base); }, [base]);
  if (!base) return null;
  return html`<${DetalheTarefa} me=${me} base=${base} ...${props} />`;
}

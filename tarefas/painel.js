// Painel do setor (estilo Monday): carga por pessoa, atrasadas, entregas da semana e andamento dos projetos.
import { html } from "htm/preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import {
  os, ESCOPO, hoje, somaDias, fetchTarefas, Cabecalho, AbasTarefas, SemSetor, Avatar, PillPrazo, Icone, useEscopo, SeletorEscopo,
} from "./comum.js";
import { DetalheTarefa } from "./detalhe.js";

function Kpi({ rotulo, valor, sub, tom = "text-[#07110e]" }) {
  return html`<div class="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-3 shadow-card">
    <div class="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">${rotulo}</div>
    <div class=${os.cx("mt-1 text-2xl font-black tracking-tight", tom)}>${valor}</div>
    ${sub ? html`<div class="text-[12px] font-semibold text-slate-400">${sub}</div>` : null}
  </div>`;
}
function Bloco({ titulo, children }) {
  return html`<section class="rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-card">
    <h2 class="mb-3 text-[12px] font-black uppercase tracking-[0.14em] text-slate-500">${titulo}</h2>${children}</section>`;
}

export function PainelPage({ me, base, query }) {
  const escopo = useEscopo(base, query, "painel");
  const { setorId, projetoId } = escopo;
  const [tarefas, setTarefas] = useState(null);
  const [aberta, setAberta] = useState(null);
  const carregar = useCallback(async () => {
    if (!setorId) { setTarefas([]); return; }
    try { setTarefas(await fetchTarefas({ setorId, projetoId: projetoId || undefined, comSubtarefas: true })); }
    catch (e) { os.notify(os.errMsg(e), "err"); setTarefas([]); }
  }, [setorId, projetoId]);
  useEffect(() => { setTarefas(null); carregar(); }, [carregar]);
  os.useAoDesfazer(ESCOPO, carregar);

  const d = useMemo(() => {
    const ts = tarefas || [];
    const h = hoje(), sem = somaDias(h, 7), mes = new Date(Date.now() - 30 * 86400000).toISOString(), sete = new Date(Date.now() - 7 * 86400000).toISOString();
    const abertas = ts.filter((t) => !t.concluida_em);
    const atrasadas = abertas.filter((t) => t.prazo && t.prazo < h).sort((a, b) => a.prazo.localeCompare(b.prazo));
    const semana = abertas.filter((t) => t.prazo && t.prazo >= h && t.prazo <= sem).sort((a, b) => a.prazo.localeCompare(b.prazo));
    const feitas7 = ts.filter((t) => t.concluida_em && t.concluida_em >= sete).length;
    const feitas30 = ts.filter((t) => t.concluida_em && t.concluida_em >= mes).length;
    const porPessoa = {};
    for (const t of abertas) {
      const k = t.responsavel_id || "";
      const o = (porPessoa[k] = porPessoa[k] || { abertas: 0, atrasadas: 0 });
      o.abertas++; if (t.prazo && t.prazo < h) o.atrasadas++;
    }
    const pessoas = Object.entries(porPessoa).sort((a, b) => b[1].abertas - a[1].abertas);
    const maxCarga = Math.max(1, ...pessoas.map(([, o]) => o.abertas));
    const projetos = base.projetos.filter((p) => p.setor_id === setorId && !p.arquivado && (!projetoId || p.id === projetoId)).map((p) => {
      const tp = ts.filter((t) => t.projeto_id === p.id && !t.parent_id);
      const ok = tp.filter((t) => t.concluida_em).length;
      return { p, total: tp.length, ok, atrasadas: tp.filter((t) => !t.concluida_em && t.prazo && t.prazo < h).length };
    }).filter((x) => x.total);
    return { abertas, atrasadas, semana, feitas7, feitas30, pessoas, maxCarga, projetos };
  }, [tarefas, base, setorId, projetoId]);

  if (!base.meusSetores.length) return html`<${Cabecalho} titulo="Painel"><${AbasTarefas} tela="painel" base=${base} /><//><${SemSetor} me=${me} />`;
  const setor = base.setor(setorId);
  const linhaTarefa = (t) => html`<li key=${t.id}><button type="button" onClick=${() => setAberta(t.id)}
    class="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-slate-50">
    <${Avatar} pessoa=${base.pessoa(t.responsavel_id)} tamanho="h-6 w-6" />
    <span class="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-800">${t.titulo}</span><${PillPrazo} t=${t} /></button></li>`;

  return html`
    <${Cabecalho} titulo=${`Painel · ${setor ? setor.nome : ""}`} descricao="Como o setor está: carga de cada pessoa, o que atrasou e o que vence nesta semana.">
      <${AbasTarefas} tela="painel" base=${base} />
    <//>
    <div class="mb-4"><${SeletorEscopo} base=${base} escopo=${escopo} /></div>
    ${tarefas === null ? html`<div class="py-10 text-center text-sm font-semibold text-slate-500"><span class="spinner mr-2"></span>Carregando…</div>` : html`
      <div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <${Kpi} rotulo="Em aberto" valor=${d.abertas.length} />
        <${Kpi} rotulo="Atrasadas" valor=${d.atrasadas.length} tom=${d.atrasadas.length ? "text-rose-700" : "text-[#07110e]"} />
        <${Kpi} rotulo="Vencem em 7 dias" valor=${d.semana.length} tom="text-amber-700" />
        <${Kpi} rotulo="Concluídas" valor=${d.feitas7} sub=${`${d.feitas30} nos últimos 30 dias`} tom="text-emerald-700" />
      </div>
      <div class="grid gap-4 lg:grid-cols-2">
        <${Bloco} titulo="Carga por pessoa (tarefas em aberto)">
          ${!d.pessoas.length ? html`<p class="text-sm font-medium text-slate-400">Nenhuma tarefa em aberto.</p>` : html`<ul class="space-y-2.5">
            ${d.pessoas.map(([id, o]) => { const p = id ? base.pessoa(id) : null; return html`<li key=${id || "ninguem"} class="flex items-center gap-3">
              <${Avatar} pessoa=${p} tamanho="h-7 w-7" />
              <span class="w-32 shrink-0 truncate text-[13px] font-bold text-slate-700">${p ? p.nome : "Sem responsável"}</span>
              <span class="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <span class="absolute inset-y-0 left-0 rounded-full bg-emerald-500" style=${`width:${(o.abertas / d.maxCarga) * 100}%`}></span>
                <span class="absolute inset-y-0 left-0 rounded-full bg-rose-500" style=${`width:${(o.atrasadas / d.maxCarga) * 100}%`}></span>
              </span>
              <span class="w-20 shrink-0 text-right text-[12px] font-bold text-slate-600">${o.abertas}${o.atrasadas ? html` <span class="text-rose-700">(${o.atrasadas} atr.)</span>` : null}</span>
            </li>`; })}</ul>`}
        <//>
        <${Bloco} titulo="Andamento dos projetos">
          ${!d.projetos.length ? html`<p class="text-sm font-medium text-slate-400">Nenhum projeto com tarefas.</p>` : html`<ul class="space-y-3">
            ${d.projetos.map(({ p, total, ok, atrasadas }) => html`<li key=${p.id}>
              <div class="mb-1 flex items-center justify-between gap-2 text-[13px] font-bold">
                <a class="truncate text-slate-800 hover:underline" href=${`#/tarefas/quadro?setor=${setorId}&projeto=${p.id}`}>${p.nome}</a>
                <span class="shrink-0 text-slate-500">${ok}/${total}${atrasadas ? html` · <span class="text-rose-700">${atrasadas} atrasada${atrasadas > 1 ? "s" : ""}</span>` : null}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-slate-100"><div class="h-full rounded-full" style=${`width:${Math.round((ok / total) * 100)}%;background:${p.cor}`}></div></div>
            </li>`)}</ul>`}
        <//>
        <${Bloco} titulo=${`Atrasadas (${d.atrasadas.length})`}>
          ${d.atrasadas.length ? html`<ul>${d.atrasadas.slice(0, 15).map(linhaTarefa)}</ul>` : html`<p class="text-sm font-medium text-slate-400">Nada atrasado.</p>`}
        <//>
        <${Bloco} titulo=${`Vencem nos próximos 7 dias (${d.semana.length})`}>
          ${d.semana.length ? html`<ul>${d.semana.slice(0, 15).map(linhaTarefa)}</ul>` : html`<p class="text-sm font-medium text-slate-400">Nada vence nesta semana.</p>`}
        <//>
      </div>`}
    ${aberta ? html`<${DetalheTarefa} me=${me} base=${base} tarefaId=${aberta} onAbrir=${setAberta}
      onClose=${() => setAberta(null)} onMudou=${carregar} />` : null}`;
}

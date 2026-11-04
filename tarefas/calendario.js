// Calendário das tarefas por prazo (mês). Arrastar uma tarefa para outro dia muda o prazo.
import { html } from "htm/preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import {
  os, ESCOPO, isoDia, hoje, fetchTarefas, atualizarTarefa, Cabecalho, AbasTarefas, SemSetor, Icone, NovaTarefaModal,
  useEscopo, SeletorEscopo,
} from "./comum.js";
import { DetalheTarefa } from "./detalhe.js";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function CalendarioPage({ me, base, query }) {
  const escopo = useEscopo(base, query, "calendario");
  const { setorId, projetoId } = escopo;
  const [mes, setMes] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [tarefas, setTarefas] = useState(null);
  const [aberta, setAberta] = useState(null);
  const [nova, setNova] = useState(null);
  const [soMinhas, setSoMinhas] = useState(false);
  const [sobre, setSobre] = useState(null);

  const carregar = useCallback(async () => {
    if (!setorId) { setTarefas([]); return; }
    try { setTarefas(await fetchTarefas({ setorId, projetoId: projetoId || undefined, comSubtarefas: true })); }
    catch (e) { os.notify(os.errMsg(e), "err"); setTarefas([]); }
  }, [setorId, projetoId]);
  useEffect(() => { setTarefas(null); carregar(); }, [carregar]);
  os.useAoDesfazer(ESCOPO, carregar);

  const dias = useMemo(() => {
    const ini = new Date(mes.getFullYear(), mes.getMonth(), 1 - mes.getDay());
    return Array.from({ length: 42 }, (_, i) => new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + i));
  }, [mes]);
  const porDia = useMemo(() => {
    const m = {};
    for (const t of tarefas || []) {
      if (!t.prazo || (soMinhas && t.responsavel_id !== me.id)) continue;
      (m[t.prazo] = m[t.prazo] || []).push(t);
    }
    for (const k in m) m[k].sort((a, b) => (a.prazo_hora || "99").localeCompare(b.prazo_hora || "99"));
    return m;
  }, [tarefas, soMinhas, me.id]);
  const semPrazo = (tarefas || []).filter((t) => !t.prazo && !t.concluida_em && (!soMinhas || t.responsavel_id === me.id)).length;

  const soltar = async (e, iso) => {
    e.preventDefault(); setSobre(null);
    const id = e.dataTransfer.getData("text/plain");
    const t = (tarefas || []).find((x) => x.id === id);
    if (!t || t.prazo === iso) return;
    setTarefas((xs) => xs.map((x) => (x.id === id ? { ...x, prazo: iso } : x)));
    try { await atualizarTarefa(t, { prazo: iso }, { rotulo: "mudar prazo", mensagem: "Prazo alterado" }); }
    catch (err) { os.notify(os.errMsg(err), "err"); }
    carregar();
  };

  if (!base.meusSetores.length) return html`<${Cabecalho} titulo="Calendário"><${AbasTarefas} tela="calendario" base=${base} /><//><${SemSetor} me=${me} />`;
  const h = hoje();
  const nav = (n) => setMes((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return html`
    <${Cabecalho} titulo="Calendário" descricao="Tarefas pelo prazo. Arraste para outro dia para mudar o prazo; clique num dia vazio para criar.">
      <${AbasTarefas} tela="calendario" base=${base} />
    <//>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <${SeletorEscopo} base=${base} escopo=${escopo} />
      <label class="inline-flex items-center gap-2 text-[13px] font-bold text-slate-600">
        <input type="checkbox" class="h-4 w-4 accent-emerald-600" checked=${soMinhas} onChange=${() => setSoMinhas((v) => !v)} />Só as minhas</label>
    </div>
    <div class="mb-3 flex items-center gap-2">
      <${os.Btn} variant="ghost" class="!px-3" onClick=${() => nav(-1)} aria-label="Mês anterior">‹<//>
      <h2 class="min-w-[11rem] text-center text-lg font-black capitalize tracking-tight text-[#07110e]">${MESES[mes.getMonth()]} ${mes.getFullYear()}</h2>
      <${os.Btn} variant="ghost" class="!px-3" onClick=${() => nav(1)} aria-label="Próximo mês">›<//>
      <${os.Btn} variant="ghost" class="!px-3 text-xs" onClick=${() => { const d = new Date(); setMes(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Hoje<//>
      ${semPrazo ? html`<span class="ml-auto text-[12px] font-semibold text-slate-500">${semPrazo} em aberto sem prazo (veja na Lista)</span>` : null}
    </div>
    ${tarefas === null ? html`<div class="py-10 text-center text-sm font-semibold text-slate-500"><span class="spinner mr-2"></span>Carregando…</div>` : html`
    <div class="overflow-x-auto">
      <div class="grid min-w-[760px] grid-cols-7 overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white shadow-card">
        ${SEMANA.map((d) => html`<div key=${d} class="border-b border-slate-100 bg-slate-50 px-2 py-1.5 text-center text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">${d}</div>`)}
        ${dias.map((d) => {
          const iso = isoDia(d), fora = d.getMonth() !== mes.getMonth(), its = porDia[iso] || [];
          return html`<div key=${iso} onDragOver=${(e) => { e.preventDefault(); setSobre(iso); }} onDragLeave=${() => setSobre((s) => (s === iso ? null : s))}
            onDrop=${(e) => soltar(e, iso)} onClick=${(e) => { if (e.target === e.currentTarget) setNova({ prazo: iso, projeto_id: projetoId || undefined }); }}
            class=${os.cx("min-h-[6.5rem] cursor-pointer border-b border-r border-slate-100 p-1.5 transition", fora && "bg-slate-50/60", sobre === iso && "bg-emerald-50")}>
            <div class=${os.cx("mb-1 inline-grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12px] font-black",
              iso === h ? "bg-[#07110e] text-white" : fora ? "text-slate-300" : "text-slate-600")}>${d.getDate()}</div>
            <div class="space-y-1">
              ${its.slice(0, 4).map((t) => { const p = base.projeto(t.projeto_id); return html`<div key=${t.id} draggable="true"
                onDragStart=${(e) => { e.dataTransfer.setData("text/plain", t.id); }} onClick=${(e) => { e.stopPropagation(); setAberta(t.id); }}
                title=${t.titulo}
                class=${os.cx("truncate rounded-md px-1.5 py-0.5 text-[11px] font-bold ring-1 ring-inset",
                  t.concluida_em ? "bg-slate-50 text-slate-400 line-through ring-slate-200" : iso < h ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-white text-slate-700 ring-slate-200")}
                style=${t.concluida_em ? "" : `border-left:3px solid ${p ? p.cor : "#94a3b8"}`}>${t.prazo_hora ? html`<b>${String(t.prazo_hora).slice(0, 5)}</b> ` : null}${t.titulo}</div>`; })}
              ${its.length > 4 ? html`<div class="px-1 text-[11px] font-bold text-slate-500">+${its.length - 4} mais</div>` : null}
            </div>
          </div>`;
        })}
      </div>
    </div>`}
    ${nova ? html`<${NovaTarefaModal} me=${me} base=${base} padrao=${nova} onClose=${() => setNova(null)} onCriada=${carregar} />` : null}
    ${aberta ? html`<${DetalheTarefa} me=${me} base=${base} tarefaId=${aberta} onAbrir=${setAberta}
      onClose=${() => setAberta(null)} onMudou=${carregar} />` : null}`;
}

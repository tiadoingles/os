// Lista (estilo ClickUp/Monday): tarefas do setor agrupadas por projeto, com filtros e ordenação.
import { html } from "htm/preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import {
  os, ESCOPO, PRIORIDADES, fetchTarefas, fetchContagens, alternarConclusao, criarTarefa, Cabecalho, AbasTarefas,
  SemSetor, Avatar, PillPrazo, PillPrioridade, PillStatus, BotaoConcluir, Icone, NovaTarefaModal, useEscopo, SeletorEscopo,
} from "./comum.js";
import { DetalheTarefa } from "./detalhe.js";

const ORDENS = {
  manual: ["Ordem do quadro", (a, b) => Number(a.ordem) - Number(b.ordem)],
  prazo: ["Prazo", (a, b) => (a.prazo || "9999").localeCompare(b.prazo || "9999")],
  prioridade: ["Prioridade", (a, b) => PRIORIDADES[a.prioridade].peso - PRIORIDADES[b.prioridade].peso],
  recentes: ["Mais recentes", (a, b) => b.created_at.localeCompare(a.created_at)],
};

export function ListaPage({ me, base, query }) {
  const escopo = useEscopo(base, query, "lista");
  const { setorId, projetoId, projetos } = escopo;
  const [tarefas, setTarefas] = useState(null);
  const [cont, setCont] = useState({});
  const [aberta, setAberta] = useState(null);
  const [nova, setNova] = useState(null);
  const [f, setF] = useState({ busca: "", resp: "", situacao: "abertas", prioridade: "", ordem: "prazo" });
  const [rapida, setRapida] = useState({});

  const carregar = useCallback(async () => {
    if (!setorId) { setTarefas([]); return; }
    try {
      const ts = await fetchTarefas({ setorId, projetoId: projetoId || undefined });
      setTarefas(ts);
      setCont(await fetchContagens(ts.map((t) => t.id)));
    } catch (e) { os.notify(os.errMsg(e), "err"); setTarefas([]); }
  }, [setorId, projetoId]);
  useEffect(() => { setTarefas(null); carregar(); }, [carregar]);
  os.useAoDesfazer(ESCOPO, carregar);

  const filtradas = useMemo(() => {
    const b = f.busca.trim().toLowerCase();
    return (tarefas || []).filter((t) =>
      (f.situacao === "todas" || (f.situacao === "abertas" ? !t.concluida_em : !!t.concluida_em)) &&
      (!f.resp || (f.resp === "ninguem" ? !t.responsavel_id : t.responsavel_id === f.resp)) &&
      (!f.prioridade || t.prioridade === f.prioridade) &&
      (!b || t.titulo.toLowerCase().includes(b) || (t.etiquetas || []).some((e) => e.toLowerCase().includes(b)))
    ).sort(ORDENS[f.ordem][1]);
  }, [tarefas, f]);

  const concluir = async (t) => { try { await alternarConclusao(base, t); carregar(); } catch (e) { os.notify(os.errMsg(e), "err"); } };
  const criarRapida = async (pid) => {
    const titulo = (rapida[pid] || "").trim();
    if (!titulo) return;
    try { await criarTarefa({ titulo, projeto_id: pid, responsavel_id: me.id, ordem: Date.now() }, { toast: false });
      setRapida((r) => ({ ...r, [pid]: "" })); carregar(); }
    catch (e) { os.notify(os.errMsg(e), "err"); }
  };

  if (!base.meusSetores.length) return html`<${Cabecalho} titulo="Lista"><${AbasTarefas} tela="lista" base=${base} /><//><${SemSetor} me=${me} />`;
  const setor = base.setor(setorId);
  const grupos = (projetoId ? projetos.filter((p) => p.id === projetoId) : projetos)
    .map((p) => ({ p, itens: filtradas.filter((t) => t.projeto_id === p.id) }));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const linha = (t) => {
    const c = cont[t.id];
    return html`<tr key=${t.id} class="group cursor-pointer border-t border-slate-100 hover:bg-emerald-50/40" onClick=${() => setAberta(t.id)}>
      <td class="w-10 py-2 pl-4"><${BotaoConcluir} t=${t} desabilitado=${!(base.adm || t.criado_por === me.id || t.responsavel_id === me.id)} onClick=${() => concluir(t)} /></td>
      <td class="py-2 pr-3">
        <div class=${os.cx("text-sm font-bold", t.concluida_em ? "text-slate-400 line-through" : "text-slate-900")}>${t.titulo}</div>
        <div class="mt-0.5 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-400">
          ${c && c.sub ? html`<span>${c.subOk}/${c.sub} subtarefas</span>` : null}
          ${c && c.chk ? html`<span>${c.chkOk}/${c.chk} checklist</span>` : null}
          ${c && c.com ? html`<span>${c.com} comentário${c.com > 1 ? "s" : ""}</span>` : null}
          ${(t.etiquetas || []).map((e) => html`<span key=${e} class="rounded bg-slate-100 px-1 text-slate-500">${e}</span>`)}
        </div>
      </td>
      <td class="hidden py-2 pr-3 md:table-cell"><${PillStatus} status=${base.status(t.status_id)} /></td>
      <td class="py-2 pr-3"><div class="flex items-center gap-2"><${Avatar} pessoa=${base.pessoa(t.responsavel_id)} tamanho="h-6 w-6" />
        <span class="hidden truncate text-[12px] font-semibold text-slate-600 lg:inline">${(base.pessoa(t.responsavel_id) || {}).nome || ""}</span></div></td>
      <td class="py-2 pr-3"><${PillPrazo} t=${t} /></td>
      <td class="hidden py-2 pr-4 sm:table-cell"><${PillPrioridade} p=${t.prioridade} /></td>
    </tr>`;
  };

  return html`
    <${Cabecalho} titulo=${setor ? setor.nome : "Lista"} descricao="Todas as tarefas do setor, agrupadas por projeto.">
      <${AbasTarefas} tela="lista" base=${base} />
      ${projetos.length ? html`<${os.Btn} onClick=${() => setNova({ projeto_id: projetoId || projetos[0].id })}><${Icone} nome="mais" />Nova tarefa<//>` : null}
    <//>
    <div class="mb-3"><${SeletorEscopo} base=${base} escopo=${escopo} /></div>
    <div class="mb-4 flex flex-wrap items-center gap-2 rounded-[1.35rem] border border-slate-200 bg-white p-2 shadow-card">
      <div class="relative min-w-[12rem] flex-1">
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><${Icone} nome="busca" /></span>
        <input class=${os.inputCls + " !pl-9"} placeholder="Buscar por título ou etiqueta" value=${f.busca} onInput=${set("busca")} />
      </div>
      <select class=${os.inputCls + " !w-auto"} value=${f.situacao} onChange=${set("situacao")}>
        <option value="abertas">Em aberto</option><option value="concluidas">Concluídas</option><option value="todas">Todas</option></select>
      <select class=${os.inputCls + " !w-auto"} value=${f.resp} onChange=${set("resp")}>
        <option value="">Qualquer responsável</option><option value=${me.id}>Eu</option><option value="ninguem">Sem responsável</option>
        ${base.pessoas.filter((p) => p.id !== me.id).map((p) => html`<option key=${p.id} value=${p.id}>${p.nome}</option>`)}</select>
      <select class=${os.inputCls + " !w-auto"} value=${f.prioridade} onChange=${set("prioridade")}>
        <option value="">Qualquer prioridade</option>
        ${Object.entries(PRIORIDADES).map(([k, v]) => html`<option key=${k} value=${k}>${v.rotulo}</option>`)}</select>
      <select class=${os.inputCls + " !w-auto"} value=${f.ordem} onChange=${set("ordem")} title="Ordenar por">
        ${Object.entries(ORDENS).map(([k, v]) => html`<option key=${k} value=${k}>Ordenar: ${v[0]}</option>`)}</select>
    </div>
    ${tarefas === null ? html`<div class="py-10 text-center text-sm font-semibold text-slate-500"><span class="spinner mr-2"></span>Carregando…</div>`
    : !projetos.length ? html`<div class="rounded-[1.6rem] border border-dashed border-slate-200 bg-white/80 px-6 py-12 text-center text-sm font-medium text-slate-500">
        Este setor ainda não tem projeto. ${base.gestorDe(setorId) ? html`Crie o primeiro em <a class="font-bold text-emerald-700 hover:underline" href="#/tarefas/configuracoes">Configurações</a>.` : "Peça a um gestor do setor para criar."}</div>`
    : grupos.map(({ p, itens }) => html`<section key=${p.id} class="mb-4 overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white shadow-card">
        <h2 class="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
          <span class="h-2.5 w-2.5 rounded-full" style=${`background:${p.cor}`}></span>
          <a href=${`#/tarefas/quadro?setor=${setorId}&projeto=${p.id}`} class="text-[13px] font-black text-[#07110e] hover:underline">${p.nome}</a>
          <span class="text-[12px] font-bold text-slate-400">${itens.length}</span></h2>
        <table class="w-full text-left">
          <tbody>${itens.map(linha)}</tbody>
        </table>
        ${!itens.length ? html`<p class="px-4 py-3 text-sm font-medium text-slate-400">Nenhuma tarefa com esses filtros.</p>` : null}
        <form class="border-t border-slate-100 px-4 py-1.5" onSubmit=${(e) => { e.preventDefault(); criarRapida(p.id); }}>
          <input class="w-full bg-transparent py-1 text-[13px] font-semibold text-slate-700 placeholder-slate-400 focus:outline-none"
            placeholder="+ Adicionar tarefa (Enter)" value=${rapida[p.id] || ""} onInput=${(e) => setRapida((r) => ({ ...r, [p.id]: e.target.value }))} />
        </form>
      </section>`)}
    ${nova ? html`<${NovaTarefaModal} me=${me} base=${base} padrao=${nova} onClose=${() => setNova(null)} onCriada=${carregar} />` : null}
    ${aberta ? html`<${DetalheTarefa} me=${me} base=${base} tarefaId=${aberta} onAbrir=${setAberta}
      onClose=${() => setAberta(null)} onMudou=${carregar} />` : null}`;
}

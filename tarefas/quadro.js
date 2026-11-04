// Quadro (kanban) de um projeto: colunas = status do projeto; arrastar o cartão muda o status.
import { html } from "htm/preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import {
  os, ESCOPO, fetchTarefas, fetchContagens, atualizarTarefa, criarTarefa, Cabecalho, AbasTarefas, SemSetor,
  Avatar, PillPrazo, PillPrioridade, Icone, NovaTarefaModal, useEscopo, SeletorEscopo,
} from "./comum.js";
import { DetalheTarefa } from "./detalhe.js";

function Cartao({ t, base, cont, onAbrir, onDragStart }) {
  const resp = base.pessoa(t.responsavel_id);
  return html`<article draggable="true" onDragStart=${(e) => onDragStart(e, t)} onClick=${() => onAbrir(t.id)}
    class="cursor-pointer rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-emerald-300 hover:shadow-card active:cursor-grabbing">
    <div class=${os.cx("text-[13px] font-bold leading-snug", t.concluida_em ? "text-slate-400 line-through" : "text-slate-900")}>${t.titulo}</div>
    ${(t.etiquetas || []).length ? html`<div class="mt-2 flex flex-wrap gap-1">${t.etiquetas.slice(0, 4).map((e) => html`<span key=${e} class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">${e}</span>`)}</div>` : null}
    <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
      ${t.prioridade !== "normal" ? html`<${PillPrioridade} p=${t.prioridade} />` : null}
      <${PillPrazo} t=${t} />
      ${cont && cont.sub ? html`<span class="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500" title="Subtarefas"><${Icone} nome="subtarefa" class="h-3 w-3" />${cont.subOk}/${cont.sub}</span>` : null}
      ${cont && cont.chk ? html`<span class="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500" title="Checklist"><${Icone} nome="checklist" class="h-3 w-3" />${cont.chkOk}/${cont.chk}</span>` : null}
      ${cont && cont.com ? html`<span class="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500" title="Comentários"><${Icone} nome="comentario" class="h-3 w-3" />${cont.com}</span>` : null}
      <span class="ml-auto"><${Avatar} pessoa=${resp} tamanho="h-6 w-6" /></span>
    </div>
  </article>`;
}

export function QuadroPage({ me, base, query }) {
  const escopo = useEscopo(base, query, "quadro", { exigeProjeto: true });
  const { projetoId, setorId } = escopo;
  const [tarefas, setTarefas] = useState(null);
  const [cont, setCont] = useState({});
  const [aberta, setAberta] = useState(null);
  const [nova, setNova] = useState(null);
  const [sobre, setSobre] = useState(null); // coluna com o cartão por cima
  const [rapida, setRapida] = useState({}); // título digitado no rodapé de cada coluna
  const [soMinhas, setSoMinhas] = useState(false);

  const carregar = useCallback(async () => {
    if (!projetoId) { setTarefas([]); return; }
    try {
      const ts = await fetchTarefas({ projetoId });
      setTarefas(ts);
      setCont(await fetchContagens(ts.map((t) => t.id)));
    } catch (e) { os.notify(os.errMsg(e), "err"); setTarefas([]); }
  }, [projetoId]);
  useEffect(() => { setTarefas(null); carregar(); }, [carregar]);
  os.useAoDesfazer(ESCOPO, carregar);

  const colunas = base.statusDe(projetoId);
  const visiveis = useMemo(() => (tarefas || []).filter((t) => !soMinhas || t.responsavel_id === me.id), [tarefas, soMinhas, me.id]);
  const daColuna = (sid) => visiveis.filter((t) => t.status_id === sid).sort((a, b) => Number(a.ordem) - Number(b.ordem));

  const onDragStart = (e, t) => { e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; };
  const soltar = async (e, statusId, antesDe) => {
    e.preventDefault(); e.stopPropagation(); setSobre(null);
    const id = e.dataTransfer.getData("text/plain");
    if (antesDe && antesDe === id) return; // soltou no próprio lugar
    const t = (tarefas || []).find((x) => x.id === id);
    if (!t) return;
    const lista = daColuna(statusId).filter((x) => x.id !== id);
    let i = antesDe ? lista.findIndex((x) => x.id === antesDe) : lista.length;
    if (i < 0) i = lista.length;
    const ant = lista[i - 1], prox = lista[i];
    const ordem = ant && prox ? (Number(ant.ordem) + Number(prox.ordem)) / 2 : ant ? Number(ant.ordem) + 1000 : prox ? Number(prox.ordem) - 1000 : Date.now();
    if (t.status_id === statusId && Number(t.ordem) === ordem) return;
    const col = colunas.find((c) => c.id === statusId);
    setTarefas((xs) => xs.map((x) => (x.id === id ? { ...x, status_id: statusId, ordem } : x))); // otimista
    try {
      await atualizarTarefa(t, { status_id: statusId, ordem }, {
        rotulo: t.status_id === statusId ? "reordenar" : `mover para ${col ? col.nome : "outro status"}`,
        toast: t.status_id !== statusId, mensagem: col ? `Movida para ${col.nome}` : undefined });
    } catch (err) { os.notify(os.errMsg(err), "err"); }
    carregar();
  };

  const criarRapida = async (statusId) => {
    const titulo = (rapida[statusId] || "").trim();
    if (!titulo) return;
    try {
      const lista = daColuna(statusId);
      await criarTarefa({ titulo, projeto_id: projetoId, status_id: statusId, responsavel_id: me.id,
        ordem: lista.length ? Number(lista[lista.length - 1].ordem) + 1000 : Date.now() }, { toast: false });
      setRapida((r) => ({ ...r, [statusId]: "" }));
      carregar();
    } catch (e) { os.notify(os.errMsg(e), "err"); }
  };

  if (!base.meusSetores.length) return html`<${Cabecalho} titulo="Quadro"><${AbasTarefas} tela="quadro" base=${base} /><//><${SemSetor} me=${me} />`;
  const projeto = base.projeto(projetoId);
  const podeCriar = base.adm || base.meusSetores.some((s) => s.id === setorId);

  return html`
    <${Cabecalho} titulo=${projeto ? projeto.nome : "Quadro"} descricao=${projeto && projeto.descricao_md ? projeto.descricao_md : "Arraste os cartões entre as colunas para mudar o status."}>
      <${AbasTarefas} tela="quadro" base=${base} />
      ${podeCriar && projeto ? html`<${os.Btn} onClick=${() => setNova({ projeto_id: projetoId })}><${Icone} nome="mais" />Nova tarefa<//>` : null}
    <//>
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <${SeletorEscopo} base=${base} escopo=${escopo} todosProjetos=${false} />
      <label class="inline-flex items-center gap-2 text-[13px] font-bold text-slate-600">
        <input type="checkbox" class="h-4 w-4 accent-emerald-600" checked=${soMinhas} onChange=${() => setSoMinhas((v) => !v)} />Só as minhas</label>
    </div>
    ${!projeto ? html`<div class="rounded-[1.6rem] border border-dashed border-slate-200 bg-white/80 px-6 py-12 text-center text-sm font-medium text-slate-500">
        Este setor ainda não tem projeto. ${base.gestorDe(setorId) ? html`Crie o primeiro em <a class="font-bold text-emerald-700 hover:underline" href="#/tarefas/configuracoes">Configurações</a>.` : "Peça a um gestor do setor para criar."}</div>`
    : tarefas === null ? html`<div class="py-10 text-center text-sm font-semibold text-slate-500"><span class="spinner mr-2"></span>Carregando…</div>`
    : html`<div class="-mx-4 overflow-x-auto px-4 pb-4">
      <div class="flex min-w-max items-start gap-4">
        ${colunas.map((c) => { const itens = daColuna(c.id); return html`
          <section key=${c.id} class=${os.cx("flex w-[290px] shrink-0 flex-col rounded-[1.35rem] bg-slate-100/80 p-2 ring-2 transition", sobre === c.id ? "ring-emerald-400" : "ring-transparent")}
            onDragOver=${(e) => { e.preventDefault(); setSobre(c.id); }} onDragLeave=${() => setSobre((s) => (s === c.id ? null : s))}
            onDrop=${(e) => soltar(e, c.id, null)}>
            <h2 class="flex items-center gap-2 px-2 pb-2 pt-1 text-[12px] font-black uppercase tracking-[0.12em] text-slate-600">
              <span class="h-2.5 w-2.5 rounded-full" style=${`background:${c.cor}`}></span>${c.nome}<span class="ml-auto font-bold text-slate-400">${itens.length}</span></h2>
            <div class="flex min-h-[3rem] flex-col gap-2">
              ${itens.map((t) => html`<div key=${t.id} onDrop=${(e) => soltar(e, c.id, t.id)} onDragOver=${(e) => e.preventDefault()}>
                <${Cartao} t=${t} base=${base} cont=${cont[t.id]} onAbrir=${setAberta} onDragStart=${onDragStart} /></div>`)}
            </div>
            ${podeCriar ? html`<form class="mt-2" onSubmit=${(e) => { e.preventDefault(); criarRapida(c.id); }}>
              <input class="w-full rounded-xl border border-transparent bg-transparent px-2 py-1.5 text-[13px] font-semibold text-slate-700 placeholder-slate-400 hover:bg-white focus:border-emerald-300 focus:bg-white focus:outline-none"
                placeholder="+ Adicionar tarefa" value=${rapida[c.id] || ""} onInput=${(e) => setRapida((r) => ({ ...r, [c.id]: e.target.value }))} />
            </form>` : null}
          </section>`; })}
      </div>
    </div>`}
    ${nova ? html`<${NovaTarefaModal} me=${me} base=${base} padrao=${nova} onClose=${() => setNova(null)} onCriada=${carregar} />` : null}
    ${aberta ? html`<${DetalheTarefa} me=${me} base=${base} tarefaId=${aberta} onAbrir=${setAberta}
      onClose=${() => setAberta(null)} onMudou=${carregar} />` : null}`;
}

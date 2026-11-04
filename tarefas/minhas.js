// Minhas tarefas (estilo Asana): tudo em que a pessoa é responsável ou participante, por prazo.
import { html } from "htm/preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import {
  os, ESCOPO, hoje, somaDias, fetchMinhas, alternarConclusao, podeEditar, Cabecalho, AbasTarefas,
  Avatar, PillPrazo, PillPrioridade, BotaoConcluir, Icone, NovaTarefaModal, PRIORIDADES,
} from "./comum.js";
import { DetalheTarefa } from "./detalhe.js";

const GRUPOS = [
  ["atrasadas", "Atrasadas", "text-rose-700"],
  ["hoje", "Hoje", "text-amber-700"],
  ["semana", "Próximos 7 dias", "text-emerald-700"],
  ["depois", "Mais adiante", "text-slate-600"],
  ["sem", "Sem prazo", "text-slate-500"],
];
function grupoDe(t) {
  if (!t.prazo) return "sem";
  const h = hoje();
  if (t.prazo < h) return "atrasadas";
  if (t.prazo === h) return "hoje";
  if (t.prazo <= somaDias(h, 7)) return "semana";
  return "depois";
}

export function MinhasPage({ me, base, query }) {
  const [tarefas, setTarefas] = useState(null);
  const [verConcluidas, setVerConcluidas] = useState(false);
  const [aberta, setAberta] = useState(query.t || null);
  useEffect(() => { if (query.t) setAberta(query.t); }, [query.t]);
  const [nova, setNova] = useState(null);
  const carregar = useCallback(async () => {
    try { setTarefas(await fetchMinhas(me.id, base.projetosPedido.map((p) => p.id))); } catch (e) { os.notify(os.errMsg(e), "err"); setTarefas([]); }
  }, [me.id, base]);
  useEffect(() => { carregar(); }, [carregar]);
  os.useAoDesfazer(ESCOPO, carregar);

  // "Meus pedidos": abertos por mim em Solicitações de outro setor, sem eu ser responsável.
  const ehPedido = (t) => t.criado_por === me.id && t.responsavel_id !== me.id && base.projetosPedido.some((p) => p.id === t.projeto_id);
  const pedidos = useMemo(() => (tarefas || []).filter((t) => ehPedido(t) && !t.concluida_em), [tarefas, base]);
  const abertas = useMemo(() => (tarefas || []).filter((t) => !t.concluida_em && !ehPedido(t))
    .sort((a, b) => (a.prazo || "9999").localeCompare(b.prazo || "9999") || PRIORIDADES[a.prioridade].peso - PRIORIDADES[b.prioridade].peso), [tarefas]);
  const concluidas = useMemo(() => (tarefas || []).filter((t) => t.concluida_em)
    .sort((a, b) => b.concluida_em.localeCompare(a.concluida_em)).slice(0, 30), [tarefas]);
  const contagem = (g) => abertas.filter((t) => grupoDe(t) === g).length;

  const concluir = async (t) => {
    try { await alternarConclusao(base, t); carregar(); } catch (e) { os.notify(os.errMsg(e), "err"); }
  };

  const linha = (t) => {
    const projeto = base.projeto(t.projeto_id);
    const pode = podeEditar(me, base, t, [me.id]); // está na lista = responsável ou participante
    return html`<li key=${t.id} class="group flex cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0 hover:bg-emerald-50/40"
      onClick=${() => setAberta(t.id)}>
      <${BotaoConcluir} t=${t} desabilitado=${!pode} onClick=${() => concluir(t)} />
      <div class="min-w-0 flex-1">
        <div class=${os.cx("truncate text-sm font-bold", t.concluida_em ? "text-slate-400 line-through" : "text-slate-900")}>${t.titulo}</div>
        <div class="truncate text-[11px] font-semibold text-slate-400">${ehPedido(t) ? `pedido a ${(base.setor(t.setor_id) || {}).nome || "outro setor"} · ${(base.status(t.status_id) || {}).nome || ""}` : projeto ? projeto.nome : ""}${t.parent_id ? " · subtarefa" : ""}${!ehPedido(t) && t.responsavel_id && t.responsavel_id !== me.id ? " · participando" : ""}</div>
      </div>
      ${t.prioridade !== "normal" ? html`<${PillPrioridade} p=${t.prioridade} />` : null}
      <${PillPrazo} t=${t} />
    </li>`;
  };

  const resumo = html`<div class="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
    ${[["Atrasadas", contagem("atrasadas"), "text-rose-700"], ["Hoje", contagem("hoje"), "text-amber-700"],
       ["Próximos 7 dias", contagem("semana"), "text-emerald-700"], ["Em aberto", abertas.length, "text-[#07110e]"]].map(([r, n, c]) => html`
      <div key=${r} class="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-3 shadow-card">
        <div class="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">${r}</div>
        <div class=${os.cx("mt-1 text-2xl font-black tracking-tight", c)}>${n}</div>
      </div>`)}
  </div>`;

  return html`
    <${Cabecalho} titulo="Minhas tarefas" descricao="Tudo em que você é responsável ou participante, de todos os setores, ordenado por prazo.">
      <${AbasTarefas} tela="minhas" base=${base} />
      ${base.projetosPedido.length ? html`<${os.Btn} variant="ghost" onClick=${() => setNova({ projeto_id: base.projetosPedido[0].id })}><${Icone} nome="enviar" />Pedir a outro setor<//>` : null}
      <${os.Btn} onClick=${() => setNova({})}><${Icone} nome="mais" />Nova tarefa<//>
    <//>
    ${tarefas === null ? html`<div class="py-10 text-center text-sm font-semibold text-slate-500"><span class="spinner mr-2"></span>Carregando…</div>` : html`
      ${resumo}
      ${!abertas.length ? html`<div class="rounded-[1.6rem] border border-dashed border-slate-200 bg-white/80 px-6 py-12 text-center">
          <div class="font-black text-[#07110e]">Nada pendente com você</div>
          <div class="mt-1 text-sm font-medium text-slate-500">Quando alguém atribuir uma tarefa a você, ela aparece aqui.</div></div>`
      : GRUPOS.map(([g, nome, cor]) => {
          const itens = abertas.filter((t) => grupoDe(t) === g);
          return itens.length ? html`<section key=${g} class="mb-4 overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white shadow-card">
            <h2 class=${os.cx("border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-[12px] font-black uppercase tracking-[0.14em]", cor)}>${nome} · ${itens.length}</h2>
            <ul>${itens.map(linha)}</ul></section>` : null;
        })}
      ${pedidos.length ? html`<section class="mb-4 overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white shadow-card">
        <h2 class="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-[12px] font-black uppercase tracking-[0.14em] text-sky-700">Meus pedidos a outros setores · ${pedidos.length}</h2>
        <ul>${pedidos.map(linha)}</ul></section>` : null}
      <button type="button" class="mt-2 text-sm font-bold text-emerald-700 hover:underline" onClick=${() => setVerConcluidas((v) => !v)}>
        ${verConcluidas ? "Esconder concluídas" : `Ver concluídas recentemente (${concluidas.length})`}</button>
      ${verConcluidas && concluidas.length ? html`<section class="mt-3 overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white shadow-card"><ul>${concluidas.map(linha)}</ul></section>` : null}
    `}
    ${nova ? html`<${NovaTarefaModal} me=${me} base=${base} padrao=${nova} onClose=${() => setNova(null)} onCriada=${carregar} />` : null}
    ${aberta ? html`<${DetalheTarefa} me=${me} base=${base} tarefaId=${aberta} onAbrir=${setAberta}
      onClose=${() => setAberta(null)} onMudou=${carregar} />` : null}`;
}

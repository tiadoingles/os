// Avisos (caixa de entrada estilo Asana): atribuições, menções, comentários, prazos e pedidos ao setor.
// Os avisos nascem no banco (gatilhos de tarefas_notificacoes); aqui só lê, marca como lido e abre a tarefa.
import { html } from "htm/preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import { os, TIPOS_AVISO, fmtQuando, fetchAvisos, marcarAvisosLidos, Cabecalho, AbasTarefas, Avatar, Icone } from "./comum.js";
import { DetalheTarefa } from "./detalhe.js";

export function textoAviso(a, base) {
  const ator = a.ator_id && base ? base.pessoa(a.ator_id) : null;
  const quem = ator ? ator.nome : "Alguém";
  const acao = TIPOS_AVISO[a.tipo] || a.tipo;
  if (a.tipo === "prazo" || a.tipo === "atrasada") return { linha1: acao, linha2: a.texto };
  if (a.tipo === "mencao" || a.tipo === "comentario") return { linha1: `${quem} ${acao}`, linha2: a.texto };
  return { linha1: `${quem} ${acao}`, linha2: a.texto };
}

export function AvisosPage({ me, base }) {
  const [itens, setItens] = useState(null);
  const [filtro, setFiltro] = useState("nao-lidos");
  const [aberta, setAberta] = useState(null);
  const carregar = useCallback(async () => {
    try { setItens(await fetchAvisos(200)); } catch (e) { os.notify(os.errMsg(e), "err"); setItens([]); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { const on = () => carregar(); addEventListener("tarefas:avisos", on); return () => removeEventListener("tarefas:avisos", on); }, [carregar]);

  const abrir = async (a) => {
    if (a.tarefa_id) setAberta(a.tarefa_id);
    if (!a.lida_em) { try { await marcarAvisosLidos([a.id]); } catch (e) { os.notify(os.errMsg(e), "err"); } carregar(); }
  };
  const lerTodos = async () => { try { await marcarAvisosLidos(null); carregar(); } catch (e) { os.notify(os.errMsg(e), "err"); } };
  const lista = (itens || []).filter((a) => filtro === "todos" || !a.lida_em);
  const naoLidos = (itens || []).filter((a) => !a.lida_em).length;

  return html`
    <${Cabecalho} titulo="Avisos" descricao="O que mudou nas tarefas em que você está: atribuições, menções, comentários, prazos e pedidos ao seu setor.">
      <${AbasTarefas} tela="avisos" base=${base} />
    <//>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div class="inline-flex gap-1 rounded-xl bg-slate-100 p-1">
        ${[["nao-lidos", `Não lidos (${naoLidos})`], ["todos", "Todos"]].map(([k, n]) => html`<button key=${k} type="button" onClick=${() => setFiltro(k)}
          class=${os.cx("rounded-lg px-3 py-1.5 text-[13px] font-bold", filtro === k ? "bg-[#07110e] text-white" : "text-slate-600")}>${n}</button>`)}
      </div>
      ${naoLidos ? html`<${os.Btn} variant="ghost" onClick=${lerTodos}><${Icone} nome="check" />Marcar todos como lidos<//>` : null}
    </div>
    ${itens === null ? html`<div class="py-10 text-center text-sm font-semibold text-slate-500"><span class="spinner mr-2"></span>Carregando…</div>`
    : !lista.length ? html`<div class="rounded-[1.6rem] border border-dashed border-slate-200 bg-white/80 px-6 py-12 text-center">
        <div class="font-black text-[#07110e]">${filtro === "nao-lidos" ? "Nenhum aviso novo" : "Nenhum aviso ainda"}</div>
        <div class="mt-1 text-sm font-medium text-slate-500">Quando alguém atribuir, mencionar ou comentar numa tarefa sua, aparece aqui.</div></div>`
    : html`<ul class="overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white shadow-card">
        ${lista.map((a) => { const t = textoAviso(a, base); return html`<li key=${a.id}>
          <button type="button" onClick=${() => abrir(a)}
            class=${os.cx("flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-emerald-50/40", !a.lida_em && "bg-emerald-50/30")}>
            ${a.ator_id ? html`<${Avatar} pessoa=${base.pessoa(a.ator_id)} tamanho="h-8 w-8" />`
              : html`<span class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200"><${Icone} nome="calendario" class="h-4 w-4" /></span>`}
            <span class="min-w-0 flex-1">
              <span class="block text-[13px] font-black text-slate-900">${t.linha1}</span>
              <span class="block truncate text-[13px] font-medium text-slate-600">${t.linha2}</span>
              <span class="mt-0.5 block text-[11px] font-semibold text-slate-400">${fmtQuando(a.created_at)}</span>
            </span>
            ${!a.lida_em ? html`<span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" title="Não lido"></span>` : null}
          </button></li>`; })}
      </ul>`}
    ${aberta ? html`<${DetalheTarefa} me=${me} base=${base} tarefaId=${aberta} onAbrir=${setAberta}
      onClose=${() => setAberta(null)} onMudou=${carregar} />` : null}`;
}

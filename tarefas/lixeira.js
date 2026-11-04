// Lixeira: tarefas excluídas (exclusão lógica). Quem está envolvido restaura; o ADM também exclui de vez.
import { html } from "htm/preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import {
  os, ESCOPO, fmtQuando, fetchTarefas, atualizarTarefa, Cabecalho, AbasTarefas, SemSetor, Avatar, Icone, useEscopo, SeletorEscopo,
} from "./comum.js";

export function LixeiraPage({ me, base, query }) {
  const escopo = useEscopo(base, query, "lixeira");
  const { setorId, projetoId } = escopo;
  const [itens, setItens] = useState(null);
  const [busy, setBusy] = useState(null);
  const carregar = useCallback(async () => {
    if (!setorId) { setItens([]); return; }
    try { setItens(await fetchTarefas({ setorId, projetoId: projetoId || undefined, excluidas: true, comSubtarefas: true })); }
    catch (e) { os.notify(os.errMsg(e), "err"); setItens([]); }
  }, [setorId, projetoId]);
  useEffect(() => { setItens(null); carregar(); }, [carregar]);
  os.useAoDesfazer(ESCOPO, carregar);

  const restaurar = async (t) => {
    setBusy(t.id);
    try { await atualizarTarefa(t, { excluida_em: null }, { rotulo: "restaurar", mensagem: "Tarefa restaurada" }); carregar(); }
    catch (e) { os.notify(os.errMsg(e), "err"); } finally { setBusy(null); }
  };
  const apagarDeVez = async (t) => {
    if (!confirm(`Excluir de vez "${t.titulo}"? Comentários, checklist e subtarefas também somem. Isto não pode ser desfeito.`)) return;
    setBusy(t.id);
    try {
      const { data, error } = await os.sb.from("tarefas").delete().eq("id", t.id).select("id");
      if (error) throw error;
      if (!data || !data.length) throw new Error("Só o ADM exclui de vez.");
      os.notify("Excluída de vez.", "ok"); carregar();
    } catch (e) { os.notify(os.errMsg(e), "err"); } finally { setBusy(null); }
  };

  if (!base.meusSetores.length) return html`<${Cabecalho} titulo="Lixeira"><${AbasTarefas} tela="lixeira" base=${base} /><//><${SemSetor} me=${me} />`;
  return html`
    <${Cabecalho} titulo="Lixeira" descricao="Tarefas excluídas do setor. Quem está envolvido na tarefa pode restaurá-la.">
      <${AbasTarefas} tela="lixeira" base=${base} />
    <//>
    <div class="mb-4"><${SeletorEscopo} base=${base} escopo=${escopo} /></div>
    ${itens === null ? html`<div class="py-10 text-center text-sm font-semibold text-slate-500"><span class="spinner mr-2"></span>Carregando…</div>`
    : !itens.length ? html`<div class="rounded-[1.6rem] border border-dashed border-slate-200 bg-white/80 px-6 py-12 text-center text-sm font-medium text-slate-500">A lixeira deste setor está vazia.</div>`
    : html`<ul class="overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white shadow-card">
        ${itens.map((t) => { const p = base.projeto(t.projeto_id); return html`<li key=${t.id} class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0">
          <${Avatar} pessoa=${base.pessoa(t.responsavel_id)} tamanho="h-6 w-6" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-bold text-slate-800">${t.titulo}</div>
            <div class="text-[11px] font-semibold text-slate-400">${p ? p.nome : ""}${t.parent_id ? " · subtarefa" : ""} · excluída em ${fmtQuando(t.excluida_em)}</div>
          </div>
          <${os.Btn} variant="ghost" class="!px-3 !py-1.5 text-xs" loading=${busy === t.id} onClick=${() => restaurar(t)}><${Icone} nome="restaurar" class="h-3.5 w-3.5" />Restaurar<//>
          ${base.adm ? html`<${os.Btn} variant="danger" class="!px-3 !py-1.5 text-xs" disabled=${busy === t.id} onClick=${() => apagarDeVez(t)}>Excluir de vez<//>` : null}
        </li>`; })}
      </ul>`}`;
}

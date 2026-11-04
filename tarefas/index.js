// Gestão de Tarefas — ponto de entrada importado por app.js (#/tarefas/<tela>).
// Novos arquivos .js nesta pasta precisam de uma linha no importmap do index.html (mesmo ?v=N).
import { html } from "htm/preact";
import { useEffect } from "preact/hooks";
import { os, useBase, ESCOPO } from "./comum.js";
import { MinhasPage } from "./minhas.js";
import { QuadroPage } from "./quadro.js";
import { ListaPage } from "./lista.js";
import { ConfiguracoesPage } from "./configuracoes.js";
export { configurarTarefas } from "./comum.js";

export const TELAS_TAR = { minhas: MinhasPage, quadro: QuadroPage, lista: ListaPage, configuracoes: ConfiguracoesPage };

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

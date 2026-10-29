// Financeiro (cópia do Craft Green) — ponto de entrada importado por app.js.
// Mapa slug do NAV (#/financeiro/<slug>) -> componente da tela. Cada tela vive no seu arquivo
// (trabalho em paralelo sem conflito). Novos arquivos .js nesta pasta precisam de uma linha no
// importmap do index.html (versão ?v=N), senão o navegador serve cache antigo.
import { html } from "htm/preact";
import { useEffect } from "preact/hooks";
export { configurarFinanceiro } from "./comum.js";
import { VisaoGeralPage } from "./visao-geral.js";
import { DrePage } from "./dre.js";
import { FluxoPage } from "./fluxo.js";
import { VendasPage } from "./vendas.js";
import { ConciliacaoPage } from "./conciliacao.js";
import { ImportacaoPage } from "./importacao.js";
import { ContasPage } from "./contas.js";
import { EstruturaDrePage } from "./estrutura-dre.js";
import { HotmartPage } from "./hotmart.js";
import { CobrancaPage } from "./cobranca.js";
import { NfePage } from "./nfe.js";
import { CoproducaoPage } from "./coproducao.js";

export const TELAS_FIN = {
  "visao-geral": VisaoGeralPage,
  dre: DrePage,
  "fluxo-caixa": FluxoPage,
  vendas: VendasPage,
  conciliacao: ConciliacaoPage,
  importacao: ImportacaoPage,
  contas: ContasPage,
  "estrutura-dre": EstruturaDrePage,
  hotmart: HotmartPage,
  cobranca: CobrancaPage,
  nfe: NfePage,
  coproducao: CoproducaoPage,
};

/** Router do Financeiro: a guarda de acesso (rotaPermitida) já rodou no Router do app. */
export function FinanceiroPage({ me, tela, query }) {
  const Tela = TELAS_FIN[tela];
  // Slug antigo/desconhecido (#/financeiro, #/financeiro/cobrancas): vai para a Visão Geral com a URL certa
  // (assim o escopo do DESFAZER do Shell também fica certo). Só o ADM chega aqui; a equipe já é redirecionada pela guarda.
  useEffect(() => { if (!Tela) location.replace("#/financeiro/visao-geral"); }, [Tela]);
  if (!Tela) return null;
  return html`<${Tela} me=${me} query=${query || {}} />`;
}

// Financeiro · Visão Geral — tela do Craft Green "Visão Geral" (ref app_dashboard_page).
// Spec: docs/financeiro-spec.md §3.1. Base compartilhada: ./comum.js (não editar lá).
// Props do Router (#/financeiro/visao-geral): me (linha de profiles) e query (objeto da query string).
// Tela só de leitura (sem escrita, sem DESFAZER próprio).
//
// O Craft monta tudo no backend (/dashboard/executive-summary). Aqui o front calcula com as regras de comum.js:
// DRE do ano (montarDre) + seleção [mês] para cards/DRE resumida; fluxo do período (timelineFluxo) com saldo de
// abertura = Σ fin_saldos_ate(início do período) de todas as contas (inclusive arquivadas, spec 2.3).
import { html } from "htm/preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import {
  FinPage, Icone, KpiCardDestaque, GraficoBarras, GraficoSaldo, garantirEstilosFin,
  ANOS_FILTRO, MESES_CURTOS, cn, brl, nomeDre, periodo, useLocalState,
  fetchGrupos, fetchCategorias, fetchLancamentos, fetchVendas, fetchContas, fetchSaldosAte,
  montarDre, indicadoresDre, basesAv, avPercent, valorNaSelecao, receitaXDespesas, timelineFluxo,
} from "./comum.js";

/* ---------- CSS local: overview-dre_* (css_1c66c642 do Craft) ----------
   Px do Craft valem como estão no celular (sem zoom); a partir de 768px o .fin-page tem zoom .75,
   então os px são multiplicados por 4/3. Candidato a ir para comum.js (arquiteto). */
let estilosVg = false;
function garantirEstilosVg() {
  if (estilosVg || typeof document === "undefined") return;
  estilosVg = true;
  garantirEstilosFin();
  const p = (n, k) => +(n * k).toFixed(2) + "px";
  const base = (k) => `
.vg-dre-header{gap:${p(12, k)};padding:${p(20, k)} ${p(22, k)} ${p(16, k)}}
.vg-dre-header h2{font-size:${p(19, k)}}
.vg-dre-header p{margin:${p(5, k)} 0 0;font-size:${p(11, k)}}
.vg-dre-link{gap:${p(5, k)};font-size:${p(11, k)}}
.vg-dre-wrap{padding:0 ${p(12, k)} ${p(12, k)}}
.vg-dre-table{font-size:${p(13, k)}}
.vg-dre-table thead th{height:${p(38, k)};padding:${p(10, k)} ${p(8, k)};font-size:${p(11, k)}}
.vg-dre-row td,.vg-dre-row th{padding:${p(6, k)} ${p(8, k)}}
.vg-dre-amount{font-size:${p(16, k)}}
.vg-dre-av{font-size:${p(14, k)}}
.vg-dre-empty{height:${p(160, k)}}`;
  const lg = (k) => `
.vg-dre-header{gap:${p(9, k)};padding:${p(13, k)} ${p(15, k)} ${p(9, k)}}
.vg-dre-header h2{font-size:${p(17, k)}}
.vg-dre-header p{margin-top:${p(3, k)};font-size:${p(10, k)}}
.vg-dre-link{font-size:${p(10, k)}}
.vg-dre-wrap{padding:0 ${p(9, k)} ${p(9, k)}}
.vg-dre-table{font-size:${p(12, k)}}
.vg-dre-table thead th{height:${p(28, k)};padding:${p(4, k)} ${p(6, k)};font-size:${p(10, k)}}
.vg-dre-row td,.vg-dre-row th{padding:${p(3.5, k)} ${p(6, k)};line-height:1.2}
.vg-dre-amount{font-size:${p(14, k)}}
.vg-dre-av{font-size:${p(12, k)}}`;
  const st = document.createElement("style");
  st.setAttribute("data-fin-estilos-visao-geral", "1");
  st.textContent = `
.vg-dre-panel{display:flex;flex-direction:column;align-self:start;min-width:0;overflow:hidden;border:1px solid #dfe7e2;border-radius:1.4rem;background:#fff;box-shadow:0 20px 55px -42px rgba(3,15,10,.3)}
.vg-dre-header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between}
.vg-dre-header h2{margin:0;font-weight:800;letter-spacing:-.035em}
.vg-dre-header p{color:#738078;font-weight:600}
.vg-dre-link{display:inline-flex;align-items:center;color:#047857;font-weight:750;white-space:nowrap}
.vg-dre-link:hover{color:#064e3b}
.vg-dre-wrap{flex:1}
.vg-dre-table{width:100%;height:auto;border-collapse:collapse;table-layout:fixed}
.vg-dre-col-conta{width:46%}.vg-dre-col-valor{width:36%}.vg-dre-col-av{width:18%}
.vg-dre-table thead th{border-top:1px solid #edf1ee;border-bottom:1px solid #e5ece7;color:#738078;font-weight:700;text-align:right}
.vg-dre-table thead th:first-child{text-align:left}
.vg-dre-row td,.vg-dre-row th{border-bottom:1px solid #edf1ee;line-height:1.35;vertical-align:middle}
.vg-dre-row:last-child td,.vg-dre-row:last-child th{border-bottom:0}
.vg-dre-row th{font-weight:600;text-align:left;color:#35483d;overflow-wrap:anywhere}
.vg-dre-row td{text-align:right;font-variant-numeric:tabular-nums}
.vg-dre-row[data-tone=calculation]{background:#e8f8ef}
.vg-dre-row[data-tone=calculation] td,.vg-dre-row[data-tone=calculation] th{font-weight:800;border-bottom-color:#d7ece0}
.vg-dre-row:hover{background:#f6faf7}
.vg-dre-row[data-tone=calculation]:hover{background:#e1f4e8}
.vg-dre-amount{color:#273e30;font-weight:650;letter-spacing:-.025em}
.vg-dre-negative{color:#be3853}
.vg-dre-positive{color:#047857}
.vg-dre-av{color:#748078;font-weight:650;white-space:nowrap}
.vg-dre-empty{text-align:center;color:#738078}
${base(1)}
@media (min-width:768px){${base(4 / 3)}}
@media (min-width:1024px){${lg(4 / 3)}}
@media (max-width:480px){
.vg-dre-header{padding:18px 14px 14px}.vg-dre-header h2{font-size:18px}.vg-dre-wrap{padding:0 6px 8px}
.vg-dre-col-conta{width:43%}.vg-dre-col-valor{width:39%}.vg-dre-col-av{width:18%}
.vg-dre-row td,.vg-dre-row th{padding:7px 5px}.vg-dre-row th{font-size:13px}
.vg-dre-table thead th{padding:10px 5px;font-size:10px}.vg-dre-amount{font-size:14px}.vg-dre-av{font-size:13px}}
`;
  document.head.appendChild(st);
}

const LINHAS_CALC = ["1", "4", "10", "17", "21"];

/** Carrega tudo o que a Visão Geral precisa para (ano, mês|"all"). */
async function carregarVisaoGeral(ano, mes) {
  const anoP = periodo(ano, null);
  const per = mes === "all" ? anoP : periodo(ano, Number(mes));
  const [grupos, categorias, lancamentos, vendas, contas, saldos] = await Promise.all([
    fetchGrupos(),
    fetchCategorias({ incluirArquivadas: true }),
    fetchLancamentos({ inicio: anoP.inicio, fim: anoP.fim, conciliado: true }),
    fetchVendas({ inicio: anoP.inicio, fim: anoP.fim }),
    fetchContas({ incluirArquivadas: true }),
    fetchSaldosAte(per.inicio),
  ]);
  const rel = montarDre({ grupos, categorias, lancamentos, vendas });
  const saldoInicial = saldos.reduce((a, s) => a + (Number(s.saldo) || 0), 0);
  const fluxo = timelineFluxo({ lancamentos, contas, saldoInicial, inicio: per.inicio, fim: per.fim, periodo: "mensal" });
  return { rel, fluxo };
}

export function VisaoGeralPage() {
  garantirEstilosVg();
  const [ano, setAno] = useLocalState("dashboard:year", String(new Date().getFullYear()));
  const [mes, setMes] = useLocalState("dashboard:month", "all");
  const [dados, setDados] = useState(null);     // null = carregando pela 1ª vez
  const [buscando, setBuscando] = useState(true);
  const [erro, setErro] = useState(null);
  const req = useRef(0);

  const carregar = useCallback(() => {
    const id = ++req.current;
    setBuscando(true);
    setErro(null);
    carregarVisaoGeral(ano, mes)
      .then((d) => { if (id === req.current) setDados(d); })
      .catch((e) => { if (id === req.current) { console.error(e); setErro(e); } })
      .finally(() => { if (id === req.current) setBuscando(false); });
  }, [ano, mes]);
  useEffect(() => { carregar(); }, [carregar]);

  const carregando = !dados && buscando;
  const rel = (dados && dados.rel) || [];
  const sel = mes === "all" ? null : [Number(mes)];
  const rotulo = mes === "all" ? "Ano de " + ano : MESES_CURTOS[Number(mes)] + " · " + ano;
  const ind = indicadoresDre(rel, sel);
  const nomeLinha = (code, padrao) => { const l = rel.find((x) => String(x.code) === code); return l ? nomeDre(l.name) : padrao; };
  const cards = [
    { rotulo: nomeLinha("1", "Receita Bruta"), valor: ind.receitaBruta, icone: "arrow-up-right", tom: "emerald", dica: "Receita consolidada" },
    { rotulo: "Custos e Despesas", valor: ind.custosDespesas, icone: "arrow-down-right", tom: "dark", dica: "Total do período" },
    { rotulo: nomeLinha("21", "Lucro Líquido"), valor: ind.lucroLiquido, icone: "trending-up", tom: ind.lucroLiquido >= 0 ? "emerald-soft" : "negative", dica: "Resultado gerencial" },
    { rotulo: "Margem Líquida (%)", valor: ind.margemLiquida, icone: "percent", tom: "light", dica: "Lucro líquido / faturamento líquido", formato: "pct" },
  ];
  // Receita × Despesas: sempre os 12 meses do ano (a spec só restringe cards/DRE resumida/fluxo ao mês). INFERIDO.
  const serie = receitaXDespesas(rel);
  const fluxo = dados && dados.fluxo;

  return html`<${FinPage} class="!pt-2 space-y-3">
    <section class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div class="mb-1 flex items-center gap-2 text-[13.5px] font-black uppercase tracking-[0.2em] text-emerald-700">
          <span class="h-2 w-2 rounded-full bg-emerald-500"></span>Visão financeira</div>
        <h1 class="text-lg font-black tracking-[-0.045em] text-[#07110e] md:text-xl">Visão Geral</h1>
      </div>
      <div class="flex flex-col gap-3 sm:flex-row">
        <div class="flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
          <select aria-label="Ano" value=${ano} onChange=${(e) => setAno(e.target.value)}
            class="h-10 rounded-xl bg-transparent px-3 text-xs font-black text-slate-800 outline-none">
            ${ANOS_FILTRO.map((a) => html`<option key=${a} value=${String(a)}>${a}</option>`)}
          </select>
          <div class="my-2 w-px bg-slate-200"></div>
          <select aria-label="Mês" value=${mes} onChange=${(e) => setMes(e.target.value)}
            class="h-10 min-w-28 rounded-xl bg-transparent px-3 text-xs font-black text-slate-800 outline-none">
            <option value="all">Consolidado</option>
            ${MESES_CURTOS.map((m, i) => html`<option key=${m} value=${String(i)}>${m}</option>`)}
          </select>
        </div>
        <a href="#/financeiro/importacao" class="premium-button-primary h-12 px-5 text-xs"><${Icone} nome="upload" class="h-4 w-4" /> Nova importação</a>
      </div>
    </section>

    ${buscando && dados ? html`<div class="fixed right-5 top-24 z-20 flex items-center gap-2 rounded-full border border-emerald-100 bg-white/90 px-3 py-2 text-[14.5px] font-black uppercase tracking-widest text-emerald-700 shadow-lg backdrop-blur">
      <${Icone} nome="loader" class="h-3 w-3 fin-spin" /> Atualizando</div>` : null}

    ${erro ? html`<${ErroVisaoGeral} onRetry=${carregar} />` : html`
      <section aria-labelledby="overview-result" class="space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 id="overview-result" class="text-xs font-bold text-slate-700">Resultado da empresa</h2>
          <span class="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[14.5px] font-bold text-emerald-800">${rotulo}</span>
        </div>
        <div aria-label="Indicadores de resultado" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          ${cards.map((c) => html`<${KpiCardDestaque} key=${c.dica} ...${c} carregando=${carregando} />`)}
        </div>
        <div class="grid gap-4 xl:grid-cols-[minmax(0,.95fr)_minmax(0,1.05fr)]">
          <${DreResumida} rel=${rel} sel=${sel} rotulo=${rotulo} carregando=${carregando} />
          <div class="flex min-w-0 flex-col gap-4">
            <${ReceitaXDespesas} data=${serie} carregando=${carregando} />
            <div class="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <${Atalho} href="#/financeiro/conciliacao" eyebrow="Conciliação" titulo="Concilie os lançamentos pendentes"
                descricao="Acompanhe as classificações que alimentam a DRE." />
              <${Atalho} href="#/financeiro/vendas" eyebrow="Vendas" titulo="Consulte o Relatório de Vendas"
                descricao="Confira o faturamento e os reembolsos das plataformas." />
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="overview-cash" class="space-y-4 border-t border-slate-200 pt-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 id="overview-cash" class="text-sm font-bold text-slate-700">Fluxo de Caixa</h2>
          <a href="#/financeiro/fluxo-caixa" class="inline-flex items-center gap-1.5 text-[14.5px] font-bold text-emerald-700">
            Abrir Fluxo de Caixa <${Icone} nome="arrow-up-right" class="h-3.5 w-3.5" /></a>
        </div>
        <div class="grid gap-5 min-[1440px]:grid-cols-[minmax(0,.75fr)_minmax(0,1.8fr)]">
          <${SaldoDisponivel} saldo=${fluxo ? fluxo.summary.finalBalance : 0} geracao=${fluxo ? fluxo.summary.periodResult : 0}
            rotulo=${rotulo} carregando=${carregando} />
          <${GraficoSaldo} key=${ano + "-" + mes} data=${fluxo ? fluxo.timeline : []} carregando=${carregando} periodLabel=${rotulo} />
        </div>
      </section>`}
  <//>`;
}

/** DRE Resumida: 22 linhas, Conta | Consolidado | AV (%). */
function DreResumida({ rel, sel, rotulo, carregando }) {
  const bases = basesAv(rel, sel);
  return html`<article class="vg-dre-panel" aria-label="DRE resumida do período">
    <header class="vg-dre-header">
      <div><h2>DRE Resumida</h2><p>${rotulo}</p></div>
      <a href="#/financeiro/dre" class="vg-dre-link">Ver DRE completa</a>
    </header>
    <div class="vg-dre-wrap">
      <table class="vg-dre-table">
        <caption class="sr-only">As 22 linhas principais da DRE de ${rotulo}, incluindo as calculadas: consolidado e análise vertical. As subcontas estão disponíveis na aba DRE.</caption>
        <colgroup><col class="vg-dre-col-conta" /><col class="vg-dre-col-valor" /><col class="vg-dre-col-av" /></colgroup>
        <thead><tr><th scope="col">Conta</th><th scope="col">Consolidado</th><th scope="col" title="Análise Vertical">AV (%)</th></tr></thead>
        <tbody>
          ${carregando ? Array.from({ length: 22 }, (_, i) => html`<tr key=${i} class="vg-dre-row">
              <td><div class="h-3.5 w-4/5 animate-pulse rounded bg-slate-100"></div></td>
              <td><div class="ml-auto h-3.5 w-4/5 animate-pulse rounded bg-slate-100"></div></td>
              <td><div class="h-3.5 animate-pulse rounded bg-slate-100"></div></td></tr>`)
            : rel.length ? rel.map((l) => {
              const v = valorNaSelecao(l, sel), av = avPercent(l, sel, bases);
              const calc = l.isCalculated || LINHAS_CALC.includes(l.code || "");
              return html`<tr key=${l.id} class="vg-dre-row" data-tone=${calc ? "calculation" : "group"}>
                <th scope="row">${nomeDre(l.name)}</th>
                <td class=${cn("vg-dre-amount", v < 0 && "vg-dre-negative", calc && v > 0 && "vg-dre-positive")} title=${brl(v)}>${brl(v)}</td>
                <td class="vg-dre-av">${av.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
              </tr>`;
            })
            : html`<tr><td colSpan="3" class="vg-dre-empty">Nenhuma conta disponível neste período.</td></tr>`}
        </tbody>
      </table>
    </div>
  </article>`;
}

const SERIES_RXD = [
  { chave: "revenue", rotulo: "Receita", cor: "bg-emerald-500", corRotulo: "bg-emerald-50 text-emerald-700" },
  { chave: "expenses", rotulo: "Despesas", cor: "bg-[#07110e]", corRotulo: "bg-slate-100 text-[#07110e]" },
];
function ReceitaXDespesas({ data, carregando }) {
  return html`<article class="min-w-0 rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-[0_20px_55px_-42px_rgba(3,15,10,0.5)] md:p-7">
    <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="text-[14.5px] font-black uppercase tracking-[0.2em] text-emerald-700">DRE do período</p>
        <h2 class="mt-1 text-xl font-black tracking-tight">Receita × Despesas</h2>
      </div>
      <div class="flex gap-4 text-[14.5px] font-black uppercase tracking-widest text-slate-500">
        <span class="flex items-center gap-2"><i class="h-2 w-2 rounded-full bg-emerald-500"></i>Receita</span>
        <span class="flex items-center gap-2"><i class="h-2 w-2 rounded-full bg-[#07110e]"></i>Despesas</span>
      </div>
    </div>
    <${GraficoBarras} data=${data} series=${SERIES_RXD} carregando=${carregando} vazio="Ainda não há dados conciliados neste período." />
  </article>`;
}

function Atalho({ href, eyebrow, titulo, descricao }) {
  return html`<a href=${href} class="group flex flex-col justify-center rounded-[1.35rem] border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-lg">
    <p class="text-[14.5px] font-black uppercase tracking-[0.18em] text-emerald-700">${eyebrow}</p>
    <div class="mt-3 flex items-start justify-between gap-4">
      <div>
        <h3 class="text-sm font-black text-slate-950">${titulo}</h3>
        <p class="mt-1.5 text-xs font-medium leading-relaxed text-slate-500">${descricao}</p>
      </div>
      <${Icone} nome="arrow-right" class="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-emerald-600" />
    </div>
  </a>`;
}

function SaldoDisponivel({ saldo, geracao, rotulo, carregando }) {
  return html`<article aria-label="Posição e geração de caixa" class="relative min-w-0 overflow-hidden rounded-[1.4rem] border border-[#102e20] bg-[#071b13] p-6 text-white md:p-7">
    <${Icone} nome="wallet" class="absolute -right-7 top-6 h-44 w-44 text-emerald-200/[.04]" />
    <div class="relative">
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-sm font-bold text-emerald-100">Saldo Disponível</h3>
        <${Icone} nome="wallet" class="h-4 w-4 shrink-0 text-emerald-400" />
      </div>
      ${carregando ? html`<div class="mt-5 h-9 w-3/4 animate-pulse rounded bg-white/10"></div>`
        : html`<p class="mt-5 text-[40px] font-extrabold tracking-tight tabular-nums [overflow-wrap:anywhere] md:text-[45px]">${brl(saldo)}</p>`}
      <p class="mt-2 text-[14.5px] font-medium text-emerald-100/55">Saldo final das contas · ${rotulo}</p>
      <div class="mt-6 border-t border-white/10 pt-5">
        <p class="text-xs font-semibold text-emerald-100/75">Geração de Caixa</p>
        ${carregando ? html`<div class="mt-3 h-6 w-1/2 animate-pulse rounded bg-white/10"></div>`
          : html`<p class=${cn("mt-2 text-[29.5px] font-bold tabular-nums [overflow-wrap:anywhere]", geracao < 0 ? "text-rose-300" : "text-emerald-300")}>${brl(geracao)}</p>`}
      </div>
    </div>
  </article>`;
}

function ErroVisaoGeral({ onRetry }) {
  return html`<div role="alert" class="rounded-[1.5rem] border border-rose-100 bg-white p-10 text-center">
    <${Icone} nome="landmark" class="mx-auto h-8 w-8 text-rose-500" />
    <h2 class="mt-4 text-lg font-black">Não foi possível carregar a Visão Geral</h2>
    <p class="mt-2 text-sm text-slate-500">A conexão falhou sem alterar seus dados.</p>
    <button type="button" onClick=${onRetry} class="premium-button-primary mt-5">Tentar novamente</button>
  </div>`;
}

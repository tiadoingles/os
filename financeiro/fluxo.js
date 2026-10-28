// Financeiro · Fluxo de Caixa — tela do Craft Green "Fluxo de Caixa" (app_fluxo_page + 487).
// Spec: docs/financeiro-spec.md (2.3 e 3.3). Base compartilhada: ./comum.js (não editar lá).
// Props do Router (#/financeiro/fluxo-caixa): me (linha de profiles) e query (objeto da query string).
// Escrita: podeEditarFin(me). DESFAZER: escopoFin("fluxo-caixa") (o Shell já mostra o botão).
//
// Visões (lembradas): Consolidado (ano, 12 meses) | Mensal (mês escolhido) | Contas a Pagar (previsão).
// Adição pedida pela Tia (não existe no Craft): "Novo lançamento" manual (origem='manual', conciliado=true)
// e editar/remover lançamentos manuais na lista do Mensal (remover = cancelado_em, como no Craft).
// Escala: .fin-page tem zoom .75 no desktop; px literal do Craft aqui já está ×4/3.
import { html } from "htm/preact";
import { useState, useEffect, useMemo, useRef } from "preact/hooks";
import {
  os, escopoFin, podeEditarFin, cn, brl, dataBR, isoData, periodo, parseValorBR, nomeDre,
  MESES, DIAS_SEMANA, ANOS_FILTRO, useLocalState,
  fetchContas, fetchGrupos, fetchCategorias, fetchLancamentos, fetchSaldosAte,
  timelineFluxo, previsaoRecorrente,
  Icone, FinPage, CabecalhoFin, BotaoPrimario, FiltroSelect, AbasToggle, KpiCard, GraficoSaldo,
  ErroCarga, ConfirmDialog,
} from "./comum.js";

const ESCOPO = escopoFin("fluxo-caixa");
const VISOES = [["consolidated", "Consolidado"], ["monthly", "Mensal"], ["payables", "Contas a Pagar"]];
const r2 = (n) => Math.round(n * 100) / 100;
const SEM_MOVIMENTO = "Nenhuma movimentação bancária conciliada no período.";

/** Soma o saldo (fin_saldos_ate) das contas do filtro. Contas arquivadas entram em "Todas as contas" [D]. */
function somaSaldos(saldos, contaId) {
  return r2(saldos.filter((s) => contaId === "all" || s.conta_id === contaId).reduce((a, s) => a + (Number(s.saldo) || 0), 0));
}
function hojeIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function rotuloConta(c) { return (c.banco ? c.banco + " · " : "") + c.apelido + (c.ativo === false ? " (arquivada)" : ""); }

/** Carrega os dados da visão atual. Devolve { chave, contas, lancamentos, fluxo | prev }. */
async function carregarFluxo({ view, ano, mes, contaId }) {
  const a = Number(ano), m = Number(mes);
  if (view === "payables") {
    const per = periodo(a, m);
    // Histórico para a previsão: 12 meses antes do mês projetado [I] (a regra pede ≥ 3 meses distintos).
    const inicioHist = isoData(Date.UTC(a, m - 12, 1));
    const [contas, saldos, lancamentos] = await Promise.all([
      fetchContas({ incluirArquivadas: true }),
      fetchSaldosAte(per.inicio),
      fetchLancamentos({ inicio: inicioHist, fim: per.fim, contaId, conciliado: true, origem: "banco" }),
    ]);
    const saldoInicial = somaSaldos(saldos, contaId);
    const realizado = r2(lancamentos.filter((l) => l.data >= per.inicio).reduce((s, l) => s + (Number(l.valor) || 0), 0));
    const prev = previsaoRecorrente({ historico: lancamentos, contas, ano: a, mes: m, saldoInicial, saldoBase: r2(saldoInicial + realizado) });
    return { contas, lancamentos, prev };
  }
  const per = view === "consolidated" ? periodo(a, null) : periodo(a, m);
  const [contas, saldos, lancamentos] = await Promise.all([
    fetchContas({ incluirArquivadas: true }),
    fetchSaldosAte(per.inicio),
    fetchLancamentos({ inicio: per.inicio, fim: per.fim, contaId, conciliado: true, origem: "banco" }),
  ]);
  const fluxo = timelineFluxo({ lancamentos, contas, saldoInicial: somaSaldos(saldos, contaId), inicio: per.inicio, fim: per.fim, periodo: "mensal" });
  return { contas, lancamentos, fluxo };
}

export function FluxoPage({ me }) {
  const [view, setView] = useLocalState("fluxo:view", "consolidated");
  const [ano, setAno] = useLocalState("fluxo:year", String(new Date().getFullYear()));
  const [mes, setMes] = useLocalState("fluxo:month", String(new Date().getMonth()));
  const [contaId, setContaId] = useLocalState("fluxo:accountId", "all");
  const [contas, setContas] = useState([]);
  const [res, setRes] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [form, setForm] = useState(null); // null | { lancamento? }
  const [remover, setRemover] = useState(null);
  const seq = useRef(0);
  const podeEditar = podeEditarFin(me);
  const visao = VISOES.some((v) => v[0] === view) ? view : "consolidated";
  const chave = [visao, ano, visao === "consolidated" ? "" : mes, contaId].join("|");

  async function carregar() {
    const id = ++seq.current;
    setCarregando(true);
    setErro(null);
    try {
      const r = await carregarFluxo({ view: visao, ano, mes, contaId });
      if (id !== seq.current) return;
      setContas(r.contas);
      setRes({ ...r, chave });
      if (contaId !== "all" && !r.contas.some((c) => c.id === contaId)) setContaId("all");
    } catch (e) {
      if (id !== seq.current) return;
      setErro(e);
      os.notify(os.errMsg(e), "err");
    } finally {
      if (id === seq.current) setCarregando(false);
    }
  }
  useEffect(() => { carregar(); }, [chave]);
  os.useAoDesfazer(ESCOPO, carregar);

  const pronto = !!res && res.chave === chave;
  const loading = !pronto;
  const z = (pronto && res.fluxo && res.fluxo.summary) || { initialBalance: 0, totalEntries: 0, totalExits: 0, periodResult: 0, finalBalance: 0 };
  const timeline = (pronto && res.fluxo && res.fluxo.timeline) || [];
  const rotuloMes = `${MESES[Number(mes)]} · ${ano}`;
  const lancPorId = useMemo(() => new Map(((res && res.lancamentos) || []).map((l) => [l.id, l])), [res]);
  const opcoesConta = [["all", "Todas as contas"], ...contas.map((c) => [c.id, rotuloConta(c)])];

  async function confirmarRemocao(l) {
    try {
      const { data: antes, error: e1 } = await os.sb.from("fin_lancamentos").select("*").eq("id", l.id).single();
      if (e1) throw e1;
      const { data: depois, error } = await os.sb.from("fin_lancamentos")
        .update({ cancelado_em: new Date().toISOString() }).eq("id", l.id).select("*").single();
      if (error) throw error;
      os.registrarDesfazer(ESCOPO, "Remover lançamento", os.desfazerEdicao("fin_lancamentos", antes, depois, "Remover lançamento"),
        { mensagem: "Registro(s) cancelado(s) com histórico preservado." });
      carregar();
    } catch (e) { os.notify(os.errMsg(e), "err"); }
  }

  const kpis = [
    { rotulo: "Saldo inicial", valor: z.initialBalance, icone: "wallet", tom: "slate" },
    { rotulo: "Entradas", valor: z.totalEntries, icone: "arrow-up-right", tom: "emerald" },
    { rotulo: "Saídas", valor: -Math.abs(z.totalExits), icone: "arrow-down-right", tom: "dark" },
    { rotulo: "Geração de Caixa", valor: z.periodResult, icone: "activity", tom: z.periodResult >= 0 ? "emerald-soft" : "negative" },
    { rotulo: "Saldo final", valor: z.finalBalance, icone: "landmark", tom: "light" },
  ];

  let corpo;
  if (erro && !carregando) {
    corpo = html`<${ErroCarga} titulo="Não foi possível carregar o fluxo" onRetry=${carregar} />`;
  } else if (pronto && !contas.length) {
    corpo = html`<section class="rounded-[1.6rem] border border-dashed border-slate-200 bg-white p-10 text-center">
      <h2 class="font-black text-slate-900">Nenhuma conta bancária cadastrada</h2>
      <p class="mt-2 text-sm font-medium text-slate-500">Cadastre o banco e o saldo inicial para acompanhar o Fluxo de Caixa.</p>
      <a href="#/financeiro/contas" class="premium-button-primary mt-5 h-11 px-5 text-xs">Cadastrar conta</a>
    </section>`;
  } else if (visao === "payables") {
    corpo = html`<${ContasAPagar} data=${pronto ? res.prev : null} loading=${loading} ano=${Number(ano)} mes=${Number(mes)} />`;
  } else {
    corpo = html`
      <section aria-label="Resumo do caixa" class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,253px),1fr))] gap-4">
        ${kpis.map((k) => html`<${KpiCard} key=${k.rotulo} ...${k} carregando=${loading} />`)}
      </section>
      <${EntradasSaidas} data=${timeline} loading=${loading} periodLabel=${visao === "monthly" ? rotuloMes : ano} />
      ${visao === "monthly"
        ? html`<${Detalhamento} rows=${(pronto && res.fluxo.detailRows) || []} loading=${loading} periodLabel=${rotuloMes}
            lancPorId=${lancPorId} podeEditar=${podeEditar}
            onEditar=${(l) => setForm({ lancamento: l })} onRemover=${(l) => setRemover(l)} />`
        : html`<${GraficoSaldo} key=${chave} data=${timeline} carregando=${loading} periodLabel=${ano} />
            <${ResumoPeriodo} data=${timeline} loading=${loading} />`}`;
  }

  return html`
    <${FinPage}>
      <${CabecalhoFin} titulo="Fluxo de Caixa">
        ${podeEditar ? html`<button type="button" onClick=${() => setForm({})}
          class="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 text-xs font-bold text-slate-800 shadow-sm transition hover:border-emerald-300 hover:text-emerald-800">
          <${Icone} nome="plus" class="h-4 w-4" /> Novo lançamento</button>` : null}
        <${BotaoPrimario} href="#/financeiro/importacao" icone="upload">Importar extrato<//>
      <//>

      <section class="flex flex-col gap-3 rounded-[1.35rem] border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center">
        <${AbasToggle} opcoes=${VISOES} valor=${visao} onChange=${setView} />
        <div class="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
          <${FiltroSelect} rotulo="Ano" valor=${ano} onChange=${setAno} opcoes=${ANOS_FILTRO.map((a) => [String(a), String(a)])} />
          <${FiltroSelect} rotulo="Mês" valor=${mes} onChange=${setMes} disabled=${visao === "consolidated"}
            opcoes=${MESES.map((m, i) => [String(i), m])} />
          <${FiltroSelect} rotulo="Conta bancária" valor=${contaId} onChange=${setContaId} opcoes=${opcoesConta} />
        </div>
      </section>

      ${carregando && pronto ? html`<div class="fixed right-5 top-24 z-20 flex items-center gap-2 rounded-full border border-emerald-100 bg-white px-3 py-2 text-[14.5px] font-black uppercase tracking-widest text-emerald-700 shadow-lg">
        <${Icone} nome="loader" class="h-3 w-3 fin-spin" />Atualizando</div>` : null}

      ${corpo}
    <//>
    ${form ? html`<${ModalLancamento} lancamento=${form.lancamento} contas=${contas}
      contaPadrao=${contaId !== "all" ? contaId : ""}
      dataPadrao=${visao !== "consolidated" && !hojeIso().startsWith(`${ano}-${String(Number(mes) + 1).padStart(2, "0")}`)
        ? periodo(Number(ano), Number(mes)).inicio : hojeIso()}
      onClose=${() => setForm(null)} onSalvo=${() => { setForm(null); carregar(); }} />` : null}
    <${ConfirmDialog} aberto=${!!remover} titulo="Remover lançamento?"
      descricao="Os registros serão cancelados e deixarão de aparecer nos relatórios. O histórico permanecerá preservado para auditoria."
      textoConfirmar="Cancelar registros" textoCancelar="Voltar" variante="danger"
      onConfirm=${() => remover && confirmarRemocao(remover)} onClose=${() => setRemover(null)} />`;
}

/* ============================ Consolidado / Mensal ============================ */
function Carregando() {
  return html`<div role="status" class="mt-6 h-64 animate-pulse rounded-xl bg-slate-100"><span class="sr-only">Carregando gráfico...</span></div>`;
}
function SemMovimento() {
  return html`<div class="flex h-48 items-center justify-center px-4 text-center text-sm font-medium text-slate-500">${SEM_MOVIMENTO}</div>`;
}

/** "Entradas e saídas": um bloco por mês com Geração de Caixa e 2 barras (Craft 487/eq). */
function EntradasSaidas({ data, loading, periodLabel }) {
  const max = Math.max(1, ...data.flatMap((d) => [Number(d.entries), Math.abs(Number(d.exits))]));
  return html`<section class="rounded-[1.6rem] border border-slate-200 bg-white p-5 md:p-7" aria-label="Entradas e saídas por mês">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-xl font-black tracking-tight">Entradas e saídas</h2>
      <span class="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">${periodLabel}</span>
    </div>
    ${loading ? html`<${Carregando} />` : !data.length ? html`<${SemMovimento} />` : html`
      <div class="mt-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,427px),1fr))] gap-x-10">
        ${data.map((e) => html`<article key=${e.key} class="min-w-0 border-t border-slate-100 py-5">
          <header class="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-sm font-extrabold capitalize">${e.label}</h3>
            <p class="flex flex-wrap items-center gap-x-2 text-xs text-slate-500">Geração de Caixa
              <span class=${cn("font-bold tabular-nums", e.result < 0 ? "text-rose-700" : "text-emerald-700")}>${brl(e.result)}</span></p>
          </header>
          <${Barra} rotulo="Entradas" valor=${e.entries} max=${max} cor="bg-emerald-500" />
          <${Barra} rotulo="Saídas" valor=${Math.abs(e.exits)} max=${max} cor="bg-[#07110e]" />
        </article>`)}
      </div>`}
  </section>`;
}
function Barra({ rotulo, valor, max, cor }) {
  return html`<div class="mt-3 grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 text-xs sm:text-sm">
    <span class="text-slate-600">${rotulo}</span>
    <div aria-hidden="true" class="h-2.5 overflow-hidden rounded-full bg-[#eef3f0]">
      <div class=${cn("h-full rounded-full", cor)} style=${`width:${(valor / max) * 100}%`}></div></div>
    <span class="min-w-[7.5rem] text-right font-bold tabular-nums text-slate-800">${brl(valor)}</span>
  </div>`;
}

/** "Resumo por período" (Craft 487/Q2). */
function Cel({ v, positivo, negativo, forte }) {
  return html`<td class=${cn("whitespace-nowrap px-5 py-4 text-right tabular-nums",
    positivo && "text-emerald-700", negativo && "text-slate-600", forte && "bg-emerald-50/50 font-extrabold text-emerald-950",
    v < 0 && !negativo && "text-rose-700")}>${brl(Number(v || 0))}</td>`;
}
function ResumoPeriodo({ data, loading }) {
  return html`<section class="min-w-0 overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white">
    <div class="border-b border-slate-100 p-5 md:p-7"><h2 class="text-xl font-black tracking-tight">Resumo por período</h2></div>
    <div class="overflow-x-auto"><table class="w-full min-w-[1067px] text-left">
      <caption class="sr-only">Saldos e movimentações por período</caption>
      <thead><tr class="bg-[#f5f8f6] text-xs font-bold text-slate-600">
        <th scope="col" class="px-6 py-4">Período</th>
        <th scope="col" class="px-5 py-4 text-right">Saldo inicial</th>
        <th scope="col" class="px-5 py-4 text-right">Entradas</th>
        <th scope="col" class="px-5 py-4 text-right">Saídas</th>
        <th scope="col" class="px-5 py-4 text-right">Geração de Caixa</th>
        <th scope="col" class="px-6 py-4 text-right">Saldo final</th>
      </tr></thead>
      <tbody>
        ${loading ? html`<tr><td colSpan="6" class="p-12 text-center text-sm font-medium text-slate-500">Calculando fluxo...</td></tr>`
          : !data.length ? html`<tr><td colSpan="6"><${SemMovimento} /></td></tr>`
          : data.map((e) => html`<tr key=${e.key} class="border-t border-slate-100 text-sm font-semibold transition-colors hover:bg-[#f8faf9]">
              <th scope="row" class="px-6 py-4 font-bold capitalize text-slate-800">${e.label}</th>
              <${Cel} v=${e.openingBalance} />
              <${Cel} v=${e.entries} positivo />
              <${Cel} v=${-Math.abs(e.exits)} negativo />
              <${Cel} v=${e.result} />
              <${Cel} v=${e.closingBalance} forte />
            </tr>`)}
      </tbody>
    </table></div>
  </section>`;
}

/** "Detalhamento mensal / Movimentações do período" (Craft 487/SE) + ações nos lançamentos manuais. */
function Detalhamento({ rows, loading, periodLabel, lancPorId, podeEditar, onEditar, onRemover }) {
  const entradas = rows.filter((r) => Number(r.amount) > 0), saidas = rows.filter((r) => Number(r.amount) < 0);
  const props = { lancPorId, podeEditar, onEditar, onRemover };
  return html`<section class="rounded-[1.6rem] border border-slate-200 bg-white p-5 md:p-7" aria-label=${"Movimentações de " + periodLabel}>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p class="text-[14.5px] font-black uppercase tracking-[0.18em] text-emerald-700">Detalhamento mensal</p>
        <h2 class="mt-1 text-xl font-black tracking-tight">Movimentações do período</h2>
      </div>
      <span class="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">${periodLabel}</span>
    </div>
    ${loading ? html`<${Carregando} />` : html`<div class="mt-5 grid gap-5 lg:grid-cols-2">
      <${ListaMov} titulo="Entradas" rows=${entradas} positivo ...${props} />
      <${ListaMov} titulo="Saídas" rows=${saidas} ...${props} />
    </div>`}
  </section>`;
}
function ListaMov({ titulo, rows, positivo, lancPorId, podeEditar, onEditar, onRemover }) {
  const total = rows.reduce((a, r) => a + Math.abs(Number(r.amount || 0)), 0);
  return html`<article class="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-[#f8faf9]">
    <header class="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4">
      <div>
        <h3 class="font-black text-slate-900">${titulo}</h3>
        <p class="mt-0.5 text-[14.5px] font-bold text-slate-400">${rows.length} movimentação(ões)</p>
      </div>
      <strong class=${cn("text-sm tabular-nums", positivo ? "text-emerald-700" : "text-slate-900")}>${brl(positivo ? total : -total)}</strong>
    </header>
    <div class="max-h-[30rem] overflow-y-auto">
      ${rows.length ? rows.map((r) => {
        const l = lancPorId.get(r.id);
        const manual = podeEditar && l && l.origem === "manual";
        return html`<div key=${r.id} class="group grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-slate-200/70 px-4 py-3 last:border-0">
          <div class="min-w-0">
            <p class="truncate text-sm font-bold text-slate-800" title=${r.description}>${r.description}</p>
            <p class="mt-1 text-[14.5px] font-semibold text-slate-400">${dataBR(r.date)} · ${[r.bankName, r.accountName].filter(Boolean).join(" · ")}${l && l.origem === "manual" ? " · Manual" : ""}</p>
          </div>
          <div class="flex items-center gap-1 self-center">
            <span class=${cn("whitespace-nowrap text-sm font-black tabular-nums", positivo ? "text-emerald-700" : "text-slate-900")}>${brl(Number(r.amount || 0))}</span>
            ${manual ? html`
              <button type="button" onClick=${() => onEditar(l)} title="Editar lançamento" aria-label=${"Editar lançamento " + r.description}
                class="ml-1 rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-emerald-700"><${Icone} nome="pencil" class="h-3.5 w-3.5" /></button>
              <button type="button" onClick=${() => onRemover(l)} title="Remover lançamento" aria-label=${"Remover lançamento " + r.description}
                class="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-rose-700"><${Icone} nome="trash" class="h-3.5 w-3.5" /></button>` : null}
          </div>
        </div>`;
      }) : html`<div class="flex h-36 items-center justify-center px-4 text-center text-sm font-medium text-slate-400">Nenhuma ${titulo.toLowerCase()} neste mês.</div>`}
    </div>
  </article>`;
}

/* ============================ Contas a Pagar ============================ */
function CardPagar({ icone, rotulo, valor, escuro, destaque }) {
  return html`<article class=${cn("rounded-[1.35rem] border p-5",
    escuro ? "border-[#07110e] bg-[#07110e] text-white" : destaque ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-white text-slate-950")}>
    <div class="flex items-center justify-between gap-3">
      <p class="text-xs font-bold">${rotulo}</p><${Icone} nome=${icone} class="h-4 w-4 opacity-60" />
    </div>
    <p class="mt-6 text-[29.5px] font-black tracking-tight tabular-nums">${brl(Number(valor || 0))}</p>
  </article>`;
}

/** Contas a Pagar (Craft 487/KY): 3 cards + calendário SEG..DOM + painel do dia. Nada é gravado. */
function ContasAPagar({ data, loading, ano, mes }) {
  const pagamentos = (data && data.payments) || [];
  const porDia = useMemo(() => {
    const m = new Map();
    pagamentos.forEach((p) => { const d = Number(p.date.slice(8, 10)); m.set(d, [...(m.get(d) || []), p]); });
    return m;
  }, [pagamentos]);
  const [dia, setDia] = useState(null);
  useEffect(() => { setDia(pagamentos.length ? Number(pagamentos[0].date.slice(8, 10)) : null); }, [data]);
  if (loading) return html`<section class="rounded-[1.6rem] border border-slate-200 bg-white p-7"><${Carregando} /></section>`;
  const brancos = (new Date(Date.UTC(ano, mes, 1)).getUTCDay() + 6) % 7;
  const dias = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const doDia = (dia && porDia.get(dia)) || [];
  const w = (data && data.summary) || { openingBalance: 0, baseBalance: 0, totalProjected: 0, projectedBalance: 0, paymentCount: 0 };
  const ultimo = doDia.length ? doDia[doDia.length - 1].balanceAfter : undefined;
  const saldoApos = ultimo != null ? ultimo : w.baseBalance != null ? w.baseBalance : w.openingBalance;
  return html`<div class="space-y-5">
    <section class="grid gap-4 md:grid-cols-3" aria-label="Resumo das contas a pagar">
      <${CardPagar} icone="wallet" rotulo="Saldo antes das projeções" valor=${w.baseBalance != null ? w.baseBalance : w.openingBalance} />
      <${CardPagar} icone="receipt" rotulo="Pagamentos previstos" valor=${-Math.abs(w.totalProjected)} escuro />
      <${CardPagar} icone="landmark" rotulo="Saldo projetado" valor=${w.projectedBalance} destaque />
    </section>
    <section class="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(427px,.65fr)]">
      <div class="rounded-[1.6rem] border border-slate-200 bg-white p-5 md:p-7">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-[14.5px] font-black uppercase tracking-[0.18em] text-emerald-700">Previsão recorrente</p>
            <h2 class="mt-1 text-xl font-black">Calendário de pagamentos</h2>
          </div>
          <${Icone} nome="calendar" class="h-5 w-5 text-emerald-600" />
        </div>
        <div class="mt-5 grid grid-cols-7 text-center text-[13.5px] font-black uppercase tracking-widest text-slate-400">
          ${DIAS_SEMANA.map((d) => html`<span key=${d} class="py-2">${d}</span>`)}
        </div>
        <div class="grid grid-cols-7 gap-1.5">
          ${Array.from({ length: brancos }).map((_, i) => html`<span key=${"b" + i}></span>`)}
          ${Array.from({ length: dias }, (_, i) => i + 1).map((d) => {
            const ps = porDia.get(d) || [], total = ps.reduce((a, p) => a + p.amount, 0), sel = dia === d;
            return html`<button key=${d} type="button" onClick=${() => setDia(d)} aria-pressed=${sel}
              aria-label=${`Dia ${d}` + (ps.length ? `: ${ps.length} pagamento(s) previsto(s), ${brl(-total)}` : "")}
              class=${cn("min-h-20 rounded-xl border p-2 text-left transition",
                sel ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100"
                  : ps.length ? "border-emerald-200 bg-white hover:border-emerald-400"
                  : "border-transparent bg-slate-50 text-slate-400 hover:border-slate-200")}>
              <span class="text-xs font-black">${d}</span>
              ${ps.length ? html`<span class="mt-3 block h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                <span class="mt-1 block truncate text-[13.5px] font-black text-slate-700">${brl(-total)}</span>` : null}
            </button>`;
          })}
        </div>
      </div>
      <aside class="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white">
        <header class="border-b border-slate-100 p-5">
          <p class="text-[14.5px] font-black uppercase tracking-[0.18em] text-emerald-700">${dia ? `Dia ${String(dia).padStart(2, "0")}` : "Selecione uma data"}</p>
          <h2 class="mt-1 text-xl font-black">Pagamentos previstos</h2>
        </header>
        <div class="max-h-[32rem] overflow-y-auto p-4">
          ${doDia.length ? doDia.map((p) => html`<article key=${p.id} class="border-b border-slate-100 p-3 last:border-0">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <p class="text-sm font-black text-slate-800">${p.description}</p>
                <p class="mt-1 text-[14.5px] font-semibold text-slate-400">${[p.bankName, p.accountName].filter(Boolean).join(" · ")} · ${p.occurrences} ocorrências</p>
              </div>
              <strong class="whitespace-nowrap text-sm text-slate-950">${brl(-p.amount)}</strong>
            </div>
          </article>`) : html`<div class="flex h-40 items-center justify-center px-5 text-center text-sm font-medium text-slate-400">Nenhum pagamento recorrente previsto para esta data.</div>`}
        </div>
        <footer class="border-t border-slate-100 bg-emerald-50 p-5">
          <p class="text-[14.5px] font-black uppercase tracking-widest text-emerald-700">Saldo após esta data</p>
          <p class="mt-2 text-xl font-black tabular-nums text-emerald-950">${brl(saldoApos)}</p>
        </footer>
      </aside>
    </section>
    <p class="px-1 text-[14.5px] font-semibold text-slate-400">Projeção informativa baseada em pelo menos três pagamentos conciliados do mesmo histórico. Nenhum lançamento é criado automaticamente.</p>
  </div>`;
}

/* ============================ Novo lançamento / editar (manual) ============================ */
const CAMPO = "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100";
function Campo({ rotulo, children, dica }) {
  return html`<label class="block">
    <span class="mb-1.5 block text-xs font-black uppercase tracking-widest text-slate-500">${rotulo}</span>
    ${children}
    ${dica ? html`<span class="mt-1 block text-xs font-medium text-slate-400">${dica}</span>` : null}
  </label>`;
}

/** Modal do lançamento manual (decisão da Tia): grava origem='manual', conciliado=true, valor com sinal. */
function ModalLancamento({ lancamento, contas, contaPadrao, dataPadrao, onClose, onSalvo }) {
  const editando = !!lancamento;
  const ativas = contas.filter((c) => c.ativo !== false || (lancamento && c.id === lancamento.conta_id));
  const [f, setF] = useState(() => editando ? {
    data: lancamento.data, conta_id: lancamento.conta_id, historico: lancamento.historico || "",
    tipo: Number(lancamento.valor) < 0 ? "saida" : "entrada",
    valor: Math.abs(Number(lancamento.valor)).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    categoria_id: lancamento.categoria_id || "", observacao: lancamento.observacao || "",
  } : {
    data: dataPadrao, conta_id: contaPadrao || (ativas.length === 1 ? ativas[0].id : ""), historico: "",
    tipo: "saida", valor: "", categoria_id: "", observacao: "",
  });
  const [cat, setCat] = useState(null); // { grupos, categorias } | { erro }
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (k) => (e) => setF((o) => ({ ...o, [k]: e && e.target ? e.target.value : e }));

  async function carregarCategorias() {
    setCat(null);
    try {
      const [grupos, categorias] = await Promise.all([fetchGrupos(), fetchCategorias({ incluirArquivadas: true })]);
      setCat({ grupos, categorias });
    } catch (e) { setCat({ erro: os.errMsg(e) }); }
  }
  useEffect(() => { carregarCategorias(); }, []);

  const opcoesCategoria = useMemo(() => {
    if (!cat || cat.erro) return [];
    const visivel = (c) => c.ativa || c.id === f.categoria_id;
    const grupos = cat.grupos.filter((g) => g.tipo !== "formula").map((g) => ({
      grupo: nomeDre(g.nome),
      itens: cat.categorias.filter((c) => c.grupo_id === g.id && !c.fora_dre && visivel(c)).sort((a, b) => a.ordem - b.ordem).map((c) => [c.id, c.nome]),
    })).filter((g) => g.itens.length);
    const fora = cat.categorias.filter((c) => c.fora_dre && visivel(c)).sort((a, b) => a.ordem - b.ordem).map((c) => [c.id, c.nome]);
    if (fora.length) grupos.push({ grupo: "Fora da DRE", itens: fora });
    return grupos;
  }, [cat, f.categoria_id]);

  async function salvar(e) {
    e.preventDefault();
    setMsg("");
    const historico = f.historico.trim(), v = parseValorBR(f.valor);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.data || "")) return setMsg("Informe a data.");
    if (!f.conta_id) return setMsg("Selecione a conta bancária.");
    if (!historico) return setMsg("Informe o histórico.");
    if (!Number.isFinite(v) || Math.abs(v) < 0.005) return setMsg("Informe um valor maior que zero.");
    if (!f.categoria_id) return setMsg("Selecione uma categoria.");
    const valor = r2(Math.abs(v)) * (f.tipo === "saida" ? -1 : 1);
    const campos = { data: f.data, conta_id: f.conta_id, historico, valor, categoria_id: f.categoria_id, observacao: f.observacao.trim() || null };
    setSalvando(true);
    try {
      if (editando) {
        const { data: antes, error: e1 } = await os.sb.from("fin_lancamentos").select("*").eq("id", lancamento.id).single();
        if (e1) throw e1;
        const { data: depois, error } = await os.sb.from("fin_lancamentos").update(campos).eq("id", lancamento.id).select("*").single();
        if (error) throw error;
        os.registrarDesfazer(ESCOPO, "Editar lançamento", os.desfazerEdicao("fin_lancamentos", antes, depois, "Editar lançamento"),
          { mensagem: "Lançamento atualizado e relatórios recalculados." });
      } else {
        const { data: novo, error } = await os.sb.from("fin_lancamentos")
          .insert({ ...campos, origem: "manual", conciliado: true }).select("*").single();
        if (error) throw error;
        os.registrarDesfazer(ESCOPO, "Novo lançamento", os.desfazerCriacao("fin_lancamentos", novo, "Novo lançamento"),
          { mensagem: "Lançamento registrado e já conciliado." });
      }
      onSalvo();
    } catch (err) {
      setMsg(os.errMsg(err));
      setSalvando(false);
    }
  }

  const Modal = os.Modal;
  return html`<${Modal} title=${editando ? "Editar lançamento" : "Novo lançamento"} onClose=${onClose} wide>
    <form onSubmit=${salvar} class="space-y-4" style=${"font-family:Inter, ui-sans-serif, system-ui, sans-serif"}>
      ${!ativas.length ? html`<p class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
        Nenhuma conta bancária ativa. <a class="underline" href="#/financeiro/contas" onClick=${onClose}>Cadastrar conta</a></p>` : null}
      <div class="flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Tipo">
        ${[["entrada", "Entrada"], ["saida", "Saída"]].map(([v, r]) => html`<button type="button" aria-pressed=${f.tipo === v}
          onClick=${() => setF((o) => ({ ...o, tipo: v }))}
          class=${cn("flex-1 rounded-lg px-4 py-2.5 text-xs font-black uppercase tracking-widest transition",
            f.tipo === v ? (v === "entrada" ? "bg-emerald-500 text-[#07110e] shadow" : "bg-[#07110e] text-white shadow") : "text-slate-500")}>${r}</button>`)}
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <${Campo} rotulo="Data"><input type="date" required value=${f.data} onInput=${set("data")} class=${CAMPO} /><//>
        <${Campo} rotulo="Valor" dica="Ex.: 1.250,90"><input inputmode="decimal" required placeholder="0,00" value=${f.valor} onInput=${set("valor")} class=${cn(CAMPO, "tabular-nums")} /><//>
      </div>
      <${Campo} rotulo="Histórico"><input required maxLength="300" placeholder="Ex.: Aluguel do escritório" value=${f.historico} onInput=${set("historico")} class=${CAMPO} /><//>
      <div class="grid gap-4 sm:grid-cols-2">
        <${Campo} rotulo="Conta bancária">
          <select required value=${f.conta_id} onChange=${set("conta_id")} class=${CAMPO}>
            <option value="">Selecionar conta...</option>
            ${ativas.map((c) => html`<option value=${c.id}>${rotuloConta(c)}</option>`)}
          </select><//>
        <${Campo} rotulo="Categoria DRE">
          ${cat && cat.erro ? html`<p class="text-sm font-semibold text-rose-700">Não foi possível carregar as categorias.
              <button type="button" class="underline" onClick=${carregarCategorias}>Tentar novamente</button></p>`
            : html`<select required value=${f.categoria_id} onChange=${set("categoria_id")} disabled=${!cat} class=${CAMPO}>
              <option value="">${cat ? "Selecionar categoria..." : "Carregando..."}</option>
              ${opcoesCategoria.map((g) => html`<optgroup label=${g.grupo}>${g.itens.map((o) => html`<option value=${o[0]}>${o[1]}</option>`)}</optgroup>`)}
            </select>`}<//>
      </div>
      <${Campo} rotulo="Observação (opcional)"><textarea rows="2" value=${f.observacao} onInput=${set("observacao")} class=${CAMPO}></textarea><//>
      <p class="text-xs font-semibold text-slate-400">O lançamento manual entra já conciliado: aparece no Fluxo de Caixa e, se a categoria for de uma linha da DRE, na DRE.</p>
      ${msg ? html`<p role="alert" class="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">${msg}</p>` : null}
      <div class="flex justify-end gap-3 pt-1">
        <button type="button" onClick=${onClose} class="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-900">Cancelar</button>
        <button type="submit" disabled=${salvando || !ativas.length}
          class="inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-xs font-bold text-white shadow-[0_18px_38px_-18px_rgba(6,78,59,0.75)] disabled:opacity-50"
          style="background-image:linear-gradient(to right,#022c22,#064e3b,#0f172a)">
          ${salvando ? html`<${Icone} nome="loader" class="h-4 w-4 fin-spin" />` : html`<${Icone} nome="check" class="h-4 w-4" />`}
          ${editando ? "Salvar alterações" : "Registrar lançamento"}</button>
      </div>
    </form>
  <//>`;
}

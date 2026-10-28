// Financeiro · Relatório de Vendas — tela do Craft Green "Relatório de Vendas" (ref app_faturamento-plataformas_page).
// Spec: docs/financeiro-spec.md (3.4). Base compartilhada: ./comum.js (não editar lá).
// Props do Router (#/financeiro/vendas): me (linha de profiles) e query (objeto da query string).
// Tela só de leitura (não grava nada; a importação é feita em #/financeiro/importacao?source=platform).
import { html } from "htm/preact";
import { useState, useEffect, useMemo, useRef } from "preact/hooks";
import { os, FinPage, Icone, cn, brl, fetchVendas, periodo, normalizarTexto, useLocalState, MESES_CURTOS } from "./comum.js";

/* Ícones Lucide que não estão no ICONES de comum.js (ISC). */
const SVG_LOCAL = {
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
};
function IconeLocal({ nome, class: cls = "h-4 w-4" }) {
  if (!SVG_LOCAL[nome]) return html`<${Icone} nome=${nome} class=${cls} />`;
  return html`<svg class=${cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: SVG_LOCAL[nome] }}></svg>`;
}

const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => Number(v) || 0;

/** Resumo mensal por competência (formato do /platform-billing/summary do Craft: índice 0..11). */
function resumoMensal(vendas) {
  const meses = Array.from({ length: 12 }, () => ({ bruto: 0, canceladas: 0, coprodutor: 0, taxaProcessamento: 0, taxaStreaming: 0, liquido: 0 }));
  for (const v of vendas) {
    const m = Number(String(v.data_competencia || "").slice(5, 7)) - 1;
    if (!(m >= 0 && m < 12)) continue;
    const o = meses[m];
    o.bruto = r2(o.bruto + num(v.bruto));
    o.canceladas = r2(o.canceladas + Math.abs(num(v.reembolso)));
    o.coprodutor = r2(o.coprodutor + Math.abs(num(v.coproducao)));
    o.taxaProcessamento = r2(o.taxaProcessamento + Math.abs(num(v.taxa_processamento)));
    o.taxaStreaming = r2(o.taxaStreaming + Math.abs(num(v.taxa_streaming)));
    o.liquido = r2(o.liquido + num(v.liquido));
  }
  return meses;
}

/** Eduzz por produto, pela data de pagamento (Craft /platform-billing/eduzz/products). Faturamento = bruto
 *  (na Eduzz o "Ganho Líquido" já é gravado como bruto pela importação). */
async function fetchEduzzProdutos(ano) {
  const { inicio, fim } = periodo(ano, null);
  const todas = await fetchVendas({ inicio, fim, campo: "data_pagamento" });
  const porProduto = new Map();
  let revenue = 0, salesCount = 0;
  for (const v of todas) {
    if (normalizarTexto(v.plataforma).trim() !== "eduzz") continue;
    const nome = (v.produto || "").trim() || "Produto sem nome";
    const p = porProduto.get(nome) || { product: nome, salesCount: 0, revenue: 0 };
    p.salesCount += 1;
    p.revenue = r2(p.revenue + num(v.bruto));
    porProduto.set(nome, p);
    revenue = r2(revenue + num(v.bruto));
    salesCount += 1;
  }
  const products = [...porProduto.values()].sort((a, b) => b.revenue - a.revenue || a.product.localeCompare(b.product, "pt-BR"));
  return { revenue, salesCount, products };
}

function LinhaResumo({ label, dataKey, data, color }) {
  return html`<tr class=${cn("transition-colors hover:bg-slate-50/50", dataKey === "canceladas" && "bg-rose-50/40")}>
    <td class="px-10 py-6 text-sm font-bold text-slate-600">${label}</td>
    ${MESES_CURTOS.map((_, i) => html`<td key=${i} class=${cn("whitespace-nowrap px-6 py-6 text-center text-[17.5px]", color)}>
      ${num(data[i] && data[i][dataKey]) ? brl(data[i][dataKey]) : "—"}</td>`)}
  </tr>`;
}

export function VendasPage() {
  const [ano, setAno] = useLocalState("vendas:ano", new Date().getFullYear());
  // Resumo (competência)
  const [resumo, setResumo] = useState(null); // null = carregando pela 1ª vez
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState(null);
  // Eduzz (pagamento)
  const [eduzz, setEduzz] = useState(null);
  const [erroEduzz, setErroEduzz] = useState(null);
  const pedido = useRef(0), pedidoEduzz = useRef(0);

  async function carregarResumo() {
    const id = ++pedido.current;
    setAtualizando(true); setErro(null);
    try {
      const { inicio, fim } = periodo(ano, null);
      const vendas = await fetchVendas({ inicio, fim, campo: "data_competencia" });
      if (id === pedido.current) setResumo(resumoMensal(vendas));
    } catch (e) {
      if (id === pedido.current) setErro(e);
    } finally {
      if (id === pedido.current) setAtualizando(false);
    }
  }
  async function carregarEduzz() {
    const id = ++pedidoEduzz.current;
    setEduzz(null); setErroEduzz(null);
    try {
      const r = await fetchEduzzProdutos(ano);
      if (id === pedidoEduzz.current) setEduzz(r);
    } catch (e) {
      if (id === pedidoEduzz.current) setErroEduzz(e);
    }
  }
  useEffect(() => { setResumo(null); carregarResumo(); carregarEduzz(); }, [ano]);

  const carregando = resumo === null && !erro;
  const dados = resumo || [];
  const totais = useMemo(() => dados.reduce((t, m) => ({
    bruto: t.bruto + m.bruto, canceladas: t.canceladas + m.canceladas, coprodutor: t.coprodutor + m.coprodutor,
    taxas: t.taxas + m.taxaProcessamento + m.taxaStreaming, liquido: t.liquido + m.liquido,
  }), { bruto: 0, canceladas: 0, coprodutor: 0, taxas: 0, liquido: 0 }), [resumo]);
  const cards = [
    { label: "Faturamento Bruto", value: totais.bruto, icon: "trending-up", color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Reembolsos", value: totais.canceladas, icon: "rotate", color: "text-rose-700", bg: "bg-rose-50" },
    { label: "Coprodução", value: totais.coprodutor, icon: "users", color: "text-slate-800", bg: "bg-slate-100" },
    { label: "Taxas Totais", value: totais.taxas, icon: "credit-card", color: "text-slate-600", bg: "bg-slate-100" },
    { label: "Faturamento Líquido", value: totais.liquido, icon: "wallet", color: "text-emerald-800", bg: "bg-emerald-100" },
  ];
  const sombra = "shadow-[0_20px_50px_-20px_rgba(0,0,0,0.05)]";

  return html`<${FinPage} class="space-y-6 pb-20 md:space-y-10">
    <div class="flex flex-col justify-between gap-6 md:flex-row md:items-center">
      <div class="space-y-1">
        <h1 class="text-2xl font-black tracking-tighter text-slate-900 md:text-3xl">Relatório de Vendas</h1>
        <p class="text-[16px] font-medium uppercase tracking-widest text-slate-500 md:text-xs">Vendas por competência das plataformas</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm" role="group" aria-label="Ano">
          <button type="button" onClick=${() => setAno(ano - 1)} class="rounded-xl px-4 py-2 text-xs font-black text-slate-400 hover:bg-slate-50 hover:text-slate-900">${ano - 1}</button>
          <div aria-current="true" class="rounded-xl bg-slate-900 px-6 py-2 text-xs font-black text-white shadow-lg shadow-slate-200">${ano}</div>
          <button type="button" onClick=${() => setAno(ano + 1)} class="rounded-xl px-4 py-2 text-xs font-black text-slate-400 hover:bg-slate-50 hover:text-slate-900">${ano + 1}</button>
        </div>
      </div>
      <a href="#/financeiro/importacao?source=platform" class="premium-button-primary"><${Icone} nome="upload" class="h-4 w-4" />Importar vendas</a>
    </div>

    ${erro ? html`<div role="alert" class="flex flex-wrap items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <${Icone} nome="alert" class="h-5 w-5" />
      <span>Não foi possível carregar as vendas. ${os.errMsg ? os.errMsg(erro) : ""}</span>
      <button type="button" onClick=${carregarResumo} class="font-bold underline">Tentar novamente</button>
    </div>` : null}
    ${atualizando && resumo ? html`<p role="status" class="flex items-center gap-2 text-sm text-emerald-800">
      <${Icone} nome="loader" class="h-4 w-4 fin-spin" />Atualizando vendas…</p>` : null}

    <div class="mb-7 grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4" aria-busy=${carregando}>
      ${cards.map((c) => html`<div key=${c.label} class=${cn("group relative overflow-hidden rounded-[1.6rem] border border-white bg-white p-6 transition-all hover:shadow-[0_30px_60px_-20px_rgba(0,0,0,0.08)]", sombra)}>
        <div class=${cn("mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ring-inset transition-transform group-hover:scale-105", c.bg, c.color)}>
          <${IconeLocal} nome=${c.icon} class="h-6 w-6" /></div>
        <p class="text-sm font-bold text-slate-500">${c.label}</p>
        <h3 class=${cn("mt-2 text-2xl font-black [overflow-wrap:anywhere]", c.label === "Reembolsos" ? "text-rose-700" : "text-slate-900")}>
          ${carregando || erro || !resumo ? "—" : brl(c.value)}</h3>
        <div class="absolute -bottom-6 -right-6 h-24 w-24 rounded-full bg-slate-50 opacity-0 transition-opacity group-hover:opacity-100"></div>
      </div>`)}
    </div>

    <div class=${cn("overflow-hidden rounded-[1.6rem] border border-white bg-white", sombra)}>
      <div class="border-b border-slate-50 px-6 py-6 md:px-8">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-xl font-black text-slate-900">Resumo Mensal Consolidado</h3>
            <p class="mt-1 text-xs font-bold uppercase tracking-widest text-slate-400">Visão por competência das plataformas</p>
          </div>
          <div class="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2 text-emerald-600">
            <${IconeLocal} nome="sparkles" class="h-4 w-4" />
            <span class="text-[16px] font-black uppercase tracking-wider">Dados Gerenciais</span>
          </div>
        </div>
      </div>
      ${carregando ? html`<div role="status" class="p-6 md:p-8"><div class="h-64 animate-pulse rounded-xl bg-slate-100"></div><span class="sr-only">Carregando...</span></div>` : html`
      <div class="overflow-x-auto">
        <table class="w-full text-left">
          <thead><tr class="border-b border-slate-50 bg-slate-50/30">
            <th class="px-10 py-6 text-[16px] font-black uppercase tracking-widest text-slate-400">Indicador</th>
            ${MESES_CURTOS.map((m) => html`<th key=${m} class="px-6 py-6 text-center text-[16px] font-black uppercase tracking-widest text-slate-400">${m}</th>`)}
          </tr></thead>
          <tbody class="divide-y divide-slate-50">
            <${LinhaResumo} label="Faturamento Bruto" dataKey="bruto" data=${dados} color="text-slate-900 font-bold" />
            <${LinhaResumo} label="Reembolsos" dataKey="canceladas" data=${dados} color="text-rose-700 font-bold" />
            <${LinhaResumo} label="Faturamento Coprodutor" dataKey="coprodutor" data=${dados} color="text-rose-500" />
            <${LinhaResumo} label="Taxa Processamento" dataKey="taxaProcessamento" data=${dados} color="text-slate-400" />
            <${LinhaResumo} label="Taxa Streaming" dataKey="taxaStreaming" data=${dados} color="text-slate-400" />
            <tr class="bg-slate-50/50">
              <td class="px-10 py-6 text-sm font-black text-emerald-600">Faturamento Líquido</td>
              ${MESES_CURTOS.map((_, i) => html`<td key=${i} class="whitespace-nowrap px-6 py-6 text-center text-sm font-black text-emerald-600">
                ${dados[i] ? brl(dados[i].liquido) : "R$ 0,00"}</td>`)}
            </tr>
          </tbody>
        </table>
      </div>`}
    </div>

    <section class=${cn("overflow-hidden rounded-[1.6rem] border border-emerald-100 bg-white", sombra)} aria-busy=${!eduzz && !erroEduzz}>
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-100 px-6 py-5 md:px-8">
        <div>
          <h3 class="text-xl font-black text-slate-900">Eduzz por produto</h3>
          <p class="mt-1 text-sm text-slate-500">Faturamento pela data de pagamento</p>
        </div>
        <div class="text-left sm:text-right">
          <p class="text-xs font-bold uppercase tracking-wider text-slate-500">Eduzz · ${ano}</p>
          <p class="mt-1 text-xl font-black text-emerald-800">${!eduzz || erroEduzz ? "—" : brl(eduzz.revenue)}</p>
          ${!erroEduzz ? html`<p class="text-xs text-slate-500">${(eduzz && eduzz.salesCount) || 0} lançamentos</p>` : null}
        </div>
      </div>
      ${erroEduzz ? html`<div role="alert" class="px-6 py-5 text-sm text-rose-700">Não foi possível carregar os produtos da Eduzz. <button type="button" onClick=${carregarEduzz} class="font-bold underline">Tentar novamente</button></div>`
        : !eduzz ? html`<p role="status" class="px-6 py-5 text-sm text-slate-500">Carregando produtos…</p>`
        : eduzz.products.length ? html`<div class="overflow-x-auto"><table class="w-full text-left text-sm">
            <thead><tr class="bg-emerald-50/60 text-slate-600">
              <th class="px-6 py-3 font-bold md:px-8">Produto</th>
              <th class="px-4 py-3 text-right font-bold">Lançamentos</th>
              <th class="px-6 py-3 text-right font-bold md:px-8">Faturamento</th>
            </tr></thead>
            <tbody class="divide-y divide-slate-100">
              ${eduzz.products.map((p) => html`<tr key=${p.product} class="hover:bg-emerald-50/30">
                <td class="min-w-56 px-6 py-3 text-slate-800 md:px-8">${p.product}</td>
                <td class="px-4 py-3 text-right text-slate-600">${p.salesCount}</td>
                <td class="whitespace-nowrap px-6 py-3 text-right font-bold text-emerald-800 md:px-8">${brl(p.revenue)}</td>
              </tr>`)}
            </tbody></table></div>`
        : html`<p class="px-6 py-5 text-sm text-slate-500">Nenhuma venda da Eduzz encontrada em ${ano}.</p>`}
    </section>
  <//>`;
}

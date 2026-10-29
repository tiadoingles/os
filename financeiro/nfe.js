// Financeiro · NF-e — situação da nota fiscal de cada venda, lida do IULI (somente leitura).
// Base: ./comum.js (não editar lá). Dados: public.fin_nfe (RLS aba financeiro), preenchida pela Edge Function `iuli`
// (op 'sync', API de Vendas do IULI): cron os-iuli-nfe-2h, botão "Atualizar do IULI" e sozinha ao abrir a tela se a
// última sincronização ok tiver mais de 2 h. A API não traz número, PDF nem XML da nota: "Abrir no IULI" leva à venda
// no painel deles (app.iuli.com.br/dashboard/sales-invoices/<id>), onde a nota é baixada.
import { html } from "htm/preact";
import { useState, useEffect, useMemo, useRef } from "preact/hooks";
import { os, podeEditarFin, FinPage, Icone, KpiCardDestaque, Pill, brl, cn, dataBR, normalizarTexto, useLocalState, MESES, ANOS_FILTRO } from "./comum.js";

const POR_PAGINA = 100;
const AUTO_SYNC_MS = 2 * 60 * 60 * 1000;
const LINK_IULI = "https://app.iuli.com.br/dashboard/sales-invoices/";

/** Situação da nota (invoice.status do IULI) -> grupo do filtro, rótulo e cor. */
const NF = {
  EMITED: ["emitida", "Emitida", "verde"],
  SPLIT_SERVICE_EMITED: ["emitida", "Emitida (serviço)", "verde"],
  FAILED: ["falha", "Falhou", "rosa"],
  SPLIT_PRODUCT_EMITED_SERVICE_FAILED: ["falha", "Produto emitida · serviço falhou", "rosa"],
  SPLIT_SERVICE_EMITED_PRODUCT_FAILED: ["falha", "Serviço emitida · produto falhou", "rosa"],
  PROCESSING: ["pendente", "Processando", "ambar"],
  SCHEDULED_SALE: ["pendente", "Agendada", "neutro"],
  _NOT_REQUESTED_: ["nao_solicitada", "Não solicitada", "neutro"],
  SCHEDULED_CANCEL: ["cancelamento", "Cancelamento agendado", "neutro"],
};
const infoNf = (s) => NF[s] || ["outra", s || "Sem informação", "neutro"];
const SITUACOES = [["all", "Todas as situações"], ["falha", "Com falha"], ["pendente", "Agendada ou processando"], ["emitida", "Emitida"],
  ["nao_solicitada", "Não solicitada"], ["cancelamento", "Cancelamento agendado"], ["outra", "Outras"]];

const STATUS_VENDA = { APPROVED: "Aprovada", COMPLETED: "Concluída", WAITING_PAYMENT: "Aguardando pagamento", REFUNDED: "Reembolsada",
  CHARGEBACK: "Chargeback", DELAYED: "Atrasada", CANCELED: "Cancelada", EXPIRED: "Expirada", IN_ANALYSIS: "Em análise",
  CLAIMED: "Reclamada", MANUAL_REFUND: "Reembolso manual", INITIATED: "Iniciada", BANKSLIP_GENERATED: "Boleto gerado" };
const rotVenda = (s) => STATUS_VENDA[s] || s || "";
const REEMBOLSO = new Set(["REFUNDED", "CHARGEBACK", "MANUAL_REFUND", "CANCELED"]);

function dataHoraBR(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ============================ Dados ============================ */
async function fetchNfe(inicio, fim) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await os.sb.from("fin_nfe").select("*").gte("competencia", inicio).lte("competencia", fim)
      .order("competencia", { ascending: false }).order("iuli_id", { ascending: false }).range(de, de + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
async function fetchStatusSync() {
  const { data, error } = await os.sb.from("sync_status").select("*").eq("chave", "iuli-nfe").maybeSingle();
  if (error) throw error;
  return data || null;
}
async function chamarIuli(body) {
  const { data, error } = await os.sb.functions.invoke("iuli", { body });
  if (error) {
    try { const j = await error.context.json(); if (j && j.error) return { ok: false, ...j }; } catch (_) { /* ignore */ }
    return { ok: false, error: error.message };
  }
  return data || { ok: false, error: "sem resposta" };
}

/** CSV (separador ;, BOM UTF-8, decimal com vírgula) para abrir direto no Excel. */
function baixarCsv(nome, cab, linhas) {
  const esc = (v) => { const t = typeof v === "number" ? String(v).replace(".", ",") : String(v ?? ""); return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = "﻿" + [cab.map(esc).join(";"), ...linhas.map((l) => l.map(esc).join(";"))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = nome + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================ Tela ============================ */
export function NfePage({ me }) {
  const pode = podeEditarFin(me);
  const agora = new Date();
  const [ano, setAno] = useLocalState("nfe:ano", agora.getFullYear());
  const [mes, setMes] = useLocalState("nfe:mes", agora.getMonth()); // 0-11 ou "all"
  const [situacao, setSituacao] = useLocalState("nfe:situacao", "all");
  const [ocultarReemb, setOcultarReemb] = useLocalState("nfe:ocultarReemb", true);
  const [produto, setProduto] = useState("all");
  const [busca, setBusca] = useState("");
  const [linhas, setLinhas] = useState(null);
  const [erroCarga, setErroCarga] = useState(false);
  const [sync, setSync] = useState(null);
  const [pedindoSync, setPedindoSync] = useState(false);
  const [limite, setLimite] = useState(POR_PAGINA);
  const autoFeito = useRef(false);
  const pedido = useRef(0);

  const todoAno = mes === "all";
  const inicio = todoAno ? `${ano}-01-01` : `${ano}-${String(Number(mes) + 1).padStart(2, "0")}-01`;
  const fim = todoAno ? `${ano}-12-31` : new Date(Date.UTC(ano, Number(mes) + 1, 0)).toISOString().slice(0, 10);

  async function carregar() {
    const n = ++pedido.current;
    setErroCarga(false);
    try {
      const [ls, st] = await Promise.all([fetchNfe(inicio, fim), fetchStatusSync().catch(() => null)]);
      if (n !== pedido.current) return;
      setLinhas(ls); setSync(st);
    } catch (e) {
      if (n !== pedido.current) return;
      os.notify(os.errMsg(e), "err"); setErroCarga(true); setLinhas((l) => l || []);
    }
  }
  useEffect(() => { setLinhas(null); carregar(); }, [inicio, fim]);
  // Ao abrir: se a última sincronização ok tem mais de 2 h (ou nunca rodou), sincroniza uma vez em segundo plano.
  useEffect(() => {
    if (autoFeito.current || linhas === null || !pode) return;
    autoFeito.current = true;
    const ultimaOk = sync && sync.ultimo_status === "ok" && sync.ultima_execucao_em ? new Date(sync.ultima_execucao_em).getTime() : 0;
    if (Date.now() - ultimaOk > AUTO_SYNC_MS) sincronizar(false);
  }, [linhas, sync]);
  useEffect(() => { setLimite(POR_PAGINA); }, [inicio, fim, situacao, ocultarReemb, produto, busca]);

  async function sincronizar(manual) {
    if (pedindoSync) return;
    setPedindoSync(true);
    try {
      const r = await chamarIuli({ op: "sync" });
      if (!r.ok) os.notify(r.error || "Não foi possível atualizar do IULI.", "err");
      else if (manual) os.notify(r.pulado ? "Já atualizado há menos de 2 minutos." : "Notas atualizadas do IULI.", "ok");
      await carregar();
    } catch (e) { os.notify(os.errMsg(e), "err"); }
    finally { setPedindoSync(false); }
  }

  const produtos = useMemo(() => [...new Set((linhas || []).map((l) => l.produto).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [linhas]);

  // Filtros que valem para cards e tabela (tudo menos Situação).
  const base = useMemo(() => {
    const t = normalizarTexto(busca.trim());
    return (linhas || []).filter((l) =>
      (!ocultarReemb || !REEMBOLSO.has(l.status_venda)) &&
      (produto === "all" || l.produto === produto) &&
      (!t || normalizarTexto(`${l.cliente_nome} ${l.cliente_email} ${l.transacao} ${l.iuli_id} ${l.venda_codigo}`).includes(t)));
  }, [linhas, ocultarReemb, produto, busca]);

  const cards = useMemo(() => {
    const acc = { total: [0, 0], emitida: [0, 0], falha: [0, 0], pendente: [0, 0] };
    for (const l of base) {
      const v = Number(l.valor_total) || 0;
      acc.total[0] += v; acc.total[1]++;
      const g = infoNf(l.nf_status)[0];
      const k = g === "nao_solicitada" ? "pendente" : g;
      if (acc[k]) { acc[k][0] += v; acc[k][1]++; }
    }
    return acc;
  }, [base]);

  const visiveis = useMemo(() => (situacao === "all" ? base : base.filter((l) => infoNf(l.nf_status)[0] === situacao)), [base, situacao]);
  const totalVisivel = visiveis.reduce((a, l) => a + (Number(l.valor_total) || 0), 0);

  function exportar() {
    const cab = ["ID venda IULI", "Código", "Competência", "Pagamento", "Cliente", "E-mail", "Produto", "Valor", "Valor líquido",
      "Situação da NF", "Agendada para", "Status da venda", "Origem", "Transação"];
    baixarCsv(`NF-e_${inicio}_${fim}`, cab, visiveis.map((l) => [l.iuli_id, l.venda_codigo, dataBR(l.competencia), l.pagamento ? dataBR(l.pagamento) : "",
      l.cliente_nome, l.cliente_email, l.produto, Number(l.valor_total) || 0, Number(l.valor_liquido) || 0, infoNf(l.nf_status)[1],
      l.nf_agendada_para ? dataBR(l.nf_agendada_para.slice(0, 10)) : "", rotVenda(l.status_venda), l.origem, l.transacao]));
  }

  const qtd = (n) => `${n.toLocaleString("pt-BR")} venda${n === 1 ? "" : "s"}`;
  const carregando = linhas === null;
  const nuncaSincronizou = !carregando && !sync?.ultima_execucao_em;

  return html`<${FinPage} class="space-y-5">
    <section class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p class="text-[16px] font-black uppercase tracking-[0.2em] text-emerald-700">Fiscal</p>
        <h1 class="mt-2 text-3xl font-black tracking-[-0.045em] text-[#07110e]">NF-e</h1>
        <p class=${cn("mt-2 text-sm font-semibold", sync && sync.ultimo_status === "erro" ? "text-rose-700" : "text-slate-500")}>
          ${sync && sync.ultima_execucao_em
            ? html`Última atualização do IULI: ${dataHoraBR(sync.ultima_execucao_em)}${sync.ultimo_status === "erro" && sync.ultimo_detalhe ? html` · ${sync.ultimo_detalhe}` : null}`
            : "O IULI ainda não foi sincronizado."}
          ${pedindoSync ? html`<span class="ml-2 inline-flex items-center gap-1 text-emerald-700"><${Icone} nome="loader" class="h-3 w-3 fin-spin" />atualizando do IULI...</span>` : null}
        </p>
      </div>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="button" onClick=${exportar} disabled=${!visiveis.length}
          class="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-xs font-bold text-slate-700 transition hover:border-emerald-200 disabled:opacity-40">
          <${Icone} nome="download" class="h-4 w-4" />Exportar CSV</button>
        ${pode ? html`<button type="button" onClick=${() => sincronizar(true)} disabled=${pedindoSync}
          class="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-xs font-bold text-slate-700 transition hover:border-emerald-200 disabled:opacity-50">
          <${Icone} nome=${pedindoSync ? "loader" : "rotate"} class=${cn("h-4 w-4", pedindoSync && "fin-spin")} />Atualizar do IULI</button>` : null}
      </div>
    </section>

    <section class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <${KpiCardDestaque} rotulo="Vendas no período" valor=${cards.total[0]} icone="receipt" tom="dark" dica=${qtd(cards.total[1])} carregando=${carregando} />
      <${KpiCardDestaque} rotulo="Nota emitida" valor=${cards.emitida[0]} icone="check-circle" tom="emerald" dica=${qtd(cards.emitida[1])} carregando=${carregando} />
      <${KpiCardDestaque} rotulo="Nota com falha" valor=${cards.falha[0]} icone="alert" tom="negative" dica=${qtd(cards.falha[1])} carregando=${carregando} />
      <${KpiCardDestaque} rotulo="Ainda sem nota" valor=${cards.pendente[0]} icone="calendar" tom="light" dica=${qtd(cards.pendente[1]) + " · agendada, processando ou não solicitada"} carregando=${carregando} />
    </section>

    <section class="rounded-[1.4rem] border border-slate-200 bg-white p-3 shadow-sm">
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <select aria-label="Ano" value=${ano} onChange=${(e) => setAno(Number(e.target.value))} class="filter-select h-11 py-0">
          ${ANOS_FILTRO.map((a) => html`<option value=${a}>${a}</option>`)}
        </select>
        <select aria-label="Mês" value=${mes} onChange=${(e) => setMes(e.target.value === "all" ? "all" : Number(e.target.value))} class="filter-select h-11 py-0">
          <option value="all">Ano inteiro</option>
          ${MESES.map((m, i) => html`<option value=${i}>${m}</option>`)}
        </select>
        <select aria-label="Situação da nota" value=${situacao} onChange=${(e) => setSituacao(e.target.value)} class="filter-select h-11 py-0">
          ${SITUACOES.map(([v, r]) => html`<option value=${v}>${r}</option>`)}
        </select>
        <select aria-label="Produto" value=${produto} onChange=${(e) => setProduto(e.target.value)} class="filter-select h-11 py-0">
          <option value="all">Todos os produtos</option>
          ${produtos.map((p) => html`<option value=${p}>${p}</option>`)}
        </select>
        <label class="relative">
          <${Icone} nome="search" class="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
          <input value=${busca} onInput=${(e) => setBusca(e.target.value)} placeholder="Cliente, e-mail ou transação..." class="filter-select h-11 py-0 pl-11" />
        </label>
        <label class="flex h-11 cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 px-4 text-xs font-bold text-slate-700">
          <input type="checkbox" checked=${ocultarReemb} onChange=${(e) => setOcultarReemb(e.target.checked)} class="h-4 w-4 accent-emerald-500" />
          Ocultar reembolsadas
        </label>
      </div>
      <p class="mt-2 px-2 text-xs font-semibold text-slate-400">Período pela data de competência da venda no IULI.</p>
    </section>

    <div role="note" class="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs font-bold text-slate-600">
      <${Icone} nome="info" class="h-5 w-5 shrink-0 text-slate-400" />
      <span>A API do IULI informa a situação da nota de cada venda, mas não o número, o PDF nem o XML. Para baixar a nota, use "Abrir no IULI" na linha da venda.</span>
    </div>
    ${nuncaSincronizou ? html`<div role="status" class="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-bold text-amber-900">
      <${Icone} nome="info" class="h-5 w-5 shrink-0" />
      <span>As vendas ainda não foram trazidas do IULI. A sincronização roda a cada 2 horas, ao abrir esta tela e pelo botão "Atualizar do IULI".</span>
    </div>` : null}

    <section class="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4">
        <p class="text-[16px] font-black uppercase tracking-widest text-slate-500">${qtd(visiveis.length)}</p>
        <p class="text-sm font-black tabular-nums text-slate-800">${brl(totalVisivel)}</p>
      </div>
      <div class="overflow-x-auto"><table class="w-full min-w-[1150px]">
        <thead><tr class="bg-slate-50 text-left text-[13.5px] font-black uppercase tracking-widest text-slate-400">
          <th class="px-4 py-3">Competência</th><th class="px-4 py-3">Cliente</th><th class="px-4 py-3">Produto</th>
          <th class="px-4 py-3 text-right">Valor</th><th class="px-4 py-3">Situação da NF</th><th class="px-4 py-3">Venda</th><th class="px-4 py-3 text-right">Nota</th>
        </tr></thead>
        <tbody>
          ${carregando ? html`<tr><td colSpan="7" class="p-16 text-center text-xs font-bold text-slate-400">
              <${Icone} nome="loader" class="mx-auto mb-3 h-6 w-6 fin-spin text-emerald-600" />Carregando notas...</td></tr>`
            : visiveis.length ? visiveis.slice(0, limite).map((l) => html`<${LinhaNfe} key=${l.iuli_id} l=${l} />`)
            : html`<tr><td colSpan="7" class="p-16 text-center">
                <${Icone} nome="file" class="mx-auto h-8 w-8 text-slate-200" />
                <p class="mt-3 text-sm font-black text-slate-600">${erroCarga ? "Não foi possível carregar as notas" : "Nenhuma venda encontrada"}</p>
                <p class="mt-1 text-xs font-medium text-slate-400">${erroCarga ? "Nenhum dado foi alterado." : "Ajuste o período ou os filtros."}</p>
                ${erroCarga ? html`<button type="button" onClick=${carregar} class="premium-button-primary mt-5">Tentar novamente</button>` : null}
              </td></tr>`}
        </tbody>
      </table></div>
      ${visiveis.length > limite ? html`<div class="flex items-center justify-center gap-3 border-t border-slate-100 p-4">
        <span class="text-xs font-bold text-slate-400">Mostrando ${limite} de ${visiveis.length.toLocaleString("pt-BR")}</span>
        <button type="button" onClick=${() => setLimite((n) => n + POR_PAGINA * 2)} class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:border-emerald-200">Mostrar mais</button>
        <button type="button" onClick=${() => setLimite(visiveis.length)} class="rounded-xl px-4 py-2 text-xs font-bold text-emerald-700 hover:underline">Mostrar todas</button>
      </div>` : null}
    </section>
  <//>`;
}

function LinhaNfe({ l }) {
  const [, rotulo, tom] = infoNf(l.nf_status);
  const agendada = l.nf_status === "SCHEDULED_SALE" && l.nf_agendada_para ? dataBR(l.nf_agendada_para.slice(0, 10)) : "";
  return html`<tr class="border-t border-slate-100 align-top text-sm hover:bg-slate-50/60">
    <td class="whitespace-nowrap px-4 py-3 font-bold tabular-nums text-slate-700">${dataBR(l.competencia)}</td>
    <td class="max-w-[260px] px-4 py-3">
      <p class="truncate font-black text-slate-800" title=${l.cliente_nome || ""}>${l.cliente_nome || "Sem nome"}</p>
      ${l.cliente_email ? html`<p class="truncate text-xs font-semibold text-slate-400" title=${l.cliente_email}>${l.cliente_email}</p>` : null}
    </td>
    <td class="max-w-[260px] px-4 py-3"><p class="truncate font-semibold text-slate-700" title=${l.produto || ""}>${l.produto || ""}</p></td>
    <td class="whitespace-nowrap px-4 py-3 text-right font-black tabular-nums text-slate-800">${brl(l.valor_total)}</td>
    <td class="px-4 py-3">
      <${Pill} tom=${tom} class="whitespace-nowrap">${rotulo}<//>
      ${agendada ? html`<p class="mt-1 text-xs font-semibold text-slate-400">para ${agendada}</p>` : null}
    </td>
    <td class="px-4 py-3">
      <p class=${cn("whitespace-nowrap text-xs font-bold", REEMBOLSO.has(l.status_venda) ? "text-rose-700" : "text-slate-600")}>${rotVenda(l.status_venda)}</p>
      <p class="whitespace-nowrap text-xs font-semibold text-slate-400" title="Transação na plataforma de origem">${[l.origem === "HOTMART" ? "Hotmart" : l.origem, l.transacao].filter(Boolean).join(" · ")}</p>
    </td>
    <td class="whitespace-nowrap px-4 py-3 text-right">
      <a href=${LINK_IULI + l.iuli_id} target="_blank" rel="noopener noreferrer"
        class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-emerald-200 hover:text-emerald-700">
        Abrir no IULI<${Icone} nome="arrow-up-right" class="h-3.5 w-3.5" /></a>
    </td>
  </tr>`;
}

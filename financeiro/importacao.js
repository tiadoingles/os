// Financeiro · Importação — tela do Craft Green "Importação" (ref. app_importacao_page).
// Spec: docs/financeiro-spec.md (2.4 e 3.6). Base compartilhada: ./comum.js (não editar lá).
// Props do Router (#/financeiro/importacao): me (linha de profiles) e query (?source=platform abre Plataformas).
// Escrita: podeEditarFin(me). DESFAZER: escopoFin("importacao").
//
// Diferente do Craft (que lê no backend), aqui tudo é lido NO NAVEGADOR: CSV com leitor próprio e XLS/XLSX com
// SheetJS (https://esm.sh/xlsx@0.18.5, carregado sob demanda). PDF: "Leitura de PDF em breve" (a IA ainda não foi
// aprovada; contrato proposto na spec). As funções de leitura (parseCsv, parseData, parseNumero, interpretarExtrato,
// interpretarVendas) são puras e exportadas para teste com node.
import { html } from "htm/preact";
import { useState, useEffect, useRef } from "preact/hooks";
import {
  os, escopoFin, podeEditarFin, FinPage, Icone, ConfirmDialog, fetchContas, fetchImportacoes, hashLancamento,
  LIMITES_IMPORTACAO, normalizarTexto, brl, cn, useLocalState,
} from "./comum.js";

const ESCOPO = escopoFin("importacao");
const URL_XLSX = "https://esm.sh/xlsx@0.18.5";
const LOTE = 500;

/* ============================ Ícones extras (Lucide, ISC) ============================ */
const ICONES_EXTRA = {
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  "file-spreadsheet": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>',
  "file-search": '<path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M4.268 21a2 2 0 0 0 1.727 1H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3"/><path d="m9 18-1.5-1.5"/><circle cx="5" cy="14" r="3"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  "circle-x": '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
};
function Ic({ nome, class: cls = "h-4 w-4" }) {
  if (!ICONES_EXTRA[nome]) return html`<${Icone} nome=${nome} class=${cls} />`;
  return html`<svg class=${cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICONES_EXTRA[nome] }}></svg>`;
}

/* ============================ Leitura de arquivos (puro, testável) ============================ */
/** Bytes -> texto: UTF-8 (com ou sem BOM); se não for UTF-8 válido, Windows-1252 (CSV de banco brasileiro). */
export function decodificarTexto(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(u8).replace(/^﻿/, ""); }
  catch (_) { return new TextDecoder("windows-1252").decode(u8); }
}

function dividirCsv(texto, d) {
  const rows = [];
  let row = [], campo = "", aspas = false, emAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"' && campo.trim() === "" && !emAspas) { aspas = true; emAspas = true; campo = ""; }
    else if (c === d) { row.push(campo.trim()); campo = ""; emAspas = false; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      row.push(campo.trim()); rows.push(row); row = []; campo = ""; emAspas = false;
    } else campo += c;
  }
  if (campo !== "" || row.length) { row.push(campo.trim()); rows.push(row); }
  return rows;
}
/** Detecta o separador (; , TAB |) pela consistência do nº de colunas nas primeiras linhas. */
export function detectarSeparador(texto) {
  const amostra = texto.slice(0, 16000);
  let melhor = ";", nota = -1;
  for (const d of [";", ",", "\t", "|"]) {
    const linhas = dividirCsv(amostra, d).filter((r) => r.some((x) => x !== "")).slice(0, 40);
    const cont = new Map();
    for (const r of linhas) if (r.length > 1) cont.set(r.length, (cont.get(r.length) || 0) + 1);
    let n = 0, moda = 0;
    for (const [k, v] of cont) if (v > n || (v === n && k > moda)) { n = v; moda = k; }
    const s = n * 100 + Math.min(moda, 50);
    if (s > nota) { nota = s; melhor = d; }
  }
  return melhor;
}
/** CSV -> matriz de células (texto). Linhas vazias são mantidas (o índice + 1 = nº da linha no arquivo). */
export function parseCsv(texto) { return dividirCsv(texto, detectarSeparador(texto)); }

function isoDe(a, m, d) {
  if (!(a >= 1990 && a <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** Data de célula -> "AAAA-MM-DD" ou null. Aceita dd/mm/aaaa (com hora), dd/mm/aa, dd-mm-aaaa, aaaa-mm-dd, serial do Excel e Date. */
export function parseData(v) {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const d = new Date(v.getTime() + 12 * 36e5);
    return isoDe(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (typeof v === "number") {
    if (!(v > 20000 && v < 80000)) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v + 0.001) * 864e5); // +0,001 dia: absorve o desvio de segundos de alguns geradores
    return isoDe(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(v == null ? "" : v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/);
  if (m) return isoDe(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/);
  if (m) return isoDe(m[3].length === 2 ? 2000 + Number(m[3]) : +m[3], +m[2], +m[1]);
  return null;
}
/**
 * Número de célula -> número (NaN se não for número). Aceita pt-BR e en: "R$ 1.234,56", "-1.234,56", "1234.56",
 * "(123,45)", "123,45-", "123,45 D" (débito = negativo) / "C".
 */
export function parseNumero(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let s = String(v == null ? "" : v).replace(/ /g, " ").trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  const suf = s.match(/\s*([DC])$/i);
  if (suf && /\d/.test(s)) { if (suf[1].toUpperCase() === "D") neg = !neg; s = s.slice(0, suf.index); }
  s = s.replace(/R\$|BRL/gi, "").replace(/\s/g, "");
  if (s.endsWith("-")) { neg = !neg; s = s.slice(0, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;
  const ip = s.lastIndexOf("."), iv = s.lastIndexOf(",");
  let n;
  if (ip >= 0 && iv >= 0) n = ip > iv ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  else if (iv >= 0) n = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (ip >= 0) n = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  else n = s;
  if (!/^\d*\.?\d+$|^\d+\.$/.test(n)) return NaN;
  const r = Number(n);
  return Number.isFinite(r) ? (neg ? -r : r) : NaN;
}
const r2 = (n) => Math.round(n * 100) / 100;
const textoCelula = (c) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c == null ? "" : c).trim());
const linhaVazia = (r) => !r || !r.some((c) => textoCelula(c) !== "");
const normCab = (c) => normalizarTexto(textoCelula(c)).replace(/\(.*?\)/g, " ").replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();

const RX_CAB = {
  data: /^(data|dt|date|dia)\b/,
  valor: /^(valor|vlr|montante|quantia|amount|value)\b/,
  credito: /^(credito|creditos|entrada|entradas)\b/,
  debito: /^(debito|debitos|saida|saidas)\b/,
  saldo: /^(saldo|balance)\b/,
  dc: /^(d\/c|c\/d|tipo|natureza|deb\/cred|debito\/credito)$/,
  hist: /hist|descri|lancamento|memo|detalh|estabelecimento|^title$|^description$|complemento|^movimentacao|^transacao$/,
};
/** Primeira linha (até a 30ª) com coluna de data + (valor | crédito/débito). */
export function acharCabecalho(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cab = (rows[i] || []).map(normCab);
    const col = { data: -1, valor: -1, credito: -1, debito: -1, saldo: -1, dc: -1, hist: [] };
    cab.forEach((c, j) => {
      if (!c) return;
      if (col.data < 0 && RX_CAB.data.test(c)) return void (col.data = j);
      if (col.valor < 0 && RX_CAB.valor.test(c)) return void (col.valor = j);
      if (col.credito < 0 && RX_CAB.credito.test(c)) return void (col.credito = j);
      if (col.debito < 0 && RX_CAB.debito.test(c)) return void (col.debito = j);
      if (col.saldo < 0 && RX_CAB.saldo.test(c)) return void (col.saldo = j);
      if (col.dc < 0 && RX_CAB.dc.test(c)) return void (col.dc = j);
      if (RX_CAB.hist.test(c)) col.hist.push(j);
    });
    if (col.data >= 0 && (col.valor >= 0 || col.credito >= 0 || col.debito >= 0)) return { linha: i, col, nomes: (rows[i] || []).map(textoCelula) };
  }
  return null;
}

export const MSG_SEM_COLUNAS = "Não encontramos as colunas do extrato. O arquivo precisa de um cabeçalho com Data, Histórico (ou Descrição) e Valor (ou Crédito e Débito).";
const RX_SALDO = /^(saldo|s a l d o)\b|saldo anterior|saldo do dia|saldo final|saldo inicial|saldo em c|saldo disponivel|saldo bloqueado|saldo total|saldo aplic|^total\b|total de (entradas|saidas|creditos|debitos)/;
const RX_PAGAMENTO_FATURA = /pagamento (recebido|efetuado|de fatura|da fatura|fatura)|pagto fatura|pag fatura|pagamento - obrigado|pagamento obrigado/;

/**
 * Extrato bancário / fatura de cartão (matriz de células) -> prévia.
 * Saída: { colunas, transacoes:[{linha, data, descricao, valor, saldo, trecho, rawData, rawValor, rawSaldo}],
 *          saldos:[{linha, data, descricao, saldo}], issues:[{linha, mensagem, trecho}], avisos:[], periodo:{inicio,fim}, totalLinhas }
 * Cartão: compras entram negativas e estornos positivos (se as compras vierem positivas no arquivo, inverte);
 * linhas de pagamento da fatura não entram (o pagamento entra pelo extrato da conta).
 */
export function interpretarExtrato(rows, { tipo = "extrato" } = {}) {
  const cab = acharCabecalho(rows);
  if (!cab) throw new Error(MSG_SEM_COLUNAS);
  const { linha: h, col, nomes } = cab;
  const totalLinhas = rows.slice(h + 1).filter((r) => !linhaVazia(r)).length;
  if (totalLinhas > LIMITES_IMPORTACAO.linhas) throw new Error(`O arquivo tem ${totalLinhas.toLocaleString("pt-BR")} linhas. O limite é de 5.000 linhas por importação: exporte um período menor.`);
  const transacoes = [], saldos = [], issues = [], avisos = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (linhaVazia(r)) continue;
    const linha = i + 1;
    const trecho = r.map(textoCelula).filter(Boolean).join(" | ");
    const rawData = r[col.data];
    const data = parseData(rawData);
    const descricao = col.hist.map((j) => textoCelula(r[j])).filter(Boolean).join(" · ").replace(/\s+/g, " ").trim();
    let valor;
    if (col.valor >= 0) {
      valor = parseNumero(r[col.valor]);
      if (col.dc >= 0 && !Number.isNaN(valor)) {
        const dc = normalizarTexto(textoCelula(r[col.dc]));
        if (/^d/.test(dc)) valor = -Math.abs(valor);
        else if (/^c/.test(dc)) valor = Math.abs(valor);
      }
    } else {
      const c = col.credito >= 0 ? parseNumero(r[col.credito]) : NaN, d = col.debito >= 0 ? parseNumero(r[col.debito]) : NaN;
      valor = Number.isNaN(c) && Number.isNaN(d) ? NaN : (Number.isNaN(c) ? 0 : Math.abs(c)) - (Number.isNaN(d) ? 0 : Math.abs(d));
    }
    const saldo = col.saldo >= 0 ? parseNumero(r[col.saldo]) : NaN;
    const nd = normalizarTexto(descricao);
    if (RX_SALDO.test(nd)) {
      saldos.push({ linha, data, descricao, saldo: !Number.isNaN(saldo) ? saldo : !Number.isNaN(valor) ? valor : null });
      continue;
    }
    if (!data) {
      if (!Number.isNaN(valor) && valor !== 0) issues.push({ linha, mensagem: "Data não reconhecida", trecho });
      continue;
    }
    if (Number.isNaN(valor)) {
      if (!Number.isNaN(saldo)) { saldos.push({ linha, data, descricao, saldo }); continue; }
      issues.push({ linha, mensagem: "Valor não reconhecido", trecho });
      continue;
    }
    if (r2(valor) === 0) { issues.push({ linha, mensagem: "Valor zerado", trecho }); continue; }
    transacoes.push({
      linha, data, descricao: descricao || "(sem descrição)", valor: r2(valor), saldo: Number.isNaN(saldo) ? null : r2(saldo),
      trecho, rawData: textoCelula(rawData), rawValor: col.valor >= 0 ? textoCelula(r[col.valor]) : [textoCelula(r[col.credito]), textoCelula(r[col.debito])].filter(Boolean).join(" / "),
      rawSaldo: col.saldo >= 0 ? textoCelula(r[col.saldo]) : "",
    });
  }
  let lista = transacoes;
  if (tipo === "cartao") {
    const fora = lista.filter((t) => RX_PAGAMENTO_FATURA.test(normalizarTexto(t.descricao)));
    if (fora.length) {
      fora.forEach((t) => issues.push({ linha: t.linha, mensagem: "Pagamento da fatura não importado (ele entra pelo extrato da conta)", trecho: t.trecho }));
      lista = lista.filter((t) => !fora.includes(t));
    }
    if (col.valor >= 0 && col.dc < 0 && lista.length && lista.filter((t) => t.valor > 0).length > lista.length / 2) {
      lista.forEach((t) => { t.valor = -t.valor; });
      avisos.push("As compras vieram positivas no arquivo: os sinais foram invertidos (compra = saída, estorno = entrada).");
    }
  }
  const datas = lista.map((t) => t.data).sort();
  return {
    colunas: {
      data: nomes[col.data], historico: col.hist.map((j) => nomes[j]).join(" + ") || "—",
      valor: col.valor >= 0 ? nomes[col.valor] : [col.credito >= 0 && nomes[col.credito], col.debito >= 0 && nomes[col.debito]].filter(Boolean).join(" / "),
      saldo: col.saldo >= 0 ? nomes[col.saldo] : null,
    },
    transacoes: lista, saldos, issues, avisos, totalLinhas,
    periodo: datas.length ? { inicio: datas[0], fim: datas[datas.length - 1] } : null,
  };
}

/** Preenche t.ocorrencia (nº de repetições idênticas no mesmo arquivo) e t.hash (hashLancamento). */
export async function calcularHashes(transacoes, contaId) {
  const vistos = new Map();
  for (const t of transacoes) {
    const k = [t.data, t.valor.toFixed(2), normalizarTexto(t.descricao).replace(/\s+/g, " ").trim()].join("|");
    const oc = vistos.get(k) || 0;
    vistos.set(k, oc + 1);
    t.ocorrencia = oc;
    t.hash = await hashLancamento({ contaId, data: t.data, valor: t.valor, historico: t.descricao, ocorrencia: oc });
  }
  return transacoes;
}

/* ---------- Plataformas de vendas ---------- */
/** "A" -> 0, "AG" -> 32. */
export function colunaLetra(l) { return [...String(l).toUpperCase()].reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0) - 1; }
const letraColuna = (i) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
/** Layout por letra de coluna [C]. Campos com RegExp são procurados pelo título (não constam no Craft). */
export const LAYOUT_VENDAS = {
  HOTMART: {
    rotulo: "Hotmart", texto: "Status B · Confirmação D · Produto G · Receita Q · Coprodução V · Taxas X + Y",
    status: "B", data: "D", produto: "G", bruto: "Q", coproducao: "V", taxa_processamento: "X", taxa_streaming: "Y",
    transacao: /transa|codigo|^id\b/, confere: { B: /status|situa/, D: /data|confirma/ },
  },
  EDUZZ: {
    rotulo: "Eduzz", texto: "Pagamento K · Produto R · Ganho Liquido AG, tratado como faturamento bruto",
    data: "K", produto: "R", bruto: "AG", status: /status|situa/, transacao: /fatura|transa|codigo|^id\b/,
    confere: { K: /pag|data/, AG: /liquid|ganho/ },
  },
  OTHER: {
    rotulo: "Outros", texto: null,
    data: /^data\b.*(venda|pagamento|aprova|confirma|compra|pedido)|^data$|^date$/, produto: /produto|curso|item|oferta|product/,
    bruto: /valor (bruto|total|da venda|do produto|pago)|faturamento|receita|^valor$|^preco|^price|^total$|^amount$/,
    status: /status|situa/, transacao: /transa|codigo|pedido|fatura|^id\b|order/,
    coproducao: /coprodu/, taxa_processamento: /taxa|tarifa|^fee/,
  },
};
const RX_REEMBOLSO = /reembols|estorn|chargeback|charge back|cancelad|devolvid|contestad|refund/;
async function sha(texto) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
/**
 * Relatório de vendas (matriz) -> vendas para fin_vendas. plataforma: HOTMART | EDUZZ | OTHER (nome = "Nome da plataforma").
 * Competência [I]: Hotmart = confirmação (D); Eduzz = pagamento (K). Reembolso [I]: status reembolsado/cancelado/chargeback
 * -> reembolso = bruto. Taxas X = processamento, Y = streaming. Valores de reembolso/coprodução/taxas positivos.
 * Hash: código da transação (se houver coluna) ou data+produto+valor+ocorrência. Mesma transação repetida no arquivo: fica a última.
 */
export async function interpretarVendas(rows, { plataforma = "HOTMART", nome = "" } = {}) {
  const lay = LAYOUT_VENDAS[plataforma];
  if (!lay) throw new Error("Origem do relatório inválida.");
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) if ((rows[i] || []).filter((c) => textoCelula(c) !== "").length >= 3) { h = i; break; }
  if (h < 0) throw new Error("Não encontramos o cabeçalho do relatório. Exporte o arquivo original da plataforma.");
  const nomes = (rows[h] || []).map(textoCelula), cab = nomes.map(normCab);
  const idx = (regra) => (regra instanceof RegExp ? cab.findIndex((c) => c && regra.test(c)) : typeof regra === "string" ? colunaLetra(regra) : -1);
  const c = {};
  for (const k of ["data", "produto", "bruto", "status", "transacao", "coproducao", "taxa_processamento", "taxa_streaming"]) c[k] = idx(lay[k]);
  if (plataforma === "OTHER" && (c.data < 0 || c.bruto < 0))
    throw new Error("Não encontramos as colunas de data e valor da venda. O relatório precisa de um cabeçalho com Data, Produto e Valor (ou Faturamento).");
  const avisos = [];
  if (lay.confere) {
    const falhas = Object.entries(lay.confere).filter(([l, rx]) => !rx.test(cab[colunaLetra(l)] || ""));
    if (falhas.length) avisos.push(`As colunas ${falhas.map(([l]) => `${l} (“${nomes[colunaLetra(l)] || "vazia"}”)`).join(" e ")} não batem com o layout padrão da ${lay.rotulo}. Confira a amostra antes de confirmar.`);
  }
  const nomePlat = plataforma === "OTHER" ? String(nome).trim() : plataforma;
  const porHash = new Map(), issues = [];
  let totalLinhas = 0, duplicados = 0;
  const ocorr = new Map();
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (linhaVazia(r)) continue;
    totalLinhas++;
    const linha = i + 1;
    const data = parseData(r[c.data]);
    if (!data) { issues.push(`Linha ${linha} · sem data ${plataforma === "HOTMART" ? "de confirmação" : plataforma === "EDUZZ" ? "de pagamento" : "da venda"}: ignorada.`); continue; }
    let bruto = parseNumero(r[c.bruto]);
    if (Number.isNaN(bruto)) { issues.push(`Linha ${linha} · valor não reconhecido (“${textoCelula(r[c.bruto])}”): ignorada.`); continue; }
    const status = c.status >= 0 ? textoCelula(r[c.status]) : "";
    const reembolsado = RX_REEMBOLSO.test(normalizarTexto(status)) || bruto < 0;
    bruto = r2(Math.abs(bruto));
    if (bruto === 0) { issues.push(`Linha ${linha} · valor zerado: ignorada.`); continue; }
    const num = (k) => { if (c[k] < 0) return 0; const v = parseNumero(r[c[k]]); return Number.isNaN(v) ? 0 : r2(Math.abs(v)); };
    const produto = c.produto >= 0 ? textoCelula(r[c.produto]) : "";
    const transacao = c.transacao >= 0 ? textoCelula(r[c.transacao]) : "";
    let hash;
    if (transacao) hash = await sha(`t|${transacao}`);
    else {
      const k = [data, normalizarTexto(produto), bruto.toFixed(2)].join("|");
      const oc = ocorr.get(k) || 0;
      ocorr.set(k, oc + 1);
      hash = await sha(`${k}|${oc}`);
    }
    if (porHash.has(hash)) duplicados++;
    porHash.set(hash, {
      plataforma: nomePlat, produto: produto || null, transacao: transacao || null, status: status || null,
      data_competencia: data, data_pagamento: data, bruto, reembolso: reembolsado ? bruto : 0,
      coproducao: num("coproducao"), taxa_processamento: num("taxa_processamento"), taxa_streaming: num("taxa_streaming"),
      hash, dados: { linha },
    });
  }
  const descreve = (k) => (c[k] >= 0 ? `${nomes[c[k]] || "(sem título)"} (${letraColuna(c[k])})` : "—");
  return { vendas: [...porHash.values()], issues, avisos, totalLinhas, duplicados, colunas: { date: descreve("data"), gross: descreve("bruto") } };
}

/* ============================ Arquivo -> matriz (navegador) ============================ */
const extensao = (nome) => (String(nome).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "";
let xlsxPromessa = null;
async function carregarXlsx() {
  if (!xlsxPromessa) xlsxPromessa = import(/* @vite-ignore */ URL_XLSX).then((m) => (m.read ? m : m.default)).catch((e) => { xlsxPromessa = null; throw e; });
  return xlsxPromessa;
}
/** Lê CSV (leitor próprio) ou XLS/XLSX (SheetJS, 1ª aba com dados). Datas do Excel chegam como número serial. */
async function lerPlanilha(file) {
  const ext = extensao(file.name);
  const buf = await file.arrayBuffer();
  if (ext === "csv" || ext === "txt") return { rows: parseCsv(decodificarTexto(buf)), aba: "CSV", formato: "CSV" };
  if (ext !== "xls" && ext !== "xlsx") throw new Error("Formato não suportado. Envie CSV, XLS ou XLSX.");
  let X;
  try { X = await carregarXlsx(); } catch (_) { throw new Error("Não foi possível carregar o leitor de Excel. Verifique a conexão ou exporte o arquivo em CSV."); }
  let wb;
  try { wb = X.read(new Uint8Array(buf), { type: "array", cellDates: false, cellText: false }); }
  catch (e) {
    if (/password|encrypt|protect/i.test(String(e && e.message))) throw new Error("O arquivo está protegido por senha. Salve uma cópia sem senha (ou exporte em CSV) e tente novamente.");
    throw new Error("O leitor não conseguiu abrir o arquivo. Tente exportar em CSV.");
  }
  for (const nome of wb.SheetNames) {
    const rows = X.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: "", blankrows: true });
    if (rows.some((r) => !linhaVazia(r))) return { rows, aba: nome, formato: ext.toUpperCase() };
  }
  throw new Error("A planilha está vazia.");
}

/* ============================ Dados ============================ */
async function paginar(montar) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
const emLotes = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
/** Hashes que já existem na conta (dedup da prévia). */
async function hashesExistentes(contaId, hashes) {
  const ja = new Set();
  for (const lote of emLotes(hashes, 150)) {
    const { data, error } = await os.sb.from("fin_lancamentos").select("hash").eq("conta_id", contaId).in("hash", lote);
    if (error) throw error;
    (data || []).forEach((r) => ja.add(r.hash));
  }
  return ja;
}
async function atualizarImportacao(id, campos) {
  const { error } = await os.sb.from("fin_importacoes").update(campos).eq("id", id);
  if (error) throw error;
}
const semAuto = (r) => { const o = { ...r }; delete o.updated_at; delete o.liquido; return o; };

/* ============================ Tela ============================ */
const TIPOS = [
  { id: "bank", title: "Extrato Bancário", description: "PDF, CSV, XLS ou XLSX", icone: "building" },
  { id: "card", title: "Cartão de Crédito", description: "Faturas em PDF, CSV, XLS ou XLSX", icone: "credit-card" },
  { id: "platform", title: "Plataformas de Vendas", description: "Hotmart, Eduzz e outros relatórios · CSV e Excel", icone: "zap" },
];
const rotuloConta = (c) => (c ? `${c.banco ? c.banco + " · " : ""}${c.apelido}` : "");

export function ImportacaoPage({ me, query }) {
  const pode = podeEditarFin(me);
  const inputRef = useRef(null);
  const [fonte, setFonte] = useLocalState("importacao:source", "bank");
  const [contaId, setContaId] = useLocalState("importacao:accountId", "");
  const [arquivo, setArquivo] = useState(null);
  const [fase, setFase] = useState("idle"); // idle | parsing | preview | committing | success
  const [previa, setPrevia] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState("");
  const [contas, setContas] = useState([]);
  const [todasContas, setTodasContas] = useState([]);
  const [historico, setHistorico] = useState(null);
  const [excluir, setExcluir] = useState(null); // {} = limpar tudo; {id, arquivo, status}
  const [excluindo, setExcluindo] = useState(false);
  const [msgHist, setMsgHist] = useState(null);
  const [ocupadoPlat, setOcupadoPlat] = useState(false);
  const [limpandoPlat, setLimpandoPlat] = useState(false);
  const [chavePlat, setChavePlat] = useState(0);
  const ocupado = fase === "parsing" || fase === "committing" || excluindo || ocupadoPlat || limpandoPlat || !pode;

  // ?source=platform (botão "Importar vendas" do Relatório de Vendas) ou ?source=card abrem já no tipo certo.
  const fonteQuery = query && query.source;
  useEffect(() => {
    const alvo = { platform: "platform", card: "card", bank: "bank" }[fonteQuery];
    if (alvo) setFonte(alvo);
  }, [fonteQuery]);
  const carregarContas = () => fetchContas({ incluirArquivadas: true })
    .then((cs) => { setTodasContas(cs); setContas(cs.filter((c) => c.ativo)); })
    .catch((e) => os.notify(os.errMsg(e), "err"));
  const carregarHistorico = () => fetchImportacoes({ limite: 20 }).then(setHistorico).catch((e) => { os.notify(os.errMsg(e), "err"); setHistorico([]); });
  useEffect(() => { carregarContas(); carregarHistorico(); }, []);
  os.useAoDesfazer(ESCOPO, () => { carregarHistorico(); setChavePlat((k) => k + 1); });

  const reiniciar = () => { setArquivo(null); setPrevia(null); setResultado(null); setErro(""); setFase("idle"); if (inputRef.current) inputRef.current.value = ""; };
  const escolherTipo = (id) => { if (ocupado && pode) return; setFonte(id); setPrevia(null); setResultado(null); setFase("idle"); setErro(""); };

  async function gerarPrevia() {
    if (!arquivo) return setErro("Escolha um arquivo para continuar.");
    if (arquivo.size > LIMITES_IMPORTACAO.bytes) return setErro("O arquivo excede 4 MB. Exporte um período menor para a leitura segura.");
    if (!contaId || !contas.some((c) => c.id === contaId)) return setErro("Selecione a conta relacionada ao arquivo.");
    if (extensao(arquivo.name) === "pdf") return setErro("Leitura de PDF em breve. Por enquanto, exporte o extrato ou a fatura em CSV, XLS ou XLSX.");
    setErro(""); setFase("parsing");
    try {
      const tipo = fonte === "card" ? "cartao" : "extrato";
      const { rows, formato } = await lerPlanilha(arquivo);
      const lido = interpretarExtrato(rows, { tipo });
      await calcularHashes(lido.transacoes, contaId);
      const ja = await hashesExistentes(contaId, lido.transacoes.map((t) => t.hash));
      lido.transacoes.forEach((t) => { t.duplicado = ja.has(t.hash); });
      const prontos = lido.transacoes.filter((t) => !t.duplicado).length;
      const avisos = [...lido.avisos];
      if (!lido.transacoes.length) avisos.push("Nenhuma movimentação com data e valor foi reconhecida. Confira o diagnóstico da leitura.");
      const { data: imp, error } = await os.sb.from("fin_importacoes").insert({
        arquivo: arquivo.name, tipo, conta_id: contaId, status: "previa", importados: 0,
        ignorados: lido.issues.length + lido.saldos.length, duplicados: lido.transacoes.length - prontos,
        total_linhas: lido.totalLinhas, processadas: 0, periodo_inicio: lido.periodo?.inicio || null, periodo_fim: lido.periodo?.fim || null,
        avisos: [...avisos, ...lido.issues.slice(0, 200).map((i) => `Linha ${i.linha} · ${i.mensagem}`)],
      }).select().single();
      if (error) throw error;
      setPrevia({ ...lido, avisos, formato, tipo, importacao: imp, conta: contas.find((c) => c.id === contaId), arquivo: arquivo.name, prontos, podeConfirmar: lido.transacoes.length > 0 });
      setFase("preview");
      carregarHistorico();
    } catch (e) {
      setFase("idle");
      setErro(os.errMsg(e) || "Não foi possível interpretar o arquivo. Tente novamente.");
    }
  }

  async function confirmar(conferido) {
    if (!previa || !conferido) return;
    setFase("committing"); setErro("");
    const imp = previa.importacao;
    const origem = previa.tipo === "cartao" ? "cartao" : "extrato";
    const novos = previa.transacoes.filter((t) => !t.duplicado);
    const criados = [];
    let duplicados = previa.transacoes.length - novos.length;
    try {
      await atualizarImportacao(imp.id, { status: "processando" });
      const linhaDb = (t) => ({
        conta_id: imp.conta_id, data: t.data, historico: t.descricao.slice(0, 500), valor: t.valor, origem, conciliado: false,
        importacao_id: imp.id, hash: t.hash, saldo_extrato: t.saldo,
        evidencia: { arquivo: previa.arquivo, linha: t.linha, trecho: t.trecho.slice(0, 1000), data: t.rawData, valor: t.rawValor, saldo: t.rawSaldo || null },
      });
      for (const lote of emLotes(novos, LOTE)) {
        const { data, error } = await os.sb.from("fin_lancamentos").insert(lote.map(linhaDb)).select("id");
        if (!error) { criados.push(...data.map((r) => r.id)); continue; }
        if (error.code !== "23505") throw error;
        // Alguém importou parte destas linhas ao mesmo tempo: grava uma a uma e conta as repetidas.
        for (const t of lote) {
          const r1 = await os.sb.from("fin_lancamentos").insert(linhaDb(t)).select("id");
          if (r1.error && r1.error.code === "23505") { duplicados++; continue; }
          if (r1.error) throw r1.error;
          criados.push(r1.data[0].id);
        }
      }
      await atualizarImportacao(imp.id, { status: "concluida", importados: criados.length, duplicados, processadas: previa.totalLinhas });
      os.registrarDesfazer(ESCOPO, `importação de ${previa.arquivo}`, desfazerImportacaoExtrato(imp.id, criados), { mensagem: "Importação concluída" });
      setResultado({ count: criados.length, duplicateCount: duplicados, ignoredCount: imp.ignorados, warnings: previa.avisos, issues: previa.issues.map((i) => `Linha ${i.linha} · ${i.mensagem}: ${i.trecho}`) });
      setFase("success");
    } catch (e) {
      try { await atualizarImportacao(imp.id, { status: criados.length ? "concluida" : "falhou", importados: criados.length, duplicados }); } catch (_) { /* sem rede */ }
      if (criados.length) os.registrarDesfazer(ESCOPO, `importação parcial de ${previa.arquivo}`, desfazerImportacaoExtrato(imp.id, criados), { toast: false });
      setFase("preview");
      setErro((os.errMsg(e) || "Não foi possível confirmar a importação.") + (criados.length ? ` ${criados.length} lançamento(s) já gravado(s) foram mantidos.` : ""));
    } finally { carregarHistorico(); }
  }

  async function excluirHistorico() {
    const alvo = excluir;
    if (!alvo || excluindo) return;
    setExcluindo(true); setMsgHist(null);
    try {
      let linhas;
      if (alvo.id) {
        const { data, error } = await os.sb.from("fin_importacoes").select("*").eq("id", alvo.id);
        if (error) throw error;
        linhas = data || [];
      } else {
        linhas = await paginar(() => os.sb.from("fin_importacoes").select("*").neq("status", "processando").order("created_at"));
      }
      const ids = linhas.map((l) => l.id);
      const vinculos = { fin_lancamentos: [], fin_vendas: [] };
      for (const lote of emLotes(ids, 100)) {
        for (const t of Object.keys(vinculos)) {
          const v = await paginar(() => os.sb.from(t).select("id, importacao_id").in("importacao_id", lote).order("id"));
          vinculos[t].push(...v);
        }
      }
      for (const lote of emLotes(ids, 100)) {
        const { error } = await os.sb.from("fin_importacoes").delete().in("id", lote);
        if (error) throw error;
      }
      if (previa && ids.includes(previa.importacao.id)) reiniciar();
      if (ids.length) os.registrarDesfazer(ESCOPO, ids.length === 1 ? `exclusão do histórico de ${linhas[0].arquivo}` : "limpeza do histórico de importações",
        desfazerExclusaoHistorico(linhas, vinculos), { toast: false });
      setMsgHist({ error: false, text: ids.length
        ? alvo.status === "processando" ? "Importação interrompida e registro excluído do histórico. Os dados já importados foram mantidos."
          : `${ids.length} registro(s) excluído(s) do histórico. Os lançamentos financeiros foram mantidos.`
        : "Nenhum registro disponível para exclusão. Importações em processamento foram mantidas." });
    } catch (e) {
      setMsgHist({ error: true, text: os.errMsg(e) || "Não foi possível excluir o histórico." });
    } finally { setExcluindo(false); carregarHistorico(); }
  }

  const contaPorId = new Map(todasContas.map((c) => [c.id, c]));
  return html`<${FinPage}>
    <h1 class="sr-only">Importação</h1>
    ${!pode ? html`<p class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">Você pode consultar o histórico, mas não tem permissão para importar arquivos.</p>` : null}
    <section class="grid gap-3 md:grid-cols-3">
      ${TIPOS.map((t) => html`<button type="button" key=${t.id} onClick=${() => escolherTipo(t.id)}
        class=${cn("group rounded-[1.3rem] border bg-white p-5 text-left transition", fonte === t.id
          ? "border-emerald-400 shadow-[0_18px_45px_-34px_rgba(16,185,129,0.8)] ring-2 ring-emerald-100" : "border-slate-200 hover:border-emerald-200")}>
        <div class="flex items-center gap-4">
          <span class=${cn("flex h-11 w-11 items-center justify-center rounded-xl", fonte === t.id ? "bg-emerald-500 text-[#07110e]" : "bg-slate-100 text-slate-500 group-hover:text-emerald-700")}>
            <${Ic} nome=${t.icone} class="h-5 w-5" /></span>
          <div><h2 class="text-sm font-black">${t.title}</h2><p class="mt-1 text-[16px] font-semibold text-slate-400">${t.description}</p></div>
          ${fonte === t.id ? html`<${Ic} nome="check-circle" class="ml-auto h-4 w-4 text-emerald-600" />` : null}
        </div>
      </button>`)}
    </section>

    ${fase === "preview" || fase === "committing" ? html`<${Previa} previa=${previa} confirmando=${fase === "committing"} onConfirm=${confirmar} onCancel=${reiniciar} onRetry=${gerarPrevia} erro=${erro} />`
      : fase === "success" ? html`<${Sucesso} fonte=${fonte} resultado=${resultado} onReset=${reiniciar} />`
      : fonte === "platform" ? html`<${PlataformasVendas} key=${chavePlat} desabilitado=${limpandoPlat || !pode} onBusy=${setOcupadoPlat}
          onComplete=${(r) => { setResultado({ ...r, platform: true }); setFase("success"); carregarHistorico(); }} onHistorico=${carregarHistorico} />`
      : html`<section><article class="rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-[0_20px_55px_-45px_rgba(3,15,10,0.5)] md:p-7">
          <div>
            <h2 class="text-base font-black">Novo arquivo</h2>
            <p class="mt-1 text-sm font-medium text-slate-500">Até 4 MB · PDF até 40 páginas (8 escaneadas) · CSV e Excel até 5.000 linhas</p>
          </div>
          <div class="mt-7 grid gap-5 lg:grid-cols-2">
            <div>
              <label class="mb-2 block text-[14.5px] font-black uppercase tracking-widest text-slate-500">Arquivo financeiro</label>
              <input ref=${inputRef} disabled=${ocupado} type="file" class="hidden" accept=".pdf,.csv,.xls,.xlsx"
                onChange=${(e) => { setArquivo((e.target.files && e.target.files[0]) || null); setErro(""); }} />
              <button type="button" disabled=${ocupado} onClick=${() => inputRef.current && inputRef.current.click()}
                class=${cn("flex h-36 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed transition",
                  arquivo ? "border-emerald-300 bg-emerald-50/50" : "border-slate-200 bg-slate-50/60 hover:border-emerald-300")}>
                <${Ic} nome="file-spreadsheet" class=${cn("h-7 w-7", arquivo ? "text-emerald-600" : "text-slate-300")} />
                <span class="mt-3 max-w-[85%] truncate text-xs font-black text-slate-800">${arquivo ? arquivo.name : "Escolher arquivo"}</span>
                <span class="mt-1 text-[14.5px] font-semibold text-slate-400">Até 4 MB · PDF até 40 páginas</span>
              </button>
            </div>
            <div>
              <label class="mb-2 block text-[14.5px] font-black uppercase tracking-widest text-slate-500">${fonte === "card" ? "Conta relacionada" : "Conta bancária"}</label>
              <select aria-label="Conta bancária" disabled=${ocupado} value=${contaId} onChange=${(e) => setContaId(e.target.value)} class="filter-select h-12 py-0">
                <option value="">Selecione uma conta</option>
                ${contas.map((c) => html`<option value=${c.id}>${rotuloConta(c)}</option>`)}
              </select>
              ${!contas.length ? html`<a href="#/financeiro/contas" class="mt-3 inline-flex items-center gap-1 text-xs font-black text-emerald-700">Cadastrar conta <${Ic} nome="arrow-right" class="h-3 w-3" /></a>` : null}
              ${arquivo && extensao(arquivo.name) === "pdf" ? html`<p class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">Leitura de PDF em breve. Por enquanto, exporte o arquivo em CSV, XLS ou XLSX.</p>` : null}
            </div>
          </div>
          ${erro ? html`<${ErroBox} mensagem=${erro} />` : null}
          <div class="mt-7 flex justify-end">
            <button type="button" onClick=${gerarPrevia} disabled=${!arquivo || ocupado} class="premium-button-primary min-w-48 disabled:cursor-not-allowed disabled:opacity-45">
              ${fase === "parsing" ? html`<${Ic} nome="loader" class="h-4 w-4 fin-spin" />Interpretando...` : html`<${Ic} nome="file-search" class="h-4 w-4" />Gerar prévia`}
            </button>
          </div>
        </article></section>`}

    ${fonte === "platform" && fase !== "success" ? html`<${LimparPlataforma} key=${"l" + chavePlat} desabilitado=${!pode || fase === "parsing" || fase === "committing" || excluindo || ocupadoPlat} onBusy=${setLimpandoPlat}
      onCleared=${() => { reiniciar(); setChavePlat((k) => k + 1); carregarHistorico(); }} />` : null}

    <${Historico} linhas=${historico || []} carregando=${historico === null} ocupado=${ocupado} excluindo=${excluindo} mensagem=${msgHist}
      contaPorId=${contaPorId} onDelete=${(x) => { setMsgHist(null); setExcluir(x); }} />

    <${ConfirmDialog} aberto=${!!excluir} onClose=${() => setExcluir(null)} onConfirm=${excluirHistorico}
      titulo=${excluir && excluir.status === "processando" ? "Cancelar e excluir importação?" : excluir && excluir.id ? "Excluir este histórico?" : "Limpar histórico de importações?"}
      descricao=${excluir ? (excluir.id
        ? excluir.status === "processando" ? `O processamento de “${excluir.arquivo}” será interrompido e seu registro removido do histórico. As vendas de lotes já gravados serão mantidas.`
          : `O registro de “${excluir.arquivo}” será excluído. Prévias não confirmadas serão descartadas.`
        : "Todos os registros disponíveis do seu histórico serão excluídos; os que estiverem em processamento serão mantidos. Prévias não confirmadas serão descartadas.")
        + " Os lançamentos já importados, a conciliação, a DRE e o caixa não serão alterados." : ""}
      textoConfirmar=${excluir && excluir.status === "processando" ? "Cancelar e excluir" : excluir && excluir.id ? "Excluir" : "Limpar histórico"} />
  <//>`;
}

/* ---------- DESFAZER ---------- */
/** Desfaz uma importação de extrato/cartão: exclui os lançamentos criados e o registro do histórico. */
function desfazerImportacaoExtrato(importacaoId, ids) {
  return async () => {
    const atuais = [];
    for (const lote of emLotes(ids, 200)) {
      const { data, error } = await os.sb.from("fin_lancamentos").select("id, conciliado, cancelado_em, categoria_id").in("id", lote);
      if (error) throw error;
      atuais.push(...(data || []));
    }
    const mexidos = atuais.filter((l) => l.conciliado || l.cancelado_em || l.categoria_id).length;
    if (mexidos && !confirm(`${mexidos} lançamento(s) desta importação já foram classificados ou conciliados. Desfazer a importação vai excluí-los mesmo assim. Continuar?`)) return false;
    for (const lote of emLotes(ids, 200)) {
      const { error } = await os.sb.from("fin_lancamentos").delete().in("id", lote);
      if (error) throw error;
    }
    const { error } = await os.sb.from("fin_importacoes").delete().eq("id", importacaoId);
    if (error) throw error;
    return true;
  };
}
/** Desfaz a exclusão do histórico: reinsere os registros e refaz o vínculo dos lançamentos/vendas. */
function desfazerExclusaoHistorico(linhas, vinculos) {
  return async () => {
    for (const lote of emLotes(linhas, 200)) {
      const { error } = await os.sb.from("fin_importacoes").insert(lote.map(semAuto));
      if (error) throw error;
    }
    for (const [tabela, vs] of Object.entries(vinculos)) {
      const porImp = new Map();
      vs.forEach((v) => { if (!porImp.has(v.importacao_id)) porImp.set(v.importacao_id, []); porImp.get(v.importacao_id).push(v.id); });
      for (const [impId, idsV] of porImp) for (const lote of emLotes(idsV, 200)) {
        const { error } = await os.sb.from(tabela).update({ importacao_id: impId }).in("id", lote).is("importacao_id", null);
        if (error) throw error;
      }
    }
    return true;
  };
}
/** Desfaz uma importação de plataforma: exclui as vendas gravadas por ela e restaura as que ela atualizou. */
function desfazerImportacaoVendas(importacaoId, anteriores, criouRegistro) {
  return async () => {
    const { error } = await os.sb.from("fin_vendas").delete().eq("importacao_id", importacaoId);
    if (error) throw error;
    for (const lote of emLotes(anteriores, LOTE)) {
      const r = await os.sb.from("fin_vendas").upsert(lote.map(semAuto), { onConflict: "plataforma,hash" });
      if (r.error) throw r.error;
    }
    if (criouRegistro) {
      const r = await os.sb.from("fin_importacoes").delete().eq("id", importacaoId);
      if (r.error) throw r.error;
    }
    return true;
  };
}

/* ---------- Componentes ---------- */
function ErroBox({ mensagem }) {
  return html`<div class="mt-5 flex gap-3 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-rose-800" role="alert">
    <${Ic} nome="circle-x" class="h-5 w-5 shrink-0" /><p class="text-xs font-bold">${mensagem}</p></div>`;
}
const dataCurta = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : "Data inválida"; };

function Previa({ previa, confirmando, onConfirm, onCancel, onRetry, erro }) {
  const [conferido, setConferido] = useState(false);
  const [pagina, setPagina] = useState(0);
  const v = previa.transacoes;
  const paginas = Math.max(1, Math.ceil(v.length / 50));
  const bloqueado = !previa.podeConfirmar;
  const entradas = r2(v.filter((t) => t.valor > 0).reduce((a, t) => a + t.valor, 0));
  const saidas = r2(v.filter((t) => t.valor < 0).reduce((a, t) => a + t.valor, 0));
  const p = previa.periodo;
  return html`<section class="space-y-5">
    <article class="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white p-5 md:p-7">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class=${cn("text-sm font-black", bloqueado ? "text-amber-800" : "text-emerald-700")}>${bloqueado ? "Leitura precisa de atenção" : "Prévia pronta para conferência"}</p>
          <h2 class="mt-2 break-all text-xl font-black">${previa.arquivo}</h2>
          <p class="mt-1 text-sm text-slate-600">${previa.conta?.banco || "Banco não identificado"} · ${previa.conta?.apelido} · ${p ? `${dataCurta(p.inicio)} a ${dataCurta(p.fim)}` : "Período não identificado"}</p>
          <p class="mt-1 text-xs text-slate-400">Colunas lidas: Data “${previa.colunas.data}” · Histórico “${previa.colunas.historico}” · Valor “${previa.colunas.valor}”${previa.colunas.saldo ? ` · Saldo “${previa.colunas.saldo}”` : ""}</p>
        </div>
        <div class="rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900">
          <p class="text-xs font-bold">Conferência obrigatória</p>
          <p class="mt-1 text-xs">A interpretação automática pode conter erros.</p>
        </div>
      </div>
      <div class="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        ${[["Movimentações", v.length], ["Prontos", previa.prontos], ["Duplicidades", v.length - previa.prontos], ["Entradas", brl(entradas)], ["Saídas", brl(saidas)]].map(([a, b]) => html`
          <div class="rounded-xl bg-slate-50 p-3"><p class="text-xs font-semibold text-slate-500">${a}</p><p class="mt-1 text-lg font-black tabular-nums">${b}</p></div>`)}
      </div>
    </article>
    <div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
      <strong>Valor vai para a conciliação. Saldo é apenas informativo.</strong>
      <p class="mt-1">O saldo do extrato não cria lançamentos e não substitui o saldo inicial cadastrado da conta.</p>
    </div>
    ${previa.avisos.length ? html`<div role="status" class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p class="font-black">${bloqueado ? "Nenhum lançamento será gravado enquanto houver campos pendentes." : "Revise antes de confirmar"}</p>
      ${previa.avisos.map((a) => html`<p class="mt-2">${a}</p>`)}</div>` : null}
    ${previa.issues.length ? html`<article class="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 class="text-base font-black">Diagnóstico da leitura</h3>
      <div class="mt-3 max-h-72 space-y-3 overflow-y-auto">
        ${previa.issues.map((i) => html`<div class="rounded-lg bg-slate-50 p-3 text-sm"><p class="font-bold">Linha ${i.linha} · ${i.mensagem}</p>
          ${i.trecho ? html`<p class="mt-1 break-words text-slate-500">${i.trecho}</p>` : null}</div>`)}
      </div></article>` : null}
    <article class="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white">
      <div class="border-b border-slate-100 p-5">
        <h3 class="text-base font-black">Movimentações identificadas</h3>
        <p class="mt-1 text-sm text-slate-500">Confira todas as páginas. Abra “Evidência” para comparar os campos com a linha original.</p>
      </div>
      <div class="overflow-x-auto"><table class="w-full min-w-[1280px]">
        <thead><tr class="bg-slate-50 text-left text-xs font-bold text-slate-500">
          ${["Data", "Descrição / Evidência", "Valor da transação", "Saldo (informativo)", "Validação"].map((c) => html`<th class="px-5 py-3">${c}</th>`)}
        </tr></thead>
        <tbody>
          ${v.slice(pagina * 50, (pagina + 1) * 50).map((t) => html`<tr key=${t.hash || t.linha} class=${cn("border-t border-slate-100 text-sm", t.duplicado && "bg-amber-50/60")}>
            <td class="whitespace-nowrap px-5 py-4 font-semibold">${dataCurta(t.data)}</td>
            <td class="min-w-72 max-w-lg px-5 py-4">
              <p class="font-bold text-slate-800">${t.descricao}</p>
              <details class="mt-2 text-xs text-slate-500"><summary class="cursor-pointer text-emerald-700">Evidência · Linha ${t.linha}</summary>
                <p class="mt-2 whitespace-pre-wrap break-words">${t.trecho}</p>
                <p>Data: ${t.rawData || "—"} · Valor: ${t.rawValor || "—"} · Saldo: ${t.rawSaldo || "—"}</p>
              </details>
            </td>
            <td class=${cn("whitespace-nowrap px-5 py-4 font-black tabular-nums", t.valor < 0 ? "text-slate-800" : "text-emerald-700")}>${brl(t.valor)}</td>
            <td class="whitespace-nowrap px-5 py-4 tabular-nums text-slate-500">${t.saldo == null ? "Não informado" : brl(t.saldo)}</td>
            <td class="px-5 py-4 text-xs font-bold">${t.duplicado ? html`<span class="text-amber-700">Já importado</span>` : bloqueado ? "Bloqueado" : html`<span class="text-emerald-700">A conferir</span>`}</td>
          </tr>`)}
          ${!v.length ? html`<tr><td colSpan="5" class="p-8 text-center text-sm text-slate-500">Nenhuma movimentação completa. Consulte o diagnóstico acima.</td></tr>` : null}
        </tbody>
      </table></div>
      <div class="flex items-center justify-between gap-3 border-t p-4 text-sm">
        <button type="button" disabled=${!pagina || confirmando} onClick=${() => setPagina(pagina - 1)} class="rounded-lg border px-3 py-2 disabled:opacity-40">Anterior</button>
        <span>Página ${pagina + 1} de ${paginas} · ${v.length} movimentações</span>
        <button type="button" disabled=${pagina + 1 >= paginas || confirmando} onClick=${() => setPagina(pagina + 1)} class="rounded-lg border px-3 py-2 disabled:opacity-40">Próxima</button>
      </div>
    </article>
    ${previa.saldos.length ? html`<details class="rounded-2xl border border-slate-200 bg-white p-5">
      <summary class="cursor-pointer text-sm font-bold">Saldos e posições separados (${previa.saldos.length}) — não importados como transações</summary>
      <div class="mt-3 max-h-60 overflow-y-auto">${previa.saldos.map((s) => html`<p class="mt-2 text-sm text-slate-600">Linha ${s.linha} · ${s.descricao || "Saldo"}: <strong>${s.saldo == null ? "—" : brl(s.saldo)}</strong></p>`)}</div>
    </details>` : null}
    ${!bloqueado && previa.prontos > 0 ? html`<label class="flex cursor-pointer items-start gap-3 rounded-2xl border border-emerald-200 bg-white p-5 text-sm font-semibold">
      <input type="checkbox" checked=${conferido} disabled=${confirmando} onChange=${(e) => setConferido(e.target.checked)} class="mt-0.5 h-5 w-5 accent-emerald-600" />
      <span>Conferi as datas, descrições e valores. Entendo que a coluna Saldo é somente informativa e não será enviada como movimentação.</span>
    </label>` : null}
    ${erro ? html`<${ErroBox} mensagem=${erro} />` : null}
    <div class="flex flex-wrap justify-end gap-3">
      <button type="button" onClick=${onCancel} disabled=${confirmando} class="h-12 rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold">Escolher outro arquivo</button>
      ${bloqueado ? html`<button type="button" onClick=${onRetry} class="premium-button-primary h-12">Tentar leitura novamente</button>`
        : html`<button type="button" onClick=${() => onConfirm(conferido)} disabled=${confirmando || !previa.prontos || !conferido} class="premium-button-primary h-12 disabled:opacity-40">
          ${confirmando ? "Confirmando..." : "Confirmar e enviar à conciliação"}</button>`}
    </div>
  </section>`;
}

function Sucesso({ fonte, resultado: r, onReset }) {
  const avisos = [...(r?.warnings || []), ...(r?.issues || [])];
  const plat = fonte === "platform";
  return html`<section class="rounded-[1.8rem] border border-emerald-200 bg-white p-8 text-center md:p-12">
    <span class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500 text-[#07110e]"><${Ic} nome="check-circle" class="h-8 w-8" /></span>
    <p class="mt-6 text-sm font-bold text-emerald-700">Importação concluída</p>
    <h2 class="mt-2 text-2xl font-black">${r?.count || 0} registro(s) novo(s)</h2>
    ${r?.updatedCount > 0 ? html`<p class="mt-2 text-sm font-bold">${r.updatedCount} venda(s) atualizada(s), incluindo reembolsos.</p>` : null}
    <p class="mx-auto mt-2 max-w-lg text-sm text-slate-500">${plat ? "Dados disponíveis na DRE e no Relatório de Vendas." : "Os lançamentos aguardam classificação na Conciliação."}</p>
    ${r?.duplicateCount > 0 || r?.ignoredCount > 0 ? html`<p class="mt-3 text-sm font-bold text-amber-700">${r.duplicateCount || 0} duplicidade(s) e ${r.ignoredCount || 0} linha(s) ignorada(s).</p>` : null}
    ${plat ? html`<p class="mt-2 text-sm">${r.processedCount} de ${r.totalRows} linhas processadas · 100%</p>` : null}
    ${avisos.length ? html`<details class="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900">
      <summary class="cursor-pointer font-bold">Conferir avisos e linhas ignoradas</summary>
      <div class="mt-3 max-h-72 space-y-2 overflow-y-auto">${avisos.slice(0, 200).map((a) => html`<p>${a}</p>`)}</div>
      ${avisos.length > 200 ? html`<p class="mt-3">Exibindo os primeiros 200 avisos de linhas. Total ignorado: ${r.ignoredCount}.</p>` : null}
    </details>` : null}
    <div class="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
      <button type="button" onClick=${onReset} class="h-12 rounded-2xl border border-slate-200 px-5 text-sm font-bold">Importar outro arquivo</button>
      <a href=${plat ? "#/financeiro/vendas" : "#/financeiro/conciliacao"} class="premium-button-primary h-12">
        ${plat ? "Abrir Relatório de Vendas" : "Ir para Conciliação"}<${Ic} nome="arrow-up-right" class="h-4 w-4" /></a>
    </div>
  </section>`;
}

const ROTULO_TIPO = { extrato: "Extrato", cartao: "Cartão", plataforma: "Plataforma" };
function Historico({ linhas, carregando, ocupado, excluindo, mensagem, contaPorId, onDelete }) {
  const podeExcluir = (l) => ["previa", "falhou", "concluida"].includes(l.status) || (l.status === "processando" && l.tipo === "plataforma");
  const origem = (l) => {
    const fmt = extensao(l.arquivo).toUpperCase() || "—";
    const tipo = l.tipo === "plataforma" ? (LAYOUT_VENDAS[l.plataforma] ? LAYOUT_VENDAS[l.plataforma].rotulo : l.plataforma || "Plataforma") : ROTULO_TIPO[l.tipo] || l.tipo;
    return `${tipo} · ${fmt}`;
  };
  return html`<section class="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white">
    <div class="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-5 md:p-7">
      <div class="flex items-center gap-3"><${Ic} nome="history" class="h-5 w-5 text-emerald-600" /><h2 class="text-base font-black">Histórico de importações</h2></div>
      <button type="button" onClick=${() => onDelete({})} disabled=${ocupado || carregando || !linhas.length}
        class="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40">
        ${excluindo ? html`<${Ic} nome="loader" class="h-4 w-4 fin-spin" />` : html`<${Ic} nome="trash" class="h-4 w-4" />`}${excluindo ? "Excluindo..." : "Limpar histórico"}</button>
    </div>
    ${mensagem ? html`<p role=${mensagem.error ? "alert" : "status"} class=${cn("border-b px-5 py-4 text-sm font-medium", mensagem.error ? "border-rose-100 bg-rose-50 text-rose-800" : "border-emerald-100 bg-emerald-50 text-emerald-800")}>${mensagem.text}</p>` : null}
    <div class="overflow-x-auto"><table class="w-full min-w-[1333px]">
      <thead><tr class="bg-slate-50 text-left text-[14.5px] font-black uppercase tracking-widest text-slate-400">
        <th class="px-5 py-3">Data</th><th class="px-5 py-3">Arquivo</th><th class="px-5 py-3">Tipo / Origem</th><th class="px-5 py-3">Conta</th>
        <th class="px-5 py-3 text-right">Importados</th><th class="px-5 py-3 text-right">Ignorados</th><th class="px-5 py-3 text-right">Duplicados</th>
        <th class="px-5 py-3">Status</th><th class="px-5 py-3 text-right">Ações</th>
      </tr></thead>
      <tbody>
        ${carregando ? html`<tr><td colSpan="9" class="p-10 text-center text-sm text-slate-400">Carregando histórico...</td></tr>`
          : linhas.length ? linhas.map((l) => html`<tr key=${l.id} class="border-t border-slate-100 text-xs">
            <td class="whitespace-nowrap px-5 py-3 font-bold text-slate-500">${new Date(l.created_at).toLocaleString("pt-BR")}</td>
            <td class="max-w-64 truncate px-5 py-3 font-black text-slate-800" title=${l.arquivo}>${l.arquivo}</td>
            <td class="px-5 py-3 text-slate-500">${origem(l)}</td>
            <td class="px-5 py-3 text-slate-500">${contaPorId.get(l.conta_id)?.apelido || contaPorId.get(l.conta_id)?.banco || "—"}</td>
            <td class="px-5 py-3 text-right font-black text-emerald-700">${l.importados}</td>
            <td class="px-5 py-3 text-right font-bold text-slate-500">${l.ignorados}</td>
            <td class="px-5 py-3 text-right font-bold text-amber-700">${l.duplicados}</td>
            <td class="px-5 py-3"><${StatusImportacao} status=${l.status} /></td>
            <td class="px-5 py-3 text-right">
              <button type="button" onClick=${() => onDelete({ id: l.id, arquivo: l.arquivo, status: l.status })} disabled=${ocupado || !podeExcluir(l)}
                aria-label=${`Excluir histórico de ${l.arquivo}`}
                title=${podeExcluir(l) ? (l.status === "processando" ? "Cancelar processamento e excluir histórico" : "Excluir somente o histórico") : "Aguarde o processamento"}
                class="inline-flex items-center gap-2 rounded-lg px-3 py-2 font-bold text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40">
                <${Ic} nome="trash" class="h-4 w-4" />Excluir</button>
            </td>
          </tr>`)
          : html`<tr><td colSpan="9" class="p-10 text-center text-sm text-slate-400">Nenhuma importação registrada.</td></tr>`}
      </tbody>
    </table></div>
  </section>`;
}
function StatusImportacao({ status }) {
  const falhou = status === "falhou", aguard = status === "previa", proc = status === "processando";
  return html`<span class=${cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[13.5px] font-black uppercase tracking-widest",
    falhou ? "bg-rose-50 text-rose-700" : aguard || proc ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")}>
    <${Ic} nome=${falhou ? "circle-x" : proc ? "loader" : aguard ? "clock" : "check-circle"} class=${cn("h-3 w-3", proc && "fin-spin")} />
    ${falhou ? "Falhou" : proc ? "Em processamento" : aguard ? "Aguardando" : "Concluída"}</span>`;
}

/* ---------- Plataformas de vendas ---------- */
function PlataformasVendas({ desabilitado, onBusy, onComplete, onHistorico }) {
  const [origem, setOrigem] = useState("HOTMART");
  const [nome, setNome] = useState("");
  const [arquivo, setArquivo] = useState(null);
  const [fase, setFase] = useState("idle"); // idle | reading | preview | uploading | paused
  const [lido, setLido] = useState(null);
  const [progresso, setProgresso] = useState(null); // {processadas, total}
  const [erro, setErro] = useState("");
  const estado = useRef({ importacaoId: null, criouRegistro: false, anteriores: [], novos: 0, atualizadas: 0, offset: 0 });
  const ativo = useRef(true);
  const ocupado = fase === "reading" || fase === "uploading";
  useEffect(() => { onBusy(ocupado); return () => onBusy(false); }, [ocupado]);
  useEffect(() => () => { ativo.current = false; }, []);
  useEffect(() => {
    if (!ocupado) return;
    const f = (e) => { e.preventDefault(); e.returnValue = ""; };
    addEventListener("beforeunload", f);
    return () => removeEventListener("beforeunload", f);
  }, [ocupado]);
  const zerar = () => { setLido(null); setProgresso(null); setFase("idle"); setErro(""); estado.current = { importacaoId: null, criouRegistro: false, anteriores: [], novos: 0, atualizadas: 0, offset: 0 }; };

  async function conferir() {
    if (!arquivo || ocupado || desabilitado) return;
    setErro(""); setFase("reading");
    try {
      if (origem === "OTHER" && nome.trim().length < 2) throw new Error("Informe o nome da plataforma de origem.");
      if (arquivo.size > LIMITES_IMPORTACAO.bytesPlataforma) throw new Error("O arquivo excede 100 MB. Divida o relatório em períodos menores.");
      if (!["csv", "xls", "xlsx"].includes(extensao(arquivo.name))) throw new Error("Envie o relatório em CSV ou Excel (XLS/XLSX).");
      const { rows, aba } = await lerPlanilha(arquivo);
      const r = await interpretarVendas(rows, { plataforma: origem, nome });
      if (!r.vendas.length) throw new Error("Nenhuma venda com data e valor foi encontrada no arquivo.");
      if (!ativo.current) return;
      setLido({ ...r, aba, arquivo: arquivo.name });
      setFase("preview");
    } catch (e) { if (ativo.current) { setFase("idle"); setErro(os.errMsg(e) || "Falha na leitura."); } }
  }

  async function importar() {
    if (!lido || ocupado || desabilitado) return;
    setErro(""); setFase("uploading");
    const st = estado.current;
    const plataforma = origem === "OTHER" ? nome.trim() : origem;
    const total = lido.vendas.length;
    try {
      if (!st.importacaoId) {
        // Retomar: mesma plataforma + arquivo + nº de vendas ainda em processamento continua do último lote salvo.
        const { data: abertas, error: e1 } = await os.sb.from("fin_importacoes").select("*").eq("tipo", "plataforma").eq("plataforma", plataforma)
          .eq("arquivo", lido.arquivo).eq("status", "processando").eq("total_linhas", total).order("created_at", { ascending: false }).limit(1);
        if (e1) throw e1;
        if (abertas && abertas.length) { st.importacaoId = abertas[0].id; st.offset = abertas[0].processadas || 0; }
        else {
          const { data, error } = await os.sb.from("fin_importacoes").insert({
            arquivo: lido.arquivo, tipo: "plataforma", plataforma, status: "processando", total_linhas: total, processadas: 0,
            ignorados: lido.issues.length, duplicados: lido.duplicados, importados: 0,
            periodo_inicio: lido.vendas.reduce((a, v) => (!a || v.data_competencia < a ? v.data_competencia : a), null),
            periodo_fim: lido.vendas.reduce((a, v) => (!a || v.data_competencia > a ? v.data_competencia : a), null),
            avisos: [...lido.avisos, ...lido.issues.slice(0, 200)],
          }).select().single();
          if (error) throw error;
          st.importacaoId = data.id; st.criouRegistro = true; st.offset = 0;
        }
        onHistorico();
      }
      setProgresso({ processadas: st.offset, total });
      while (st.offset < total && ativo.current) {
        const lote = lido.vendas.slice(st.offset, st.offset + LOTE);
        const { data: existentes, error: e2 } = await os.sb.from("fin_vendas").select("*").eq("plataforma", plataforma).in("hash", lote.map((v) => v.hash));
        if (e2) throw e2;
        const jaTinha = new Set((existentes || []).map((v) => v.hash));
        st.anteriores.push(...(existentes || []).filter((v) => v.importacao_id !== st.importacaoId));
        const { error: e3 } = await os.sb.from("fin_vendas").upsert(lote.map((v) => ({ ...v, plataforma, importacao_id: st.importacaoId })), { onConflict: "plataforma,hash" });
        if (e3) throw e3;
        st.novos += lote.filter((v) => !jaTinha.has(v.hash)).length;
        st.atualizadas += jaTinha.size;
        st.offset += lote.length;
        await atualizarImportacao(st.importacaoId, { processadas: st.offset, importados: st.novos });
        if (ativo.current) setProgresso({ processadas: st.offset, total });
      }
      if (!ativo.current) return;
      await atualizarImportacao(st.importacaoId, {
        status: "concluida", processadas: total, importados: st.novos,
        avisos: [`${st.atualizadas} venda(s) atualizada(s)`, ...lido.avisos, ...lido.issues.slice(0, 200)],
      });
      os.registrarDesfazer(ESCOPO, `importação de vendas de ${lido.arquivo}`, desfazerImportacaoVendas(st.importacaoId, st.anteriores, st.criouRegistro), { mensagem: "Importação concluída" });
      onComplete({ count: st.novos, updatedCount: st.atualizadas, duplicateCount: lido.duplicados, ignoredCount: lido.issues.length,
        processedCount: total, totalRows: total, warnings: lido.avisos, issues: lido.issues });
    } catch (e) {
      if (ativo.current) { setFase("paused"); setErro((os.errMsg(e) || "Um lote falhou.") + " Os lotes anteriores foram preservados."); }
      onHistorico();
    }
  }

  const pct = progresso && progresso.total ? Math.floor((progresso.processadas / progresso.total) * 100) : 0;
  const lay = LAYOUT_VENDAS[origem];
  return html`<fieldset disabled=${desabilitado} class="min-w-0 rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-sm md:p-7">
    <h2 class="text-lg font-black">Plataformas de Vendas</h2>
    <div class="mt-5 grid gap-5 md:grid-cols-2">
      <div>
        <label class="mb-2 block text-sm font-bold">Origem do relatório</label>
        <select aria-label="Origem do relatório" value=${origem} disabled=${ocupado || fase === "paused"} onChange=${(e) => { setOrigem(e.target.value); zerar(); }} class="filter-select">
          <option value="HOTMART">Hotmart</option><option value="EDUZZ">Eduzz</option><option value="OTHER">Outros Relatórios de Vendas</option>
        </select>
      </div>
      ${origem === "OTHER" ? html`<div>
        <label for="sales-origin" class="mb-2 block text-sm font-bold">Nome da plataforma</label>
        <input id="sales-origin" value=${nome} maxLength="80" disabled=${ocupado || fase === "paused"} onInput=${(e) => { setNome(e.target.value); zerar(); }} placeholder="Ex.: TMB" class="filter-select" />
      </div>` : null}
      <div class=${origem === "OTHER" ? "md:col-span-2" : ""}>
        <label for="sales-file" class="mb-2 block text-sm font-bold">Arquivo CSV ou Excel · até 100 MB</label>
        <input id="sales-file" type="file" accept=".csv,.xls,.xlsx" disabled=${ocupado} onChange=${(e) => { setArquivo((e.target.files && e.target.files[0]) || null); zerar(); }}
          class="block w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-emerald-100 file:px-3 file:py-2 file:font-bold file:text-emerald-950" />
      </div>
    </div>
    ${fase === "reading" ? html`<p role="status" class="mt-5 flex items-center gap-2 text-sm font-semibold text-emerald-800"><${Ic} nome="loader" class="h-4 w-4 fin-spin" />Lendo e conferindo o arquivo…</p>` : null}
    ${lido ? html`<div class="mt-6 space-y-4">
      <div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
        <p class="font-bold">${lido.arquivo} · ${lido.totalLinhas.toLocaleString("pt-BR")} linhas · ${lido.aba}</p>
        <p class="mt-2">Data: ${lido.colunas.date} · Faturamento bruto: ${lido.colunas.gross}</p>
        ${lay.texto ? html`<p class="mt-1">${lay.texto}</p>` : null}
      </div>
      ${[...lido.avisos, ...lido.issues].length ? html`<div class="max-h-48 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p class="font-bold">Confira antes de confirmar</p>${[...lido.avisos, ...lido.issues].slice(0, 200).map((a) => html`<p class="mt-2">${a}</p>`)}</div>` : null}
      ${fase === "preview" ? html`<div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead><tr class="border-b text-slate-500"><th class="p-3">Data</th><th class="p-3">Produto</th><th class="p-3 text-right">Receita / Cancelamento</th></tr></thead>
          <tbody>${lido.vendas.slice(0, 8).map((v) => { const val = v.reembolso ? -v.bruto : v.bruto; return html`<tr class="border-b border-slate-100">
            <td class="whitespace-nowrap p-3">${dataCurta(v.data_competencia)}</td><td class="p-3">${v.produto || "—"}</td>
            <td class=${cn("p-3 text-right font-bold", val < 0 ? "text-rose-700" : "text-emerald-700")}>${brl(val)}</td></tr>`; })}</tbody>
        </table>
        <p class="mt-2 text-xs text-slate-500">Amostra de até 8 vendas. Todas as linhas serão validadas durante o processamento.</p>
      </div>` : null}
    </div>` : null}
    ${fase === "uploading" || fase === "paused" ? html`<div class="mt-6 rounded-2xl bg-slate-50 p-5" role="status">
      <p class="font-bold">${fase === "paused" ? "Importação pausada" : "Importando…"} ${pct}%</p>
      <progress aria-label="Progresso da importação" value=${progresso?.processadas || 0} max=${progresso?.total || lido?.vendas.length || 1} class="mt-3 h-3 w-full accent-emerald-500"></progress>
      <p class="mt-2 text-sm">${(progresso?.processadas || 0).toLocaleString("pt-BR")} de ${(progresso?.total || lido?.vendas.length || 0).toLocaleString("pt-BR")} linhas processadas</p>
      <p class="mt-2 text-xs text-slate-500">Cada lote confirmado fica salvo. Se sair, selecione o mesmo arquivo para continuar.</p>
    </div>` : null}
    ${erro ? html`<p role="alert" class="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">${erro}</p>` : null}
    <div class="mt-6 flex flex-wrap justify-end gap-3">
      ${fase === "preview" ? html`<button type="button" onClick=${zerar} class="rounded-xl border px-4 py-3 text-sm font-bold">Voltar</button>` : null}
      <button type="button" disabled=${ocupado || !arquivo} onClick=${fase === "preview" || fase === "paused" ? importar : conferir} class="premium-button-primary disabled:opacity-50">
        ${ocupado ? html`<${Ic} nome="loader" class="h-4 w-4 fin-spin" />` : fase === "paused" ? html`<${Ic} nome="play" class="h-4 w-4" />`
          : fase === "preview" ? html`<${Ic} nome="upload" class="h-4 w-4" />` : html`<${Ic} nome="file-spreadsheet" class="h-4 w-4" />`}
        ${fase === "reading" ? "Conferindo…" : fase === "uploading" ? "Importando…" : fase === "paused" ? "Retomar importação" : fase === "preview" ? "Confirmar importação" : "Conferir arquivo"}
      </button>
    </div>
  </fieldset>`;
}

/** Plataformas com vendas: HOTMART/EDUZZ + as que aparecem no histórico; contagem por consulta "head". */
async function fetchPlataformasComDados() {
  const { data, error } = await os.sb.from("fin_importacoes").select("plataforma").eq("tipo", "plataforma").not("plataforma", "is", null);
  if (error) throw error;
  const nomes = [...new Set(["HOTMART", "EDUZZ", ...(data || []).map((r) => r.plataforma)])];
  const out = [];
  for (const p of nomes) {
    const r = await os.sb.from("fin_vendas").select("id", { count: "exact", head: true }).eq("plataforma", p);
    if (r.error) throw r.error;
    if (r.count) out.push({ platformName: p, label: LAYOUT_VENDAS[p] ? LAYOUT_VENDAS[p].rotulo : p, salesCount: r.count });
  }
  return out;
}

function LimparPlataforma({ desabilitado, onBusy, onCleared }) {
  const [plats, setPlats] = useState(null);
  const [falha, setFalha] = useState(false);
  const [sel, setSel] = useState("");
  const [alvo, setAlvo] = useState(null);
  const [limpando, setLimpando] = useState(false);
  const [msg, setMsg] = useState(null);
  const carregar = () => { setFalha(false); setPlats(null); fetchPlataformasComDados().then(setPlats).catch(() => { setFalha(true); setPlats([]); }); };
  useEffect(carregar, []);
  const escolhida = (plats || []).find((p) => p.platformName === sel);

  async function limpar() {
    if (!alvo || limpando) return;
    setLimpando(true); onBusy(true); setMsg(null);
    try {
      const vendas = await paginar(() => os.sb.from("fin_vendas").select("*").eq("plataforma", alvo.platformName).order("id"));
      const imps = await paginar(() => os.sb.from("fin_importacoes").select("*").eq("tipo", "plataforma").eq("plataforma", alvo.platformName).order("id"));
      const { error } = await os.sb.from("fin_vendas").delete().eq("plataforma", alvo.platformName);
      if (error) throw error;
      const r = await os.sb.from("fin_importacoes").delete().eq("tipo", "plataforma").eq("plataforma", alvo.platformName);
      if (r.error) throw r.error;
      os.registrarDesfazer(ESCOPO, `limpeza dos dados de ${alvo.label}`, async () => {
        for (const lote of emLotes(imps, 200)) { const x = await os.sb.from("fin_importacoes").insert(lote.map(semAuto)); if (x.error) throw x.error; }
        for (const lote of emLotes(vendas, LOTE)) { const x = await os.sb.from("fin_vendas").insert(lote.map(semAuto)); if (x.error) throw x.error; }
        return true;
      }, { toast: false });
      setSel(""); onCleared();
      setMsg({ error: false, text: `Dados de ${alvo.label} limpos. ${vendas.length.toLocaleString("pt-BR")} venda(s) e ${imps.length.toLocaleString("pt-BR")} registro(s) de importação excluídos. Você já pode importar novamente.` });
    } catch (e) {
      setMsg({ error: true, text: os.errMsg(e) || "Não foi possível limpar os dados." });
    } finally { setLimpando(false); onBusy(false); }
  }

  const carregando = plats === null;
  return html`<section class="rounded-[1.6rem] border border-slate-200 bg-white p-5 md:p-7">
    <h2 class="text-base font-black">Limpar dados da plataforma</h2>
    <p class="mt-1 text-sm text-slate-500">Zere as vendas importadas de uma plataforma em todos os períodos.</p>
    <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
      <div class="min-w-0 flex-1">
        <label class="mb-2 block text-sm font-bold">Plataforma cadastrada</label>
        <select aria-label="Plataforma para limpar" class="filter-select" value=${sel} disabled=${desabilitado || limpando || carregando || falha || !(plats || []).length}
          onChange=${(e) => { setSel(e.target.value); setMsg(null); }}>
          <option value="">${carregando ? "Carregando plataformas…" : (plats || []).length ? "Selecione uma plataforma" : "Nenhuma plataforma com dados"}</option>
          ${(plats || []).map((p) => html`<option value=${p.platformName}>${p.label} · ${p.salesCount.toLocaleString("pt-BR")} venda(s)</option>`)}
        </select>
      </div>
      <button type="button" disabled=${desabilitado || limpando || !escolhida || falha} onClick=${() => { setMsg(null); setAlvo(escolhida); }}
        class="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-5 text-sm font-bold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40">
        ${limpando ? html`<${Ic} nome="loader" class="h-4 w-4 fin-spin" />` : html`<${Ic} nome="trash" class="h-4 w-4" />`}${limpando ? "Limpando…" : "Limpar dados"}</button>
    </div>
    ${falha ? html`<p role="alert" class="mt-3 text-sm text-rose-700">Não foi possível carregar as plataformas. <button type="button" onClick=${carregar} class="font-bold underline">Tentar novamente</button></p>` : null}
    ${msg ? html`<p role=${msg.error ? "alert" : "status"} class=${cn("mt-4 rounded-xl p-4 text-sm", msg.error ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-900")}>${msg.text}</p>` : null}
    <${ConfirmDialog} aberto=${!!alvo} onClose=${() => setAlvo(null)} onConfirm=${limpar} textoConfirmar="Limpar dados"
      titulo=${`Limpar todos os dados de ${alvo?.label || ""}?`}
      descricao=${`Serão excluídas todas as vendas de ${alvo?.label || "esta plataforma"}, de todos os períodos, incluindo receitas, cancelamentos, taxas e coprodução, além do histórico de importações dessa origem. A DRE, a Visão Geral e o Relatório de Vendas serão recalculados. Extratos, cartões e outras plataformas serão mantidos.`} />
  </section>`;
}

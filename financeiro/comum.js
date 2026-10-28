// Financeiro (cópia do Craft Green) — base compartilhada pelas 8 telas.
// Dono: arquiteto-plataforma. Os devs das telas NÃO editam este arquivo (evita conflito no trabalho em
// paralelo): se precisar de um helper novo, crie dentro do arquivo da sua tela e avise no relatório.
// Spec completa (regras, textos, design tokens): docs/financeiro-spec.md.
//
// Design: as telas usam as MESMAS classes Tailwind do Craft (copie do código de referência). O Craft usa
// html{font-size:12px} no desktop; aqui o <FinPage> aplica zoom .75 a partir de 768px, então classes em
// rem (text-xs, p-5, h-12...) ficam idênticas. Classes com px literal (text-[11px], h-[18px]) precisam ser
// multiplicadas por 4/3 para ficarem iguais (tabela na spec), ou use as classes .fin-* deste arquivo.
import { html } from "htm/preact";
import { useState, useEffect, useMemo, useId } from "preact/hooks";

/* ============================ Dependências do app ============================ */
// Preenchido por app.js (configurarFinanceiro) antes do primeiro render: sb, notify, errMsg, temArea,
// ehAdmin, Modal, Btn, registrarDesfazer, useAoDesfazer, desfazerCriacao, desfazerEdicao, desfazerExclusao.
export const os = {};
export function configurarFinanceiro(deps) { Object.assign(os, deps); }

/** Escopo do DESFAZER da tela (o Shell já mostra o botão para #/financeiro/<slug>). */
export function escopoFin(slug) { return "financeiro/" + slug; }
/** Quem grava no Financeiro (o banco confere de novo por RLS). */
export function podeEditarFin(me) { return !!(os.temArea && os.temArea(me, "financeiro")); }

/* ============================ Design tokens (Craft) ============================ */
export const FIN = {
  cor: {
    fundoPagina: "#f5f7f6",       // bg das telas (layout do Craft)
    fundoApp: "#F6F8FB",          // --background
    texto: "#0F172A",             // --foreground (slate-900)
    tinta: "#07110e",             // títulos, cards escuros, sidebar, barras de despesa
    tintaVerde: "#071b13",        // card "Saldo Disponível" / card escuro da DRE
    bordaEscura: "#102e20",
    marca: "#064e3b",             // --brand (emerald-900)
    marcaSuave: "#d1fae5",        // --brand-muted (emerald-100)
    esmeralda: "#10b981",         // emerald-500: cards de entrada, ativo no menu, barras de receita
    esmeralda400: "#34d399",
    esmeralda600: "#059669",      // linha do gráfico de saldo
    esmeralda700: "#047857",      // textos positivos, eyebrows
    esmeralda800: "#065f46",
    esmeralda950: "#022c22",
    esmeralda50: "#ecfdf5",
    esmeralda200: "#a7f3d0",
    rosa700: "#be123c",           // negativos
    rosaDre: "#be3853",           // negativos da DRE resumida
    ambar700: "#b45309",
    borda: "#e2e8f0",             // slate-200
    bordaSuave: "#f1f5f9",        // slate-100
    bordaVerde: "#dce7e1",        // tabela da DRE
    linhaVerde: "#e9efeb",
    cabecalhoTabela: "#f3f7f5",
    linhaCalculo: "#e8f8ef",      // linhas calculadas da DRE
    trilho: "#eef3f0",            // trilho das barras de entradas/saídas
    fundoGrafico: "#f8faf9",
    gradeGrafico: "#dfe8e3",
    eixoGrafico: "#b9cbc1",
    textoEixo: "#64746c",
    textoEixoForte: "#52655a",
    mutado: "#738078",
    slate400: "#94a3b8", slate500: "#64748b", slate600: "#475569", slate800: "#1e293b",
  },
  // Gradiente do botão principal ("Importar extrato", "Nova importação", "Exportar"...)
  gradienteBotao: "linear-gradient(to right, #022c22, #064e3b, #0f172a)",
  raio: { card: "1.35rem", painel: "1.6rem", painelDre: "1.4rem", botao: "1rem", select: "1rem", pill: ".5rem", modal: "2.5rem" },
  sombra: {
    card: "0 16px 40px -35px rgba(3,15,10,0.6)",
    kpiDestaque: "0 20px 55px -38px rgba(3,15,10,0.55)",
    painel: "0 20px 55px -42px rgba(3,15,10,0.5)",
    botao: "0 18px 38px -18px rgba(6,78,59,0.75)",
    botaoHover: "0 24px 45px -20px rgba(16,185,129,0.45)",
    ativoMenu: "0 12px 30px -16px rgba(16,185,129,0.8)",
    modal: "0 32px 80px -20px rgba(0,0,0,0.15)",
  },
  fonte: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

let estilosOk = false;
/** Injeta (uma vez) a fonte Inter e as classes próprias do Craft (craft-page, filter-select, premium-*). */
export function garantirEstilosFin() {
  if (estilosOk || typeof document === "undefined") return;
  estilosOk = true;
  if (!document.querySelector("link[data-fin-fonte]")) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap";
    l.setAttribute("data-fin-fonte", "1");
    document.head.appendChild(l);
  }
  const st = document.createElement("style");
  st.setAttribute("data-fin-estilos", "1");
  st.textContent = `
.fin-shell{min-height:100vh;background:radial-gradient(circle at top left,rgba(6,78,59,.06),transparent 32rem),${FIN.cor.fundoPagina};}
.fin-shell-desfazer{display:flex;justify-content:flex-end;padding:12px 16px 0}
.fin-page{font-family:${FIN.fonte};color:${FIN.cor.texto};font-feature-settings:"ss01","ss02","cv01","cv02","cv03","tnum";-webkit-font-smoothing:antialiased;width:100%;min-width:0;padding:1rem}
.fin-page h1,.fin-page h2,.fin-page h3,.fin-page h4{letter-spacing:-.025em}
@media (min-width:768px){.fin-page{zoom:.75;padding:1.5rem}}
.fin-page .filter-select{width:100%;appearance:none;-webkit-appearance:none;border-radius:1rem;border:1px solid #e2e8f0;background:#fff;padding:.75rem 1rem;font-size:.875rem;line-height:1.25rem;font-weight:700;color:#1e293b;box-shadow:0 1px 2px 0 rgb(0 0 0/.05);outline:none;transition:all .15s cubic-bezier(.4,0,.2,1)}
.fin-page select.filter-select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right .9rem center;background-size:1rem;padding-right:2.5rem}
.fin-page .filter-select:focus{border-color:#6ee7b7;box-shadow:0 0 0 4px #d1fae5}
.fin-page .filter-select option{font-weight:600}
.fin-page .premium-button-primary{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;border-radius:1rem;background-image:${FIN.gradienteBotao};padding:.75rem 1.25rem;font-size:.875rem;line-height:1.25rem;font-weight:700;color:#fff;box-shadow:${FIN.sombra.botao};transition:all .15s cubic-bezier(.4,0,.2,1)}
.fin-page .premium-button-primary:hover:not(:disabled){transform:translateY(-.125rem);box-shadow:${FIN.sombra.botaoHover}}
.fin-page .premium-button-primary:active:not(:disabled){transform:scale(.98)}
.fin-page .premium-card{position:relative;overflow:hidden;border-radius:1.35rem;border:1px solid rgb(255 255 255/.7);background:rgb(255 255 255/.9);box-shadow:0 18px 55px -34px rgba(15,23,42,.45);transition:all .3s}
.fin-page .premium-card:hover{transform:translateY(-.125rem);border-color:#d1fae5;box-shadow:0 26px 70px -38px rgba(6,78,59,.35)}
.fin-page :where(a,button,input,select,textarea):focus-visible{outline:2px solid #10b981;outline-offset:2px}
.fin-spin{animation:fin-spin 1s linear infinite}@keyframes fin-spin{to{transform:rotate(360deg)}}
/* Tabela da DRE (dre_*.css do Craft) */
.fin-dre-report{container-type:inline-size;min-width:0;border:1px solid #dce7e1;border-radius:1.1rem;background:#fff;overflow:hidden}
.fin-dre-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}
.fin-dre-table thead th{padding:.7rem .15rem;background:#f3f7f5;color:#4b6356;font-size:clamp(.7rem,1.2cqw,.85rem);font-weight:700;text-align:right}
.fin-dre-table thead th:first-child{padding-left:.65rem;text-align:left}
.fin-dre-table thead th:last-child{padding-right:.35rem}
.fin-dre-table thead button{width:100%;min-height:2.25rem;border-radius:.35rem;padding:.15rem;color:inherit;text-align:inherit}
.fin-dre-table thead button:hover{background:#d1fae5;color:#065f46}
.fin-dre-table thead th[data-selected]{background:#d1fae5;color:#065f46;box-shadow:inset 0 -3px #10b981}
.fin-dre-row{--row-bg:#fff;--row-text:#243d30;background:var(--row-bg);color:var(--row-text)}
.fin-dre-row>*{padding:.75rem .15rem;border-top:1px solid #e9efeb;vertical-align:middle}
.fin-dre-row th{padding-left:.65rem;padding-right:.4rem;font-size:clamp(.74rem,1.2cqw,.85rem);line-height:1.45;text-align:left;font-weight:650;overflow-wrap:anywhere}
.fin-dre-row td{font-size:clamp(.7rem,1.2cqw,.85rem);line-height:1.5;text-align:right;font-variant-numeric:tabular-nums;letter-spacing:-.025em;overflow-wrap:anywhere}
.fin-dre-row td:last-child{padding-right:.35rem}
.fin-dre-row td[data-selected]{background-image:linear-gradient(#10b9810a,#10b9810a);box-shadow:inset 1px 0 #10b98125,inset -1px 0 #10b98125}
.fin-dre-row:hover{filter:brightness(.985)}
.fin-dre-row[data-tone=calculation]{--row-bg:#e8f8ef;--row-text:#064e3b}
.fin-dre-row[data-tone=calculation]>*{border-top-color:#c9e5d6;border-bottom:1px solid #c9e5d6;font-weight:800;padding-top:.9rem;padding-bottom:.9rem}
.fin-dre-row[data-tone=calculation] th{box-shadow:inset 4px 0 #10b981}
.fin-dre-row[data-tone=category]{--row-bg:#fafcfb;--row-text:#52675b}
.fin-dre-row[data-tone=category] th{font-weight:500}
.fin-dre-total{border-left:1px solid #dce7e1;font-weight:800}
.fin-dre-positive{color:#047857}.fin-dre-negative{color:#be123c}
.fin-dre-av{display:inline-block;padding:.15rem .1rem;border-radius:.3rem;color:#365944;font-weight:750}
`;
  document.head.appendChild(st);
}

/* ============================ Formatação ============================ */
export const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const DIAS_SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
/** Anos dos filtros do Craft (Visão Geral, Fluxo, Conciliação): 2024..2028. DRE: 2024..2027 + ano atual. */
export const ANOS_FILTRO = [2024, 2025, 2026, 2027, 2028];

export const cn = (...a) => a.filter(Boolean).join(" ");
const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtCompacto = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });

/** R$ com centavos (Craft x.v): "R$ 1.234,56", "-R$ 10,00". */
export function brl(v) { return fmtBRL.format(Number(v) || 0); }
/** Valor da tabela da DRE: sem centavos e sem "R$"; zero vira "—". */
export function brlDre(v) { const n = Number(v) || 0; return n === 0 ? "—" : fmtInteiro.format(n); }
/** Eixo do gráfico de saldo: "R$ 1,2 mil". */
export function brlCompacto(v) { return fmtCompacto.format(Number(v) || 0); }
/** Rótulo das barras Receita × Despesas: 1,2M / 35K / 900 (valor absoluto). */
export function compactoK(v) {
  const a = Math.abs(Number(v || 0));
  if (a >= 1e6) return (a / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "M";
  if (a >= 1e3) return Math.round(a / 1e3).toLocaleString("pt-BR") + "K";
  return a.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
/** Percentual com 1 casa: "12,3%". */
export function pct(v, casas = 1) {
  return (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }) + "%";
}
/** "2026-10-28" -> "28/10/2026" (sem fuso). */
export function dataBR(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "Data inválida";
}
/** Date -> "AAAA-MM-DD" em UTC. */
export function isoData(d) { return new Date(d).toISOString().slice(0, 10); }
/** Primeiro e último dia (ISO) de um mês (0-11) ou do ano inteiro (mes = null/"all"). */
export function periodo(ano, mes) {
  const a = Number(ano);
  if (mes === null || mes === undefined || mes === "all") return { inicio: `${a}-01-01`, fim: `${a}-12-31` };
  const m = Number(mes);
  return { inicio: isoData(Date.UTC(a, m, 1)), fim: isoData(Date.UTC(a, m + 1, 0)) };
}
/** Valor digitado em pt-BR ou en ("10.000,25", "R$ 1.234", "10000.25") -> número; NaN se inválido (regra do Craft em Contas Bancárias). */
export function parseValorBR(txt) {
  const t = String(txt || "").trim().replace(/^R\$\s*/, "").replace(/\s/g, "");
  if (!t) return NaN;
  const br = /^[-+]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/, en = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;
  let s;
  if (br.test(t) && (t.includes(",") || !en.test(t))) s = t.replace(/\./g, "").replace(",", ".");
  else if (en.test(t)) s = t.replace(/,/g, "");
  else return NaN;
  return Number(s);
}
/** Busca sem acento e sem caixa (Conciliação: "Buscar histórico..."). */
export function normalizarTexto(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }

const SIGLAS = new Set(["IBS", "CBS", "IVA", "ISS", "PIS", "COFINS", "ICMS", "DAS", "IRPJ", "CSLL", "FGTS", "INSS", "PLR", "PJ", "IPTU", "TFE", "IA", "BI", "CRM", "ERP", "TI", "IOF", "EBITDA", "PIX", "SMS", "ROAS"]);
const MINUSCULAS = new Set(["e", "de", "do", "da", "dos", "das", "com", "sem", "em", "por", "para", "ao", "aos", "à", "às"]);
/** Nome de linha/categoria da DRE como o Craft exibe: "RECEITA BRUTA" -> "Receita Bruta", siglas mantidas. */
export function nomeDre(nome) {
  return String(nome || "").replace(/\p{L}[\p{L}\p{M}\d]*/gu, (w, i) => {
    const up = w.toLocaleUpperCase("pt-BR");
    if (SIGLAS.has(up)) return up;
    const low = w.toLocaleLowerCase("pt-BR");
    return i > 0 && MINUSCULAS.has(low) ? low : low.charAt(0).toLocaleUpperCase("pt-BR") + low.slice(1);
  });
}

/** Estado lembrado no navegador (Craft guarda filtros em localStorage). Chave final: "fin:<chave>". */
export function useLocalState(chave, inicial) {
  const k = "fin:" + chave;
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(k); return s === null ? inicial : JSON.parse(s); } catch (_) { return inicial; }
  });
  const set = (nv) => setV((old) => {
    const val = typeof nv === "function" ? nv(old) : nv;
    try { localStorage.setItem(k, JSON.stringify(val)); } catch (_) { /* modo privado */ }
    return val;
  });
  return [v, set];
}

/* ============================ Dados (Supabase) ============================ */
async function todasAsPaginas(montar) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
/** Contas bancárias (padrão: só ativas), ordenadas por banco/apelido. */
export async function fetchContas({ incluirArquivadas = false } = {}) {
  let q = os.sb.from("fin_contas").select("*").order("banco").order("apelido");
  if (!incluirArquivadas) q = q.eq("ativo", true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
/** As 22 linhas da DRE em ordem (tipo 'grupo' | 'formula'). */
export async function fetchGrupos() {
  const { data, error } = await os.sb.from("fin_dre_grupos").select("*").order("ordem");
  if (error) throw error;
  return data || [];
}
/** Categorias (das linhas e as "fora da DRE"). Padrão: só ativas. */
export async function fetchCategorias({ incluirArquivadas = false } = {}) {
  let q = os.sb.from("fin_dre_categorias").select("*").order("ordem");
  if (!incluirArquivadas) q = q.eq("ativa", true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
/**
 * Lançamentos de um período. origem: "banco" (tudo menos cartão), "cartao", ou null (todos).
 * conciliado: true | false | null (todos). Cancelados ficam de fora (exceto incluirCancelados).
 */
export async function fetchLancamentos({ inicio, fim, contaId = null, conciliado = null, origem = null, incluirCancelados = false } = {}) {
  return todasAsPaginas(() => {
    let q = os.sb.from("fin_lancamentos").select("*").order("data").order("created_at");
    if (inicio) q = q.gte("data", inicio);
    if (fim) q = q.lte("data", fim);
    if (contaId && contaId !== "all") q = q.eq("conta_id", contaId);
    if (conciliado !== null) q = q.eq("conciliado", conciliado);
    if (origem === "cartao") q = q.eq("origem", "cartao");
    else if (origem === "banco") q = q.neq("origem", "cartao");
    if (!incluirCancelados) q = q.is("cancelado_em", null);
    return q;
  });
}
/** Vendas das plataformas por data de competência (ou de pagamento, campo="data_pagamento"). */
export async function fetchVendas({ inicio, fim, plataforma = null, campo = "data_competencia" } = {}) {
  return todasAsPaginas(() => {
    let q = os.sb.from("fin_vendas").select("*").order(campo);
    if (inicio) q = q.gte(campo, inicio);
    if (fim) q = q.lte(campo, fim);
    if (plataforma) q = q.eq("plataforma", plataforma);
    return q;
  });
}
/** Histórico de importações (mais recentes primeiro). */
export async function fetchImportacoes({ limite = 20 } = {}) {
  const { data, error } = await os.sb.from("fin_importacoes").select("*").order("created_at", { ascending: false }).limit(limite);
  if (error) throw error;
  return data || [];
}
/** Saldo de cada conta antes de `dataIso` = saldo_base + conciliados bancários anteriores (RPC fin_saldos_ate). */
export async function fetchSaldosAte(dataIso) {
  const { data, error } = await os.sb.rpc("fin_saldos_ate", { p_data: dataIso });
  if (error) throw error;
  return data || [];
}

/* ============================ Regras: DRE ============================ */
// Polaridade das 22 linhas (código do Craft): só informativa (os valores já vêm com sinal).
export function polaridadeDre(code) {
  const c = Number(code);
  if (c === 1 || c === 20) return "income";
  if (c === 2 || c === 3) return "deduction";
  if (c >= 5 && c <= 9) return "cost";
  if ((c >= 11 && c <= 16) || c === 18 || c === 19) return "expense";
  if (c === 22) return "distribution";
  return "result";
}
/** Linhas calculadas: código -> códigos somados (valores com sinal). INFERIDO do modelo do Craft. */
export const FORMULAS_DRE = {
  4: [1, 2, 3],
  10: [4, 5, 6, 7, 8, 9],
  17: [10, 11, 12, 13, 14, 15, 16],
  21: [17, 18, 19, 20],
};
/** Linhas destacadas como "calculation" na tabela (Receita Bruta + 4 fórmulas). */
export const LINHAS_DESTAQUE = ["1", "4", "10", "17", "21"];
/** Onde cada campo das vendas das plataformas entra na DRE (por competência). DECISÃO EM ABERTO: confirmar com a Tia. */
export const VENDAS_NA_DRE = {
  bruto: { categoria: "DRE-01-CAT-01", sinal: +1 },               // Receita Bruta Infoproduto - Serviço
  reembolso: { categoria: "DRE-02-CAT-01", sinal: -1 },           // Receitas Canceladas
  coproducao: { categoria: "DRE-08-CAT-01", sinal: -1 },          // Custos com coprodução
  taxa_processamento: { categoria: "DRE-06-CAT-01", sinal: -1 },  // Custo das transações financeiras
  taxa_streaming: { categoria: "DRE-06-CAT-01", sinal: -1 },
};

const r2 = (n) => Math.round(n * 100) / 100;
/** Mês (0-11) de uma data ISO, sem fuso. */
export function mesDe(iso) { return Number(String(iso).slice(5, 7)) - 1; }

/**
 * Monta a DRE de um ano no formato do Craft (/dre?view=detailed):
 * [{ id, code, name, isCalculated, polarity, months[12], total, children:[{ id, name, months, total }] }]
 * - lancamentos: conciliados, não cancelados, do ano (banco E cartão entram na DRE).
 * - vendas: fin_vendas do ano por data_competencia (VENDAS_NA_DRE).
 * - categorias fora da DRE e lançamentos sem categoria são ignorados.
 * - children: só categorias ativas OU com valor no ano (arquivada com histórico continua aparecendo).
 */
export function montarDre({ grupos, categorias, lancamentos = [], vendas = [] }) {
  const porCat = new Map(); // categoria_id -> months[12]
  const soma = (catId, mes, v) => {
    if (!catId || !(mes >= 0 && mes < 12)) return;
    const arr = porCat.get(catId) || Array(12).fill(0);
    arr[mes] = r2(arr[mes] + v);
    porCat.set(catId, arr);
  };
  for (const l of lancamentos) {
    if (!l.conciliado || l.cancelado_em) continue;
    soma(l.categoria_id, mesDe(l.data), Number(l.valor) || 0);
  }
  const catPorChave = new Map(categorias.filter((c) => c.default_key).map((c) => [c.default_key, c.id]));
  for (const v of vendas) {
    const mes = mesDe(v.data_competencia);
    for (const [campo, regra] of Object.entries(VENDAS_NA_DRE)) {
      const val = Number(v[campo]) || 0;
      if (val) soma(catPorChave.get(regra.categoria), mes, regra.sinal * Math.abs(val));
    }
  }
  const linhas = new Map();
  const out = grupos.slice().sort((a, b) => a.ordem - b.ordem).map((g) => {
    const filhos = categorias
      .filter((c) => c.grupo_id === g.id && !c.fora_dre)
      .sort((a, b) => a.ordem - b.ordem)
      .map((c) => {
        const months = porCat.get(c.id) || Array(12).fill(0);
        return { id: c.id, name: c.nome, months, total: r2(months.reduce((a, b) => a + b, 0)), ativa: c.ativa };
      })
      .filter((c) => c.ativa || c.total !== 0 || c.months.some((x) => x !== 0));
    const months = Array(12).fill(0).map((_, i) => r2(filhos.reduce((a, c) => a + c.months[i], 0)));
    const linha = {
      id: g.id, code: String(g.code), name: g.nome, isCalculated: g.tipo === "formula",
      polarity: polaridadeDre(g.code), months, total: r2(months.reduce((a, b) => a + b, 0)),
      children: g.tipo === "formula" ? [] : filhos,
    };
    linhas.set(Number(g.code), linha);
    return linha;
  });
  for (const code of Object.keys(FORMULAS_DRE).map(Number).sort((a, b) => a - b)) {
    const l = linhas.get(code);
    if (!l) continue;
    l.months = Array(12).fill(0).map((_, i) => r2(FORMULAS_DRE[code].reduce((a, c) => a + ((linhas.get(c) || {}).months || [])[i] || 0, 0)));
    l.total = r2(l.months.reduce((a, b) => a + b, 0));
  }
  return out;
}

/** Seleção de meses da DRE: null = ano completo; [] ou os 12 viram null. */
export function normalizarSelecao(sel) {
  if (!sel) return null;
  const a = [...new Set(sel.filter((m) => Number.isInteger(m) && m >= 0 && m < 12))].sort((x, y) => x - y);
  return a.length === 0 || a.length === 12 ? null : a;
}
/** Clique no cabeçalho do mês: inclui/remove o mês da seleção. */
export function alternarMes(sel, mes) {
  if (!Number.isInteger(mes) || mes < 0 || mes > 11) return normalizarSelecao(sel);
  const s = normalizarSelecao(sel);
  return s ? normalizarSelecao(s.includes(mes) ? s.filter((m) => m !== mes) : [...s, mes]) : [mes];
}
/** Valor de uma linha na seleção (soma em centavos para não acumular erro). */
export function valorNaSelecao(linha, sel) {
  if (!linha) return 0;
  const s = normalizarSelecao(sel);
  return s ? s.reduce((a, m) => a + Math.round(100 * (Number(linha.months && linha.months[m]) || 0)), 0) / 100 : Number(linha.total) || 0;
}
/** "Ano completo" ou "Jan + Mar". */
export function rotuloSelecao(sel) {
  const s = normalizarSelecao(sel);
  return s ? s.map((m) => MESES_CURTOS[m]).join(" + ") : "Ano completo";
}
function acharLinha(rel, code, nomeMaiusculo) {
  return rel.find((l) => l.code === code) || rel.find((l) => String(l.name).toLocaleUpperCase("pt-BR") === nomeMaiusculo);
}
/** Bases da análise vertical: receita bruta (linha 1) e faturamento líquido (linha 4). */
export function basesAv(rel, sel) {
  return {
    grossRevenue: valorNaSelecao(acharLinha(rel, "1", "RECEITA BRUTA"), sel),
    netRevenue: valorNaSelecao(acharLinha(rel, "4", "FATURAMENTO LÍQUIDO"), sel),
  };
}
/** AV% (confirmado no Craft): |valor ÷ base| × 100; base = receita bruta p/ linhas 1-4 (e categorias delas), senão faturamento líquido. */
export function avPercent(linha, sel, bases, codigoPai) {
  const base = ["1", "2", "3", "4"].includes(linha.code || codigoPai || "") ? bases.grossRevenue : bases.netRevenue;
  const v = valorNaSelecao(linha, sel);
  return base !== 0 ? Math.abs((v / base) * 100) : 0;
}
/** a ÷ b × 100 (0 se b = 0). Margem Líquida = lucro líquido ÷ faturamento líquido. */
export function percentual(a, b) { return b !== 0 ? (a / b) * 100 : 0; }
/** Indicadores da DRE/Visão Geral para a seleção. ROAS = receita bruta ÷ |gastos com tráfego| (linha 5). */
export function indicadoresDre(rel, sel) {
  const v = (code) => valorNaSelecao(rel.find((l) => l.code === code), sel);
  const receitaBruta = v("1"), lucroLiquido = v("21"), trafego = Math.abs(v("5"));
  const { netRevenue } = basesAv(rel, sel);
  // "Custos e Despesas" (Visão Geral) — INFERIDO: soma das linhas de custo/despesa (5-9, 11-16, 18, 19), negativa.
  const custosDespesas = r2(rel.filter((l) => ["cost", "expense"].includes(l.polarity)).reduce((a, l) => a + valorNaSelecao(l, sel), 0));
  return {
    receitaBruta, faturamentoLiquido: netRevenue, lucroLiquido, custosDespesas,
    margemLiquida: percentual(lucroLiquido, netRevenue),
    roas: trafego !== 0 ? receitaBruta / trafego : 0,
  };
}
/** Série mensal do gráfico "Receita × Despesas" (valores absolutos). */
export function receitaXDespesas(rel) {
  const l1 = rel.find((l) => l.code === "1");
  const custos = rel.filter((l) => ["cost", "expense"].includes(l.polarity));
  return MESES_CURTOS.map((label, i) => ({
    month: i, label,
    revenue: Math.abs(l1 ? l1.months[i] : 0),
    expenses: Math.abs(custos.reduce((a, l) => a + (l.months[i] || 0), 0)),
  }));
}
/** Linhas para o Excel "DRE_Gerencial_<ano>_<meses>.xlsx" (aba "DRE Gerencial"). */
export function linhasExportacaoDre(rel, sel) {
  const s = normalizarSelecao(sel), b = basesAv(rel, s);
  return rel.map((l) => {
    const o = { "Classificação": l.name };
    MESES_CURTOS.forEach((m, i) => { o[m] = Number(l.months[i]) || 0; });
    o["Total (R$)"] = valorNaSelecao(l, s);
    o["AV% · " + rotuloSelecao(s)] = avPercent(l, s, b).toFixed(1) + "%";
    return o;
  });
}

/* ============================ Regras: Fluxo de Caixa ============================ */
/**
 * Timeline do fluxo (Craft /cash-flow/timeline). Só lançamentos bancários conciliados (cartão fica fora;
 * entra o pagamento da fatura no extrato). Saídas = valores negativos.
 * @param saldoInicial saldo de abertura do período (soma de fetchSaldosAte(inicio) das contas filtradas)
 * @param periodo "mensal" (uma linha por mês do intervalo) | "diario" (uma por dia com movimento)
 * @returns { summary:{initialBalance,totalEntries,totalExits,periodResult,finalBalance},
 *            timeline:[{key,label,openingBalance,entries,exits,result,closingBalance}],
 *            detailRows:[{id,date,description,amount,accountName,bankName}] }
 */
export function timelineFluxo({ lancamentos, contas = [], saldoInicial = 0, inicio, fim, periodo = "mensal" }) {
  const conta = new Map(contas.map((c) => [c.id, c]));
  const validos = lancamentos
    .filter((l) => l.conciliado && !l.cancelado_em && l.origem !== "cartao" && (!inicio || l.data >= inicio) && (!fim || l.data <= fim))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  const chaves = [];
  if (periodo === "mensal") {
    const [ai, mi] = [Number(inicio.slice(0, 4)), mesDe(inicio)], [af, mf] = [Number(fim.slice(0, 4)), mesDe(fim)];
    for (let a = ai, m = mi; a < af || (a === af && m <= mf); m === 11 ? (a++, m = 0) : m++) {
      chaves.push({ key: `${a}-${String(m + 1).padStart(2, "0")}`, label: MESES[m].toLowerCase() + (ai !== af ? ` ${a}` : "") });
    }
  } else {
    [...new Set(validos.map((l) => l.data))].forEach((d) => chaves.push({ key: d, label: dataBR(d) }));
  }
  const chaveDe = (l) => (periodo === "mensal" ? l.data.slice(0, 7) : l.data);
  let saldo = Number(saldoInicial) || 0, totE = 0, totS = 0;
  const timeline = chaves.map(({ key, label }) => {
    const doPeriodo = validos.filter((l) => chaveDe(l) === key);
    const entries = r2(doPeriodo.filter((l) => l.valor > 0).reduce((a, l) => a + Number(l.valor), 0));
    const exits = r2(doPeriodo.filter((l) => l.valor < 0).reduce((a, l) => a + Number(l.valor), 0));
    const openingBalance = r2(saldo), result = r2(entries + exits);
    saldo = r2(saldo + result); totE += entries; totS += exits;
    return { key, label, openingBalance, entries, exits, result, closingBalance: saldo };
  });
  const detailRows = validos.map((l) => {
    const c = conta.get(l.conta_id) || {};
    return { id: l.id, date: l.data, description: l.historico, amount: Number(l.valor), accountName: c.apelido || "", bankName: c.banco || "" };
  });
  return {
    summary: { initialBalance: r2(Number(saldoInicial) || 0), totalEntries: r2(totE), totalExits: r2(totS), periodResult: r2(totE + totS), finalBalance: r2(saldo) },
    timeline, detailRows,
  };
}

/** Chave de agrupamento do "mesmo histórico": sem acento/caixa, sem números e datas, espaços colapsados. */
export function chaveHistorico(h) {
  return normalizarTexto(h).replace(/[0-9]+([./-][0-9]+)*/g, " ").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
}
/**
 * Contas a Pagar (Craft /cash-flow/payables) — previsão recorrente informativa, nunca grava nada.
 * Regra confirmada: "pelo menos três pagamentos conciliados do mesmo histórico".
 * Detalhes INFERIDOS: mesmo histórico = chaveHistorico + mesma conta; ocorrências em meses distintos
 * antes do mês projetado; dia = mediana dos dias das ocorrências (limitado ao último dia do mês);
 * valor = média das 3 últimas; não projeta se já houve pagamento conciliado daquele grupo no mês.
 * @param historico saídas bancárias conciliadas (valor < 0) anteriores ao fim do mês
 * @param saldoBase "Saldo antes das projeções" (saldo inicial do mês + realizado no mês)
 * @returns { summary:{openingBalance, baseBalance, totalProjected, projectedBalance, paymentCount},
 *            payments:[{id, date, description, amount(>0), occurrences, accountName, bankName, balanceAfter}] }
 */
export function previsaoRecorrente({ historico, contas = [], ano, mes, saldoInicial = 0, saldoBase = 0 }) {
  const conta = new Map(contas.map((c) => [c.id, c]));
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const chaveMes = `${ano}-${String(mes + 1).padStart(2, "0")}`;
  const grupos = new Map();
  for (const l of historico) {
    if (!l.conciliado || l.cancelado_em || l.origem === "cartao" || !(l.valor < 0)) continue;
    const k = l.conta_id + "|" + chaveHistorico(l.historico);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(l);
  }
  const payments = [];
  for (const [k, ls] of grupos) {
    if (ls.some((l) => l.data.slice(0, 7) === chaveMes)) continue; // já pago no mês
    const anteriores = ls.filter((l) => l.data.slice(0, 7) < chaveMes).sort((a, b) => (a.data < b.data ? -1 : 1));
    const meses = new Set(anteriores.map((l) => l.data.slice(0, 7)));
    if (meses.size < 3) continue;
    const dias = anteriores.map((l) => Number(l.data.slice(8, 10))).sort((a, b) => a - b);
    const dia = Math.min(ultimoDia, dias[Math.floor(dias.length / 2)]);
    const ult = anteriores.slice(-3);
    const amount = r2(Math.abs(ult.reduce((a, l) => a + Number(l.valor), 0) / ult.length));
    const ref = anteriores[anteriores.length - 1], c = conta.get(ref.conta_id) || {};
    payments.push({
      id: k, date: `${chaveMes}-${String(dia).padStart(2, "0")}`, description: ref.historico, amount,
      occurrences: anteriores.length, accountName: c.apelido || "", bankName: c.banco || "",
    });
  }
  payments.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));
  let saldo = Number(saldoBase) || 0;
  for (const p of payments) { saldo = r2(saldo - p.amount); p.balanceAfter = saldo; }
  const totalProjected = r2(payments.reduce((a, p) => a + p.amount, 0));
  return {
    summary: { openingBalance: r2(Number(saldoInicial) || 0), baseBalance: r2(Number(saldoBase) || 0), totalProjected, projectedBalance: r2((Number(saldoBase) || 0) - totalProjected), paymentCount: payments.length },
    payments,
  };
}

/* ============================ Regras: importação ============================ */
/** Impressão digital de um lançamento importado (dedup por conta: índice único conta_id+hash). */
export async function hashLancamento({ contaId, data, valor, historico, ocorrencia = 0 }) {
  const base = [contaId, data, (Number(valor) || 0).toFixed(2), normalizarTexto(historico).replace(/\s+/g, " ").trim(), ocorrencia].join("|");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
export const LIMITES_IMPORTACAO = { bytes: 4 * 1024 * 1024, paginasPdf: 40, paginasEscaneadas: 8, linhas: 5000, bytesPlataforma: 100 * 1024 * 1024 };

/* ============================ Ícones (Lucide, ISC) ============================ */
const ICONES = {
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  "arrow-up-right": '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  "arrow-down-right": '<path d="m7 7 10 10"/><path d="M17 7v10H7"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  landmark: '<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M14 8H8"/><path d="M16 12H8"/><path d="M13 16H8"/>',
  "trending-up": '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  percent: '<line x1="19" x2="5" y1="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  "check-circle": '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  "credit-card": '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  minus: '<path d="M5 12h14"/>',
};
/** Ícone Lucide inline. nome: chave de ICONES. */
export function Icone({ nome, class: cls = "h-4 w-4" }) {
  return html`<svg class=${cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICONES[nome] || "" }}></svg>`;
}

/* ============================ Componentes base ============================ */
/** Moldura de toda tela do Financeiro: injeta estilos e aplica a escala do Craft. */
export function FinPage({ children, class: cls = "space-y-6" }) {
  garantirEstilosFin();
  return html`<main class=${cn("fin-page", cls)}>${children}</main>`;
}
/** Cabeçalho de tela: eyebrow opcional (verde, caixa alta) + título + ações à direita. */
export function CabecalhoFin({ eyebrow, titulo, children }) {
  return html`
    <section class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        ${eyebrow ? html`<p class="text-[16px] font-black uppercase tracking-[0.2em] text-emerald-700">${eyebrow}</p>` : null}
        <h1 class=${cn(eyebrow && "mt-2", "text-3xl font-black tracking-[-0.045em] text-[#07110e]")}>${titulo}</h1>
      </div>
      ${children ? html`<div class="flex flex-col gap-3 sm:flex-row sm:items-center">${children}</div>` : null}
    </section>`;
}
/** Botão gradiente "premium-button-primary". href = link interno (#/financeiro/...). */
export function BotaoPrimario({ href, onClick, disabled, carregando, icone, children, class: cls = "h-12 px-5 text-xs" }) {
  const conteudo = html`${carregando ? html`<${Icone} nome="loader" class="h-4 w-4 fin-spin" />` : icone ? html`<${Icone} nome=${icone} class="h-4 w-4" />` : null}${children}`;
  if (href) return html`<a href=${href} class=${cn("premium-button-primary", cls)}>${conteudo}</a>`;
  return html`<button type="button" onClick=${onClick} disabled=${disabled || carregando}
    class=${cn("premium-button-primary disabled:cursor-not-allowed disabled:opacity-50", cls)}>${conteudo}</button>`;
}
/** Botão secundário (borda clara). */
export function BotaoSecundario({ onClick, disabled, children, class: cls = "h-12 px-5" }) {
  return html`<button type="button" onClick=${onClick} disabled=${disabled}
    class=${cn("rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 transition hover:border-emerald-200 disabled:opacity-40", cls)}>${children}</button>`;
}
/**
 * Select de filtro (classe filter-select do Craft).
 * opcoes: [[valor, rótulo], ...] ou [{ grupo, itens:[[valor, rótulo]] }] para <optgroup>.
 */
export function FiltroSelect({ rotulo, valor, onChange, opcoes, disabled, class: cls = "h-11 py-0" }) {
  const op = (o) => html`<option value=${o[0]}>${o[1]}</option>`;
  return html`<select aria-label=${rotulo} value=${valor} disabled=${disabled} onChange=${(e) => onChange(e.target.value)}
    class=${cn("filter-select disabled:cursor-not-allowed disabled:opacity-40", cls)}>
    ${opcoes.map((o) => (Array.isArray(o) ? op(o) : html`<optgroup label=${o.grupo}>${o.itens.map(op)}</optgroup>`))}
  </select>`;
}
/** Abas segmentadas escuras (Consolidado | Mensal | Contas a Pagar; Pendentes | Conciliados). */
export function AbasToggle({ opcoes, valor, onChange, class: cls = "" }) {
  return html`<div class=${cn("flex rounded-xl bg-slate-100 p-1", cls)} role="group">
    ${opcoes.map(([v, r]) => html`<button type="button" aria-pressed=${valor === v} onClick=${() => onChange(v)}
      class=${cn("flex-1 whitespace-nowrap rounded-lg px-4 py-2.5 text-[16px] font-black uppercase tracking-widest transition",
        valor === v ? "bg-[#07110e] text-white shadow" : "text-slate-500")}>${r}</button>`)}
  </div>`;
}
/** Pill/badge. tom: "verde" (emerald-50, período), "neutro", "rosa", "ambar", "escuro". */
export function Pill({ tom = "verde", children, class: cls = "" }) {
  const t = {
    verde: "border border-emerald-100 bg-emerald-50 text-emerald-800",
    neutro: "border border-slate-200 bg-slate-50 text-slate-600",
    rosa: "border border-rose-200 bg-rose-50 text-rose-700",
    ambar: "border border-amber-200 bg-amber-50 text-amber-800",
    escuro: "border border-[#07110e] bg-[#07110e] text-white",
  }[tom];
  return html`<span class=${cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold", t, cls)}>${children}</span>`;
}
/** Painel branco padrão (rounded-[1.6rem] border bg-white p-5 md:p-7). */
export function Painel({ children, class: cls = "p-5 md:p-7", rotulo }) {
  return html`<section aria-label=${rotulo} class=${cn("min-w-0 rounded-[1.6rem] border border-slate-200 bg-white", cls)}>${children}</section>`;
}
const TONS_KPI = {
  slate: "border-slate-200 bg-white text-slate-950",
  light: "border-emerald-200 bg-emerald-50 text-emerald-950",
  emerald: "border-emerald-400 bg-emerald-500 text-[#07110e]",
  "emerald-soft": "border-emerald-200 bg-white text-emerald-700",
  dark: "border-[#07110e] bg-[#07110e] text-white",
  negative: "border-rose-200 bg-white text-rose-700",
};
/** Card KPI do Fluxo de Caixa (tons: slate, light, emerald, emerald-soft, dark, negative). formato: "brl" | "pct" | "num". */
export function KpiCard({ rotulo, valor, icone, tom = "slate", carregando, formato = "brl" }) {
  const txt = formato === "pct" ? pct(valor) : formato === "num" ? Number(valor || 0).toFixed(2) : brl(valor);
  return html`<article class=${cn("min-w-0 rounded-[1.35rem] border p-5 shadow-[0_16px_40px_-35px_rgba(3,15,10,0.6)]", TONS_KPI[tom])}>
    <div class="flex items-center justify-between gap-2">
      <p class="text-xs font-bold">${rotulo}</p>
      ${icone ? html`<${Icone} nome=${icone} class="h-4 w-4 shrink-0 opacity-70" />` : null}
    </div>
    ${carregando ? html`<div class="mt-7 h-7 w-3/4 animate-pulse rounded bg-current opacity-10"></div>`
      : html`<p class="mt-7 overflow-x-auto whitespace-nowrap text-[29px] font-black tracking-tight tabular-nums">${txt}</p>`}
  </article>`;
}
const TONS_DESTAQUE = {
  emerald: "bg-emerald-500 text-[#06110d] border-emerald-400",
  dark: "bg-[#07110e] text-white border-[#07110e]",
  "emerald-soft": "bg-emerald-50 text-emerald-950 border-emerald-200",
  negative: "bg-[#07110e] text-white border-rose-900/30",
  light: "bg-white text-slate-950 border-slate-200",
};
/** Card KPI da Visão Geral (ícone grande de fundo + dica). tons: emerald, dark, emerald-soft, negative, light. */
export function KpiCardDestaque({ rotulo, valor, icone, tom = "light", dica, carregando, formato = "brl" }) {
  const claro = tom === "light";
  return html`<article class=${cn("relative min-h-28 min-w-0 overflow-hidden rounded-[1.35rem] border p-3.5 shadow-[0_20px_55px_-38px_rgba(3,15,10,0.55)]", TONS_DESTAQUE[tom])}>
    <div class="absolute -bottom-8 -right-6 opacity-[0.07]">${icone ? html`<${Icone} nome=${icone} class="h-28 w-28" />` : null}</div>
    <div class="relative flex h-full flex-col justify-between gap-3">
      <div class="flex items-center justify-between gap-2">
        <p class=${cn("text-[14.5px] font-bold tracking-wide", claro ? "text-slate-500" : "opacity-65")}>${rotulo}</p>
        <span class=${cn("flex h-9 w-9 items-center justify-center rounded-xl", claro ? "bg-emerald-50 text-emerald-700" : "bg-white/15")}>
          ${icone ? html`<${Icone} nome=${icone} class="h-4 w-4" />` : null}</span>
      </div>
      <div>
        ${carregando ? html`<div class="mb-2 h-6 w-3/4 animate-pulse rounded-lg bg-current opacity-10"></div>`
          : html`<p class="break-words text-lg font-black tracking-[-0.045em] tabular-nums md:text-xl">${formato === "pct" ? pct(valor) : brl(valor)}</p>`}
        ${dica ? html`<p class=${cn("mt-1.5 text-[14.5px] font-semibold", claro ? "text-slate-400" : "opacity-55")}>${dica}</p>` : null}
      </div>
    </div>
  </article>`;
}
const TONS_DRE = {
  green: "border-emerald-500 bg-emerald-500 text-[#071b13]",
  light: "border-emerald-200 bg-emerald-50 text-emerald-950",
  dark: "border-[#071b13] bg-[#071b13] text-white",
  white: "border-slate-200 bg-white text-slate-800",
};
/** Card KPI da DRE Gerencial (tons: green, light, dark, white). texto já formatado. */
export function KpiCardDre({ rotulo, texto, tom = "white", negativo, carregando }) {
  return html`<article class=${cn("min-w-0 rounded-[1.35rem] border p-5 shadow-sm", TONS_DRE[tom])}>
    <h3 class="text-xs font-bold">${rotulo}</h3>
    ${carregando ? html`<div class="mt-5 h-7 w-3/4 animate-pulse rounded bg-current opacity-10"></div>`
      : html`<p class=${cn("mt-5 text-[29px] font-extrabold tracking-tight tabular-nums [overflow-wrap:anywhere]", negativo && "text-rose-700")}>${texto}</p>`}
  </article>`;
}
/**
 * Tabela simples no estilo do Craft (cabeçalho bg-[#f5f8f6], linhas com borda slate-100).
 * colunas: [{ chave, rotulo, alinhar:"left"|"right", class, render:(linha)=>vnode }]
 */
export function TabelaFin({ colunas, linhas, chaveLinha = (l, i) => l.id || i, carregando, vazio = "Nenhum registro.", minLargura = "min-w-[800px]" }) {
  return html`<div class="overflow-x-auto"><table class=${cn("w-full text-left", minLargura)}>
    <thead><tr class="bg-[#f5f8f6] text-xs font-bold text-slate-600">
      ${colunas.map((c) => html`<th scope="col" class=${cn("px-5 py-4", c.alinhar === "right" && "text-right", c.classCabecalho)}>${c.rotulo}</th>`)}
    </tr></thead>
    <tbody>
      ${carregando ? html`<tr><td colSpan=${colunas.length} class="p-12 text-center text-sm font-medium text-slate-500">Carregando...</td></tr>`
        : !linhas.length ? html`<tr><td colSpan=${colunas.length}><${EstadoVazio} texto=${vazio} /></td></tr>`
        : linhas.map((l, i) => html`<tr key=${chaveLinha(l, i)} class="border-t border-slate-100 text-sm font-semibold transition-colors hover:bg-[#f8faf9]">
            ${colunas.map((c) => html`<td class=${cn("px-5 py-4", c.alinhar === "right" && "text-right tabular-nums whitespace-nowrap", c.class)}>${c.render ? c.render(l) : l[c.chave]}</td>`)}
          </tr>`)}
    </tbody></table></div>`;
}
/** Estado vazio centralizado (texto do Craft da tela). */
export function EstadoVazio({ texto, class: cls = "h-48" }) {
  return html`<div class=${cn("flex items-center justify-center px-4 text-center text-sm font-medium text-slate-500", cls)}>${texto}</div>`;
}
/** Bloco cinza pulsando (carregando gráfico/tabela). */
export function Esqueleto({ class: cls = "mt-6 h-64" }) {
  return html`<div role="status" class=${cn("animate-pulse rounded-xl bg-slate-100", cls)}><span class="sr-only">Carregando...</span></div>`;
}
/** Erro de carga do Craft: "Não foi possível carregar ..." + "Nenhum dado foi alterado." + Tentar novamente. */
export function ErroCarga({ titulo, texto = "Nenhum dado foi alterado.", onRetry }) {
  return html`<div role="alert" class="rounded-3xl border border-rose-100 bg-white p-10 text-center">
    <h2 class="font-black">${titulo}</h2>
    <p class="mt-2 text-sm text-slate-500">${texto}</p>
    ${onRetry ? html`<button type="button" onClick=${onRetry} class="premium-button-primary mt-5">Tentar novamente</button>` : null}
  </div>`;
}
/** Aviso inline do Craft (sucesso verde / erro rosa) usado em Conciliação e Importação. */
export function Aviso({ tipo = "success", children }) {
  return html`<div role=${tipo === "error" ? "alert" : "status"} class=${cn("flex items-center gap-3 rounded-2xl border p-4 text-xs font-bold",
    tipo === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800")}>
    <${Icone} nome=${tipo === "success" ? "check-circle" : "alert"} class="h-5 w-5 shrink-0" />${children}</div>`;
}
/**
 * Modal de confirmação do Craft (rounded-[2.5rem], faixa colorida no topo, 2 botões em caixa alta).
 * variante: danger | warning | info | success.
 */
export function ConfirmDialog({ aberto, titulo, descricao, textoConfirmar = "Confirmar", textoCancelar = "Cancelar", variante = "danger", onConfirm, onClose }) {
  useEffect(() => {
    if (!aberto) return;
    const on = (e) => e.key === "Escape" && onClose && onClose();
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [aberto, onClose]);
  if (!aberto) return null;
  const v = {
    danger: { ic: "alert", icCls: "bg-rose-50 text-rose-600 border-rose-100", bt: "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/20", faixa: "#f43f5e" },
    warning: { ic: "alert", icCls: "bg-amber-50 text-amber-600 border-amber-100", bt: "bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/20", faixa: "#f59e0b" },
    info: { ic: "info", icCls: "bg-emerald-50 text-emerald-700 border-emerald-100", bt: "bg-slate-900 hover:bg-slate-800 text-white shadow-slate-900/20", faixa: "#64748b" },
    success: { ic: "check-circle", icCls: "bg-emerald-50 text-emerald-600 border-emerald-100", bt: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20", faixa: "#10b981" },
  }[variante];
  return html`<div class="fin-page fixed inset-0 z-[100] flex items-center justify-center p-4" style="padding:1rem">
    <div class="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick=${onClose}></div>
    <div class="relative w-full max-w-[440px] overflow-hidden rounded-[2.5rem] border border-white/20 bg-white p-8 shadow-[0_32px_80px_-20px_rgba(0,0,0,0.15)]"
      style=${`border-top:4px solid ${v.faixa}`} role="dialog" aria-modal="true" aria-label=${titulo}>
      <button type="button" onClick=${onClose} aria-label="Fechar" class="absolute right-6 top-6 rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-900">
        <${Icone} nome="x" class="h-5 w-5" /></button>
      <div class="flex flex-col items-center text-center">
        <div class=${cn("mb-6 flex h-16 w-16 items-center justify-center rounded-[1.5rem] border", v.icCls)}><${Icone} nome=${v.ic} class="h-8 w-8" /></div>
        <h3 class="mb-2 text-xl font-black tracking-tight text-slate-900">${titulo}</h3>
        <p class="mb-8 px-2 text-sm font-medium leading-relaxed text-slate-500">${descricao}</p>
        <div class="flex w-full gap-3">
          <button type="button" onClick=${onClose} class="flex-1 rounded-2xl border border-slate-100 bg-slate-50 py-4 text-[17px] font-black uppercase tracking-widest text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900">${textoCancelar}</button>
          <button type="button" onClick=${() => { onConfirm && onConfirm(); onClose && onClose(); }}
            class=${cn("flex-1 rounded-2xl py-4 text-[17px] font-black uppercase tracking-widest shadow-lg transition-all active:scale-[0.98]", v.bt)}>${textoConfirmar}</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* ============================ Gráficos (SVG) ============================ */
/**
 * "Evolução do saldo" (Craft 487/Bw): área + linha do saldo final de cada período.
 * data: timeline de timelineFluxo(); periodLabel: texto à direita do título quando nada está em foco.
 */
export function GraficoSaldo({ data = [], carregando, periodLabel, titulo = "Evolução do saldo" }) {
  const gid = "fin-saldo-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [foco, setFoco] = useState(null);
  const g = useMemo(() => {
    const vals = data.map((d) => Number(d.closingBalance) || 0);
    const min = Math.min(0, ...vals), max = Math.max(0, ...vals), amp = max - min || 1;
    const y = (v) => 218 - ((v - min) / amp) * 192;
    const pts = data.map((d, i) => ({ ...d, x: data.length === 1 ? 538 : 102 + (i / (data.length - 1)) * 872, y: y(vals[i]) }));
    const linha = pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
    const base = y(0);
    const area = pts.length > 1 ? `${linha} L ${pts[pts.length - 1].x} ${base} L ${pts[0].x} ${base} Z` : "";
    const ticks = max === min ? [{ value: 0, y: base }] : Array.from({ length: 5 }, (_, i) => { const v = min + (amp * i) / 4; return { value: v, y: y(v) }; });
    return { pts, linha, area, ticks, base };
  }, [data]);
  const atual = g.pts.find((p) => p.key === foco);
  return html`<section class="min-w-0 rounded-[1.6rem] border border-slate-200 bg-white p-5 md:p-7" aria-label=${titulo}>
    <div class="flex min-h-8 flex-wrap items-center justify-between gap-3">
      <h2 class="text-xl font-black tracking-tight">${titulo}</h2>
      <p class="text-sm font-bold tabular-nums text-emerald-700">${atual ? `${atual.label} · ${brl(atual.closingBalance)}` : periodLabel}</p>
    </div>
    ${carregando ? html`<${Esqueleto} />` : !data.length ? html`<${EstadoVazio} texto="Nenhuma movimentação bancária conciliada no período." />` : html`
      <div class="mt-5 overflow-x-auto rounded-xl bg-[#f8faf9]">
        <svg viewBox="0 0 1000 268" class="w-full min-w-[680px]" role="group" aria-label="Saldo final de cada mês. Selecione um ponto para consultar o valor.">
          <defs><linearGradient id=${gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#10b981" stop-opacity=".24" /><stop offset="1" stop-color="#10b981" stop-opacity=".02" /></linearGradient></defs>
          ${g.ticks.map((t) => html`<g aria-hidden="true"><line x1="102" x2="974" y1=${t.y} y2=${t.y} stroke="#dfe8e3" stroke-dasharray="4 5" />
            <text x="86" y=${t.y + 4} text-anchor="end" fill="#64746c" font-size="12">${brlCompacto(t.value)}</text></g>`)}
          <line x1="102" x2="974" y1=${g.base} y2=${g.base} stroke="#b9cbc1" />
          <path d=${g.area} fill=${`url(#${gid})`} />
          <path d=${g.linha} fill="none" stroke="#059669" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
          ${g.pts.map((p) => html`<g key=${p.key}>
            <circle cx=${p.x} cy=${p.y} r=${foco === p.key ? 6 : 4} fill="white" stroke="#059669" stroke-width="2.5" />
            <circle cx=${p.x} cy=${p.y} r="13" fill="transparent" tabIndex="0" role="img" aria-label=${`${p.label}: ${brl(p.closingBalance)}`}
              onMouseEnter=${() => setFoco(p.key)} onMouseLeave=${() => setFoco(null)} onFocus=${() => setFoco(p.key)} onBlur=${() => setFoco(null)}>
              <title>${p.label}: ${brl(p.closingBalance)}</title></circle>
            <text x=${p.x} y="250" text-anchor="middle" fill="#52655a" font-size="12" font-weight="600" aria-hidden="true">${p.label}</text>
          </g>`)}
        </svg>
      </div>`}
  </section>`;
}
/**
 * Barras agrupadas verticais (Craft: "Receita × Despesas"). data: [{ label, ...valores }].
 * series: [{ chave, rotulo, cor:"bg-emerald-500", corRotulo:"bg-emerald-50 text-emerald-700" }].
 * Altura de cada barra = |valor| ÷ maior × 82% (mínimo 3% quando ≠ 0); rótulo compacto (compactoK) acima.
 */
export function GraficoBarras({ data = [], series, carregando, vazio = "Ainda não há dados conciliados neste período.", altura = "h-72" }) {
  if (carregando) return html`<div class=${cn(altura, "animate-pulse rounded-2xl bg-slate-100")}></div>`;
  if (!data.length || data.every((d) => series.every((s) => !Number(d[s.chave]))))
    return html`<div class=${cn(altura, "flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 text-center")}>
      <${Icone} nome="minus" class="mb-3 h-5 w-5 text-slate-300" /><p class="text-xs font-bold text-slate-400">${vazio}</p></div>`;
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Math.abs(Number(d[s.chave] || 0)))));
  return html`<div class=${cn(altura, "flex min-w-0 items-end gap-1 border-b border-slate-200 px-1 pb-0 pt-4 sm:gap-2")}>
    ${data.map((d) => html`<div key=${d.label} class="flex h-full min-w-0 flex-1 flex-col justify-end">
      <span class="sr-only">${d.label}: ${series.map((s) => `${s.rotulo} ${brl(d[s.chave])}`).join("; ")}.</span>
      <div class="flex min-w-0 flex-1 items-end justify-center gap-1">
        ${series.map((s) => {
          const v = Number(d[s.chave] || 0), h = Math.max(v ? 3 : 0, (Math.abs(v) / max) * 82);
          return html`<div class="relative flex h-full w-full max-w-5 items-end justify-center">
            ${v ? html`<span aria-hidden="true" title=${`${s.rotulo}: ${brl(v)}`} style=${`bottom:calc(${h}% + 4px)`}
              class=${cn("absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded px-0.5 py-0.5 text-[9.5px] font-black leading-none shadow-sm min-[1400px]:text-[10.5px]", s.corRotulo)}>${compactoK(v)}</span>` : null}
            <div title=${`${s.rotulo}: ${brl(v)}`} class=${cn("w-full rounded-t-md transition-all", s.cor)} style=${`height:${h}%`}></div>
          </div>`;
        })}
      </div>
      <p class="py-2 text-center text-[12px] font-black uppercase text-slate-400 sm:text-[13.5px]">${d.label}</p>
    </div>`)}
  </div>`;
}

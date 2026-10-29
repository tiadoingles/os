// Edge Function "hotmart": Financeiro do OS conversando com a API oficial da Hotmart, sob demanda.
// Ops (body { op, ... }):
//   consulta  { acao, parametros }                 -> 15 consultas só leitura (mesmos slugs de financeiro/hotmart.js)
//   acao      { acao, parametros, confirmado:true } -> 6 ações que alteram dados na Hotmart (nunca reembolso nem lote)
//   pergunta  { pergunta }                          -> Claude (tool use) com as consultas como ferramentas
//   sync_cobrancas                                  -> recarrega fin_cobrancas (fin_hotmart_carregar/finalizar)
// Toda consulta/ação/pergunta/sync fica registrada em fin_hotmart_pedidos (histórico).
// verify_jwt=false: autorização feita aqui (usuário ADM ou com a aba Financeiro).
// Segredos: HOTMART_CLIENT_ID, HOTMART_CLIENT_SECRET, HOTMART_BASIC (credenciais da Hotmart);
//           ANTHROPIC_API_KEY (+ AI_MODEL, ANTHROPIC_WORKSPACE_ID opcionais), compartilhados com a função "ai".
// Documentação usada: https://developers.hotmart.com/docs/pt-BR/ (ver comentários de cada endpoint).
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED = new Set(["https://tiadoingles.github.io"]);
function cors(origin: string | null) {
  const allow = origin && (ALLOWED.has(origin) || /^http:\/\/localhost:\d+$/.test(origin)) ? origin : "https://tiadoingles.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (b: unknown, s: number, origin: string | null) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors(origin), "Content-Type": "application/json" } });

/* ============================ Formatação ============================ */
const FUSO = "America/Sao_Paulo";
const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function dinheiro(v: unknown, moeda?: string | null): string {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || !Number.isFinite(n)) return "";
  if (!moeda || moeda === "BRL") return fmtBRL.format(n);
  try { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(n); } catch { return `${moeda} ${n.toFixed(2)}`; }
}
/** Timestamp da Hotmart (ms; alguns endpoints mandam segundos) -> DD/MM/AAAA no fuso de Brasília. */
function dataBR(ts: unknown): string {
  const n = Number(ts);
  if (!ts || !Number.isFinite(n) || n <= 0) return "";
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms).toLocaleDateString("pt-BR", { timeZone: FUSO });
}
/** "AAAA-MM-DD" -> ms do início (ou fim) do dia em Brasília (UTC-03:00). */
function msDia(iso: string, fim = false): number {
  return Date.parse(`${iso}T${fim ? "23:59:59.999" : "00:00:00.000"}-03:00`);
}
const pct = (v: unknown) => (Number.isFinite(Number(v)) ? `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "");
const simNao = (b: unknown) => (b === true ? "Sim" : b === false ? "Não" : "");
const STATUS_VENDA: Record<string, string> = {
  APPROVED: "Aprovada", COMPLETE: "Completa", WAITING_PAYMENT: "Aguardando pagamento", PRINTED_BILLET: "Boleto impresso",
  OVERDUE: "Vencida", CANCELLED: "Cancelada", REFUNDED: "Reembolsada", PARTIALLY_REFUNDED: "Reembolso parcial",
  CHARGEBACK: "Chargeback", BLOCKED: "Bloqueada", EXPIRED: "Expirada", NO_FUNDS: "Sem saldo", PRE_ORDER: "Pré-venda",
  PROCESSING_TRANSACTION: "Processando", PROTESTED: "Protestada", STARTED: "Iniciada", UNDER_ANALISYS: "Em análise",
};
const STATUS_ASSIN: Record<string, string> = {
  ACTIVE: "Ativa", INACTIVE: "Inativa", DELAYED: "Atrasada", CANCELLED_BY_CUSTOMER: "Cancelada pelo cliente",
  CANCELLED_BY_SELLER: "Cancelada pelo vendedor", CANCELLED_BY_ADMIN: "Cancelada pela Hotmart", STARTED: "Iniciada", OVERDUE: "Encerrada (vencida)",
};
const STATUS_RECORR: Record<string, string> = { PAID: "Paga", NOT_PAID: "Não paga", CLAIMED: "Reclamada", REFUNDED: "Reembolsada", CHARGEBACK: "Chargeback" };
const COBRANCA: Record<string, string> = { SUBSCRIPTION: "Assinatura", SMART_INSTALLMENT: "Parcelamento inteligente", SMART_RECOVERY: "Recuperador inteligente" };
const tr = (m: Record<string, string>, v: unknown) => (v == null ? "" : m[String(v)] || String(v));

type Tabela = { colunas: string[]; linhas: unknown[][] };
type Resultado = { resposta: string; dados: Tabela | null };

/* ============================ Hotmart: token e chamadas ============================ */
const BASE = "https://developers.hotmart.com";
const LIMITE_LINHAS = 300;
class SemCredenciais extends Error {}
class ErroHotmart extends Error {}
class ErroParametro extends Error {}

let tokenCache: { token: string; exp: number } | null = null;
function credenciais() {
  const id = Deno.env.get("HOTMART_CLIENT_ID") ?? "", secret = Deno.env.get("HOTMART_CLIENT_SECRET") ?? "", basic = Deno.env.get("HOTMART_BASIC") ?? "";
  if (!id || !secret || !basic) throw new SemCredenciais();
  return { id, secret, basic: basic.replace(/^Basic\s+/i, "") };
}
// Autenticação: https://developers.hotmart.com/docs/pt-BR/start/app-auth/
async function tokenHotmart(forcar = false): Promise<string> {
  if (!forcar && tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const c = credenciais();
  const url = `https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials&client_id=${encodeURIComponent(c.id)}&client_secret=${encodeURIComponent(c.secret)}`;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Basic ${c.basic}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d?.access_token) throw new ErroHotmart(`Não foi possível autenticar na Hotmart (${mensagemHotmart(r.status, d)}). Confira HOTMART_CLIENT_ID, HOTMART_CLIENT_SECRET e HOTMART_BASIC.`);
  tokenCache = { token: d.access_token, exp: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}
const ERROS_PT: Record<string, string> = {
  invalid_parameter: "parâmetro inválido",
  invalid_token: "token expirado ou inválido",
  token_expired: "token expirado",
  unauthorized_client: "sem permissão para esta ação (confira as permissões da credencial na Hotmart)",
  internal_server_error: "erro interno da Hotmart; tente de novo em instantes",
  internal_error: "a Hotmart não conseguiu concluir; confira os dados e tente de novo",
  product_not_found: "produto não encontrado",
  subscription_not_found: "assinatura não encontrada (confira o código do assinante)",
  it_can_not_cancel_subscription_status: "esta assinatura não pode ser cancelada no status atual",
  it_can_not_reactivate_subscription: "esta assinatura não pode ser reativada",
  subscription_in_trial_period: "o dia de cobrança não pode ser alterado durante o período de teste",
  subscription_not_in_progress: "o dia de cobrança só pode ser alterado com a assinatura ativa ou atrasada",
  unsupported_due_day: "dia de cobrança inválido (use de 1 a 31)",
  invalid_discount_value: "valor de desconto inválido (não pode ser maior que o valor negociado nem negativo)",
  invalid_client: "credenciais da Hotmart recusadas",
  unauthorized: "credenciais da Hotmart recusadas",
};
function mensagemHotmart(status: number, d: any): string {
  const cod = String(d?.error || d?.code || "").trim();
  const pt = ERROS_PT[cod] || ERROS_PT[cod.toLowerCase()];
  const desc = d?.error_description || d?.message || "";
  if (status === 429) return "limite de chamadas da Hotmart atingido (500 por minuto); aguarde um minuto";
  if (status === 404 && !pt) return "não encontrado na Hotmart";
  return pt ? `${pt}${desc && !pt.includes(desc) ? ` — ${desc}` : ""}` : desc ? `HTTP ${status}: ${desc}` : `HTTP ${status}`;
}
type Q = Record<string, string | number | boolean | (string | number)[] | null | undefined>;
async function hm(metodo: string, caminho: string, { query, body }: { query?: Q; body?: unknown } = {}, tentativa = 0): Promise<any> {
  const u = new URL(BASE + caminho);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, String(x)));
    else u.searchParams.set(k, String(v));
  }
  const token = await tokenHotmart(tentativa > 0);
  const r = await fetch(u.toString(), {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await r.text();
  let d: any = null;
  try { d = txt ? JSON.parse(txt) : null; } catch { d = { message: txt.slice(0, 200) }; }
  if (r.status === 401 && tentativa === 0) return hm(metodo, caminho, { query, body }, 1);
  if (!r.ok) throw new ErroHotmart(`Hotmart: ${mensagemHotmart(r.status, d)}.`);
  return d;
}
/** Lista paginada (page_info.next_page_token). Endpoints que devolvem array puro vêm numa página só. */
async function paginar(caminho: string, query: Q, limite = LIMITE_LINHAS): Promise<{ itens: any[]; total: number | null; truncado: boolean }> {
  const itens: any[] = [];
  let token: string | undefined, total: number | null = null;
  for (let pag = 0; pag < 100; pag++) {
    const d = await hm("GET", caminho, { query: { ...query, max_results: Math.min(500, limite), page_token: token } });
    if (Array.isArray(d)) { itens.push(...d); break; }
    itens.push(...(d?.items || []));
    if (d?.page_info?.total_results != null) total = Number(d.page_info.total_results);
    token = d?.page_info?.next_page_token;
    if (!token || itens.length >= limite) break;
  }
  return { itens: itens.slice(0, limite), total, truncado: itens.length > limite || (!!token && itens.length >= limite) };
}

/* ============================ Validação de parâmetros ============================ */
const txt = (p: any, k: string) => String(p?.[k] ?? "").trim();
function obrig(p: any, k: string, rotulo: string): string {
  const v = txt(p, k);
  if (!v) throw new ErroParametro(`Preencha: ${rotulo}.`);
  return v;
}
function dataIso(p: any, k: string, rotulo: string, req = true): string | null {
  const v = txt(p, k);
  if (!v) { if (req) throw new ErroParametro(`Preencha: ${rotulo}.`); return null; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ErroParametro(`${rotulo}: use o formato AAAA-MM-DD.`);
  return v;
}
function periodo(p: any) {
  const ini = dataIso(p, "data_inicio", "Data inicial")!, fim = dataIso(p, "data_fim", "Data final")!;
  if (ini > fim) throw new ErroParametro("A data inicial precisa ser anterior ou igual à data final.");
  return { start_date: msDia(ini), end_date: msDia(fim, true), rotulo: `${ini.split("-").reverse().join("/")} a ${fim.split("-").reverse().join("/")}` };
}
function inteiro(p: any, k: string, rotulo: string, { req = true, min, max }: { req?: boolean; min?: number; max?: number } = {}): number | null {
  const v = p?.[k];
  if (v === null || v === undefined || v === "") { if (req) throw new ErroParametro(`Preencha: ${rotulo}.`); return null; }
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ErroParametro(`${rotulo}: informe um número inteiro.`);
  if ((min != null && n < min) || (max != null && n > max)) throw new ErroParametro(`${rotulo}: use um valor entre ${min ?? "-"} e ${max ?? "-"}.`);
  return n;
}
function email(p: any, k: string, rotulo: string, req = true): string | null {
  const v = txt(p, k).toLowerCase();
  if (!v) { if (req) throw new ErroParametro(`Preencha: ${rotulo}.`); return null; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new ErroParametro(`${rotulo}: e-mail inválido.`);
  return v;
}
/** Subdomínio da área de membros (club): parametros.subdomain ou, nas telas antigas, o campo "produto". */
function subdominio(p: any): string {
  const v = (txt(p, "subdomain") || txt(p, "produto")).toLowerCase().replace(/^https?:\/\//, "").replace(/\.club\.hotmart\.com.*$/, "").replace(/\/.*$/, "");
  if (!v) throw new ErroParametro("Informe o subdomínio da área de membros (ex.: o que vem antes de .club.hotmart.com).");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(v)) throw new ErroParametro("Subdomínio da área de membros inválido: use só letras, números e hífen (ex.: tiadoingles).");
  return v;
}
/** Produto por ID (número) ou por nome (busca na lista de produtos). */
async function resolverProduto(valor: string): Promise<{ id: number; nome: string; ucode?: string }> {
  const lista = (await paginar("/products/api/v1/products", {}, 500)).itens;
  if (/^\d+$/.test(valor)) {
    const p = lista.find((x) => String(x.id) === valor);
    return { id: Number(valor), nome: p?.name || valor, ucode: p?.ucode };
  }
  const alvo = semAcento(valor);
  const achados = lista.filter((x) => semAcento(x.name || "").includes(alvo));
  if (!achados.length) throw new ErroParametro(`Nenhum produto com "${valor}" no nome. Use o ID do produto (veja em Produtos, ofertas e planos).`);
  if (achados.length > 1) {
    const exato = achados.find((x) => semAcento(x.name || "") === alvo);
    if (!exato) throw new ErroParametro(`Mais de um produto com "${valor}" no nome: ${achados.slice(0, 6).map((x) => `${x.name} (ID ${x.id})`).join(", ")}. Use o ID.`);
    return { id: exato.id, nome: exato.name, ucode: exato.ucode };
  }
  return { id: achados[0].id, nome: achados[0].name, ucode: achados[0].ucode };
}
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const avisoCorte = (n: number, truncado: boolean, total?: number | null) =>
  truncado ? `\n\nMostrando as primeiras ${n} linhas${total ? ` de ${total}` : ""}. Refine os filtros para ver o restante.` : "";
function somaPorMoeda(linhas: { valor: number; moeda: string }[]) {
  const m = new Map<string, number>();
  for (const l of linhas) if (Number.isFinite(l.valor)) m.set(l.moeda || "BRL", (m.get(l.moeda || "BRL") || 0) + l.valor);
  return [...m.entries()].map(([moeda, v]) => dinheiro(v, moeda)).join(" + ") || dinheiro(0);
}

/* ============================ Consultas (só leitura) ============================ */
// Histórico de vendas: https://developers.hotmart.com/docs/pt-BR/v1/sales/sales-history/
function linhaVenda(v: any) {
  const pu = v.purchase || {};
  return [dataBR(pu.order_date), pu.transaction || "", tr(STATUS_VENDA, pu.status), v.buyer?.name || "", v.buyer?.email || "", v.product?.name || "",
    dinheiro(pu.price?.value, pu.price?.currency_code), [pu.payment?.type, pu.payment?.method].filter(Boolean).join(" · "), pu.payment?.installments_number ?? ""];
}
const COLS_VENDA = ["Data do pedido", "Transação", "Status", "Cliente", "E-mail", "Produto", "Valor", "Pagamento", "Parcelas"];

const CONSULTAS: Record<string, { rotulo: string; descricao: string; schema: Record<string, unknown>; obrig: string[]; exec: (p: any) => Promise<Resultado> }> = {
  vendas_periodo: {
    rotulo: "Vendas do período",
    descricao: "Lista as vendas de um período (data do pedido), opcionalmente filtradas por status e produto (ID ou parte do nome).",
    schema: { data_inicio: { type: "string", description: "AAAA-MM-DD" }, data_fim: { type: "string", description: "AAAA-MM-DD" },
      status: { type: "string", enum: ["", "APPROVED", "COMPLETE", "WAITING_PAYMENT", "OVERDUE", "CANCELLED", "REFUNDED", "CHARGEBACK"], description: "vazio = aprovadas e completas (padrão da Hotmart)" },
      produto: { type: "string", description: "ID ou parte do nome do produto (opcional)" } },
    obrig: ["data_inicio", "data_fim"],
    async exec(p) {
      const per = periodo(p);
      const status = txt(p, "status");
      let product_id: number | undefined, nomeProd = "";
      const prod = txt(p, "produto");
      if (prod) { const r = await resolverProduto(prod); product_id = r.id; nomeProd = r.nome; }
      const { itens, total, truncado } = await paginar("/payments/api/v1/sales/history", { start_date: per.start_date, end_date: per.end_date, transaction_status: status || undefined, product_id });
      const soma = somaPorMoeda(itens.map((v) => ({ valor: Number(v.purchase?.price?.value), moeda: v.purchase?.price?.currency_code })));
      const resposta = `**${total ?? itens.length} venda(s)** ${status ? `com status ${tr(STATUS_VENDA, status)} ` : "aprovadas/completas "}de ${per.rotulo}${nomeProd ? ` · ${nomeProd}` : ""}, somando **${soma}** (valor pago pelo comprador).${avisoCorte(itens.length, truncado, total)}`;
      return { resposta, dados: { colunas: COLS_VENDA, linhas: itens.map(linhaVenda) } };
    },
  },
  resumo_vendas: {
    rotulo: "Resumo de vendas",
    descricao: "Total de vendas e valor somado de um período (aprovadas e completas), por moeda.",
    schema: { data_inicio: { type: "string", description: "AAAA-MM-DD" }, data_fim: { type: "string", description: "AAAA-MM-DD" } },
    obrig: ["data_inicio", "data_fim"],
    // https://developers.hotmart.com/docs/pt-BR/v1/sales/sales-summary/
    async exec(p) {
      const per = periodo(p);
      const { itens } = await paginar("/payments/api/v1/sales/summary", { start_date: per.start_date, end_date: per.end_date }, 50);
      const linhas = itens.map((i) => [i.total_value?.currency_code || "", i.total_items ?? 0, dinheiro(i.total_value?.value, i.total_value?.currency_code)]);
      const resp = itens.length ? itens.map((i) => `**${dinheiro(i.total_value?.value, i.total_value?.currency_code)}** em ${i.total_items ?? 0} venda(s)`).join("; ") : "Nenhuma venda aprovada";
      return { resposta: `${resp} de ${per.rotulo}.`, dados: { colunas: ["Moeda", "Vendas", "Total"], linhas } };
    },
  },
  detalhe_venda: {
    rotulo: "Detalhes de uma venda (taxas e participantes)",
    descricao: "Detalhe de uma transação: status, valores, taxas, cupom, participantes e comissões.",
    schema: { transacao: { type: "string", description: "código da transação, ex.: HP1234567890" } },
    obrig: ["transacao"],
    // sales/history, sales/price/details, sales/users e sales/commissions filtrados por transaction.
    async exec(p) {
      const t = obrig(p, "transacao", "Código da transação").toUpperCase();
      const [h, pr, us, co] = await Promise.all([
        hm("GET", "/payments/api/v1/sales/history", { query: { transaction: t } }),
        hm("GET", "/payments/api/v1/sales/price/details", { query: { transaction: t } }),
        hm("GET", "/payments/api/v1/sales/users", { query: { transaction: t } }),
        hm("GET", "/payments/api/v1/sales/commissions", { query: { transaction: t } }),
      ]);
      const v = h?.items?.[0];
      if (!v) return { resposta: `Nenhuma venda encontrada com a transação ${t}.`, dados: null };
      const pu = v.purchase || {}, d = pr?.items?.[0] || {};
      const L: unknown[][] = [
        ["Transação", t], ["Produto", `${v.product?.name || ""} (ID ${v.product?.id ?? ""})`], ["Status", tr(STATUS_VENDA, pu.status)],
        ["Data do pedido", dataBR(pu.order_date)], ["Data de aprovação", dataBR(pu.approved_date)],
        ["Cliente", `${v.buyer?.name || ""} · ${v.buyer?.email || ""}`],
        ["Valor pago", dinheiro(pu.price?.value, pu.price?.currency_code)],
        ["Pagamento", [pu.payment?.type, pu.payment?.method, pu.payment?.installments_number ? `${pu.payment.installments_number}x` : ""].filter(Boolean).join(" · ")],
        ["Oferta", [pu.offer?.code, pu.offer?.payment_mode].filter(Boolean).join(" · ")],
        ["Recorrência", pu.recurrency_number ?? ""], ["Garantia até", dataBR(pu.warranty_expire_date)],
        ["Valor base", dinheiro(d.base?.value, d.base?.currency_code)], ["Total", dinheiro(d.total?.value, d.total?.currency_code)],
        ["Impostos (VAT)", dinheiro(d.vat?.value, d.vat?.currency_code)], ["Taxa Hotmart", dinheiro(d.fee?.value ?? pu.hotmart_fee?.total, d.fee?.currency_code ?? pu.hotmart_fee?.currency_code)],
        ["Cupom", d.coupon?.code ? `${d.coupon.code} (${dinheiro(d.coupon.value)})` : ""],
      ];
      for (const u of us?.items?.[0]?.users || []) L.push([`Participante · ${u.role}`, `${u.user?.name || ""}${u.user?.email ? " · " + u.user.email : ""}`]);
      for (const c of co?.items?.[0]?.commissions || []) L.push([`Comissão · ${c.source}`, `${c.user?.name || ""}: ${dinheiro(c.commission?.value, c.commission?.currency_value)}`]);
      const resposta = `Venda **${t}** de ${v.buyer?.name || "cliente"}: **${tr(STATUS_VENDA, pu.status)}**, ${dinheiro(pu.price?.value, pu.price?.currency_code)} em ${dataBR(pu.order_date)}.`;
      return { resposta, dados: { colunas: ["Campo", "Valor"], linhas: L.filter((l) => l[1] !== "" && l[1] != null) } };
    },
  },
  comissoes: {
    rotulo: "Comissões (coprodução e afiliados)",
    descricao: "Comissões de cada participante (produtor, coprodutor, afiliado) das vendas de um período.",
    schema: { data_inicio: { type: "string", description: "AAAA-MM-DD" }, data_fim: { type: "string", description: "AAAA-MM-DD" } },
    obrig: ["data_inicio", "data_fim"],
    // https://developers.hotmart.com/docs/pt-BR/v1/sales/sales-commissions/
    async exec(p) {
      const per = periodo(p);
      const { itens, truncado, total } = await paginar("/payments/api/v1/sales/commissions", { start_date: per.start_date, end_date: per.end_date });
      const linhas: unknown[][] = [];
      const porPapel = new Map<string, { valor: number; moeda: string }[]>();
      for (const i of itens) for (const c of i.commissions || []) {
        linhas.push([i.transaction || "", i.product?.name || "", c.user?.name || "", c.source || "", dinheiro(c.commission?.value, c.commission?.currency_value)]);
        const arr = porPapel.get(c.source) || []; arr.push({ valor: Number(c.commission?.value), moeda: c.commission?.currency_value }); porPapel.set(c.source, arr);
      }
      const resumo = [...porPapel.entries()].map(([k, v]) => `${k}: **${somaPorMoeda(v)}**`).join(" · ");
      return { resposta: `Comissões de ${itens.length} venda(s) de ${per.rotulo}. ${resumo || "Nenhuma comissão no período."}${avisoCorte(itens.length, truncado, total)}`,
        dados: { colunas: ["Transação", "Produto", "Participante", "Papel", "Comissão"], linhas } };
    },
  },
  compras_cliente: {
    rotulo: "Compras de um cliente",
    descricao: "Todas as compras de um e-mail (aprovadas, pendentes, vencidas, canceladas, reembolsadas).",
    schema: { email: { type: "string" } },
    obrig: ["email"],
    async exec(p) {
      const e = email(p, "email", "E-mail do cliente")!;
      const desde = Date.parse("2015-01-01T00:00:00-03:00");
      const status = [undefined, "WAITING_PAYMENT", "PRINTED_BILLET", "OVERDUE", "CANCELLED", "REFUNDED", "CHARGEBACK", "EXPIRED"];
      const lotes = await Promise.all(status.map((s) => paginar("/payments/api/v1/sales/history", { buyer_email: e, start_date: desde, end_date: Date.now(), transaction_status: s }, 100)));
      const vistos = new Set<string>(); const itens: any[] = [];
      for (const l of lotes) for (const v of l.itens) { const k = v.purchase?.transaction; if (k && !vistos.has(k)) { vistos.add(k); itens.push(v); } }
      itens.sort((a, b) => (b.purchase?.order_date || 0) - (a.purchase?.order_date || 0));
      const aprov = itens.filter((v) => ["APPROVED", "COMPLETE"].includes(v.purchase?.status));
      return { resposta: itens.length ? `**${itens.length} compra(s)** de ${e}; ${aprov.length} aprovada(s)/completa(s) somando **${somaPorMoeda(aprov.map((v) => ({ valor: Number(v.purchase?.price?.value), moeda: v.purchase?.price?.currency_code })))}**.` : `Nenhuma compra encontrada para ${e}.`,
        dados: { colunas: COLS_VENDA, linhas: itens.slice(0, LIMITE_LINHAS).map(linhaVenda) } };
    },
  },
  assinaturas: {
    rotulo: "Assinaturas e parcelamentos",
    descricao: "Lista assinaturas (inclui parcelamento inteligente) com status, próxima cobrança e código do assinante.",
    schema: { status: { type: "string", enum: ["", "ACTIVE", "DELAYED", "CANCELLED_BY_CUSTOMER"] }, email: { type: "string", description: "opcional" } },
    obrig: [],
    // https://developers.hotmart.com/docs/pt-BR/v1/subscription/get-subscribers/
    async exec(p) {
      const st = txt(p, "status"), e = email(p, "email", "E-mail", false);
      const { itens, total, truncado } = await paginar("/payments/api/v1/subscriptions", { status: st || undefined, subscriber_email: e || undefined });
      const linhas = itens.map((s) => [s.subscriber?.name || "", s.subscriber?.email || "", s.subscriber_code || "", s.subscription_id ?? "", s.product?.name || "",
        s.plan?.name || "", tr(STATUS_ASSIN, s.status), dataBR(s.accession_date), dataBR(s.date_next_charge), dinheiro(s.price?.value, s.price?.currency_code),
        s.plan?.max_charge_cycles ?? ""]);
      const cont = new Map<string, number>(); itens.forEach((s) => cont.set(tr(STATUS_ASSIN, s.status), (cont.get(tr(STATUS_ASSIN, s.status)) || 0) + 1));
      return { resposta: `**${total ?? itens.length} assinatura(s)**${st ? ` ${tr(STATUS_ASSIN, st).toLowerCase()}` : ""}${e ? ` de ${e}` : ""}. ${[...cont.entries()].map(([k, v]) => `${k}: ${v}`).join(" · ")}${avisoCorte(itens.length, truncado, total)}`,
        dados: { colunas: ["Assinante", "E-mail", "Código do assinante", "ID da assinatura", "Produto", "Plano", "Status", "Adesão", "Próxima cobrança", "Valor", "Ciclos"], linhas } };
    },
  },
  resumo_assinaturas: {
    rotulo: "Resumo de assinaturas",
    descricao: "Quantidade de assinaturas em cada status.",
    schema: {}, obrig: [],
    async exec() {
      const sts = ["ACTIVE", "DELAYED", "STARTED", "INACTIVE", "OVERDUE", "CANCELLED_BY_CUSTOMER", "CANCELLED_BY_SELLER", "CANCELLED_BY_ADMIN"];
      const r = await Promise.all(sts.map(async (s) => {
        const d = await hm("GET", "/payments/api/v1/subscriptions", { query: { status: s, max_results: 1 } });
        return [tr(STATUS_ASSIN, s), Number(d?.page_info?.total_results ?? (d?.items || []).length)];
      }));
      const ativ = r[0][1], atr = r[1][1];
      return { resposta: `**${ativ} ativa(s)** e **${atr} atrasada(s)**. Taxa de atraso sobre ativas + atrasadas: **${pct((Number(atr) / Math.max(1, Number(ativ) + Number(atr))) * 100)}**.`,
        dados: { colunas: ["Status", "Assinaturas"], linhas: r } };
    },
  },
  parcelas_cliente: {
    rotulo: "Parcelas de um cliente",
    descricao: "Recorrências (parcelas/mensalidades) de um e-mail: número, status do pagamento, data e valor.",
    schema: { email: { type: "string" } }, obrig: ["email"],
    // Transações de assinatura: https://developers.hotmart.com/docs/pt-BR/v1/subscription/get-subscription-transactions/
    async exec(p) {
      const e = email(p, "email", "E-mail do cliente")!;
      const { itens, truncado } = await paginar("/payments/api/v1/subscriptions/transactions", { subscriber_email: e, transaction_date: Date.parse("2015-01-01T00:00:00-03:00"), end_transaction_date: Date.now() });
      itens.sort((a, b) => (a.subscriber_code || "").localeCompare(b.subscriber_code || "") || (a.recurrency?.number || 0) - (b.recurrency?.number || 0));
      const linhas = itens.map((t) => [t.product?.name || "", tr(COBRANCA, t.billing_type), t.subscriber_code || "", t.subscription_id ?? "",
        `${t.recurrency?.number ?? ""}${t.max_cycles ? "/" + t.max_cycles : ""}`, tr(STATUS_RECORR, t.recurrency?.status), dataBR(t.recurrency?.start_datetime),
        dinheiro(t.purchase?.price?.value, t.purchase?.price?.currency), t.purchase?.transaction || "", t.purchase?.payment?.payment_type || "", tr(STATUS_ASSIN, t.status)]);
      const naoPagas = itens.filter((t) => t.recurrency?.status === "NOT_PAID");
      return { resposta: itens.length ? `**${itens.length} recorrência(s)** de ${e}; **${naoPagas.length} não paga(s)**${naoPagas.length ? `: ${naoPagas.map((t) => `nº ${t.recurrency?.number} (${dataBR(t.recurrency?.start_datetime)})`).join(", ")}` : ""}. Dados da Hotmart com até 24 h de defasagem.${avisoCorte(itens.length, truncado)}` : `Nenhuma parcela/recorrência encontrada para ${e}.`,
        dados: { colunas: ["Produto", "Tipo", "Código do assinante", "ID da assinatura", "Parcela", "Pagamento", "Data", "Valor", "Transação", "Forma", "Situação"], linhas } };
    },
  },
  saude_assinaturas: {
    rotulo: "Saúde das assinaturas (atrasos e cancelamentos)",
    descricao: "Assinaturas atrasadas (com próxima cobrança e código do assinante) e cancelamentos.",
    schema: {}, obrig: [],
    async exec() {
      const [atr, ativ, cc, cs] = await Promise.all([
        paginar("/payments/api/v1/subscriptions", { status: "DELAYED" }),
        hm("GET", "/payments/api/v1/subscriptions", { query: { status: "ACTIVE", max_results: 1 } }),
        hm("GET", "/payments/api/v1/subscriptions", { query: { status: "CANCELLED_BY_CUSTOMER", max_results: 1 } }),
        hm("GET", "/payments/api/v1/subscriptions", { query: { status: "CANCELLED_BY_SELLER", max_results: 1 } }),
      ]);
      const nAtr = atr.total ?? atr.itens.length, nAtiv = Number(ativ?.page_info?.total_results ?? 0);
      const linhas = atr.itens.map((s) => [s.subscriber?.name || "", s.subscriber?.email || "", s.subscriber_code || "", s.subscription_id ?? "", s.product?.name || "",
        dataBR(s.date_next_charge), dinheiro(s.price?.value, s.price?.currency_code)]);
      return { resposta: `**${nAtr} atrasada(s)** para ${nAtiv} ativa(s) (${pct((nAtr / Math.max(1, nAtr + nAtiv)) * 100)} de atraso). Canceladas: ${cc?.page_info?.total_results ?? 0} pelo cliente, ${cs?.page_info?.total_results ?? 0} pelo vendedor. A tabela lista as atrasadas.${avisoCorte(atr.itens.length, atr.truncado, atr.total)}`,
        dados: { colunas: ["Assinante", "E-mail", "Código do assinante", "ID da assinatura", "Produto", "Próxima tentativa", "Valor"], linhas } };
    },
  },
  alunos: {
    rotulo: "Alunos de um produto",
    descricao: "Alunos da área de membros (Hotmart Club) com progresso e último acesso. Precisa do subdomínio da área de membros.",
    schema: { subdomain: { type: "string", description: "subdomínio da área de membros" } }, obrig: ["subdomain"],
    // https://developers.hotmart.com/docs/pt-BR/v1/club/get-users-club/
    async exec(p) {
      const sub = subdominio(p);
      const { itens, total, truncado } = await paginar("/club/api/v1/users", { subdomain: sub });
      const linhas = itens.map((u) => [u.name || "", u.email || "", u.status || "", u.role || "", pct(u.progress?.completed_percentage),
        `${u.progress?.completed ?? ""}/${u.progress?.total ?? ""}`, dataBR(u.first_access_date), dataBR(u.last_access_date), u.access_count ?? "", u.engagement || ""]);
      const media = itens.length ? itens.reduce((a, u) => a + (Number(u.progress?.completed_percentage) || 0), 0) / itens.length : 0;
      return { resposta: `**${total ?? itens.length} aluno(s)** em ${sub}; progresso médio de **${pct(media)}**${truncado ? " (nas linhas mostradas)" : ""}.${avisoCorte(itens.length, truncado, total)}`,
        dados: { colunas: ["Nome", "E-mail", "Status", "Papel", "Progresso", "Páginas concluídas", "Primeiro acesso", "Último acesso", "Acessos", "Engajamento"], linhas } };
    },
  },
  progresso_aluno: {
    rotulo: "Progresso de um aluno",
    descricao: "Páginas concluídas por um aluno na área de membros. Precisa do e-mail e do subdomínio.",
    schema: { email: { type: "string" }, subdomain: { type: "string" } }, obrig: ["email", "subdomain"],
    // https://developers.hotmart.com/docs/pt-BR/v1/club/get-lessons-club/
    async exec(p) {
      const e = email(p, "email", "E-mail do aluno")!, sub = subdominio(p);
      const us = await hm("GET", "/club/api/v1/users", { query: { subdomain: sub, email: e } });
      const u = (us?.items || [])[0];
      if (!u) return { resposta: `Nenhum aluno com o e-mail ${e} na área de membros ${sub}.`, dados: null };
      const d = await hm("GET", `/club/api/v1/users/${encodeURIComponent(u.user_id)}/lessons`, { query: { subdomain: sub } });
      const ls: any[] = d?.lessons || (Array.isArray(d) ? d : []);
      const feitas = ls.filter((l) => l.is_completed);
      return { resposta: `**${u.name || e}**: ${feitas.length} de ${ls.length} página(s) concluída(s) (${pct(u.progress?.completed_percentage)}), último acesso em ${dataBR(u.last_access_date) || "sem registro"}.`,
        dados: { colunas: ["Módulo", "Página", "Extra", "Concluída", "Concluída em"], linhas: ls.map((l) => [l.module_name || "", l.page_name || "", simNao(l.is_module_extra), simNao(l.is_completed), dataBR(l.completed_date)]) } };
    },
  },
  modulos: {
    rotulo: "Módulos e páginas da área de membros",
    descricao: "Módulos e páginas da área de membros. Precisa do subdomínio.",
    schema: { subdomain: { type: "string" } }, obrig: ["subdomain"],
    // https://developers.hotmart.com/docs/pt-BR/v1/club/get-modules-club/ e .../get-pages-club/
    async exec(p) {
      const sub = subdominio(p);
      const mods: any[] = await hm("GET", "/club/api/v1/modules", { query: { subdomain: sub } }).then((d) => (Array.isArray(d) ? d : d?.items || []));
      mods.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
      const linhas: unknown[][] = [];
      for (const m of mods.slice(0, 40)) {
        const pgs: any[] = await hm("GET", `/club/api/v1/modules/${encodeURIComponent(m.module_id)}/pages`, { query: { subdomain: sub } }).then((d) => (Array.isArray(d) ? d : d?.items || [])).catch(() => []);
        if (!pgs.length) linhas.push([m.sequence ?? "", m.name || "", simNao(m.is_extra), "", "", "", ""]);
        for (const pg of pgs) linhas.push([m.sequence ?? "", m.name || "", simNao(m.is_extra), pg.page_order ?? "", pg.name || "", pg.type || "", pg.total_comments ?? ""]);
        if (linhas.length >= LIMITE_LINHAS) break;
      }
      return { resposta: `**${mods.length} módulo(s)** em ${sub}, com ${mods.reduce((a, m) => a + (Number(m.total_pages) || 0), 0)} página(s) no total.${mods.length > 40 ? " Páginas listadas só dos 40 primeiros módulos." : ""}`,
        dados: { colunas: ["Seq.", "Módulo", "Extra", "Ordem", "Página", "Tipo", "Comentários"], linhas: linhas.slice(0, LIMITE_LINHAS) } };
    },
  },
  produtos: {
    rotulo: "Produtos, ofertas e planos",
    descricao: "Produtos com ID, status, formato e as ofertas/planos de cada um (código e preço).",
    schema: {}, obrig: [],
    // https://developers.hotmart.com/docs/pt-BR/v1/product/product-list/ , product-offers/ , product-plans/
    async exec() {
      const { itens } = await paginar("/products/api/v1/products", {}, 500);
      const linhas: unknown[][] = [];
      for (const pr of itens.slice(0, 40)) {
        const base = [pr.name || "", pr.id ?? "", pr.status || "", pr.format || ""];
        const [of, pl] = await Promise.all([
          pr.ucode ? paginar(`/products/api/v1/products/${pr.ucode}/offers`, {}, 50).catch(() => ({ itens: [] as any[] })) : { itens: [] as any[] },
          pr.ucode && pr.is_subscription ? paginar(`/products/api/v1/products/${pr.ucode}/plans`, {}, 50).catch(() => ({ itens: [] as any[] })) : { itens: [] as any[] },
        ]);
        if (!of.itens.length && !pl.itens.length) linhas.push([...base, "", "", "", "", ""]);
        for (const o of of.itens) linhas.push([...base, "Oferta", o.code || "", o.name || o.description || (o.is_main_offer ? "Principal" : ""), o.payment_mode || "", dinheiro(o.price?.value, o.price?.currency_code)]);
        for (const o of pl.itens) linhas.push([...base, "Plano", o.code || "", o.name || "", [o.periodicity, o.max_installments > 1 ? `até ${o.max_installments}x` : ""].filter(Boolean).join(" · "), dinheiro(o.price?.value, o.price?.currency_code)]);
        if (linhas.length >= LIMITE_LINHAS) break;
      }
      return { resposta: `**${itens.length} produto(s)** na conta.${itens.length > 40 ? " Ofertas e planos listados só dos 40 primeiros." : ""}`,
        dados: { colunas: ["Produto", "ID", "Status", "Formato", "Tipo", "Código", "Nome", "Modo de pagamento", "Preço"], linhas: linhas.slice(0, LIMITE_LINHAS) } };
    },
  },
  cupons: {
    rotulo: "Cupons de um produto",
    descricao: "Cupons de desconto de um produto (ID ou nome).",
    schema: { produto: { type: "string", description: "ID ou nome do produto" } }, obrig: ["produto"],
    // https://developers.hotmart.com/docs/pt-BR/v1/coupon/coupon-get-coupon/
    async exec(p) {
      const prod = await resolverProduto(obrig(p, "produto", "Produto"));
      const { itens, truncado } = await paginar(`/products/api/v1/coupon/product/${prod.id}`, {});
      const linhas = itens.map((c) => [c.id ?? "", c.coupon_code || "", pct((Number(c.discount) || 0) * 100), c.status || "", simNao(c.active), dataBR(c.start_date), dataBR(c.end_date)]);
      return { resposta: `**${itens.length} cupom(ns)** de ${prod.nome} (ID ${prod.id}); ${itens.filter((c) => c.active).length} ativo(s).${avisoCorte(itens.length, truncado)}`,
        dados: { colunas: ["ID do cupom", "Código", "Desconto", "Status", "Ativo", "Início", "Fim"], linhas } };
    },
  },
  eventos: {
    rotulo: "Eventos e participantes",
    descricao: "Eventos (produtos do tipo ingresso) com datas e participantes.",
    schema: {}, obrig: [],
    // https://developers.hotmart.com/docs/pt-BR/v1/tickets/get-info-tickets/ e .../get-participants-tickets/
    // ASSUNÇÃO: o event_id é o ID do produto de formato ETICKET (o exemplo da doc devolve o mesmo id em product.id).
    async exec() {
      const prods = (await paginar("/products/api/v1/products", {}, 500)).itens.filter((x) => String(x.format || "").toUpperCase() === "ETICKET");
      if (!prods.length) return { resposta: "Nenhum produto do tipo ingresso (evento) na conta.", dados: null };
      const linhas: unknown[][] = [], resumo: string[] = [];
      for (const pr of prods.slice(0, 10)) {
        const info = await hm("GET", `/events/api/v1/${pr.id}/info`).catch(() => null);
        const parts = await paginar(`/events/api/v1/${pr.id}/participants`, {}, 200).catch(() => ({ itens: [] as any[], total: null }));
        resumo.push(`${pr.name}: ${parts.total ?? parts.itens.length} participante(s)${info?.start_event_date ? `, ${dataBR(info.start_event_date)}` : ""}`);
        for (const x of parts.itens) linhas.push([pr.name || "", dataBR(info?.start_event_date), x.participant?.name || "", x.participant?.email || "", x.lot?.name || "", x.eticket?.ticket_status || "", x.eticket?.checkin_status || ""]);
        if (linhas.length >= LIMITE_LINHAS) break;
      }
      return { resposta: resumo.join(" · "), dados: { colunas: ["Evento", "Data", "Participante", "E-mail", "Lote", "Ingresso", "Check-in"], linhas: linhas.slice(0, LIMITE_LINHAS) } };
    },
  },
};

/* ============================ Ações (alteram dados na Hotmart) ============================ */
const ACOES: Record<string, { rotulo: string; exec: (p: any) => Promise<Resultado> }> = {
  // https://developers.hotmart.com/docs/pt-BR/v1/subscription/cancel-subscription/
  cancelar_assinatura: { rotulo: "Cancelar assinatura", async exec(p) {
    const code = obrig(p, "subscriber_code", "Código do assinante");
    const r = await hm("POST", `/payments/api/v1/subscriptions/${encodeURIComponent(code)}/cancel`, { body: { send_mail: p?.enviar_email !== false } });
    return { resposta: `Assinatura **${code}** cancelada na Hotmart. Status agora: ${r?.status || "atualizado"}.${p?.enviar_email !== false ? " O assinante recebe o e-mail de cancelamento." : ""}`, dados: null };
  } },
  // https://developers.hotmart.com/docs/pt-BR/v1/subscription/reactivate-subscription/
  reativar_assinatura: { rotulo: "Reativar assinatura", async exec(p) {
    const code = obrig(p, "subscriber_code", "Código do assinante");
    const r = await hm("POST", `/payments/api/v1/subscriptions/${encodeURIComponent(code)}/reactivate`, { body: { charge: p?.cobrar_agora === true } });
    return { resposta: `Assinatura **${code}** reativada na Hotmart${p?.cobrar_agora === true ? " com cobrança imediata" : ""}. Status retornado: ${r?.status || "atualizado"}.`, dados: null };
  } },
  // https://developers.hotmart.com/docs/pt-BR/v1/subscription/change-due-day/
  mudar_dia_cobranca: { rotulo: "Mudar dia de cobrança", async exec(p) {
    const code = obrig(p, "subscriber_code", "Código do assinante");
    const dia = inteiro(p, "dia", "Dia de cobrança", { min: 1, max: 31 })!;
    await hm("PATCH", `/payments/api/v1/subscriptions/${encodeURIComponent(code)}`, { body: { due_day: dia } });
    return { resposta: `Dia de cobrança da assinatura **${code}** alterado para o dia **${dia}**.`, dados: null };
  } },
  // https://developers.hotmart.com/docs/pt-BR/v1/coupon/coupon-post-coupon/ (discount é fração: 0 < discount < 0,99;
  // não vale para produtos de assinatura).
  criar_cupom: { rotulo: "Criar cupom", async exec(p) {
    const produto = inteiro(p, "produto_id", "ID do produto", { min: 1 })!;
    const codigo = obrig(p, "codigo", "Código do cupom");
    if (codigo.length > 25) throw new ErroParametro("Código do cupom: no máximo 25 caracteres.");
    const pctDesc = inteiro(p, "desconto_pct", "Desconto (%)", { min: 1, max: 98 })!;
    const fim = dataIso(p, "validade_fim", "Válido até", false);
    const body: Record<string, unknown> = { code: codigo, discount: Math.round(pctDesc) / 100 };
    if (fim) body.end_date = msDia(fim, true);
    await hm("POST", `/products/api/v1/product/${produto}/coupon`, { body });
    return { resposta: `Cupom **${codigo}** criado no produto ${produto} com **${pctDesc}%** de desconto${fim ? `, válido até ${fim.split("-").reverse().join("/")}` : ""}.`, dados: null };
  } },
  // https://developers.hotmart.com/docs/pt-BR/v1/coupon/coupon-delete-coupon/
  apagar_cupom: { rotulo: "Apagar cupom", async exec(p) {
    const id = inteiro(p, "cupom_id", "ID do cupom", { min: 1 })!;
    await hm("DELETE", `/products/api/v1/coupon/${id}`);
    return { resposta: `Cupom **${id}** apagado na Hotmart.`, dados: null };
  } },
  // https://developers.hotmart.com/docs/pt-BR/v1/negotiate/generate-negotiation/ — desconto é VALOR ABSOLUTO (type CUSTOM).
  gerar_negociacao: { rotulo: "Gerar negociação de parcelas em atraso (Pix)", async exec(p) {
    const sid = inteiro(p, "subscription_id", "ID da assinatura", { min: 1 })!;
    const rec = Array.isArray(p?.recorrencias) ? p.recorrencias.map(Number) : String(p?.recorrencias ?? "").split(/[,;\s]+/).filter(Boolean).map(Number);
    if (!rec.length || rec.length > 5 || !rec.every((n: number) => Number.isInteger(n) && n > 0)) throw new ErroParametro("Recorrências: informe de 1 a 5 números inteiros.");
    if (p?.desconto_pct != null && p?.desconto_pct !== "") throw new ErroParametro("A Hotmart aceita desconto em valor (R$), não em percentual. Use o campo Desconto (R$).");
    const body: Record<string, unknown> = { subscription_id: sid, recurrences: rec, payment_type: "PIX" };
    if (p?.desconto_valor != null && p?.desconto_valor !== "") {
      const v = Number(p.desconto_valor);
      if (!Number.isFinite(v) || v < 0) throw new ErroParametro("Desconto (R$): valor inválido.");
      if (v > 0) body.discount = { type: "CUSTOM", value: Math.round(v * 100) / 100 };
    }
    const r = await hm("POST", "/payments/api/v1/installments/negotiate", { body });
    const pg = r?.payment || {};
    const linhas: unknown[][] = [["Transação", r?.transaction || ""], ["Forma", pg.type || "PIX"], ["Vence em", dataBR(pg.expiration_date)],
      ["Pix copia e cola", pg.pix_code || ""], ["QR Code do Pix", pg.pix_qrcode || ""]].filter((l) => l[1]);
    return { resposta: `Negociação gerada para a assinatura **${sid}** (recorrência(s) ${rec.join(", ")}). Envie o Pix abaixo à aluna${pg.expiration_date ? `; vence em ${dataBR(pg.expiration_date)}` : ""}.`, dados: { colunas: ["Campo", "Valor"], linhas } };
  } },
};

/* ============================ Sincronização das cobranças ============================ */
const limpaTsv = (v: unknown) => String(v ?? "").replace(/[\t\r\n]+/g, " ").trim();
async function syncCobrancas(sb: any): Promise<{ ok: boolean; pulado?: boolean; detalhe?: string; error?: string; carregadas?: number }> {
  const { data: st } = await sb.from("sync_status").select("ultima_execucao_em, ultimo_status, ultimo_detalhe").eq("chave", "hotmart-cobrancas").maybeSingle();
  if (st?.ultimo_status === "ok" && st?.ultima_execucao_em && Date.now() - new Date(st.ultima_execucao_em).getTime() < 2 * 60_000) {
    return { ok: true, pulado: true, detalhe: st.ultimo_detalhe || "Sincronizado há menos de 2 minutos." };
  }
  // Trava: duas cargas ao mesmo tempo (duas pessoas abrindo Cobrança) fariam o finalizar de uma apagar as linhas da
  // outra. solicitado_em marca a carga em andamento (vale 6 min, caso a função caia no meio) e é limpo no fim.
  const agora = new Date();
  const { data: trava } = await sb.from("sync_status").update({ solicitado_em: agora.toISOString() }).eq("chave", "hotmart-cobrancas")
    .or(`solicitado_em.is.null,solicitado_em.lt.${new Date(agora.getTime() - 6 * 60_000).toISOString()}`).select("chave");
  if (!trava?.length) return { ok: true, pulado: true, detalhe: "Já existe uma atualização da Hotmart em andamento." };
  try {
    return await syncCobrancasTravado(sb);
  } finally {
    await sb.from("sync_status").update({ solicitado_em: null }).eq("chave", "hotmart-cobrancas");
  }
}
async function syncCobrancasTravado(sb: any): Promise<{ ok: boolean; pulado?: boolean; detalhe?: string; error?: string; carregadas?: number }> {
  const execucao = crypto.randomUUID();
  let vendasTsv: string[] = [], parcelasTsv: string[] = [];
  try {
    // 'vendas': WAITING_PAYMENT, PRINTED_BILLET e OVERDUE dos últimos 18 meses (sales/history, um status por chamada).
    const desde = new Date(); desde.setMonth(desde.getMonth() - 18);
    for (const s of ["WAITING_PAYMENT", "PRINTED_BILLET", "OVERDUE"]) {
      const { itens } = await paginar("/payments/api/v1/sales/history", { transaction_status: s, start_date: desde.getTime(), end_date: Date.now() }, 5000);
      for (const v of itens) {
        const pu = v.purchase || {};
        if (!pu.transaction || !Number(pu.order_date)) continue; // fin_hotmart_carregar faz order_date::bigint
        const modo = String(pu.offer?.payment_mode || "");
        const recorrente = ["SMART_INSTALLMENT", "SUBSCRIPTION", "BILLET_INSTALLMENT"].includes(modo) || Number(pu.recurrency_number) > 1;
        // TSV: transacao, status, order_date_ms, nome, email, produto, valor, parcelas_total, parcela_num, forma, metodo
        vendasTsv.push([pu.transaction, pu.status, pu.order_date, v.buyer?.name, v.buyer?.email, v.product?.name, pu.price?.value,
          recorrente ? (pu.payment?.installments_number ?? "") : "", recorrente ? (pu.recurrency_number ?? "") : "", pu.payment?.type, pu.payment?.method].map(limpaTsv).join("\t"));
      }
    }
    // 'parcelas': recorrências de parcelamento inteligente e assinaturas ativas/atrasadas (subscriptions/transactions).
    // A API devolve uma linha por recorrência; ficamos com a mais recente de cada subscriber_code. Janela de 62 dias
    // (cobranças mensais; a doc avisa até 24 h de defasagem e padrão de 30 dias).
    const ult = new Map<string, any>();
    for (const billing of ["SMART_INSTALLMENT", "SUBSCRIPTION"]) for (const status of ["ACTIVE", "DELAYED"]) {
      const { itens } = await paginar("/payments/api/v1/subscriptions/transactions", { billing_type: billing, subscription_status: status, transaction_date: Date.now() - 62 * 86400000, end_transaction_date: Date.now() }, 5000);
      for (const t of itens) {
        const k = t.subscriber_code; if (!k) continue;
        const atual = ult.get(k);
        if (!atual || (Number(t.last_recurrency_number) || 0) > (Number(atual.last_recurrency_number) || 0) || (Number(t.recurrency?.number) || 0) > (Number(atual.recurrency?.number) || 0)) ult.set(k, t);
      }
    }
    for (const t of ult.values()) {
      // fin_hotmart_carregar projeta de mês em mês: assinatura não mensal (trimestral, anual...) sairia com a data errada.
      if (Number(t.plan?.recurrency_period) > 31) continue;
      const tel = [t.subscriber?.phone_ddd, t.subscriber?.phone].filter(Boolean).join(" ");
      // TSV: subscriber_code, status_assinatura, billing_type, produto, nome, email, telefone, valor_parcela, ultima_parcela,
      //      max_parcelas, ultima_inicio_ms, status_ultima, transacao_ultima
      parcelasTsv.push([t.subscriber_code, t.status, t.billing_type, t.product?.name, t.subscriber?.name, t.subscriber?.email, tel,
        t.purchase?.price?.value, t.last_recurrency_number ?? t.recurrency?.number, t.max_cycles, t.last_recurrency_start_date ?? t.recurrency?.start_datetime,
        t.recurrency?.status, t.purchase?.transaction].map(limpaTsv).join("\t"));
    }
  } catch (e) {
    const msg = e instanceof SemCredenciais ? MSG_SEM_CRED : `Falha ao ler a Hotmart: ${String((e as Error).message || e)}`;
    await sb.from("sync_status").update({ ultima_execucao_em: new Date().toISOString(), ultimo_status: "erro", ultimo_detalhe: msg + " · lista anterior mantida" }).eq("chave", "hotmart-cobrancas");
    if (e instanceof SemCredenciais) throw e;
    return { ok: false, error: msg };
  }
  let n = 0;
  for (const [tipo, linhas] of [["vendas", vendasTsv], ["parcelas", parcelasTsv]] as [string, string[]][]) {
    for (let i = 0; i < linhas.length; i += 500) {
      const { data, error } = await sb.rpc("fin_hotmart_carregar", { p_execucao: execucao, p_tipo: tipo, p_tsv: linhas.slice(i, i + 500).join("\n") });
      if (error) {
        const msg = `Falha ao gravar as cobranças: ${error.message}`;
        await sb.from("sync_status").update({ ultima_execucao_em: new Date().toISOString(), ultimo_status: "erro", ultimo_detalhe: msg + " · lista anterior mantida" }).eq("chave", "hotmart-cobrancas");
        return { ok: false, error: msg };
      }
      n += Number(data) || 0;
    }
  }
  const detalhe = `${vendasTsv.length} venda(s) pendente(s) e ${parcelasTsv.length} parcelamento(s)/assinatura(s) lidos da API`;
  const { error: ef } = await sb.rpc("fin_hotmart_finalizar", { p_execucao: execucao, p_detalhe: detalhe });
  if (ef) return { ok: false, error: `Falha ao finalizar a carga: ${ef.message}` };
  return { ok: n > 0, carregadas: n, detalhe: n > 0 ? `${detalhe} · ${n} cobrança(s) em aberto` : `${detalhe} · nada em aberto; lista anterior mantida`, ...(n > 0 ? {} : { error: "Nenhuma cobrança em aberto devolvida pela Hotmart; a lista anterior foi mantida." }) };
}

/* ============================ Pergunta livre (Claude + ferramentas) ============================ */
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("AI_MODEL") ?? "claude-sonnet-5";
const WORKSPACE_ID_ENV = Deno.env.get("ANTHROPIC_WORKSPACE_ID") ?? "";
// Mesma tabela e câmbio de referência da função "ai" (estimativa de custo, não cotação ao vivo).
const USD_BRL_REF = 5.15;
const PRECOS_USD_POR_MTOK: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};
const precoModelo = (m: string) => PRECOS_USD_POR_MTOK[m] || PRECOS_USD_POR_MTOK["claude-sonnet-5"];
async function logAiUsage(sb: any, origem: string, modelo: string, usage: { input_tokens?: number; output_tokens?: number }) {
  try {
    const i = usage?.input_tokens || 0, o = usage?.output_tokens || 0, p = precoModelo(modelo);
    const usd = (i / 1e6) * p.input + (o / 1e6) * p.output;
    await sb.from("ai_usage_log").insert({ origem, modelo, input_tokens: i, output_tokens: o,
      custo_usd: Math.round(usd * 10000) / 10000, custo_brl: Math.round(usd * USD_BRL_REF * 10000) / 10000 });
  } catch (e) { console.error("logAiUsage:", String((e as Error).message || e)); }
}
async function iaPausada(sb: any): Promise<boolean> {
  try { const { data } = await sb.from("automacao_estado").select("pausado").eq("id", 1).maybeSingle(); return !!data?.pausado; } catch { return false; }
}
async function workspaceId(sb: any): Promise<string> {
  if (WORKSPACE_ID_ENV) return WORKSPACE_ID_ENV;
  try { const { data } = await sb.from("app_config").select("valor").eq("chave", "anthropic_workspace_id").maybeSingle(); return (data?.valor || "").trim(); } catch { return ""; }
}
const MSG_PAUSADO = "As automações de IA estão pausadas no momento (botão de emergência em Início). Peça para um admin retomar em Início → Uso de IA. Os botões de consulta continuam funcionando.";
const SYSTEM = `Você é o assistente do Financeiro da Tia do Inglês e responde perguntas sobre a conta da Hotmart em português do Brasil.
Regras: responda primeiro, de forma curta e direta; use só números devolvidos pelas ferramentas (nunca invente nem estime valores); datas em DD/MM/AAAA e dinheiro em R$; sem emojis; uma ideia por frase.
Você só tem ferramentas de leitura. Se pedirem para cancelar, reativar, mudar dia de cobrança, criar/apagar cupom, negociar ou reembolsar, explique que isso é feito pelos botões de Ações da tela Hotmart (reembolso só no painel da Hotmart).
Se faltar um dado obrigatório (ex.: e-mail, período, subdomínio da área de membros), peça esse dado. Hoje é ${"{HOJE}"} (fuso de Brasília).`;

// usage é preenchido pelo chamador e acumulado aqui, para o custo ser registrado mesmo se uma rodada falhar no meio.
async function responderPergunta(sb: any, pergunta: string, usage: { input_tokens: number; output_tokens: number }): Promise<{ resultado: Resultado }> {
  const tools = Object.entries(CONSULTAS).map(([slug, c]) => ({
    name: slug, description: `${c.rotulo}. ${c.descricao}`,
    input_schema: { type: "object", properties: c.schema, required: c.obrig },
  }));
  const headers: Record<string, string> = { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" };
  const ws = await workspaceId(sb);
  if (ws) headers["anthropic-workspace-id"] = ws;
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: FUSO });
  const messages: any[] = [{ role: "user", content: pergunta }];
  let ultimaTabela: Tabela | null = null;
  for (let rodada = 0; rodada < 7; rodada++) {
    const ultima = rodada === 6;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers,
      // Na última rodada as ferramentas continuam declaradas (a API recusa tool_use/tool_result no histórico sem tools),
      // mas tool_choice none obriga a responder em texto.
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: SYSTEM.replace("{HOJE}", hoje), messages, tools, ...(ultima ? { tool_choice: { type: "none" } } : {}) }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(`IA: ${d?.error?.message || `HTTP ${r.status}`}`);
    usage.input_tokens += d.usage?.input_tokens || 0; usage.output_tokens += d.usage?.output_tokens || 0;
    const blocos: any[] = d.content || [];
    const usos = blocos.filter((b) => b.type === "tool_use");
    if (d.stop_reason !== "tool_use" || !usos.length) {
      const texto = blocos.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      return { resultado: { resposta: texto || "Não consegui montar uma resposta com os dados da Hotmart.", dados: ultimaTabela } };
    }
    messages.push({ role: "assistant", content: blocos });
    const resultados = [];
    for (const u of usos) {
      let conteudo: string, erro = false;
      try {
        const c = CONSULTAS[u.name];
        if (!c) throw new ErroParametro("ferramenta desconhecida");
        const res = await c.exec(u.input || {});
        if (res.dados?.linhas?.length) ultimaTabela = res.dados;
        const linhas = res.dados ? res.dados.linhas.slice(0, 120) : [];
        conteudo = JSON.stringify({ resumo: res.resposta, colunas: res.dados?.colunas || [], linhas, linhas_omitidas: res.dados ? Math.max(0, res.dados.linhas.length - linhas.length) : 0 }).slice(0, 24000);
      } catch (e) {
        if (e instanceof SemCredenciais) throw e;
        erro = true; conteudo = String((e as Error).message || e);
      }
      resultados.push({ type: "tool_result", tool_use_id: u.id, content: conteudo, ...(erro ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: resultados });
  }
  return { resultado: { resposta: "Não consegui concluir a resposta dentro do limite de consultas. Tente uma pergunta mais específica.", dados: ultimaTabela } };
}

/* ============================ Servidor ============================ */
const MSG_SEM_CRED = "Credenciais da Hotmart ainda não configuradas no Supabase (HOTMART_CLIENT_ID, HOTMART_CLIENT_SECRET, HOTMART_BASIC).";

async function usuario(req: Request, sb: any): Promise<{ id: string; nome: string | null; ok: boolean } | null> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await sb.auth.getUser(jwt);
  if (!data?.user) return null;
  const { data: p } = await sb.from("profiles").select("role, areas, nome, email").eq("id", data.user.id).maybeSingle();
  const ok = !!p && (p.role === "admin" || (Array.isArray(p.areas) && p.areas.includes("financeiro")));
  return { id: data.user.id, nome: p?.nome || p?.email || data.user.email || null, ok };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "use POST" }, 405, origin);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const u = await usuario(req, sb);
  if (!u) return json({ ok: false, error: "não autorizado" }, 401, origin);
  if (!u.ok) return json({ ok: false, error: "sem permissão: precisa da aba Financeiro" }, 403, origin);

  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }
  const op = String(body?.op || "");
  const iniciado = new Date().toISOString();
  const registrar = async (linha: Record<string, unknown>) => {
    const { error } = await sb.from("fin_hotmart_pedidos").insert({ criado_por: u.id, criado_por_nome: u.nome, iniciado_em: iniciado, concluido_em: new Date().toISOString(), ...linha });
    if (error) console.error("hotmart: histórico", error.message);
  };

  try {
    if (op === "consulta") {
      const acao = String(body.acao || ""), c = CONSULTAS[acao];
      if (!c) return json({ ok: false, error: "consulta desconhecida" }, 400, origin);
      const parametros = body.parametros && typeof body.parametros === "object" ? body.parametros : {};
      const base = { tipo: "consulta", acao, rotulo: c.rotulo, parametros };
      try {
        credenciais();
        const r = await c.exec(parametros);
        await registrar({ ...base, status: "concluido", resposta: r.resposta, resposta_dados: r.dados });
        return json({ ok: true, resposta: r.resposta, dados: r.dados }, 200, origin);
      } catch (e) {
        if (e instanceof SemCredenciais) throw e;
        const msg = String((e as Error).message || e);
        await registrar({ ...base, status: "erro", erro: msg });
        return json({ ok: false, error: msg }, 200, origin);
      }
    }

    if (op === "acao") {
      const acao = String(body.acao || ""), a = ACOES[acao];
      if (!a) return json({ ok: false, error: "ação desconhecida" }, 400, origin);
      if (body.confirmado !== true) return json({ ok: false, error: "Confirme a ação antes de executar." }, 400, origin);
      const parametros = body.parametros && typeof body.parametros === "object" ? body.parametros : {};
      const base = { tipo: "acao", acao, rotulo: a.rotulo, parametros, confirmado_em: iniciado };
      try {
        credenciais();
        const r = await a.exec(parametros);
        await registrar({ ...base, status: "concluido", resposta: r.resposta, resposta_dados: r.dados });
        return json({ ok: true, resposta: r.resposta, dados: r.dados }, 200, origin);
      } catch (e) {
        if (e instanceof SemCredenciais) throw e;
        const msg = String((e as Error).message || e);
        await registrar({ ...base, status: "erro", erro: msg });
        return json({ ok: false, error: msg }, 200, origin);
      }
    }

    if (op === "pergunta") {
      const pergunta = String(body.pergunta || "").trim();
      if (!pergunta) return json({ ok: false, error: "Escreva a pergunta." }, 400, origin);
      if (pergunta.length > 4000) return json({ ok: false, error: "A pergunta pode ter no máximo 4.000 caracteres." }, 400, origin);
      credenciais();
      if (!ANTHROPIC_KEY) return json({ ok: false, error: "IA não conectada: falta o segredo ANTHROPIC_API_KEY nas Edge Functions." }, 200, origin);
      if (await iaPausada(sb)) return json({ ok: false, pausado: true, error: MSG_PAUSADO }, 200, origin);
      const base = { tipo: "pergunta", pergunta, parametros: {} };
      const usage = { input_tokens: 0, output_tokens: 0 };
      try {
        const { resultado } = await responderPergunta(sb, pergunta, usage)
          .finally(() => (usage.input_tokens || usage.output_tokens ? logAiUsage(sb, "hotmart:pergunta", MODEL, usage) : undefined));
        await registrar({ ...base, status: "concluido", resposta: resultado.resposta, resposta_dados: resultado.dados });
        return json({ ok: true, resposta: resultado.resposta, dados: resultado.dados }, 200, origin);
      } catch (e) {
        if (e instanceof SemCredenciais) throw e;
        const msg = String((e as Error).message || e);
        await registrar({ ...base, status: "erro", erro: msg });
        return json({ ok: false, error: msg }, 200, origin);
      }
    }

    if (op === "sync_cobrancas") {
      credenciais();
      const r = await syncCobrancas(sb);
      if (!r.pulado) {
        await registrar({ tipo: "sync", rotulo: "Atualizar cobranças", parametros: {}, status: r.ok ? "concluido" : "erro",
          resposta: r.ok ? r.detalhe : null, erro: r.ok ? null : r.error });
      }
      return json(r, 200, origin);
    }

    return json({ ok: false, error: "op inválida (use consulta, acao, pergunta ou sync_cobrancas)" }, 400, origin);
  } catch (e) {
    if (e instanceof SemCredenciais) return json({ ok: false, semCredenciais: true, error: MSG_SEM_CRED }, 200, origin);
    console.error("hotmart:", String((e as Error).message || e));
    return json({ ok: false, error: String((e as Error).message || e) }, 200, origin);
  }
});

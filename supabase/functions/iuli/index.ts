// Edge Function "iuli": Financeiro do OS lendo a API de Vendas do IULI (somente leitura, GET).
// Doc: app.iuli.com.br → Administração → API de Vendas. Base https://api.iuli.com.br/api/sync/sales,
// header X-API-Key (segredo IULI_API_KEY, prefixo iuli_pk_). Limites: 1.000 req/h, 100 por página, 31 dias por consulta.
// Ops (body { op }):
//   sync              -> grava public.fin_nfe (upsert por sale.id, service_role): últimos 31 dias por competência +
//                        vendas alteradas desde a última sincronização ok (/updated, até 30 dias) + até 2 meses do
//                        histórico ainda não carregados (desde HIST_INICIO, controle em fin_nfe_carga). Cron
//                        os-iuli-nfe-2h e botão "Atualizar do IULI" (pula se a última tiver menos de 2 min).
//   teste  { dias? }  -> diagnóstico SEM dados pessoais: totais por situação da NF, nomes dos campos da lista e do
//                        detalhe e o bloco "invoice" de algumas vendas. Aceita o x-sync-token (não é segredo).
// verify_jwt=false: autorização feita aqui (token do cron OU usuário com a aba Financeiro ou ADM).
import { createClient } from "jsr:@supabase/supabase-js@2";

const BASE = "https://api.iuli.com.br/api/sync/sales";
const STATUS_CHAVE = "iuli-nfe";
const HIST_INICIO = "2026-01-01";
const SYNC_TOKEN = "os-sync-tok-9Fx3Qm7Lp2Vw"; // mesmo token não-secreto dos crons do OS

const ALLOWED = new Set(["https://tiadoingles.github.io"]);
function cors(origin: string | null) {
  const allow = origin && (ALLOWED.has(origin) || /^http:\/\/localhost:\d+$/.test(origin)) ? origin : "https://tiadoingles.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (b: unknown, s: number, origin: string | null) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors(origin), "Content-Type": "application/json" } });

async function iuli(caminho: string, params: Record<string, string> = {}) {
  const chave = Deno.env.get("IULI_API_KEY") || "";
  if (!chave) throw new Error("segredo IULI_API_KEY não configurado");
  const url = new URL(BASE + caminho);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { "X-API-Key": chave.trim(), "Content-Type": "application/json" } });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`IULI ${r.status}: ${corpo?.error?.code || corpo?.code || ""} ${corpo?.error?.message || corpo?.message || ""}`.trim());
  return corpo;
}

/** Nomes dos campos (objeto.campo), sem os valores. */
function campos(o: unknown, pre = ""): string[] {
  if (!o || typeof o !== "object" || Array.isArray(o)) return [];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? campos(v, pre + k + ".") : [pre + k]);
}

const isoDia = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

async function teste(dias: number) {
  const fim = new Date();
  const ini = new Date(fim.getTime() - Math.min(Math.max(dias, 1), 31) * 86400000);
  const base = { start_date: isoDia(ini), end_date: isoDia(fim), per_page: "100" };
  const vendas: any[] = [];
  let meta: any = null;
  for (let page = 1; page <= 5; page++) {
    const r = await iuli("", { ...base, page: String(page) });
    meta = r.meta;
    vendas.push(...(r.data || []));
    if (!r.meta?.has_more) break;
  }
  const porSituacao: Record<string, number> = {};
  const porStatusVenda: Record<string, number> = {};
  for (const v of vendas) {
    const k = `${v.invoice?.issued ? "emitida" : "sem nota"} · ${v.invoice?.status ?? "null"}`;
    porSituacao[k] = (porSituacao[k] || 0) + 1;
    porStatusVenda[v.sale?.status] = (porStatusVenda[v.sale?.status] || 0) + 1;
  }
  const amostra = vendas.slice(0, 5).map((v) => ({ id: v.sale?.id, source: v.sale?.source, status: v.sale?.status, invoice: v.invoice }));
  let detalhe: string[] = [];
  let invoiceDetalhe: unknown = null;
  if (vendas[0]?.sale?.id) {
    const d = await iuli("/" + vendas[0].sale.id);
    const item = d.data?.sale ? d.data : Array.isArray(d.data) ? d.data[0] : d.data;
    detalhe = campos(item);
    invoiceDetalhe = item?.invoice ?? null;
  }
  const semNota = await iuli("", { ...base, invoice_issued: "false", per_page: "1" });
  return {
    periodo: base, total_api: meta?.total, lidas: vendas.length, porSituacao, porStatusVenda,
    sem_nota_total: semNota.meta?.total, campos_lista: campos(vendas[0]), campos_detalhe: detalhe, invoiceDetalhe, amostra,
  };
}

/* ============================ Sincronização (fin_nfe) ============================ */
const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const dia = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
function linhaNfe(v: any, agora: string) {
  return {
    iuli_id: v.sale.id, venda_codigo: v.sale.custom_sale_id ?? null, transacao: v.sale.transaction_external_id ?? null,
    origem: v.sale.source ?? null, status_venda: v.sale.status ?? null, produto: v.product?.name ?? null,
    cliente_nome: v.client?.name ?? null, cliente_email: v.client?.email ? String(v.client.email).trim().toLowerCase() : null,
    valor_total: num(v.financial?.total_value), valor_liquido: num(v.financial?.final_value ?? v.financial?.net_value),
    competencia: dia(v.dates?.competency_date), pagamento: dia(v.dates?.payment_date),
    nf_emitida: v.invoice?.issued === true, nf_status: v.invoice?.status ?? null, nf_agendada_para: v.invoice?.scheduled_date || null,
    criado_iuli: v.sale.created_at || null, atualizado_iuli: v.sale.updated_at || null, sincronizado_em: agora,
  };
}
/** Todas as páginas de uma consulta (lista ou /updated). */
async function todasPaginas(caminho: string, params: Record<string, string>) {
  const out: any[] = [];
  for (let page = 1; page <= 60; page++) {
    const r = await iuli(caminho, { ...params, per_page: "100", page: String(page) });
    out.push(...(r.data || []));
    if (!r.meta?.has_more) break;
  }
  return out;
}
const somarDias = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** Primeiro dia dos meses de HIST_INICIO até o mês de `ate`, do mais recente para o mais antigo. */
function mesesAte(ate: string) {
  const out: string[] = [];
  let [y, m] = ate.split("-").map(Number);
  const [y0, m0] = HIST_INICIO.split("-").map(Number);
  while (y > y0 || (y === y0 && m >= m0)) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
    if (--m === 0) { m = 12; y--; }
  }
  return out;
}
const fimDoMes = (ini: string) => {
  const [y, m] = ini.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

async function sincronizar(sb: any, ultimaOk: string | null) {
  const agora = new Date().toISOString();
  const hoje = isoDia(new Date());
  const ini = somarDias(hoje, -30);
  const porId = new Map<number, any>();
  const juntar = (vs: any[]) => { for (const v of vs) if (v?.sale?.id) porId.set(v.sale.id, v); };

  juntar(await todasPaginas("", { start_date: ini, end_date: hoje }));
  let alteradas = 0;
  if (ultimaOk && Date.now() - Date.parse(ultimaOk) < 29 * 86400000) {
    const vs = await todasPaginas("/updated", { since: new Date(Date.parse(ultimaOk) - 10 * 60000).toISOString() });
    alteradas = vs.length;
    juntar(vs);
  }
  // Histórico: meses inteiros antes da janela recente que ainda não foram carregados (2 por execução).
  const { data: feitos } = await sb.from("fin_nfe_carga").select("mes");
  const jaFeitos = new Set((feitos || []).map((f: any) => String(f.mes).slice(0, 10)));
  const pendentes = mesesAte(somarDias(ini, -1)).filter((m) => !jaFeitos.has(m)).slice(0, 2);
  const carga: { mes: string; vendas: number }[] = [];
  for (const mes of pendentes) {
    const fim = fimDoMes(mes) < ini ? fimDoMes(mes) : somarDias(ini, -1);
    const vs = await todasPaginas("", { start_date: mes, end_date: fim });
    juntar(vs);
    carga.push({ mes, vendas: vs.length });
  }

  const linhas = [...porId.values()].map((v) => linhaNfe(v, agora));
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await sb.from("fin_nfe").upsert(linhas.slice(i, i + 500), { onConflict: "iuli_id" });
    if (error) throw new Error(error.message);
  }
  if (carga.length) {
    const { error } = await sb.from("fin_nfe_carga").upsert(carga.map((c) => ({ ...c, carregado_em: agora })));
    if (error) throw new Error(error.message);
  }
  const faltam = mesesAte(somarDias(ini, -1)).filter((m) => !jaFeitos.has(m)).length - carga.length;
  return { gravadas: linhas.length, alteradas, meses: carga.map((c) => c.mes.slice(0, 7)), faltam_meses: faltam };
}

// Acesso do usuário logado: null = não autenticado; "fin" = tem a aba Financeiro (ADM incluído).
async function papelUsuario(req: Request, sb: any): Promise<string | null> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await sb.auth.getUser(jwt);
  if (!data?.user) return null;
  const { data: p } = await sb.from("profiles").select("role, areas").eq("id", data.user.id).maybeSingle();
  return p && (p.role === "admin" || (Array.isArray(p.areas) && p.areas.includes("financeiro"))) ? "fin" : "sem_area";
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "use POST" }, 405, origin);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const tokenOk = (req.headers.get("x-sync-token") || "") === SYNC_TOKEN;
  const papel = tokenOk ? "cron" : await papelUsuario(req, sb);
  if (!papel) return json({ ok: false, error: "não autorizado" }, 401, origin);
  if (papel === "sem_area") return json({ ok: false, error: "sem permissão: precisa da aba Financeiro" }, 403, origin);

  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }
  try {
    if (body.op === "sync") {
      const { data: st } = await sb.from("sync_status").select("ultima_execucao_em, ultimo_status, ultimo_detalhe").eq("chave", STATUS_CHAVE).maybeSingle();
      const idade = st?.ultima_execucao_em ? Date.now() - Date.parse(st.ultima_execucao_em) : Infinity;
      if (!tokenOk && idade < 2 * 60_000) return json({ ok: st?.ultimo_status !== "erro", pulado: true, detalhe: st?.ultimo_detalhe }, 200, origin);
      const registrar = (status: string, detalhe: string) =>
        sb.from("sync_status").update({ ultima_execucao_em: new Date().toISOString(), ultimo_status: status, ultimo_detalhe: detalhe }).eq("chave", STATUS_CHAVE);
      try {
        const r = await sincronizar(sb, st?.ultimo_status === "ok" ? st.ultima_execucao_em : null);
        const detalhe = `${r.gravadas} venda(s) lidas do IULI` + (r.meses.length ? ` · histórico ${r.meses.join(", ")}` : "") +
          (r.faltam_meses > 0 ? ` · faltam ${r.faltam_meses} mês(es) do histórico` : "");
        await registrar("ok", detalhe);
        return json({ ok: true, ...r, detalhe }, 200, origin);
      } catch (e) {
        const msg = "Falha ao ler o IULI: " + String((e as Error).message || e);
        await registrar("erro", msg);
        throw new Error(msg);
      }
    }
    if (body.op === "teste") return json({ ok: true, ...(await teste(Number(body.dias) || 7)) }, 200, origin);
    return json({ ok: false, error: "op desconhecida" }, 400, origin);
  } catch (e) {
    console.error("iuli:", String((e as Error).message || e));
    return json({ ok: false, error: String((e as Error).message || e) }, 200, origin);
  }
});

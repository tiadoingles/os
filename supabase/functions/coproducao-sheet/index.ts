// Edge Function "coproducao-sheet": espelha (somente leitura) a planilha "Calculo Investimento -
// Tia do Inglês", aba "Base", em public.fin_coproducao (ciclos de operação, total e regras por funil).
// Disparo: OS ao abrir Financeiro › Co-Produção (pula se o último sync tiver menos de 10 min, a menos
// que venha { force: true } do botão "Atualizar da planilha") e pg_cron diário (header x-sync-token).
// Sem acesso à planilha: 200 { ok:false, semAcesso:true }. Conta de serviço do OS (app_config).
// verify_jwt=false: autorização feita aqui (token do cron OU usuário com a aba Financeiro ou ADM).
import { createClient } from "jsr:@supabase/supabase-js@2";

const SHEET_ID = "1oqDiyFk2RzucGdIw0lDWoiIkJPh9ZeB6ifDIS-pnJ5Q";
const ABA = "Base";
const SYNC_TOKEN = "os-sync-tok-9Fx3Qm7Lp2Vw"; // mesmo token não-secreto dos crons do OS
const STATUS_CHAVE = "coproducao-planilha";
const FRESCO_MS = 10 * 60 * 1000;

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

// ---------------- Google ----------------
function base64url(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}
async function googleToken(sb: any): Promise<string> {
  let email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") ?? "";
  let key = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY") ?? "";
  if (!email || !key) {
    const { data } = await sb.from("app_config").select("chave,valor")
      .in("chave", ["google_service_account_email", "google_service_account_key"]);
    for (const r of data || []) {
      if (r.chave === "google_service_account_email" && !email) email = r.valor || "";
      if (r.chave === "google_service_account_key" && !key) key = r.valor || "";
    }
  }
  if (!email || !key) throw new Error("conta de serviço Google não configurada");
  key = key.replace(/\\n/g, "\n");
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now };
  const input = `${base64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))}.${base64url(enc.encode(JSON.stringify(claim)))}`;
  const ck = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", ck, enc.encode(input));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${input}.${base64url(new Uint8Array(sig))}` }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error_description || d?.error || `token HTTP ${r.status}`);
  return d.access_token;
}
class SemAcesso extends Error {}

// ---------------- Leitura ----------------
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = (s: unknown) => semAcento(String(s ?? "")).toLowerCase().replace(/\s+/g, " ").trim();

type Cel = { txt: string; num: number | null; link: string | null };
function celula(v: any): Cel {
  const txt = String(v?.formattedValue ?? "").trim();
  const ev = v?.effectiveValue || {};
  const num = typeof ev.numberValue === "number" ? ev.numberValue : null;
  // Link comum, link num trecho do texto ou "chip" de arquivo do Drive.
  const link = v?.hyperlink || v?.textFormatRuns?.find?.((r: any) => r?.format?.link?.uri)?.format?.link?.uri
    || v?.chipRuns?.find?.((r: any) => r?.chip?.richLinkProperties?.uri)?.chip?.richLinkProperties?.uri || null;
  return { txt, num, link };
}
// Datas vêm como "dd/mm/aaaa" no texto formatado.
function dataISO(s: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

// Cabeçalho da tabela de ciclos → campo (por nome normalizado).
const CAMPOS_CICLO: [string, (h: string) => boolean][] = [
  ["ciclo", (h) => h.startsWith("ciclo")],
  ["data_inicial", (h) => h.startsWith("data inicial")],
  ["data_final", (h) => h.startsWith("data final")],
  ["custo_total", (h) => h.startsWith("custo total")],
  ["part_tia", (h) => h === "participacao tia"],
  ["part_fad", (h) => h === "participacao fad"],
  ["inv_nec_tia", (h) => h === "investimento necessario tia"],
  ["inv_nec_fad", (h) => h === "investimento necessario fad"],
  ["inv_real_tia", (h) => h === "investimento real tia"],
  ["inv_real_fad", (h) => h === "investimento real fad"],
  ["receb_total", (h) => h.startsWith("recebimento total")],
  ["receb_nec_tia", (h) => h === "recebimento necessario tia"],
  ["receb_nec_fad", (h) => h === "recebimento necessario fad"],
  ["receb_real_tia", (h) => h === "recebimento real tia"],
  ["receb_real_fad", (h) => h === "recebimento real fad"],
  ["saldo_tia", (h) => h === "saldo tia"],
  ["saldo_fad", (h) => h === "saldo fad"],
  ["links", (h) => h.startsWith("links")],
  ["comentarios", (h) => h.startsWith("comentario")],
];
const CAMPOS_FUNIL: [string, (h: string) => boolean][] = [
  ["funil", (h) => h === "funil"],
  ["result_tia", (h) => h.startsWith("% resultados tia")],
  ["result_fad", (h) => h.startsWith("% resultados fad")],
  ["invest_tia", (h) => h.startsWith("% investimento tia")],
  ["invest_fad", (h) => h.startsWith("% investimento fad")],
];
const TEXTO = new Set(["ciclo", "data_inicial", "data_final", "links", "comentarios", "funil"]);

function mapear(cab: Cel[], campos: [string, (h: string) => boolean][]) {
  const idx: Record<string, number> = {};
  const extras: [string, number][] = [];
  cab.forEach((c, i) => {
    const h = norm(c.txt);
    if (!h) return;
    const m = campos.find(([k, ok]) => !(k in idx) && ok(h));
    if (m) idx[m[0]] = i; else extras.push([c.txt, i]);
  });
  return { idx, extras };
}
function linhaObj(row: Cel[], idx: Record<string, number>, extras: [string, number][]) {
  const o: Record<string, unknown> = {};
  for (const [k, i] of Object.entries(idx)) {
    const c = row[i] || { txt: "", num: null, link: null };
    if (k === "data_inicial" || k === "data_final") o[k] = dataISO(c.txt);
    else if (k === "links") { o.links = c.txt || null; o.links_url = c.link; }
    else if (TEXTO.has(k)) o[k] = c.txt || null;
    else o[k] = c.num;                       // percentuais vêm como fração (0,5 = 50%)
  }
  const ex: Record<string, string> = {};
  for (const [h, i] of extras) if (row[i]?.txt) ex[h] = row[i].txt;
  if (Object.keys(ex).length) o.extras = ex;
  return o;
}

async function sincronizar(sb: any) {
  const token = await googleToken(sb);
  const fields = "sheets(properties.title,data.rowData.values(formattedValue,effectiveValue,hyperlink,textFormatRuns,chipRuns))";
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?ranges=${encodeURIComponent(`'${ABA}'!A1:Z200`)}&includeGridData=true&fields=${encodeURIComponent(fields)}`;
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 403 || r.status === 404) throw new SemAcesso(d?.error?.message || `HTTP ${r.status}`);
  if (!r.ok) throw new Error(d?.error?.message || `Sheets HTTP ${r.status}`);
  const linhas: Cel[][] = (d.sheets?.[0]?.data?.[0]?.rowData || []).map((rd: any) => (rd.values || []).map(celula));

  const iCab = linhas.findIndex((l) => l.some((c) => norm(c.txt).startsWith("ciclo de operacao")));
  if (iCab < 0) throw new Error("cabeçalho \"Ciclo de operação\" não encontrado na aba Base");
  const ciclosMap = mapear(linhas[iCab], CAMPOS_CICLO);
  const colCiclo = ciclosMap.idx.ciclo;
  const ciclos: Record<string, unknown>[] = [];
  let total: Record<string, unknown> | null = null;
  let i = iCab + 1;
  for (; i < linhas.length; i++) {
    const nome = norm(linhas[i][colCiclo]?.txt);
    if (nome === "funil") break;
    if (nome.startsWith("total")) { total = linhaObj(linhas[i], ciclosMap.idx, []); continue; }
    if (!nome) continue;
    ciclos.push(linhaObj(linhas[i], ciclosMap.idx, ciclosMap.extras));
  }
  const funis: Record<string, unknown>[] = [];
  const iFunil = linhas.findIndex((l, k) => k > iCab && l.some((c) => norm(c.txt) === "funil"));
  if (iFunil >= 0) {
    const fm = mapear(linhas[iFunil], CAMPOS_FUNIL);
    for (let k = iFunil + 1; k < linhas.length; k++) {
      if (!norm(linhas[k][fm.idx.funil]?.txt)) continue;
      const f = linhaObj(linhas[k], fm.idx, fm.extras);
      // Anotações soltas à direita (sem cabeçalho), ex.: "Dividindo 50 / 50 custos de entrega".
      const usadas = new Set([...Object.values(fm.idx), ...fm.extras.map(([, i]) => i)]);
      const obs = linhas[k].filter((c, i) => c.txt && !usadas.has(i)).map((c) => c.txt).join(" · ");
      if (obs) f.observacao = obs;
      funis.push(f);
    }
  }
  if (!ciclos.length) throw new Error("nenhum ciclo na aba Base; espelho anterior mantido");
  const { error } = await sb.from("fin_coproducao").upsert({ id: 1, ciclos, total, funis, atualizado_em: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return { ciclos: ciclos.length, funis: funis.length };
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
  const force = tokenOk || body.force === true;

  const { data: st } = await sb.from("sync_status").select("ultima_execucao_em, ultimo_status, ultimo_detalhe").eq("chave", STATUS_CHAVE).maybeSingle();
  const idade = st?.ultima_execucao_em ? Date.now() - new Date(st.ultima_execucao_em).getTime() : Infinity;
  const minimo = tokenOk ? 0 : force ? 30_000 : st?.ultimo_status === "ok" ? FRESCO_MS : 2 * 60_000;
  if (idade < minimo) {
    return json({ ok: st?.ultimo_status !== "erro", pulado: true, error: st?.ultimo_status === "erro" ? st.ultimo_detalhe : undefined }, 200, origin);
  }

  const registrar = (status: string, detalhe: string) =>
    sb.from("sync_status").update({ ultima_execucao_em: new Date().toISOString(), ultimo_status: status, ultimo_detalhe: detalhe }).eq("chave", STATUS_CHAVE);
  try {
    const r = await sincronizar(sb);
    const detalhe = `${r.ciclos} ciclos e ${r.funis} funis lidos da aba ${ABA}`;
    await registrar("ok", detalhe);
    return json({ ok: true, ...r, detalhe }, 200, origin);
  } catch (e) {
    const semAcesso = e instanceof SemAcesso;
    const msg = semAcesso
      ? "A conta de serviço do OS não tem acesso à planilha Calculo Investimento (compartilhe como Leitor)."
      : "Falha ao ler a planilha: " + String((e as Error).message || e);
    console.error("coproducao-sheet:", String((e as Error).message || e));
    await registrar("erro", msg);
    return json({ ok: false, semAcesso, error: msg }, 200, origin);
  }
});

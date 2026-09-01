import { render } from "preact";
import { useState, useEffect, useMemo, useCallback, useRef } from "preact/hooks";
import { html } from "htm/preact";
import { createClient } from "@supabase/supabase-js";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

/* ============================ Setup ============================ */

const cfg = window.__CONFIG__ || {};
export const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const KINDS = [
  ["documento", "Documento"],
  ["planilha", "Planilha"],
  ["apresentacao", "Apresentação"],
  ["video", "Vídeo"],
  ["audio", "Áudio"],
  ["link", "Link"],
  ["outro", "Outro"],
];
const KIND_LABEL = Object.fromEntries(KINDS);
const KIND_ICON = {
  documento: "📄", planilha: "📊", apresentacao: "📽️",
  video: "🎬", audio: "🎧", link: "🔗", outro: "📦",
};
const STATUSES = [
  ["publicado", "Publicado"],
  ["rascunho", "Rascunho"],
  ["arquivado", "Arquivado"],
];
const PILL_OK = "bg-[#e7efe1] text-[#5e7a52]";
const PILL_WARN = "bg-[#efe9cf] text-[#7c7440]";
const PILL_ERR = "bg-[#f4e0db] text-[#a44b43]";
const PILL_NEUTRAL = "bg-black/[0.05] text-muted";

const STATUS_STYLE = {
  publicado: PILL_OK,
  rascunho: PILL_WARN,
  arquivado: PILL_NEUTRAL,
};
const ROLE_LABEL = { leitor: "Leitor", editor: "Editor", admin: "Admin" };

// Setores do menu lateral. `path` ativo; `wip` = página "em construção".
const SETORES = [
  { nome: "Base de Conhecimento", icone: "📚", path: "/" },
  { nome: "Pedir a IA", icone: "✨", path: "/pedir-ia" },
  { nome: "Ferramentas", icone: "🧰", path: "/ferramentas" },
  { nome: "Financeiro", icone: "💰", path: "/financeiro", wip: "Contas, faturamento, comissões e relatórios financeiros da empresa." },
  { nome: "Comercial", icone: "📈", path: "/comercial", wip: "Funil de vendas, leads, calls, scripts e acompanhamento de metas." },
  { nome: "CS / Suporte", icone: "🤝", path: "/cs-suporte", wip: "Onboarding de alunas, acompanhamento, retenção e atendimento." },
  { nome: "Conteúdo", icone: "✍️", path: "/conteudo", wip: "Calendário editorial, produção de conteúdo, YouTube e social." },
];

const FERRAMENTA_STATUS = {
  conectada: { label: "Conectada", cls: PILL_OK, dot: "bg-[#7d9b6e]" },
  erro: { label: "Erro", cls: PILL_ERR, dot: "bg-[#c56b5f]" },
  desconectada: { label: "Desconectada", cls: PILL_NEUTRAL, dot: "bg-[#b3aca0]" },
  nao_configurada: { label: "Não configurada", cls: PILL_WARN, dot: "bg-[#bfa94e]" },
};
const FERRAMENTA_CATEGORIAS = [
  ["infra", "Infra da OS"],
  ["automacao", "Automação"],
  ["dados", "Dados / Conhecimento"],
  ["produtividade", "Produtividade"],
  ["conteudo", "Conteúdo"],
  ["marketing", "Marketing"],
  ["financeiro", "Financeiro"],
  ["comunicacao", "Comunicação"],
  ["ia", "IA / Desenvolvimento"],
  ["outros", "Outros"],
];
const CAT_LABEL = Object.fromEntries(FERRAMENTA_CATEGORIAS);

const MAX_UPLOAD = 50 * 1024 * 1024; // 50 MB

/* ============================ Helpers ============================ */

const cx = (...a) => a.filter(Boolean).join(" ");

function fmtDate(s, withTime = false) {
  if (!s) return "—";
  const d = new Date(s);
  const opt = withTime
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" };
  return d.toLocaleDateString("pt-BR", opt);
}

function fmtSize(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

function notify(message, kind = "info") {
  dispatchEvent(new CustomEvent("app:toast", { detail: { message, kind } }));
}
function errMsg(e) {
  return (e && (e.message || e.error_description || e.error)) || "Algo deu errado.";
}

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  return {
    path,
    parts: path.split("/").filter(Boolean),
    query: Object.fromEntries(new URLSearchParams(qs || "")),
  };
}
function go(to) { location.hash = to; }

function useRoute() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const on = () => { setRoute(parseHash()); window.scrollTo(0, 0); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

function embedUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
    }
    if (host === "youtu.be") return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    if (host.endsWith("loom.com")) return url.replace("/share/", "/embed/");
    if (host.endsWith("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean).pop();
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
  } catch (_) { /* ignore */ }
  return null;
}

async function signedUrl(path) {
  const { data, error } = await sb.storage.from("kb-documents").createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

/* ============================ Data layer ============================ */

const DOC_SELECT =
  "id, titulo, descricao, kind, tags, status, origem, chave_externa, created_at, updated_at, " +
  "responsavel:responsavel_id(id,nome,email), " +
  "section:section_id(id,slug,nome,icone), " +
  "current:current_version_id(id,versao,storage_path,external_url,conteudo_md,file_name,mime_type,file_size)";

async function fetchSections() {
  const { data, error } = await sb.from("kb_sections").select("*").order("ordem");
  if (error) throw error;
  return data || [];
}

async function fetchDocs({ sectionId, search, status } = {}) {
  let q = sb.from("kb_documents").select(DOC_SELECT).order("updated_at", { ascending: false });
  if (sectionId) q = q.eq("section_id", sectionId);
  if (status) q = q.eq("status", status);
  if (search && search.trim()) {
    const s = search.trim().replace(/[,()]/g, " ");
    q = q.or(`titulo.ilike.%${s}%,descricao.ilike.%${s}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function fetchDoc(id) {
  const { data, error } = await sb.from("kb_documents").select(DOC_SELECT).eq("id", id).single();
  if (error) throw error;
  return data;
}

async function fetchVersions(docId) {
  const { data, error } = await sb
    .from("kb_document_versions")
    .select("*, autor:uploaded_by(nome,email)")
    .eq("document_id", docId)
    .order("versao", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function fetchProfiles() {
  const { data, error } = await sb
    .from("profiles").select("id,nome,email,role").order("nome", { nullsFirst: false });
  if (error) throw error;
  return data || [];
}

/* ---- Ferramentas ---- */

async function fetchFerramentas() {
  const { data, error } = await sb
    .from("os_ferramentas")
    .select("*, responsavel:responsavel_id(id,nome,email)")
    .order("ordem")
    .order("nome");
  if (error) throw error;
  return data || [];
}

// Checagem automática feita no navegador. Só funciona para os endpoints que
// respondem com CORS: o próprio Supabase, a Edge Function e o site no GitHub Pages.
async function checkFerramenta(f) {
  const t0 = performance.now();
  try {
    let resp;
    if (f.check_kind === "supabase_rest") {
      // consulta leve num endpoint real: 200 = serviço no ar (RLS pode devolver [])
      resp = await fetch(cfg.SUPABASE_URL + "/rest/v1/kb_sections?select=id&limit=1", {
        headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY },
        cache: "no-store",
      });
    } else if (f.check_kind === "edge_function") {
      resp = await fetch(f.check_url, { method: "OPTIONS", cache: "no-store" });
    } else {
      resp = await fetch(f.check_url, { method: "GET", cache: "no-store" });
    }
    const ms = Math.round(performance.now() - t0);
    const ok = resp.ok || resp.status === 200 || resp.status === 204;
    return {
      status: ok ? "conectada" : "erro",
      detalhe: `HTTP ${resp.status} · ${ms} ms`,
    };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    return { status: "erro", detalhe: `${String(e && e.message || e).slice(0, 120)} · ${ms} ms` };
  }
}

async function persistFerramentaCheck(id, res) {
  const { error } = await sb.from("os_ferramentas").update({
    ultimo_status: res.status,
    ultimo_check_at: new Date().toISOString(),
    ultimo_check_detalhe: res.detalhe,
  }).eq("id", id);
  if (error) throw error;
}

async function fetchActivity(docId) {
  const { data, error } = await sb
    .from("kb_activity_log")
    .select("*, autor:actor_id(nome,email)")
    .eq("document_id", docId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

async function logActivity(documentId, actorId, action, detail = {}) {
  try {
    await sb.from("kb_activity_log").insert({ document_id: documentId, actor_id: actorId, action, detail });
  } catch (_) { /* auditoria não deve quebrar o fluxo */ }
}

async function uploadVersionFile(sectionSlug, docId, versao, file) {
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
  const path = `${sectionSlug}/${docId}/v${versao}__${safe}`;
  const { error } = await sb.storage
    .from("kb-documents")
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  return path;
}

async function insertVersion({ docId, sectionSlug, versao, source, meId, changelog }) {
  const row = { document_id: docId, versao, changelog: changelog || "", uploaded_by: meId };
  if (source.file) {
    row.storage_path = await uploadVersionFile(sectionSlug, docId, versao, source.file);
    row.file_name = source.file.name;
    row.mime_type = source.file.type || null;
    row.file_size = source.file.size;
  } else if (source.external_url) {
    row.external_url = source.external_url.trim();
    row.file_name = (source.link_label || "").trim() || null;
  } else if (source.conteudo_md) {
    row.conteudo_md = source.conteudo_md;
    row.file_name = (source.link_label || "").trim() || null;
  } else {
    throw new Error("Envie um arquivo, informe um link ou escreva o texto.");
  }
  const { error } = await sb.from("kb_document_versions").insert(row);
  if (error) throw error;
}

async function createDocument(form, me) {
  const { data: doc, error } = await sb
    .from("kb_documents")
    .insert({
      section_id: form.section_id,
      titulo: form.titulo.trim(),
      descricao: form.descricao.trim(),
      kind: form.kind,
      tags: form.tags,
      status: form.status,
      responsavel_id: form.responsavel_id || null,
      created_by: me.id,
    })
    .select("id, section:section_id(slug)")
    .single();
  if (error) throw error;

  try {
    await insertVersion({
      docId: doc.id,
      sectionSlug: doc.section.slug,
      versao: 1,
      source: form.source,
      meId: me.id,
      changelog: "Versão inicial",
    });
  } catch (e) {
    // desfaz o documento se a 1ª versão falhar
    await sb.from("kb_documents").delete().eq("id", doc.id);
    throw e;
  }
  await logActivity(doc.id, me.id, "criou", { titulo: form.titulo.trim() });
  return doc.id;
}

async function updateDocumentMeta(id, patch) {
  const { error } = await sb.from("kb_documents").update(patch).eq("id", id);
  if (error) throw error;
}

async function adminCall(body) {
  const { data, error } = await sb.functions.invoke("admin-users", { body });
  if (error) {
    let msg = error.message;
    try {
      const j = await error.context.json();
      if (j && j.error) msg = j.error;
    } catch (_) { /* ignore */ }
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

/* ============================ UI primitives ============================ */

function Btn({ variant = "primary", as = "button", href, loading, disabled, children, class: cls, ...rest }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
  const styles = {
    primary: "bg-brand text-white hover:bg-brand-dark shadow-sm",
    ghost: "bg-white text-ink ring-1 ring-line hover:bg-black/[0.04]",
    subtle: "bg-black/[0.05] text-ink hover:bg-line",
    danger: "bg-white text-red-600 ring-1 ring-red-200 hover:bg-red-50",
  };
  const c = cx(base, styles[variant], cls);
  const inner = html`${loading ? html`<span class="spinner"></span>` : null}${children}`;
  if (as === "a")
    return html`<a href=${href} class=${c} ...${rest}>${inner}</a>`;
  return html`<button class=${c} disabled=${disabled || loading} ...${rest}>${inner}</button>`;
}

function Field({ label, hint, children, required }) {
  return html`
    <label class="block">
      <span class="mb-1 block text-sm font-medium text-ink">
        ${label}${required ? html`<span class="text-brand"> *</span>` : null}
      </span>
      ${children}
      ${hint ? html`<span class="mt-1 block text-xs text-muted">${hint}</span>` : null}
    </label>`;
}

const inputCls =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder-muted/70 focus:border-brand focus:ring-brand";

function Badge({ children, class: cls }) {
  return html`<span class=${cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", cls)}>${children}</span>`;
}

function Empty({ icon = "🗂️", title, children }) {
  return html`
    <div class="rounded-xl border border-dashed border-line bg-card/70 px-6 py-14 text-center">
      <div class="text-4xl">${icon}</div>
      <div class="mt-3 font-medium text-ink">${title}</div>
      ${children ? html`<div class="mx-auto mt-1 max-w-md text-sm text-muted">${children}</div>` : null}
    </div>`;
}

function Splash() {
  return html`<div class="flex min-h-screen items-center justify-center text-muted text-sm">
    <span class="spinner mr-2"></span> Carregando…
  </div>`;
}

function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const on = (e) => {
      const id = Math.random().toString(36).slice(2);
      setItems((x) => [...x, { id, ...e.detail }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500);
    };
    addEventListener("app:toast", on);
    return () => removeEventListener("app:toast", on);
  }, []);
  return html`<div class="toaster">
    ${items.map((i) => html`<div key=${i.id} class=${cx("toast", i.kind === "ok" ? "toast-ok" : i.kind === "err" ? "toast-err" : "toast-info")}>${i.message}</div>`)}
  </div>`;
}

function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const on = (e) => e.key === "Escape" && onClose();
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [onClose]);
  return html`
    <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 sm:p-8" onClick=${onClose}>
      <div
        class=${cx("w-full rounded-2xl bg-white shadow-xl ring-1 ring-line", wide ? "max-w-2xl" : "max-w-lg")}
        onClick=${(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 class="font-semibold text-ink">${title}</h3>
          <button class="rounded-md p-1 text-muted hover:bg-black/[0.06] hover:text-ink/75" onClick=${onClose}>✕</button>
        </div>
        <div class="px-5 py-4">${children}</div>
      </div>
    </div>`;
}

/* ============================ Auth screens ============================ */

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("login"); // login | reset

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: location.origin + location.pathname,
        });
        if (error) throw error;
        notify("Se este e-mail existir, você receberá um link para redefinir a senha.", "ok");
        setMode("login");
      }
    } catch (e2) {
      notify(errMsg(e2), "err");
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div class="flex min-h-screen items-center justify-center bg-gradient-to-b from-card to-bg px-4">
      <div class="w-full max-w-sm">
        <div class="mb-6 text-center">
          <div class="text-4xl">📚</div>
          <h1 class="mt-2 text-lg font-semibold text-ink">Sistema Operacional</h1>
          <p class="text-sm text-muted">Tia do Inglês — Base de Conhecimento</p>
        </div>
        <form onSubmit=${submit} class="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-line">
          <${Field} label="E-mail" required>
            <input class=${inputCls} type="email" autocomplete="username" required
              value=${email} onInput=${(e) => setEmail(e.target.value)} />
          <//>
          ${mode === "login" && html`
            <${Field} label="Senha" required>
              <input class=${inputCls} type="password" autocomplete="current-password" required
                value=${password} onInput=${(e) => setPassword(e.target.value)} />
            <//>`}
          <${Btn} type="submit" loading=${busy} class="w-full">
            ${mode === "login" ? "Entrar" : "Enviar link de redefinição"}
          <//>
          <button type="button" class="w-full text-center text-xs text-muted hover:text-ink/75"
            onClick=${() => setMode(mode === "login" ? "reset" : "login")}>
            ${mode === "login" ? "Esqueci minha senha" : "← Voltar ao login"}
          </button>
        </form>
      </div>
    </div>`;
}

/* ============================ Shell ============================ */

function iniciais(txt) {
  const p = (txt || "").trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase();
}

function Shell({ me, route, children }) {
  const [open, setOpen] = useState(false);
  const p0 = route.parts[0] || "";
  const bcActive = p0 === "" || p0 === "secao" || p0 === "doc" || p0 === "novo";

  const navItem = (label, icon, target, active) => html`
    <a href=${"#" + target} onClick=${() => setOpen(false)}
      class=${cx(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
        active ? "bg-brand-light font-medium text-brand-dark" : "text-ink/70 hover:bg-black/[0.04]"
      )}>
      <span class="w-5 text-center text-[15px] leading-none">${icon}</span>
      <span class="truncate">${label}</span>
    </a>`;

  const sidebar = html`
    <div class="flex h-full flex-col">
      <div class="flex items-center gap-3 border-b border-line px-4 py-4">
        <div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-light text-sm font-semibold text-brand-dark">
          ${iniciais(me.nome || me.email)}
        </div>
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold text-ink">${me.nome || me.email}</div>
          <div class="text-xs text-muted">${ROLE_LABEL[me.role]}</div>
        </div>
      </div>

      <nav class="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        ${SETORES.map((s) => navItem(
          s.nome, s.icone, s.path,
          s.path === "/" ? bcActive : route.path === s.path
        ))}
      </nav>

      <div class="space-y-0.5 border-t border-line px-2 py-2">
        ${me.role === "admin" ? navItem("Administração", "⚙️", "/admin", route.path === "/admin") : null}
        ${navItem("Meu perfil", "👤", "/perfil", route.path === "/perfil")}
        ${cfg.AUTH_MODE === "open" ? null : html`
          <button
            class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink/70 hover:bg-black/[0.04]"
            onClick=${async () => { await sb.auth.signOut(); location.hash = "/"; }}>
            <span class="w-5 text-center text-[15px] leading-none">↩︎</span> Sair
          </button>`}
      </div>
    </div>`;

  return html`
    <div class="min-h-screen lg:flex">
      <aside class="hidden w-60 shrink-0 border-r border-line bg-sidebar lg:block">
        <div class="sticky top-0 h-screen">${sidebar}</div>
      </aside>

      <div class="flex items-center justify-between border-b border-line bg-sidebar px-4 py-3 lg:hidden">
        <span class="text-sm font-semibold text-ink">Sistema Operacional</span>
        <button class="rounded-md p-2 text-muted hover:bg-black/[0.04]" onClick=${() => setOpen(true)}>☰</button>
      </div>
      ${open && html`
        <div class="fixed inset-0 z-40 lg:hidden">
          <div class="absolute inset-0 bg-ink/30" onClick=${() => setOpen(false)}></div>
          <div class="absolute left-0 top-0 h-full w-72 bg-sidebar shadow-xl">${sidebar}</div>
        </div>`}

      <main class="min-w-0 flex-1">
        <div class="mx-auto max-w-5xl px-4 py-7 sm:px-6 lg:px-10 lg:py-10">
          ${children}
        </div>
      </main>
    </div>`;
}

/* ============================ Pages ============================ */

function Dashboard({ me, sections }) {
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState(null);
  const [results, setResults] = useState(null);
  const counts = useRef({});
  const [countsReady, setCountsReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const docs = await fetchDocs({});
        setRecent(docs.slice(0, 8));
        const c = {};
        for (const d of docs) c[d.section.id] = (c[d.section.id] || 0) + 1;
        counts.current = c;
        setCountsReady(true);
      } catch (e) { notify(errMsg(e), "err"); setRecent([]); }
    })();
  }, []);

  useEffect(() => {
    if (!search.trim()) { setResults(null); return; }
    const t = setTimeout(async () => {
      try { setResults(await fetchDocs({ search })); }
      catch (e) { notify(errMsg(e), "err"); }
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  return html`
    <div>
      <h1 class="text-2xl font-semibold text-ink">Base de Conhecimento</h1>
      <p class="mt-1 max-w-2xl text-sm text-muted">
        Tudo sobre a empresa, a metodologia, o produto, a cliente e os resultados — para que todas as áreas
        conheçam bem o que fazemos e como pensamos.
      </p>

      <div class="mt-5">
        <input class=${cx(inputCls, "max-w-lg")} placeholder="Buscar documentos por título ou descrição…"
          value=${search} onInput=${(e) => setSearch(e.target.value)} />
      </div>

      ${results !== null
        ? html`
          <div class="mt-6">
            <div class="mb-2 text-sm font-medium text-muted">${results.length} resultado(s) para “${search.trim()}”</div>
            <${DocTable} docs=${results} />
          </div>`
        : html`
          <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            ${sections.map((s) => html`
              <a href=${"#/secao/" + s.slug} class="group rounded-xl border border-line bg-white p-4 transition hover:border-brand/40 hover:shadow-sm">
                <div class="flex items-center gap-2 text-lg">${s.icone || "📄"}<span class="text-base font-semibold text-ink">${s.nome}</span></div>
                <p class="mt-1.5 line-clamp-3 text-sm text-muted">${s.descricao}</p>
                <div class="mt-3 text-xs text-muted">
                  ${countsReady ? (counts.current[s.id] || 0) + " documento(s)" : "…"}
                </div>
              </a>`)}
          </div>

          <div class="mt-10">
            <h2 class="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Atualizados recentemente</h2>
            ${recent === null
              ? html`<div class="text-sm text-muted"><span class="spinner mr-2"></span>Carregando…</div>`
              : recent.length === 0
              ? html`<${Empty} title="Nenhum documento ainda" icon="📭">${me.role !== "leitor" ? "Abra uma seção e clique em “Novo documento”." : "Peça a um editor para publicar os primeiros materiais."}<//>`
              : html`<${DocTable} docs=${recent} showSection />`}
          </div>`}
    </div>`;
}

function SectionPage({ slug, me, sections, onSectionsChanged }) {
  const section = sections.find((s) => s.slug === slug);
  const [docs, setDocs] = useState(null);
  const [kindFilter, setKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!section) return;
    try { setDocs(await fetchDocs({ sectionId: section.id })); }
    catch (e) { notify(errMsg(e), "err"); setDocs([]); }
  }, [section && section.id]);

  useEffect(() => { setDocs(null); load(); }, [load]);

  if (!section) return html`<${Empty} title="Seção não encontrada" icon="❓"><a class="text-brand" href="#/">Voltar ao início</a><//>`;

  const allTags = useMemo(() => {
    const set = new Set();
    (docs || []).forEach((d) => (d.tags || []).forEach((t) => set.add(t)));
    return [...set].sort();
  }, [docs]);

  const filtered = (docs || []).filter(
    (d) =>
      (!kindFilter || d.kind === kindFilter) &&
      (!statusFilter || d.status === statusFilter) &&
      (!tagFilter || (d.tags || []).includes(tagFilter))
  );

  const canEdit = me.role !== "leitor";

  return html`
    <div>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2 text-sm text-muted"><a href="#/" class="hover:text-ink/75">Base de Conhecimento</a> / <span>${section.nome}</span></div>
          <h1 class="mt-1 flex items-center gap-2 text-2xl font-semibold text-ink">${section.icone || "📄"} ${section.nome}</h1>
        </div>
        <div class="flex gap-2">
          ${canEdit && html`<${Btn} variant="ghost" onClick=${() => setEditing(true)}>Editar descrição<//>`}
          ${canEdit && html`<${Btn} as="a" href=${"#/novo?secao=" + section.slug}>+ Novo documento<//>`}
        </div>
      </div>

      <p class="rich mt-3 max-w-3xl text-sm text-ink/75">${section.descricao || "—"}</p>

      <div class="mt-6 flex flex-wrap gap-2">
        <select class=${cx(inputCls, "w-auto")} value=${kindFilter} onChange=${(e) => setKindFilter(e.target.value)}>
          <option value="">Todos os tipos</option>
          ${KINDS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
        </select>
        <select class=${cx(inputCls, "w-auto")} value=${statusFilter} onChange=${(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos os status</option>
          ${STATUSES.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
        </select>
        ${allTags.length > 0 && html`
          <select class=${cx(inputCls, "w-auto")} value=${tagFilter} onChange=${(e) => setTagFilter(e.target.value)}>
            <option value="">Todas as tags</option>
            ${allTags.map((t) => html`<option value=${t}>${t}</option>`)}
          </select>`}
      </div>

      <div class="mt-4">
        ${docs === null
          ? html`<div class="text-sm text-muted"><span class="spinner mr-2"></span>Carregando…</div>`
          : filtered.length === 0
          ? html`<${Empty} title="Nenhum documento" icon="🗂️">${canEdit ? "Clique em “Novo documento” para adicionar o primeiro material desta seção." : "Ainda não há documentos publicados aqui."}<//>`
          : html`<${DocTable} docs=${filtered} />`}
      </div>

      ${editing && html`<${SectionEditModal} section=${section} onClose=${() => setEditing(false)}
        onSaved=${async () => { setEditing(false); await onSectionsChanged(); }} />`}
    </div>`;
}

function SectionEditModal({ section, onClose, onSaved }) {
  const [descricao, setDescricao] = useState(section.descricao || "");
  const [nome, setNome] = useState(section.nome);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const { error } = await sb.from("kb_sections").update({ nome: nome.trim(), descricao }).eq("id", section.id);
      if (error) throw error;
      notify("Seção atualizada.", "ok");
      await onSaved();
    } catch (e) { notify(errMsg(e), "err"); }
    finally { setBusy(false); }
  }
  return html`
    <${Modal} title=${"Editar — " + section.nome} onClose=${onClose} wide>
      <div class="space-y-4">
        <${Field} label="Nome da seção"><input class=${inputCls} value=${nome} onInput=${(e) => setNome(e.target.value)} /><//>
        <${Field} label="Descrição" hint="Aparece no topo da seção e nos cards do início.">
          <textarea class=${cx(inputCls, "min-h-[160px]")} value=${descricao} onInput=${(e) => setDescricao(e.target.value)}></textarea>
        <//>
        <div class="flex justify-end gap-2"><${Btn} variant="subtle" onClick=${onClose}>Cancelar<//><${Btn} loading=${busy} onClick=${save}>Salvar<//></div>
      </div>
    <//>`;
}

function DocTable({ docs, showSection }) {
  if (!docs.length) return null;
  return html`
    <div class="overflow-x-auto rounded-xl border border-line bg-white">
      <table class="w-full min-w-[640px] text-left text-sm">
        <thead class="border-b border-line text-xs uppercase tracking-wide text-muted">
          <tr>
            <th class="px-4 py-3 font-medium">Documento</th>
            ${showSection ? html`<th class="px-4 py-3 font-medium">Seção</th>` : null}
            <th class="px-4 py-3 font-medium">Tipo</th>
            <th class="px-4 py-3 font-medium">Responsável</th>
            <th class="px-4 py-3 font-medium">Atualizado</th>
            <th class="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          ${docs.map((d) => html`
            <tr key=${d.id} class="cursor-pointer hover:bg-black/[0.04]" onClick=${() => go("/doc/" + d.id)}>
              <td class="px-4 py-3">
                <div class="font-medium text-ink">${d.titulo}</div>
                ${d.tags && d.tags.length
                  ? html`<div class="mt-1 flex flex-wrap gap-1">${d.tags.map((t) => html`<${Badge} class="bg-black/[0.05] text-muted">${t}<//>`)}</div>`
                  : null}
              </td>
              ${showSection ? html`<td class="px-4 py-3 text-muted">${d.section.icone} ${d.section.nome}</td>` : null}
              <td class="px-4 py-3 text-muted">${KIND_ICON[d.kind]} ${KIND_LABEL[d.kind]}</td>
              <td class="px-4 py-3 text-muted">${d.responsavel ? (d.responsavel.nome || d.responsavel.email) : "—"}</td>
              <td class="px-4 py-3 text-muted">${fmtDate(d.updated_at)}</td>
              <td class="px-4 py-3"><${Badge} class=${STATUS_STYLE[d.status]}>${STATUSES.find((s) => s[0] === d.status)[1]}<//></td>
            </tr>`)}
        </tbody>
      </table>
    </div>`;
}

function sanitizeHtml(dirty) {
  const tpl = document.createElement("template");
  tpl.innerHTML = dirty;
  tpl.content.querySelectorAll("script,style,iframe,object,embed,link,meta,form").forEach((n) => n.remove());
  tpl.content.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((a) => {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) el.removeAttribute(a.name);
      if ((n === "href" || n === "src") && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    });
    if (el.tagName === "A") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener nofollow"); }
  });
  return tpl.innerHTML;
}

function Markdown({ text }) {
  const htmlStr = useMemo(() => {
    try { return sanitizeHtml(marked.parse(text || "")); }
    catch (_) { return "<pre>" + (text || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])) + "</pre>"; }
  }, [text]);
  return html`<div class="prose-doc rounded-xl border border-line bg-white p-5" dangerouslySetInnerHTML=${{ __html: htmlStr }}></div>`;
}

function FilePreview({ version }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setUrl(null); setErr(null);
    if (version && version.storage_path) {
      signedUrl(version.storage_path).then(setUrl).catch((e) => setErr(errMsg(e)));
    }
  }, [version && version.id]);

  if (!version) return html`<${Empty} title="Sem conteúdo nesta versão" icon="📄" />`;

  if (version.conteudo_md != null) {
    return html`
      <div>
        <${Markdown} text=${version.conteudo_md} />
        <${Btn} variant="ghost" as="a" class="mt-3"
          href=${"data:text/markdown;charset=utf-8," + encodeURIComponent(version.conteudo_md)}
          target="_blank" rel="noopener" download=${(version.file_name || "documento") + ".md"}>
          ⬇️ Baixar .md
        <//>
      </div>`;
  }

  if (version.external_url) {
    const emb = embedUrl(version.external_url);
    return html`
      <div>
        ${emb
          ? html`<div class="aspect-video w-full overflow-hidden rounded-xl border border-line">
              <iframe src=${emb} class="h-full w-full" allow="fullscreen; picture-in-picture" allowfullscreen></iframe>
            </div>`
          : null}
        <${Btn} variant="ghost" as="a" href=${version.external_url} target="_blank" rel="noopener" class="mt-3">
          🔗 Abrir link externo
        <//>
      </div>`;
  }

  if (err) return html`<div class="text-sm text-red-600">Não foi possível carregar o arquivo: ${err}</div>`;
  if (!url) return html`<div class="text-sm text-muted"><span class="spinner mr-2"></span>Preparando arquivo…</div>`;

  const mime = version.mime_type || "";
  let preview = null;
  if (mime.startsWith("image/")) preview = html`<img src=${url} class="max-h-[70vh] rounded-xl border border-line" />`;
  else if (mime === "application/pdf") preview = html`<iframe src=${url} class="h-[75vh] w-full rounded-xl border border-line"></iframe>`;
  else if (mime.startsWith("audio/")) preview = html`<audio src=${url} controls class="w-full"></audio>`;
  else if (mime.startsWith("video/")) preview = html`<video src=${url} controls class="max-h-[70vh] w-full rounded-xl border border-line"></video>`;

  return html`
    <div>
      ${preview}
      <${Btn} variant="ghost" as="a" href=${url} target="_blank" rel="noopener" download=${version.file_name || ""} class=${preview ? "mt-3" : ""}>
        ⬇️ Baixar ${version.file_name || "arquivo"} ${version.file_size ? html`<span class="text-muted">(${fmtSize(version.file_size)})</span>` : null}
      <//>
    </div>`;
}

function DocDetail({ id, me, sections }) {
  const [doc, setDoc] = useState(null);
  const [versions, setVersions] = useState([]);
  const [activity, setActivity] = useState([]);
  const [notFound, setNotFound] = useState(false);
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [selVersion, setSelVersion] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await fetchDoc(id);
      setDoc(d);
      const v = await fetchVersions(id);
      setVersions(v);
      setSelVersion(d.current ? d.current.id : v[0] && v[0].id);
      if (me.role !== "leitor") setActivity(await fetchActivity(id));
    } catch (e) {
      if (e && e.code === "PGRST116") setNotFound(true);
      else notify(errMsg(e), "err");
    }
  }, [id]);

  useEffect(() => { setDoc(null); setNotFound(false); load(); }, [load]);

  if (notFound) return html`<${Empty} title="Documento não encontrado" icon="🔍"><a class="text-brand" href="#/">Voltar ao início</a><//>`;
  if (!doc) return html`<div class="text-sm text-muted"><span class="spinner mr-2"></span>Carregando…</div>`;

  const canEdit = me.role !== "leitor";
  const canDelete = me.role === "admin";
  const shown = versions.find((v) => v.id === selVersion) || doc.current || versions[0];

  async function removeDoc() {
    if (!confirm("Excluir este documento e todas as suas versões? Esta ação não pode ser desfeita.")) return;
    try {
      // limpa arquivos do storage
      const paths = versions.filter((v) => v.storage_path).map((v) => v.storage_path);
      if (paths.length) await sb.storage.from("kb-documents").remove(paths);
      const { error } = await sb.from("kb_documents").delete().eq("id", doc.id);
      if (error) throw error;
      notify("Documento excluído.", "ok");
      go("/secao/" + doc.section.slug);
    } catch (e) { notify(errMsg(e), "err"); }
  }

  return html`
    <div>
      <div class="flex items-center gap-2 text-sm text-muted">
        <a href="#/" class="hover:text-ink/75">Base de Conhecimento</a> /
        <a href=${"#/secao/" + doc.section.slug} class="hover:text-ink/75">${doc.section.nome}</a>
      </div>

      <div class="mt-2 flex flex-wrap items-start justify-between gap-3">
        <h1 class="text-2xl font-semibold text-ink">${doc.titulo}</h1>
        <div class="flex flex-wrap gap-2">
          ${canEdit && html`<${Btn} variant="ghost" onClick=${() => setShowEdit(true)}>Editar<//>`}
          ${canEdit && html`<${Btn} onClick=${() => setShowNewVersion(true)}>+ Nova versão<//>`}
          ${canDelete && html`<${Btn} variant="danger" onClick=${removeDoc}>Excluir<//>`}
        </div>
      </div>

      <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <${Badge} class=${STATUS_STYLE[doc.status]}>${STATUSES.find((s) => s[0] === doc.status)[1]}<//>
        ${doc.origem === "skill-sync" && html`<${Badge} class="bg-indigo-100 text-indigo-700">🔄 sincronizada</${Badge}>`}
        <span>${KIND_ICON[doc.kind]} ${KIND_LABEL[doc.kind]}</span>
        <span>·</span><span>Responsável: ${doc.responsavel ? (doc.responsavel.nome || doc.responsavel.email) : "—"}</span>
        <span>·</span><span>Atualizado ${fmtDate(doc.updated_at, true)}</span>
      </div>

      ${doc.descricao ? html`<p class="rich mt-4 max-w-3xl text-sm text-ink/75">${doc.descricao}</p>` : null}
      ${doc.tags && doc.tags.length
        ? html`<div class="mt-3 flex flex-wrap gap-1">${doc.tags.map((t) => html`<${Badge} class="bg-black/[0.05] text-muted">${t}<//>`)}</div>`
        : null}

      <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div class="min-w-0">
          <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
            ${shown && shown.id === (doc.current && doc.current.id) ? "Versão atual" : "Versão " + (shown ? shown.versao : "")}
          </h2>
          <${FilePreview} version=${shown} />
        </div>

        <div class="min-w-0">
          <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Histórico de versões</h2>
          <ul class="space-y-1.5">
            ${versions.map((v) => html`
              <li key=${v.id}>
                <button
                  class=${cx("w-full rounded-lg border px-3 py-2 text-left text-sm transition",
                    v.id === selVersion ? "border-brand/40 bg-brand-light" : "border-line bg-white hover:bg-black/[0.04]")}
                  onClick=${() => setSelVersion(v.id)}
                >
                  <div class="flex items-center justify-between">
                    <span class="font-medium text-ink">v${v.versao}${doc.current && doc.current.id === v.id ? " · atual" : ""}</span>
                    <span class="text-xs text-muted">${fmtDate(v.uploaded_at)}</span>
                  </div>
                  <div class="truncate text-xs text-muted">${v.external_url ? "🔗 " + (v.file_name || v.external_url) : v.conteudo_md != null ? "📝 " + (v.file_name || "texto") : (v.file_name || "arquivo")}</div>
                  ${v.changelog ? html`<div class="mt-0.5 text-xs text-muted">${v.changelog}</div>` : null}
                </button>
              </li>`)}
          </ul>
        </div>
      </div>

      ${me.role !== "leitor" && activity.length > 0 && html`
        <div class="mt-10">
          <h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Atividade</h2>
          <ul class="space-y-1 text-sm text-muted">
            ${activity.map((a) => html`<li key=${a.id}>
              <span class="text-ink">${a.autor ? (a.autor.nome || a.autor.email) : "alguém"}</span>
              ${" "}${a.action.replace("_", " ")} · <span class="text-muted">${fmtDate(a.created_at, true)}</span>
            </li>`)}
          </ul>
        </div>`}

      ${showNewVersion && html`<${NewVersionModal} doc=${doc} versions=${versions} me=${me}
        onClose=${() => setShowNewVersion(false)}
        onSaved=${async () => { setShowNewVersion(false); await load(); notify("Nova versão publicada.", "ok"); }} />`}

      ${showEdit && html`<${DocEditModal} doc=${doc} sections=${sections} me=${me}
        onClose=${() => setShowEdit(false)}
        onSaved=${async () => { setShowEdit(false); await load(); notify("Documento atualizado.", "ok"); }} />`}
    </div>`;
}

function SourceInput({ value, onChange }) {
  // value: { mode: 'file'|'link'|'texto', file, external_url, conteudo_md, link_label }
  const v = value;
  const tab = (m, label) => html`
    <button type="button" onClick=${() => onChange({ ...v, mode: m })}
      class=${cx("rounded-lg px-3 py-1.5", v.mode === m ? "bg-brand text-white" : "bg-black/[0.05] text-ink/75")}>${label}</button>`;
  return html`
    <div class="space-y-3">
      <div class="flex flex-wrap gap-2 text-sm">
        ${tab("file", "Enviar arquivo")} ${tab("link", "Usar link")} ${tab("texto", "Escrever texto")}
      </div>
      ${v.mode === "file"
        ? html`
          <div>
            <input type="file" class="block w-full text-sm text-ink/75 file:mr-3 file:rounded-lg file:border-0 file:bg-black/[0.05] file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-line"
              onChange=${(e) => onChange({ ...v, file: e.target.files[0] || null })} />
            <p class="mt-1 text-xs text-muted">PDF, DOCX, TXT, imagem, áudio ou vídeo — até 50 MB. Para vídeos/áudios grandes, use um link (YouTube não listado, Loom, Drive).</p>
            ${v.file && v.file.size > MAX_UPLOAD ? html`<p class="mt-1 text-xs text-red-600">Arquivo acima de 50 MB. Use um link.</p>` : null}
          </div>`
        : v.mode === "link"
        ? html`
          <div class="space-y-2">
            <input class=${inputCls} placeholder="https://…" value=${v.external_url || ""}
              onInput=${(e) => onChange({ ...v, external_url: e.target.value })} />
            <input class=${inputCls} placeholder="Rótulo do link (opcional, ex.: “Aula 3 — YouTube”)" value=${v.link_label || ""}
              onInput=${(e) => onChange({ ...v, link_label: e.target.value })} />
          </div>`
        : html`
          <div class="space-y-2">
            <textarea class=${cx(inputCls, "min-h-[220px] font-mono text-xs")} placeholder="Escreva em Markdown…"
              value=${v.conteudo_md || ""} onInput=${(e) => onChange({ ...v, conteudo_md: e.target.value })}></textarea>
            <p class="text-xs text-muted">Aceita Markdown (títulos, listas, tabelas, links, código). É renderizado formatado na página do documento.</p>
          </div>`}
    </div>`;
}

function sourceFromInput(v) {
  if (v.mode === "file") {
    if (!v.file) throw new Error("Selecione um arquivo.");
    if (v.file.size > MAX_UPLOAD) throw new Error("Arquivo acima de 50 MB. Use um link.");
    return { file: v.file };
  }
  if (v.mode === "texto") {
    if (!v.conteudo_md || !v.conteudo_md.trim()) throw new Error("Escreva o texto do documento.");
    return { conteudo_md: v.conteudo_md };
  }
  if (!v.external_url || !/^https?:\/\//i.test(v.external_url.trim())) throw new Error("Informe um link válido (http/https).");
  return { external_url: v.external_url, link_label: v.link_label };
}

function NewVersionModal({ doc, versions, me, onClose, onSaved }) {
  const [src, setSrc] = useState({ mode: "file" });
  const [changelog, setChangelog] = useState("");
  const [busy, setBusy] = useState(false);
  const nextV = (versions.reduce((m, v) => Math.max(m, v.versao), 0) || 0) + 1;

  async function save() {
    setBusy(true);
    try {
      const source = sourceFromInput(src);
      await insertVersion({ docId: doc.id, sectionSlug: doc.section.slug, versao: nextV, source, meId: me.id, changelog });
      await logActivity(doc.id, me.id, "nova_versao", { versao: nextV });
      await onSaved();
    } catch (e) { notify(errMsg(e), "err"); }
    finally { setBusy(false); }
  }

  return html`
    <${Modal} title=${"Nova versão (v" + nextV + ")"} onClose=${onClose} wide>
      <div class="space-y-4">
        <${SourceInput} value=${src} onChange=${setSrc} />
        <${Field} label="O que mudou?" hint="Aparece no histórico de versões.">
          <input class=${inputCls} value=${changelog} onInput=${(e) => setChangelog(e.target.value)} placeholder="Ex.: Atualizado com dados de agosto/2026" />
        <//>
        <div class="flex justify-end gap-2"><${Btn} variant="subtle" onClick=${onClose}>Cancelar<//><${Btn} loading=${busy} onClick=${save}>Publicar versão<//></div>
      </div>
    <//>`;
}

function DocEditModal({ doc, sections, me, onClose, onSaved }) {
  const [f, setF] = useState({
    titulo: doc.titulo,
    descricao: doc.descricao || "",
    section_id: doc.section.id,
    kind: doc.kind,
    status: doc.status,
    tags: (doc.tags || []).join(", "),
    responsavel_id: doc.responsavel ? doc.responsavel.id : "",
  });
  const [profiles, setProfiles] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchProfiles().then(setProfiles).catch(() => {}); }, []);

  async function save() {
    setBusy(true);
    try {
      await updateDocumentMeta(doc.id, {
        titulo: f.titulo.trim(),
        descricao: f.descricao.trim(),
        section_id: f.section_id,
        kind: f.kind,
        status: f.status,
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
        responsavel_id: f.responsavel_id || null,
      });
      await logActivity(doc.id, me.id, "editou", {});
      await onSaved();
    } catch (e) { notify(errMsg(e), "err"); }
    finally { setBusy(false); }
  }

  return html`
    <${Modal} title="Editar documento" onClose=${onClose} wide>
      <${DocFields} f=${f} setF=${setF} sections=${sections} profiles=${profiles} />
      <div class="mt-4 flex justify-end gap-2"><${Btn} variant="subtle" onClick=${onClose}>Cancelar<//><${Btn} loading=${busy} onClick=${save}>Salvar<//></div>
    <//>`;
}

function DocFields({ f, setF, sections, profiles }) {
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return html`
    <div class="space-y-4">
      <${Field} label="Título" required><input class=${inputCls} value=${f.titulo} onInput=${set("titulo")} /><//>
      <div class="grid gap-4 sm:grid-cols-2">
        <${Field} label="Seção" required>
          <select class=${inputCls} value=${f.section_id} onChange=${set("section_id")}>
            ${sections.map((s) => html`<option value=${s.id}>${s.nome}</option>`)}
          </select>
        <//>
        <${Field} label="Tipo">
          <select class=${inputCls} value=${f.kind} onChange=${set("kind")}>
            ${KINDS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
          </select>
        <//>
        <${Field} label="Status">
          <select class=${inputCls} value=${f.status} onChange=${set("status")}>
            ${STATUSES.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
          </select>
        <//>
        <${Field} label="Responsável">
          <select class=${inputCls} value=${f.responsavel_id} onChange=${set("responsavel_id")}>
            <option value="">—</option>
            ${profiles.map((p) => html`<option value=${p.id}>${p.nome || p.email}</option>`)}
          </select>
        <//>
      </div>
      <${Field} label="Descrição"><textarea class=${cx(inputCls, "min-h-[120px]")} value=${f.descricao} onInput=${set("descricao")}></textarea><//>
      <${Field} label="Tags" hint="Separe por vírgula. Ex.: metodologia, onboarding, vendas">
        <input class=${inputCls} value=${f.tags} onInput=${set("tags")} />
      <//>
    </div>`;
}

function NewDocPage({ me, sections, query }) {
  const [f, setF] = useState({
    titulo: "",
    descricao: "",
    section_id: (sections.find((s) => s.slug === query.secao) || sections[0] || {}).id || "",
    kind: "documento",
    status: "publicado",
    tags: "",
    responsavel_id: "",
  });
  const [src, setSrc] = useState({ mode: "file" });
  const [profiles, setProfiles] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchProfiles().then(setProfiles).catch(() => {}); }, []);

  if (me.role === "leitor")
    return html`<${Empty} title="Sem permissão" icon="🔒">Apenas editores e admins podem criar documentos.<//>`;

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (!f.titulo.trim()) throw new Error("Informe o título.");
      const source = sourceFromInput(src);
      const id = await createDocument(
        {
          ...f,
          tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
          source,
        },
        me
      );
      notify("Documento criado.", "ok");
      go("/doc/" + id);
    } catch (e2) { notify(errMsg(e2), "err"); }
    finally { setBusy(false); }
  }

  return html`
    <form onSubmit=${save}>
      <h1 class="text-2xl font-semibold text-ink">Novo documento</h1>
      <div class="mt-5 max-w-2xl space-y-5">
        <${DocFields} f=${f} setF=${setF} sections=${sections} profiles=${profiles} />
        <div>
          <span class="mb-1 block text-sm font-medium text-ink">Arquivo, link ou texto <span class="text-brand">*</span></span>
          <${SourceInput} value=${src} onChange=${setSrc} />
        </div>
        <div class="flex gap-2">
          <${Btn} type="submit" loading=${busy}>Criar documento<//>
          <${Btn} variant="subtle" as="a" href=${"#/secao/" + (sections.find((s) => s.id === f.section_id) || {}).slug}>Cancelar<//>
        </div>
      </div>
    </form>`;
}

function ProfilePage({ me, onProfileChanged }) {
  const [nome, setNome] = useState(me.nome || "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyPw, setBusyPw] = useState(false);

  async function saveName() {
    setBusy(true);
    try {
      const { error } = await sb.from("profiles").update({ nome: nome.trim() || null }).eq("id", me.id);
      if (error) throw error;
      notify("Nome atualizado.", "ok");
      await onProfileChanged();
    } catch (e) { notify(errMsg(e), "err"); }
    finally { setBusy(false); }
  }
  async function savePw() {
    if (pw.length < 8) return notify("A senha precisa ter ao menos 8 caracteres.", "err");
    if (pw !== pw2) return notify("As senhas não conferem.", "err");
    setBusyPw(true);
    try {
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw error;
      setPw(""); setPw2("");
      notify("Senha alterada.", "ok");
    } catch (e) { notify(errMsg(e), "err"); }
    finally { setBusyPw(false); }
  }

  return html`
    <div class="max-w-lg">
      <h1 class="text-2xl font-semibold text-ink">Meu perfil</h1>
      <div class="mt-6 space-y-6">
        <div class="rounded-xl border border-line bg-white p-5">
          <div class="text-sm text-muted">E-mail</div>
          <div class="font-medium text-ink">${me.email}</div>
          <div class="mt-1 text-xs text-muted">Papel: ${ROLE_LABEL[me.role]}</div>
        </div>
        <div class="rounded-xl border border-line bg-white p-5">
          <${Field} label="Nome"><input class=${inputCls} value=${nome} onInput=${(e) => setNome(e.target.value)} /><//>
          <div class="mt-3"><${Btn} loading=${busy} onClick=${saveName}>Salvar nome<//></div>
        </div>
        <div class="rounded-xl border border-line bg-white p-5">
          <h2 class="mb-3 font-medium text-ink">Trocar senha</h2>
          <div class="space-y-3">
            <${Field} label="Nova senha"><input class=${inputCls} type="password" value=${pw} onInput=${(e) => setPw(e.target.value)} /><//>
            <${Field} label="Repita a nova senha"><input class=${inputCls} type="password" value=${pw2} onInput=${(e) => setPw2(e.target.value)} /><//>
            <${Btn} loading=${busyPw} onClick=${savePw}>Alterar senha<//>
          </div>
        </div>
      </div>
    </div>`;
}

function AdminPage({ me }) {
  const [users, setUsers] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [tempResult, setTempResult] = useState(null);

  const load = useCallback(async () => {
    try { const r = await adminCall({ action: "list" }); setUsers(r.users || []); }
    catch (e) { notify(errMsg(e), "err"); setUsers([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setRole(u, role) {
    try { await adminCall({ action: "setRole", userId: u.id, role }); notify("Papel atualizado.", "ok"); await load(); }
    catch (e) { notify(errMsg(e), "err"); }
  }
  async function resetPw(u) {
    if (!confirm(`Gerar nova senha temporária para ${u.email}?`)) return;
    try { const r = await adminCall({ action: "resetPassword", userId: u.id }); setTempResult({ email: u.email, senha: r.senhaTemporaria }); }
    catch (e) { notify(errMsg(e), "err"); }
  }
  async function removeUser(u) {
    if (!confirm(`Excluir ${u.email}? Perde o acesso imediatamente.`)) return;
    try { await adminCall({ action: "delete", userId: u.id }); notify("Usuário excluído.", "ok"); await load(); }
    catch (e) { notify(errMsg(e), "err"); }
  }

  return html`
    <div>
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-semibold text-ink">Administração</h1>
        <${Btn} onClick=${() => setShowCreate(true)}>+ Novo usuário<//>
      </div>
      <p class="mt-1 text-sm text-muted">Crie contas, defina papéis e gere senhas temporárias. Não é necessário e-mail de confirmação.</p>

      <div class="mt-6 overflow-x-auto rounded-xl border border-line bg-white">
        ${users === null
          ? html`<div class="p-6 text-sm text-muted"><span class="spinner mr-2"></span>Carregando…</div>`
          : html`
          <table class="w-full min-w-[640px] text-left text-sm">
            <thead class="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr><th class="px-4 py-3 font-medium">Pessoa</th><th class="px-4 py-3 font-medium">Papel</th><th class="px-4 py-3 font-medium">Desde</th><th class="px-4 py-3"></th></tr>
            </thead>
            <tbody class="divide-y divide-line">
              ${users.map((u) => html`
                <tr key=${u.id}>
                  <td class="px-4 py-3"><div class="font-medium text-ink">${u.nome || "—"}</div><div class="text-xs text-muted">${u.email}</div></td>
                  <td class="px-4 py-3">
                    <select class=${cx(inputCls, "w-auto py-1")} value=${u.role} disabled=${u.id === me.id}
                      onChange=${(e) => setRole(u, e.target.value)}>
                      <option value="leitor">Leitor</option><option value="editor">Editor</option><option value="admin">Admin</option>
                    </select>
                  </td>
                  <td class="px-4 py-3 text-muted">${fmtDate(u.created_at)}</td>
                  <td class="px-4 py-3 text-right">
                    <div class="flex justify-end gap-2">
                      <button class="text-xs text-muted hover:text-ink" onClick=${() => resetPw(u)}>Nova senha</button>
                      ${u.id !== me.id ? html`<button class="text-xs text-red-500 hover:text-red-700" onClick=${() => removeUser(u)}>Excluir</button>` : null}
                    </div>
                  </td>
                </tr>`)}
            </tbody>
          </table>`}
      </div>

      ${showCreate && html`<${CreateUserModal} onClose=${() => setShowCreate(false)}
        onCreated=${async (res) => { setShowCreate(false); setTempResult(res); await load(); }} />`}

      ${tempResult && html`
        <${Modal} title="Senha temporária" onClose=${() => setTempResult(null)}>
          <p class="text-sm text-ink/75">Envie estes dados para <b>${tempResult.email}</b> por um canal seguro. Peça para trocar a senha em “Meu perfil” no primeiro acesso.</p>
          <div class="mt-3 rounded-lg bg-black/[0.03] p-3 font-mono text-sm">
            <div>E-mail: ${tempResult.email}</div>
            <div>Senha: <b>${tempResult.senha}</b></div>
          </div>
          <div class="mt-4 flex justify-end"><${Btn} onClick=${() => { navigator.clipboard && navigator.clipboard.writeText(`E-mail: ${tempResult.email}\nSenha: ${tempResult.senha}`); notify("Copiado.", "ok"); }}>Copiar<//></div>
        <//>`}
    </div>`;
}

function CreateUserModal({ onClose, onCreated }) {
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [role, setRole] = useState("leitor");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await adminCall({ action: "create", email, nome, role });
      notify("Usuário criado.", "ok");
      onCreated({ email: r.email, senha: r.senhaTemporaria });
    } catch (e) { notify(errMsg(e), "err"); }
    finally { setBusy(false); }
  }
  return html`
    <${Modal} title="Novo usuário" onClose=${onClose}>
      <div class="space-y-4">
        <${Field} label="E-mail" required><input class=${inputCls} type="email" value=${email} onInput=${(e) => setEmail(e.target.value)} /><//>
        <${Field} label="Nome"><input class=${inputCls} value=${nome} onInput=${(e) => setNome(e.target.value)} /><//>
        <${Field} label="Papel">
          <select class=${inputCls} value=${role} onChange=${(e) => setRole(e.target.value)}>
            <option value="leitor">Leitor — só consulta</option>
            <option value="editor">Editor — cria e edita documentos</option>
            <option value="admin">Admin — tudo, inclui gestão de usuários</option>
          </select>
        <//>
        <div class="flex justify-end gap-2"><${Btn} variant="subtle" onClick=${onClose}>Cancelar<//><${Btn} loading=${busy} onClick=${save}>Criar<//></div>
      </div>
    <//>`;
}

/* ============================ Ferramentas ============================ */

function statusDaFerramenta(f) {
  // Para 'auto' usa o último resultado da checagem; para 'manual' usa o status marcado.
  if (f._checando) return "checando";
  if (f.check_type === "auto") return f.ultimo_status || "desconectada";
  return f.status_manual;
}

function StatusBadge({ status }) {
  if (status === "checando")
    return html`<${Badge} class="bg-black/[0.05] text-muted"><span class="spinner mr-1" style="width:12px;height:12px"></span>checando<//>`;
  const s = FERRAMENTA_STATUS[status] || FERRAMENTA_STATUS.desconectada;
  return html`<${Badge} class=${s.cls}><span class=${cx("mr-1.5 inline-block h-1.5 w-1.5 rounded-full", s.dot)}></span>${s.label}<//>`;
}

function FerramentasPage({ me }) {
  const [tools, setTools] = useState(null);
  const [catFilter, setCatFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [checking, setChecking] = useState(false);
  const [editing, setEditing] = useState(null); // ferramenta ou {novo:true}
  const canEdit = me.role !== "leitor";

  const load = useCallback(async () => {
    try { setTools(await fetchFerramentas()); }
    catch (e) { notify(errMsg(e), "err"); setTools([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const runChecks = useCallback(async (list) => {
    const autos = (list || []).filter((f) => f.check_type === "auto" && f.check_url);
    if (!autos.length) return;
    setChecking(true);
    setTools((cur) => cur.map((f) => autos.find((a) => a.id === f.id) ? { ...f, _checando: true } : f));
    for (const f of autos) {
      const res = await checkFerramenta(f);
      setTools((cur) => cur.map((x) => x.id === f.id
        ? { ...x, _checando: false, ultimo_status: res.status, ultimo_check_at: new Date().toISOString(), ultimo_check_detalhe: res.detalhe }
        : x));
      if (canEdit) { try { await persistFerramentaCheck(f.id, res); } catch (_) { /* segue mesmo sem salvar */ } }
    }
    setChecking(false);
  }, [canEdit]);

  // roda a checagem automática assim que a lista carrega
  useEffect(() => { if (tools && tools.length) runChecks(tools); /* eslint-disable-next-line */ }, [tools === null]);

  if (tools === null)
    return html`<div class="text-sm text-muted"><span class="spinner mr-2"></span>Carregando…</div>`;

  const cats = [...new Set(tools.map((f) => f.categoria))];
  const filtered = tools.filter((f) =>
    (!catFilter || f.categoria === catFilter) &&
    (!statusFilter || statusDaFerramenta(f) === statusFilter));

  const resumo = {};
  tools.forEach((f) => { const s = f.check_type === "auto" ? (f.ultimo_status || "desconectada") : f.status_manual; resumo[s] = (resumo[s] || 0) + 1; });

  return html`
    <div>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="flex items-center gap-2 text-2xl font-semibold text-ink">🧰 Ferramentas</h1>
          <p class="mt-1 max-w-2xl text-sm text-muted">
            Tudo que a OS usa ou que fica conectado à operação, com o status atual e o que cada uma faz aqui.
          </p>
        </div>
        <div class="flex gap-2">
          <${Btn} variant="ghost" loading=${checking} onClick=${() => runChecks(tools)}>↻ Verificar agora<//>
          ${canEdit && html`<${Btn} onClick=${() => setEditing({ novo: true })}>+ Nova ferramenta<//>`}
        </div>
      </div>

      <div class="mt-4 flex flex-wrap gap-2 text-xs">
        ${Object.entries(resumo).map(([s, n]) => html`
          <button class="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 ring-1 ring-line hover:bg-black/[0.04]"
            onClick=${() => setStatusFilter(statusFilter === s ? "" : s)}>
            <span class=${cx("inline-block h-1.5 w-1.5 rounded-full", (FERRAMENTA_STATUS[s] || {}).dot || "bg-[#b3aca0]")}></span>
            ${(FERRAMENTA_STATUS[s] || {}).label || s}: <b>${n}</b>
          </button>`)}
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        <select class=${cx(inputCls, "w-auto")} value=${catFilter} onChange=${(e) => setCatFilter(e.target.value)}>
          <option value="">Todas as categorias</option>
          ${cats.map((c) => html`<option value=${c}>${CAT_LABEL[c] || c}</option>`)}
        </select>
        <select class=${cx(inputCls, "w-auto")} value=${statusFilter} onChange=${(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos os status</option>
          ${Object.keys(FERRAMENTA_STATUS).map((s) => html`<option value=${s}>${FERRAMENTA_STATUS[s].label}</option>`)}
        </select>
      </div>

      <div class="mt-4 space-y-2">
        ${filtered.map((f) => html`
          <div key=${f.id} class="rounded-xl border border-line bg-white p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-medium text-ink">${f.nome}</span>
                  <${StatusBadge} status=${statusDaFerramenta(f)} />
                  <${Badge} class="bg-black/[0.05] text-muted">${CAT_LABEL[f.categoria] || f.categoria}<//>
                  <span class="text-[11px] uppercase tracking-wide text-muted/60">${f.check_type === "auto" ? "auto" : "manual"}</span>
                </div>
                <p class="rich mt-1.5 text-sm text-ink/75">${f.descricao_os || "—"}</p>
                <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  ${f.responsavel ? html`<span>Responsável: ${f.responsavel.nome || f.responsavel.email}</span>` : null}
                  ${f.check_type === "auto" && f.ultimo_check_at
                    ? html`<span>Verificado ${fmtDate(f.ultimo_check_at, true)}${f.ultimo_check_detalhe ? " · " + f.ultimo_check_detalhe : ""}</span>` : null}
                  ${f.check_type === "manual" && f.status_manual_nota ? html`<span>${f.status_manual_nota}</span>` : null}
                  ${f.url ? html`<a href=${f.url} target="_blank" rel="noopener" class="text-brand hover:underline">abrir ↗</a>` : null}
                </div>
              </div>
              ${canEdit && html`<button class="shrink-0 text-xs text-muted hover:text-ink" onClick=${() => setEditing(f)}>editar</button>`}
            </div>
          </div>`)}
        ${filtered.length === 0 ? html`<${Empty} title="Nada com esse filtro" icon="🔍" />` : null}
      </div>

      ${editing && html`<${FerramentaModal} ferramenta=${editing.novo ? null : editing} me=${me}
        onClose=${() => setEditing(null)}
        onSaved=${async () => { setEditing(null); await load(); }} />`}
    </div>`;
}

function FerramentaModal({ ferramenta, me, onClose, onSaved }) {
  const novo = !ferramenta;
  const [f, setF] = useState(ferramenta ? {
    nome: ferramenta.nome, categoria: ferramenta.categoria, descricao_os: ferramenta.descricao_os || "",
    url: ferramenta.url || "", responsavel_id: ferramenta.responsavel ? ferramenta.responsavel.id : "",
    check_type: ferramenta.check_type, check_kind: ferramenta.check_kind || "http_generico",
    check_url: ferramenta.check_url || "", status_manual: ferramenta.status_manual,
    status_manual_nota: ferramenta.status_manual_nota || "",
  } : {
    nome: "", categoria: "outros", descricao_os: "", url: "", responsavel_id: "",
    check_type: "manual", check_kind: "http_generico", check_url: "",
    status_manual: "nao_configurada", status_manual_nota: "",
  });
  const [profiles, setProfiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  useEffect(() => { fetchProfiles().then(setProfiles).catch(() => {}); }, []);

  async function save() {
    setBusy(true);
    try {
      if (!f.nome.trim()) throw new Error("Informe o nome.");
      const row = {
        nome: f.nome.trim(), categoria: f.categoria, descricao_os: f.descricao_os.trim(),
        url: f.url.trim() || null, responsavel_id: f.responsavel_id || null,
        check_type: f.check_type,
        check_kind: f.check_type === "auto" ? f.check_kind : null,
        check_url: f.check_type === "auto" ? (f.check_url.trim() || null) : null,
        status_manual: f.status_manual,
        status_manual_nota: f.status_manual_nota.trim(),
      };
      if (novo) {
        row.slug = f.nome.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Math.random().toString(36).slice(2, 6);
        row.ordem = 100;
        const { error } = await sb.from("os_ferramentas").insert(row);
        if (error) throw error;
      } else {
        const { error } = await sb.from("os_ferramentas").update(row).eq("id", ferramenta.id);
        if (error) throw error;
      }
      notify(novo ? "Ferramenta adicionada." : "Ferramenta atualizada.", "ok");
      await onSaved();
    } catch (e) { notify(errMsg(e), "err"); }
    finally { setBusy(false); }
  }

  async function remover() {
    if (!confirm(`Remover "${ferramenta.nome}" da lista?`)) return;
    setBusy(true);
    try {
      const { error } = await sb.from("os_ferramentas").delete().eq("id", ferramenta.id);
      if (error) throw error;
      notify("Ferramenta removida.", "ok");
      await onSaved();
    } catch (e) { notify(errMsg(e), "err"); }
    finally { setBusy(false); }
  }

  return html`
    <${Modal} title=${novo ? "Nova ferramenta" : "Editar — " + ferramenta.nome} onClose=${onClose} wide>
      <div class="space-y-4">
        <${Field} label="Nome" required><input class=${inputCls} value=${f.nome} onInput=${set("nome")} /><//>
        <div class="grid gap-4 sm:grid-cols-2">
          <${Field} label="Categoria">
            <select class=${inputCls} value=${f.categoria} onChange=${set("categoria")}>
              ${FERRAMENTA_CATEGORIAS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
            </select>
          <//>
          <${Field} label="Responsável">
            <select class=${inputCls} value=${f.responsavel_id} onChange=${set("responsavel_id")}>
              <option value="">—</option>
              ${profiles.map((p) => html`<option value=${p.id}>${p.nome || p.email}</option>`)}
            </select>
          <//>
        </div>
        <${Field} label="O que faz na OS"><textarea class=${cx(inputCls, "min-h-[90px]")} value=${f.descricao_os} onInput=${set("descricao_os")}></textarea><//>
        <${Field} label="Link (dashboard / site)"><input class=${inputCls} placeholder="https://…" value=${f.url} onInput=${set("url")} /><//>

        <${Field} label="Como o status é verificado">
          <select class=${inputCls} value=${f.check_type} onChange=${set("check_type")}>
            <option value="manual">Manual — alguém marca o status</option>
            <option value="auto">Automático — a OS testa o endereço</option>
          </select>
        <//>

        ${f.check_type === "manual" ? html`
          <div class="grid gap-4 sm:grid-cols-2">
            <${Field} label="Status">
              <select class=${inputCls} value=${f.status_manual} onChange=${set("status_manual")}>
                ${Object.keys(FERRAMENTA_STATUS).map((s) => html`<option value=${s}>${FERRAMENTA_STATUS[s].label}</option>`)}
              </select>
            <//>
            <${Field} label="Nota (opcional)"><input class=${inputCls} value=${f.status_manual_nota} onInput=${set("status_manual_nota")} /><//>
          </div>
        ` : html`
          <div class="space-y-3 rounded-lg bg-black/[0.03] p-3">
            <${Field} label="Tipo de checagem" hint="Só endereços que respondem CORS podem ser testados pelo navegador (Supabase, a Edge Function e o site no GitHub Pages).">
              <select class=${inputCls} value=${f.check_kind} onChange=${set("check_kind")}>
                <option value="supabase_rest">Supabase REST</option>
                <option value="edge_function">Edge Function</option>
                <option value="github_pages">GitHub Pages / site</option>
                <option value="http_generico">HTTP genérico (pode não funcionar por CORS)</option>
              </select>
            <//>
            <${Field} label="URL a testar"><input class=${inputCls} placeholder="https://…" value=${f.check_url} onInput=${set("check_url")} /><//>
          </div>
        `}

        <div class="flex items-center justify-between gap-2 pt-1">
          <div>${!novo && me.role === "admin" ? html`<${Btn} variant="danger" onClick=${remover} loading=${busy}>Remover<//>` : null}</div>
          <div class="flex gap-2">
            <${Btn} variant="subtle" onClick=${onClose}>Cancelar<//>
            <${Btn} loading=${busy} onClick=${save}>Salvar<//>
          </div>
        </div>
      </div>
    <//>`;
}

/* ============================ Setores em construção / Pedir a IA ============================ */

function SetorEmConstrucao({ setor }) {
  return html`
    <div>
      <h1 class="flex items-center gap-2 text-2xl font-semibold text-ink">${setor.icone} ${setor.nome}</h1>
      <div class="mt-6 rounded-2xl border border-dashed border-line bg-card/70 px-6 py-14 text-center">
        <div class="text-4xl">🚧</div>
        <div class="mt-3 font-medium text-ink">Setor em construção</div>
        <p class="mx-auto mt-1 max-w-md text-sm text-muted">${setor.wip}</p>
        <p class="mx-auto mt-3 max-w-md text-xs text-muted">
          A estrutura já está no menu. O conteúdo entra nas próximas etapas da OS.
        </p>
      </div>
    </div>`;
}

function PedirIA() {
  return html`
    <div class="max-w-2xl">
      <h1 class="flex items-center gap-2 text-2xl font-semibold text-ink">✨ Pedir a IA</h1>
      <p class="mt-1 text-sm text-muted">
        Um lugar para perguntar em linguagem natural e receber respostas com base no que a empresa já
        documentou (marca, metodologia, avatar, playbooks de venda, YouTube, etc.).
      </p>

      <div class="mt-6 rounded-2xl border border-line bg-card p-5">
        <div class="text-sm font-medium text-ink">Em construção</div>
        <p class="mt-1 text-sm text-muted">
          O chat que responde aqui dentro entra numa próxima etapa (depende de uma chave de IA da empresa).
          Enquanto isso, use o Claude diretamente — todas as skills da empresa já estão carregadas nele.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <${Btn} as="a" href="https://claude.ai" target="_blank" rel="noopener">Abrir o Claude ↗<//>
          <${Btn} variant="ghost" as="a" href="#/">Ver a Base de Conhecimento<//>
        </div>
      </div>

      <div class="mt-4 rounded-2xl border border-line bg-card p-5">
        <div class="text-sm font-medium text-ink">Como pedir bem</div>
        <ul class="mt-2 space-y-1.5 text-sm text-muted">
          <li>• Diga o contexto: para quem é, onde vai ser usado, qual o objetivo.</li>
          <li>• Aponte a fonte: "com base no documento de marca", "seguindo a metodologia".</li>
          <li>• Peça o formato: bullet points, script, e-mail, tabela.</li>
        </ul>
      </div>
    </div>`;
}

/* ============================ Router / App ============================ */

function Router({ route, me, sections, reload }) {
  const [p0, p1] = route.parts;
  if (!p0) return html`<${Dashboard} me=${me} sections=${sections} />`;
  if (p0 === "secao") return html`<${SectionPage} slug=${p1} me=${me} sections=${sections} onSectionsChanged=${reload} />`;
  if (p0 === "doc") return html`<${DocDetail} id=${p1} me=${me} sections=${sections} />`;
  if (p0 === "novo") return html`<${NewDocPage} me=${me} sections=${sections} query=${route.query} />`;
  if (p0 === "ferramentas") return html`<${FerramentasPage} me=${me} />`;
  if (p0 === "pedir-ia") return html`<${PedirIA} />`;
  if (p0 === "perfil") return html`<${ProfilePage} me=${me} onProfileChanged=${reload} />`;
  if (p0 === "admin" && me.role === "admin") return html`<${AdminPage} me=${me} />`;
  const setor = SETORES.find((s) => s.path === route.path && s.wip);
  if (setor) return html`<${SetorEmConstrucao} setor=${setor} />`;
  return html`<${Empty} title="Página não encontrada" icon="🧭"><a class="text-brand" href="#/">Voltar ao início</a><//>`;
}

function App() {
  const [session, setSession] = useState(undefined); // undefined = ainda carregando
  const [me, setMe] = useState(null);
  const [meError, setMeError] = useState(false);
  const [sections, setSections] = useState([]);
  const route = useRoute();

  // onAuthStateChange dispara INITIAL_SESSION ao assinar — não é preciso getSession().
  useEffect(() => {
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => setSession(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Período de testes: entrada liberada. Sem sessão, entra sozinho com a conta compartilhada.
  const openMode = cfg.AUTH_MODE === "open" && cfg.GUEST_EMAIL && cfg.GUEST_PASSWORD;
  useEffect(() => {
    if (!openMode || session !== null) return;
    let done = false;
    setTimeout(async () => {
      if (done) return;
      const { error } = await sb.auth.signInWithPassword({ email: cfg.GUEST_EMAIL, password: cfg.GUEST_PASSWORD });
      if (error) notify("Falha ao abrir a sessão de testes: " + error.message, "err");
    }, 0);
    return () => { done = true; };
  }, [session, openMode]);

  const loadProfile = useCallback(async (sess) => {
    if (!sess) return;
    setMeError(false);
    try {
      const [{ data: prof, error }, secs] = await Promise.all([
        sb.from("profiles").select("*").eq("id", sess.user.id).single(),
        fetchSections().catch(() => []),
      ]);
      if (error) throw error;
      setMe(prof || null);
      setSections(secs);
    } catch (e) {
      setMeError(true);
      notify(errMsg(e), "err");
    }
  }, []);

  // reload() para atualizações manuais (fora do contexto do callback de auth).
  const reload = useCallback(() => loadProfile(session), [loadProfile, session]);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) { setMe(null); setMeError(false); return; }
    // setTimeout(0): tira as chamadas ao Supabase de dentro do "lock" que o
    // GoTrue mantém enquanto processa o evento SIGNED_IN (evita travar no 1º login).
    const t = setTimeout(() => loadProfile(session), 0);
    return () => clearTimeout(t);
  }, [session, loadProfile]);

  if (session === undefined) return html`<${Splash} /><${Toaster} />`;
  if (!session) return openMode ? html`<${Splash} /><${Toaster} />` : html`<${Login} /><${Toaster} />`;
  if (!me) {
    return html`
      <div class="flex min-h-screen flex-col items-center justify-center gap-3 text-sm text-muted">
        ${meError
          ? html`
            <div>Não foi possível carregar seu perfil.</div>
            <${Btn} variant="ghost" onClick=${() => loadProfile(session)}>Tentar de novo<//>
            <button class="text-xs text-muted hover:text-ink/75" onClick=${() => sb.auth.signOut()}>Sair</button>`
          : html`<span class="spinner mr-2"></span> Carregando…`}
      </div>
      <${Toaster} />`;
  }

  return html`
    <${Shell} me=${me} route=${route}>
      <${Router} route=${route} me=${me} sections=${sections} reload=${reload} />
    <//>
    <${Toaster} />`;
}

render(html`<${App} />`, document.getElementById("app"));

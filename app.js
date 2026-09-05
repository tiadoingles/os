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

// Estrutura do menu lateral. O grupo "bc" é a Base de Conhecimento (já funcional).
// Cada `item` de grupo abre em #/<grupo>/<slug>; os que ainda não têm tela mostram
// a página "Módulo em construção" com a descrição e as fontes de dados.
const NAV = [
  { id: "bc", nome: "Base de Conhecimento", icone: "📚", path: "/base",
    hint: "Todos os documentos, com tags e organização por seção." },

  { id: "agenda", nome: "Agenda", icone: "📅", itens: [
    { slug: "calendario", nome: "Calendário", desc: "Feriados nacionais e eventos da empresa. Clique num dia para adicionar um evento." },
    { slug: "datas-importantes", nome: "Próximos eventos", desc: "Feriados e eventos das próximas semanas em lista." },
  ]},

  { id: "pedagogico", nome: "Pedagógico", icone: "🎓", itens: [
    { slug: "materiais", nome: "Materiais (Base/Consulta)",
      desc: "Biblioteca pedagógica para consulta: metodologia, MYPA, roteiros e apostilas do método." },
    { slug: "gerador-materiais", nome: "Gerador de Materiais",
      desc: "Materiais das Arenas de Conversação: gera os dois PDFs (Recém Chegados + Básico/Interm./Avançado) a partir do tema da semana." },
    { slug: "gerador-slides", nome: "Gerador de Slides",
      desc: "Briefing da aula → deck de slides no Canva (skills metodologia, avatar, marca, MYPA, slides) e, no fluxo semanal, os demais entregáveis." },
    { slug: "gerador-feedbacks", nome: "Gerador de Feedbacks",
      desc: "Corrige e gera feedback da produção das alunas como a Tia faria (skill tia-feedback-engine) — a incorporar no sistema." },
  ]},

  { id: "cs", nome: "CS / Suporte", icone: "🤝", itens: [
    { slug: "faq", nome: "FAQ",
      desc: "Pergunte sobre processos de CS/Suporte — a IA responde com base nos documentos da pasta CS:Suporte do Drive." },
    { slug: "metricas-atendimento", nome: "Métricas de Atendimento",
      desc: "Volume de atendimentos, tempo de primeira resposta, tempo de resolução e satisfação do CS. Base de dados a definir." },
    { slug: "chat-cademi", nome: "Chat da Cademí",
      desc: "Perguntas e respostas do chatbot de dúvidas de conteúdo (popup na área de membros), para acompanhar o que as alunas perguntam." },
    { slug: "pesquisas", nome: "Pesquisas de Alunos",
      desc: "Principais insights e as pesquisas completas.",
      links: [
        ["Pesquisa Alunos Mentoria Fluent Mind", "https://docs.google.com/spreadsheets/d/1EUgDyUOo2pe4I790h-iuhbyf_t4GncDPLBIcOCeAAaA/edit"],
        ["Pesquisa Módulo PNL — Método Tia do Inglês", "https://docs.google.com/spreadsheets/d/1-WLmTHOTT7rISrdWwEezmjNGejlnET2gUGBZr9IwVYc/edit"],
        ["Pesquisa Módulo PNL — Mentoria Fluent Mind", "https://docs.google.com/spreadsheets/d/1EiUPy0HWwkYZ0H-02OaoPbOqHZsYrYQE-OWB-RPIDH8/edit"],
        ["Pesquisa Método/Decole/Memorização", "https://docs.google.com/spreadsheets/d/1NMxKjDJx5j0G3X5mVCBgWTzMWDTbJsQQ-HEvk6yPTL4/edit"],
      ] },
    { slug: "mentorados", nome: "Lista de Mentorados",
      desc: "Lista puxada da planilha de mentorados, sempre atualizada.",
      links: [["Planilha de Mentorados", "https://docs.google.com/spreadsheets/d/1CZ4qfhjEhrxtnTMBITRjOUy9o_I8LEPRoD6nuSrLdvs/edit?gid=1320664660"]] },
    { slug: "nps", nome: "NPS", desc: "Acompanhamento do NPS das alunas ao longo do tempo." },
    { slug: "presenca", nome: "Presença nas Práticas",
      desc: "Presença em Sessões Práticas, Arenas de Conversação e Fluent Labs." },
    { slug: "vencimentos", nome: "Vencimentos e Renovações",
      desc: "Da planilha de mentorados: acessos vencidos e os que vencem em 30 ou 60 dias.",
      links: [["Planilha de Mentorados", "https://docs.google.com/spreadsheets/d/1CZ4qfhjEhrxtnTMBITRjOUy9o_I8LEPRoD6nuSrLdvs/edit?gid=1320664660"]] },
  ]},

  { id: "comercial", nome: "Comercial", icone: "📈", itens: [
    { slug: "vendas", nome: "Vendas", desc: "Volume e evolução de vendas." },
    { slug: "faturamento", nome: "Faturamento Bruto", desc: "Faturamento bruto por período." },
    { slug: "cash-collected", nome: "Cash Collected", desc: "Dinheiro efetivamente recebido." },
    { slug: "conversao-closer", nome: "Taxa de Conversão Closer", desc: "Conversão por closer e por período." },
    { slug: "dash-fad", nome: "Dash FAD", desc: "Dashboard da Agência FAD, incorporado no OS." },
    { slug: "ferramentas", nome: "Ferramentas", desc: "Análise de Calls e Apresentação do Closer." },
  ]},

  { id: "financeiro", nome: "Financeiro", icone: "💰", itens: [
    { slug: "cobrancas", nome: "Cobranças", desc: "Inadimplentes e datas de pagamentos recorrentes." },
    { slug: "fluxo-caixa", nome: "Fluxo de Caixa", desc: "Entradas e saídas ao longo do tempo." },
    { slug: "dre", nome: "DRE", desc: "Demonstração de resultados." },
  ]},

  { id: "conteudo", nome: "Conteúdo", icone: "✍️", itens: [
    { slug: "metricas", nome: "Métricas",
      desc: "Dashboard do calendário de conteúdo: produção, desempenho orgânico e posts por objetivo." },
    { slug: "gerador-conteudos", nome: "Gerador de conteúdos",
      desc: "Gera ideias e conteúdos a partir dos insights das pesquisas de alunos." },
  ]},
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

// Edge Function "ai": classify (sugere seção) e ask (pergunta sobre a base).
async function aiCall(action, extra = {}) {
  const { data, error } = await sb.functions.invoke("ai", { body: { action, ...extra } });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (_) { /* ignore */ }
    throw new Error(msg);
  }
  if (data && data.error && data.configured !== false) throw new Error(data.error);
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

const EMBED_ROUTES = new Set(["/pedagogico/gerador-feedbacks", "/comercial/dash-fad"]);

function Shell({ me, route, children }) {
  const [open, setOpen] = useState(false);
  const p0 = route.parts[0] || "";
  const bcActive = p0 === "base" || p0 === "secao" || p0 === "doc" || p0 === "novo";
  const homeActive = p0 === "";
  const fullBleed = EMBED_ROUTES.has(route.path);
  const [openGroups, setOpenGroups] = useState(() => new Set([p0]));
  useEffect(() => { setOpenGroups((s) => new Set([...s, p0])); }, [p0]);
  const toggle = (id) => setOpenGroups((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const linkItem = (label, icon, target, active) => html`
    <a href=${"#" + target} onClick=${() => setOpen(false)}
      class=${cx(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
        active ? "bg-brand-light font-medium text-brand-dark" : "text-ink/70 hover:bg-black/[0.04]"
      )}>
      <span class="w-5 text-center text-[15px] leading-none">${icon}</span>
      <span class="truncate">${label}</span>
    </a>`;

  const grupo = (g) => {
    if (g.id === "bc") return linkItem(g.nome, g.icone, "/base", bcActive);
    const aberto = openGroups.has(g.id);
    const algumAtivo = p0 === g.id;
    return html`
      <div>
        <button onClick=${() => toggle(g.id)}
          class=${cx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
            algumAtivo ? "font-medium text-brand-dark" : "text-ink/70 hover:bg-black/[0.04]")}>
          <span class="w-5 text-center text-[15px] leading-none">${g.icone}</span>
          <span class="flex-1 truncate text-left">${g.nome}</span>
          <span class="text-xs text-muted">${aberto ? "▾" : "▸"}</span>
        </button>
        ${aberto ? html`
          <div class="mb-1 ml-4 space-y-0.5 border-l border-line pl-2">
            ${g.itens.map((it) => {
              const target = "/" + g.id + "/" + it.slug;
              const active = route.path === target;
              return html`
                <a href=${"#" + target} onClick=${() => setOpen(false)}
                  class=${cx("block truncate rounded-lg px-3 py-1.5 text-sm transition",
                    active ? "bg-brand-light font-medium text-brand-dark" : "text-ink/60 hover:bg-black/[0.04]")}>
                  ${it.nome}
                </a>`;
            })}
          </div>` : null}
      </div>`;
  };

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
        ${linkItem("Início", "🏠", "/", homeActive)}
        ${linkItem("Farol do Lucro", "🚦", "/farol", p0 === "farol")}
        ${linkItem("Pedir a IA", "✨", "/pedir-ia", route.path === "/pedir-ia")}
        <div class="my-1 border-t border-line"></div>
        ${NAV.map(grupo)}
      </nav>

      <div class="space-y-0.5 border-t border-line px-2 py-2">
        ${linkItem("Ferramentas", "🧰", "/ferramentas", route.path === "/ferramentas")}
        ${me.role === "admin" ? linkItem("Administração", "⚙️", "/admin", route.path === "/admin") : null}
        ${linkItem("Meu perfil", "👤", "/perfil", route.path === "/perfil")}
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
        ${fullBleed
          ? children
          : html`<div class="mx-auto max-w-5xl px-4 py-7 sm:px-6 lg:px-10 lg:py-10">${children}</div>`}
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

  if (!section) return html`<${Empty} title="Seção não encontrada" icon="❓"><a class="text-brand" href="#/base">Voltar à Base de Conhecimento</a><//>`;

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
          <div class="flex items-center gap-2 text-sm text-muted"><a href="#/base" class="hover:text-ink/75">Base de Conhecimento</a> / <span>${section.nome}</span></div>
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

  if (notFound) return html`<${Empty} title="Documento não encontrado" icon="🔍"><a class="text-brand" href="#/base">Voltar à Base de Conhecimento</a><//>`;
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
        <a href="#/base" class="hover:text-ink/75">Base de Conhecimento</a> /
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

function SugestaoIA({ f, src, sections, onApply }) {
  const [busy, setBusy] = useState(false);
  const [sug, setSug] = useState(null);       // { secao_slug, secao_nome, motivo, confianca, tags_sugeridas }
  const [naoConfig, setNaoConfig] = useState(false);

  async function sugerir() {
    setBusy(true); setSug(null);
    try {
      const texto = src.mode === "texto" ? (src.conteudo_md || "") : (f.descricao || "");
      const d = await aiCall("classify", { titulo: f.titulo, texto });
      if (d && d.configured === false) { setNaoConfig(true); return; }
      setSug(d);
    } catch (e) { notify(errMsg(e), "err"); }
    finally { setBusy(false); }
  }

  const alvo = sug && sections.find((s) => s.slug === sug.secao_slug);

  return html`
    <div class="rounded-xl border border-line bg-black/[0.02] p-3">
      <div class="flex flex-wrap items-center gap-2">
        <${Btn} variant="ghost" loading=${busy} disabled=${!f.titulo.trim()} onClick=${sugerir}>✨ Sugerir categoria (IA)<//>
        ${!f.titulo.trim() ? html`<span class="text-xs text-muted">preencha o título primeiro</span>` : null}
        ${naoConfig ? html`<span class="text-xs text-muted">IA ainda não conectada</span>` : null}
      </div>
      ${sug && html`
        <div class="mt-3 text-sm">
          <div>
            Sugestão: <b>${alvo ? alvo.nome : (sug.secao_nome || "—")}</b>
            ${sug.motivo ? html`<span class="text-muted"> — ${sug.motivo}</span>` : null}
          </div>
          ${sug.tags_sugeridas && sug.tags_sugeridas.length
            ? html`<div class="mt-1 text-xs text-muted">Tags sugeridas: ${sug.tags_sugeridas.join(", ")}</div>` : null}
          <div class="mt-2 flex gap-2">
            <${Btn} disabled=${!alvo} onClick=${() => { onApply(alvo.id, sug.tags_sugeridas || []); setSug(null); }}>Aplicar<//>
            <${Btn} variant="subtle" onClick=${() => setSug(null)}>Ignorar<//>
          </div>
        </div>`}
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
        <${SugestaoIA} f=${f} src=${src} sections=${sections}
          onApply=${(sid, tags) => setF((cur) => ({
            ...cur,
            section_id: sid,
            tags: [...new Set([...(cur.tags ? cur.tags.split(",").map((t) => t.trim()).filter(Boolean) : []), ...tags])].join(", "),
          }))} />
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

function ModuloEmConstrucao({ grupo, item }) {
  return html`
    <div>
      <div class="text-sm text-muted">${grupo.icone} ${grupo.nome}</div>
      <h1 class="mt-1 text-2xl font-semibold text-ink">${item.nome}</h1>
      <div class="mt-6 rounded-2xl border border-dashed border-line bg-card/70 px-6 py-12 text-center">
        <div class="text-4xl">🚧</div>
        <div class="mt-3 font-medium text-ink">Módulo em construção</div>
        <p class="mx-auto mt-1 max-w-lg text-sm text-muted">${item.desc}</p>
        ${item.links && item.links.length ? html`
          <div class="mx-auto mt-4 max-w-lg text-left">
            <div class="text-xs font-semibold uppercase tracking-wide text-muted">Fontes de dados</div>
            <ul class="mt-1 space-y-1 text-sm">
              ${item.links.map(([label, url]) => html`
                <li>· <a href=${url} target="_blank" rel="noopener" class="text-brand hover:underline">${label} ↗</a></li>`)}
            </ul>
          </div>` : null}
        <p class="mx-auto mt-4 max-w-lg text-xs text-muted">
          A estrutura já está no menu. Este módulo entra numa próxima etapa.
        </p>
      </div>
    </div>`;
}

function PedirIA() {
  const [pergunta, setPergunta] = useState("");
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState(null);   // { resposta, fontes }
  const [configured, setConfigured] = useState(null); // null=checando, bool

  useEffect(() => {
    aiCall("status").then((d) => setConfigured(!!(d && d.configured))).catch(() => setConfigured(false));
  }, []);

  async function perguntar(e) {
    e && e.preventDefault();
    if (!pergunta.trim()) return;
    setBusy(true); setResp(null);
    try {
      const d = await aiCall("ask", { pergunta: pergunta.trim() });
      if (d && d.configured === false) { setConfigured(false); return; }
      setResp(d);
    } catch (e2) { notify(errMsg(e2), "err"); }
    finally { setBusy(false); }
  }

  return html`
    <div class="max-w-2xl">
      <h1 class="flex items-center gap-2 text-2xl font-semibold text-ink">✨ Pedir a IA</h1>
      <p class="mt-1 text-sm text-muted">
        Pergunte em linguagem natural: sobre o próprio sistema, sobre o conteúdo da Base de Conhecimento
        (com as fontes), ou qualquer outra coisa.
      </p>

      ${configured === false && html`
        <div class="mt-5 rounded-2xl border border-[#efd9d3] bg-[#faefec] p-5">
          <div class="text-sm font-medium text-ink">IA ainda não conectada</div>
          <p class="mt-1 text-sm text-muted">
            Falta o segredo <code class="rounded bg-black/[0.05] px-1">ANTHROPIC_API_KEY</code> nas Edge Functions do Supabase.
            Depois de adicioná-lo, esta página funciona sozinha.
          </p>
        </div>`}

      <form onSubmit=${perguntar} class="mt-5">
        <textarea class=${cx(inputCls, "min-h-[110px]")} placeholder="Ex.: Qual o tom de voz da marca para e-mails de vendas?"
          value=${pergunta} onInput=${(e) => setPergunta(e.target.value)}
          onKeyDown=${(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) perguntar(e); }} disabled=${configured === false}></textarea>
        <div class="mt-2 flex items-center gap-2">
          <${Btn} type="submit" loading=${busy} disabled=${configured === false}>Perguntar<//>
          <span class="text-xs text-muted">⌘/Ctrl + Enter</span>
        </div>
      </form>

      ${resp && html`
        <div class="mt-5 rounded-2xl border border-line bg-card p-5">
          <${Markdown} text=${resp.resposta} />
          ${resp.fontes && resp.fontes.length ? html`
            <div class="mt-4 border-t border-line pt-3 text-xs text-muted">
              Fontes: ${resp.fontes.map((f, i) => html`<span>${i ? " · " : ""}${f.titulo}${f.secao ? " (" + f.secao + ")" : ""}</span>`)}
            </div>` : null}
        </div>`}

      <div class="mt-4 text-xs text-muted">
        Cada pergunta consome créditos da conta Anthropic da empresa.
      </div>
    </div>`;
}

/* ============================ CS / Suporte · FAQ ============================ */

async function fetchSecaoContagem(slug) {
  const { data: sec, error: e1 } = await sb.from("kb_sections").select("id,nome").eq("slug", slug).maybeSingle();
  if (e1 || !sec) return { nome: null, total: 0 };
  const { count } = await sb.from("kb_documents").select("id", { count: "exact", head: true }).eq("section_id", sec.id).eq("status", "publicado");
  return { nome: sec.nome, total: count || 0 };
}

async function fetchUltimasCorrecoes(slug, limit = 5) {
  const { data, error } = await sb.from("faq_interacoes")
    .select("id,pergunta,resposta_corrigida,tema,tema_corrigido,corrigida_em")
    .eq("secao_slug", slug).eq("status", "corrigida")
    .order("corrigida_em", { ascending: false }).limit(limit);
  return error ? [] : (data || []);
}

function FaqFeedback({ interacaoId, secaoSlug, tema, me, onCorrigida }) {
  const [status, setStatus] = useState(null); // null | "aceita" | "corrigindo" | "corrigida"
  const [texto, setTexto] = useState("");
  const [temaCorrigido, setTemaCorrigido] = useState(tema || "");
  const [salvando, setSalvando] = useState(false);

  if (!interacaoId) return null;

  async function aceitar() {
    setStatus("aceita");
    try { await sb.from("faq_interacoes").update({ status: "aceita" }).eq("id", interacaoId); }
    catch (e) { notify(errMsg(e), "err"); }
  }

  async function salvarCorrecao(e) {
    e && e.preventDefault();
    const respostaCorrigida = texto.trim();
    if (!respostaCorrigida) return; // obrigatório — não deixa salvar em branco
    setSalvando(true);
    try {
      const { error } = await sb.from("faq_interacoes").update({
        status: "corrigida",
        resposta_corrigida: respostaCorrigida,
        tema_corrigido: (temaCorrigido || "").trim() || null,
        corrigida_em: new Date().toISOString(),
        corrigida_por: me ? me.id : null,
      }).eq("id", interacaoId);
      if (error) throw error;
      setStatus("corrigida");
      notify("Correção salva — já vale para a próxima pergunta parecida e entra na planilha \"Correções de FAQ\" em até 30 min.", "ok");
      onCorrigida && onCorrigida();
    } catch (e2) { notify(errMsg(e2), "err"); }
    finally { setSalvando(false); }
  }

  if (status === "aceita")
    return html`<div class="mt-4 flex items-center gap-2 border-t border-line pt-3 text-sm text-emerald-700">✓ Marcada como correta</div>`;

  if (status === "corrigida")
    return html`<div class="mt-4 flex items-center gap-2 border-t border-line pt-3 text-sm text-emerald-700">✓ Correção salva</div>`;

  if (status === "corrigindo")
    return html`
      <form onSubmit=${salvarCorrecao} class="mt-4 border-t border-line pt-3">
        <label class="block text-sm font-medium text-ink">Escreva a resposta correta <span class="text-brand">*</span></label>
        <textarea class=${cx(inputCls, "mt-1 min-h-[90px]")} placeholder="Qual é a resposta certa para esta pergunta?"
          value=${texto} onInput=${(e) => setTexto(e.target.value)} autofocus></textarea>
        <label class="mt-2 block text-xs font-medium text-muted">Tema (opcional, ajuda a organizar)</label>
        <input class=${cx(inputCls, "mt-1")} value=${temaCorrigido} onInput=${(e) => setTemaCorrigido(e.target.value)} />
        <div class="mt-2 flex items-center gap-2">
          <${Btn} type="submit" loading=${salvando} disabled=${!texto.trim()}>Salvar correção<//>
          <${Btn} type="button" variant="ghost" onClick=${() => setStatus(null)}>Cancelar<//>
        </div>
      </form>`;

  return html`
    <div class="mt-4 flex items-center gap-2 border-t border-line pt-3">
      <span class="text-xs text-muted">Essa resposta está certa?</span>
      <${Btn} variant="ghost" onClick=${aceitar}>✅ Está certa<//>
      <${Btn} variant="danger" onClick=${() => setStatus("corrigindo")}>✏️ Não está certa, corrigir<//>
    </div>`;
}

function FaqPage({ me }) {
  const SECAO_SLUG = "cs-suporte";
  const [pergunta, setPergunta] = useState("");
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState(null); // { resposta, fontes, secao, total_docs, confianca, tema, interacao_id }
  const [configured, setConfigured] = useState(null);
  const [base, setBase] = useState(null); // { nome, total }
  const [ultimasCorrecoes, setUltimasCorrecoes] = useState([]);

  useEffect(() => {
    aiCall("status").then((d) => setConfigured(!!(d && d.configured))).catch(() => setConfigured(false));
    fetchSecaoContagem(SECAO_SLUG).then(setBase).catch(() => setBase({ nome: null, total: 0 }));
    fetchUltimasCorrecoes(SECAO_SLUG).then(setUltimasCorrecoes);
  }, []);

  async function perguntar(e) {
    e && e.preventDefault();
    if (!pergunta.trim()) return;
    setBusy(true); setResp(null);
    try {
      const d = await aiCall("ask", { pergunta: pergunta.trim(), secao_slug: SECAO_SLUG });
      if (d && d.configured === false) { setConfigured(false); return; }
      setResp(d);
      if (d && typeof d.total_docs === "number") setBase((b) => ({ nome: (b && b.nome) || d.secao, total: d.total_docs }));
    } catch (e2) { notify(errMsg(e2), "err"); }
    finally { setBusy(false); }
  }

  return html`
    <div class="max-w-2xl">
      <div class="text-sm text-muted">🤝 CS / Suporte</div>
      <h1 class="mt-1 flex items-center gap-2 text-2xl font-semibold text-ink">💬 FAQ</h1>
      <p class="mt-1 text-sm text-muted">
        Pergunte sobre processos de CS/Suporte — a IA responde com base nos documentos da pasta
        <b>CS:Suporte</b> (dentro de <b>00. OS TIA DO INGLÊS</b> no Google Drive), sincronizados todo dia
        automaticamente. Se a resposta não estiver 100% clara na base, ela avisa em vez de inventar — e toda
        resposta pode ser aceita ou corrigida logo abaixo.
      </p>

      <div class="mt-3 flex items-center justify-between rounded-xl border border-line bg-card px-4 py-2.5 text-xs text-muted">
        <span>Base atual: ${base ? html`<b class="text-ink">${nf(base.total)}</b>` : "…"} documento(s) ${base && base.nome ? `em "${base.nome}"` : ""}</span>
        <a href="#/secao/cs-suporte" class="font-medium text-brand hover:underline">ver documentos →</a>
      </div>

      ${configured === false && html`
        <div class="mt-5 rounded-2xl border border-[#efd9d3] bg-[#faefec] p-5">
          <div class="text-sm font-medium text-ink">IA ainda não conectada</div>
          <p class="mt-1 text-sm text-muted">
            Falta o segredo <code class="rounded bg-black/[0.05] px-1">ANTHROPIC_API_KEY</code> nas Edge Functions do Supabase.
            Depois de adicioná-lo, esta página funciona sozinha.
          </p>
        </div>`}

      <form onSubmit=${perguntar} class="mt-5">
        <textarea class=${cx(inputCls, "min-h-[100px]")} placeholder="Ex.: Como faço para renovar o acesso de uma mentorada?"
          value=${pergunta} onInput=${(e) => setPergunta(e.target.value)}
          onKeyDown=${(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) perguntar(e); }} disabled=${configured === false}></textarea>
        <div class="mt-2 flex items-center gap-2">
          <${Btn} type="submit" loading=${busy} disabled=${configured === false}>Perguntar<//>
          <span class="text-xs text-muted">⌘/Ctrl + Enter</span>
        </div>
      </form>

      ${resp && html`
        <div class="mt-5 rounded-2xl border border-line bg-card p-5">
          ${resp.tema ? html`<div class="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Tema: ${resp.tema}</div>` : null}
          ${resp.confianca === "baixa" && html`
            <div class="mb-3 rounded-lg border border-[#f0d9a8] bg-[#fdf5e6] px-3 py-2 text-xs text-[#8a6a1f]">
              ⚠️ Confiança baixa — os documentos não cobrem isso com clareza. Revise esta resposta antes de confiar totalmente.
            </div>`}
          <${Markdown} text=${resp.resposta} />
          ${resp.fontes && resp.fontes.length ? html`
            <div class="mt-4 border-t border-line pt-3 text-xs text-muted">
              Fontes: ${resp.fontes.map((f, i) => html`<span>${i ? " · " : ""}${f.titulo}</span>`)}
            </div>` : null}
          <${FaqFeedback} interacaoId=${resp.interacao_id} secaoSlug=${SECAO_SLUG} tema=${resp.tema} me=${me}
            onCorrigida=${() => fetchUltimasCorrecoes(SECAO_SLUG).then(setUltimasCorrecoes)} />
        </div>`}

      ${ultimasCorrecoes.length > 0 && html`
        <div class="mt-6">
          <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Últimas correções desta seção</div>
          <div class="space-y-2">
            ${ultimasCorrecoes.map((c) => html`
              <div class="rounded-xl border border-line bg-card/60 p-3 text-xs">
                <div class="font-medium text-ink">${c.pergunta}</div>
                <div class="mt-1 text-muted">${c.resposta_corrigida}</div>
              </div>`)}
          </div>
        </div>`}

      <p class="mt-4 text-xs text-muted">
        A pasta ainda está vazia ou incompleta? Adicione os documentos em <b>CS:Suporte</b> no Drive — o sync
        diário (<code class="rounded bg-black/[0.05] px-1">sync-drive-os</code>) traz para cá sozinho, e as
        respostas passam a citar as fontes automaticamente.
      </p>
    </div>`;
}

/* ============================ Conteúdo · Métricas Instagram ============================ */

const nf = (n) => (n == null ? "—" : Number(n).toLocaleString("pt-BR"));
const nfShort = (n) => {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(".0", "") + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(".0", "") + "k";
  return String(n);
};

async function fetchInstagram() {
  const [p, d, po] = await Promise.all([
    sb.from("ig_perfil").select("*").eq("id", 1).maybeSingle(),
    sb.from("ig_dia").select("*").order("data", { ascending: true }),
    sb.from("ig_post").select("*").order("publicado_em", { ascending: false }).limit(60),
  ]);
  return { perfil: p.data, dias: d.data || [], posts: po.data || [] };
}

function Sparkline({ values, height = 40 }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const w = 100 / values.length;
  return html`
    <svg viewBox=${`0 0 100 ${height}`} preserveAspectRatio="none" class="h-10 w-full">
      ${values.map((v, i) => {
        const h = Math.max(1, (v / max) * (height - 2));
        return html`<rect x=${(i * w).toFixed(2)} y=${(height - h).toFixed(2)} width=${(w * 0.8).toFixed(2)} height=${h.toFixed(2)} rx="0.6" fill="#ea5167" opacity="0.85"></rect>`;
      })}
    </svg>`;
}

function KPI({ label, valor, sub }) {
  return html`
    <div class="rounded-xl border border-line bg-card p-4">
      <div class="text-xs uppercase tracking-wide text-muted">${label}</div>
      <div class="mt-1 text-2xl font-semibold text-ink">${valor}</div>
      ${sub ? html`<div class="text-xs text-muted">${sub}</div>` : null}
    </div>`;
}

function InstagramPage() {
  const [data, setData] = useState(null);
  useEffect(() => { fetchInstagram().then(setData).catch((e) => { notify(errMsg(e), "err"); setData({ perfil: null, dias: [], posts: [] }); }); }, []);
  if (!data) return html`<div class="text-sm text-muted"><span class="spinner mr-2"></span>Carregando…</div>`;

  const { perfil, dias, posts } = data;
  const jan = dias.slice(-28);
  const sum = (k) => jan.reduce((a, r) => a + (r[k] || 0), 0);
  const reachTotal = sum("reach"), viewsTotal = sum("views");
  const novos = jan.reduce((a, r) => a + (r.novos_seguidores || 0), 0);
  const interTotal = sum("interacoes");
  const engRate = reachTotal ? (interTotal / reachTotal) * 100 : 0;
  const atualizado = perfil && perfil.atualizado_em ? fmtDate(perfil.atualizado_em, true) : "—";

  return html`
    <div>
      <div class="text-sm text-muted">✍️ Conteúdo</div>
      <h1 class="mt-1 flex flex-wrap items-center gap-x-3 text-2xl font-semibold text-ink">
        Métricas Instagram
        ${perfil ? html`<a href=${"https://instagram.com/" + perfil.username} target="_blank" rel="noopener" class="text-sm font-normal text-brand hover:underline">@${perfil.username} ↗</a>` : null}
      </h1>
      <p class="mt-1 text-xs text-muted">Dados via Windsor.ai · atualizado ${atualizado}</p>

      ${perfil && html`
        <div class="mt-4 flex flex-wrap gap-6 rounded-xl border border-line bg-card p-4">
          <div><div class="text-2xl font-semibold text-ink">${nf(perfil.seguidores)}</div><div class="text-xs text-muted">seguidores</div></div>
          <div><div class="text-2xl font-semibold text-ink">${nf(perfil.publicacoes)}</div><div class="text-xs text-muted">publicações</div></div>
          <div><div class="text-2xl font-semibold text-ink">${nf(perfil.seguindo)}</div><div class="text-xs text-muted">seguindo</div></div>
        </div>`}

      <h2 class="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Últimos 28 dias</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <${KPI} label="Alcance" valor=${nfShort(reachTotal)} sub=${"~" + nfShort(Math.round(reachTotal / (jan.length || 1))) + "/dia"} />
        <${KPI} label="Novos seguidores" valor=${nf(novos)} sub=${jan.length ? "em " + jan.length + " dias" : ""} />
        <${KPI} label="Interações" valor=${nfShort(interTotal)} sub=${"eng. " + engRate.toFixed(1) + "% do alcance"} />
        <${KPI} label="Views de conteúdo" valor=${nfShort(viewsTotal)} />
      </div>

      <div class="mt-4 rounded-xl border border-line bg-card p-4">
        <div class="mb-2 text-xs uppercase tracking-wide text-muted">Alcance por dia</div>
        <${Sparkline} values=${jan.map((r) => r.reach || 0)} />
        <div class="mt-1 flex justify-between text-[11px] text-muted">
          <span>${jan[0] ? fmtDate(jan[0].data) : ""}</span>
          <span>${jan.length ? fmtDate(jan[jan.length - 1].data) : ""}</span>
        </div>
      </div>

      <h2 class="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Posts recentes (${posts.length})</h2>
      <div class="mt-3 overflow-x-auto rounded-xl border border-line bg-card">
        <table class="w-full min-w-[720px] text-left text-sm">
          <thead class="border-b border-line text-xs uppercase tracking-wide text-muted">
            <tr>
              <th class="px-4 py-3 font-medium">Post</th>
              <th class="px-4 py-3 font-medium">Data</th>
              <th class="px-4 py-3 font-medium">Alcance</th>
              <th class="px-4 py-3 font-medium">Interações</th>
              <th class="px-4 py-3 font-medium">Eng. %</th>
              <th class="px-4 py-3 font-medium">Views</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line">
            ${posts.map((p) => {
              const er = p.reach ? ((p.engajamento || 0) / p.reach) * 100 : 0;
              return html`
                <tr key=${p.media_id}>
                  <td class="px-4 py-3">
                    <a href=${p.permalink} target="_blank" rel="noopener" class="font-medium text-ink hover:text-brand">
                      ${(p.legenda || "(sem legenda)").slice(0, 70)}${(p.legenda || "").length > 70 ? "…" : ""}
                    </a>
                    <div class="text-xs text-muted">${p.tipo}</div>
                  </td>
                  <td class="px-4 py-3 text-muted">${fmtDate(p.publicado_em)}</td>
                  <td class="px-4 py-3">${nf(p.reach)}</td>
                  <td class="px-4 py-3">${nf(p.engajamento)}</td>
                  <td class=${cx("px-4 py-3", er >= 4 ? "font-medium text-[#5e7a52]" : "text-muted")}>${er.toFixed(1)}%</td>
                  <td class="px-4 py-3 text-muted">${nf(p.views)}</td>
                </tr>`;
            })}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ============================ Conteúdo · Métricas (Calendário) ============================ */

const CONTEUDO_SHEET_URL = "https://docs.google.com/spreadsheets/d/16jiwjBf8m2wm06oPBigjkNxLZCv37tImGhpbWMl-uAU/edit";
const SCORE_ORDEM = { EXCELENTE: 4, "ÓTIMO": 3, BOM: 2, RUIM: 1 };

async function fetchConteudoMetricas() {
  const [cal, res] = await Promise.all([
    sb.from("conteudo_calendario").select("*").order("data_programada", { ascending: true }),
    sb.from("conteudo_objetivo_resumo").select("*").order("ordem", { ascending: true }),
  ]);
  if (cal.error) throw cal.error;
  return { linhas: cal.data || [], resumo: res.data || [] };
}

function BarRow({ label, valor, max, sufixo, cor }) {
  const pct = max > 0 ? Math.min(100, (Number(valor) / max) * 100) : 0;
  return html`
    <div class="flex items-center gap-2 text-sm">
      <div class="w-36 shrink-0 truncate text-ink/80" title=${label}>${label}</div>
      <div class="relative h-3.5 flex-1 overflow-hidden rounded bg-black/[0.05]">
        <div class="absolute inset-y-0 left-0 rounded" style=${`width:${pct.toFixed(1)}%;background:${cor || "#ea5167"}`}></div>
      </div>
      <div class="w-16 shrink-0 text-right tabular-nums text-muted">${nf(valor)}${sufixo || ""}</div>
    </div>`;
}

function DistBloco({ titulo, contagem }) {
  const itens = Object.entries(contagem).filter(([k, n]) => n > 0 && k !== "—" && k !== "NA").sort((a, b) => b[1] - a[1]);
  const max = itens.length ? itens[0][1] : 1;
  return html`
    <div class="rounded-xl border border-line bg-card p-4">
      <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">${titulo}</div>
      ${itens.length ? html`<div class="space-y-1.5">${itens.map(([k, n]) => html`<${BarRow} label=${k} valor=${n} max=${max} />`)}</div>`
        : html`<div class="text-sm text-muted">Sem dados no período.</div>`}
    </div>`;
}

function semanaSeg(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function ConteudoMetricasPage() {
  const [data, setData] = useState(null);
  const [janela, setJanela] = useState("tudo"); // 4 | 8 | 12 | tudo (semanas)
  const [tipo, setTipo] = useState("todos");
  const [funil, setFunil] = useState("todos");
  const [soComDados, setSoComDados] = useState(true);

  useEffect(() => {
    fetchConteudoMetricas().then(setData).catch((e) => { notify(errMsg(e), "err"); setData({ linhas: [], resumo: [] }); });
  }, []);

  const filtradas = useMemo(() => {
    if (!data) return [];
    let ls = data.linhas.slice();
    if (janela !== "tudo") {
      const lim = new Date();
      lim.setDate(lim.getDate() - Number(janela) * 7);
      const limIso = lim.toISOString().slice(0, 10);
      ls = ls.filter((r) => r.data_programada && r.data_programada >= limIso);
    }
    if (tipo !== "todos") ls = ls.filter((r) => (r.tipo || "") === tipo);
    if (funil !== "todos") ls = ls.filter((r) => (r.funil || "") === funil);
    if (soComDados) ls = ls.filter((r) => r.views_7d != null);
    return ls;
  }, [data, janela, tipo, funil, soComDados]);

  if (!data) return html`<div class="text-sm text-muted"><span class="spinner mr-2"></span>Carregando…</div>`;

  const { linhas, resumo } = data;
  const atualizado = linhas.length ? fmtDate(linhas.map((r) => r.atualizado_em).filter(Boolean).sort().pop(), true) : "—";
  const tiposDisp = [...new Set(linhas.map((r) => r.tipo).filter(Boolean))];
  const funisDisp = [...new Set(linhas.map((r) => r.funil).filter(Boolean))];

  const comDados = filtradas.filter((r) => r.views_7d != null);
  const soma = (k) => comDados.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const mediaDe = (arr, k) => { const v = arr.map((r) => r[k]).filter((x) => x != null).map(Number); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
  const viewsTot = soma("views_7d");
  const engMedio = mediaDe(comDados, "engajamento_real") * 100;
  const scored = filtradas.filter((r) => r.score);
  const bons = scored.filter((r) => r.score === "ÓTIMO" || r.score === "EXCELENTE").length;

  const contagem = (k, mapfn) => filtradas.reduce((acc, r) => { const v = mapfn ? mapfn(r) : (r[k] || "—"); if (v) acc[v] = (acc[v] || 0) + 1; return acc; }, {});
  const distTipo = contagem("tipo");
  const distFunil = contagem("funil");
  const distObjetivo = contagem("objetivo");
  const distFase = contagem("fase_marketing");
  const distScore = contagem("score");
  const distIcp = { "Dentro do ICP": filtradas.filter((r) => r.dentro_icp).length, "Fora do ICP": filtradas.filter((r) => r.fora_icp).length };

  // séries por semana (sobre filtradas com data)
  const semanas = {};
  for (const r of filtradas) {
    if (!r.data_programada) continue;
    const s = semanaSeg(r.data_programada);
    (semanas[s] = semanas[s] || { posts: 0, views: 0, seg: 0 });
    semanas[s].posts += 1;
    semanas[s].views += Number(r.views_7d) || 0;
    semanas[s].seg += Number(r.seguidores_org) || 0;
  }
  const semKeys = Object.keys(semanas).sort();

  const top = comDados.slice().sort((a, b) => (b.views_7d || 0) - (a.views_7d || 0)).slice(0, 10);
  const ruins = filtradas.filter((r) => r.score === "RUIM").sort((a, b) => (b.data_programada || "").localeCompare(a.data_programada || "")).slice(0, 10);

  const selCls = "rounded-lg border border-line bg-white px-2 py-1 text-sm focus:border-brand focus:outline-none";

  return html`
    <div>
      <div class="text-sm text-muted">✍️ Conteúdo</div>
      <h1 class="mt-1 text-2xl font-semibold text-ink">Métricas</h1>
      <p class="mt-1 text-xs text-muted">
        Calendário de conteúdo · atualizado ${atualizado} ·
        <a href=${CONTEUDO_SHEET_URL} target="_blank" rel="noopener" class="text-brand hover:underline">abrir planilha ↗</a>
      </p>

      <h2 class="mt-5 text-sm font-semibold uppercase tracking-wider text-muted">Posts por objetivo</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-3">
        ${resumo.map((o) => {
          const real = Number(o.percentual || 0), meta = Number(o.meta || 0);
          const bate = real >= meta - 0.001;
          const cor = o.objetivo === "Total" ? "#8f887d" : (bate ? "#4CAF6E" : "#EEB44E");
          return html`
            <div class="rounded-2xl border border-line bg-card p-4">
              <div class="text-sm font-semibold text-ink">${o.objetivo}</div>
              <div class="mt-1 text-2xl font-semibold text-ink">${nf(o.qtde)} <span class="text-sm font-normal text-muted">posts</span></div>
              <div class="mt-2 h-3 overflow-hidden rounded bg-black/[0.05]">
                <div class="h-full rounded" style=${`width:${(real * 100).toFixed(1)}%;background:${cor}`}></div>
              </div>
              <div class="mt-1 flex justify-between text-[11px] text-muted">
                <span>realizado ${(real * 100).toFixed(0)}%</span>
                <span>meta ${(meta * 100).toFixed(0)}%</span>
              </div>
            </div>`;
        })}
      </div>

      <div class="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-card p-3">
        <label class="text-sm">
          <span class="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">Período</span>
          <select class=${selCls} value=${janela} onChange=${(e) => setJanela(e.target.value)}>
            <option value="4">Últimas 4 semanas</option>
            <option value="8">Últimas 8 semanas</option>
            <option value="12">Últimas 12 semanas</option>
            <option value="tudo">Tudo</option>
          </select>
        </label>
        <label class="text-sm">
          <span class="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">Tipo</span>
          <select class=${selCls} value=${tipo} onChange=${(e) => setTipo(e.target.value)}>
            <option value="todos">Todos</option>
            ${tiposDisp.map((t) => html`<option value=${t}>${t}</option>`)}
          </select>
        </label>
        <label class="text-sm">
          <span class="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">Funil</span>
          <select class=${selCls} value=${funil} onChange=${(e) => setFunil(e.target.value)}>
            <option value="todos">Todos</option>
            ${funisDisp.map((f) => html`<option value=${f}>${f}</option>`)}
          </select>
        </label>
        <label class="flex items-center gap-2 text-sm text-ink/80">
          <input type="checkbox" checked=${soComDados} onChange=${(e) => setSoComDados(e.target.checked)} />
          Só posts com métricas
        </label>
        <div class="ml-auto text-xs text-muted">${filtradas.length} post(s) · ${comDados.length} com métricas</div>
      </div>

      <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <${KPI} label="Posts (com métricas)" valor=${nf(comDados.length)} sub=${nf(filtradas.length) + " no período"} />
        <${KPI} label="Views 7 dias" valor=${nfShort(viewsTot)} sub=${comDados.length ? "~" + nfShort(Math.round(viewsTot / comDados.length)) + "/post" : ""} />
        <${KPI} label="Engajamento real" valor=${engMedio.toFixed(1) + "%"} sub="média dos posts" />
        <${KPI} label="Seguidores orgânicos" valor=${nf(soma("seguidores_org"))} sub="ganhos no período" />
        <${KPI} label="Curtidas" valor=${nfShort(soma("curtidas"))} />
        <${KPI} label="Comentários" valor=${nfShort(soma("comentarios"))} />
        <${KPI} label="Salvamentos" valor=${nfShort(soma("salvamentos"))} />
        <${KPI} label="Compartilhamentos" valor=${nfShort(soma("compartilhamentos"))} />
        <${KPI} label="Pontuação média" valor=${nf(Math.round(mediaDe(comDados, "pontuacao")))} />
        <${KPI} label="Posts Ótimo/Excelente" valor=${scored.length ? Math.round((bons / scored.length) * 100) + "%" : "—"} sub=${bons + " de " + scored.length + " avaliados"} />
      </div>

      <h2 class="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Distribuições</h2>
      <div class="mt-3 grid gap-3 lg:grid-cols-2">
        <${DistBloco} titulo="Tipo de conteúdo" contagem=${distTipo} />
        <${DistBloco} titulo="Funil" contagem=${distFunil} />
        <${DistBloco} titulo="Objetivo" contagem=${distObjetivo} />
        <${DistBloco} titulo="Fase de Marketing" contagem=${distFase} />
        <${DistBloco} titulo="Score" contagem=${distScore} />
        <${DistBloco} titulo="ICP" contagem=${distIcp} />
      </div>

      <h2 class="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Evolução por semana</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-3">
        ${[["Posts/semana", "posts"], ["Views/semana", "views"], ["Seguidores/semana", "seg"]].map(([lab, k]) => html`
          <div class="rounded-xl border border-line bg-card p-4">
            <div class="mb-2 text-xs uppercase tracking-wide text-muted">${lab}</div>
            <${Sparkline} values=${semKeys.map((s) => semanas[s][k])} />
            <div class="mt-1 flex justify-between text-[11px] text-muted">
              <span>${semKeys[0] ? fmtDate(semKeys[0]) : ""}</span>
              <span>${semKeys.length ? fmtDate(semKeys[semKeys.length - 1]) : ""}</span>
            </div>
          </div>`)}
      </div>

      <h2 class="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Top 10 por views (7 dias)</h2>
      <div class="mt-3 overflow-x-auto rounded-xl border border-line bg-card">
        <table class="w-full min-w-[640px] text-left text-sm">
          <thead class="border-b border-line text-xs uppercase tracking-wide text-muted">
            <tr><th class="px-4 py-3 font-medium">Tema</th><th class="px-4 py-3 font-medium">Tipo</th><th class="px-4 py-3 font-medium">Funil</th><th class="px-4 py-3 font-medium">Score</th><th class="px-4 py-3 text-right font-medium">Views</th><th class="px-4 py-3 text-right font-medium">Eng.</th></tr>
          </thead>
          <tbody class="divide-y divide-line">
            ${top.map((r) => html`
              <tr key=${r.linha}>
                <td class="px-4 py-2.5 font-medium text-ink">${r.tema || "—"}</td>
                <td class="px-4 py-2.5 text-muted">${r.tipo || "—"}</td>
                <td class="px-4 py-2.5 text-muted">${r.funil || "—"}</td>
                <td class="px-4 py-2.5 text-muted">${r.score || "—"}</td>
                <td class="px-4 py-2.5 text-right tabular-nums">${nf(r.views_7d)}</td>
                <td class="px-4 py-2.5 text-right tabular-nums text-muted">${r.engajamento_real != null ? (r.engajamento_real * 100).toFixed(1) + "%" : "—"}</td>
              </tr>`)}
          </tbody>
        </table>
      </div>

      ${ruins.length ? html`
        <h2 class="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Posts com Score "RUIM" (revisar)</h2>
        <div class="mt-3 overflow-x-auto rounded-xl border border-line bg-card">
          <table class="w-full min-w-[560px] text-left text-sm">
            <thead class="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr><th class="px-4 py-3 font-medium">Data</th><th class="px-4 py-3 font-medium">Tema</th><th class="px-4 py-3 font-medium">Tipo</th><th class="px-4 py-3 text-right font-medium">Views</th></tr>
            </thead>
            <tbody class="divide-y divide-line">
              ${ruins.map((r) => html`
                <tr key=${r.linha}>
                  <td class="px-4 py-2.5 text-muted">${fmtDate(r.data_programada)}</td>
                  <td class="px-4 py-2.5 font-medium text-ink">${r.tema || "—"}</td>
                  <td class="px-4 py-2.5 text-muted">${r.tipo || "—"}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums">${nf(r.views_7d)}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>` : null}

      <p class="mt-4 text-xs text-muted">
        Fonte: aba "Calendário" da planilha de conteúdo. Atualização automática diária pela tarefa
        <code class="rounded bg-black/[0.05] px-1">sync-conteudo-metricas-os</code>.
      </p>
    </div>`;
}

/* ============================ CS · Pesquisas de Alunos ============================ */

async function fetchPesquisas() {
  const { data, error } = await sb
    .from("pesquisa_avatar")
    .select("*")
    .order("ordem", { ascending: true });
  if (error) throw error;
  return data || [];
}

function tempoDesde(iso) {
  if (!iso) return null;
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `há ${meses} ${meses === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(dias / 365);
  return `há ${anos} ${anos === 1 ? "ano" : "anos"}`;
}

function PesquisaCard({ p }) {
  const janelaMs = (p.janela_dias || 30) * 86400000;
  const recente = p.ultima_resposta_em && Date.now() - new Date(p.ultima_resposta_em).getTime() < janelaMs;
  const ativo = !!p.ativo || !!recente;

  let pill, pillCls;
  if (!p.total_respostas) { pill = "AGUARDANDO"; pillCls = PILL_WARN; }
  else if (ativo) { pill = "ATIVO"; pillCls = PILL_OK; }
  else { pill = "SEM RESPOSTAS NOVAS"; pillCls = PILL_NEUTRAL; }

  return html`
    <div class="flex min-w-0 flex-col rounded-2xl border border-line bg-card p-5">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-base font-semibold leading-tight text-ink">${p.titulo}</h3>
          ${p.aba ? html`<div class="mt-0.5 text-[11px] text-muted">${p.aba}</div>` : null}
        </div>
        <span class=${cx("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide", pillCls)}>
          ${ativo && p.total_respostas ? "● " : ""}${pill}
        </span>
      </div>

      <div class="mt-3 grid grid-cols-2 gap-3">
        <div class="rounded-xl border border-line bg-white/60 px-3 py-2">
          <div class="text-[11px] uppercase tracking-wide text-muted">Última resposta</div>
          <div class="mt-0.5 text-sm font-medium text-ink">
            ${p.ultima_resposta_em ? fmtDate(p.ultima_resposta_em, true) : "—"}
          </div>
          ${p.ultima_resposta_em ? html`<div class="text-[11px] text-muted">${tempoDesde(p.ultima_resposta_em)}</div>` : null}
        </div>
        <div class="rounded-xl border border-line bg-white/60 px-3 py-2">
          <div class="text-[11px] uppercase tracking-wide text-muted">Respostas</div>
          <div class="mt-0.5 text-sm font-medium text-ink">${nf(p.total_respostas)}</div>
        </div>
      </div>

      ${p.resumo_md
        ? html`<div class="prose-doc mt-3 min-w-0 text-sm" dangerouslySetInnerHTML=${{ __html: mdToHtml(p.resumo_md) }}></div>`
        : html`<p class="mt-3 text-sm text-muted">Resumo do avatar ainda não gerado.</p>`}

      <div class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[11px] text-muted">
        <span>${p.resumo_atualizado_em ? "Resumo atualizado " + fmtDate(p.resumo_atualizado_em) : ""}</span>
        ${p.fonte_url ? html`<a href=${p.fonte_url} target="_blank" rel="noopener" class="font-medium text-brand hover:underline">abrir pesquisa ↗</a>` : null}
      </div>
    </div>`;
}

function mdToHtml(text) {
  try { return sanitizeHtml(marked.parse(text || "")); }
  catch (_) { return "<pre>" + (text || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])) + "</pre>"; }
}

function PesquisasPage() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    fetchPesquisas().then(setRows).catch((e) => { notify(errMsg(e), "err"); setRows([]); });
  }, []);

  if (!rows) return html`<div class="text-sm text-muted"><span class="spinner mr-2"></span>Carregando…</div>`;

  const ativos = rows.filter((r) => r.total_respostas && (r.ativo || (r.ultima_resposta_em && Date.now() - new Date(r.ultima_resposta_em).getTime() < (r.janela_dias || 30) * 86400000))).length;
  const totalResp = rows.reduce((a, r) => a + (r.total_respostas || 0), 0);
  const ult = rows.map((r) => r.resumo_atualizado_em).filter(Boolean).sort().pop();

  return html`
    <div>
      <div class="text-sm text-muted">🤝 CS / Suporte</div>
      <h1 class="mt-1 text-2xl font-semibold text-ink">Pesquisas de Alunos</h1>
      <p class="mt-1 text-xs text-muted">
        Avatar por curso, com sinal de atividade e data da última resposta ·
        ${ativos}/${rows.length} pesquisas ativas · ${nf(totalResp)} respostas no total${ult ? " · resumos atualizados " + fmtDate(ult) : ""}
      </p>

      <div class="mt-5 grid gap-4 lg:grid-cols-2">
        ${rows.map((p) => html`<${PesquisaCard} key=${p.chave} p=${p} />`)}
      </div>

      <p class="mt-4 text-xs text-muted">
        Fonte: formulários de pesquisa no Google Drive. Atualização automática diária (tarefa <code class="rounded bg-black/[0.05] px-1">sync-pesquisas-os</code>):
        recalcula contagem, data da última resposta, o sinal ATIVO e regenera o resumo do avatar.
      </p>
    </div>`;
}

/* ============================ CS / Suporte · Chat da Cademí ============================ */

async function fetchChatWidgetLogs() {
  const { data, error } = await sb.from("chat_widget_logs").select("*")
    .order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return data || [];
}

function ChatLogCard({ r }) {
  const [open, setOpen] = useState(false);
  const resposta = r.resposta || "";
  const curta = resposta.length > 220 && !open ? resposta.slice(0, 220) + "…" : resposta;
  return html`
    <div class="rounded-xl border border-line bg-card p-4">
      <div class="flex items-start justify-between gap-3">
        <p class="text-sm font-medium text-ink">${r.pergunta}</p>
        <span class="shrink-0 text-xs text-muted">${fmtDate(r.created_at, true)}</span>
      </div>
      ${r.stop_reason && r.stop_reason !== "end_turn" && html`
        <span class="mt-2 inline-block rounded-full bg-[#fdf3d6] px-2 py-0.5 text-[11px] text-[#8a6d1a]">
          possível resposta cortada (${r.stop_reason})
        </span>`}
      ${r.erro
        ? html`<p class="mt-2 text-sm text-[#9c2b23]">Erro: ${r.erro}</p>`
        : html`
          <p class="mt-2 whitespace-pre-wrap text-sm text-ink/80">${curta}</p>
          ${resposta.length > 220 && html`
            <button type="button" class="mt-1 text-xs text-brand hover:underline" onClick=${() => setOpen((o) => !o)}>
              ${open ? "ver menos" : "ver resposta completa"}
            </button>`}
          ${!!(r.fontes && r.fontes.length) && html`
            <p class="mt-2 text-xs text-muted">Fonte: ${r.fontes.map((f) => f.titulo).join(", ")}</p>`}
        `}
    </div>`;
}

function ChatCademiPage() {
  const [rows, setRows] = useState(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    fetchChatWidgetLogs().then(setRows).catch((e) => { notify(errMsg(e), "err"); setRows([]); });
  }, []);

  if (!rows) return html`<div class="text-sm text-muted"><span class="spinner mr-2"></span>Carregando…</div>`;

  const q = busca.trim().toLowerCase();
  const filtradas = q
    ? rows.filter((r) => (r.pergunta || "").toLowerCase().includes(q) || (r.resposta || "").toLowerCase().includes(q))
    : rows;
  const dia = 24 * 60 * 60 * 1000;
  const ultimas24h = rows.filter((r) => Date.now() - new Date(r.created_at).getTime() < dia).length;
  const erros = rows.filter((r) => r.erro).length;

  return html`
    <div>
      <div class="text-sm text-muted">🤝 CS / Suporte</div>
      <h1 class="mt-1 text-2xl font-semibold text-ink">Chat da Cademí</h1>
      <p class="mt-1 text-xs text-muted">
        Perguntas e respostas do chatbot de dúvidas de conteúdo (popup na Cademí, treinado só com a seção Metodologia) ·
        ${rows.length} conversas · ${ultimas24h} nas últimas 24h${erros ? ` · ${erros} com erro` : ""}
      </p>

      <input type="text" placeholder="Buscar por pergunta ou resposta…" value=${busca}
        onInput=${(e) => setBusca(e.target.value)}
        class="mt-4 w-full max-w-md rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />

      <div class="mt-4 grid gap-3">
        ${filtradas.length
          ? filtradas.map((r) => html`<${ChatLogCard} key=${r.id} r=${r} />`)
          : html`<p class="text-sm text-muted">Nenhuma conversa ainda.</p>`}
      </div>
    </div>`;
}

/* ============================ Conteúdo · Gerador de Conteúdos ============================ */

const INSIGHT_CATS = [
  ["dor", "Dores", "😣"],
  ["desejo", "Desejos", "✨"],
  ["mito", "Mitos", "🚫"],
  ["escolha", "Por que nos escolheram", "❤️"],
  ["curiosidade", "Curiosidades", "🔎"],
  ["insight", "Insights", "💡"],
];

async function fetchInsights() {
  const { data, error } = await sb.from("conteudo_insights").select("*")
    .order("categoria", { ascending: true }).order("ordem", { ascending: true });
  if (error) throw error;
  return data || [];
}

function GeradorConteudosPage() {
  const [rows, setRows] = useState(null);
  const [sel, setSel] = useState(() => new Set(INSIGHT_CATS.map(([k]) => k)));
  const [formato, setFormato] = useState("video"); // video | carrossel
  const [canal, setCanal] = useState("instagram"); // instagram | youtube
  const [busy, setBusy] = useState(false);
  const [ideias, setIdeias] = useState(null);
  const [configured, setConfigured] = useState(null);

  useEffect(() => {
    fetchInsights().then(setRows).catch((e) => { notify(errMsg(e), "err"); setRows([]); });
    aiCall("status").then((d) => setConfigured(!!(d && d.configured))).catch(() => setConfigured(false));
  }, []);
  useEffect(() => { if (formato === "carrossel" && canal !== "instagram") setCanal("instagram"); }, [formato]);

  if (!rows) return html`<div class="text-sm text-muted"><span class="spinner mr-2"></span>Carregando…</div>`;

  const porCat = {};
  for (const r of rows) (porCat[r.categoria] = porCat[r.categoria] || []).push(r);
  const atualizado = rows.length ? rows.map((r) => r.atualizado_em).sort().pop() : null;
  const toggle = (k) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  async function gerar() {
    if (!sel.size) { notify("Selecione ao menos uma categoria.", "err"); return; }
    setBusy(true); setIdeias(null);
    try {
      const cats = INSIGHT_CATS.filter(([k]) => sel.has(k));
      const bloco = cats.map(([k, label]) => {
        const its = (porCat[k] || []).map((r) => `- ${r.texto}${r.detalhe ? ` (${r.detalhe})` : ""}`).join("\n");
        return `### ${label}\n${its}`;
      }).join("\n\n");
      const fmt = formato === "video"
        ? (canal === "youtube" ? "vídeo para o YouTube" : "vídeo curto (Reels) para o Instagram")
        : "carrossel para o Instagram";
      const pergunta = [
        `Você é estrategista de conteúdo da Tia do Inglês (método de inglês para adultos; mentora Marcela Miranda, "a Tia"; produto principal: Mentoria Fluent Mind).`,
        `Com base nos insights abaixo, tirados das pesquisas com alunas da Mentoria, gere 10 ideias de conteúdo em formato de ${fmt}.`,
        ``,
        `INSIGHTS SELECIONADOS:`,
        bloco,
        ``,
        `Regras da resposta:`,
        `- Liste 10 ideias numeradas de 1 a 10.`,
        `- Para cada ideia: **gancho/título** que para o scroll + 1 linha de ângulo (qual dor/desejo/mito ela ataca) + ${formato === "video" ? "sugestão da primeira frase falada (3 primeiros segundos)" : "ideia da capa e quantos cards"}.`,
        `- Público: mulher adulta, de 40 a 60+ anos, que entende um pouco de inglês mas trava para falar.`,
        `- Tom acolhedor e direto, linguagem de redes sociais. Nada de clichê genérico de "aprenda inglês agora".`,
        `- Varie entre as categorias selecionadas.`,
        `- Responda em português do Brasil, em Markdown.`,
      ].join("\n");
      const d = await aiCall("ask", { pergunta });
      if (d && d.configured === false) { setConfigured(false); return; }
      setIdeias(d && d.resposta ? d.resposta : "");
    } catch (e) { notify(errMsg(e), "err"); }
    finally { setBusy(false); }
  }

  const Radio = ({ val, cur, set, children }) => html`
    <button type="button" onClick=${() => set(val)}
      class=${cx("rounded-lg border px-3 py-1.5 text-sm transition",
        cur === val ? "border-brand bg-brand-light font-medium text-brand-dark" : "border-line text-ink/70 hover:bg-black/[0.04]")}>
      ${children}
    </button>`;

  return html`
    <div>
      <div class="text-sm text-muted">✍️ Conteúdo</div>
      <h1 class="mt-1 text-2xl font-semibold text-ink">Gerador de Conteúdos</h1>
      <p class="mt-1 text-xs text-muted">
        As principais respostas das pesquisas com alunas da Mentoria, organizadas para virar pauta${atualizado ? " · atualizado " + fmtDate(atualizado) : ""}.
      </p>

      <div class="mt-5 grid gap-4 lg:grid-cols-2">
        ${INSIGHT_CATS.map(([k, label, emoji]) => html`
          <div class="rounded-2xl border border-line bg-card p-5">
            <div class="text-sm font-semibold text-ink">${emoji} ${label}</div>
            <ol class="mt-2 space-y-1.5 text-sm">
              ${(porCat[k] || []).map((r) => html`
                <li class="flex gap-2">
                  <span class="w-4 shrink-0 text-right text-xs text-muted">${r.ordem}</span>
                  <span class="min-w-0"><span class="text-ink">${r.texto}</span>${r.detalhe ? html`<span class="text-muted"> — ${r.detalhe}</span>` : null}</span>
                </li>`)}
            </ol>
          </div>`)}
      </div>

      <h2 class="mt-9 text-sm font-semibold uppercase tracking-wider text-muted">Gerar ideias de conteúdo</h2>
      <div class="mt-3 rounded-2xl border border-line bg-card p-5">
        ${configured === false ? html`
          <div class="mb-4 rounded-xl border border-[#efd9d3] bg-[#faefec] p-4 text-sm text-muted">
            A IA ainda não está conectada (falta o segredo <code class="rounded bg-black/[0.05] px-1">ANTHROPIC_API_KEY</code>).
          </div>` : null}

        <div class="text-xs font-medium uppercase tracking-wide text-muted">1. Base das ideias</div>
        <div class="mt-2 flex flex-wrap gap-2">
          ${INSIGHT_CATS.map(([k, label, emoji]) => html`
            <button type="button" onClick=${() => toggle(k)}
              class=${cx("rounded-full border px-3 py-1.5 text-sm transition",
                sel.has(k) ? "border-brand bg-brand-light font-medium text-brand-dark" : "border-line text-ink/60 hover:bg-black/[0.04]")}>
              ${emoji} ${label}
            </button>`)}
        </div>

        <div class="mt-4 flex flex-wrap gap-x-8 gap-y-4">
          <div>
            <div class="text-xs font-medium uppercase tracking-wide text-muted">2. Formato</div>
            <div class="mt-2 flex gap-2">
              <${Radio} val="video" cur=${formato} set=${setFormato}>🎬 Vídeo<//>
              <${Radio} val="carrossel" cur=${formato} set=${setFormato}>🖼️ Carrossel<//>
            </div>
          </div>
          <div>
            <div class="text-xs font-medium uppercase tracking-wide text-muted">3. Canal</div>
            <div class="mt-2 flex gap-2">
              <${Radio} val="instagram" cur=${canal} set=${setCanal}>Instagram<//>
              ${formato === "video" ? html`<${Radio} val="youtube" cur=${canal} set=${setCanal}>YouTube<//>` : null}
            </div>
          </div>
        </div>

        <div class="mt-5 flex flex-wrap items-center gap-2">
          <${Btn} onClick=${gerar} loading=${busy} disabled=${configured === false}>Gerar ideias de conteúdos<//>
          <span class="text-xs text-muted">Cada geração consome créditos da conta Anthropic.</span>
        </div>

        ${ideias != null ? html`
          <div class="mt-5 border-t border-line pt-4">
            ${ideias
              ? html`<div class="prose-doc min-w-0 text-sm" dangerouslySetInnerHTML=${{ __html: mdToHtml(ideias) }}></div>`
              : html`<p class="text-sm text-muted">A IA não retornou ideias. Tente novamente.</p>`}
          </div>` : null}
      </div>
    </div>`;
}

/* ============================ Farol do Lucro ============================ */
// Recriação do "Farol do LUCRO" (ref.: craft-sistema-green.lucaspuerto.com.br),
// um por setor, editável no próprio OS e salvo no Supabase.


const FAROL_BLOCOS = [
  { id: "constantes", nome: "Indicadores Constantes", descricao: "Métricas vitais do negócio, acompanhadas todo mês sem exceção." },
  { id: "estrategicos", nome: "Indicadores Estratégicos de Sucesso", descricao: "As North Star do período: o que define se o planejado geral deu certo." },
  { id: "marketing", nome: "Marketing e Conteúdo", descricao: "" },
  { id: "trafego", nome: "Tráfego Pago", descricao: "" },
  { id: "vendas", nome: "Vendas", descricao: "" },
  { id: "produto", nome: "Produto e Programas", descricao: "" },
  { id: "tecnologia", nome: "Tecnologia e Desenvolvimento", descricao: "" },
  { id: "sucesso", nome: "Sucesso do Cliente e Suporte", descricao: "" },
  { id: "operacoes", nome: "Operações e Eventos", descricao: "" },
  { id: "financeiro", nome: "Financeiro", descricao: "" },
];

const FAROL_STATUS = {
  "verde-escuro": { nome: "Superou a meta", cor: "#4CAF6E" },
  "verde-claro": { nome: "Dentro da meta", cor: "#B9D9C6" },
  amarelo: { nome: "Abaixo, com plano", cor: "#EEB44E" },
  vermelho: { nome: "Abaixo, sem saída", cor: "#F2CDD1" },
  "vermelho-escuro": { nome: "Catástrofe", cor: "#E83B2B" },
  "sem-dado": { nome: "Sem dado", cor: "#D8DEE4" },
};
const FAROL_TOL = 0.05;

const FAROL_INDICADORES = [
  ["Receita Bruta", "constantes", "saida", "maior", "soma", "R$"],
  ["Caixa Recebido", "constantes", "saida", "maior", "soma", "R$"],
  ["Taxa de Renovação de Alunos/Mentorados", "constantes", "saida", "maior", "media", "%"],
  ["Margem de Lucro", "constantes", "saida", "maior", "media", "%"],
  ["Número de Vendas", "estrategicos", "saida", "maior", "soma", "un"],
  ["Número de Renovações", "estrategicos", "saida", "maior", "soma", "un"],
  ["Número de Upgrades", "estrategicos", "saida", "maior", "soma", "un"],
  ["CAC (Custo de Aquisição de Cliente)", "estrategicos", "saida", "menor", "media", "R$"],
  ["LTV (Valor do Cliente no Tempo)", "estrategicos", "saida", "maior", "media", "R$"],
  ["Crescimento de Audiência", "marketing", "saida", "maior", "soma", "un"],
  ["Volume de Postagens no Orgânico", "marketing", "entrada", "maior", "soma", "un"],
  ["Volume de Criativos Produzidos", "marketing", "entrada", "maior", "soma", "un"],
  ["Crescimento de Engajamento e Alcance", "marketing", "saida", "maior", "media", "%"],
  ["Taxa de 1º Acerto da Área de Conteúdos", "marketing", "saida", "maior", "media", "%"],
  ["Leads Captados", "trafego", "saida", "maior", "soma", "un"],
  ["CPL (Custo por Lead)", "trafego", "saida", "menor", "media", "R$"],
  ["% de Leads Qualificados", "trafego", "saida", "maior", "media", "%"],
  ["Número de Campanhas Criadas", "trafego", "entrada", "maior", "soma", "un"],
  ["ROAS", "trafego", "saida", "maior", "media", "x"],
  ["Verba Investida", "trafego", "entrada", "maior", "soma", "R$"],
  ["Número de Agendamentos", "vendas", "saida", "maior", "soma", "un"],
  ["Número de Calls Realizadas", "vendas", "saida", "maior", "soma", "un"],
  ["Taxa de Conversão", "vendas", "saida", "maior", "media", "%"],
  ["Ticket Médio", "vendas", "saida", "maior", "media", "R$"],
  ["Propostas Enviadas", "vendas", "entrada", "maior", "soma", "un"],
  ["Taxa de Comparecimento (no-show)", "vendas", "saida", "maior", "media", "%"],
  ["Módulos e Aulas Entregues no Prazo", "produto", "saida", "maior", "media", "%"],
  ["Taxa de Conclusão do Curso", "produto", "saida", "maior", "media", "%"],
  ["Engajamento na Área de Membros", "produto", "saida", "maior", "media", "%"],
  ["Número de Erros em Páginas/Funil", "tecnologia", "saida", "menor", "soma", "un"],
  ["Pontuação das Páginas (PageSpeed)", "tecnologia", "saida", "maior", "ultimo", "pts"],
  ["Taxa de 1º Acerto no Prazo", "tecnologia", "saida", "maior", "media", "%"],
  ["Páginas Testadas", "tecnologia", "entrada", "maior", "soma", "un"],
  ["NPS (Net Promoter Score)", "sucesso", "saida", "maior", "media", "pts"],
  ["Número de Contatos por Mês", "sucesso", "entrada", "maior", "media", "un"],
  ["Taxa de Reembolso", "sucesso", "saida", "menor", "media", "%"],
  ["Tempo de Resposta e Resolução", "sucesso", "saida", "menor", "media", "h"],
  ["Taxa de Renovação e Upgrade", "sucesso", "saida", "maior", "media", "%"],
  ["PDAs Entregues no Prazo", "sucesso", "saida", "maior", "media", "%"],
  ["Taxa de Entrega no Prazo", "operacoes", "saida", "maior", "media", "%"],
  ["Tarefas Fora do Escopo", "operacoes", "saida", "menor", "soma", "un"],
  ["Taxa de Erros de Operação", "operacoes", "saida", "menor", "media", "%"],
  ["Custo Operacional por Evento", "operacoes", "saida", "menor", "media", "R$"],
  ["Intercorrências na Agenda", "operacoes", "saida", "menor", "soma", "un"],
  ["Reuniões Realizadas", "operacoes", "entrada", "maior", "soma", "un"],
  ["% de Inadimplência", "financeiro", "saida", "menor", "media", "%"],
  ["Gastos do Mês (Realizado)", "financeiro", "entrada", "menor", "soma", "R$"],
  ["Variação do Orçamento (Orçado × Realizado)", "financeiro", "saida", "menor", "media", "%"],
  ["% do Orçamento Utilizado", "financeiro", "saida", "menor", "ultimo", "%"],
].map(([nome, bloco, tipo, direcao, consolidacao, unidade]) => ({ nome, bloco, tipo, direcao, consolidacao, unidade }));

const farolModelo = (nome) => FAROL_INDICADORES.find((i) => i.nome.toLowerCase() === String(nome || "").trim().toLowerCase());

function farolPreenchidos(ind) { return (ind.valores || []).filter((v) => v !== null && v !== undefined && v !== ""); }
function farolConsolidar(ind) {
  const vals = farolPreenchidos(ind).map(Number).filter((n) => !Number.isNaN(n));
  if (!vals.length) return null;
  if (ind.consolidacao === "soma") return vals.reduce((a, b) => a + b, 0);
  if (ind.consolidacao === "media") return vals.reduce((a, b) => a + b, 0) / vals.length;
  return vals[vals.length - 1];
}
function farolMetaPeriodo(ind, totalSemanas) {
  const meta = Number(ind.meta);
  if (!meta) return null;
  if (ind.consolidacao !== "soma") return meta;
  const feitas = farolPreenchidos(ind).length;
  if (!feitas || feitas >= totalSemanas) return meta;
  return meta * (feitas / totalSemanas);
}
function farolAtingimento(ind, totalSemanas) {
  const atual = farolConsolidar(ind);
  const meta = farolMetaPeriodo(ind, totalSemanas);
  if (atual === null || !meta) return null;
  if (ind.direcao === "menor") return atual === 0 ? 2 : meta / atual;
  return atual / meta;
}
function farolStatus(ind, totalSemanas) {
  const a = farolAtingimento(ind, totalSemanas);
  if (a === null) return "sem-dado";
  if (a >= 1 + FAROL_TOL) return "verde-escuro";
  if (a >= 1 - FAROL_TOL) return "verde-claro";
  return ind.julgamento || "abaixo-indefinido";
}
function farolTextoSobre(hex) {
  const canal = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luz = (h) => {
    const [r, g, b] = [1, 3, 5].map((i) => canal(parseInt(h.slice(i, i + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const razao = (a, b) => { const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  return razao("#1c2128", hex) >= razao("#ffffff", hex) ? "#1c2128" : "#ffffff";
}
function farolFmt(valor, unidade) {
  if (valor === null || valor === undefined || valor === "") return "";
  const n = Number(valor);
  if (Number.isNaN(n)) return "";
  const casas = Math.abs(n) >= 100 || Number.isInteger(n) ? 0 : 1;
  const num = n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  if (unidade === "R$") return "R$ " + num;
  if (unidade === "%") return num + "%";
  if (unidade === "x") return num + "x";
  if (unidade === "un") return num;
  return num + " " + unidade;
}
function farolLerNum(texto) {
  if (texto === null || texto === undefined) return null;
  let limpo = String(texto).replace(/[^\d.,\-]/g, "");
  if (limpo.includes(",")) limpo = limpo.replace(/\./g, "").replace(",", ".");
  else { const p = limpo.split("."); limpo = (p.length === 2 && p[1].length !== 3) ? `${p[0]}.${p[1]}` : p.join(""); }
  if (limpo === "" || limpo === "-") return null;
  const n = Number(limpo);
  return Number.isNaN(n) ? null : n;
}
const farolMesAtual = () => new Date().toISOString().slice(0, 7);
function farolMesAntes(m) {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(y, mm - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function farolMesLabel(m) {
  const [y, mm] = m.split("-").map(Number);
  const nome = MESES[mm - 1] || m;
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} ${y}`;
}
const FAROL_ROT_CONS = { soma: "soma", media: "média", ultimo: "último" };
const FAROL_ANOS = (() => { const a = new Date().getFullYear(); return [a - 2, a - 1, a, a + 1]; })();

function FarolPage({ me }) {
  const setor = "geral"; // quadro único do OS
  const [loading, setLoading] = useState(true);
  const [mes, setMes] = useState(farolMesAtual());
  const [semanas, setSemanas] = useState(4);
  const [rows, setRows] = useState([]);
  const [livre, setLivre] = useState(null); // bloco em modo "criar próprio"
  const [mesesDisp, setMesesDisp] = useState([]); // meses que já têm dados neste setor
  const [comparar, setComparar] = useState([]);   // meses selecionados p/ comparativo
  const [linhasComp, setLinhasComp] = useState(null); // dados do comparativo
  const rowsRef = useRef(rows);
  const timers = useRef({});
  // rowsRef é a fonte síncrona da verdade: efeitos do Preact rodam tarde demais
  // para o flush imediato (mudança de status/julgamento) enxergar o estado novo.
  const commitRows = (next) => { const arr = typeof next === "function" ? next(rowsRef.current) : next; rowsRef.current = arr; setRows(arr); };
  const podeEditar = !me || me.role === "editor" || me.role === "admin";
  const blocosVisiveis = FAROL_BLOCOS;

  const carregarMes = useCallback(async (m) => {
    const { data, error } = await sb.from("farol_indicadores").select("*").eq("setor", setor).eq("mes", m).order("ordem", { ascending: true });
    if (error) notify(errMsg(error), "err");
    rowsRef.current = data || [];
    setRows(data || []);
  }, [setor]);

  const carregarMeses = useCallback(async () => {
    const { data } = await sb.from("farol_indicadores").select("mes").eq("setor", setor);
    setMesesDisp([...new Set((data || []).map((r) => r.mes))].sort());
  }, [setor]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true);
      let cfg = null;
      const r = await sb.from("farol_config").select("*").eq("setor", setor).maybeSingle();
      cfg = r.data;
      if (!cfg && podeEditar) {
        const ins = await sb.from("farol_config").insert({ setor, mes: farolMesAtual(), semanas: 4 }).select().single();
        cfg = ins.data;
      }
      if (!vivo) return;
      const m = (cfg && cfg.mes) || farolMesAtual();
      setMes(m);
      setSemanas((cfg && cfg.semanas) || 4);
      setComparar([]); setLinhasComp(null);
      await Promise.all([carregarMes(m), carregarMeses()]);
      if (vivo) setLoading(false);
    })();
    return () => { vivo = false; };
  }, [setor]);

  // Carrega os dados do comparativo quando 2+ meses estão selecionados.
  useEffect(() => {
    if (comparar.length < 2) { setLinhasComp(null); return; }
    let vivo = true;
    (async () => {
      const { data } = await sb.from("farol_indicadores").select("*").eq("setor", setor).in("mes", comparar);
      if (!vivo) return;
      setLinhasComp(data || []);
    })();
    return () => { vivo = false; };
  }, [comparar.join(","), setor]);

  function patchRow(id, patch, imediato) {
    let merged = null;
    commitRows((rs) => rs.map((r) => {
      if (r.id !== id) return r;
      merged = { ...r, ...(typeof patch === "function" ? patch(r) : patch) };
      return merged;
    }));
    if (!merged) return;
    clearTimeout(timers.current[id]);
    const flush = async () => {
      const { error } = await sb.from("farol_indicadores").update({
        nome: merged.nome, tipo: merged.tipo, direcao: merged.direcao, consolidacao: merged.consolidacao, unidade: merged.unidade,
        meta: merged.meta, responsavel: merged.responsavel, fonte: merged.fonte, obs: merged.obs, julgamento: merged.julgamento, valores: merged.valores,
      }).eq("id", id);
      if (error) notify(errMsg(error), "err");
    };
    if (imediato) flush(); else timers.current[id] = setTimeout(flush, 700);
  }

  async function mudarMes(m) {
    setMes(m); setLoading(true);
    if (podeEditar) await sb.from("farol_config").update({ mes: m, atualizado_em: new Date().toISOString() }).eq("setor", setor);
    await carregarMes(m); setLoading(false);
  }
  async function mudarSemanas(n) {
    setSemanas(n);
    if (podeEditar) await sb.from("farol_config").update({ semanas: n, atualizado_em: new Date().toISOString() }).eq("setor", setor);
    const novas = rowsRef.current.map((r) => ({ ...r, valores: Array.from({ length: n }, (_, i) => (r.valores && r.valores[i] != null ? r.valores[i] : null)) }));
    commitRows(novas);
    for (const r of novas) sb.from("farol_indicadores").update({ valores: r.valores }).eq("id", r.id);
  }

  async function addInd(bloco, nome) {
    const m = farolModelo(nome);
    const doBloco = rows.filter((r) => r.bloco === bloco);
    const ordem = (doBloco.length ? Math.max(...doBloco.map((r) => r.ordem || 0)) : 0) + 1;
    const novo = {
      setor, mes, bloco,
      nome: m ? m.nome : nome, tipo: m ? m.tipo : "saida", direcao: m ? m.direcao : "maior",
      consolidacao: m ? m.consolidacao : "soma", unidade: m ? m.unidade : "un",
      meta: null, responsavel: "", fonte: "", obs: "", julgamento: null,
      valores: Array(semanas).fill(null), ordem,
    };
    const { data, error } = await sb.from("farol_indicadores").insert(novo).select().single();
    if (error) { notify(errMsg(error), "err"); return; }
    commitRows((rs) => [...rs, data]);
    setLivre(null);
    carregarMeses();
  }
  async function delInd(id) {
    if (!confirm("Remover este indicador do farol?")) return;
    const { error } = await sb.from("farol_indicadores").delete().eq("id", id);
    if (error) { notify(errMsg(error), "err"); return; }
    commitRows((rs) => rs.filter((r) => r.id !== id));
  }
  async function duplicarAnterior() {
    const prev = farolMesAntes(mes);
    const { data } = await sb.from("farol_indicadores").select("*").eq("setor", setor).eq("mes", prev).order("ordem");
    if (!data || !data.length) { notify(`${farolMesLabel(prev)} não tem indicadores para copiar.`, "err"); return; }
    const novos = data.map((r) => ({
      setor, mes, bloco: r.bloco, nome: r.nome, tipo: r.tipo, direcao: r.direcao, consolidacao: r.consolidacao,
      unidade: r.unidade, meta: r.meta, responsavel: r.responsavel, fonte: r.fonte,
      obs: "", julgamento: null, valores: Array(semanas).fill(null), ordem: r.ordem,
    }));
    const { data: ins, error } = await sb.from("farol_indicadores").insert(novos).select();
    if (error) { notify(errMsg(error), "err"); return; }
    commitRows((rs) => [...rs, ...ins]);
    carregarMeses();
    notify(`${ins.length} indicadores copiados de ${farolMesLabel(prev)}.`, "ok");
  }

  const toggleComparar = (m) => setComparar((c) => (c.includes(m) ? c.filter((x) => x !== m) : [...c, m].sort()));

  if (loading) return html`<div class="text-sm text-muted"><span class="spinner mr-2"></span>Carregando…</div>`;

  const totalCols = semanas + 8;
  const numInput = "w-full rounded-md border border-line bg-white px-2 py-1 text-right text-sm tabular-nums focus:border-brand focus:outline-none";
  const txtInput = "w-full rounded-md border border-line bg-white px-2 py-1 text-sm focus:border-brand focus:outline-none";
  const miniSel = "rounded border border-line bg-white px-1 py-0.5 text-[11px] text-muted focus:border-brand focus:outline-none";

  // alertas
  const alertas = [];
  if (rows.length) {
    if (!rows.some((r) => r.tipo === "entrada")) alertas.push("Só há métricas de saída. Acrescente ao menos uma de entrada (algo que o time controla: posts publicados, propostas enviadas, calls agendadas) — resultado sempre chega tarde.");
    const semMeta = rows.filter((r) => !r.meta);
    if (semMeta.length) alertas.push(`${semMeta.length} indicador(es) sem meta — sem meta o farol não calcula status.`);
    const semDono = rows.filter((r) => !(r.responsavel || "").trim());
    if (semDono.length) alertas.push(`${semDono.length} indicador(es) sem responsável.`);
    const planoFalta = rows.filter((r) => farolStatus(r, semanas) === "amarelo" && !(r.obs || "").trim());
    if (planoFalta.length) alertas.push(`${planoFalta.length} indicador(es) marcados como "tenho plano" mas sem o plano escrito nas observações.`);
    if (rows.length > 10) alertas.push(`${rows.length} indicadores. O ideal é até 10 por mês — acima disso o painel deixa de ser lido em 5 minutos.`);
  }

  const statusChip = (r) => {
    const st = farolStatus(r, semanas);
    if (st === "abaixo-indefinido") {
      return html`<select class=${miniSel} disabled=${!podeEditar}
        onChange=${(e) => e.target.value && patchRow(r.id, { julgamento: e.target.value }, true)}>
        <option value="">Você tem plano?</option>
        <option value="amarelo">Sim, tenho um plano</option>
        <option value="vermelho">Não sei o que fazer</option>
        <option value="vermelho-escuro">É catástrofe</option>
      </select>`;
    }
    const s = FAROL_STATUS[st];
    const rever = ["amarelo", "vermelho", "vermelho-escuro"].includes(st) && podeEditar;
    return html`<span
      class="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style=${`background:${s.cor};color:${farolTextoSobre(s.cor)};${rever ? "cursor:pointer" : ""}`}
      title=${rever ? "Clique para rever esta classificação" : s.nome}
      onClick=${rever ? () => patchRow(r.id, { julgamento: null }, true) : null}>${s.nome}</span>`;
  };

  const rotuloAndamento = (r) => {
    const base = FAROL_ROT_CONS[r.consolidacao];
    const feitas = farolPreenchidos(r).length;
    if (r.consolidacao !== "soma" || !feitas || feitas >= semanas) return base;
    return `${base} · ${feitas} de ${semanas} sem`;
  };

  return html`
    <div>
      <div class="text-sm text-muted">🚦 Painel de acompanhamento estratégico</div>
      <h1 class="mt-1 text-2xl font-semibold text-ink">Farol do Lucro</h1>
      <p class="mt-1 max-w-3xl text-xs text-muted">
        Você define a meta de cada indicador, preenche o realizado semana a semana e o farol muda de cor sozinho,
        mostrando onde agir antes de o mês fechar. Tudo é salvo automaticamente.
      </p>

      ${(() => {
        const opcoesMes = [...new Set([...(mesesDisp || []), mes])].sort();
        const modoComp = comparar.length >= 2;
        return html`
          <div class="mt-4 rounded-xl border border-line bg-card p-4">
            <div class="text-xs font-medium uppercase tracking-wide text-muted">Comparar meses</div>
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              ${opcoesMes.map((m) => html`
                <button type="button" onClick=${() => toggleComparar(m)}
                  class=${cx("rounded-full border px-2.5 py-1 text-xs transition",
                    comparar.includes(m) ? "border-brand bg-brand-light font-medium text-brand-dark" : "border-line text-ink/60 hover:bg-black/[0.04]")}>
                  ${farolMesLabel(m)}${m === mes ? " ·" : ""}
                </button>`)}
              ${comparar.length ? html`<button type="button" class="ml-1 text-xs text-muted hover:text-ink" onClick=${() => setComparar([])}>limpar</button>` : null}
            </div>
            <p class="mt-1.5 text-[11px] text-muted">
              ${modoComp ? `Comparando ${comparar.length} meses (somente leitura).` : "Selecione 2 ou mais meses para ver o comparativo lado a lado. O ponto (·) marca o mês em edição."}
            </p>
          </div>

          <div class=${cx("mt-3 flex flex-wrap items-end gap-4 rounded-xl border border-line bg-card p-4", modoComp && "opacity-60")}>
            <label class="text-sm">
              <span class="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">Mês em edição</span>
              <div class="flex gap-2">
                <select class=${txtInput} value=${mes.slice(5, 7)} disabled=${!podeEditar || modoComp}
                  onChange=${(e) => mudarMes(mes.slice(0, 4) + "-" + e.target.value)}>
                  ${MESES.map((nm, i) => html`<option value=${String(i + 1).padStart(2, "0")}>${nm.charAt(0).toUpperCase() + nm.slice(1)}</option>`)}
                </select>
                <select class=${txtInput} value=${mes.slice(0, 4)} disabled=${!podeEditar || modoComp}
                  onChange=${(e) => mudarMes(e.target.value + "-" + mes.slice(5, 7))}>
                  ${FAROL_ANOS.map((a) => html`<option value=${String(a)}>${a}</option>`)}
                </select>
              </div>
            </label>
            <label class="text-sm">
              <span class="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">Semanas no mês</span>
              <select class=${txtInput} value=${String(semanas)} disabled=${!podeEditar || modoComp}
                onChange=${(e) => mudarSemanas(Number(e.target.value))}>
                <option value="4">4 semanas</option>
                <option value="5">5 semanas</option>
              </select>
            </label>
            ${podeEditar && !modoComp && !rows.length ? html`
              <${Btn} variant="ghost" onClick=${duplicarAnterior}>Copiar indicadores de ${farolMesLabel(farolMesAntes(mes))}<//>` : null}
          </div>`;
      })()}

      ${comparar.length >= 2 ? html`
        <div class="mt-4 overflow-x-auto rounded-xl border border-line bg-card">
          ${linhasComp === null ? html`<div class="p-6 text-sm text-muted"><span class="spinner mr-2"></span>Carregando comparativo…</div>` : html`
          <table class="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead class="border-b border-line text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th class="px-3 py-2 font-medium">Indicador</th>
                ${[...comparar].sort().map((m) => html`<th class="px-3 py-2 text-right font-medium">${farolMesLabel(m)}</th>`)}
              </tr>
            </thead>
            <tbody>
              ${blocosVisiveis.map((bloco) => {
                const linhasB = (linhasComp || []).filter((r) => r.bloco === bloco.id);
                const nomes = [...new Set(linhasB.map((r) => r.nome))];
                if (!nomes.length) return null;
                const mesesC = [...comparar].sort();
                return [
                  html`<tr class="bg-[#f6f3ee]"><td colspan=${mesesC.length + 1} class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink">${bloco.nome}</td></tr>`,
                  ...nomes.map((nome) => {
                    const byMes = {}; for (const r of linhasB.filter((x) => x.nome === nome)) byMes[r.mes] = r;
                    return html`
                      <tr class="border-b border-line/70">
                        <td class="px-3 py-2 font-medium text-ink">${nome}</td>
                        ${mesesC.map((m) => {
                          const r = byMes[m];
                          if (!r) return html`<td class="px-3 py-2 text-right text-muted">—</td>`;
                          const ts = (r.valores || []).length || 4;
                          const st = farolStatus(r, ts);
                          const val = farolFmt(farolConsolidar(r), r.unidade) || "—";
                          const cor = st === "abaixo-indefinido" ? "#f0d9a8" : (FAROL_STATUS[st] && FAROL_STATUS[st].cor);
                          const pinta = cor && st !== "sem-dado";
                          return html`<td class="px-3 py-2 text-right tabular-nums" style=${pinta ? `background:${cor};color:${farolTextoSobre(cor)}` : ""}>
                            ${val}${r.meta != null ? html`<span class="ml-1 text-[10px] opacity-70">/ ${farolFmt(r.meta, r.unidade)}</span>` : null}
                          </td>`;
                        })}
                      </tr>`;
                  }),
                ];
              })}
            </tbody>
          </table>`}
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
          ${["verde-escuro", "verde-claro", "amarelo", "vermelho", "vermelho-escuro"].map((k) => html`
            <span class="inline-flex items-center gap-1"><span class="h-2.5 w-2.5 rounded" style=${`background:${FAROL_STATUS[k].cor}`}></span>${FAROL_STATUS[k].nome}</span>`)}
          <span>Cada célula: realizado do mês / meta.</span>
        </div>
      ` : html`

      ${alertas.length ? html`
        <div class="mt-3 space-y-1.5">
          ${alertas.map((a) => html`<div class="rounded-lg border border-[#efe9cf] bg-[#faf6e8] px-3 py-2 text-xs text-[#7c7440]">⚠ ${a}</div>`)}
        </div>` : null}

      <div class="mt-4 overflow-x-auto rounded-xl border border-line bg-card">
        <table class="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead class="border-b border-line text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th class="px-3 py-2 font-medium">Indicador</th>
              ${Array.from({ length: semanas }, (_, i) => html`<th class="px-2 py-2 text-right font-medium">Sem ${i + 1}</th>`)}
              <th class="px-2 py-2 text-right font-medium">Mensal</th>
              <th class="px-2 py-2 text-right font-medium">Meta</th>
              <th class="px-2 py-2 font-medium">Status</th>
              <th class="px-2 py-2 font-medium">Responsável</th>
              <th class="px-2 py-2 font-medium">Fonte</th>
              <th class="px-2 py-2 font-medium">Observações / plano</th>
              <th class="px-1 py-2"></th>
            </tr>
          </thead>
          <tbody>
            ${blocosVisiveis.map((bloco) => {
              const doBloco = rows.filter((r) => r.bloco === bloco.id).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
              const cont = {};
              for (const r of doBloco) { const s = farolStatus(r, semanas); cont[s] = (cont[s] || 0) + 1; }
              const usados = new Set(doBloco.map((r) => r.nome.toLowerCase()));
              const opcoes = FAROL_INDICADORES.filter((i) => i.bloco === bloco.id && !usados.has(i.nome.toLowerCase()));
              return [
                html`
                  <tr class="bg-[#f6f3ee]">
                    <td colspan=${totalCols} class="px-3 py-2">
                      <span class="text-xs font-semibold uppercase tracking-wide text-ink">${bloco.nome}</span>
                      ${bloco.descricao ? html`<span class="ml-2 text-[11px] text-muted">${bloco.descricao}</span>` : null}
                      ${doBloco.length ? html`<span class="ml-2 text-[11px]">${Object.entries(cont).map(([k, n]) => html`<span style=${`color:${k === "abaixo-indefinido" ? "#EEB44E" : FAROL_STATUS[k].cor}`}>● </span>${n} `)}</span>` : null}
                    </td>
                  </tr>`,
                ...doBloco.map((r) => html`
                    <tr key=${r.id} class="border-b border-line/70 align-top">
                      <td class="px-3 py-2">
                        <input class=${cx(txtInput, "font-medium")} value=${r.nome} disabled=${!podeEditar}
                          onInput=${(e) => patchRow(r.id, { nome: e.target.value })}
                          onChange=${(e) => { const m = farolModelo(e.target.value); if (m) patchRow(r.id, { nome: m.nome, tipo: m.tipo, direcao: m.direcao, consolidacao: m.consolidacao, unidade: m.unidade }, true); }} />
                        <div class="mt-1 flex flex-wrap gap-1">
                          <select class=${miniSel} value=${r.tipo} disabled=${!podeEditar} onChange=${(e) => patchRow(r.id, { tipo: e.target.value }, true)}>
                            <option value="entrada">entrada</option><option value="saida">saída</option>
                          </select>
                          <select class=${miniSel} value=${r.direcao} disabled=${!podeEditar} onChange=${(e) => patchRow(r.id, { direcao: e.target.value }, true)}>
                            <option value="maior">↑ maior melhor</option><option value="menor">↓ menor melhor</option>
                          </select>
                          <select class=${miniSel} value=${r.consolidacao} disabled=${!podeEditar} onChange=${(e) => patchRow(r.id, { consolidacao: e.target.value }, true)}>
                            <option value="soma">soma</option><option value="media">média</option><option value="ultimo">último</option>
                          </select>
                          <select class=${miniSel} value=${r.unidade} disabled=${!podeEditar} onChange=${(e) => patchRow(r.id, { unidade: e.target.value }, true)}>
                            ${["un", "R$", "%", "x", "pts", "h"].map((u) => html`<option value=${u}>${u}</option>`)}
                          </select>
                        </div>
                      </td>
                      ${Array.from({ length: semanas }, (_, i) => html`
                        <td class="px-1 py-2">
                          <input class=${numInput} inputmode="decimal" disabled=${!podeEditar}
                            value=${r.valores && r.valores[i] != null ? String(r.valores[i]).replace(".", ",") : ""}
                            onInput=${(e) => { const nv = farolLerNum(e.target.value); patchRow(r.id, (row) => { const v = Array.from({ length: semanas }, (_, k) => (row.valores ? row.valores[k] ?? null : null)); v[i] = nv; return { valores: v }; }); }} />
                        </td>`)}
                      <td class="whitespace-nowrap px-2 py-2 text-right">
                        <div class="font-semibold text-ink">${farolFmt(farolConsolidar(r), r.unidade) || "—"}</div>
                        <div class="text-[10px] text-muted">${rotuloAndamento(r)}</div>
                      </td>
                      <td class="px-1 py-2">
                        <input class=${numInput} inputmode="decimal" placeholder="meta" disabled=${!podeEditar}
                          value=${r.meta != null ? String(r.meta).replace(".", ",") : ""}
                          onInput=${(e) => patchRow(r.id, { meta: farolLerNum(e.target.value) })} />
                      </td>
                      <td class="px-2 py-2">${statusChip(r)}</td>
                      <td class="px-2 py-2"><input class=${txtInput} placeholder="quem responde" disabled=${!podeEditar} value=${r.responsavel || ""} onInput=${(e) => patchRow(r.id, { responsavel: e.target.value })} /></td>
                      <td class="px-2 py-2"><input class=${txtInput} placeholder="onde olhar" disabled=${!podeEditar} value=${r.fonte || ""} onInput=${(e) => patchRow(r.id, { fonte: e.target.value })} /></td>
                      <td class="px-2 py-2">
                        <input class=${cx(txtInput, farolStatus(r, semanas) === "amarelo" && !(r.obs || "").trim() && "border-[#EEB44E]")}
                          placeholder=${farolStatus(r, semanas) === "amarelo" ? "escreva o plano de ação" : "observações"}
                          disabled=${!podeEditar} value=${r.obs || ""} onInput=${(e) => patchRow(r.id, { obs: e.target.value })} />
                      </td>
                      <td class="px-1 py-2 text-center">
                        ${podeEditar ? html`<button class="rounded p-1 text-muted hover:bg-black/[0.06] hover:text-[#a44b43]" title="Remover" onClick=${() => delInd(r.id)}>✕</button>` : null}
                      </td>
                    </tr>`),
                podeEditar ? html`
                    <tr key=${"add-" + bloco.id} class="border-b border-line/70">
                      <td colspan=${totalCols} class="px-3 py-2">
                        ${livre === bloco.id ? html`
                          <input class=${cx(txtInput, "max-w-xs")} autofocus placeholder="Nome do indicador e Enter" maxlength="70"
                            onKeyDown=${(e) => { if (e.key === "Enter" && e.target.value.trim()) addInd(bloco.id, e.target.value.trim()); if (e.key === "Escape") setLivre(null); }}
                            onBlur=${(e) => { if (e.target.value.trim()) addInd(bloco.id, e.target.value.trim()); else setLivre(null); }} />`
                        : html`
                          <select class=${cx(miniSel, "max-w-xs text-sm text-ink")}
                            onChange=${(e) => { const v = e.target.value; e.target.value = ""; if (v === "__livre") setLivre(bloco.id); else if (v) addInd(bloco.id, v); }}>
                            <option value="">${doBloco.length ? "+ acrescentar indicador…" : "+ escolher indicador…"}</option>
                            ${opcoes.map((i) => html`<option value=${i.nome}>${i.nome}</option>`)}
                            <option value="__livre">✎ criar indicador próprio…</option>
                          </select>`}
                      </td>
                    </tr>` : null,
              ];
            })}
          </tbody>
        </table>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        ${["verde-escuro", "verde-claro", "amarelo", "vermelho", "vermelho-escuro", "sem-dado"].map((k) => html`
          <span class="inline-flex items-center gap-1"><span class="h-2.5 w-2.5 rounded" style=${`background:${FAROL_STATUS[k].cor}`}></span>${FAROL_STATUS[k].nome}</span>`)}
      </div>
      <p class="mt-2 text-[11px] text-muted">
        “Abaixo, com plano” exige o plano escrito na coluna Observações. Indicador de <b>soma</b> tem a meta proporcional às semanas já lançadas
        (na semana 1 de 4, a régua é ¼ da meta), então o começo do mês não fica vermelho sem motivo.
      </p>
      `}
    </div>`;
}

/* ============================ Pedagógico · Gerador de Materiais (Arenas) ============================ */

const FILA_STATUS = {
  pendente: { label: "Na fila", cls: PILL_WARN },
  processando: { label: "Gerando…", cls: PILL_NEUTRAL },
  pronto: { label: "Pronto", cls: PILL_OK },
  erro: { label: "Erro", cls: PILL_ERR },
};

function fmtMin(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "menos de 1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, "0")}`;
}

// Lista de pedidos das ferramentas de fila (Slides / Materiais). Fica no TOPO da página.
function FilaPedidos({ pedidos, podeEditar, tabela, tarefa, estimativa, minutosEstimados, linhaSecundaria, linksPronto, onMudou }) {
  const minEst = (p) => (minutosEstimados ? minutosEstimados(p) : 10);
  async function gerarAgora(id) {
    try {
      const { error } = await sb.from(tabela).update({ prioridade: true }).eq("id", id);
      if (error) throw error;
      notify("Gerando agora — entra na próxima checagem da fila (a cada 10 min, ou na hora com \"Run now\" em Scheduled).", "ok");
      onMudou && onMudou();
    } catch (e) { notify(errMsg(e), "err"); }
  }
  return html`
    <div>
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-muted">Pedidos</h2>
        <span class="text-[11px] text-muted">Tempo estimado: ${estimativa}</span>
      </div>
      ${pedidos === null
        ? html`<div class="mt-3 text-sm text-muted"><span class="spinner mr-2"></span>Carregando…</div>`
        : pedidos.length === 0
          ? html`<div class="mt-3 rounded-xl border border-dashed border-line bg-card/70 px-4 py-6 text-center text-sm text-muted">Nenhum pedido ainda.</div>`
          : html`<div class="mt-3 space-y-2">
              ${pedidos.map((p) => {
                const st = FILA_STATUS[p.status] || FILA_STATUS.pendente;
                const desdeMs = p.status === "processando" && p.updated_at ? Date.now() - new Date(p.updated_at).getTime() : null;
                const restanteMin = desdeMs != null ? Math.max(1, minEst(p) - Math.round(desdeMs / 60000)) : null;
                return html`
                  <div class="rounded-xl border border-line bg-card p-4">
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <div class="min-w-0">
                        <div class="font-medium text-ink">${p.tema}</div>
                        <div class="text-xs text-muted">${linhaSecundaria(p)} · ${fmtDate(p.created_at, true)}</div>
                      </div>
                      <div class="flex shrink-0 items-center gap-2">
                        ${st.label ? html`<span class=${cx("rounded-full px-2.5 py-1 text-[11px] font-semibold", st.cls)}>${st.label}</span>` : null}
                        ${podeEditar && p.status === "pendente" && !p.prioridade
                          ? html`<${Btn} class="!px-2.5 !py-1 !text-xs" onClick=${() => gerarAgora(p.id)}>▶ Gerar agora<//>` : null}
                      </div>
                    </div>
                    ${p.status === "pendente" && p.prioridade ? html`<div class="mt-1 text-[11px] text-muted">Gerando em breve — previsão: pronto em até ${minEst(p)} min.</div>` : null}
                    ${desdeMs != null ? html`<div class="mt-1 text-[11px] text-muted">gerando há ${fmtMin(desdeMs)} · previsão: mais ~${restanteMin} min</div>` : null}
                    ${p.status === "pronto" ? html`<div class="mt-2 flex flex-wrap gap-2">${linksPronto(p)}</div>` : null}
                    ${p.log ? html`<div class="mt-2 whitespace-pre-wrap text-xs text-muted">${p.log}</div>` : null}
                  </div>`;
              })}
            </div>`}
      <p class="mt-3 text-xs text-muted">
        A geração roda pela tarefa agendada do Claude <code class="rounded bg-black/[0.05] px-1">${tarefa}</code>
        (verifica a fila a cada 10 min; “Gerar agora” prioriza, e “Run now” em Scheduled roda na hora).
      </p>
    </div>`;
}

const ARENA_CATEGORIAS = ["Saúde & Bem-estar", "Família & Relacionamentos", "Vida & Carreira", "Viagens & Cultura", "Cotidiano"];
const ARENA_TEMAS = {
  "Saúde & Bem-estar": ["Healthy Habits", "Sleep Routines", "Stress and Relaxation", "Nutrition and Food Choices", "Body and Self-Care", "Mindfulness and Meditation", "Fitness After 40"],
  "Família & Relacionamentos": ["Family Traditions", "Childhood Memories", "Reconnecting with Friends", "Friendships Over the Years", "Raising Children", "Love and Partnership"],
  "Vida & Carreira": ["Changes in Life After 40", "Career and Work-Life Balance", "New Beginnings", "Hobbies and Passions", "Dreams and Goals", "Financial Independence"],
  "Viagens & Cultura": ["Dream Vacations", "Places I Want to Visit", "Brazilian Traditions", "Exploring Other Cultures", "Travel Tips for Women", "Food Around the World"],
  "Cotidiano": ["A Typical Day", "Cooking and Recipes", "Shopping Habits", "Weekend Plans", "Morning Routines", "Technology in Daily Life"],
};

async function fetchMateriaisPedidos() {
  const { data, error } = await sb.from("materiais_pedidos").select("*").order("created_at", { ascending: false }).limit(40);
  if (error) throw error;
  return data || [];
}

const ARENA_NIVEIS = [
  ["Recém Chegados", "Recém Chegados"],
  ["BIA", "BIA (Básico, Intermediários e Avançados)"],
];

function GeradorMateriaisPage({ me }) {
  const [pedidos, setPedidos] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tema, setTema] = useState("");
  const [categoria, setCategoria] = useState("Sem preferência");
  const [outraCategoria, setOutraCategoria] = useState("");
  const [sugestoes, setSugestoes] = useState(null);
  const [niveis, setNiveis] = useState(new Set(["Recém Chegados", "BIA"]));
  const [outroNivel, setOutroNivel] = useState("");
  const [quantidade, setQuantidade] = useState(1);
  const podeEditar = !me || me.role === "editor" || me.role === "admin";
  const toggleNivel = (n) => setNiveis((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });

  useEffect(() => {
    fetchMateriaisPedidos().then(setPedidos).catch((e) => { notify(errMsg(e), "err"); setPedidos([]); });
    const t = setInterval(() => fetchMateriaisPedidos().then(setPedidos).catch(() => {}), 20000);
    return () => clearInterval(t);
  }, []);

  const usados = new Set((pedidos || []).map((p) => (p.tema || "").trim().toLowerCase()));

  function sugerirTemas() {
    const cats = categoria === "Sem preferência" || outraCategoria.trim() ? ARENA_CATEGORIAS : [categoria];
    const pool = cats.flatMap((c) => ARENA_TEMAS[c] || []).filter((t) => !usados.has(t.toLowerCase()));
    const base = pool.length >= 3 ? pool : cats.flatMap((c) => ARENA_TEMAS[c] || []);
    const shuffled = [...base].sort(() => Math.random() - 0.5);
    setSugestoes(shuffled.slice(0, 3));
  }

  function niveisFinal() {
    const out = [...niveis];
    if (outroNivel.trim()) out.push("Outro: " + outroNivel.trim());
    return out;
  }

  async function enviar(e) {
    e && e.preventDefault();
    const temaFinal = tema.trim();
    if (!temaFinal) return notify("Escolha ou digite o tema da semana (use “Sugerir 3 temas” se estiver em dúvida).", "err");
    const nvs = niveisFinal();
    if (!nvs.length) return notify("Escolha ao menos um nível de Arena.", "err");
    setBusy(true);
    try {
      const catFinal = outraCategoria.trim() || categoria;
      const { error } = await sb.from("materiais_pedidos").insert({
        criado_por: me ? me.id : null,
        tema: temaFinal,
        categoria: catFinal,
        niveis: nvs,
        quantidade,
        briefing: { tema: temaFinal, categoria: catFinal, temaLivre: !!tema.trim(), niveis: nvs, quantidade },
      });
      if (error) throw error;
      const total = nvs.length * quantidade;
      notify(`Pedido enviado. ${total} material(is) na fila (${quantidade} por nível × ${nvs.length}).`, "ok");
      setTema(""); setSugestoes(null);
      fetchMateriaisPedidos().then(setPedidos).catch(() => {});
    } catch (e2) { notify(errMsg(e2), "err"); }
    finally { setBusy(false); }
  }

  return html`
    <div class="max-w-2xl">
      <div class="text-sm text-muted">🎓 Pedagógico</div>
      <h1 class="mt-1 text-2xl font-semibold text-ink">Gerador de Materiais</h1>
      <p class="mt-1 text-sm text-muted">
        Materiais das <b>Arenas de Conversação</b>, no mesmo tema da semana. Você escolhe os níveis
        (<b>Recém Chegados</b> — 4 páginas com Reading Practice; <b>BIA</b> — 3 páginas) e quantos materiais
        por nível. Seguem as skills do Método (metodologia, tia-do-ingles-materials, avatar, marca e MYPA).
      </p>

      <div class="mt-5">
        <${FilaPedidos} pedidos=${pedidos} podeEditar=${podeEditar} tabela="materiais_pedidos" tarefa="gerar-materiais-os"
          estimativa="cerca de 5-10 min por material gerado"
          minutosEstimados=${(p) => Math.max(10, (((p.niveis || []).length) * (p.quantidade || 1)) * 5)}
          onMudou=${() => fetchMateriaisPedidos().then(setPedidos).catch(() => {})}
          linhaSecundaria=${(p) => [(p.niveis || []).join(" + "), (p.quantidade ? p.quantidade + "x por nível" : null), p.categoria].filter(Boolean).join(" · ")}
          linksPronto=${(p) => html`
            ${p.zip_url ? html`<${Btn} as="a" href=${p.zip_url} download class="!px-3 !py-1.5 !text-xs">⬇ Fazer download<//>` : null}
            ${(p.entregaveis || []).map((d) => html`<${Btn} as="a" variant="ghost" href=${d.url} target="_blank" rel="noopener" class="!px-3 !py-1.5 !text-xs">${d.nome} ↗<//>`)}
            ${!p.zip_url && p.pdf_recem_url ? html`<${Btn} as="a" variant="ghost" href=${p.pdf_recem_url} target="_blank" rel="noopener" class="!px-3 !py-1.5 !text-xs">Recém Chegados (PDF) ↗<//>` : null}
            ${!p.zip_url && p.pdf_bia_url ? html`<${Btn} as="a" variant="ghost" href=${p.pdf_bia_url} target="_blank" rel="noopener" class="!px-3 !py-1.5 !text-xs">BIA (PDF) ↗<//>` : null}`} />
      </div>

      ${!podeEditar ? null : html`
      <form onSubmit=${enviar} class="mt-6 rounded-2xl border border-line bg-card p-5">
        <div>
          <div class="text-sm font-medium text-ink">1. Tema da semana <span class="font-normal text-muted">(opcional)</span></div>
          <div class="mt-0.5 text-xs text-muted">Se já sabe o tema, escreva aqui — o resto do formulário é ignorado. Ex.: “Dream Vacations”, “Morning Routines”.</div>
          <input class=${cx(inputCls, "mt-2")} placeholder="Tema da semana" value=${tema} onInput=${(e) => setTema(e.target.value)} />
        </div>

        <div class=${cx("mt-4 border-t border-line pt-4", tema.trim() && "opacity-50")}>
          <div class="text-sm font-medium text-ink">2. Categoria preferida</div>
          <div class="mt-0.5 text-xs text-muted">Só é usada se o tema acima ficar em branco.</div>
          <div class="mt-2">
            ${[...ARENA_CATEGORIAS, "Sem preferência (deixar o sistema escolher)"].map((c) => {
              const val = c.startsWith("Sem preferência") ? "Sem preferência" : c;
              return html`<${SlidesOpc} on=${categoria === val && !outraCategoria.trim()} click=${() => { setCategoria(val); setOutraCategoria(""); setSugestoes(null); }}>${c}<//>`;
            })}
          </div>
          <input class=${cx(inputCls, "mt-1 max-w-xs")} placeholder="Outra categoria" value=${outraCategoria}
            onInput=${(e) => { setOutraCategoria(e.target.value); setSugestoes(null); }} />

          <div class="mt-3">
            <${Btn} variant="ghost" type="button" onClick=${sugerirTemas} disabled=${!!tema.trim()}>Sugerir 3 temas<//>
          </div>
          ${sugestoes ? html`
            <div class="mt-2 flex flex-wrap gap-2">
              ${sugestoes.map((s) => html`
                <button type="button" onClick=${() => setTema(s)}
                  class="rounded-lg border border-brand/50 bg-brand-light px-3 py-1.5 text-sm font-medium text-brand-dark hover:bg-brand-light/70">${s}</button>`)}
            </div>
            <div class="mt-1 text-[11px] text-muted">Clique num tema para usá-lo, ou gere outras 3 opções.</div>` : null}
        </div>

        <div class="mt-4 border-t border-line pt-4">
          <div class="text-sm font-medium text-ink">3. Nível das Arenas de Conversação <span class="text-brand">*</span></div>
          <div class="mt-0.5 text-xs text-muted">Pode marcar mais de um.</div>
          <div class="mt-2">
            ${ARENA_NIVEIS.map(([v, l]) => html`<${SlidesOpc} on=${niveis.has(v)} click=${() => toggleNivel(v)}>${l}<//>`)}
            <${SlidesOpc} on=${outroNivel !== ""} click=${() => setOutroNivel(outroNivel !== "" ? "" : " ")}>Outro<//>
          </div>
          <input class=${cx(inputCls, "mt-1 max-w-sm")} placeholder="Outro nível — descreva (ex.: “A2/B1 específico”)"
            value=${outroNivel} onInput=${(e) => setOutroNivel(e.target.value)} />
        </div>

        <div class="mt-4 border-t border-line pt-4">
          <div class="text-sm font-medium text-ink">4. Quantidade de Materiais <span class="text-brand">*</span></div>
          <div class="mt-0.5 text-xs text-muted">
            Nº de materiais <b>por nível</b>. Ex.: 2 com “Recém Chegados” e “BIA” marcados = 4 materiais no total.
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => html`<${SlidesOpc} on=${quantidade === n} click=${() => setQuantidade(n)}>${n}<//>`)}
          </div>
          <div class="mt-1.5 text-[11px] text-muted">
            Total agora: <b>${(niveisFinal().length || 0) * quantidade}</b> material(is) — ${quantidade}× por nível, ${niveisFinal().length || 0} nível(is).
          </div>
        </div>

        <div class="mt-5 flex items-center gap-3">
          <${Btn} type="submit" loading=${busy}>${tema.trim() ? `Gerar materiais — “${tema.trim()}”` : "Gerar materiais"}<//>
          <span class="text-xs text-muted">Zero emojis, tom adulto e acolhedor — regras de marca aplicadas sempre.</span>
        </div>
      </form>`}
    </div>`;
}

/* ============================ Pedagógico · Gerador de Slides ============================ */

async function fetchSlidesPedidos() {
  const { data, error } = await sb.from("slides_pedidos").select("*").order("created_at", { ascending: false }).limit(40);
  if (error) throw error;
  return data || [];
}

// Definidos fora do componente: se ficassem dentro de GeradorSlidesPage, cada
// render criaria uma função nova → o Preact remontaria a árvore e o campo
// perderia o foco a cada tecla.
function SlidesOpc({ on, click, children }) {
  return html`
    <button type="button" onClick=${click}
      class=${cx("mb-1.5 mr-1.5 rounded-lg border px-3 py-1.5 text-sm transition",
        on ? "border-brand bg-brand-light font-medium text-brand-dark" : "border-line text-ink/70 hover:bg-black/[0.04]")}>${children}</button>`;
}
function SlidesGrupo({ label, obrig, hint, children }) {
  return html`
    <div class="border-t border-line pt-4">
      <div class="text-sm font-medium text-ink">${label}${obrig ? html`<span class="text-brand"> *</span>` : null}</div>
      ${hint ? html`<div class="mt-0.5 text-xs text-muted">${hint}</div>` : null}
      <div class="mt-2">${children}</div>
    </div>`;
}

function GeradorSlidesPage({ me }) {
  const [pedidos, setPedidos] = useState(null);
  const [busy, setBusy] = useState(false);
  const podeEditar = !me || me.role === "editor" || me.role === "admin";

  const [f, setF] = useState({
    tema: "", duracao: "60 min", duracaoOutro: "", nivel: "", nivelOutro: "",
    qtdExercicios: "5", qtdOutro: "", habilidades: [], habilidadeOutra: "",
    objetivo: "", objetivoTexto: "", pontoEspecifico: "",
    contexto: "Sem preferência", contextoOutro: "",
    material: "Não tenho material de referência", materialTexto: "",
    deckRef: 'Usar o modelo padrão ("Modais")', deckRefTexto: "",
    comparacao: "Sim, se fizer sentido", comparacaoTexto: "",
    trocaPeca: "Sim, se fizer sentido", trocaPecaTexto: "",
    quiz: "Sim, 3 perguntas", quizNum: "",
    desafio: "Sim", desafioTexto: "",
    nomeAula: "", fluxo: "",
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const toggleArr = (k, v) => setF((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));

  useEffect(() => {
    fetchSlidesPedidos().then(setPedidos).catch((e) => { notify(errMsg(e), "err"); setPedidos([]); });
    const t = setInterval(() => fetchSlidesPedidos().then(setPedidos).catch(() => {}), 20000);
    return () => clearInterval(t);
  }, []);

  async function enviar(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await sb.from("slides_pedidos").insert({
        criado_por: me ? me.id : null,
        tema: f.tema.trim() || "A definir pela IA a partir do briefing",
        nivel: f.nivelOutro.trim() || f.nivel || null,
        duracao: f.duracaoOutro.trim() ? f.duracaoOutro.trim() + " min" : (f.duracao || null),
        fluxo: f.fluxo || null,
        briefing: f,
      });
      if (error) throw error;
      notify("Pedido enviado. A geração entra na fila e aparece aqui quando ficar pronta.", "ok");
      setF((s) => ({ ...s, tema: "", objetivoTexto: "", pontoEspecifico: "", nomeAula: "", comparacaoTexto: "", trocaPecaTexto: "", desafioTexto: "", materialTexto: "" }));
      fetchSlidesPedidos().then(setPedidos).catch(() => {});
    } catch (e2) { notify(errMsg(e2), "err"); }
    finally { setBusy(false); }
  }

  const outroInput = (k, ph, num) => html`<input class=${cx(inputCls, "mt-1 max-w-xs")} inputmode=${num ? "numeric" : "text"}
    placeholder=${ph} value=${f[k]} onInput=${(e) => set(k, e.target.value)} />`;

  return html`
    <div class="max-w-3xl">
      <div class="text-sm text-muted">🎓 Pedagógico</div>
      <h1 class="mt-1 text-2xl font-semibold text-ink">Gerador de Slides</h1>
      <p class="mt-1 text-sm text-muted">
        Preencha o briefing da aula. Ao enviar, a geração do deck de slides no Canva entra na fila —
        seguindo as skills do Método (metodologia, avatar, marca, MYPA e <i>slides</i>). Se for parte do
        fluxo semanal, também são gerados resumo, quiz de 18, tarefa em vídeo e perguntas do Lab.
      </p>

      <div class="mt-5">
        <${FilaPedidos} pedidos=${pedidos} podeEditar=${podeEditar} tabela="slides_pedidos" tarefa="gerar-slides-os"
          estimativa="cerca de 10 min (aula avulsa) a 20 min (fluxo semanal)"
          minutosEstimados=${(p) => (p.fluxo === "semanal" ? 20 : 10)}
          onMudou=${() => fetchSlidesPedidos().then(setPedidos).catch(() => {})}
          linhaSecundaria=${(p) => [p.nivel, p.duracao, p.fluxo === "semanal" ? "fluxo semanal" : "avulsa"].filter(Boolean).join(" · ")}
          linksPronto=${(p) => html`
            ${p.pptx_url ? html`<${Btn} as="a" href=${p.pptx_url} download class="!px-3 !py-1.5 !text-xs">⬇ Fazer download<//>` : null}
            ${p.canva_edit_url ? html`<${Btn} as="a" variant="ghost" href=${p.canva_edit_url} target="_blank" rel="noopener" class="!px-3 !py-1.5 !text-xs">Abrir no Canva ↗<//>` : null}
            ${(p.entregaveis || []).map((d) => html`<${Btn} as="a" variant="ghost" href=${d.url} target="_blank" rel="noopener" class="!px-3 !py-1.5 !text-xs">${d.nome} ↗<//>`)}`} />
      </div>

      ${!podeEditar ? null : html`
      <form onSubmit=${enviar} class="mt-6 rounded-2xl border border-line bg-card p-5">
        <div>
          <div class="text-sm font-medium text-ink">1. Tema da aula</div>
          <input class=${cx(inputCls, "mt-2")} placeholder='Ex.: "Present Perfect", "Phrasal Verbs de viagem"'
            value=${f.tema} onInput=${(e) => set("tema", e.target.value)} />
        </div>

        <${SlidesGrupo} label="2. Duração da aula">
          ${["30 min", "45 min", "60 min", "90 min"].map((o) => html`<${SlidesOpc} on=${f.duracao === o && !f.duracaoOutro} click=${() => setF((s) => ({ ...s, duracao: o, duracaoOutro: "" }))}>${o}<//>`)}
          ${outroInput("duracaoOutro", "Outro (minutos)", true)}
        <//>

        <${SlidesGrupo} label="3. Nível dos alunos">
          ${["Básico", "Intermediário", "Avançado", "Todos os níveis (turma mista)"].map((o) => html`<${SlidesOpc} on=${f.nivel === o && !f.nivelOutro} click=${() => setF((s) => ({ ...s, nivel: o, nivelOutro: "" }))}>${o}<//>`)}
          ${outroInput("nivelOutro", 'Outro (ex.: "A2/B1 específico")')}
        <//>

        <${SlidesGrupo} label="4. Quantidade de exercícios">
          ${["3", "5", "8", "10"].map((o) => html`<${SlidesOpc} on=${f.qtdExercicios === o && !f.qtdOutro} click=${() => setF((s) => ({ ...s, qtdExercicios: o, qtdOutro: "" }))}>${o}<//>`)}
          ${outroInput("qtdOutro", "Outro (número)", true)}
        <//>

        <${SlidesGrupo} label="5. Habilidades a trabalhar" hint="Seleção múltipla permitida">
          ${["Listening", "Speaking", "Pronúncia", "Vocabulário", "Reading", "Todas"].map((o) => html`<${SlidesOpc} on=${f.habilidades.includes(o)} click=${() => toggleArr("habilidades", o)}>${o}<//>`)}
          ${outroInput("habilidadeOutra", "Outra habilidade (ex.: Writing)")}
        <//>

        <${SlidesGrupo} label="6. Objetivo principal da aula" hint="Marque um botão E descreva com suas palavras — a descrição é o que mais pesa na qualidade final.">
          ${["Aprender uma estrutura gramatical nova", "Ampliar vocabulário para um contexto específico", "Corrigir um erro comum dos alunos", "Praticar conversação/fluência"].map((o) => html`<${SlidesOpc} on=${f.objetivo === o} click=${() => set("objetivo", o)}>${o}<//>`)}
          <textarea class=${cx(inputCls, "mt-2 min-h-[80px]")} placeholder="Descreva o objetivo com suas palavras (opcional, mas ajuda bastante)"
            value=${f.objetivoTexto} onInput=${(e) => set("objetivoTexto", e.target.value)}></textarea>
        <//>

        <${SlidesGrupo} label="7. Ponto específico a destacar" hint='Ex.: "diferença entre passado simples e present perfect", "erro comum de trocar make por do".'>
          <textarea class=${cx(inputCls, "min-h-[64px]")} value=${f.pontoEspecifico} onInput=${(e) => set("pontoEspecifico", e.target.value)}></textarea>
        <//>

        <${SlidesGrupo} label="8. Contexto de vida real prioritário" hint="Nunca religião, política ou temas polêmicos.">
          ${["Viagem", "Trabalho", "Família", "Autoconhecimento", "Humor", "Atualidades", "Sem preferência"].map((o) => html`<${SlidesOpc} on=${f.contexto === o && !f.contextoOutro} click=${() => setF((s) => ({ ...s, contexto: o, contextoOutro: "" }))}>${o}<//>`)}
          ${outroInput("contextoOutro", "Outro contexto")}
        <//>

        <${SlidesGrupo} label="9. Material de referência">
          ${["Não tenho material de referência", "Tenho vídeo/áudio/transcrição para basear a aula"].map((o) => html`<${SlidesOpc} on=${f.material === o} click=${() => set("material", o)}>${o}<//>`)}
          ${f.material.startsWith("Tenho") ? html`<textarea class=${cx(inputCls, "mt-1 min-h-[64px]")} placeholder="Cole o link ou o conteúdo/descrição do material" value=${f.materialTexto} onInput=${(e) => set("materialTexto", e.target.value)}></textarea>` : null}
        <//>

        <${SlidesGrupo} label="10. Deck de referência do Canva a clonar">
          ${['Usar o modelo padrão ("Modais")', "Escolher outro deck de referência"].map((o) => html`<${SlidesOpc} on=${f.deckRef === o} click=${() => set("deckRef", o)}>${o}<//>`)}
          ${f.deckRef.startsWith("Escolher") ? html`<input class=${cx(inputCls, "mt-1")} placeholder="URL ou ID do design no Canva (se deixar em branco, usamos o modelo padrão)" value=${f.deckRefTexto} onInput=${(e) => set("deckRefTexto", e.target.value)} />` : null}
        <//>

        <${SlidesGrupo} label='11. Incluir página de comparação ("X vs. Y")?'>
          ${["Sim, se fizer sentido", "Não incluir"].map((o) => html`<${SlidesOpc} on=${f.comparacao === o} click=${() => set("comparacao", o)}>${o}<//>`)}
          <input class=${cx(inputCls, "mt-1 max-w-md")} placeholder='Qual contraste? (ex.: "Regulares vs. Irregulares")' value=${f.comparacaoTexto} onInput=${(e) => set("comparacaoTexto", e.target.value)} />
        <//>

        <${SlidesGrupo} label='12. Incluir exercício "Troque a Peça" (LEGO Approach)?'>
          ${["Sim, se fizer sentido", "Não incluir"].map((o) => html`<${SlidesOpc} on=${f.trocaPeca === o} click=${() => set("trocaPeca", o)}>${o}<//>`)}
          <input class=${cx(inputCls, "mt-1 max-w-md")} placeholder="Sugestão de frase-base (opcional)" value=${f.trocaPecaTexto} onInput=${(e) => set("trocaPecaTexto", e.target.value)} />
        <//>

        <${SlidesGrupo} label="13. Incluir quiz final?">
          ${["Sim, 3 perguntas", "Sim, com outro número de perguntas", "Não incluir"].map((o) => html`<${SlidesOpc} on=${f.quiz === o} click=${() => set("quiz", o)}>${o}<//>`)}
          ${f.quiz.startsWith("Sim, com outro") ? outroInput("quizNum", "Quantas perguntas?", true) : null}
        <//>

        <${SlidesGrupo} label="14. Incluir slide de desafio/CTA final?">
          ${["Sim", "Não"].map((o) => html`<${SlidesOpc} on=${f.desafio === o} click=${() => set("desafio", o)}>${o}<//>`)}
          <input class=${cx(inputCls, "mt-1")} placeholder='Texto do desafio (ex.: "poste nos comentários e marque @tiadoingles")' value=${f.desafioTexto} onInput=${(e) => set("desafioTexto", e.target.value)} />
        <//>

        <${SlidesGrupo} label="15. Nome/número da aula" hint="Rodapé dos slides e nome do arquivo. Em branco = gerado do tema.">
          <input class=${cx(inputCls, "max-w-md")} placeholder='Ex.: "Aula 12 — Present Perfect"' value=${f.nomeAula} onInput=${(e) => set("nomeAula", e.target.value)} />
        <//>

        <${SlidesGrupo} label="16. Aula avulsa ou parte do fluxo semanal?">
          ${[["avulsa", "Aula avulsa (só os slides)"], ["semanal", "Parte do fluxo semanal (slides + resumo + quiz de 18 + tarefa em vídeo + perguntas do Lab)"]].map(([v, l]) => html`<${SlidesOpc} on=${f.fluxo === v} click=${() => set("fluxo", v)}>${l}<//>`)}
        <//>

        <div class="mt-5 flex items-center gap-3">
          <${Btn} type="submit" loading=${busy}>Enviar para geração<//>
          <span class="text-xs text-muted">Sem emojis, sem diminutivos, tom adulto e acolhedor — regras de marca aplicadas sempre.</span>
        </div>
      </form>`}
    </div>`;
}

/* ============================ App externo incorporado ============================ */

// Incorpora um app externo em iframe, ocupando a área toda, com barra de "voltar".
function EmbedExterno({ titulo, icone, src }) {
  const [erro, setErro] = useState(false);
  return html`
    <div class="flex h-screen flex-col">
      <div class="flex items-center justify-between gap-3 border-b border-line bg-sidebar px-4 py-2.5">
        <div class="flex items-center gap-2 text-sm">
          <a href="#/" class="font-medium text-brand hover:underline">← OS</a>
          <span class="text-muted">/</span>
          <span class="font-medium text-ink">${icone} ${titulo}</span>
        </div>
        <a href=${src} target="_blank" rel="noopener" class="text-xs text-muted hover:text-ink">abrir em nova aba ↗</a>
      </div>
      <div class="relative flex-1">
        <iframe src=${src} class="absolute inset-0 h-full w-full border-0"
          allow="clipboard-write; clipboard-read; fullscreen; microphone; camera"
          onError=${() => setErro(true)}
          title=${titulo}></iframe>
        ${erro ? html`
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg p-6 text-center text-sm text-muted">
            <div>Não foi possível carregar o app aqui dentro.</div>
            <${Btn} as="a" href=${src} target="_blank" rel="noopener">Abrir em nova aba ↗<//>
          </div>` : null}
      </div>
    </div>`;
}

/* ============================ Início (HOME) + Agenda ============================ */

const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const DIAS_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const TIPO_EVENTO = {
  evento: { label: "Evento", cls: "bg-[#e7eef4] text-[#456179]", dot: "bg-[#6b8aa3]" },
  marco: { label: "Marco", cls: "bg-brand-light text-brand-dark", dot: "bg-brand" },
  lembrete: { label: "Lembrete", cls: "bg-[#efe9cf] text-[#7c7440]", dot: "bg-[#bfa94e]" },
};

function isoDia(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function hojeISO() { return isoDia(new Date()); }
function somaDias(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const x = new Date(y, m - 1, d + n);
  return isoDia(x);
}
function fmtDiaLongo(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const s = `${DIAS_SEMANA[dt.getDay()]}, ${d} de ${MESES[m - 1]} de ${y}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function fmtDiaCurto(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

// Domingo de Páscoa (algoritmo de Meeus/Butcher) e feriados nacionais do ano.
function domingoDePascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mth = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * mth + 114) / 31);
  const dia = ((h + l - 7 * mth + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}
function feriadosNacionais(ano) {
  const p = domingoDePascoa(ano);
  const rel = (off) => isoDia(new Date(p.getFullYear(), p.getMonth(), p.getDate() + off));
  return [
    { data: `${ano}-01-01`, nome: "Confraternização Universal", facultativo: false },
    { data: rel(-48), nome: "Carnaval", facultativo: true },
    { data: rel(-47), nome: "Carnaval", facultativo: true },
    { data: rel(-46), nome: "Quarta-feira de Cinzas", facultativo: true },
    { data: rel(-2), nome: "Sexta-feira Santa", facultativo: false },
    { data: `${ano}-04-21`, nome: "Tiradentes", facultativo: false },
    { data: `${ano}-05-01`, nome: "Dia do Trabalho", facultativo: false },
    { data: rel(60), nome: "Corpus Christi", facultativo: true },
    { data: `${ano}-09-07`, nome: "Independência do Brasil", facultativo: false },
    { data: `${ano}-10-12`, nome: "Nossa Senhora Aparecida", facultativo: false },
    { data: `${ano}-11-02`, nome: "Finados", facultativo: false },
    { data: `${ano}-11-15`, nome: "Proclamação da República", facultativo: false },
    { data: `${ano}-11-20`, nome: "Dia da Consciência Negra", facultativo: false },
    { data: `${ano}-12-25`, nome: "Natal", facultativo: false },
  ];
}
function feriadosNoIntervalo(deISO, ateISO) {
  const anos = new Set([Number(deISO.slice(0, 4)), Number(ateISO.slice(0, 4))]);
  const out = [];
  for (const ano of anos) for (const f of feriadosNacionais(ano)) {
    if (f.data >= deISO && f.data <= ateISO) out.push(f);
  }
  return out.sort((a, b) => a.data.localeCompare(b.data));
}

async function fetchEventos(deISO, ateISO) {
  const { data, error } = await sb
    .from("agenda_eventos")
    .select("*")
    .gte("data", deISO)
    .lte("data", ateISO)
    .order("data", { ascending: true });
  if (error) throw error;
  return data || [];
}

function HomePage({ me, sections }) {
  const [data, setData] = useState(null);
  const hoje = hojeISO();
  const fimSemana = somaDias(hoje, 7);

  useEffect(() => {
    (async () => {
      try {
        const [ev, pesq, conteudo, docs, ferr] = await Promise.all([
          fetchEventos(hoje, fimSemana),
          sb.from("pesquisa_avatar").select("chave,ativo,total_respostas,ultima_resposta_em,janela_dias"),
          sb.from("conteudo_calendario").select("data_programada,views_7d,atualizado_em"),
          sb.from("kb_documents").select("id", { count: "exact", head: true }),
          sb.from("os_ferramentas").select("status"),
        ]);
        setData({
          eventos: ev,
          pesquisas: pesq.data || [],
          conteudo: conteudo.data || [],
          docCount: docs.count || 0,
          ferramentas: ferr.data || [],
        });
      } catch (e) { notify(errMsg(e), "err"); setData({ eventos: [], pesquisas: [], conteudo: [], docCount: 0, ferramentas: [] }); }
    })();
  }, []);

  const feriados = feriadosNoIntervalo(hoje, fimSemana);
  const nome1 = (me && (me.nome || "").trim().split(/\s+/)[0]) || "";

  const itensDoDia = (iso) => {
    const fer = feriados.filter((f) => f.data === iso).map((f) => ({ tipo: "feriado", titulo: f.nome, facultativo: f.facultativo }));
    const evs = (data ? data.eventos : []).filter((e) => e.data === iso)
      .map((e) => ({ tipo: "evento", ...e }));
    return [...fer, ...evs];
  };

  const semana = [];
  for (let i = 0; i < 7; i++) {
    const iso = somaDias(hoje, i);
    const it = data ? itensDoDia(iso) : [];
    if (it.length) semana.push({ iso, itens: it });
  }

  const pAtivas = data ? data.pesquisas.filter((r) => r.total_respostas && (r.ativo || (r.ultima_resposta_em && Date.now() - new Date(r.ultima_resposta_em).getTime() < (r.janela_dias || 30) * 86400000))).length : 0;
  const ferrErro = data ? data.ferramentas.filter((f) => f.status === "erro").length : 0;
  const cont30 = (() => {
    if (!data || !data.conteudo) return { posts: 0, views: 0 };
    const lim = somaDias(hoje, -30);
    const rec = data.conteudo.filter((r) => r.data_programada && r.data_programada >= lim && r.data_programada <= hoje && r.views_7d != null);
    return { posts: rec.length, views: rec.reduce((a, r) => a + (Number(r.views_7d) || 0), 0) };
  })();

  const Chip = ({ it }) => {
    if (it.tipo === "feriado") {
      return html`<span class=${cx("inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium", it.facultativo ? "bg-[#efe9cf] text-[#7c7440]" : "bg-[#f4e0db] text-[#a44b43]")}>
        <span>${it.facultativo ? "🟡" : "🇧🇷"}</span>${it.titulo}${it.facultativo ? " (facultativo)" : ""}</span>`;
    }
    const t = TIPO_EVENTO[it.tipo] || TIPO_EVENTO.evento;
    return html`<span class=${cx("inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium", t.cls)}>
      <span class=${cx("h-1.5 w-1.5 rounded-full", t.dot)}></span>${it.hora ? it.hora + " · " : ""}${it.titulo}</span>`;
  };

  return html`
    <div>
      <div class="text-sm text-muted">🏠 Início</div>
      <h1 class="mt-1 text-2xl font-semibold text-ink">Boas-vindas ao OS Tia do Inglês${nome1 ? `, ${nome1}` : ""} 👋</h1>
      <p class="mt-1 text-sm text-muted">${fmtDiaLongo(hoje)}</p>

      ${!data ? html`<div class="mt-6 text-sm text-muted"><span class="spinner mr-2"></span>Carregando…</div>` : html`
        <div class="mt-6 grid gap-4 lg:grid-cols-2">
          <div class="rounded-2xl border border-line bg-card p-5">
            <div class="text-sm font-semibold uppercase tracking-wider text-muted">Hoje</div>
            ${(() => {
              const it = itensDoDia(hoje);
              return it.length
                ? html`<div class="mt-3 flex flex-wrap gap-2">${it.map((x) => html`<${Chip} it=${x} />`)}</div>`
                : html`<p class="mt-3 text-sm text-muted">Nenhum feriado ou evento hoje. Dia livre para focar no que importa. 💪</p>`;
            })()}
          </div>

          <div class="rounded-2xl border border-line bg-card p-5">
            <div class="text-sm font-semibold uppercase tracking-wider text-muted">Próximos 7 dias</div>
            ${semana.filter((d) => d.iso !== hoje).length
              ? html`<ul class="mt-3 space-y-2.5">
                  ${semana.filter((d) => d.iso !== hoje).map((d) => html`
                    <li class="flex flex-wrap items-start gap-2">
                      <span class="mt-1 w-12 shrink-0 text-xs font-medium text-muted">${fmtDiaCurto(d.iso)}</span>
                      <span class="flex flex-wrap gap-2">${d.itens.map((x) => html`<${Chip} it=${x} />`)}</span>
                    </li>`)}
                </ul>`
              : html`<p class="mt-3 text-sm text-muted">Semana sem feriados ou eventos cadastrados.</p>`}
            <a href="#/agenda/calendario" class="mt-3 inline-block text-xs font-medium text-brand hover:underline">Abrir o calendário →</a>
          </div>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <a href="#/base" class="rounded-xl border border-line bg-card p-4 transition hover:border-brand/40">
            <div class="text-xs uppercase tracking-wide text-muted">Base de Conhecimento</div>
            <div class="mt-1 text-2xl font-semibold text-ink">${nf(data.docCount)}</div>
            <div class="text-xs text-muted">documentos</div>
          </a>
          <a href="#/cs/pesquisas" class="rounded-xl border border-line bg-card p-4 transition hover:border-brand/40">
            <div class="text-xs uppercase tracking-wide text-muted">Pesquisas de alunos</div>
            <div class="mt-1 text-2xl font-semibold text-ink">${pAtivas}/6</div>
            <div class="text-xs text-muted">ativas</div>
          </a>
          <a href="#/conteudo/metricas" class="rounded-xl border border-line bg-card p-4 transition hover:border-brand/40">
            <div class="text-xs uppercase tracking-wide text-muted">Conteúdo (30 dias)</div>
            <div class="mt-1 text-2xl font-semibold text-ink">${nf(cont30.posts)}</div>
            <div class="text-xs text-muted">posts · ${nfShort(cont30.views)} views 7d</div>
          </a>
          <a href="#/ferramentas" class="rounded-xl border border-line bg-card p-4 transition hover:border-brand/40">
            <div class="text-xs uppercase tracking-wide text-muted">Ferramentas</div>
            <div class=${cx("mt-1 text-2xl font-semibold", ferrErro ? "text-[#a44b43]" : "text-ink")}>${ferrErro ? ferrErro : "OK"}</div>
            <div class="text-xs text-muted">${ferrErro ? "com erro" : "tudo conectado"}</div>
          </a>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <a href="#/pedir-ia" class="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink/80 hover:border-brand/40">✨ Pedir a IA</a>
          <a href="#/base" class="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink/80 hover:border-brand/40">📚 Base de Conhecimento</a>
          <a href="#/agenda/calendario" class="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink/80 hover:border-brand/40">📅 Calendário</a>
          <a href="#/cs/pesquisas" class="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink/80 hover:border-brand/40">🤝 Pesquisas de Alunos</a>
        </div>
      `}
    </div>`;
}

function EventoModal({ dataISO, evento, me, onClose, onSaved }) {
  const [d, setD] = useState(evento ? evento.data : dataISO);
  const [titulo, setTitulo] = useState(evento ? evento.titulo : "");
  const [hora, setHora] = useState(evento ? evento.hora || "" : "");
  const [tipo, setTipo] = useState(evento ? evento.tipo : "evento");
  const [descricao, setDescricao] = useState(evento ? evento.descricao || "" : "");
  const [busy, setBusy] = useState(false);

  async function salvar(e) {
    e && e.preventDefault();
    if (!titulo.trim()) { notify("Dê um título ao evento.", "err"); return; }
    setBusy(true);
    try {
      const payload = { data: d, titulo: titulo.trim(), hora: hora.trim() || null, tipo, descricao: descricao.trim() || null };
      if (evento) {
        const { error } = await sb.from("agenda_eventos").update(payload).eq("id", evento.id);
        if (error) throw error;
        notify("Evento atualizado.", "ok");
      } else {
        const { error } = await sb.from("agenda_eventos").insert({ ...payload, criado_por: me ? me.id : null });
        if (error) throw error;
        notify("Evento adicionado.", "ok");
      }
      onSaved();
    } catch (e2) { notify(errMsg(e2), "err"); }
    finally { setBusy(false); }
  }

  async function excluir() {
    if (!evento || !confirm("Excluir este evento?")) return;
    setBusy(true);
    try {
      const { error } = await sb.from("agenda_eventos").delete().eq("id", evento.id);
      if (error) throw error;
      notify("Evento excluído.", "ok");
      onSaved();
    } catch (e2) { notify(errMsg(e2), "err"); }
    finally { setBusy(false); }
  }

  return html`
    <${Modal} title=${evento ? "Editar evento" : "Novo evento"} onClose=${onClose}>
      <form onSubmit=${salvar} class="space-y-3">
        <${Field} label="Data" required>
          <input type="date" class=${inputCls} value=${d} onInput=${(e) => setD(e.target.value)} />
        <//>
        <${Field} label="Título" required>
          <input class=${inputCls} placeholder="Ex.: Reunião de squad" value=${titulo} onInput=${(e) => setTitulo(e.target.value)} autofocus />
        <//>
        <div class="grid grid-cols-2 gap-3">
          <${Field} label="Hora (opcional)">
            <input type="time" class=${inputCls} value=${hora} onInput=${(e) => setHora(e.target.value)} />
          <//>
          <${Field} label="Tipo">
            <select class=${inputCls} value=${tipo} onChange=${(e) => setTipo(e.target.value)}>
              <option value="evento">Evento</option>
              <option value="marco">Marco</option>
              <option value="lembrete">Lembrete</option>
            </select>
          <//>
        </div>
        <${Field} label="Descrição (opcional)">
          <textarea class=${cx(inputCls, "min-h-[70px]")} value=${descricao} onInput=${(e) => setDescricao(e.target.value)}></textarea>
        <//>
        <div class="flex items-center justify-between pt-1">
          ${evento ? html`<button type="button" class="text-sm text-[#a44b43] hover:underline" onClick=${excluir} disabled=${busy}>Excluir</button>` : html`<span></span>`}
          <div class="flex gap-2">
            <${Btn} variant="ghost" type="button" onClick=${onClose}>Cancelar<//>
            <${Btn} type="submit" loading=${busy}>Salvar<//>
          </div>
        </div>
      </form>
    <//>`;
}

function AgendaPage({ me, view }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [eventos, setEventos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // { dataISO } | { evento }
  const podeEditar = !me || me.role === "editor" || me.role === "admin";

  const primeiroDoMes = new Date(ym.y, ym.m, 1);
  const gridInicio = new Date(ym.y, ym.m, 1 - primeiroDoMes.getDay()); // volta ao domingo
  const dias = [];
  for (let i = 0; i < 42; i++) dias.push(new Date(gridInicio.getFullYear(), gridInicio.getMonth(), gridInicio.getDate() + i));
  const deISO = isoDia(dias[0]);
  const ateISO = isoDia(dias[41]);

  const carregar = useCallback(() => {
    setLoading(true);
    fetchEventos(deISO, ateISO)
      .then(setEventos)
      .catch((e) => { notify(errMsg(e), "err"); setEventos([]); })
      .finally(() => setLoading(false));
  }, [deISO, ateISO]);
  useEffect(() => { carregar(); }, [carregar]);

  const feriados = feriadosNoIntervalo(deISO, ateISO);
  const ferPorDia = {};
  for (const f of feriados) (ferPorDia[f.data] = ferPorDia[f.data] || []).push(f);
  const evPorDia = {};
  for (const e of eventos) (evPorDia[e.data] = evPorDia[e.data] || []).push(e);

  const hoje = hojeISO();
  const mudarMes = (delta) => setYm(({ y, m }) => {
    const d = new Date(y, m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  // Lista dos próximos 30 dias (feriados + eventos)
  const listaDe = hoje, listaAte = somaDias(hoje, 30);
  const [eventosLista, setEventosLista] = useState([]);
  useEffect(() => {
    fetchEventos(listaDe, listaAte).then(setEventosLista).catch(() => setEventosLista([]));
  }, [modal]); // recarrega ao fechar modal
  const proximos = [
    ...feriadosNoIntervalo(listaDe, listaAte).map((f) => ({ data: f.data, kind: "feriado", titulo: f.nome, facultativo: f.facultativo })),
    ...eventosLista.map((e) => ({ data: e.data, kind: "evento", ...e })),
  ].sort((a, b) => a.data.localeCompare(b.data) || (a.hora || "").localeCompare(b.hora || ""));

  const listaView = view === "datas-importantes";

  return html`
    <div>
      <div class="text-sm text-muted">📅 Agenda</div>
      <div class="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-2xl font-semibold text-ink">${listaView ? "Próximos eventos" : "Calendário"}</h1>
        <div class="flex gap-2 text-sm">
          <a href="#/agenda/calendario" class=${cx("rounded-lg px-3 py-1.5", !listaView ? "bg-brand-light font-medium text-brand-dark" : "text-ink/60 hover:bg-black/[0.04]")}>Calendário</a>
          <a href="#/agenda/datas-importantes" class=${cx("rounded-lg px-3 py-1.5", listaView ? "bg-brand-light font-medium text-brand-dark" : "text-ink/60 hover:bg-black/[0.04]")}>Lista</a>
        </div>
      </div>

      ${!listaView && html`
        <div class="mt-4 rounded-2xl border border-line bg-card p-3 sm:p-4">
          <div class="mb-3 flex items-center justify-between">
            <div class="flex items-center gap-1">
              <button class="rounded-md px-2 py-1 text-muted hover:bg-black/[0.05]" onClick=${() => mudarMes(-1)}>‹</button>
              <div class="w-44 text-center text-sm font-semibold capitalize text-ink">${MESES[ym.m]} ${ym.y}</div>
              <button class="rounded-md px-2 py-1 text-muted hover:bg-black/[0.05]" onClick=${() => mudarMes(1)}>›</button>
            </div>
            <button class="rounded-md border border-line px-2.5 py-1 text-xs text-ink/70 hover:bg-black/[0.04]"
              onClick=${() => setYm({ y: now.getFullYear(), m: now.getMonth() })}>Hoje</button>
          </div>

          <div class="grid grid-cols-7 gap-px text-center text-[11px] font-medium uppercase text-muted">
            ${DIAS_CURTO.map((d) => html`<div class="py-1">${d}</div>`)}
          </div>
          <div class="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-line">
            ${dias.map((dt) => {
              const iso = isoDia(dt);
              const noMes = dt.getMonth() === ym.m;
              const isHoje = iso === hoje;
              const fers = ferPorDia[iso] || [];
              const evs = evPorDia[iso] || [];
              return html`
                <div class=${cx("min-h-[92px] bg-white p-1.5 text-left align-top transition", !noMes && "bg-[#faf8f4] text-muted", podeEditar && "cursor-pointer hover:bg-brand-light/40")}
                  onClick=${podeEditar ? () => setModal({ dataISO: iso }) : null}>
                  <div class="flex items-center justify-between">
                    <span class=${cx("inline-grid h-6 w-6 place-items-center rounded-full text-xs", isHoje ? "bg-brand font-semibold text-white" : noMes ? "text-ink/80" : "text-muted")}>${dt.getDate()}</span>
                  </div>
                  ${fers.map((f) => html`<div class=${cx("mt-1 truncate rounded px-1 py-0.5 text-[10px] font-medium", f.facultativo ? "bg-[#efe9cf] text-[#7c7440]" : "bg-[#f4e0db] text-[#a44b43]")} title=${f.nome}>${f.nome}</div>`)}
                  ${evs.map((e) => {
                    const t = TIPO_EVENTO[e.tipo] || TIPO_EVENTO.evento;
                    return html`<div class=${cx("mt-1 flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] font-medium", t.cls)}
                      title=${(e.hora ? e.hora + " " : "") + e.titulo}
                      onClick=${(ev) => { ev.stopPropagation(); setModal({ evento: e }); }}>
                      <span class=${cx("h-1.5 w-1.5 shrink-0 rounded-full", t.dot)}></span>
                      <span class="truncate">${e.hora ? e.hora + " " : ""}${e.titulo}</span>
                    </div>`;
                  })}
                </div>`;
            })}
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted">
            <span class="inline-flex items-center gap-1"><span class="h-2.5 w-2.5 rounded bg-[#f4e0db]"></span>Feriado nacional</span>
            <span class="inline-flex items-center gap-1"><span class="h-2.5 w-2.5 rounded bg-[#efe9cf]"></span>Ponto facultativo</span>
            <span class="inline-flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-full bg-[#6b8aa3]"></span>Evento</span>
            <span class="inline-flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-full bg-brand"></span>Marco</span>
            <span class="inline-flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-full bg-[#bfa94e]"></span>Lembrete</span>
            ${loading ? html`<span class="spinner"></span>` : null}
          </div>
          ${podeEditar ? html`<p class="mt-2 text-[11px] text-muted">Clique num dia para adicionar um evento.</p>` : null}
        </div>`}

      <div class=${listaView ? "mt-4" : "mt-6"}>
        ${!listaView ? html`<h2 class="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Próximos 30 dias</h2>` : null}
        <div class="overflow-hidden rounded-2xl border border-line bg-card">
          ${proximos.length === 0
            ? html`<div class="px-5 py-8 text-center text-sm text-muted">Nenhum feriado ou evento nos próximos 30 dias.</div>`
            : html`<ul class="divide-y divide-line">
                ${proximos.map((it) => {
                  const t = it.kind === "evento" ? (TIPO_EVENTO[it.tipo] || TIPO_EVENTO.evento) : null;
                  return html`
                    <li class=${cx("flex items-start gap-3 px-4 py-3", it.kind === "evento" && podeEditar && "cursor-pointer hover:bg-black/[0.02]")}
                      onClick=${it.kind === "evento" && podeEditar ? () => setModal({ evento: it }) : null}>
                      <div class="w-14 shrink-0 text-center">
                        <div class="text-xs font-semibold text-ink">${fmtDiaCurto(it.data)}</div>
                        <div class="text-[10px] uppercase text-muted">${DIAS_CURTO[new Date(it.data.slice(0,4), Number(it.data.slice(5,7))-1, it.data.slice(8,10)).getDay()]}</div>
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="text-sm font-medium text-ink">${it.hora ? it.hora + " · " : ""}${it.titulo}</div>
                        ${it.kind === "feriado"
                          ? html`<div class="text-xs text-muted">${it.facultativo ? "Ponto facultativo" : "Feriado nacional"}</div>`
                          : (it.descricao ? html`<div class="truncate text-xs text-muted">${it.descricao}</div>` : null)}
                      </div>
                      ${it.kind === "feriado"
                        ? html`<span class="text-xs">${it.facultativo ? "🟡" : "🇧🇷"}</span>`
                        : html`<span class=${cx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", t.cls)}>${t.label}</span>`}
                    </li>`;
                })}
              </ul>`}
        </div>
        ${listaView && podeEditar ? html`
          <div class="mt-3">
            <${Btn} onClick=${() => setModal({ dataISO: hoje })}>+ Novo evento<//>
          </div>` : null}
      </div>

      ${modal ? html`<${EventoModal} dataISO=${modal.dataISO} evento=${modal.evento} me=${me}
        onClose=${() => setModal(null)} onSaved=${() => { setModal(null); carregar(); }} />` : null}
    </div>`;
}

/* ============================ Router / App ============================ */

function Router({ route, me, sections, reload }) {
  const [p0, p1] = route.parts;
  if (!p0) return html`<${HomePage} me=${me} sections=${sections} />`;
  if (p0 === "base") return html`<${Dashboard} me=${me} sections=${sections} />`;
  if (p0 === "agenda" && (p1 === "calendario" || p1 === "datas-importantes"))
    return html`<${AgendaPage} me=${me} view=${p1} />`;
  if (p0 === "secao") return html`<${SectionPage} slug=${p1} me=${me} sections=${sections} onSectionsChanged=${reload} />`;
  if (p0 === "doc") return html`<${DocDetail} id=${p1} me=${me} sections=${sections} />`;
  if (p0 === "novo") return html`<${NewDocPage} me=${me} sections=${sections} query=${route.query} />`;
  if (p0 === "ferramentas") return html`<${FerramentasPage} me=${me} />`;
  if (p0 === "pedir-ia") return html`<${PedirIA} />`;
  if (p0 === "perfil") return html`<${ProfilePage} me=${me} onProfileChanged=${reload} />`;
  if (p0 === "admin" && me.role === "admin") return html`<${AdminPage} me=${me} />`;
  if (p0 === "farol") return html`<${FarolPage} me=${me} />`;
  if (p0 === "conteudo" && (p1 === "metricas" || p1 === "instagram")) return html`<${ConteudoMetricasPage} />`;
  if (p0 === "conteudo" && p1 === "gerador-conteudos") return html`<${GeradorConteudosPage} />`;
  if (p0 === "cs" && p1 === "faq") return html`<${FaqPage} me=${me} />`;
  if (p0 === "cs" && p1 === "pesquisas") return html`<${PesquisasPage} />`;
  if (p0 === "cs" && p1 === "chat-cademi") return html`<${ChatCademiPage} />`;
  if (p0 === "pedagogico" && p1 === "gerador-materiais") return html`<${GeradorMateriaisPage} me=${me} />`;
  if (p0 === "pedagogico" && p1 === "gerador-slides") return html`<${GeradorSlidesPage} me=${me} />`;
  if (p0 === "pedagogico" && p1 === "gerador-feedbacks")
    return html`<${EmbedExterno} titulo="Gerador de Feedbacks" icone="🎓" src="https://name-tia-ai-web.onrender.com/dashboard" />`;
  if (p0 === "comercial" && p1 === "dash-fad")
    return html`<${EmbedExterno} titulo="Dash FAD" icone="📈" src="https://appdash.agenciafad.com.br/dashboard" />`;
  const grupo = NAV.find((g) => g.id === p0 && g.itens);
  const item = grupo && grupo.itens.find((it) => it.slug === p1);
  if (grupo && item) return html`<${ModuloEmConstrucao} grupo=${grupo} item=${item} />`;
  if (grupo) return html`<${ModuloEmConstrucao} grupo=${grupo} item=${grupo.itens[0]} />`;
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

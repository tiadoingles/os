// Painel lateral da tarefa: campos, descrição, subtarefas, checklist, links, participantes e comentários.
import { html } from "htm/preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import {
  os, ESCOPO, PRIORIDADES, fmtQuando, podeEditar, atualizarTarefa, alternarConclusao, criarTarefa,
  inserirFilha, editarFilha, excluirFilha, Avatar, PillPrazo, Icone, BotaoConcluir, SelectPessoa,
} from "./comum.js";

async function carregarDetalhe(id) {
  const sb = os.sb;
  const { data: t, error } = await sb.from("tarefas").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!t) return null;
  const ids = [t.id, t.parent_id].filter(Boolean);
  const [mae, parts, subs, chk, links, coms] = await Promise.all([
    t.parent_id ? sb.from("tarefas").select("*").eq("id", t.parent_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("tarefas_participantes").select("*").in("tarefa_id", ids),
    sb.from("tarefas").select("*").eq("parent_id", t.id).is("excluida_em", null).order("ordem").order("created_at"),
    sb.from("tarefas_checklist").select("*").eq("tarefa_id", t.id).order("ordem").order("created_at"),
    sb.from("tarefas_links").select("*").eq("tarefa_id", t.id).order("created_at"),
    sb.from("tarefas_comentarios").select("*").eq("tarefa_id", t.id).order("created_at"),
  ]);
  for (const r of [mae, parts, subs, chk, links, coms]) if (r.error) throw r.error;
  return { t, mae: mae.data, participantes: parts.data || [], subs: subs.data || [], checklist: chk.data || [],
    links: links.data || [], comentarios: coms.data || [] };
}

function Rotulo({ children }) {
  return html`<span class="block pt-2 text-[12px] font-bold text-slate-500">${children}</span>`;
}
function Secao({ icone, titulo, extra, children }) {
  return html`<section class="border-t border-slate-100 pt-5">
    <div class="mb-3 flex items-center justify-between gap-2">
      <h3 class="flex items-center gap-2 text-[13px] font-black uppercase tracking-[0.12em] text-slate-500"><${Icone} nome=${icone} class="h-4 w-4" />${titulo}</h3>
      ${extra}
    </div>
    ${children}
  </section>`;
}

/** Transforma "@Nome Sobrenome" do texto em ids de pessoas mencionadas. */
function mencoesDoTexto(texto, pessoas) {
  const ids = new Set();
  const baixo = texto.toLowerCase();
  for (const p of pessoas) {
    const nome = (p.nome || "").toLowerCase();
    const primeiro = nome.split(/\s+/)[0];
    if ((nome && baixo.includes("@" + nome)) || (primeiro && new RegExp("@" + primeiro.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(texto))) ids.add(p.id);
  }
  return [...ids];
}

export function DetalheTarefa({ me, base, tarefaId, onClose, onMudou, onAbrir }) {
  const [d, setD] = useState(undefined);
  const [editDesc, setEditDesc] = useState(false);
  const [desc, setDesc] = useState("");
  const [titulo, setTitulo] = useState("");
  const [novaSub, setNovaSub] = useState("");
  const [novoItem, setNovoItem] = useState("");
  const [novoLink, setNovoLink] = useState({ url: "", titulo: "" });
  const [comentario, setComentario] = useState("");
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const x = await carregarDetalhe(tarefaId);
      setD(x);
      if (x) { setTitulo(x.t.titulo); setDesc(x.t.descricao_md || ""); }
    } catch (e) { os.notify(os.errMsg(e), "err"); setD(null); }
  }, [tarefaId]);
  useEffect(() => { setD(undefined); setEditDesc(false); carregar(); }, [carregar]);
  os.useAoDesfazer(ESCOPO, carregar);
  useEffect(() => {
    const on = (e) => e.key === "Escape" && !document.querySelector("[role=dialog]") && onClose();
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [onClose]);

  const depois = async (fn) => {
    setBusy(true);
    try { await fn(); await carregar(); onMudou && onMudou(); }
    catch (e) { os.notify(os.errMsg(e), "err"); }
    finally { setBusy(false); }
  };

  const painel = (conteudo) => html`
    <div class="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-[2px]" onClick=${onClose}></div>
    <aside role="complementary" aria-label="Detalhes da tarefa"
      class="fixed inset-y-0 right-0 z-40 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-modal">
      ${conteudo}
    </aside>`;

  if (d === undefined) return painel(html`<div class="flex flex-1 items-center justify-center text-sm font-semibold text-slate-500"><span class="spinner mr-2"></span>Carregando…</div>`);
  if (d === null) return painel(html`<div class="p-8 text-sm font-semibold text-slate-600">Tarefa não encontrada ou sem acesso.
    <div class="mt-4"><${os.Btn} variant="ghost" onClick=${onClose}>Fechar<//></div></div>`);

  const { t, mae } = d;
  const partsT = d.participantes.filter((p) => p.tarefa_id === t.id).map((p) => p.user_id);
  const partsMae = mae ? d.participantes.filter((p) => p.tarefa_id === mae.id).map((p) => p.user_id) : [];
  const pode = podeEditar(me, base, t, partsT, mae, partsMae);
  const projeto = base.projeto(t.projeto_id);
  const setor = base.setor(t.setor_id);
  const statusLista = base.statusDe(t.projeto_id);
  const souParticipante = partsT.includes(me.id);
  const projetosMover = base.projetos.filter((p) => !p.arquivado && p.setor_id === t.setor_id);

  const salvarCampo = (patch, rotulo) => depois(() => atualizarTarefa(t, patch, { rotulo, toast: false }));
  const salvarTitulo = () => { const v = titulo.trim(); if (v && v !== t.titulo) salvarCampo({ titulo: v }, "renomear"); else setTitulo(t.titulo); };

  const cabecalho = html`
    <div class="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
      <div class="flex min-w-0 items-center gap-3">
        <${BotaoConcluir} t=${t} desabilitado=${!pode || busy} tamanho="h-6 w-6" onClick=${() => depois(() => alternarConclusao(base, t))} />
        <div class="min-w-0 text-[12px] font-bold text-slate-500">
          <span class="truncate">${setor ? setor.nome + " · " : ""}${projeto ? projeto.nome : ""}</span>
          ${mae ? html`<span> · subtarefa de <button type="button" class="font-black text-emerald-700 hover:underline" onClick=${() => onAbrir(mae.id)}>${mae.titulo}</button></span>` : null}
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        ${souParticipante
          ? html`<${os.Btn} variant="ghost" class="!px-3 !py-1.5 text-xs" disabled=${busy} title="Deixar de receber avisos e de participar"
              onClick=${() => depois(() => excluirFilha("tarefas_participantes", d.participantes.find((p) => p.tarefa_id === t.id && p.user_id === me.id), "deixar de seguir", false))}>
              <${Icone} nome="olho" class="h-3.5 w-3.5" />Seguindo<//>`
          : html`<${os.Btn} variant="ghost" class="!px-3 !py-1.5 text-xs" disabled=${busy} title="Participar desta tarefa (você passa a poder alterá-la)"
              onClick=${() => depois(() => inserirFilha("tarefas_participantes", { tarefa_id: t.id, user_id: me.id }, "seguir tarefa", true))}>
              <${Icone} nome="olho" class="h-3.5 w-3.5" />Seguir<//>`}
        ${pode ? html`<button type="button" title="Excluir tarefa" class="rounded-xl p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700"
            onClick=${() => confirm(`Excluir a tarefa "${t.titulo}"? Dá para desfazer pelo botão DESFAZER.`) &&
              depois(async () => { await atualizarTarefa(t, { excluida_em: new Date().toISOString() }, { rotulo: "excluir", mensagem: "Tarefa excluída" }); onClose(); })}>
            <${Icone} nome="lixo" /></button>` : null}
        <button type="button" aria-label="Fechar" class="rounded-xl p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-900" onClick=${onClose}><${Icone} nome="x" class="h-5 w-5" /></button>
      </div>
    </div>`;

  const aviso = pode ? null : html`<div class="mb-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-600 ring-1 ring-slate-200">
    <${Icone} nome="cadeado" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
    Você pode ver e comentar. Para alterar, é preciso estar envolvido (responsável, criador ou participante): use Seguir.</div>`;

  const campos = html`
    <div class="grid grid-cols-[110px_1fr] items-start gap-x-3 gap-y-2 text-sm">
      <${Rotulo}>Status<//>
      <select class=${os.inputCls} value=${t.status_id || ""} disabled=${!pode || busy} onChange=${(e) => salvarCampo({ status_id: e.target.value }, "mudar status")}>
        ${statusLista.map((s) => html`<option key=${s.id} value=${s.id}>${s.nome}</option>`)}
      </select>
      <${Rotulo}>Responsável<//>
      <${SelectPessoa} pessoas=${base.pessoas} valor=${t.responsavel_id} disabled=${!pode || busy}
        onChange=${(v) => salvarCampo({ responsavel_id: v }, "mudar responsável")} />
      <${Rotulo}>Prazo<//>
      <div class="flex flex-wrap items-center gap-2">
        <input type="date" class=${os.inputCls + " max-w-[11rem]"} value=${t.prazo || ""} disabled=${!pode || busy}
          onChange=${(e) => salvarCampo({ prazo: e.target.value || null }, "mudar prazo")} />
        <${PillPrazo} t=${t} />
      </div>
      <${Rotulo}>Início<//>
      <input type="date" class=${os.inputCls + " max-w-[11rem]"} value=${t.inicio || ""} disabled=${!pode || busy}
        onChange=${(e) => salvarCampo({ inicio: e.target.value || null }, "mudar início")} />
      <${Rotulo}>Prioridade<//>
      <select class=${os.inputCls + " max-w-[11rem]"} value=${t.prioridade} disabled=${!pode || busy} onChange=${(e) => salvarCampo({ prioridade: e.target.value }, "mudar prioridade")}>
        ${Object.entries(PRIORIDADES).map(([k, v]) => html`<option key=${k} value=${k}>${v.rotulo}</option>`)}
      </select>
      ${!t.parent_id && projetosMover.length > 1 ? html`
        <${Rotulo}>Projeto<//>
        <select class=${os.inputCls} value=${t.projeto_id} disabled=${!pode || busy}
          onChange=${(e) => salvarCampo({ projeto_id: e.target.value, status_id: null }, "mover de projeto")}>
          ${projetosMover.map((p) => html`<option key=${p.id} value=${p.id}>${p.nome}</option>`)}
        </select>` : null}
      <${Rotulo}>Etiquetas<//>
      <input class=${os.inputCls} placeholder="separadas por vírgula" disabled=${!pode || busy}
        value=${(t.etiquetas || []).join(", ")}
        onChange=${(e) => salvarCampo({ etiquetas: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }, "mudar etiquetas")} />
    </div>`;

  const descricao = html`
    <${Secao} icone="lista" titulo="Descrição" extra=${pode && !editDesc ? html`<button type="button" class="text-xs font-bold text-emerald-700 hover:underline" onClick=${() => setEditDesc(true)}>Editar</button>` : null}>
      ${editDesc ? html`
        <textarea class=${os.inputCls} rows="6" value=${desc} onInput=${(e) => setDesc(e.target.value)} placeholder="Contexto, links, critérios de pronto. Aceita Markdown."></textarea>
        <div class="mt-2 flex justify-end gap-2">
          <${os.Btn} variant="ghost" onClick=${() => { setDesc(t.descricao_md || ""); setEditDesc(false); }}>Cancelar<//>
          <${os.Btn} loading=${busy} onClick=${async () => { await salvarCampo({ descricao_md: desc.trim() || null }, "editar descrição"); setEditDesc(false); }}>Salvar<//>
        </div>`
      : t.descricao_md ? html`<div class="prose prose-sm max-w-none text-slate-700"><${os.Markdown} text=${t.descricao_md} /></div>`
      : html`<p class="text-sm font-medium text-slate-400">Sem descrição.</p>`}
    <//>`;

  const subtarefas = !t.parent_id ? html`
    <${Secao} icone="subtarefa" titulo=${`Subtarefas${d.subs.length ? ` (${d.subs.filter((s) => s.concluida_em).length}/${d.subs.length})` : ""}`}>
      <ul class="space-y-1">
        ${d.subs.map((s) => html`<li key=${s.id} class="group flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-slate-50">
          <${BotaoConcluir} t=${s} desabilitado=${!pode || busy} onClick=${() => depois(() => alternarConclusao(base, s))} />
          <button type="button" class=${os.cx("min-w-0 flex-1 truncate text-left text-sm font-semibold", s.concluida_em ? "text-slate-400 line-through" : "text-slate-800")} onClick=${() => onAbrir(s.id)}>${s.titulo}</button>
          <${PillPrazo} t=${s} />
          <${Avatar} pessoa=${base.pessoa(s.responsavel_id)} tamanho="h-6 w-6" />
        </li>`)}
      </ul>
      ${pode ? html`<form class="mt-2 flex gap-2" onSubmit=${(e) => { e.preventDefault(); const v = novaSub.trim(); if (!v) return;
          depois(async () => { await criarTarefa({ titulo: v, projeto_id: t.projeto_id, parent_id: t.id, responsavel_id: t.responsavel_id, ordem: Date.now() }, { rotulo: "criar subtarefa", toast: false }); setNovaSub(""); }); }}>
        <input class=${os.inputCls} placeholder="Adicionar subtarefa" value=${novaSub} onInput=${(e) => setNovaSub(e.target.value)} />
        <${os.Btn} variant="ghost" type="submit" disabled=${!novaSub.trim() || busy}>Adicionar<//>
      </form>` : null}
    <//>` : null;

  const feitos = d.checklist.filter((c) => c.feito).length;
  const checklist = html`
    <${Secao} icone="checklist" titulo=${`Checklist${d.checklist.length ? ` (${feitos}/${d.checklist.length})` : ""}`}>
      ${d.checklist.length ? html`<div class="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div class="h-full rounded-full bg-emerald-500 transition-all" style=${`width:${Math.round((feitos / d.checklist.length) * 100)}%`}></div></div>` : null}
      <ul class="space-y-1">
        ${d.checklist.map((c) => html`<li key=${c.id} class="group flex items-center gap-3 rounded-xl px-2 py-1 hover:bg-slate-50">
          <input type="checkbox" class="h-4 w-4 accent-emerald-600" checked=${c.feito} disabled=${!pode || busy}
            onChange=${() => depois(() => editarFilha("tarefas_checklist", c, { feito: !c.feito }, c.feito ? "desmarcar item" : "marcar item"))} />
          <span class=${os.cx("flex-1 text-sm font-medium", c.feito ? "text-slate-400 line-through" : "text-slate-700")}>${c.texto}</span>
          ${pode ? html`<button type="button" class="invisible rounded-lg p-1 text-slate-400 hover:text-rose-700 group-hover:visible" title="Remover item"
            onClick=${() => depois(() => excluirFilha("tarefas_checklist", c, "remover item do checklist"))}><${Icone} nome="x" class="h-3.5 w-3.5" /></button>` : null}
        </li>`)}
      </ul>
      ${pode ? html`<form class="mt-2 flex gap-2" onSubmit=${(e) => { e.preventDefault(); const v = novoItem.trim(); if (!v) return;
          depois(async () => { await inserirFilha("tarefas_checklist", { tarefa_id: t.id, texto: v, ordem: Date.now() }, "adicionar item ao checklist"); setNovoItem(""); }); }}>
        <input class=${os.inputCls} placeholder="Adicionar item" value=${novoItem} onInput=${(e) => setNovoItem(e.target.value)} />
        <${os.Btn} variant="ghost" type="submit" disabled=${!novoItem.trim() || busy}>Adicionar<//>
      </form>` : null}
    <//>`;

  const links = html`
    <${Secao} icone="link" titulo="Links e arquivos">
      <ul class="space-y-1">
        ${d.links.map((l) => html`<li key=${l.id} class="group flex items-center gap-2 text-sm">
          <a href=${l.url} target="_blank" rel="noopener noreferrer" class="min-w-0 flex-1 truncate font-semibold text-emerald-700 hover:underline">${l.titulo || l.url}</a>
          ${pode ? html`<button type="button" class="invisible rounded-lg p-1 text-slate-400 hover:text-rose-700 group-hover:visible" title="Remover link"
            onClick=${() => depois(() => excluirFilha("tarefas_links", l, "remover link"))}><${Icone} nome="x" class="h-3.5 w-3.5" /></button>` : null}
        </li>`)}
        ${!d.links.length && !pode ? html`<li class="text-sm font-medium text-slate-400">Nenhum link.</li>` : null}
      </ul>
      ${pode ? html`<form class="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit=${(e) => { e.preventDefault();
          const url = novoLink.url.trim(); if (!/^https?:\/\//i.test(url)) { os.notify("Cole um link começando com https://", "err"); return; }
          depois(async () => { await inserirFilha("tarefas_links", { tarefa_id: t.id, url, titulo: novoLink.titulo.trim() || null }, "adicionar link"); setNovoLink({ url: "", titulo: "" }); }); }}>
        <input class=${os.inputCls} placeholder="https:// (Drive, Canva, planilha…)" value=${novoLink.url} onInput=${(e) => setNovoLink((x) => ({ ...x, url: e.target.value }))} />
        <input class=${os.inputCls} placeholder="Nome (opcional)" value=${novoLink.titulo} onInput=${(e) => setNovoLink((x) => ({ ...x, titulo: e.target.value }))} />
        <${os.Btn} variant="ghost" type="submit" disabled=${!novoLink.url.trim() || busy}>Adicionar<//>
      </form>` : null}
    <//>`;

  const pessoasParticipando = d.participantes.filter((p) => p.tarefa_id === t.id);
  const participantes = html`
    <${Secao} icone="pessoa" titulo="Participantes">
      <div class="flex flex-wrap items-center gap-2">
        ${t.criado_por ? html`<span class="inline-flex items-center gap-1.5 rounded-full bg-slate-50 py-0.5 pl-0.5 pr-2.5 text-[12px] font-bold text-slate-600 ring-1 ring-slate-200">
          <${Avatar} pessoa=${base.pessoa(t.criado_por)} tamanho="h-6 w-6" />${(base.pessoa(t.criado_por) || {}).nome || "—"} <span class="font-semibold text-slate-400">criou</span></span>` : null}
        ${pessoasParticipando.map((p) => { const ps = base.pessoa(p.user_id); return html`<span key=${p.id} class="inline-flex items-center gap-1.5 rounded-full bg-slate-50 py-0.5 pl-0.5 pr-1.5 text-[12px] font-bold text-slate-600 ring-1 ring-slate-200">
          <${Avatar} pessoa=${ps} tamanho="h-6 w-6" />${ps ? ps.nome : "—"}
          ${pode || p.user_id === me.id ? html`<button type="button" class="rounded-full p-0.5 text-slate-400 hover:text-rose-700" title="Tirar"
            onClick=${() => depois(() => excluirFilha("tarefas_participantes", p, "tirar participante", false))}><${Icone} nome="x" class="h-3 w-3" /></button>` : null}</span>`; })}
        ${pode ? html`<select class=${os.inputCls + " !w-auto"} value="" disabled=${busy}
          onChange=${(e) => e.target.value && depois(() => inserirFilha("tarefas_participantes", { tarefa_id: t.id, user_id: e.target.value }, "adicionar participante", true))}>
          <option value="">Adicionar pessoa…</option>
          ${base.pessoas.filter((p) => !pessoasParticipando.some((x) => x.user_id === p.id)).map((p) => html`<option key=${p.id} value=${p.id}>${p.nome}</option>`)}
        </select>` : null}
      </div>
    <//>`;

  const enviarComentario = (e) => {
    e.preventDefault();
    const v = comentario.trim();
    if (!v) return;
    depois(async () => {
      await inserirFilha("tarefas_comentarios", { tarefa_id: t.id, texto_md: v, mencoes: mencoesDoTexto(v, base.pessoas) }, "comentar", false);
      setComentario("");
    });
  };
  const comentarios = html`
    <${Secao} icone="comentario" titulo=${`Comentários${d.comentarios.length ? ` (${d.comentarios.length})` : ""}`}>
      <ul class="space-y-4">
        ${d.comentarios.map((c) => { const autor = base.pessoa(c.autor_id); return html`<li key=${c.id} class="group flex gap-3">
          <${Avatar} pessoa=${autor} tamanho="h-8 w-8" />
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-2"><span class="text-[13px] font-black text-slate-900">${autor ? autor.nome : "—"}</span>
              <span class="text-[11px] font-semibold text-slate-400">${fmtQuando(c.created_at)}</span>
              ${c.autor_id === me.id || base.adm ? html`<button type="button" class="invisible ml-auto rounded-lg p-1 text-slate-400 hover:text-rose-700 group-hover:visible" title="Apagar comentário"
                onClick=${() => confirm("Apagar este comentário?") && depois(() => excluirFilha("tarefas_comentarios", c, "apagar comentário"))}><${Icone} nome="lixo" class="h-3.5 w-3.5" /></button>` : null}
            </div>
            <div class="prose prose-sm mt-0.5 max-w-none text-slate-700"><${os.Markdown} text=${c.texto_md} /></div>
          </div></li>`; })}
      </ul>
      <form class="mt-4 space-y-2" onSubmit=${enviarComentario}>
        <textarea class=${os.inputCls} rows="2" placeholder="Escreva um comentário. Use @Nome para mencionar alguém." value=${comentario}
          onInput=${(e) => setComentario(e.target.value)}
          onKeyDown=${(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) enviarComentario(e); }}></textarea>
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] font-semibold text-slate-400">Ctrl/Cmd + Enter envia</span>
          <${os.Btn} type="submit" disabled=${!comentario.trim() || busy}>Comentar<//>
        </div>
      </form>
    <//>`;

  return painel(html`
    ${cabecalho}
    <div class="flex-1 space-y-5 overflow-y-auto px-6 py-5">
      ${aviso}
      ${pode
        ? html`<textarea rows="1" class="w-full resize-none border-0 bg-transparent p-0 text-xl font-black tracking-tight text-[#07110e] focus:outline-none focus:ring-0"
            value=${titulo} onInput=${(e) => setTitulo(e.target.value)} onBlur=${salvarTitulo}
            onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } }}></textarea>`
        : html`<h2 class="text-xl font-black tracking-tight text-[#07110e]">${t.titulo}</h2>`}
      ${campos}
      ${descricao}
      ${subtarefas}
      ${checklist}
      ${links}
      ${participantes}
      ${comentarios}
      <p class="pt-2 text-[11px] font-semibold text-slate-400">Criada em ${fmtQuando(t.created_at)}${t.concluida_em ? ` · concluída em ${fmtQuando(t.concluida_em)}` : ""}</p>
    </div>`);
}

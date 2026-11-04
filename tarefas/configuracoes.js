// Configurações da Gestão de Tarefas: projetos, colunas e etiquetas (gestor do setor ou ADM), modelos de projeto,
// setores e pessoas (só ADM).
import { html } from "htm/preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import { os, ESCOPO, CORES, PRIORIDADES, hoje, Cabecalho, AbasTarefas, Avatar, Icone, inserirFilha, editarFilha, excluirFilha } from "./comum.js";

function SeletorCor({ valor, onChange, disabled }) {
  return html`<div class="flex gap-1">${CORES.map((c) => html`<button key=${c} type="button" disabled=${disabled} title=${c} onClick=${() => onChange(c)}
    class=${os.cx("h-5 w-5 rounded-full ring-2 ring-offset-1 transition", valor === c ? "ring-slate-900" : "ring-transparent hover:ring-slate-300")} style=${`background:${c}`}></button>`)}</div>`;
}
function Cartao({ titulo, descricao, children }) {
  return html`<section class="mb-5 rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-card">
    <h2 class="text-base font-black tracking-tight text-[#07110e]">${titulo}</h2>
    ${descricao ? html`<p class="mt-0.5 text-sm font-medium text-slate-500">${descricao}</p>` : null}
    <div class="mt-4">${children}</div>
  </section>`;
}
const rodarCom = (setBusy, recarregar) => async (fn) => {
  setBusy(true);
  try { await fn(); await recarregar(); } catch (e) { os.notify(os.errMsg(e), "err"); } finally { setBusy(false); }
};

/* ---------- Projetos, colunas e etiquetas de um setor ---------- */
function ProjetosDoSetor({ me, base, setor, modelos, recarregar }) {
  const [novo, setNovo] = useState({ nome: "", cor: setor.cor, modelo: "", inicio: hoje() });
  const [aberto, setAberto] = useState(null);
  const [novoStatus, setNovoStatus] = useState("");
  const [novaEtiqueta, setNovaEtiqueta] = useState("");
  const [busy, setBusy] = useState(false);
  const rodar = rodarCom(setBusy, recarregar);
  const projetos = base.projetos.filter((p) => p.setor_id === setor.id).sort((a, b) => Number(b.aceita_solicitacoes) - Number(a.aceita_solicitacoes) || a.ordem - b.ordem);
  const etiquetas = setor.etiquetas || [];

  const criarProjeto = (e) => {
    e.preventDefault();
    const nome = novo.nome.trim();
    if (!nome) return;
    rodar(async () => {
      const { data: p, error } = await os.sb.from("tarefas_projetos").insert({ setor_id: setor.id, nome, cor: novo.cor, ordem: projetos.length + 1 }).select("*").single();
      if (error) throw error;
      let ids = [];
      // DESFAZER registrado logo após criar o projeto: apaga as tarefas que o modelo criou (minhas, < 24 h) e o projeto vazio.
      const desfazer = async () => {
        await os.sb.from("tarefas").delete().eq("projeto_id", p.id).eq("criado_por", me.id);
        const { data: d, error: e2 } = await os.sb.from("tarefas_projetos").delete().eq("id", p.id).select("id");
        if (e2 || !d || !d.length) throw new Error("o projeto já tem tarefas; arquive em vez de excluir");
        return true;
      };
      if (novo.modelo) {
        const r = await os.sb.rpc("tarefas_aplicar_modelo", { p_modelo: novo.modelo, p_projeto: p.id, p_inicio: novo.inicio || null, p_responsavel: me.id });
        if (r.error) { await desfazer().catch(() => {}); throw r.error; }
        ids = r.data || [];
      }
      os.registrarDesfazer(ESCOPO, `criar projeto "${nome}"`, desfazer,
        { mensagem: ids.length ? `Projeto criado com ${ids.length} tarefas do modelo` : "Projeto criado" });
      setNovo({ nome: "", cor: setor.cor, modelo: "", inicio: hoje() });
    });
  };

  return html`<div class="mb-6 last:mb-0">
    <h3 class="mb-2 flex items-center gap-2 text-[13px] font-black uppercase tracking-[0.12em] text-slate-500">
      <span class="h-2.5 w-2.5 rounded-full" style=${`background:${setor.cor}`}></span>${setor.nome}</h3>

    <div class="mb-3 rounded-2xl bg-slate-50 p-3">
      <p class="mb-2 text-[12px] font-bold text-slate-500">Etiquetas do setor (a equipe escolhe destas, sem digitar)</p>
      <div class="flex flex-wrap items-center gap-1.5">
        ${etiquetas.map((t) => html`<span key=${t} class="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-0.5 text-[12px] font-bold text-slate-700 ring-1 ring-slate-200">${t}
          <button type="button" class="text-slate-400 hover:text-rose-700" title="Remover etiqueta" disabled=${busy}
            onClick=${() => rodar(() => editarFilha("tarefas_setores", setor, { etiquetas: etiquetas.filter((x) => x !== t) }, "remover etiqueta", true))}><${Icone} nome="x" class="h-3 w-3" /></button></span>`)}
        <form class="inline-flex gap-1" onSubmit=${(e) => { e.preventDefault(); const v = novaEtiqueta.trim().toLowerCase(); if (!v || etiquetas.includes(v)) return;
            rodar(async () => { await editarFilha("tarefas_setores", setor, { etiquetas: [...etiquetas, v] }, "adicionar etiqueta", true); setNovaEtiqueta(""); }); }}>
          <input class=${os.inputCls + " !w-40 !py-1"} placeholder="nova etiqueta" maxlength="30" value=${novaEtiqueta} onInput=${(e) => setNovaEtiqueta(e.target.value)} />
          <${os.Btn} variant="ghost" type="submit" class="!px-2 !py-1 text-xs" disabled=${!novaEtiqueta.trim() || busy}>Adicionar<//>
        </form>
      </div>
    </div>

    <ul class="divide-y divide-slate-100 rounded-2xl border border-slate-200">
      ${projetos.map((p) => html`<li key=${p.id} class="px-3 py-2">
        <div class="flex flex-wrap items-center gap-3">
          <span class="h-3 w-3 rounded-full" style=${`background:${p.cor}`}></span>
          <input class=${os.inputCls + " !w-auto min-w-[12rem] flex-1 !py-1.5"} value=${p.nome} disabled=${busy}
            onChange=${(e) => e.target.value.trim() && e.target.value.trim() !== p.nome && rodar(() => editarFilha("tarefas_projetos", p, { nome: e.target.value.trim() }, "renomear projeto", true))} />
          <${SeletorCor} valor=${p.cor} disabled=${busy} onChange=${(c) => rodar(() => editarFilha("tarefas_projetos", p, { cor: c }, "mudar cor do projeto"))} />
          ${p.aceita_solicitacoes ? html`<span class="rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-100" title="Qualquer pessoa da empresa pode abrir pedidos aqui">Recebe pedidos</span>` : null}
          ${p.arquivado ? html`<span class="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">Arquivado</span>` : null}
          <button type="button" class="text-[12px] font-bold text-emerald-700 hover:underline" onClick=${() => setAberto(aberto === p.id ? null : p.id)}>Colunas</button>
          ${!p.aceita_solicitacoes ? html`<button type="button" class="text-[12px] font-bold text-slate-500 hover:underline" disabled=${busy}
            onClick=${() => rodar(() => editarFilha("tarefas_projetos", p, { arquivado: !p.arquivado }, p.arquivado ? "desarquivar projeto" : "arquivar projeto", true))}>
            ${p.arquivado ? "Desarquivar" : "Arquivar"}</button>` : null}
        </div>
        ${aberto === p.id ? html`<div class="mt-3 rounded-xl bg-slate-50 p-3">
          <p class="mb-2 text-[12px] font-semibold text-slate-500">Colunas do quadro, na ordem. Marque "Conclui" na coluna que finaliza a tarefa.</p>
          <ul class="space-y-1.5">${base.statusDe(p.id).map((s, i) => html`<li key=${s.id} class="flex flex-wrap items-center gap-2">
            <input type="color" class="h-7 w-9 cursor-pointer rounded border border-slate-200" value=${s.cor} disabled=${busy}
              onChange=${(e) => rodar(() => editarFilha("tarefas_status", s, { cor: e.target.value }, "mudar cor da coluna"))} />
            <input class=${os.inputCls + " !w-auto flex-1 !py-1"} value=${s.nome} disabled=${busy}
              onChange=${(e) => e.target.value.trim() && rodar(() => editarFilha("tarefas_status", s, { nome: e.target.value.trim() }, "renomear coluna", true))} />
            <label class="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-600">
              <input type="checkbox" class="h-4 w-4 accent-emerald-600" checked=${s.tipo === "concluido"} disabled=${busy}
                onChange=${() => rodar(() => editarFilha("tarefas_status", s, { tipo: s.tipo === "concluido" ? (i === 0 ? "aberto" : "andamento") : "concluido" }, "mudar coluna que conclui", true))} />Conclui</label>
          </li>`)}</ul>
          <form class="mt-2 flex flex-wrap gap-2" onSubmit=${(e) => { e.preventDefault(); const nome = novoStatus.trim(); if (!nome) return;
              const ult = base.statusDe(p.id).filter((s) => s.tipo !== "concluido").pop();
              rodar(async () => { await inserirFilha("tarefas_status", { projeto_id: p.id, nome, tipo: "andamento", ordem: ult ? ult.ordem : 1, cor: "#64748b" }, "criar coluna", true); setNovoStatus(""); }); }}>
            <input class=${os.inputCls + " !w-auto flex-1 !py-1.5"} placeholder="Nova coluna (ex.: Aguardando aluno)" value=${novoStatus} onInput=${(e) => setNovoStatus(e.target.value)} />
            <${os.Btn} variant="ghost" type="submit" disabled=${!novoStatus.trim() || busy}>Adicionar coluna<//>
          </form>
        </div>` : null}
      </li>`)}
    </ul>
    <form class="mt-2 flex flex-wrap items-center gap-2" onSubmit=${criarProjeto}>
      <input class=${os.inputCls + " !w-auto min-w-[14rem] flex-1"} placeholder="Novo projeto (ex.: Lançamento de dezembro)" value=${novo.nome} onInput=${(e) => setNovo((x) => ({ ...x, nome: e.target.value }))} />
      <select class=${os.inputCls + " !w-auto"} value=${novo.modelo} onChange=${(e) => setNovo((x) => ({ ...x, modelo: e.target.value }))} title="Criar já com as tarefas de um modelo">
        <option value="">Sem modelo</option>
        ${modelos.filter((m) => !m.setor_id || m.setor_id === setor.id).map((m) => html`<option key=${m.id} value=${m.id}>Modelo: ${m.nome}</option>`)}
      </select>
      ${novo.modelo ? html`<label class="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-600">Início
        <input type="date" class=${os.inputCls + " !w-auto !py-1.5"} value=${novo.inicio} onInput=${(e) => setNovo((x) => ({ ...x, inicio: e.target.value }))} /></label>` : null}
      <${SeletorCor} valor=${novo.cor} onChange=${(c) => setNovo((x) => ({ ...x, cor: c }))} />
      <${os.Btn} type="submit" disabled=${!novo.nome.trim() || busy}><${Icone} nome="mais" />Criar projeto<//>
    </form>
  </div>`;
}

/* ---------- Modelos de projeto ---------- */
function itensParaTexto(itens) {
  return (itens || []).map((it) => [it.titulo, it.dias ?? "", it.prioridade && it.prioridade !== "normal" ? it.prioridade : "", (it.checklist || []).join("; ")]
    .join(" | ").replace(/( \| )+$/, "")).join("\n");
}
function textoParaItens(txt, antigos = []) {
  return txt.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [titulo, dias, prioridade, checklist] = l.split("|").map((x) => (x || "").trim());
    const it = { titulo };
    if (dias !== "" && dias !== undefined && /^\d+$/.test(dias)) it.dias = Number(dias);
    if (prioridade && PRIORIDADES[prioridade.toLowerCase()]) it.prioridade = prioridade.toLowerCase();
    if (checklist) it.checklist = checklist.split(";").map((x) => x.trim()).filter(Boolean);
    // Campos que o texto não mostra (subtarefas, descrição) seguem do item antigo de mesmo título.
    const velho = antigos.find((a) => a.titulo === titulo);
    if (velho && velho.subtarefas) it.subtarefas = velho.subtarefas;
    if (velho && velho.descricao) it.descricao = velho.descricao;
    return it;
  }).filter((it) => it.titulo);
}

function Modelos({ base, modelos, recarregarModelos }) {
  const setoresGeridos = base.meusSetores.filter((s) => base.gestorDe(s.id));
  const [edit, setEdit] = useState(null); // {id?, nome, descricao, setor_id, texto}
  const [busy, setBusy] = useState(false);
  const rodar = rodarCom(setBusy, recarregarModelos);
  const podeEditarModelo = (m) => base.adm || (m.setor_id && base.gestorDe(m.setor_id));
  const salvar = () => {
    const itens = textoParaItens(edit.texto, edit.id ? (modelos.find((m) => m.id === edit.id) || {}).itens : []);
    if (!edit.nome.trim() || !itens.length) { os.notify("Dê um nome e ao menos uma tarefa ao modelo.", "err"); return; }
    const dados = { nome: edit.nome.trim(), descricao: edit.descricao.trim() || null, setor_id: edit.setor_id || null, itens };
    rodar(async () => {
      if (edit.id) await editarFilha("tarefas_modelos", modelos.find((m) => m.id === edit.id), dados, "editar modelo", true);
      else await inserirFilha("tarefas_modelos", dados, "criar modelo", true);
      setEdit(null);
    });
  };
  return html`<div>
    <ul class="divide-y divide-slate-100 rounded-2xl border border-slate-200">
      ${modelos.map((m) => html`<li key=${m.id} class="flex flex-wrap items-center gap-3 px-3 py-2">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-black text-slate-800">${m.nome} <span class="text-[11px] font-semibold text-slate-400">· ${m.setor_id ? (base.setor(m.setor_id) || {}).nome : "empresa toda"} · ${(m.itens || []).length} tarefas</span></div>
          ${m.descricao ? html`<div class="truncate text-[12px] font-medium text-slate-500">${m.descricao}</div>` : null}
        </div>
        ${podeEditarModelo(m) ? html`
          <button type="button" class="text-[12px] font-bold text-emerald-700 hover:underline" onClick=${() => setEdit({ id: m.id, nome: m.nome, descricao: m.descricao || "", setor_id: m.setor_id || "", texto: itensParaTexto(m.itens) })}>Editar</button>
          <button type="button" class="text-[12px] font-bold text-slate-500 hover:text-rose-700" disabled=${busy}
            onClick=${() => confirm(`Excluir o modelo "${m.nome}"? Projetos já criados com ele não mudam.`) && rodar(() => excluirFilha("tarefas_modelos", m, "excluir modelo"))}>Excluir</button>` : null}
      </li>`)}
    </ul>
    ${edit ? html`<div class="mt-3 space-y-2 rounded-2xl bg-slate-50 p-4">
      <div class="grid gap-2 sm:grid-cols-2">
        <input class=${os.inputCls} placeholder="Nome do modelo" value=${edit.nome} onInput=${(e) => setEdit((x) => ({ ...x, nome: e.target.value }))} />
        <select class=${os.inputCls} value=${edit.setor_id} onChange=${(e) => setEdit((x) => ({ ...x, setor_id: e.target.value }))}>
          ${base.adm ? html`<option value="">Empresa toda</option>` : null}
          ${setoresGeridos.map((s) => html`<option key=${s.id} value=${s.id}>${s.nome}</option>`)}
        </select>
      </div>
      <input class=${os.inputCls} placeholder="Para que serve (opcional)" value=${edit.descricao} onInput=${(e) => setEdit((x) => ({ ...x, descricao: e.target.value }))} />
      <label class="block text-[12px] font-bold text-slate-600">Tarefas, uma por linha: <code>título | dias após o início | prioridade | itens; do; checklist</code>
        <textarea class=${os.inputCls + " mt-1 font-mono text-[12px]"} rows="8" value=${edit.texto} onInput=${(e) => setEdit((x) => ({ ...x, texto: e.target.value }))}
          placeholder=${"Definir tema da aula | 0 | alta\nSlides da aula | 1 | | Rascunho; Revisão; Final"}></textarea></label>
      <div class="flex justify-end gap-2">
        <${os.Btn} variant="ghost" onClick=${() => setEdit(null)}>Cancelar<//>
        <${os.Btn} loading=${busy} onClick=${salvar}>Salvar modelo<//>
      </div>
    </div>` : html`<${os.Btn} variant="ghost" class="mt-3" onClick=${() => setEdit({ nome: "", descricao: "", setor_id: base.adm ? "" : (setoresGeridos[0] || {}).id || "", texto: "" })}><${Icone} nome="mais" />Novo modelo<//>`}
  </div>`;
}

/* ---------- Setores e pessoas (ADM) ---------- */
function SetoresEPessoas({ base, recarregar }) {
  const [novo, setNovo] = useState({ nome: "", cor: CORES[1] });
  const [add, setAdd] = useState({});
  const [busy, setBusy] = useState(false);
  const rodar = rodarCom(setBusy, recarregar);
  const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return html`<div class="space-y-4">
    ${base.setores.map((s) => { const membros = base.membros.filter((m) => m.setor_id === s.id);
      const sel = add[s.id] || { user: "", papel: "membro" };
      return html`<div key=${s.id} class=${os.cx("rounded-2xl border border-slate-200 p-4", !s.ativo && "opacity-60")}>
        <div class="flex flex-wrap items-center gap-3">
          <input class=${os.inputCls + " !w-auto min-w-[12rem] flex-1 !py-1.5 font-bold"} value=${s.nome} disabled=${busy}
            onChange=${(e) => e.target.value.trim() && rodar(() => editarFilha("tarefas_setores", s, { nome: e.target.value.trim() }, "renomear setor", true))} />
          <${SeletorCor} valor=${s.cor} disabled=${busy} onChange=${(c) => rodar(() => editarFilha("tarefas_setores", s, { cor: c }, "mudar cor do setor"))} />
          <label class="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-600">
            <input type="checkbox" class="h-4 w-4 accent-emerald-600" checked=${s.ativo} disabled=${busy}
              onChange=${() => rodar(() => editarFilha("tarefas_setores", s, { ativo: !s.ativo }, s.ativo ? "desativar setor" : "ativar setor", true))} />Ativo</label>
        </div>
        <label class="mt-2 block text-[12px] font-bold text-slate-500">Espaço do Google Chat (fase 3, opcional)
          <input class=${os.inputCls + " mt-1 !py-1.5"} placeholder="spaces/AAAA..." value=${s.gchat_space || ""} disabled=${busy}
            onChange=${(e) => rodar(() => editarFilha("tarefas_setores", s, { gchat_space: e.target.value.trim() || null }, "mudar espaço do Chat", true))} /></label>
        <div class="mt-3 flex flex-wrap gap-2">
          ${membros.map((m) => { const p = base.pessoa(m.user_id); return html`<span key=${m.id} class="inline-flex items-center gap-1.5 rounded-full bg-slate-50 py-0.5 pl-0.5 pr-1.5 text-[12px] font-bold text-slate-700 ring-1 ring-slate-200">
            <${Avatar} pessoa=${p} tamanho="h-6 w-6" />${p ? p.nome : "—"}
            <select class="rounded-md border-0 bg-transparent py-0 pl-1 pr-6 text-[11px] font-bold text-slate-500" value=${m.papel} disabled=${busy}
              onChange=${(e) => rodar(() => editarFilha("tarefas_setor_membros", m, { papel: e.target.value }, "mudar papel no setor", true))}>
              <option value="membro">membro</option><option value="gestor">gestor</option></select>
            <button type="button" class="rounded-full p-0.5 text-slate-400 hover:text-rose-700" title="Tirar do setor" disabled=${busy}
              onClick=${() => rodar(() => excluirFilha("tarefas_setor_membros", m, "tirar pessoa do setor"))}><${Icone} nome="x" class="h-3 w-3" /></button>
          </span>`; })}
          ${!membros.length ? html`<span class="text-[12px] font-semibold text-slate-400">Ninguém neste setor ainda.</span>` : null}
        </div>
        <form class="mt-3 flex flex-wrap gap-2" onSubmit=${(e) => { e.preventDefault(); if (!sel.user) return;
            rodar(async () => { await inserirFilha("tarefas_setor_membros", { setor_id: s.id, user_id: sel.user, papel: sel.papel }, "incluir pessoa no setor", true); setAdd((a) => ({ ...a, [s.id]: { user: "", papel: "membro" } })); }); }}>
          <select class=${os.inputCls + " !w-auto flex-1 !py-1.5"} value=${sel.user} onChange=${(e) => setAdd((a) => ({ ...a, [s.id]: { ...sel, user: e.target.value } }))}>
            <option value="">Incluir pessoa…</option>
            ${base.pessoas.filter((p) => !membros.some((m) => m.user_id === p.id)).map((p) => html`<option key=${p.id} value=${p.id}>${p.nome} (${p.email})</option>`)}</select>
          <select class=${os.inputCls + " !w-auto !py-1.5"} value=${sel.papel} onChange=${(e) => setAdd((a) => ({ ...a, [s.id]: { ...sel, papel: e.target.value } }))}>
            <option value="membro">Membro</option><option value="gestor">Gestor (cria projetos)</option></select>
          <${os.Btn} variant="ghost" type="submit" disabled=${!sel.user || busy}>Incluir<//>
        </form>
      </div>`; })}
    <form class="flex flex-wrap items-center gap-2" onSubmit=${(e) => { e.preventDefault(); const nome = novo.nome.trim(); if (!nome) return;
        rodar(async () => { await inserirFilha("tarefas_setores", { nome, slug: slug(nome) || "setor-" + Date.now(), cor: novo.cor, ordem: base.setores.length + 1 }, "criar setor", true); setNovo({ nome: "", cor: CORES[1] }); }); }}>
      <input class=${os.inputCls + " !w-auto min-w-[14rem] flex-1"} placeholder="Novo setor (ex.: Tutores)" value=${novo.nome} onInput=${(e) => setNovo((x) => ({ ...x, nome: e.target.value }))} />
      <${SeletorCor} valor=${novo.cor} onChange=${(c) => setNovo((x) => ({ ...x, cor: c }))} />
      <${os.Btn} type="submit" disabled=${!novo.nome.trim() || busy}><${Icone} nome="mais" />Criar setor<//>
    </form>
  </div>`;
}

export function ConfiguracoesPage({ me, base, recarregar }) {
  const [modelos, setModelos] = useState([]);
  const carregarModelos = useCallback(async () => {
    const { data, error } = await os.sb.from("tarefas_modelos").select("*").order("nome");
    if (error) os.notify(os.errMsg(error), "err"); else setModelos(data || []);
  }, []);
  useEffect(() => { carregarModelos(); }, [carregarModelos]);
  os.useAoDesfazer(ESCOPO, () => { recarregar(); carregarModelos(); });
  const setoresGeridos = base.meusSetores.filter((s) => base.gestorDe(s.id));
  if (!base.adm && !setoresGeridos.length) {
    return html`<${Cabecalho} titulo="Configurações"><${AbasTarefas} tela="configuracoes" base=${base} /><//>
      <p class="text-sm font-medium text-slate-500">Só o ADM e os gestores de setor configuram a Gestão de Tarefas.</p>`;
  }
  return html`
    <${Cabecalho} titulo="Configurações" descricao="Projetos, colunas e etiquetas de cada setor, modelos de projeto e, para o ADM, setores e pessoas.">
      <${AbasTarefas} tela="configuracoes" base=${base} />
    <//>
    <${Cartao} titulo="Projetos, colunas e etiquetas" descricao="Cada projeto tem o próprio quadro. O projeto Solicitações recebe pedidos de qualquer pessoa da empresa.">
      ${setoresGeridos.map((s) => html`<${ProjetosDoSetor} key=${s.id} me=${me} base=${base} setor=${s} modelos=${modelos} recarregar=${recarregar} />`)}
    <//>
    <${Cartao} titulo="Modelos de projeto" descricao="Listas de tarefas prontas, com prazos contados a partir do início. Ao criar um projeto, escolha o modelo. Os três iniciais são rascunhos: ajuste ao processo real.">
      <${Modelos} base=${base} modelos=${modelos} recarregarModelos=${carregarModelos} />
    <//>
    ${base.adm ? html`<${Cartao} titulo="Setores e pessoas" descricao="Cada pessoa vê só as tarefas dos setores dos quais faz parte (mais as tarefas em que for envolvida). Gestor cria projetos, colunas, etiquetas e modelos do setor.">
      <${SetoresEPessoas} base=${base} recarregar=${recarregar} />
    <//>` : null}`;
}

// Configurações da Gestão de Tarefas: projetos e status (gestor do setor ou ADM); setores e pessoas (só ADM).
import { html } from "htm/preact";
import { useState } from "preact/hooks";
import { os, ESCOPO, CORES, Cabecalho, AbasTarefas, Avatar, Icone, inserirFilha, editarFilha, excluirFilha } from "./comum.js";

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

const TIPOS = { aberto: "Em aberto", andamento: "Em andamento", concluido: "Conclui a tarefa" };

function ProjetosDoSetor({ base, setor, recarregar }) {
  const [novo, setNovo] = useState({ nome: "", cor: setor.cor });
  const [aberto, setAberto] = useState(null);
  const [novoStatus, setNovoStatus] = useState({ nome: "", tipo: "andamento" });
  const [busy, setBusy] = useState(false);
  const projetos = base.projetos.filter((p) => p.setor_id === setor.id);
  const rodar = async (fn) => { setBusy(true); try { await fn(); await recarregar(); } catch (e) { os.notify(os.errMsg(e), "err"); } finally { setBusy(false); } };

  return html`<div class="mb-6 last:mb-0">
    <h3 class="mb-2 flex items-center gap-2 text-[13px] font-black uppercase tracking-[0.12em] text-slate-500">
      <span class="h-2.5 w-2.5 rounded-full" style=${`background:${setor.cor}`}></span>${setor.nome}</h3>
    <ul class="divide-y divide-slate-100 rounded-2xl border border-slate-200">
      ${projetos.map((p) => html`<li key=${p.id} class="px-3 py-2">
        <div class="flex flex-wrap items-center gap-3">
          <span class="h-3 w-3 rounded-full" style=${`background:${p.cor}`}></span>
          <input class=${os.inputCls + " !w-auto min-w-[12rem] flex-1 !py-1.5"} value=${p.nome} disabled=${busy}
            onChange=${(e) => e.target.value.trim() && e.target.value.trim() !== p.nome && rodar(() => editarFilha("tarefas_projetos", p, { nome: e.target.value.trim() }, "renomear projeto", true))} />
          <${SeletorCor} valor=${p.cor} disabled=${busy} onChange=${(c) => rodar(() => editarFilha("tarefas_projetos", p, { cor: c }, "mudar cor do projeto"))} />
          ${p.arquivado ? html`<span class="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">Arquivado</span>` : null}
          <button type="button" class="text-[12px] font-bold text-emerald-700 hover:underline" onClick=${() => setAberto(aberto === p.id ? null : p.id)}>Status</button>
          <button type="button" class="text-[12px] font-bold text-slate-500 hover:underline" disabled=${busy}
            onClick=${() => rodar(() => editarFilha("tarefas_projetos", p, { arquivado: !p.arquivado }, p.arquivado ? "desarquivar projeto" : "arquivar projeto", true))}>
            ${p.arquivado ? "Desarquivar" : "Arquivar"}</button>
        </div>
        ${aberto === p.id ? html`<div class="mt-3 rounded-xl bg-slate-50 p-3">
          <p class="mb-2 text-[12px] font-semibold text-slate-500">Colunas do quadro, na ordem. O tipo "Conclui a tarefa" marca a tarefa como concluída.</p>
          <ul class="space-y-1.5">${base.statusDe(p.id).map((s) => html`<li key=${s.id} class="flex flex-wrap items-center gap-2">
            <input type="color" class="h-7 w-9 cursor-pointer rounded border border-slate-200" value=${s.cor} disabled=${busy}
              onChange=${(e) => rodar(() => editarFilha("tarefas_status", s, { cor: e.target.value }, "mudar cor do status"))} />
            <input class=${os.inputCls + " !w-auto flex-1 !py-1"} value=${s.nome} disabled=${busy}
              onChange=${(e) => e.target.value.trim() && rodar(() => editarFilha("tarefas_status", s, { nome: e.target.value.trim() }, "renomear status", true))} />
            <select class=${os.inputCls + " !w-auto !py-1"} value=${s.tipo} disabled=${busy}
              onChange=${(e) => rodar(() => editarFilha("tarefas_status", s, { tipo: e.target.value }, "mudar tipo do status", true))}>
              ${Object.entries(TIPOS).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>
          </li>`)}</ul>
          <form class="mt-2 flex flex-wrap gap-2" onSubmit=${(e) => { e.preventDefault(); const nome = novoStatus.nome.trim(); if (!nome) return;
              const ult = base.statusDe(p.id).filter((s) => s.tipo !== "concluido").pop();
              rodar(async () => { await inserirFilha("tarefas_status", { projeto_id: p.id, nome, tipo: novoStatus.tipo, ordem: ult ? ult.ordem : 1, cor: "#64748b" }, "criar status", true); setNovoStatus({ nome: "", tipo: "andamento" }); }); }}>
            <input class=${os.inputCls + " !w-auto flex-1 !py-1.5"} placeholder="Nova coluna (ex.: Aguardando aluno)" value=${novoStatus.nome} onInput=${(e) => setNovoStatus((x) => ({ ...x, nome: e.target.value }))} />
            <select class=${os.inputCls + " !w-auto !py-1.5"} value=${novoStatus.tipo} onChange=${(e) => setNovoStatus((x) => ({ ...x, tipo: e.target.value }))}>
              ${Object.entries(TIPOS).map(([k, v]) => html`<option key=${k} value=${k}>${v}</option>`)}</select>
            <${os.Btn} variant="ghost" type="submit" disabled=${!novoStatus.nome.trim() || busy}>Adicionar coluna<//>
          </form>
        </div>` : null}
      </li>`)}
      ${!projetos.length ? html`<li class="px-3 py-3 text-sm font-medium text-slate-400">Nenhum projeto ainda.</li>` : null}
    </ul>
    <form class="mt-2 flex flex-wrap items-center gap-2" onSubmit=${(e) => { e.preventDefault(); const nome = novo.nome.trim(); if (!nome) return;
        rodar(async () => { await inserirFilha("tarefas_projetos", { setor_id: setor.id, nome, cor: novo.cor, ordem: projetos.length + 1 }, "criar projeto", true); setNovo({ nome: "", cor: setor.cor }); }); }}>
      <input class=${os.inputCls + " !w-auto min-w-[14rem] flex-1"} placeholder="Novo projeto (ex.: Lançamento de dezembro)" value=${novo.nome} onInput=${(e) => setNovo((x) => ({ ...x, nome: e.target.value }))} />
      <${SeletorCor} valor=${novo.cor} onChange=${(c) => setNovo((x) => ({ ...x, cor: c }))} />
      <${os.Btn} type="submit" disabled=${!novo.nome.trim() || busy}><${Icone} nome="mais" />Criar projeto<//>
    </form>
  </div>`;
}

function SetoresEPessoas({ base, recarregar }) {
  const [novo, setNovo] = useState({ nome: "", cor: CORES[1] });
  const [add, setAdd] = useState({});
  const [busy, setBusy] = useState(false);
  const rodar = async (fn) => { setBusy(true); try { await fn(); await recarregar(); } catch (e) { os.notify(os.errMsg(e), "err"); } finally { setBusy(false); } };
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
  os.useAoDesfazer(ESCOPO, recarregar);
  const setoresGeridos = base.meusSetores.filter((s) => base.gestorDe(s.id));
  if (!base.adm && !setoresGeridos.length) {
    return html`<${Cabecalho} titulo="Configurações"><${AbasTarefas} tela="configuracoes" base=${base} /><//>
      <p class="text-sm font-medium text-slate-500">Só o ADM e os gestores de setor configuram a Gestão de Tarefas.</p>`;
  }
  return html`
    <${Cabecalho} titulo="Configurações" descricao="Projetos e colunas de cada setor. O ADM também define os setores e quem faz parte de cada um.">
      <${AbasTarefas} tela="configuracoes" base=${base} />
    <//>
    <${Cartao} titulo="Projetos" descricao="Cada projeto tem o próprio quadro. Gestores do setor e o ADM criam, renomeiam e arquivam.">
      ${setoresGeridos.map((s) => html`<${ProjetosDoSetor} key=${s.id} base=${base} setor=${s} recarregar=${recarregar} />`)}
    <//>
    ${base.adm ? html`<${Cartao} titulo="Setores e pessoas" descricao="Cada pessoa vê só as tarefas dos setores dos quais faz parte (mais as tarefas em que for envolvida). Gestor cria projetos no setor.">
      <${SetoresEPessoas} base=${base} recarregar=${recarregar} />
    <//>` : null}`;
}

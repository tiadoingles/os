// Histórico de tarefas concluídas: dono (responsável), quem marcou como concluída e quando, no prazo ou atrasada.
// Cada pessoa vê o histórico dos seus setores (o RLS decide); o ADM vê todos e escolhe "Todos os setores".
import { html } from "htm/preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import { os, ESCOPO, hoje, somaDias, fmtDia, fmtHora, Cabecalho, AbasTarefas, SemSetor, Avatar, Icone } from "./comum.js";
import { DetalheTarefa } from "./detalhe.js";

const PERIODOS = [["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["90", "Últimos 90 dias"], ["365", "Último ano"], ["tudo", "Tudo"]];

function quando(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
/** Concluída no prazo? null = sem prazo. Compara no fuso local (prazo é data + horário opcional). */
function noPrazo(t) {
  if (!t.prazo) return null;
  const [y, m, d] = t.prazo.split("-").map(Number);
  const [hh, mm] = t.prazo_hora ? String(t.prazo_hora).split(":").map(Number) : [23, 59];
  return new Date(t.concluida_em) <= new Date(y, m - 1, d, hh, mm, 59);
}

export function HistoricoPage({ me, base }) {
  const [f, setF] = useState({ setor: base.adm ? "" : (base.meusSetores[0] || {}).id || "", periodo: "30", dono: "", quem: "", busca: "" });
  const [itens, setItens] = useState(null);
  const [aberta, setAberta] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const carregar = useCallback(async () => {
    try {
      const out = [];
      for (let de = 0; de < 10000; de += 1000) {
        let q = os.sb.from("tarefas").select("id,titulo,projeto_id,setor_id,parent_id,responsavel_id,concluida_por,concluida_em,prazo,prazo_hora,created_at")
          .not("concluida_em", "is", null).is("excluida_em", null);
        if (f.setor) q = q.eq("setor_id", f.setor);
        if (f.periodo !== "tudo") q = q.gte("concluida_em", new Date(Date.now() - Number(f.periodo) * 86400000).toISOString());
        const { data, error } = await q.order("concluida_em", { ascending: false }).range(de, de + 999);
        if (error) throw error;
        out.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      setItens(out);
    } catch (e) { os.notify(os.errMsg(e), "err"); setItens([]); }
  }, [f.setor, f.periodo]);
  useEffect(() => { setItens(null); carregar(); }, [carregar]);
  os.useAoDesfazer(ESCOPO, carregar);

  const lista = useMemo(() => {
    const b = f.busca.trim().toLowerCase();
    return (itens || []).filter((t) => (!f.dono || t.responsavel_id === f.dono) && (!f.quem || t.concluida_por === f.quem)
      && (!b || t.titulo.toLowerCase().includes(b)));
  }, [itens, f.dono, f.quem, f.busca]);
  const resumo = useMemo(() => {
    const comPrazo = lista.filter((t) => t.prazo);
    const ok = comPrazo.filter((t) => noPrazo(t)).length;
    return { total: lista.length, noPrazo: ok, atrasadas: comPrazo.length - ok };
  }, [lista]);

  const csv = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const nome = (id) => (base.pessoa(id) || {}).nome || "";
    const linhas = [["Tarefa", "Setor", "Projeto", "Dono (responsável)", "Concluída por", "Concluída em", "Prazo", "Situação"]]
      .concat(lista.map((t) => [t.titulo, (base.setor(t.setor_id) || {}).nome, (base.projeto(t.projeto_id) || {}).nome, nome(t.responsavel_id),
        nome(t.concluida_por), quando(t.concluida_em), t.prazo ? fmtDia(t.prazo) + (t.prazo_hora ? " " + fmtHora(t.prazo_hora) : "") : "",
        noPrazo(t) === null ? "sem prazo" : noPrazo(t) ? "no prazo" : "atrasada"]));
    const blob = new Blob(["﻿" + linhas.map((l) => l.map(esc).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `historico-tarefas-${hoje()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  if (!base.meusSetores.length && !base.adm) return html`<${Cabecalho} titulo="Histórico"><${AbasTarefas} tela="historico" base=${base} /><//><${SemSetor} me=${me} />`;
  return html`
    <${Cabecalho} titulo="Histórico" descricao="Tarefas concluídas: quem era o dono, quem marcou como concluída, quando, e se foi no prazo.">
      <${AbasTarefas} tela="historico" base=${base} />
      <${os.Btn} variant="ghost" onClick=${csv} disabled=${!lista.length}>Baixar planilha (CSV)<//>
    <//>
    <div class="mb-4 flex flex-wrap items-center gap-2 rounded-[1.35rem] border border-slate-200 bg-white p-2 shadow-card">
      <select class=${os.inputCls + " !w-auto"} value=${f.setor} onChange=${set("setor")}>
        ${base.adm || base.meusSetores.length > 1 ? html`<option value="">Todos os meus setores</option>` : null}
        ${base.meusSetores.map((s) => html`<option key=${s.id} value=${s.id}>${s.nome}</option>`)}
      </select>
      <select class=${os.inputCls + " !w-auto"} value=${f.periodo} onChange=${set("periodo")}>
        ${PERIODOS.map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>
      <select class=${os.inputCls + " !w-auto"} value=${f.dono} onChange=${set("dono")} title="Dono da tarefa (responsável)">
        <option value="">Qualquer dono</option>${base.pessoas.map((p) => html`<option key=${p.id} value=${p.id}>Dono: ${p.nome}</option>`)}</select>
      <select class=${os.inputCls + " !w-auto"} value=${f.quem} onChange=${set("quem")} title="Quem marcou como concluída">
        <option value="">Concluída por qualquer pessoa</option>${base.pessoas.map((p) => html`<option key=${p.id} value=${p.id}>Concluída por: ${p.nome}</option>`)}</select>
      <div class="relative min-w-[11rem] flex-1">
        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><${Icone} nome="busca" /></span>
        <input class=${os.inputCls + " !pl-9"} placeholder="Buscar pelo título" value=${f.busca} onInput=${set("busca")} /></div>
    </div>
    ${itens === null ? html`<div class="py-10 text-center text-sm font-semibold text-slate-500"><span class="spinner mr-2"></span>Carregando…</div>` : html`
      <div class="mb-4 grid grid-cols-3 gap-3">
        ${[["Concluídas", resumo.total, "text-[#07110e]"], ["No prazo", resumo.noPrazo, "text-emerald-700"], ["Depois do prazo", resumo.atrasadas, resumo.atrasadas ? "text-rose-700" : "text-[#07110e]"]].map(([r, n, c]) => html`
          <div key=${r} class="rounded-[1.35rem] border border-slate-200 bg-white px-4 py-3 shadow-card">
            <div class="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">${r}</div>
            <div class=${os.cx("mt-1 text-2xl font-black tracking-tight", c)}>${n}</div></div>`)}
      </div>
      ${!lista.length ? html`<div class="rounded-[1.6rem] border border-dashed border-slate-200 bg-white/80 px-6 py-12 text-center text-sm font-medium text-slate-500">Nenhuma tarefa concluída com esses filtros.</div>`
      : html`<div class="overflow-x-auto rounded-[1.35rem] border border-slate-200 bg-white shadow-card">
        <table class="w-full min-w-[760px] text-left text-sm">
          <thead class="bg-slate-50 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
            <tr><th class="px-4 py-2">Tarefa</th><th class="px-3 py-2">Dono</th><th class="px-3 py-2">Concluída por</th><th class="px-3 py-2">Concluída em</th><th class="px-3 py-2">Prazo</th></tr>
          </thead>
          <tbody>${lista.map((t) => { const dono = base.pessoa(t.responsavel_id), quem = base.pessoa(t.concluida_por), np = noPrazo(t), p = base.projeto(t.projeto_id);
            return html`<tr key=${t.id} class="cursor-pointer border-t border-slate-100 hover:bg-emerald-50/40" onClick=${() => setAberta(t.id)}>
              <td class="px-4 py-2"><div class="font-bold text-slate-900">${t.titulo}</div>
                <div class="text-[11px] font-semibold text-slate-400">${(base.setor(t.setor_id) || {}).nome || ""}${p ? " · " + p.nome : ""}${t.parent_id ? " · subtarefa" : ""}</div></td>
              <td class="px-3 py-2"><div class="flex items-center gap-2"><${Avatar} pessoa=${dono} tamanho="h-6 w-6" /><span class="text-[13px] font-semibold text-slate-700">${dono ? dono.nome : "Sem responsável"}</span></div></td>
              <td class="px-3 py-2"><div class="flex items-center gap-2"><${Avatar} pessoa=${quem} tamanho="h-6 w-6" titulo="Quem marcou como concluída" /><span class="text-[13px] font-semibold text-slate-700">${quem ? quem.nome : "—"}</span></div></td>
              <td class="whitespace-nowrap px-3 py-2 text-[13px] font-semibold text-slate-700">${quando(t.concluida_em)}</td>
              <td class="whitespace-nowrap px-3 py-2">${t.prazo ? html`<span class=${os.cx("rounded-lg px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset", np ? "bg-emerald-50 text-emerald-800 ring-emerald-100" : "bg-rose-50 text-rose-700 ring-rose-200")}>
                ${fmtDia(t.prazo)}${t.prazo_hora ? " " + fmtHora(t.prazo_hora) : ""} · ${np ? "no prazo" : "atrasada"}</span>` : html`<span class="text-[12px] text-slate-400">sem prazo</span>`}</td>
            </tr>`; })}</tbody>
        </table></div>`}`}
    ${aberta ? html`<${DetalheTarefa} me=${me} base=${base} tarefaId=${aberta} onAbrir=${setAberta}
      onClose=${() => setAberta(null)} onMudou=${carregar} />` : null}`;
}

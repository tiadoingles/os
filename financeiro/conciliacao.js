// Financeiro · Conciliação — tela do Craft Green "Conciliação" (ref. app_conciliacao_page).
// Spec: docs/financeiro-spec.md (2.5 e 3.5). Base compartilhada: ./comum.js (não editar lá).
// Props do Router (#/financeiro/conciliacao): me (linha de profiles) e query (?source=CREDIT_CARD abre Cartões).
// Escrita: podeEditarFin(me). DESFAZER: escopoFin("conciliacao"). Remover = cancelado_em (nunca delete).
import { html } from "htm/preact";
import { useState, useEffect, useMemo, useRef } from "preact/hooks";
import {
  os, escopoFin, podeEditarFin, FinPage, Icone, ConfirmDialog, fetchContas, fetchGrupos, fetchCategorias, fetchLancamentos,
  ANOS_FILTRO, MESES, periodo, brl, cn, normalizarTexto, nomeDre, parseValorBR, useLocalState, isoData,
} from "./comum.js";

const ESCOPO = escopoFin("conciliacao");

const ICONES_EXTRA = {
  building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
};
function Ic({ nome, class: cls = "h-4 w-4" }) {
  if (!ICONES_EXTRA[nome]) return html`<${Icone} nome=${nome} class=${cls} />`;
  return html`<svg class=${cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICONES_EXTRA[nome] }}></svg>`;
}

/* ============================ Dados ============================ */
/** Quantos lançamentos (não cancelados) há em cada aba, com os mesmos filtros de origem/período/conta. */
async function contarLancamentos({ inicio, fim, contaId, origem, conciliado }) {
  let q = os.sb.from("fin_lancamentos").select("id", { count: "exact", head: true })
    .gte("data", inicio).lte("data", fim).eq("conciliado", conciliado).is("cancelado_em", null);
  q = origem === "cartao" ? q.eq("origem", "cartao") : q.neq("origem", "cartao");
  if (contaId && contaId !== "all") q = q.eq("conta_id", contaId);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}
const emLotes = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
async function snapshots(ids) {
  const out = [];
  for (const lote of emLotes(ids, 200)) {
    const { data, error } = await os.sb.from("fin_lancamentos").select("*").in("id", lote);
    if (error) throw error;
    out.push(...(data || []));
  }
  return out;
}
/** Grava o mesmo patch em vários lançamentos e devolve as linhas atualizadas. */
async function atualizarVarios(ids, patch) {
  const out = [];
  for (const lote of emLotes(ids, 200)) {
    const { data, error } = await os.sb.from("fin_lancamentos").update(patch).in("id", lote).select("*");
    if (error) throw error;
    out.push(...(data || []));
  }
  if (out.length < ids.length) throw new Error("Alguns lançamentos não puderam ser atualizados (sem permissão ou já removidos).");
  return out;
}
const CAMPOS_CONC = ["categoria_id", "conciliado", "cancelado_em"];
/** DESFAZER de uma ação em lote: devolve categoria/conciliado/cancelado_em de cada linha ao snapshot anterior. */
function desfazerLote(antes, depois, rotulo) {
  return async () => {
    const atuais = await snapshots(antes.map((a) => a.id));
    const dep = new Map(depois.map((d) => [d.id, d.updated_at]));
    const mudou = atuais.some((a) => dep.has(a.id) && a.updated_at !== dep.get(a.id));
    if (mudou && !confirm(`Desfazer "${rotulo}": alguns lançamentos foram alterados depois dessa ação. Desfazer mesmo assim vai sobrescrever essas mudanças. Continuar?`)) return false;
    const grupos = new Map();
    for (const a of antes) {
      const patch = Object.fromEntries(CAMPOS_CONC.map((k) => [k, a[k]]));
      const k = JSON.stringify(patch);
      if (!grupos.has(k)) grupos.set(k, { patch, ids: [] });
      grupos.get(k).ids.push(a.id);
    }
    for (const { patch, ids } of grupos.values()) await atualizarVarios(ids, patch);
    return true;
  };
}

/* ============================ Tela ============================ */
const dataBRutc = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : "Data inválida"; };
const classeAba = (ativo) => cn("flex-1 rounded-lg px-5 py-2.5 text-[14.5px] font-black uppercase tracking-widest transition", ativo ? "bg-[#07110e] text-white shadow" : "text-slate-500");

export function ConciliacaoPage({ me, query }) {
  const pode = podeEditarFin(me);
  const fonteQuery = query && query.source;
  const [fonte, setFonte] = useLocalState("conciliacao:source:" + (fonteQuery || "default"), fonteQuery === "CREDIT_CARD" ? "CREDIT_CARD" : "BANK");
  const [aba, setAba] = useLocalState("conciliacao:tab", "pending");
  const [contaId, setContaId] = useLocalState("conciliacao:accountId", "all");
  const [ano, setAno] = useLocalState("conciliacao:year", String(new Date().getFullYear()));
  const [mes, setMes] = useLocalState("conciliacao:month", "all");
  const [busca, setBusca] = useLocalState("conciliacao:search", "");
  const [selecionados, setSelecionados] = useState(new Set());
  const [catLinha, setCatLinha] = useState({});
  const [catLote, setCatLote] = useState("");
  const [ocupadoId, setOcupadoId] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [confirmacao, setConfirmacao] = useState(null);
  const [novoAberto, setNovoAberto] = useState(false);

  const [contas, setContas] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [linhas, setLinhas] = useState(null);
  const [atualizando, setAtualizando] = useState(false);
  const [contagem, setContagem] = useState({ pending: null, conciliated: null });
  const [erroCarga, setErroCarga] = useState(false);
  const pedido = useRef(0);

  const origem = fonte === "CREDIT_CARD" ? "cartao" : "banco";
  const per = useMemo(() => periodo(Number(ano), mes === "all" ? null : Number(mes)), [ano, mes]);

  useEffect(() => {
    Promise.all([fetchContas({ incluirArquivadas: true }), fetchGrupos(), fetchCategorias({ incluirArquivadas: true })])
      .then(([c, g, cat]) => { setContas(c); setGrupos(g); setCategorias(cat); })
      .catch((e) => os.notify(os.errMsg(e), "err"));
  }, []);

  async function carregar() {
    const n = ++pedido.current;
    setAtualizando(true); setErroCarga(false);
    try {
      const filtros = { inicio: per.inicio, fim: per.fim, contaId, origem };
      const [ls, pend, conc] = await Promise.all([
        fetchLancamentos({ ...filtros, conciliado: aba === "conciliated" }),
        contarLancamentos({ ...filtros, conciliado: false }),
        contarLancamentos({ ...filtros, conciliado: true }),
      ]);
      if (n !== pedido.current) return;
      setLinhas(ls); setContagem({ pending: pend, conciliated: conc });
    } catch (e) {
      if (n !== pedido.current) return;
      os.notify(os.errMsg(e), "err"); setErroCarga(true); setLinhas((l) => l || []);
    } finally { if (n === pedido.current) setAtualizando(false); }
  }
  useEffect(() => { setLinhas(null); carregar(); }, [fonte, aba, contaId, ano, mes]);
  useEffect(() => { setSelecionados(new Set()); setCatLote(""); setCatLinha({}); }, [fonte, aba, contaId, ano, mes]);
  os.useAoDesfazer(ESCOPO, carregar);

  const contaPorId = useMemo(() => new Map(contas.map((c) => [c.id, c])), [contas]);
  const catPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);
  const opcoesCategoria = useMemo(() => {
    const ativas = categorias.filter((c) => c.ativa);
    const out = grupos.filter((g) => g.tipo !== "formula").map((g) => ({
      grupo: `${g.code}. ${nomeDre(g.nome)}`,
      itens: ativas.filter((c) => c.grupo_id === g.id && !c.fora_dre).sort((a, b) => a.ordem - b.ordem).map((c) => [c.id, nomeDre(c.nome)]),
    })).filter((g) => g.itens.length);
    const fora = ativas.filter((c) => c.fora_dre).sort((a, b) => a.ordem - b.ordem).map((c) => [c.id, c.nome]);
    if (fora.length) out.push({ grupo: "Fora da DRE", itens: fora });
    return out;
  }, [grupos, categorias]);

  const visiveis = useMemo(() => {
    const lista = linhas || [];
    const t = normalizarTexto(busca.trim());
    if (!t) return lista;
    return lista.filter((l) => normalizarTexto(l.historico).includes(t) || normalizarTexto(catPorId.get(l.categoria_id)?.nome).includes(t));
  }, [linhas, busca, catPorId]);
  const marcados = visiveis.filter((l) => selecionados.has(l.id));
  const categoriaDe = (l) => catLinha[l.id] || l.categoria_id || "";

  async function trocarCategoria(l, catId) {
    setCatLinha((m) => ({ ...m, [l.id]: catId }));
    if (aba !== "conciliated" || !pode || !catId) return;
    setOcupadoId(l.id); setAviso(null);
    try {
      const [antes] = await snapshots([l.id]);
      const [depois] = await atualizarVarios([l.id], { categoria_id: catId, conciliado: true });
      os.registrarDesfazer(ESCOPO, "troca de categoria", os.desfazerEdicao("fin_lancamentos", antes, depois, "troca de categoria"), { toast: false });
      setAviso({ type: "success", text: "Categoria atualizada e relatórios recalculados." });
      await carregar();
    } catch (e) { setAviso({ type: "error", text: os.errMsg(e) || "Não foi possível atualizar a categoria." }); }
    finally { setOcupadoId(null); }
  }

  async function conciliar(l) {
    const cat = categoriaDe(l);
    if (!cat) return setAviso({ type: "error", text: "Selecione uma categoria antes de conciliar." });
    setOcupadoId(l.id); setAviso(null);
    try {
      const [antes] = await snapshots([l.id]);
      const [depois] = await atualizarVarios([l.id], { categoria_id: cat, conciliado: true });
      os.registrarDesfazer(ESCOPO, "conciliação de lançamento", os.desfazerEdicao("fin_lancamentos", antes, depois, "conciliação de lançamento"), { toast: false });
      setAviso({ type: "success", text: "Lançamento conciliado com sucesso." });
      await carregar();
    } catch (e) { setAviso({ type: "error", text: os.errMsg(e) || "Não foi possível conciliar o lançamento." }); }
    finally { setOcupadoId(null); }
  }

  async function aplicarLote() {
    if (!catLote) return setAviso({ type: "error", text: "Selecione uma categoria para os lançamentos marcados." });
    if (!marcados.length) return;
    setOcupadoId("batch"); setAviso(null);
    try {
      const ids = marcados.map((l) => l.id);
      const antes = await snapshots(ids);
      // Em "Conciliados" o lote só troca a categoria (o lançamento continua conciliado).
      const depois = await atualizarVarios(ids, { categoria_id: catLote, conciliado: true });
      const rot = aba === "pending" ? `conciliação de ${ids.length} lançamento(s)` : `troca de categoria de ${ids.length} lançamento(s)`;
      os.registrarDesfazer(ESCOPO, rot, desfazerLote(antes, depois, rot), { toast: false });
      setSelecionados(new Set()); setCatLote("");
      setAviso({ type: "success", text: `${ids.length} lançamento(s) atualizado(s).` });
      await carregar();
    } catch (e) { setAviso({ type: "error", text: os.errMsg(e) || "Não foi possível concluir a ação em lote." }); }
    finally { setOcupadoId(null); }
  }

  function pedirRemocao(lista) {
    setConfirmacao({
      titulo: "Remover lançamento?", variante: "danger", textoConfirmar: "Cancelar registros",
      descricao: "Os registros serão cancelados e deixarão de aparecer nos relatórios. O histórico permanecerá preservado para auditoria.",
      onConfirm: async () => {
        setOcupadoId("delete"); setAviso(null);
        try {
          const ids = lista.map((l) => l.id);
          const antes = await snapshots(ids);
          const depois = await atualizarVarios(ids, { cancelado_em: new Date().toISOString() });
          const rot = ids.length === 1 ? "remoção de lançamento" : `remoção de ${ids.length} lançamentos`;
          os.registrarDesfazer(ESCOPO, rot, desfazerLote(antes, depois, rot), { toast: false });
          setSelecionados(new Set());
          setAviso({ type: "success", text: "Registro(s) cancelado(s) com histórico preservado." });
          await carregar();
        } catch (e) { setAviso({ type: "error", text: os.errMsg(e) || "Não foi possível cancelar o registro." }); }
        finally { setOcupadoId(null); }
      },
    });
  }

  function pedirReabertura(l) {
    setConfirmacao({
      titulo: "Desconciliar lançamento?", variante: "warning", textoConfirmar: "Desconciliar",
      descricao: "O lançamento voltará para pendentes e deixará de compor a DRE até uma nova confirmação. O registro será preservado.",
      onConfirm: async () => {
        setOcupadoId(l.id); setAviso(null);
        try {
          const [antes] = await snapshots([l.id]);
          const [depois] = await atualizarVarios([l.id], { conciliado: false });
          os.registrarDesfazer(ESCOPO, "reabertura de lançamento", os.desfazerEdicao("fin_lancamentos", antes, depois, "reabertura de lançamento"), { toast: false });
          setAviso({ type: "success", text: "Lançamento devolvido para pendentes." });
          await carregar();
        } catch (e) { setAviso({ type: "error", text: os.errMsg(e) || "Não foi possível desconciliar." }); }
        finally { setOcupadoId(null); }
      },
    });
  }

  const todosMarcados = visiveis.length > 0 && marcados.length === visiveis.length;
  const alternar = (id) => setSelecionados((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const rotuloAba = (r, n) => html`${r}${n == null ? "" : html`<span class="ml-2 opacity-60 tabular-nums">${n}</span>`}`;
  const contasAtivas = contas.filter((c) => c.ativo);

  return html`<${FinPage} class="space-y-5 !pb-32">
    <section class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p class="text-[16px] font-black uppercase tracking-[0.2em] text-emerald-700">Classificação financeira</p>
        <h1 class="mt-2 text-3xl font-black tracking-[-0.045em] text-[#07110e]">Conciliação</h1>
      </div>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        ${pode ? html`<button type="button" onClick=${() => setNovoAberto(true)}
          class="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-xs font-bold text-slate-700 transition hover:border-emerald-200">
          <${Ic} nome="plus" class="h-4 w-4" />Novo lançamento</button>` : null}
        <a href="#/financeiro/importacao" class="premium-button-primary h-12 text-xs"><${Ic} nome="upload" class="h-4 w-4" />Nova importação</a>
      </div>
    </section>

    <section class="grid gap-3 md:grid-cols-2">
      <${CartaoFonte} ativo=${fonte === "BANK"} onClick=${() => setFonte("BANK")} icone="building" rotulo="Extratos bancários" descricao="Entradas e saídas da conta" />
      <${CartaoFonte} ativo=${fonte === "CREDIT_CARD"} onClick=${() => setFonte("CREDIT_CARD")} icone="credit-card" rotulo="Cartões de crédito" descricao="Compras, parcelas e estornos" />
    </section>

    <section class="rounded-[1.4rem] border border-slate-200 bg-white p-3 shadow-sm">
      <div class="flex flex-col gap-3 xl:flex-row">
        <div class="flex rounded-xl bg-slate-100 p-1" role="group">
          <button type="button" aria-pressed=${aba === "pending"} onClick=${() => setAba("pending")} class=${classeAba(aba === "pending")}>${rotuloAba("Pendentes", contagem.pending)}</button>
          <button type="button" aria-pressed=${aba === "conciliated"} onClick=${() => setAba("conciliated")} class=${classeAba(aba === "conciliated")}>${rotuloAba("Conciliados", contagem.conciliated)}</button>
        </div>
        <div class="grid flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <select aria-label="Ano" value=${ano} onChange=${(e) => setAno(e.target.value)} class="filter-select h-11 py-0">
            ${ANOS_FILTRO.map((a) => html`<option value=${String(a)}>${a}</option>`)}
          </select>
          <select aria-label="Mês" value=${mes} onChange=${(e) => setMes(e.target.value)} class="filter-select h-11 py-0">
            <option value="all">Todos os meses</option>
            ${MESES.map((m, i) => html`<option value=${String(i)}>${m}</option>`)}
          </select>
          <select aria-label="Conta bancária" value=${contaId} onChange=${(e) => setContaId(e.target.value)} class="filter-select h-11 py-0">
            <option value="all">Todas as contas</option>
            ${contasAtivas.map((c) => html`<option value=${c.id}>${c.banco ? `${c.banco} · ` : ""}${c.apelido}</option>`)}
          </select>
          <label class="relative">
            <${Ic} nome="search" class="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
            <input value=${busca} onInput=${(e) => setBusca(e.target.value)} placeholder="Buscar histórico..." class="filter-select h-11 py-0 pl-11" />
          </label>
        </div>
      </div>
    </section>

    ${aviso ? html`<div role=${aviso.type === "error" ? "alert" : "status"} class=${cn("flex items-center gap-3 rounded-2xl border p-4 text-xs font-bold",
      aviso.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800")}>
      <${Ic} nome=${aviso.type === "success" ? "check-circle" : "alert"} class="h-5 w-5" />${aviso.text}</div>` : null}
    ${!pode ? html`<p class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-bold text-amber-900">Você pode consultar os lançamentos, mas não tem permissão para conciliar.</p>` : null}

    <section class="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white">
      <div class="flex items-center justify-between border-b border-slate-100 p-4">
        <label class="flex items-center gap-3 text-[16px] font-black uppercase tracking-widest text-slate-500">
          <input type="checkbox" checked=${todosMarcados} disabled=${!pode}
            onChange=${() => setSelecionados(todosMarcados ? new Set() : new Set(visiveis.map((l) => l.id)))} class="h-4 w-4 accent-emerald-500" />
          Selecionar todos
        </label>
        <div class="flex items-center gap-2 text-[14.5px] font-black uppercase tracking-widest text-slate-400">
          ${atualizando && linhas ? html`<${Ic} nome="loader" class="h-3 w-3 fin-spin" />` : null}${visiveis.length} lançamento(s)
        </div>
      </div>
      <div class="overflow-x-auto"><table class="w-full min-w-[1387px]">
        <thead><tr class="bg-slate-50 text-left text-[13.5px] font-black uppercase tracking-widest text-slate-400">
          <th class="w-12 px-4 py-3"></th><th class="px-4 py-3">Data</th><th class="px-4 py-3">Histórico</th><th class="px-4 py-3">Conta</th>
          <th class="px-4 py-3 text-right">Valor</th><th class="w-[413px] px-4 py-3">Categoria DRE</th><th class="px-4 py-3 text-right">Ações</th>
        </tr></thead>
        <tbody>
          ${linhas === null ? html`<tr><td colSpan="7" class="p-16 text-center text-xs font-bold text-slate-400">
              <${Ic} nome="loader" class="mx-auto mb-3 h-6 w-6 fin-spin text-emerald-600" />Carregando lançamentos...</td></tr>`
            : visiveis.length ? visiveis.map((l) => {
              const cat = categoriaDe(l), valor = Number(l.valor || 0), conta = contaPorId.get(l.conta_id);
              const arquivada = cat && catPorId.get(cat) && !catPorId.get(cat).ativa ? catPorId.get(cat) : null;
              const ocupado = ocupadoId === l.id;
              return html`<tr key=${l.id} class=${cn("border-t border-slate-100 text-xs transition hover:bg-slate-50/60", selecionados.has(l.id) && "bg-emerald-50/40")}>
                <td class="px-4 py-3"><input type="checkbox" checked=${selecionados.has(l.id)} disabled=${!pode} onChange=${() => alternar(l.id)} class="h-4 w-4 accent-emerald-500" /></td>
                <td class="whitespace-nowrap px-4 py-3 font-bold text-slate-500">${dataBRutc(l.data)}</td>
                <td class="max-w-sm px-4 py-3">
                  <p class="truncate font-black text-slate-800" title=${l.historico}>${l.historico}</p>
                  ${l.origem === "manual" ? html`<p class="mt-1 text-[13.5px] font-black uppercase tracking-widest text-slate-400">Lançamento manual</p>` : null}
                  ${l.observacao ? html`<p class="mt-1 truncate text-[13.5px] font-medium text-slate-400" title=${l.observacao}>${l.observacao}</p>` : null}
                </td>
                <td class="px-4 py-3 font-semibold text-slate-500">${conta?.apelido || "Conta"}</td>
                <td class=${cn("px-4 py-3 text-right font-black tabular-nums", valor > 0 ? "text-emerald-700" : "text-slate-800")}>
                  <span class="inline-flex items-center gap-1"><${Ic} nome=${valor > 0 ? "arrow-up-right" : "arrow-down-right"} class="h-3 w-3" />${brl(valor)}</span>
                </td>
                <td class="px-4 py-3"><${SelectCategoria} valor=${cat} opcoes=${opcoesCategoria} arquivada=${arquivada} disabled=${ocupado || !pode} onChange=${(v) => trocarCategoria(l, v)} /></td>
                <td class="px-4 py-3"><div class="flex justify-end gap-2">
                  ${aba === "pending"
                    ? html`<button type="button" onClick=${() => conciliar(l)} disabled=${ocupado || !pode}
                        class="flex h-9 items-center gap-1 rounded-xl bg-[#07110e] px-3 text-[14.5px] font-black uppercase tracking-widest text-white disabled:opacity-50">
                        <${Ic} nome=${ocupado ? "loader" : "check-circle"} class=${cn("h-3 w-3", ocupado && "fin-spin")} />Conciliar</button>`
                    : html`<button type="button" onClick=${() => pedirReabertura(l)} disabled=${ocupado || !pode}
                        class="flex h-9 items-center gap-1 rounded-xl border border-slate-200 px-3 text-[14.5px] font-black uppercase text-slate-500 disabled:opacity-50">
                        <${Ic} nome="rotate" class="h-3 w-3" />Reabrir</button>`}
                  <button type="button" onClick=${() => pedirRemocao([l])} disabled=${!pode} aria-label="Remover lançamento"
                    class="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:border-rose-200 hover:text-rose-600 disabled:opacity-50">
                    <${Ic} nome="trash" class="h-3.5 w-3.5" /></button>
                </div></td>
              </tr>`;
            })
            : html`<tr><td colSpan="7" class="p-16 text-center">
                <${Ic} nome="building" class="mx-auto h-8 w-8 text-slate-200" />
                <p class="mt-3 text-sm font-black text-slate-600">${erroCarga ? "Não foi possível carregar os lançamentos" : "Nenhum lançamento encontrado"}</p>
                <p class="mt-1 text-xs font-medium text-slate-400">${erroCarga ? "Nenhum dado foi alterado." : "Ajuste os filtros ou importe um novo arquivo."}</p>
              </td></tr>`}
        </tbody>
      </table></div>
    </section>

    ${selecionados.size > 0 && pode ? html`<div class="fixed inset-x-3 bottom-4 z-30 mx-auto max-w-3xl rounded-[1.4rem] border border-white/10 bg-[#07110e] p-3 text-white shadow-2xl md:bottom-7">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div class="flex items-center gap-3 px-2">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-xs font-black text-[#07110e]">${marcados.length}</span>
          <span class="text-[14.5px] font-black uppercase tracking-widest text-slate-400">Selecionados</span>
        </div>
        <${SelectCategoria} valor=${catLote} opcoes=${opcoesCategoria} onChange=${setCatLote} escuro=${true} />
        <button type="button" onClick=${aplicarLote} disabled=${ocupadoId === "batch"}
          class="h-11 shrink-0 rounded-xl bg-emerald-500 px-5 text-[14.5px] font-black uppercase tracking-widest text-[#07110e] disabled:opacity-50">
          ${ocupadoId === "batch" ? "Processando..." : aba === "pending" ? "Categorizar e conciliar" : "Atualizar categoria"}</button>
        <button type="button" onClick=${() => pedirRemocao(marcados)} aria-label="Remover selecionados"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-rose-400"><${Ic} nome="trash" class="h-4 w-4" /></button>
      </div>
    </div>` : null}

    <${ConfirmDialog} aberto=${!!confirmacao} titulo=${confirmacao?.titulo} descricao=${confirmacao?.descricao} variante=${confirmacao?.variante || "danger"}
      textoConfirmar=${confirmacao?.textoConfirmar} onConfirm=${() => confirmacao && confirmacao.onConfirm()} onClose=${() => setConfirmacao(null)} />
    ${novoAberto ? html`<${NovoLancamento} contas=${contasAtivas} opcoes=${opcoesCategoria} contaPadrao=${contaId !== "all" ? contaId : ""}
      onClose=${() => setNovoAberto(false)} onSalvo=${() => { setNovoAberto(false); setAviso({ type: "success", text: "Lançamento manual registrado e conciliado." }); carregar(); }} />` : null}
  <//>`;
}

function CartaoFonte({ ativo, onClick, icone, rotulo, descricao }) {
  return html`<button type="button" onClick=${onClick} aria-pressed=${ativo}
    class=${cn("rounded-[1.3rem] border p-5 text-left transition", ativo ? "border-emerald-400 bg-emerald-500 text-[#07110e]" : "border-slate-200 bg-white hover:border-emerald-200")}>
    <div class="flex items-center gap-4">
      <span class=${cn("flex h-11 w-11 items-center justify-center rounded-xl", ativo ? "bg-white/30" : "bg-slate-100 text-slate-500")}><${Ic} nome=${icone} class="h-5 w-5" /></span>
      <div><p class="text-sm font-black">${rotulo}</p><p class=${cn("mt-1 text-[16px] font-semibold", ativo ? "opacity-60" : "text-slate-400")}>${descricao}</p></div>
      ${ativo ? html`<${Ic} nome="check-circle" class="ml-auto h-4 w-4" />` : null}
    </div>
  </button>`;
}

/** Select "Categoria DRE": optgroup por linha da DRE + "Fora da DRE" no fim. Categoria arquivada atual aparece à parte. */
function SelectCategoria({ valor, opcoes, onChange, disabled, escuro, arquivada }) {
  return html`<select aria-label="Categoria DRE" value=${valor || ""} disabled=${disabled} onChange=${(e) => onChange(e.target.value)}
    class=${cn("h-11 w-full min-w-0 rounded-xl border px-3 text-[16px] font-bold outline-none transition focus:border-emerald-400 disabled:opacity-50",
      escuro ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-white text-slate-700")}>
    <option value="" class="text-slate-900">Selecionar categoria...</option>
    ${arquivada ? html`<optgroup label="Arquivada" class="text-slate-900"><option value=${arquivada.id}>${nomeDre(arquivada.nome)}</option></optgroup>` : null}
    ${opcoes.map((g) => html`<optgroup label=${g.grupo} class="text-slate-900">${g.itens.map(([v, r]) => html`<option value=${v}>${r}</option>`)}</optgroup>`)}
  </select>`;
}

/** Novo lançamento manual (decisão da Tia, não existe no Craft): entra conciliado, origem 'manual'. */
function NovoLancamento({ contas, opcoes, contaPadrao, onClose, onSalvo }) {
  const hoje = new Date();
  const [f, setF] = useState({ data: isoData(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())), historico: "", conta: contaPadrao || (contas[0] && contas[0].id) || "", tipo: "saida", valor: "", categoria: "", observacao: "" });
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const set = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value }));
  useEffect(() => { const on = (e) => e.key === "Escape" && onClose(); addEventListener("keydown", on); return () => removeEventListener("keydown", on); }, []);

  async function salvar(e) {
    e.preventDefault();
    const v = parseValorBR(f.valor);
    if (!f.data) return setErro("Informe a data.");
    if (!f.historico.trim()) return setErro("Informe o histórico.");
    if (!f.conta) return setErro("Selecione a conta.");
    if (!(Math.abs(v) > 0)) return setErro("Informe um valor válido, ex.: 1.234,56.");
    if (!f.categoria) return setErro("Selecione uma categoria.");
    setSalvando(true); setErro("");
    try {
      const { data, error } = await os.sb.from("fin_lancamentos").insert({
        conta_id: f.conta, data: f.data, historico: f.historico.trim().slice(0, 500), valor: (f.tipo === "saida" ? -1 : 1) * Math.abs(v),
        origem: "manual", conciliado: true, categoria_id: f.categoria, observacao: f.observacao.trim() || null,
      }).select("*").single();
      if (error) throw error;
      os.registrarDesfazer(ESCOPO, "novo lançamento manual", os.desfazerCriacao("fin_lancamentos", data, "novo lançamento manual"), { toast: false });
      onSalvo();
    } catch (err) { setErro(os.errMsg(err)); setSalvando(false); }
  }
  const rot = "mb-2 block text-[14.5px] font-black uppercase tracking-widest text-slate-500";
  return html`<div class="fin-page fixed inset-0 z-[100] flex items-center justify-center p-4" style="padding:1rem">
    <div class="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick=${onClose}></div>
    <form onSubmit=${salvar} role="dialog" aria-modal="true" aria-label="Novo lançamento"
      class="relative max-h-[92vh] w-full max-w-[640px] overflow-y-auto rounded-[2.5rem] border border-white/20 bg-white p-8 shadow-[0_32px_80px_-20px_rgba(0,0,0,0.15)]" style="border-top:4px solid #10b981">
      <button type="button" onClick=${onClose} aria-label="Fechar" class="absolute right-6 top-6 rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-900"><${Ic} nome="x" class="h-5 w-5" /></button>
      <p class="text-[16px] font-black uppercase tracking-[0.2em] text-emerald-700">Lançamento manual</p>
      <h3 class="mt-2 text-xl font-black tracking-tight text-slate-900">Novo lançamento</h3>
      <p class="mt-1 text-sm font-medium text-slate-500">Entra já conciliado e compõe o Fluxo de Caixa e a DRE.</p>
      <div class="mt-6 grid gap-4 sm:grid-cols-2">
        <label><span class=${rot}>Data</span><input type="date" value=${f.data} onInput=${set("data")} class="filter-select h-12 py-0" required /></label>
        <label><span class=${rot}>Conta</span>
          <select value=${f.conta} onChange=${set("conta")} class="filter-select h-12 py-0">
            <option value="">Selecione uma conta</option>
            ${contas.map((c) => html`<option value=${c.id}>${c.banco ? `${c.banco} · ` : ""}${c.apelido}</option>`)}
          </select>
          ${!contas.length ? html`<a href="#/financeiro/contas" class="mt-2 inline-flex text-xs font-black text-emerald-700">Cadastrar conta</a>` : null}
        </label>
        <label class="sm:col-span-2"><span class=${rot}>Histórico</span><input value=${f.historico} onInput=${set("historico")} maxLength="500" placeholder="Ex.: Pagamento fornecedor" class="filter-select h-12 py-0" /></label>
        <div><span class=${rot}>Tipo</span>
          <div class="flex rounded-xl bg-slate-100 p-1" role="group">
            ${[["entrada", "Entrada"], ["saida", "Saída"]].map(([v, r]) => html`<button type="button" aria-pressed=${f.tipo === v} onClick=${() => setF((o) => ({ ...o, tipo: v }))} class=${classeAba(f.tipo === v)}>${r}</button>`)}
          </div>
        </div>
        <label><span class=${rot}>Valor</span><input value=${f.valor} onInput=${set("valor")} inputMode="decimal" placeholder="Ex.: 1.234,56" class="filter-select h-12 py-0" /></label>
        <div class="sm:col-span-2"><span class=${rot}>Categoria</span><${SelectCategoria} valor=${f.categoria} opcoes=${opcoes} onChange=${(v) => setF((o) => ({ ...o, categoria: v }))} /></div>
        <label class="sm:col-span-2"><span class=${rot}>Observação</span><textarea value=${f.observacao} onInput=${set("observacao")} rows="2" class="filter-select py-3"></textarea></label>
      </div>
      ${erro ? html`<p role="alert" class="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800">${erro}</p>` : null}
      <div class="mt-6 flex w-full gap-3">
        <button type="button" onClick=${onClose} class="flex-1 rounded-2xl border border-slate-100 bg-slate-50 py-4 text-[17px] font-black uppercase tracking-widest text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900">Cancelar</button>
        <button type="submit" disabled=${salvando} class="premium-button-primary flex-1 py-4 text-[17px] uppercase tracking-widest disabled:opacity-50">${salvando ? "Salvando..." : "Salvar"}</button>
      </div>
    </form>
  </div>`;
}

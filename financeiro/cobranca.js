// Financeiro · Cobrança — pagamentos em aberto, vencidos e a vencer (Hotmart + cobranças manuais).
// Não existe no Craft: segue a linguagem visual das outras telas (comum.js). Base: ./comum.js (não editar lá).
// Dados: public.fin_cobrancas (RLS aba financeiro). Linhas origem='hotmart' vêm da Edge Function `hotmart`
// (op 'sync_cobrancas', API oficial da Hotmart) e só aceitam edição de `observacoes` (trigger); origem='manual' =
// CRUD completo com DESFAZER. "Atualizar da Hotmart" chama a sincronização na hora; ao abrir a tela ela roda
// sozinha (sem travar a tela) se a última sincronização ok tiver mais de 30 min.
// Situação calculada aqui: Vencido = aberto e vencimento < hoje (data local); A vencer = aberto e >= hoje.
// Duas abas: "A receber" (manuais, parcelas/assinaturas e boletos/Pix ainda válidos) e "Recuperação de vendas"
// (venda avulsa da Hotmart com status OVERDUE = boleto/Pix gerado no checkout e não pago: compra abandonada,
// não dívida de aluna). Ver ehRecuperacao().
import { html } from "htm/preact";
import { useState, useEffect, useMemo, useRef } from "preact/hooks";
import { os, escopoFin, podeEditarFin, FinPage, Icone, ConfirmDialog, AbasToggle, KpiCardDestaque, Pill, brl, cn, dataBR, normalizarTexto, parseValorBR, useLocalState } from "./comum.js";
import { chamarHotmart, BannerSemCredenciais } from "./hotmart.js";

const ESCOPO = escopoFin("cobranca");
const POR_PAGINA = 100;
const AUTO_SYNC_MS = 30 * 60 * 1000;
const TIPOS = [["parcela", "Parcela"], ["boleto_pix", "Boleto/Pix"], ["assinatura", "Assinatura"], ["manual", "Manual"]];
const ROT_TIPO = Object.fromEntries(TIPOS);

/* ============================ Datas (sem fuso) ============================ */
/** Hoje em "AAAA-MM-DD" pela data LOCAL do navegador (não UTC). */
function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Dias entre duas datas ISO puras (b - a). */
function diasEntre(a, b) {
  const p = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}
function somarDias(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function dataHoraBR(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ============================ Dados ============================ */
async function fetchCobrancas() {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await os.sb.from("fin_cobrancas").select("*").order("vencimento").order("id").range(de, de + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
async function fetchStatusSync() {
  const { data, error } = await os.sb.from("sync_status").select("*").eq("chave", "hotmart-cobrancas").maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Situação de uma cobrança: vencido | a_vencer | pago | cancelado.
 *  Venda pendente da Hotmart: o "vencimento" gravado é a data do pedido (a API de vendas não traz o vencimento do
 *  boleto/Pix), então quem decide é o status da Hotmart: WAITING_PAYMENT/PRINTED_BILLET = ainda não venceu, OVERDUE = vencido. */
const HOTMART_AGUARDANDO = ["WAITING_PAYMENT", "PRINTED_BILLET"];
export function situacaoCobranca(c, hoje) {
  if (c.status === "pago") return "pago";
  if (c.status === "cancelado") return "cancelado";
  if (c.origem === "hotmart" && !c.previsto) {
    if (c.status_hotmart === "OVERDUE") return "vencido";
    if (HOTMART_AGUARDANDO.includes(c.status_hotmart)) return "a_vencer";
  }
  return c.vencimento < hoje ? "vencido" : "a_vencer";
}

/** CSV (separador ;, BOM UTF-8, decimal com vírgula) para abrir direto no Excel. */
function baixarCsv(nome, cab, linhas) {
  const esc = (v) => { const t = typeof v === "number" ? String(v).replace(".", ",") : String(v ?? ""); return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = "﻿" + [cab.map(esc).join(";"), ...linhas.map((l) => l.map(esc).join(";"))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = nome + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Boleto/Pix da Hotmart que venceu sem pagamento (compra abandonada): vai para a aba Recuperação de vendas. */
export function ehRecuperacao(c) {
  return c.origem === "hotmart" && !c.previsto && c.status_hotmart === "OVERDUE";
}

const parcelaTxt = (c) => (c.parcela_num ? `${c.parcela_num}${c.parcelas_total ? "/" + c.parcelas_total : ""}` : "");
const rotSituacao = { vencido: "Vencido", a_vencer: "A vencer", pago: "Pago", cancelado: "Cancelado" };

/* ============================ Tela ============================ */
export function CobrancaPage({ me }) {
  const pode = podeEditarFin(me);
  const [linhas, setLinhas] = useState(null);
  const [erroCarga, setErroCarga] = useState(false);
  const [sync, setSync] = useState(null);
  const [pedindoSync, setPedindoSync] = useState(false);
  const [semCred, setSemCred] = useState(false);
  const autoFeito = useRef(false);
  const [aba, setAba] = useLocalState("cobranca:aba", "receber");
  const recup = aba === "recuperacao";
  const [situacao, setSituacao] = useLocalState("cobranca:situacao", "aberto");
  const [origem, setOrigem] = useLocalState("cobranca:origem", "all");
  const [produto, setProduto] = useLocalState("cobranca:produto", "all");
  const [tipo, setTipo] = useLocalState("cobranca:tipo", "all");
  const [de, setDe] = useLocalState("cobranca:de", "");
  const [ate, setAte] = useLocalState("cobranca:ate", "");
  const [previstas, setPrevistas] = useLocalState("cobranca:previstas", true);
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(POR_PAGINA);
  const [modal, setModal] = useState(null); // { modo:"novo"|"editar"|"obs", linha }
  const [confirmacao, setConfirmacao] = useState(null);
  const [ocupadoId, setOcupadoId] = useState(null);
  const pedido = useRef(0);
  const hoje = hojeLocal();

  async function carregar() {
    const n = ++pedido.current;
    setErroCarga(false);
    try {
      const [ls, st] = await Promise.all([fetchCobrancas(), fetchStatusSync().catch(() => null)]);
      if (n !== pedido.current) return;
      setLinhas(ls); setSync(st);
    } catch (e) {
      if (n !== pedido.current) return;
      os.notify(os.errMsg(e), "err"); setErroCarga(true); setLinhas((l) => l || []);
    }
  }
  useEffect(() => { carregar(); }, []);
  // Ao abrir: se a última sincronização ok tem mais de 30 min (ou nunca rodou), sincroniza uma vez em segundo plano.
  useEffect(() => {
    if (autoFeito.current || linhas === null || !pode) return;
    autoFeito.current = true;
    const ultimaOk = sync && sync.ultimo_status === "ok" && sync.ultima_execucao_em ? new Date(sync.ultima_execucao_em).getTime() : 0;
    if (Date.now() - ultimaOk > AUTO_SYNC_MS) sincronizar(false);
  }, [linhas, sync]);
  os.useAoDesfazer && os.useAoDesfazer(ESCOPO, carregar);
  useEffect(() => { setLimite(POR_PAGINA); }, [aba, situacao, origem, produto, tipo, de, ate, previstas, busca]);

  const produtos = useMemo(() => [...new Set((linhas || []).map((c) => c.produto).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [linhas]);

  const qtdAbas = useMemo(() => {
    let r = 0, n = 0;
    for (const c of linhas || []) if (c.status === "aberto") ehRecuperacao(c) ? r++ : n++;
    return { receber: n, recuperacao: r };
  }, [linhas]);

  // Filtros que valem para cards e tabela (tudo menos Situação). Na Recuperação, origem/tipo/previstas não se aplicam.
  const base = useMemo(() => {
    const t = normalizarTexto(busca.trim());
    return (linhas || []).filter((c) =>
      ehRecuperacao(c) === recup &&
      (recup || ((origem === "all" || c.origem === origem) && (tipo === "all" || c.tipo === tipo) && (previstas || !c.previsto))) &&
      (produto === "all" || c.produto === produto) &&
      (!de || c.vencimento >= de) && (!ate || c.vencimento <= ate) &&
      (!t || normalizarTexto(`${c.cliente_nome} ${c.cliente_email} ${c.transacao}`).includes(t)));
  }, [linhas, recup, origem, produto, tipo, previstas, de, ate, busca]);

  const cards = useMemo(() => {
    if (recup) {
      // Na Recuperação o "vencimento" é a data do pedido: separa pelo quão recente foi a compra abandonada.
      const d7 = somarDias(hoje, -7), d30 = somarDias(hoje, -30);
      const acc = { aberto: [0, 0], d7: [0, 0], d30: [0, 0], antigas: [0, 0] };
      const add = (k, v) => { acc[k][0] += v; acc[k][1] += 1; };
      for (const c of base) {
        if (c.status !== "aberto") continue;
        const v = Number(c.valor) || 0;
        add("aberto", v);
        add(c.vencimento >= d7 ? "d7" : c.vencimento >= d30 ? "d30" : "antigas", v);
      }
      return acc;
    }
    const em30 = somarDias(hoje, 30);
    const acc = { aberto: [0, 0], vencido: [0, 0], prox30: [0, 0], depois: [0, 0] };
    const add = (k, v) => { acc[k][0] += v; acc[k][1] += 1; };
    for (const c of base) {
      if (c.status !== "aberto") continue;
      const v = Number(c.valor) || 0;
      add("aberto", v);
      if (situacaoCobranca(c, hoje) === "vencido") add("vencido", v);
      else if (c.vencimento <= em30) add("prox30", v);
      else add("depois", v);
    }
    return acc;
  }, [base, hoje, recup]);

  const visiveis = useMemo(() => base.filter((c) => {
    if (recup) return c.status === "aberto";
    const s = situacaoCobranca(c, hoje);
    return situacao === "aberto" ? c.status === "aberto" : s === situacao;
  }), [base, situacao, hoje, recup]);
  const totalVisivel = visiveis.reduce((a, c) => a + (Number(c.valor) || 0), 0);
  const semHotmart = linhas && !linhas.some((c) => c.origem === "hotmart");

  /** Sincroniza com a API da Hotmart (Edge Function `hotmart`, op sync_cobrancas) e recarrega. manual = clique no botão. */
  async function sincronizar(manual) {
    if (pedindoSync) return;
    setPedindoSync(true);
    try {
      const r = await chamarHotmart({ op: "sync_cobrancas" });
      if (r.semCredenciais) { setSemCred(true); if (manual) os.notify(r.error, "err"); return; }
      setSemCred(false);
      if (!r.ok) os.notify(r.error || "Não foi possível atualizar da Hotmart.", "err");
      else if (manual) os.notify(r.pulado ? "Já atualizado há menos de 2 minutos." : "Cobranças atualizadas da Hotmart.", "ok");
      await carregar();
    } catch (e) { os.notify(os.errMsg(e), "err"); }
    finally { setPedindoSync(false); }
  }

  async function snapshot(id) {
    const { data, error } = await os.sb.from("fin_cobrancas").select("*").eq("id", id).single();
    if (error) throw error;
    return data;
  }
  async function mudarStatus(c, patch, rotulo) {
    setOcupadoId(c.id);
    try {
      const antes = await snapshot(c.id);
      const { data, error } = await os.sb.from("fin_cobrancas").update(patch).eq("id", c.id).select("*").single();
      if (error) throw error;
      os.registrarDesfazer(ESCOPO, rotulo, os.desfazerEdicao("fin_cobrancas", antes, data, rotulo));
      await carregar();
    } catch (e) { os.notify(os.errMsg(e), "err"); }
    finally { setOcupadoId(null); }
  }
  const nomeCli = (c) => c.cliente_nome || c.cliente_email || "cliente";
  const marcarPaga = (c) => mudarStatus(c, { status: "pago", pago_em: hojeLocal() }, `marcar como paga a cobrança de ${nomeCli(c)}`);
  const reabrir = (c) => mudarStatus(c, { status: "aberto", pago_em: null }, `reabrir a cobrança de ${nomeCli(c)}`);
  function cancelar(c) {
    setConfirmacao({ titulo: "Cancelar cobrança?", variante: "warning", textoConfirmar: "Cancelar cobrança",
      descricao: `A cobrança de ${nomeCli(c)} (${brl(c.valor)}) deixa de contar como em aberto. Dá para desfazer pelo botão DESFAZER.`,
      onConfirm: () => mudarStatus(c, { status: "cancelado" }, `cancelar a cobrança de ${nomeCli(c)}`) });
  }
  function excluir(c) {
    setConfirmacao({ titulo: "Excluir cobrança?", variante: "danger", textoConfirmar: "Excluir",
      descricao: `A cobrança manual de ${nomeCli(c)} (${brl(c.valor)}) será excluída. Dá para desfazer pelo botão DESFAZER enquanto a página estiver aberta.`,
      onConfirm: async () => {
        setOcupadoId(c.id);
        try {
          const antes = await snapshot(c.id);
          const { data, error } = await os.sb.from("fin_cobrancas").delete().eq("id", c.id).select("id");
          if (error) throw error;
          if (!data || !data.length) throw new Error("Sem permissão para excluir esta cobrança.");
          const rot = `excluir a cobrança de ${nomeCli(c)}`;
          os.registrarDesfazer(ESCOPO, rot, os.desfazerExclusao("fin_cobrancas", antes, rot));
          await carregar();
        } catch (e) { os.notify(os.errMsg(e), "err"); }
        finally { setOcupadoId(null); }
      } });
  }
  async function copiar(txt) {
    try { await navigator.clipboard.writeText(txt); os.notify("E-mail copiado.", "ok"); } catch (_) { os.notify("Não foi possível copiar.", "err"); }
  }

  function exportar() {
    const cab = ["Vencimento", "Cliente", "E-mail", "Telefone", "Produto", "Descrição", "Parcela", "Forma de pagamento", "Valor", "Situação", "Prevista", "Origem", "Tipo", "Transação", "Observações"];
    baixarCsv(`${recup ? "Recuperacao_vendas" : "Cobrancas"}_${hoje}`, cab, visiveis.map((c) => [dataBR(c.vencimento), c.cliente_nome, c.cliente_email, c.cliente_telefone, c.produto, c.descricao,
      parcelaTxt(c), c.forma_pagamento, Number(c.valor) || 0, ehRecuperacao(c) ? "Não pago" : rotSituacao[situacaoCobranca(c, hoje)], c.previsto ? "Sim" : "Não",
      c.origem === "hotmart" ? "Hotmart" : "Manual", ROT_TIPO[c.tipo] || c.tipo, c.transacao, c.observacoes]));
  }

  const qtd = (n) => `${n} cobrança${n === 1 ? "" : "s"}`;
  const carregando = linhas === null;

  return html`<${FinPage} class="space-y-5">
    <section class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p class="text-[16px] font-black uppercase tracking-[0.2em] text-emerald-700">Contas a receber</p>
        <h1 class="mt-2 text-3xl font-black tracking-[-0.045em] text-[#07110e]">Cobrança</h1>
        <p class=${cn("mt-2 text-sm font-semibold", sync && sync.ultimo_status === "erro" ? "text-rose-700" : "text-slate-500")}>
          ${sync && sync.ultima_execucao_em
            ? html`Última atualização da Hotmart: ${dataHoraBR(sync.ultima_execucao_em)}${sync.ultimo_detalhe ? html` · ${sync.ultimo_detalhe}` : null}`
            : "A Hotmart ainda não foi sincronizada."}
          ${pedindoSync ? html`<span class="ml-2 inline-flex items-center gap-1 text-emerald-700"><${Icone} nome="loader" class="h-3 w-3 fin-spin" />atualizando da Hotmart...</span>` : null}
        </p>
      </div>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="button" onClick=${exportar} disabled=${!visiveis.length}
          class="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-xs font-bold text-slate-700 transition hover:border-emerald-200 disabled:opacity-40">
          <${Icone} nome="download" class="h-4 w-4" />Exportar CSV</button>
        ${pode ? html`<button type="button" onClick=${() => sincronizar(true)} disabled=${pedindoSync}
          class="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-xs font-bold text-slate-700 transition hover:border-emerald-200 disabled:opacity-50">
          <${Icone} nome=${pedindoSync ? "loader" : "rotate"} class=${cn("h-4 w-4", pedindoSync && "fin-spin")} />Atualizar da Hotmart</button>
        <button type="button" onClick=${() => setModal({ modo: "novo" })} class="premium-button-primary h-12 text-xs">
          <${Icone} nome="plus" class="h-4 w-4" />Nova cobrança</button>` : null}
      </div>
    </section>

    <${AbasToggle} class="max-w-xl" valor=${aba} onChange=${setAba} opcoes=${[
      ["receber", `A receber${linhas ? " (" + qtdAbas.receber + ")" : ""}`],
      ["recuperacao", `Recuperação de vendas${linhas ? " (" + qtdAbas.recuperacao + ")" : ""}`]]} />
    ${recup ? html`<p class="-mt-2 text-xs font-semibold text-slate-500">Boletos e Pix gerados no checkout da Hotmart que venceram sem pagamento. São compras abandonadas, não dívidas de alunas: use a lista para recuperar vendas. A data é a do pedido.</p>` : null}

    ${recup ? html`<section class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <${KpiCardDestaque} rotulo="Compras não pagas" valor=${cards.aberto[0]} icone="wallet" tom="dark" dica=${qtd(cards.aberto[1])} carregando=${carregando} />
      <${KpiCardDestaque} rotulo="Últimos 7 dias" valor=${cards.d7[0]} icone="alert" tom="emerald" dica=${qtd(cards.d7[1])} carregando=${carregando} />
      <${KpiCardDestaque} rotulo="De 8 a 30 dias" valor=${cards.d30[0]} icone="calendar" tom="light" dica=${qtd(cards.d30[1])} carregando=${carregando} />
      <${KpiCardDestaque} rotulo="Mais de 30 dias" valor=${cards.antigas[0]} icone="trending-up" tom="light" dica=${qtd(cards.antigas[1])} carregando=${carregando} />
    </section>` : html`<section class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <${KpiCardDestaque} rotulo="Total em aberto" valor=${cards.aberto[0]} icone="wallet" tom="dark" dica=${qtd(cards.aberto[1])} carregando=${carregando} />
      <${KpiCardDestaque} rotulo="Vencido" valor=${cards.vencido[0]} icone="alert" tom="negative" dica=${qtd(cards.vencido[1])} carregando=${carregando} />
      <${KpiCardDestaque} rotulo="A vencer nos próximos 30 dias" valor=${cards.prox30[0]} icone="calendar" tom="emerald" dica=${qtd(cards.prox30[1])} carregando=${carregando} />
      <${KpiCardDestaque} rotulo="A vencer depois" valor=${cards.depois[0]} icone="trending-up" tom="light" dica=${qtd(cards.depois[1])} carregando=${carregando} />
    </section>`}

    <section class="rounded-[1.4rem] border border-slate-200 bg-white p-3 shadow-sm">
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        ${recup ? null : html`<select aria-label="Situação" value=${situacao} onChange=${(e) => setSituacao(e.target.value)} class="filter-select h-11 py-0">
          <option value="aberto">Todas em aberto</option><option value="vencido">Vencidas</option><option value="a_vencer">A vencer</option>
          <option value="pago">Pagas</option><option value="cancelado">Canceladas</option>
        </select>
        <select aria-label="Origem" value=${origem} onChange=${(e) => setOrigem(e.target.value)} class="filter-select h-11 py-0">
          <option value="all">Todas as origens</option><option value="hotmart">Hotmart</option><option value="manual">Manual</option>
        </select>`}
        <select aria-label="Produto" value=${produto} onChange=${(e) => setProduto(e.target.value)} class="filter-select h-11 py-0">
          <option value="all">Todos os produtos</option>
          ${produtos.map((p) => html`<option value=${p}>${p}</option>`)}
        </select>
        ${recup ? null : html`<select aria-label="Tipo" value=${tipo} onChange=${(e) => setTipo(e.target.value)} class="filter-select h-11 py-0">
          <option value="all">Todos os tipos</option>
          ${TIPOS.map(([v, r]) => html`<option value=${v}>${r}</option>`)}
        </select>`}
        <input type="date" aria-label=${recup ? "Pedido de" : "Vencimento de"} title=${recup ? "Pedido de" : "Vencimento de"} value=${de} onInput=${(e) => setDe(e.target.value)} class="filter-select h-11 py-0" />
        <input type="date" aria-label=${recup ? "Pedido até" : "Vencimento até"} title=${recup ? "Pedido até" : "Vencimento até"} value=${ate} onInput=${(e) => setAte(e.target.value)} class="filter-select h-11 py-0" />
        <label class="relative sm:col-span-2 lg:col-span-1 xl:col-span-1">
          <${Icone} nome="search" class="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
          <input value=${busca} onInput=${(e) => setBusca(e.target.value)} placeholder="Cliente, e-mail ou transação..." class="filter-select h-11 py-0 pl-11" />
        </label>
        ${recup ? null : html`<label class="flex h-11 cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 px-4 text-xs font-bold text-slate-700">
          <input type="checkbox" checked=${previstas} onChange=${(e) => setPrevistas(e.target.checked)} class="h-4 w-4 accent-emerald-500" />
          Incluir parcelas previstas
        </label>`}
      </div>
      ${de || ate ? html`<button type="button" onClick=${() => { setDe(""); setAte(""); }} class="mt-2 px-2 text-xs font-bold text-emerald-700 hover:underline">Limpar período</button>` : null}
    </section>

    ${semCred ? html`<${BannerSemCredenciais} />` : null}
    ${semHotmart && !erroCarga && !semCred ? html`<div role="status" class="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-bold text-amber-900">
      <${Icone} nome="info" class="h-5 w-5 shrink-0" />
      <span>Ainda não há cobranças da Hotmart. A lista é preenchida pela sincronização com a API da Hotmart: ela roda sozinha ao abrir esta tela (se a última tiver mais de 30 minutos) e pelo botão "Atualizar da Hotmart". Cobranças manuais já podem ser cadastradas em "Nova cobrança".</span>
    </div>` : null}
    ${!pode ? html`<p class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-bold text-amber-900">Você pode consultar as cobranças, mas não tem permissão para alterar.</p>` : null}

    <section class="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4">
        <p class="text-[16px] font-black uppercase tracking-widest text-slate-500">${qtd(visiveis.length)}</p>
        <p class="text-sm font-black tabular-nums text-slate-800">${brl(totalVisivel)}</p>
      </div>
      <div class="overflow-x-auto"><table class="w-full min-w-[1300px]">
        <thead><tr class="bg-slate-50 text-left text-[13.5px] font-black uppercase tracking-widest text-slate-400">
          <th class="px-4 py-3">${recup ? "Pedido" : "Vencimento"}</th><th class="px-4 py-3">Cliente</th><th class="px-4 py-3">Produto</th><th class="px-4 py-3">Descrição / parcela</th>
          <th class="px-4 py-3">Forma</th><th class="px-4 py-3 text-right">Valor</th><th class="px-4 py-3">Situação</th><th class="px-4 py-3">Origem</th><th class="px-4 py-3 text-right">Ações</th>
        </tr></thead>
        <tbody>
          ${carregando ? html`<tr><td colSpan="9" class="p-16 text-center text-xs font-bold text-slate-400">
              <${Icone} nome="loader" class="mx-auto mb-3 h-6 w-6 fin-spin text-emerald-600" />Carregando cobranças...</td></tr>`
            : visiveis.length ? visiveis.slice(0, limite).map((c) => html`<${LinhaCobranca} key=${c.id} c=${c} hoje=${hoje} pode=${pode} ocupado=${ocupadoId === c.id}
                onEditar=${() => setModal({ modo: c.origem === "manual" ? "editar" : "obs", linha: c })}
                onPaga=${() => marcarPaga(c)} onReabrir=${() => reabrir(c)} onCancelar=${() => cancelar(c)} onExcluir=${() => excluir(c)} onCopiar=${copiar} />`)
            : html`<tr><td colSpan="9" class="p-16 text-center">
                <${Icone} nome="receipt" class="mx-auto h-8 w-8 text-slate-200" />
                <p class="mt-3 text-sm font-black text-slate-600">${erroCarga ? "Não foi possível carregar as cobranças" : "Nenhuma cobrança encontrada"}</p>
                <p class="mt-1 text-xs font-medium text-slate-400">${erroCarga ? "Nenhum dado foi alterado." : semHotmart ? "A lista é preenchida depois da primeira sincronização com a Hotmart (botão Atualizar da Hotmart)." : "Ajuste os filtros."}</p>
                ${erroCarga ? html`<button type="button" onClick=${carregar} class="premium-button-primary mt-5">Tentar novamente</button>` : null}
              </td></tr>`}
        </tbody>
      </table></div>
      ${visiveis.length > limite ? html`<div class="flex items-center justify-center gap-3 border-t border-slate-100 p-4">
        <span class="text-xs font-bold text-slate-400">Mostrando ${limite} de ${visiveis.length}</span>
        <button type="button" onClick=${() => setLimite((l) => l + POR_PAGINA * 2)} class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:border-emerald-200">Mostrar mais</button>
        <button type="button" onClick=${() => setLimite(visiveis.length)} class="rounded-xl px-4 py-2 text-xs font-bold text-emerald-700 hover:underline">Mostrar todas</button>
      </div>` : null}
    </section>

    <${ConfirmDialog} aberto=${!!confirmacao} titulo=${confirmacao?.titulo} descricao=${confirmacao?.descricao} variante=${confirmacao?.variante || "danger"}
      textoConfirmar=${confirmacao?.textoConfirmar} textoCancelar="Voltar" onConfirm=${() => confirmacao && confirmacao.onConfirm()} onClose=${() => setConfirmacao(null)} />
    ${modal ? html`<${ModalCobranca} modo=${modal.modo} linha=${modal.linha} produtos=${produtos} onClose=${() => setModal(null)}
      onSalvo=${() => { setModal(null); carregar(); }} />` : null}
  <//>`;
}

function BadgeSituacao({ c, hoje }) {
  const s = situacaoCobranca(c, hoje);
  if (s === "vencido" && ehRecuperacao(c)) {
    const n = diasEntre(c.vencimento, hoje);
    return html`<${Pill} tom="neutro" class="whitespace-nowrap">Não pago · pedido há ${n} dia${n === 1 ? "" : "s"}<//>`;
  }
  if (s === "vencido") {
    const n = diasEntre(c.vencimento, hoje);
    return html`<${Pill} tom="rosa" class="whitespace-nowrap">Vencido · há ${n} dia${n === 1 ? "" : "s"}<//>`;
  }
  if (s === "a_vencer") {
    const n = diasEntre(hoje, c.vencimento);
    // n < 0: venda da Hotmart aguardando pagamento (a data é a do pedido, não o vencimento).
    if (n < 0) return html`<${Pill} tom="ambar" class="whitespace-nowrap">Aguardando pagamento<//>`;
    const txt = n === 0 ? "Vence hoje" : `A vencer · ${n} dia${n === 1 ? "" : "s"}`;
    return html`<${Pill} tom=${n <= 7 ? "ambar" : "neutro"} class="whitespace-nowrap">${txt}<//>`;
  }
  if (s === "pago") return html`<${Pill} tom="verde" class="whitespace-nowrap">Pago${c.pago_em ? " · " + dataBR(c.pago_em) : ""}<//>`;
  return html`<${Pill} tom="neutro" class="whitespace-nowrap line-through">Cancelado<//>`;
}

function LinhaCobranca({ c, hoje, pode, ocupado, onEditar, onPaga, onReabrir, onCancelar, onExcluir, onCopiar }) {
  const manual = c.origem === "manual";
  const btn = "flex h-9 items-center gap-1 rounded-xl border border-slate-200 px-3 text-[14.5px] font-black uppercase tracking-widest text-slate-500 transition hover:border-emerald-200 hover:text-emerald-700 disabled:opacity-50";
  const btnIc = "flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition disabled:opacity-50";
  return html`<tr class=${cn("border-t border-slate-100 text-xs transition hover:bg-slate-50/60", c.previsto && "bg-slate-50/40")}>
    <td class="whitespace-nowrap px-4 py-3 font-bold text-slate-600">${dataBR(c.vencimento)}</td>
    <td class="max-w-[260px] px-4 py-3">
      <p class="truncate font-black text-slate-800" title=${c.cliente_nome || ""}>${c.cliente_nome || "Sem nome"}</p>
      ${c.cliente_email ? html`<p class="truncate text-[13.5px] font-medium text-slate-400" title=${c.cliente_email}>${c.cliente_email}</p>` : null}
    </td>
    <td class="max-w-[220px] px-4 py-3"><p class="truncate font-semibold text-slate-600" title=${c.produto || ""}>${c.produto || "-"}</p></td>
    <td class="max-w-[240px] px-4 py-3">
      <p class="truncate font-semibold text-slate-600" title=${c.descricao || ""}>${parcelaTxt(c) ? html`<span class="mr-1 font-black text-slate-800">${parcelaTxt(c)}</span>` : null}${c.descricao || (parcelaTxt(c) ? "" : "-")}</p>
      <div class="mt-1 flex flex-wrap gap-1">
        ${c.previsto ? html`<span class="rounded-md border border-dashed border-slate-300 px-1.5 py-0.5 text-[12px] font-bold text-slate-500" title="Parcela futura projetada a partir do parcelamento/assinatura">prevista</span>` : null}
        ${c.tipo && c.tipo !== "manual" ? html`<span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[12px] font-bold text-slate-500">${ROT_TIPO[c.tipo] || c.tipo}</span>` : null}
        ${c.observacoes ? html`<span class="max-w-[200px] truncate rounded-md bg-amber-50 px-1.5 py-0.5 text-[12px] font-bold text-amber-800" title=${c.observacoes}>Obs.: ${c.observacoes}</span>` : null}
      </div>
    </td>
    <td class="px-4 py-3 font-semibold text-slate-500">${c.forma_pagamento || "-"}</td>
    <td class="whitespace-nowrap px-4 py-3 text-right font-black tabular-nums text-slate-800">${brl(c.valor)}</td>
    <td class="px-4 py-3"><${BadgeSituacao} c=${c} hoje=${hoje} /></td>
    <td class="px-4 py-3">
      ${manual ? html`<span class="text-[13.5px] font-black uppercase tracking-widest text-slate-400">Manual</span>`
        : html`<span class="text-[13.5px] font-black uppercase tracking-widest text-emerald-700">Hotmart</span>
          ${c.transacao ? html`<p class="mt-1 whitespace-nowrap text-[12px] font-medium text-slate-400" title="Procure esta transação no painel da Hotmart (Minhas vendas)">Ver na Hotmart: ${c.transacao}</p>` : null}`}
    </td>
    <td class="px-4 py-3"><div class="flex justify-end gap-2">
      ${c.cliente_email ? html`<button type="button" onClick=${() => onCopiar(c.cliente_email)} aria-label="Copiar e-mail" title="Copiar e-mail" class=${cn(btnIc, "hover:border-emerald-200 hover:text-emerald-700")}><${Icone} nome="file" class="h-3.5 w-3.5" /></button>` : null}
      ${pode ? html`<button type="button" onClick=${onEditar} disabled=${ocupado} aria-label=${manual ? "Editar cobrança" : "Editar observações"} title=${manual ? "Editar" : "Observações"}
        class=${cn(btnIc, "hover:border-emerald-200 hover:text-emerald-700")}><${Icone} nome="pencil" class="h-3.5 w-3.5" /></button>` : null}
      ${pode && manual && c.status === "aberto" ? html`
        <button type="button" onClick=${onPaga} disabled=${ocupado} class=${btn}><${Icone} nome=${ocupado ? "loader" : "check-circle"} class=${cn("h-3 w-3", ocupado && "fin-spin")} />Paga</button>
        <button type="button" onClick=${onCancelar} disabled=${ocupado} aria-label="Cancelar cobrança" title="Cancelar" class=${cn(btnIc, "hover:border-amber-200 hover:text-amber-700")}><${Icone} nome="x" class="h-3.5 w-3.5" /></button>` : null}
      ${pode && manual && c.status !== "aberto" ? html`<button type="button" onClick=${onReabrir} disabled=${ocupado} class=${btn}><${Icone} nome="rotate" class="h-3 w-3" />Reabrir</button>` : null}
      ${pode && manual ? html`<button type="button" onClick=${onExcluir} disabled=${ocupado} aria-label="Excluir cobrança" title="Excluir" class=${cn(btnIc, "hover:border-rose-200 hover:text-rose-600")}><${Icone} nome="trash" class="h-3.5 w-3.5" /></button>` : null}
    </div></td>
  </tr>`;
}

/** Criar/editar cobrança manual, ou só as observações de uma cobrança da Hotmart (modo "obs"). */
function ModalCobranca({ modo, linha, produtos, onClose, onSalvo }) {
  const l = linha || {};
  const soObs = modo === "obs";
  const [f, setF] = useState({
    cliente_nome: l.cliente_nome || "", cliente_email: l.cliente_email || "", cliente_telefone: l.cliente_telefone || "",
    produto: l.produto || "", descricao: l.descricao || "",
    valor: l.valor != null ? Number(l.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "",
    vencimento: l.vencimento || hojeLocal(), forma_pagamento: l.forma_pagamento || "", observacoes: l.observacoes || "",
  });
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const set = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value }));
  useEffect(() => { const on = (e) => e.key === "Escape" && onClose(); addEventListener("keydown", on); return () => removeEventListener("keydown", on); }, []);

  async function salvar(e) {
    e.preventDefault();
    if (salvando) return;
    let patch;
    if (soObs) patch = { observacoes: f.observacoes.trim() || null };
    else {
      const v = parseValorBR(f.valor);
      if (!f.cliente_nome.trim()) return setErro("Informe o nome do cliente.");
      if (!Number.isFinite(v) || v < 0) return setErro("Informe um valor válido, ex.: 1.234,56.");
      if (!f.vencimento) return setErro("Informe o vencimento.");
      if (f.cliente_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.cliente_email.trim())) return setErro("E-mail inválido.");
      const t = (s) => s.trim() || null;
      patch = { cliente_nome: t(f.cliente_nome), cliente_email: t(f.cliente_email.toLowerCase()), cliente_telefone: t(f.cliente_telefone),
        produto: t(f.produto), descricao: t(f.descricao), valor: Math.round(v * 100) / 100, vencimento: f.vencimento,
        forma_pagamento: t(f.forma_pagamento), observacoes: t(f.observacoes) };
    }
    setSalvando(true); setErro("");
    try {
      const nome = (soObs ? l.cliente_nome : patch.cliente_nome) || "cliente";
      if (modo === "novo") {
        const { data, error } = await os.sb.from("fin_cobrancas").insert({ ...patch, origem: "manual", tipo: "manual", status: "aberto" }).select("*").single();
        if (error) throw error;
        const rot = `cadastrar a cobrança de ${nome}`;
        os.registrarDesfazer(ESCOPO, rot, os.desfazerCriacao("fin_cobrancas", data, rot));
      } else {
        const { data: antes, error: e0 } = await os.sb.from("fin_cobrancas").select("*").eq("id", l.id).single();
        if (e0) throw e0;
        const { data, error } = await os.sb.from("fin_cobrancas").update(patch).eq("id", l.id).select("*").single();
        if (error) throw error;
        const rot = soObs ? `editar observações da cobrança de ${nome}` : `editar a cobrança de ${nome}`;
        os.registrarDesfazer(ESCOPO, rot, os.desfazerEdicao("fin_cobrancas", antes, data, rot));
      }
      onSalvo();
    } catch (err) { setErro(os.errMsg(err)); setSalvando(false); }
  }

  const rot = "mb-2 block text-[14.5px] font-black uppercase tracking-widest text-slate-500";
  const titulo = modo === "novo" ? "Nova cobrança" : soObs ? "Observações" : "Editar cobrança";
  return html`<div class="fin-page fixed inset-0 z-[100] flex items-center justify-center p-4" style="padding:1rem">
    <div class="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick=${onClose}></div>
    <form onSubmit=${salvar} role="dialog" aria-modal="true" aria-label=${titulo}
      class="relative max-h-[92vh] w-full max-w-[640px] overflow-y-auto rounded-[2.5rem] border border-white/20 bg-white p-8 shadow-[0_32px_80px_-20px_rgba(0,0,0,0.15)]" style="border-top:4px solid #10b981">
      <button type="button" onClick=${onClose} aria-label="Fechar" class="absolute right-6 top-6 rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-900"><${Icone} nome="x" class="h-5 w-5" /></button>
      <p class="text-[16px] font-black uppercase tracking-[0.2em] text-emerald-700">${soObs ? "Cobrança da Hotmart" : "Cobrança manual"}</p>
      <h3 class="mt-2 text-xl font-black tracking-tight text-slate-900">${titulo}</h3>
      ${soObs ? html`<div class="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-xs font-semibold text-slate-600">
          <p class="font-black text-slate-800">${l.cliente_nome || "Sem nome"} · ${brl(l.valor)} · vence ${dataBR(l.vencimento)}</p>
          <p class="mt-1">${[l.produto, parcelaTxt(l) && "parcela " + parcelaTxt(l), l.forma_pagamento].filter(Boolean).join(" · ")}</p>
          ${l.transacao ? html`<p class="mt-1">Transação: <span class="font-black">${l.transacao}</span> (procure em Minhas vendas, no painel da Hotmart)</p>` : null}
          <p class="mt-2 text-slate-400">Os dados vêm da Hotmart e não podem ser alterados aqui; só as observações.</p>
        </div>` : html`<p class="mt-1 text-sm font-medium text-slate-500">Uma cobrança fora da Hotmart (boleto avulso, Pix combinado, acordo).</p>`}
      <div class="mt-6 grid gap-4 sm:grid-cols-2">
        ${soObs ? null : html`
          <label class="sm:col-span-2"><span class=${rot}>Cliente</span><input value=${f.cliente_nome} onInput=${set("cliente_nome")} maxLength="200" placeholder="Nome completo" class="filter-select h-12 py-0" /></label>
          <label><span class=${rot}>E-mail</span><input type="email" value=${f.cliente_email} onInput=${set("cliente_email")} maxLength="200" class="filter-select h-12 py-0" /></label>
          <label><span class=${rot}>Telefone</span><input value=${f.cliente_telefone} onInput=${set("cliente_telefone")} maxLength="40" class="filter-select h-12 py-0" /></label>
          <label><span class=${rot}>Produto</span><input value=${f.produto} onInput=${set("produto")} list="fin-cob-produtos" maxLength="200" class="filter-select h-12 py-0" />
            <datalist id="fin-cob-produtos">${produtos.map((p) => html`<option value=${p} />`)}</datalist></label>
          <label><span class=${rot}>Forma de pagamento</span><input value=${f.forma_pagamento} onInput=${set("forma_pagamento")} list="fin-cob-formas" maxLength="60" placeholder="Pix, boleto, cartão..." class="filter-select h-12 py-0" />
            <datalist id="fin-cob-formas"><option value="Pix" /><option value="Boleto" /><option value="Cartão de crédito" /><option value="Transferência" /></datalist></label>
          <label class="sm:col-span-2"><span class=${rot}>Descrição</span><input value=${f.descricao} onInput=${set("descricao")} maxLength="300" placeholder="Ex.: Parcela 2 do acordo" class="filter-select h-12 py-0" /></label>
          <label><span class=${rot}>Valor</span><input value=${f.valor} onInput=${set("valor")} inputMode="decimal" placeholder="Ex.: 1.234,56" class="filter-select h-12 py-0" /></label>
          <label><span class=${rot}>Vencimento</span><input type="date" value=${f.vencimento} onInput=${set("vencimento")} class="filter-select h-12 py-0" /></label>`}
        <label class="sm:col-span-2"><span class=${rot}>Observações</span><textarea value=${f.observacoes} onInput=${set("observacoes")} rows="3" maxLength="2000" class="filter-select py-3"></textarea></label>
      </div>
      ${erro ? html`<p role="alert" class="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800">${erro}</p>` : null}
      <div class="mt-6 flex w-full gap-3">
        <button type="button" onClick=${onClose} class="flex-1 rounded-2xl border border-slate-100 bg-slate-50 py-4 text-[17px] font-black uppercase tracking-widest text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900">Cancelar</button>
        <button type="submit" disabled=${salvando} class="premium-button-primary flex-1 py-4 text-[17px] uppercase tracking-widest disabled:opacity-50">${salvando ? "Salvando..." : "Salvar"}</button>
      </div>
    </form>
  </div>`;
}

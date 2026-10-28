// Financeiro · Estrutura da DRE — tela do Craft Green "Estrutura da DRE" (ref app_estrutura-dre_page).
// Spec: docs/financeiro-spec.md (2.6 e 3.8). Base compartilhada: ./comum.js (não editar lá).
// Props do Router (#/financeiro/estrutura-dre): me (linha de profiles) e query (objeto da query string).
// Escrita: podeEditarFin(me). DESFAZER: escopoFin("estrutura-dre").
// Banco: fin_dre_grupos só aceita mudar `nome` (vazio volta ao padrão); categorias padrão só mudam nome/ordem/ativa
// (triggers fin_dre_*_guarda). "Remover" = ativa=false. Restaurar = RPC fin_restaurar_estrutura_padrao().
import { html } from "htm/preact";
import { useState, useEffect } from "preact/hooks";
import { os, FinPage, Icone, cn, nomeDre, escopoFin, podeEditarFin, fetchGrupos, fetchCategorias, ConfirmDialog } from "./comum.js";

const ESCOPO = escopoFin("estrutura-dre");
const MAX_NOME = 120;
const FORA = "fora-dre"; // chave do bloco "Fora da DRE" no estado de abertos/nova categoria

/* Ícones Lucide que não estão no ICONES de comum.js (ISC). */
const SVG_LOCAL = {
  calculator: '<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
};
function IconeLocal({ nome, class: cls = "h-4 w-4" }) {
  return html`<svg class=${cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: SVG_LOCAL[nome] || "" }}></svg>`;
}

/** Mensagem amigável para erros do banco (triggers de proteção já falam em português). */
function mensagemErro(e) {
  const m = String((e && (e.message || e.details)) || (os.errMsg ? os.errMsg(e) : "") || "");
  if (/protegid|Categoria padrão|Linhas de cálculo fixo|Categorias novas|Informe o nome/i.test(m))
    return m.replace(/^.*?(A ordem|Categoria padrão|Linhas de cálculo|Categorias novas|Informe o nome)/, "$1");
  if (/row-level security|permission denied|42501/i.test(m)) return "Sem permissão para alterar a Estrutura da DRE.";
  return "Não foi possível concluir a alteração." + (m ? " " + m : "");
}
const semAuto = ({ updated_at, ...r }) => r;

export function EstruturaDrePage({ me }) {
  const pode = podeEditarFin(me);
  const [grupos, setGrupos] = useState(null);
  const [categorias, setCategorias] = useState([]);
  const [erro, setErro] = useState(null);
  const [abertos, setAbertos] = useState(() => new Set(["1"]));
  const [editando, setEditando] = useState(null); // { tipo:"grupo"|"categoria", id, valor }
  const [novaEm, setNovaEm] = useState(null);     // id do grupo (ou FORA) com o formulário aberto
  const [novoNome, setNovoNome] = useState("");
  const [remover, setRemover] = useState(null);   // categoria
  const [restaurar, setRestaurar] = useState(false);
  const [msg, setMsg] = useState(null);           // { tom:"success"|"error", texto }
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    setErro(null);
    try {
      const [g, c] = await Promise.all([fetchGrupos(), fetchCategorias({ incluirArquivadas: true })]);
      setCategorias(c);
      setGrupos(g);
    } catch (e) { setErro(e); }
  }
  useEffect(() => { carregar(); }, []);
  os.useAoDesfazer && os.useAoDesfazer(ESCOPO, carregar);

  /** Executa uma escrita: trava a tela, mostra a mensagem do Craft, registra o DESFAZER e recarrega. */
  async function executar(fn, sucesso) {
    if (ocupado) return;
    setOcupado(true);
    try {
      await fn();
      setMsg({ tom: "success", texto: sucesso });
      setEditando(null); setNovaEm(null); setNovoNome("");
      await carregar();
    } catch (e) {
      setMsg({ tom: "error", texto: mensagemErro(e) });
    } finally { setOcupado(false); }
  }

  function salvarNome(ev) {
    ev.preventDefault();
    if (!editando) return;
    const ed = editando, valor = ed.valor.trim().slice(0, MAX_NOME);
    const tabela = ed.tipo === "grupo" ? "fin_dre_grupos" : "fin_dre_categorias";
    const antes = (ed.tipo === "grupo" ? grupos : categorias).find((x) => x.id === ed.id);
    if (!antes) return;
    if (ed.tipo === "categoria" && !valor) { setMsg({ tom: "error", texto: "Informe o nome da categoria." }); return; }
    if (valor === antes.nome) { setEditando(null); return; }
    executar(async () => {
      const { data, error } = await os.sb.from(tabela).update({ nome: valor }).eq("id", ed.id).select("*").single();
      if (error) throw error;
      const rot = `renomear “${ed.tipo === "grupo" ? nomeDre(antes.nome) : antes.nome}”`;
      os.registrarDesfazer(ESCOPO, rot, os.desfazerEdicao(tabela, semAuto(antes), data, rot), { mensagem: "Nome atualizado" });
    }, "Nome atualizado em todo o Financeiro.");
  }

  function criarCategoria(ev, grupoId) {
    ev.preventDefault();
    const nome = novoNome.trim().slice(0, MAX_NOME);
    if (!nome) { setMsg({ tom: "error", texto: "Informe o nome da categoria." }); return; }
    const fora = grupoId === FORA;
    const irmas = categorias.filter((c) => (fora ? c.fora_dre : c.grupo_id === grupoId));
    const ordem = irmas.reduce((m, c) => Math.max(m, Number(c.ordem) || 0), 0) + 1;
    executar(async () => {
      const { data, error } = await os.sb.from("fin_dre_categorias")
        .insert({ grupo_id: fora ? null : grupoId, fora_dre: fora, nome, ordem, ativa: true }).select("*").single();
      if (error) throw error;
      const rot = `criar a categoria “${nome}”`;
      os.registrarDesfazer(ESCOPO, rot, os.desfazerCriacao("fin_dre_categorias", data, rot), { mensagem: "Categoria criada" });
    }, "Categoria criada e disponibilizada na conciliação.");
  }

  function mudarAtiva(cat, ativa) {
    executar(async () => {
      const { data, error } = await os.sb.from("fin_dre_categorias").update({ ativa }).eq("id", cat.id).select("*").single();
      if (error) throw error;
      const rot = `${ativa ? "reativar" : "remover"} a categoria “${cat.nome}”`;
      os.registrarDesfazer(ESCOPO, rot, os.desfazerEdicao("fin_dre_categorias", semAuto(cat), data, rot),
        { mensagem: ativa ? "Categoria reativada" : "Categoria removida" });
    }, ativa ? "Categoria reativada e disponível na conciliação." : "Categoria removida das novas conciliações. O histórico foi preservado.");
  }

  function restaurarPadrao() {
    const gAntes = grupos.map((g) => ({ id: g.id, nome: g.nome }));
    const cAntes = categorias.map((c) => ({ id: c.id, nome: c.nome, ativa: c.ativa }));
    executar(async () => {
      const { error } = await os.sb.rpc("fin_restaurar_estrutura_padrao");
      if (error) throw error;
      os.registrarDesfazer(ESCOPO, "restaurar o modelo padrão", async () => {
        // Volta nome (linhas) e nome/ativa (categorias) só do que a restauração mudou.
        const [gAgora, cAgora] = await Promise.all([fetchGrupos(), fetchCategorias({ incluirArquivadas: true })]);
        const gMap = new Map(gAgora.map((g) => [g.id, g])), cMap = new Map(cAgora.map((c) => [c.id, c]));
        const tarefas = [];
        for (const g of gAntes) {
          const a = gMap.get(g.id);
          if (a && a.nome !== g.nome) tarefas.push(() => os.sb.from("fin_dre_grupos").update({ nome: g.nome }).eq("id", g.id));
        }
        for (const c of cAntes) {
          const a = cMap.get(c.id);
          if (a && (a.nome !== c.nome || a.ativa !== c.ativa)) tarefas.push(() => os.sb.from("fin_dre_categorias").update({ nome: c.nome, ativa: c.ativa }).eq("id", c.id));
        }
        for (let i = 0; i < tarefas.length; i += 10) {
          const rs = await Promise.all(tarefas.slice(i, i + 10).map((t) => t()));
          const falha = rs.find((r) => r.error);
          if (falha) throw falha.error;
        }
        return true;
      }, { mensagem: "Modelo padrão restaurado" });
    }, "Modelo padrão restaurado sem apagar o histórico financeiro.");
  }

  function alternar(chave) {
    setAbertos((s) => { const n = new Set(s); n.has(chave) ? n.delete(chave) : n.add(chave); return n; });
  }

  /* ---------- Linha de categoria (ativa ou arquivada) ---------- */
  function LinhaCategoria(c) {
    const ed = editando && editando.tipo === "categoria" && editando.id === c.id;
    if (!c.ativa) return html`<div key=${c.id} class="flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white/60 px-3 py-1.5">
      <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300"></span>
      <span class="min-w-0 flex-1 truncate text-[17.5px] font-semibold text-slate-400 line-through decoration-slate-300">${c.nome}</span>
      ${pode ? html`<button type="button" aria-label=${"Reativar " + c.nome} disabled=${ocupado} onClick=${() => mudarAtiva(c, true)}
        class="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50">
        <${Icone} nome="rotate" class="h-3.5 w-3.5" /> Reativar</button>` : null}
    </div>`;
    return html`<div key=${c.id} class="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-1.5">
      <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"></span>
      ${ed ? html`<form onSubmit=${salvarNome} class="flex min-w-0 flex-1 items-center gap-2">
        <input autoFocus value=${editando.valor} maxLength=${MAX_NOME} aria-label="Nome da categoria" onInput=${(e) => setEditando({ ...editando, valor: e.target.value })}
          onKeyDown=${(e) => e.key === "Escape" && setEditando(null)}
          class="h-9 min-w-0 flex-1 rounded-lg border border-emerald-300 px-3 text-sm outline-none ring-emerald-100 focus:ring-4" />
        <button aria-label="Salvar categoria" disabled=${ocupado} class="text-emerald-700 disabled:opacity-50"><${Icone} nome="check" class="h-4 w-4" /></button>
        <button type="button" aria-label="Cancelar" onClick=${() => setEditando(null)} class="text-slate-400"><${Icone} nome="x" class="h-4 w-4" /></button>
      </form>` : html`
        <span class="min-w-0 flex-1 truncate text-[17.5px] font-semibold text-slate-700" title=${c.nome}>${c.nome}</span>
        ${pode ? html`
          <button type="button" aria-label=${"Renomear " + c.nome} onClick=${() => setEditando({ tipo: "categoria", id: c.id, valor: c.nome })}
            class="rounded-lg p-2 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-700"><${Icone} nome="pencil" class="h-3.5 w-3.5" /></button>
          <button type="button" aria-label=${"Excluir " + c.nome} onClick=${() => setRemover(c)}
            class="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"><${Icone} nome="trash" class="h-3.5 w-3.5" /></button>` : null}`}
    </div>`;
  }

  /* ---------- Painel de categorias de uma linha (ou do bloco Fora da DRE) ---------- */
  function PainelCategorias(chave, cats) {
    const ativas = cats.filter((c) => c.ativa), arquivadas = cats.filter((c) => !c.ativa);
    return html`<div class="border-t border-slate-200 bg-slate-50/70 px-3 py-3 md:px-5">
      <div class="space-y-1.5">
        ${ativas.map(LinhaCategoria)}
        ${!ativas.length ? html`<p class="px-1 py-2 text-xs font-medium text-slate-400">Nenhuma categoria ativa nesta linha.</p>` : null}
      </div>
      ${pode ? (novaEm === chave ? html`<form onSubmit=${(e) => criarCategoria(e, chave)} class="mt-3 flex gap-2">
          <input autoFocus value=${novoNome} onInput=${(e) => setNovoNome(e.target.value)} maxLength=${MAX_NOME} placeholder="Nome da nova categoria" aria-label="Nome da nova categoria"
            onKeyDown=${(e) => e.key === "Escape" && (setNovaEm(null), setNovoNome(""))}
            class="h-10 min-w-0 flex-1 rounded-xl border border-emerald-300 bg-white px-3 text-sm outline-none ring-emerald-100 focus:ring-4" />
          <button disabled=${ocupado} class="premium-button-primary h-10 px-4 text-xs disabled:opacity-50">Adicionar</button>
          <button type="button" onClick=${() => { setNovaEm(null); setNovoNome(""); }} class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600">Cancelar</button>
        </form>` : html`<button type="button" onClick=${() => { setNovaEm(chave); setNovoNome(""); }}
          class="mt-3 inline-flex h-9 items-center gap-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/60 px-3 text-xs font-black text-emerald-800 transition hover:bg-emerald-100">
          <${Icone} nome="plus" class="h-4 w-4" /> Nova categoria</button>`) : null}
      ${arquivadas.length ? html`<details class="mt-3">
        <summary class="cursor-pointer select-none px-1 text-xs font-bold text-slate-400 hover:text-slate-600">${arquivadas.length} ${arquivadas.length === 1 ? "categoria arquivada" : "categorias arquivadas"}</summary>
        <div class="mt-2 space-y-1.5">${arquivadas.map(LinhaCategoria)}</div>
      </details>` : null}
    </div>`;
  }

  const catsDe = (gid) => categorias.filter((c) => c.grupo_id === gid && !c.fora_dre).sort((a, b) => a.ordem - b.ordem);
  const catsFora = categorias.filter((c) => c.fora_dre).sort((a, b) => a.ordem - b.ordem);
  const contador = (n) => `${n} ${n === 1 ? "categoria ativa" : "categorias ativas"}`;

  return html`<${FinPage} class="space-y-5">
    <section class="overflow-hidden rounded-[37px] border border-emerald-900/10 bg-[#07110e] px-6 py-7 text-white shadow-[0_24px_60px_-42px_rgba(2,44,34,0.9)] md:px-8">
      <div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div class="max-w-3xl">
          <p class="text-[14.5px] font-black uppercase tracking-[0.22em] text-emerald-400">Configuração financeira</p>
          <h1 class="mt-2 text-2xl font-black tracking-[-0.04em] md:text-3xl">Estrutura da DRE</h1>
          <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-300">Personalize os nomes das linhas e as categorias usadas na conciliação. A ordem e as fórmulas da DRE permanecem protegidas.</p>
        </div>
        ${pode ? html`<button type="button" onClick=${() => setRestaurar(true)} disabled=${ocupado || !grupos}
          class="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 text-xs font-black text-white transition hover:border-emerald-400/50 hover:bg-emerald-400/10 disabled:opacity-50">
          <${Icone} nome="rotate" class="h-4 w-4" /> Restaurar modelo padrão</button>` : null}
      </div>
    </section>

    ${msg ? html`<div role="status" class=${cn("flex items-center justify-between rounded-2xl border px-4 py-3 text-sm font-semibold",
      msg.tom === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800")}>
      <span class="flex items-center gap-2">${msg.tom === "success" ? html`<${Icone} nome="check" class="h-4 w-4" />` : null}${msg.texto}</span>
      <button type="button" aria-label="Fechar mensagem" onClick=${() => setMsg(null)} class="rounded-lg p-1 hover:bg-black/5"><${Icone} nome="x" class="h-4 w-4" /></button>
    </div>` : null}

    <section class="rounded-[35px] border border-slate-200/80 bg-white p-4 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.6)] md:p-5">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <h2 class="text-base font-black text-slate-950">Linhas fixas da DRE</h2>
          <p class="mt-1 text-xs text-slate-500">22 linhas em ordem protegida · clique para visualizar as categorias.</p>
        </div>
        <div class="rounded-xl bg-emerald-50 px-3 py-2 text-[14.5px] font-black uppercase tracking-[0.12em] text-emerald-800">${(grupos && grupos.length) || 22} linhas</div>
      </div>
      ${!grupos && !erro ? html`<div role="status" class="flex min-h-56 items-center justify-center gap-3 text-sm font-semibold text-slate-500">
          <${Icone} nome="loader" class="h-5 w-5 fin-spin text-emerald-600" />Carregando estrutura...</div>`
        : erro ? html`<div role="alert" class="rounded-2xl border border-rose-200 bg-rose-50 p-7 text-center">
          <p class="font-bold text-rose-900">Não foi possível carregar a estrutura.</p>
          <p class="mt-1 text-sm text-rose-700">Nenhuma informação foi alterada.</p>
          <button type="button" onClick=${carregar} class="premium-button-primary mt-4">Tentar novamente</button></div>`
        : !grupos.length ? html`<p class="py-10 text-center text-sm font-medium text-slate-500">Nenhuma linha da DRE encontrada.</p>`
        : html`<div class="space-y-2">
          ${grupos.map((g) => {
            const calc = g.tipo === "formula", code = String(g.code), aberto = abertos.has(code);
            const ed = editando && editando.tipo === "grupo" && editando.id === g.id;
            const cats = catsDe(g.id), nome = nomeDre(g.nome);
            return html`<article key=${g.id} class=${cn("overflow-hidden rounded-2xl border transition", calc ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white")}>
              <div class="flex min-h-[82.5px] items-center gap-2 px-3 py-2 md:px-4">
                <button type="button" aria-label=${aberto ? "Fechar " + nome : "Abrir " + nome} aria-expanded=${calc ? undefined : aberto}
                  onClick=${() => !calc && alternar(code)} disabled=${calc}
                  class=${cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500", !calc && "hover:bg-slate-100 hover:text-emerald-700")}>
                  ${calc ? html`<${IconeLocal} nome="calculator" class="h-4 w-4 text-emerald-700" />` : html`<${Icone} nome=${aberto ? "chevron-down" : "chevron-right"} class="h-4 w-4" />`}
                </button>
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#07110e] text-[13.5px] font-black text-emerald-400">${code.padStart(2, "0")}</span>
                ${ed ? html`<form onSubmit=${salvarNome} class="flex min-w-0 flex-1 items-center gap-2">
                  <input autoFocus value=${editando.valor} maxLength=${MAX_NOME} aria-label="Nome da linha" onInput=${(e) => setEditando({ ...editando, valor: e.target.value })}
                    onKeyDown=${(e) => e.key === "Escape" && setEditando(null)}
                    class="h-10 min-w-0 flex-1 rounded-xl border border-emerald-300 bg-white px-3 text-sm font-bold outline-none ring-emerald-100 focus:ring-4" />
                  <button aria-label="Salvar nome" disabled=${ocupado} class="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-[#07110e] disabled:opacity-50"><${Icone} nome="check" class="h-4 w-4" /></button>
                  <button type="button" aria-label="Cancelar" onClick=${() => setEditando(null)} class="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500"><${Icone} nome="x" class="h-4 w-4" /></button>
                </form>` : html`
                  <div class="min-w-0 flex-1 cursor-pointer" onClick=${() => !calc && alternar(code)}>
                    <h3 class="truncate text-sm font-black text-slate-900" title=${nome}>${nome}</h3>
                    ${!calc ? html`<p class="mt-0.5 text-[14.5px] text-slate-500">${contador(cats.filter((c) => c.ativa).length)}</p>` : null}
                  </div>
                  ${calc ? html`<span class="hidden rounded-lg border border-emerald-200 bg-white/70 px-2.5 py-1 text-[13.5px] font-black uppercase tracking-[0.12em] text-emerald-800 sm:inline">Cálculo fixo</span>` : null}
                  ${pode ? html`<button type="button" aria-label=${"Renomear " + nome} onClick=${() => setEditando({ tipo: "grupo", id: g.id, valor: g.nome })}
                    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:border-emerald-300 hover:text-emerald-700">
                    <${Icone} nome="pencil" class="h-4 w-4" /></button>` : null}`}
              </div>
              ${!calc && aberto ? PainelCategorias(g.id, cats) : null}
            </article>`;
          })}
        </div>`}
    </section>

    ${grupos && !erro && catsFora.length ? html`<section class="rounded-[35px] border border-slate-200/80 bg-white p-4 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.6)] md:p-5">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <h2 class="text-base font-black text-slate-950">Fora da DRE</h2>
          <p class="mt-1 text-xs text-slate-500">Movimentações que entram no Fluxo de Caixa, mas não no resultado (transferências, repasses, fatura do cartão, aportes, empréstimos, aplicações).</p>
        </div>
        <div class="rounded-xl bg-slate-100 px-3 py-2 text-[14.5px] font-black uppercase tracking-[0.12em] text-slate-600">${contador(catsFora.filter((c) => c.ativa).length)}</div>
      </div>
      <article class="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <button type="button" onClick=${() => alternar(FORA)} aria-expanded=${abertos.has(FORA)}
          class="flex min-h-[82.5px] w-full items-center gap-2 px-3 py-2 text-left md:px-4">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500"><${Icone} nome=${abertos.has(FORA) ? "chevron-down" : "chevron-right"} class="h-4 w-4" /></span>
          <span class="min-w-0 flex-1"><span class="block truncate text-sm font-black text-slate-900">Categorias fora da DRE</span>
            <span class="mt-0.5 block text-[14.5px] text-slate-500">Não compõem a DRE · aparecem na conciliação</span></span>
        </button>
        ${abertos.has(FORA) ? PainelCategorias(FORA, catsFora) : null}
      </article>
    </section>` : null}

    <${ConfirmDialog} aberto=${!!remover} onClose=${() => setRemover(null)} onConfirm=${() => remover && mudarAtiva(remover, false)}
      titulo="Remover categoria?" variante="warning" textoConfirmar="Remover"
      descricao=${`“${(remover && remover.nome) || ""}” deixará de aparecer na conciliação. Lançamentos antigos continuarão preservados nos relatórios.`} />
    <${ConfirmDialog} aberto=${restaurar} onClose=${() => setRestaurar(false)} onConfirm=${restaurarPadrao}
      titulo="Restaurar modelo padrão?" variante="warning" textoConfirmar="Restaurar"
      descricao="Os 22 nomes e as categorias originais voltarão. Categorias personalizadas serão arquivadas, sem excluir lançamentos antigos. Os cálculos não serão alterados." />
  <//>`;
}

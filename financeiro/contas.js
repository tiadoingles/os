// Financeiro · Contas Bancárias — tela do Craft Green "Contas Bancárias" (ref app_bancos_page).
// Spec: docs/financeiro-spec.md (2.6 e 3.7). Base compartilhada: ./comum.js (não editar lá).
// Props do Router (#/financeiro/contas): me (linha de profiles) e query (objeto da query string).
// Escrita: podeEditarFin(me). DESFAZER: escopoFin("contas"). Arquivar = ativo=false (lançamentos ficam).
import { html } from "htm/preact";
import { useState, useEffect } from "preact/hooks";
import { os, FinPage, Icone, cn, brl, parseValorBR, escopoFin, podeEditarFin, ErroCarga, ConfirmDialog } from "./comum.js";

const ESCOPO = escopoFin("contas");
const VAZIO = { banco: "", apelido: "", saldo: "" };
const inputCls = "w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-emerald-600 transition-all";

/** Saldo inicial digitado -> número com 2 casas; vazio = 0; null se inválido (regra do Craft). */
function lerSaldo(txt) {
  if (!String(txt || "").trim()) return 0;
  const n = parseValorBR(txt);
  return !Number.isFinite(n) || Math.abs(n) > 1e12 ? null : Math.round(100 * n) / 100;
}
const plural = (n) => `${n} movimentação(ões)`;

/** Todas as contas (ativas e arquivadas) + nº de lançamentos vinculados a cada uma. */
async function carregarContas() {
  const { data, error } = await os.sb.from("fin_contas").select("*").order("created_at");
  if (error) throw error;
  const contas = data || [];
  const contagens = await Promise.all(contas.map(async (c) => {
    const { count, error: e } = await os.sb.from("fin_lancamentos").select("id", { count: "exact", head: true }).eq("conta_id", c.id);
    if (e) throw e;
    return count || 0;
  }));
  return contas.map((c, i) => ({ ...c, _movimentacoes: contagens[i] }));
}
const semExtras = ({ _movimentacoes, ...r }) => r;

export function ContasPage({ me }) {
  const pode = podeEditarFin(me);
  const [contas, setContas] = useState(null);
  const [erro, setErro] = useState(null);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState(null); // id
  const [form, setForm] = useState(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [dialogo, setDialogo] = useState(null); // { titulo, descricao, variante, textoConfirmar, onConfirm }

  async function carregar() {
    setErro(null);
    try { setContas(await carregarContas()); } catch (e) { setErro(e); }
  }
  useEffect(() => { carregar(); }, []);
  os.useAoDesfazer && os.useAoDesfazer(ESCOPO, carregar);

  const aviso = (titulo, descricao, variante = "info") => setDialogo({ titulo, descricao, variante, textoConfirmar: "Entendido", onConfirm: () => {} });

  async function salvar() {
    if (salvando) return;
    const banco = form.banco.trim(), apelido = form.apelido.trim();
    if (!banco || !apelido) return aviso("Dados Incompletos", "Informe o nome do banco e o apelido da conta.", "warning");
    const saldo = lerSaldo(form.saldo);
    if (saldo === null) return aviso("Saldo inicial inválido", "Informe um valor com até dois centavos, por exemplo 10.000,25.", "warning");
    setSalvando(true);
    try {
      if (editando) {
        const antes = semExtras(contas.find((c) => c.id === editando));
        const { data, error } = await os.sb.from("fin_contas").update({ banco, apelido, saldo_base: saldo }).eq("id", editando).select("*").single();
        if (error) throw error;
        os.registrarDesfazer(ESCOPO, `editar a conta ${apelido}`, os.desfazerEdicao("fin_contas", antes, data, `editar a conta ${apelido}`));
        setEditando(null);
      } else {
        const { data, error } = await os.sb.from("fin_contas").insert({ banco, apelido, saldo_base: saldo }).select("*").single();
        if (error) throw error;
        os.registrarDesfazer(ESCOPO, `cadastrar a conta ${apelido}`, os.desfazerCriacao("fin_contas", data, `cadastrar a conta ${apelido}`));
        setCriando(false);
      }
      setForm(VAZIO);
      await carregar();
    } catch (e) {
      aviso(editando ? "Erro ao Atualizar" : "Erro ao Salvar",
        (os.errMsg && os.errMsg(e)) || (editando ? "Houve um problema técnico ao atualizar o banco." : "Houve um problema técnico ao salvar o banco."), "danger");
    } finally { setSalvando(false); }
  }

  async function mudarStatus(conta, ativo) {
    const antes = semExtras(conta);
    try {
      const { data, error } = await os.sb.from("fin_contas").update({ ativo }).eq("id", conta.id).select("*").single();
      if (error) throw error;
      const rot = `${ativo ? "reativar" : "arquivar"} a conta ${conta.apelido}`;
      os.registrarDesfazer(ESCOPO, rot, os.desfazerEdicao("fin_contas", antes, data, rot),
        { mensagem: ativo ? "Conta reativada" : "Conta arquivada" });
      await carregar();
    } catch (e) {
      aviso(ativo ? "Não foi possível reativar" : "Não foi possível arquivar", (os.errMsg && os.errMsg(e)) || "Tente novamente em instantes.", "danger");
    }
  }

  function abrirEdicao(c) {
    setCriando(false);
    setEditando(c.id);
    setForm({ banco: c.banco || "", apelido: c.apelido || "", saldo: (Number(c.saldo_base) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) });
  }

  const ativas = (contas || []).filter((c) => c.ativo);
  const arquivadas = (contas || []).filter((c) => !c.ativo);
  const onEnter = (e) => { if (e.key === "Enter") salvar(); };

  return html`<${FinPage} class="space-y-6 md:space-y-10">
    <div class="flex flex-col justify-between gap-4 md:flex-row md:items-center">
      <div>
        <h1 class="text-2xl font-black tracking-tight text-slate-900 md:text-3xl">Contas Bancárias</h1>
        <p class="text-sm font-medium text-slate-500">Cadastre o banco, dê um apelido à conta e defina a base do Fluxo de Caixa.</p>
      </div>
      ${pode ? html`<div class="flex items-center gap-2">
        <button type="button" class="premium-button-primary disabled:cursor-not-allowed disabled:opacity-50" disabled=${criando || !!editando || !contas}
          onClick=${() => { setCriando(true); setEditando(null); setForm(VAZIO); }}>
          <${Icone} nome="plus" class="mr-2 h-4 w-4" /> Nova Conta</button>
      </div>` : null}
    </div>

    ${erro ? html`<${ErroCarga} titulo="Não foi possível carregar as contas" onRetry=${carregar} />`
      : !contas ? html`<div role="status" class="grid grid-cols-1 gap-6 md:grid-cols-3">
          ${[0, 1, 2].map((i) => html`<div key=${i} class="h-[267px] animate-pulse rounded-[1.35rem] bg-slate-100"></div>`)}
          <span class="sr-only">Carregando...</span></div>`
      : html`<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
        ${ativas.map((c) => html`<div key=${c.id} class=${cn("premium-card group relative space-y-4 bg-white p-6 transition-all", editando === c.id && "border-emerald-600 ring-2 ring-emerald-600")}>
          ${editando === c.id ? html`<div class="space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-[16px] font-black uppercase tracking-widest text-emerald-600">Editando Conta</span>
              <button type="button" aria-label="Cancelar edição" onClick=${() => setEditando(null)} class="text-slate-400 hover:text-slate-600"><${Icone} nome="x" class="h-4 w-4" /></button>
            </div>
            <div class="space-y-3">
              <input type="text" value=${form.banco} onInput=${(e) => setForm({ ...form, banco: e.target.value })} onKeyDown=${onEnter} class=${inputCls} placeholder="Nome do banco" aria-label="Banco" />
              <input type="text" value=${form.apelido} onInput=${(e) => setForm({ ...form, apelido: e.target.value })} onKeyDown=${onEnter} class=${inputCls} placeholder="Apelido da conta" aria-label="Apelido" />
              <input type="text" inputMode="decimal" aria-label="Saldo inicial" value=${form.saldo} onInput=${(e) => setForm({ ...form, saldo: e.target.value })} onKeyDown=${onEnter} class=${inputCls} placeholder="Ex.: 10.000,25" />
              <button type="button" onClick=${salvar} disabled=${salvando}
                class="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2 text-[16px] font-bold uppercase tracking-widest text-white hover:bg-emerald-700 disabled:opacity-50">
                <${Icone} nome=${salvando ? "loader" : "check"} class=${cn("h-3 w-3", salvando && "fin-spin")} /> Salvar Alterações</button>
            </div>
          </div>` : html`
            <div class="flex items-start justify-between">
              <div class="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 text-slate-600 transition-all group-hover:bg-emerald-600 group-hover:text-white">
                <${Icone} nome="landmark" class="h-6 w-6" /></div>
              ${pode ? html`<div class="flex gap-2">
                <button type="button" aria-label=${"Editar " + c.apelido} onClick=${() => abrirEdicao(c)} disabled=${criando || (editando && editando !== c.id)}
                  class="p-2 text-slate-400 transition-colors hover:text-emerald-600 focus:opacity-100 disabled:opacity-30 md:opacity-0 md:group-hover:opacity-100">
                  <${Icone} nome="pencil" class="h-4 w-4" /></button>
                <button type="button" aria-label=${"Arquivar " + c.apelido}
                  onClick=${() => setDialogo({ titulo: "Arquivar conta", variante: "danger", textoConfirmar: "Confirmar",
                    descricao: `Arquivar esta conta? ${c._movimentacoes} movimentação(ões) vinculada(s) será(ão) preservada(s) e continuará(ão) disponível(is) para auditoria.`,
                    onConfirm: () => mudarStatus(c, false) })}
                  class="p-2 text-slate-400 transition-colors hover:text-rose-600 focus:opacity-100 md:opacity-0 md:group-hover:opacity-100">
                  <${Icone} nome="archive" class="h-4 w-4" /></button>
              </div>` : null}
            </div>
            <div>
              <h3 class="text-sm font-black uppercase tracking-widest text-slate-900">${c.apelido}</h3>
              <p class="mt-1 text-[16px] font-bold uppercase tracking-widest text-slate-400">${c.banco}</p>
            </div>
            <div class="pt-2">
              <p class="text-[16px] font-black uppercase tracking-widest text-slate-400">Saldo Inicial</p>
              <p class="text-xl font-black tracking-tight text-slate-900">${brl(c.saldo_base)}</p>
              <p class="mt-2 text-[14.5px] font-bold uppercase tracking-widest text-slate-400">${plural(c._movimentacoes)}</p>
            </div>`}
        </div>`)}

        ${!criando && !editando && ativas.length === 0 ? html`<button type="button" onClick=${() => pode && (setCriando(true), setForm(VAZIO))} disabled=${!pode}
          class="premium-card group flex min-h-[267px] w-full flex-col items-center justify-center gap-3 border-2 border-dashed border-slate-200 bg-white p-12 transition-all hover:border-slate-300 hover:bg-slate-50">
          <div class="rounded-full border border-slate-100 bg-slate-50 p-4 text-slate-400 transition-all group-hover:border-emerald-200 group-hover:text-emerald-600"><${Icone} nome="plus" class="h-8 w-8" /></div>
          <div class="text-center"><span class="block text-sm font-bold uppercase tracking-widest text-slate-900">Novo Banco</span></div>
        </button>` : null}

        ${criando ? html`<div class="premium-card space-y-4 border-2 border-emerald-600 bg-white p-6">
          <h3 class="text-sm font-bold uppercase tracking-widest text-emerald-600">Novo Cadastro</h3>
          <div class="space-y-3">
            <input type="text" autoFocus placeholder="Banco, ex.: Itaú Unibanco" aria-label="Banco" value=${form.banco} onInput=${(e) => setForm({ ...form, banco: e.target.value })} onKeyDown=${onEnter} class=${inputCls} />
            <input type="text" placeholder="Apelido, ex.: Conta Principal" aria-label="Apelido" value=${form.apelido} onInput=${(e) => setForm({ ...form, apelido: e.target.value })} onKeyDown=${onEnter} class=${inputCls} />
            <input type="text" inputMode="decimal" aria-label="Saldo inicial" placeholder="Ex.: 10.000,25" value=${form.saldo} onInput=${(e) => setForm({ ...form, saldo: e.target.value })} onKeyDown=${onEnter} class=${inputCls} />
            <div class="flex gap-2 pt-2">
              <button type="button" onClick=${() => setCriando(false)} disabled=${salvando}
                class="flex-1 rounded-lg bg-slate-100 py-2 text-[16px] font-bold uppercase tracking-widest text-slate-600 transition-all hover:bg-slate-200">Cancelar</button>
              <button type="button" onClick=${salvar} disabled=${salvando}
                class="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2 text-[16px] font-bold uppercase tracking-widest text-white shadow-sm transition-all hover:bg-emerald-700">
                ${salvando ? html`<${Icone} nome="loader" class="h-3 w-3 fin-spin" />` : null} Salvar</button>
            </div>
          </div>
        </div>` : null}
      </div>

      ${arquivadas.length ? html`<section aria-label="Contas arquivadas" class="space-y-3">
        <h2 class="text-[16px] font-black uppercase tracking-widest text-slate-400">Contas arquivadas</h2>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
          ${arquivadas.map((c) => html`<div key=${c.id} class="flex items-center justify-between gap-3 rounded-[1.35rem] border border-dashed border-slate-200 bg-white/60 px-5 py-4">
            <div class="min-w-0">
              <p class="truncate text-sm font-black uppercase tracking-widest text-slate-500">${c.apelido}</p>
              <p class="mt-1 truncate text-[14.5px] font-bold uppercase tracking-widest text-slate-400">${c.banco} · ${brl(c.saldo_base)} · ${plural(c._movimentacoes)}</p>
            </div>
            ${pode ? html`<button type="button" onClick=${() => mudarStatus(c, true)}
              class="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14.5px] font-bold uppercase tracking-widest text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700">
              <${Icone} nome="rotate" class="h-3.5 w-3.5" /> Reativar</button>` : null}
          </div>`)}
        </div>
      </section>` : null}`}

    <${ConfirmDialog} aberto=${!!dialogo} titulo=${dialogo && dialogo.titulo} descricao=${dialogo && dialogo.descricao}
      variante=${(dialogo && dialogo.variante) || "danger"} textoConfirmar=${(dialogo && dialogo.textoConfirmar) || "Confirmar"}
      onConfirm=${dialogo && dialogo.onConfirm} onClose=${() => setDialogo(null)} />
  <//>`;
}

// Financeiro · Co-Produção — espelho somente leitura da planilha "Calculo Investimento" (Tia × Agência Fad).
// Não existe no Craft: segue a linguagem visual das outras telas (comum.js). Base: ./comum.js (não editar lá).
// Dados: public.fin_coproducao (linha única id=1: ciclos, total, funis; só select). A Edge Function
// `coproducao-sheet` relê a aba Base da planilha: chamada sem force ao abrir a tela (ela mesma pula se o
// último sync tem < 10 min), com force no botão "Atualizar da planilha" e por cron diário. Status em
// sync_status chave 'coproducao-planilha'. Saldo Tia > 0 = Tia investiu/recebeu a menos que devia → a receber da Fad.
import { html } from "htm/preact";
import { useState, useEffect, useMemo, useRef } from "preact/hooks";
import { os, FinPage, Icone, KpiCardDestaque, ErroCarga, Esqueleto, brl, brlCompacto, cn } from "./comum.js";

const PLANILHA_URL = "https://docs.google.com/spreadsheets/d/1oqDiyFk2RzucGdIw0lDWoiIkJPh9ZeB6ifDIS-pnJ5Q/edit";

async function fetchCoproducao() {
  const { data, error } = await os.sb.from("fin_coproducao").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data || null;
}
async function fetchStatusPlanilha() {
  const { data, error } = await os.sb.from("sync_status").select("*").eq("chave", "coproducao-planilha").maybeSingle();
  if (error) throw error;
  return data || null;
}
async function sincronizarPlanilha(force) {
  const { data, error } = await os.sb.functions.invoke("coproducao-sheet", { body: { force: !!force } });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (_) { /* ignore */ }
    return { ok: false, error: msg };
  }
  return data || { ok: false, error: "sem resposta" };
}

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const valor = (v) => (num(v) === null ? "—" : brl(v));
const pctFr = (v) => (num(v) === null ? "—" : (Number(v) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%");
const dataHoraBR = (ts) => (ts ? new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
/** "2026-05-01","2026-05-31" -> "01/05–31/05/2026" (anos diferentes: ambos com ano). */
function periodoBR(ini, fim) {
  const p = (s) => String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  const a = p(ini), b = p(fim);
  if (!a && !b) return "—";
  if (a && b) return a[1] === b[1] ? `${a[3]}/${a[2]}–${b[3]}/${b[2]}/${b[1]}` : `${a[3]}/${a[2]}/${a[1]}–${b[3]}/${b[2]}/${b[1]}`;
  const x = a || b;
  return `${x[3]}/${x[2]}/${x[1]}`;
}
/** Ciclo sem números ainda (meses futuros). */
const emAberto = (c) => num(c.custo_total) === null && num(c.saldo_tia) === null && num(c.inv_real_tia) === null;
const corSaldo = (v) => (num(v) === null ? "" : Number(v) >= 0 ? "text-emerald-700" : "text-rose-700");

export function CoproducaoPage() {
  const [dados, setDados] = useState(null);
  const [status, setStatus] = useState(null);
  const [erroCarga, setErroCarga] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState(null); // { tipo, texto }
  const vivo = useRef(true);

  async function recarregar() {
    try {
      const [d, s] = await Promise.all([fetchCoproducao(), fetchStatusPlanilha().catch(() => null)]);
      if (!vivo.current) return;
      setDados(d || { ciclos: [], total: null, funis: [] }); setStatus(s); setErroCarga(false);
    } catch (e) {
      if (!vivo.current) return;
      setErroCarga(true); os.notify(os.errMsg(e), "err");
    }
  }
  async function sincronizar(force) {
    setSincronizando(true);
    if (force) setAviso(null);
    const r = await sincronizarPlanilha(force);
    if (!vivo.current) return;
    if (!r.ok) setAviso({ tipo: "erro", texto: r.semAcesso ? (r.error || "A conta de serviço do OS não tem acesso à planilha.") : r.error || "Não foi possível atualizar da planilha." });
    else if (force && !r.pulado) setAviso({ tipo: "ok", texto: r.detalhe ? `Planilha relida: ${r.detalhe}.` : "Planilha relida." });
    else if (force && r.pulado) setAviso({ tipo: "ok", texto: "A planilha foi lida há menos de 30 segundos; os dados já estão atualizados." });
    await recarregar();
    if (vivo.current) setSincronizando(false);
  }
  useEffect(() => {
    vivo.current = true;
    recarregar().then(() => sincronizar(false));
    return () => { vivo.current = false; };
  }, []);

  const ciclos = (dados && Array.isArray(dados.ciclos)) ? dados.ciclos : [];
  const funis = (dados && Array.isArray(dados.funis)) ? dados.funis : [];
  const t = (dados && dados.total) || {};
  const carregando = dados === null && !erroCarga;
  const saldoTia = num(t.saldo_tia), saldoFad = num(t.saldo_fad);

  return html`<${FinPage} class="space-y-6">
    <section class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p class="text-[16px] font-black uppercase tracking-[0.2em] text-emerald-700">Parceria</p>
        <h1 class="mt-2 text-3xl font-black tracking-[-0.045em] text-[#07110e]">Co-Produção — Tia do Inglês × Agência Fad</h1>
        <p class=${cn("mt-2 text-sm font-semibold", status && status.ultimo_status === "erro" ? "text-rose-700" : "text-slate-500")}>
          ${status && status.ultima_execucao_em
            ? html`Última leitura da planilha: ${dataHoraBR(status.ultima_execucao_em)}${status.ultimo_detalhe ? html` · ${status.ultimo_detalhe}` : null}`
            : "A planilha ainda não foi lida."}
          ${sincronizando ? html`<span class="ml-2 inline-flex items-center gap-1 text-emerald-700"><${Icone} nome="loader" class="h-3 w-3 fin-spin" />conferindo a planilha...</span>` : null}
        </p>
      </div>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <a href=${PLANILHA_URL} target="_blank" rel="noopener noreferrer"
          class="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-xs font-bold text-slate-700 transition hover:border-emerald-200">
          <${Icone} nome="arrow-up-right" class="h-4 w-4" />Abrir planilha</a>
        <button type="button" onClick=${() => sincronizar(true)} disabled=${sincronizando} class="premium-button-primary h-12 text-xs disabled:cursor-not-allowed disabled:opacity-50">
          <${Icone} nome=${sincronizando ? "loader" : "rotate"} class=${cn("h-4 w-4", sincronizando && "fin-spin")} />Atualizar da planilha</button>
      </div>
    </section>

    ${aviso ? html`<div role=${aviso.tipo === "erro" ? "alert" : "status"} class=${cn("flex items-center gap-3 rounded-2xl border p-4 text-xs font-bold",
      aviso.tipo === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800")}>
      <${Icone} nome=${aviso.tipo === "ok" ? "check-circle" : "alert"} class="h-5 w-5 shrink-0" />${aviso.texto}</div>` : null}

    <p class="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-xs font-semibold text-slate-600">
      <${Icone} nome="info" class="h-4 w-4 shrink-0 text-emerald-700" />
      Somente leitura. Para alterar, edite a planilha; o OS espelha automaticamente (todo dia às 9h20 e ao abrir esta tela).</p>

    ${erroCarga && !dados ? html`<${ErroCarga} titulo="Não foi possível carregar a co-produção" onRetry=${recarregar} />` : html`
      <section class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <${KpiCardDestaque} rotulo="Custo total compartilhado" valor=${num(t.custo_total) || 0} icone="wallet" tom="dark" carregando=${carregando}
          dica=${`Participação: Tia ${pctFr(t.part_tia)} · Fad ${pctFr(t.part_fad)}`} />
        <${KpiCardDestaque} rotulo="Investimento real Tia" valor=${num(t.inv_real_tia) || 0} icone="arrow-up-right" tom="light" carregando=${carregando}
          dica=${`Necessário ${valor(t.inv_nec_tia)}`} />
        <${KpiCardDestaque} rotulo="Investimento real Fad" valor=${num(t.inv_real_fad) || 0} icone="arrow-up-right" tom="light" carregando=${carregando}
          dica=${`Necessário ${valor(t.inv_nec_fad)}`} />
        <${KpiCardDestaque} rotulo="Recebimento total fora do split" valor=${num(t.receb_total) || 0} icone="receipt" tom="emerald-soft" carregando=${carregando}
          dica=${`Recebido: Tia ${valor(t.receb_real_tia)} · Fad ${valor(t.receb_real_fad)}`} />
        <${KpiCardDestaque} rotulo="Saldo Tia" valor=${saldoTia || 0} icone="trending-up" tom=${saldoTia !== null && saldoTia < 0 ? "negative" : "emerald"} carregando=${carregando}
          dica=${saldoTia === null ? "Sem saldo calculado" : saldoTia >= 0 ? "A receber da Fad" : "A pagar à Fad"} />
        <${KpiCardDestaque} rotulo="Saldo Fad" valor=${saldoFad || 0} icone="trending-up" tom=${saldoFad !== null && saldoFad < 0 ? "negative" : "emerald"} carregando=${carregando}
          dica=${saldoFad === null ? "Sem saldo calculado" : saldoFad >= 0 ? "A receber da Tia" : "A pagar à Tia"} />
      </section>

      <${GraficoSaldoCiclos} ciclos=${ciclos} carregando=${carregando} />

      <section class="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white">
        <div class="border-b border-slate-100 p-4 md:px-7"><h2 class="text-xl font-black tracking-tight">Ciclos de operação</h2></div>
        ${carregando ? html`<div class="p-5"><${Esqueleto} class="h-64" /></div>` : html`<${TabelaCiclos} ciclos=${ciclos} total=${dados && dados.total} />`}
      </section>

      <section class="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white">
        <div class="border-b border-slate-100 p-4 md:px-7"><h2 class="text-xl font-black tracking-tight">Regras por funil</h2></div>
        <div class="overflow-x-auto"><table class="w-full min-w-[860px] text-left">
          <thead><tr class="bg-[#f5f8f6] text-xs font-bold text-slate-600">
            <th class="px-5 py-4">Funil</th><th class="px-5 py-4 text-right">% Resultados Tia</th><th class="px-5 py-4 text-right">% Resultados Fad</th>
            <th class="px-5 py-4 text-right">% Investimento Tia</th><th class="px-5 py-4 text-right">% Investimento Fad</th><th class="px-5 py-4">Observação</th>
          </tr></thead>
          <tbody>
            ${carregando ? html`<tr><td colSpan="6" class="p-12 text-center text-sm font-medium text-slate-500">Carregando...</td></tr>`
              : !funis.length ? html`<tr><td colSpan="6" class="p-12 text-center text-sm font-medium text-slate-500">Nenhuma regra de funil na planilha.</td></tr>`
              : funis.map((f, i) => html`<tr key=${i} class="border-t border-slate-100 text-sm font-semibold hover:bg-[#f8faf9]">
                  <td class="px-5 py-4 font-black text-slate-800">${f.funil}</td>
                  <td class="px-5 py-4 text-right tabular-nums">${pctFr(f.result_tia)}</td><td class="px-5 py-4 text-right tabular-nums">${pctFr(f.result_fad)}</td>
                  <td class="px-5 py-4 text-right tabular-nums">${pctFr(f.invest_tia)}</td><td class="px-5 py-4 text-right tabular-nums">${pctFr(f.invest_fad)}</td>
                  <td class="px-5 py-4 text-slate-500">${f.observacao || ""}</td>
                </tr>`)}
          </tbody>
        </table></div>
      </section>`}
  <//>`;
}

function TabelaCiclos({ ciclos, total }) {
  const th = "whitespace-nowrap px-3 py-3";
  const grupo = "border-l border-slate-200 px-3 py-2 text-center";
  const td = "whitespace-nowrap px-3 py-3 text-right tabular-nums";
  const linha = (c, ehTotal) => {
    const aberto = !ehTotal && emAberto(c);
    const v = (k) => (aberto ? "" : valor(c[k]));
    return html`<tr class=${cn("border-t text-[13.5px] font-semibold", ehTotal ? "border-emerald-200 bg-[#e8f8ef] font-black text-[#064e3b]" : "border-slate-100 hover:bg-[#f8faf9]", aberto && "text-slate-400")}>
      <th scope="row" class=${cn("sticky left-0 z-10 whitespace-nowrap px-3 py-3 text-left", ehTotal ? "bg-[#e8f8ef] font-black" : "bg-white font-black text-slate-800", aberto && "!text-slate-400")}>
        ${ehTotal ? "TOTAL DO PERÍODO" : c.ciclo}
        ${aberto ? html`<span class="ml-2 rounded-md border border-dashed border-slate-300 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">em aberto</span>` : null}
      </th>
      <td class="whitespace-nowrap px-3 py-3">${ehTotal ? "" : periodoBR(c.data_inicial, c.data_final)}</td>
      <td class=${td}>${v("custo_total")}</td>
      <td class=${cn(td, "border-l border-slate-100")}>${pctFr(c.part_tia)} / ${pctFr(c.part_fad)}</td>
      <td class=${cn(td, "border-l border-slate-100")}>${v("inv_nec_tia")}</td><td class=${td}>${v("inv_nec_fad")}</td>
      <td class=${td}>${v("inv_real_tia")}</td><td class=${td}>${v("inv_real_fad")}</td>
      <td class=${cn(td, "border-l border-slate-100")}>${v("receb_total")}</td>
      <td class=${td}>${v("receb_nec_tia")}</td><td class=${td}>${v("receb_nec_fad")}</td>
      <td class=${td}>${v("receb_real_tia")}</td><td class=${td}>${v("receb_real_fad")}</td>
      <td class=${cn(td, "border-l border-slate-100 font-black", corSaldo(c.saldo_tia))}>${v("saldo_tia")}</td>
      <td class=${cn(td, "font-black", corSaldo(c.saldo_fad))}>${v("saldo_fad")}</td>
      <td class="max-w-[220px] px-3 py-3">${c.links_url && /^https?:\/\//i.test(c.links_url) ? html`<a href=${c.links_url} target="_blank" rel="noopener noreferrer" title=${c.links || c.links_url}
          class="inline-flex max-w-full items-center gap-1 font-bold text-emerald-700 hover:underline"><${Icone} nome="file" class="h-3.5 w-3.5 shrink-0" /><span class="truncate">${c.links || "Abrir"}</span></a>`
        : c.links ? html`<span class="block truncate text-slate-500" title=${c.links}>${c.links}</span>` : null}</td>
      <td class="min-w-[220px] max-w-[320px] px-3 py-3 text-slate-500">${c.comentarios ? html`<${Comentario} texto=${c.comentarios} />` : null}</td>
    </tr>`;
  };
  return html`<div class="overflow-x-auto"><table class="w-full min-w-[1900px] border-separate border-spacing-0 text-left">
    <thead class="text-xs font-bold text-slate-600">
      <tr class="bg-[#f5f8f6]">
        <th colSpan="3" class="sticky left-0 z-10 bg-[#f5f8f6] px-3 py-2"></th>
        <th class=${grupo}></th>
        <th colSpan="4" class=${grupo}>Investimento</th>
        <th colSpan="5" class=${grupo}>Recebimento</th>
        <th colSpan="2" class=${grupo}>Saldo</th>
        <th colSpan="2" class="border-l border-slate-200"></th>
      </tr>
      <tr class="bg-[#f5f8f6]">
        <th scope="col" class=${cn(th, "sticky left-0 z-10 bg-[#f5f8f6]")}>Ciclo</th><th scope="col" class=${th}>Período</th><th scope="col" class=${cn(th, "text-right")}>Custo total</th>
        <th scope="col" class=${cn(th, "border-l border-slate-200 text-right")}>Part. Tia / Fad</th>
        <th scope="col" class=${cn(th, "border-l border-slate-200 text-right")}>Necessário Tia</th><th scope="col" class=${cn(th, "text-right")}>Necessário Fad</th>
        <th scope="col" class=${cn(th, "text-right")}>Real Tia</th><th scope="col" class=${cn(th, "text-right")}>Real Fad</th>
        <th scope="col" class=${cn(th, "border-l border-slate-200 text-right")}>Total</th>
        <th scope="col" class=${cn(th, "text-right")}>Necessário Tia</th><th scope="col" class=${cn(th, "text-right")}>Necessário Fad</th>
        <th scope="col" class=${cn(th, "text-right")}>Real Tia</th><th scope="col" class=${cn(th, "text-right")}>Real Fad</th>
        <th scope="col" class=${cn(th, "border-l border-slate-200 text-right")}>Tia</th><th scope="col" class=${cn(th, "text-right")}>Fad</th>
        <th scope="col" class=${cn(th, "border-l border-slate-200")}>Links</th><th scope="col" class=${th}>Comentários</th>
      </tr>
    </thead>
    <tbody>
      ${!ciclos.length ? html`<tr><td colSpan="17" class="p-12 text-center text-sm font-medium text-slate-500">Nenhum ciclo na planilha ainda.</td></tr>` : ciclos.map((c) => linha(c, false))}
      ${total ? linha(total, true) : null}
    </tbody>
  </table></div>`;
}

function Comentario({ texto }) {
  const [aberto, setAberto] = useState(false);
  const longo = texto.length > 70 || texto.includes("\n");
  if (!longo) return html`<span>${texto}</span>`;
  return html`<button type="button" onClick=${() => setAberto((a) => !a)} title=${aberto ? "Recolher" : texto} class="text-left">
    <span class=${cn("block whitespace-pre-line", !aberto && "line-clamp-2")}>${texto}</span>
    <span class="mt-0.5 block text-[12px] font-black text-emerald-700">${aberto ? "ver menos" : "ver mais"}</span>
  </button>`;
}

/** Barras do Saldo Tia por ciclo (positivo = a receber da Fad, verde; negativo = a pagar, rosa). */
function GraficoSaldoCiclos({ ciclos, carregando }) {
  const [foco, setFoco] = useState(null);
  const pts = useMemo(() => ciclos.map((c, i) => ({ i, rotulo: c.ciclo, v: num(c.saldo_tia) })), [ciclos]);
  const vals = pts.filter((p) => p.v !== null).map((p) => p.v);
  const max = Math.max(1, ...vals.map(Math.abs));
  const W = 1000, H = 280, esq = 92, dir = 980, topo = 24, base = 236;
  const meio = (topo + base) / 2, amp = (base - topo) / 2;
  const larg = pts.length ? (dir - esq) / pts.length : 0;
  const ticks = [max, max / 2, 0, -max / 2, -max];
  const atual = foco !== null ? pts[foco] : null;
  const curto = (s) => { const t = String(s || ""); return t.length > 16 ? t.slice(0, 15) + "…" : t; };
  return html`<section class="min-w-0 rounded-[1.6rem] border border-slate-200 bg-white p-5 md:p-7" aria-label="Saldo Tia por ciclo">
    <div class="flex min-h-8 flex-wrap items-center justify-between gap-3">
      <h2 class="text-xl font-black tracking-tight">Saldo Tia por ciclo</h2>
      <p class="text-sm font-bold tabular-nums text-emerald-700">${atual ? `${atual.rotulo} · ${atual.v === null ? "em aberto" : brl(atual.v)}` : "Positivo = a receber da Fad · negativo = a pagar à Fad"}</p>
    </div>
    ${carregando ? html`<${Esqueleto} />` : !vals.length ? html`<div class="mt-5 flex h-48 items-center justify-center rounded-xl bg-[#f8faf9] text-sm font-medium text-slate-500">Nenhum saldo calculado ainda.</div>` : html`
      <div class="mt-5 overflow-x-auto rounded-xl bg-[#f8faf9]">
        <svg viewBox=${`0 0 ${W} ${H}`} class="w-full min-w-[680px]" role="group" aria-label="Saldo Tia de cada ciclo">
          ${ticks.map((tv) => { const y = meio - (tv / max) * amp; return html`<g aria-hidden="true">
            <line x1=${esq} x2=${dir} y1=${y} y2=${y} stroke=${tv === 0 ? "#b9cbc1" : "#dfe8e3"} stroke-dasharray=${tv === 0 ? "" : "4 5"} />
            <text x=${esq - 10} y=${y + 4} text-anchor="end" fill="#64746c" font-size="12">${brlCompacto(tv)}</text></g>`; })}
          ${pts.map((p) => {
            const x = esq + p.i * larg, w = Math.max(6, Math.min(56, larg * 0.55)), cx = x + larg / 2;
            const h = p.v === null ? 0 : Math.max(p.v ? 2 : 0, (Math.abs(p.v) / max) * amp);
            const y = p.v !== null && p.v < 0 ? meio : meio - h;
            return html`<g key=${p.i}>
              ${p.v === null ? html`<line x1=${cx - w / 2} x2=${cx + w / 2} y1=${meio} y2=${meio} stroke="#cbd5e1" stroke-width="3" stroke-dasharray="3 3" />`
                : html`<rect x=${cx - w / 2} y=${y} width=${w} height=${h} rx="5" fill=${p.v >= 0 ? "#10b981" : "#e11d48"} opacity=${foco === null || foco === p.i ? 1 : 0.45} />`}
              <rect x=${x} y=${topo} width=${larg} height=${base - topo} fill="transparent" tabIndex="0" role="img"
                aria-label=${`${p.rotulo}: ${p.v === null ? "em aberto" : brl(p.v)}`}
                onMouseEnter=${() => setFoco(p.i)} onMouseLeave=${() => setFoco(null)} onFocus=${() => setFoco(p.i)} onBlur=${() => setFoco(null)}>
                <title>${p.rotulo}: ${p.v === null ? "em aberto" : brl(p.v)}</title></rect>
              <text x=${cx} y="262" text-anchor="middle" fill="#52655a" font-size="11.5" font-weight="600" aria-hidden="true">${curto(p.rotulo)}</text>
            </g>`;
          })}
        </svg>
      </div>`}
  </section>`;
}

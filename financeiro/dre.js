// Financeiro · DRE Gerencial — tela do Craft Green "DRE Gerencial" (ref app_dre_page + css_c935...).
// Spec: docs/financeiro-spec.md §2.2 e §3.2. Base compartilhada: ./comum.js (não editar lá).
// Props do Router (#/financeiro/dre): me (linha de profiles) e query (objeto da query string).
// Tela só de leitura (sem escrita, sem DESFAZER próprio).
import { html } from "htm/preact";
import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import {
  FinPage, Icone, KpiCardDre, garantirEstilosFin,
  MESES, MESES_CURTOS, cn, brl, brlDre, pct, nomeDre, periodo, useLocalState,
  fetchGrupos, fetchCategorias, fetchLancamentos, fetchVendas,
  montarDre, normalizarSelecao, alternarMes, valorNaSelecao, rotuloSelecao, basesAv, avPercent,
  indicadoresDre, linhasExportacaoDre,
} from "./comum.js";

/* ---------- CSS local: partes de dre_*.css do Craft que não estão em comum.js ----------
   (rótulo com chevron, coluna de valor, layout de celular <768px). Candidato a ir para comum.js. */
let estilosDre = false;
function garantirEstilosDre() {
  if (estilosDre || typeof document === "undefined") return;
  estilosDre = true;
  garantirEstilosFin();
  const st = document.createElement("style");
  st.setAttribute("data-fin-estilos-dre", "1");
  st.textContent = `
.fin-dre-col-class{width:18%}.fin-dre-col-total{width:8%}.fin-dre-col-av{width:5.5%}
.fin-dre-label{display:flex;align-items:flex-start;gap:.3rem;min-width:0}
.fin-dre-label button{display:inline-flex;align-items:flex-start;gap:.3rem;width:100%;text-align:left;color:inherit}
.fin-dre-chevron{flex-shrink:0;width:.8rem;height:.8rem;margin-top:.12rem;opacity:.75}
.fin-dre-nochevron{flex-shrink:0;width:.8rem}
.fin-dre-amount{font-weight:550}
.fin-dre-mlabel{display:none}
@media (max-width:767px){
.fin-dre-table colgroup{display:none}
.fin-dre-table,.fin-dre-table tbody,.fin-dre-table thead{display:block;width:100%}
.fin-dre-table thead tr{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));padding:.5rem;background:#f3f7f5;border-radius:1.05rem 1.05rem 0 0}
.fin-dre-table thead th{padding:.2rem;border-radius:0!important;font-size:.75rem;text-align:center}
.fin-dre-table thead th:first-child{grid-column:1/-1;padding:.5rem}
.fin-dre-table thead th:nth-last-child(2){grid-column:span 3}
.fin-dre-table thead th:last-child{grid-column:span 3;align-self:center}
.fin-dre-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid #dce7e1;padding:.4rem}
.fin-dre-row>*{padding:.5rem .35rem;border:0}
.fin-dre-row th{grid-column:1/-1;padding:.65rem .4rem;font-size:.8rem}
.fin-dre-row td{font-size:.75rem;text-align:right}
.fin-dre-row td:last-child,.fin-dre-row td:nth-last-child(2){grid-column:span 2;border-top:1px solid #dce7e1;margin-top:.5rem;padding-top:.6rem}
.fin-dre-row[data-tone=calculation]>*{border-bottom:0;padding-top:.6rem;padding-bottom:.6rem}
.fin-dre-mlabel{display:block;margin-bottom:.15rem;font-size:.65rem;font-weight:600;color:#52675b}}
`;
  document.head.appendChild(st);
}

const DESTAQUE = ["1", "4", "10", "17", "21"];
const anosDre = () => Array.from(new Set([2024, 2025, 2026, 2027, new Date().getFullYear()])).sort((a, b) => a - b);

async function carregarDre(ano) {
  const { inicio, fim } = periodo(ano, null);
  const [grupos, categorias, lancamentos, vendas] = await Promise.all([
    fetchGrupos(),
    fetchCategorias({ incluirArquivadas: true }), // arquivadas com valor no ano continuam na DRE
    fetchLancamentos({ inicio, fim, conciliado: true }),
    fetchVendas({ inicio, fim }),
  ]);
  return montarDre({ grupos, categorias, lancamentos, vendas });
}

/** Exporta via SheetJS (como o Craft); se a biblioteca não carregar, cai para CSV com as mesmas colunas. */
async function exportarDre(rel, sel, ano) {
  const linhas = linhasExportacaoDre(rel, sel);
  const s = normalizarSelecao(sel);
  const sufixo = s ? s.map((m) => MESES_CURTOS[m]).join("-") : "Ano";
  const nome = `DRE_Gerencial_${ano}_${sufixo}`;
  let XLSX = null;
  try { XLSX = await import("https://esm.sh/xlsx@0.18.5"); } catch (e) { console.warn("SheetJS indisponível, exportando CSV", e); }
  if (XLSX && XLSX.utils) {
    const ws = XLSX.utils.json_to_sheet(linhas);
    ws["!cols"] = [{ wch: 42 }, ...MESES_CURTOS.map(() => ({ wch: 16 })), { wch: 23 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DRE Gerencial");
    XLSX.writeFile(wb, nome + ".xlsx");
    return;
  }
  const cab = Object.keys(linhas[0] || { "Classificação": "" });
  const esc = (v) => { const t = typeof v === "number" ? String(v).replace(".", ",") : String(v ?? ""); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = "﻿" + [cab.map(esc).join(";"), ...linhas.map((l) => cab.map((c) => esc(l[c])).join(";"))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = nome + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DrePage() {
  garantirEstilosDre();
  const [ano, setAno] = useLocalState("dre:selectedYear", new Date().getFullYear());
  const [selRaw, setSel] = useLocalState("dre:selectedMonths", null);
  const sel = normalizarSelecao(selRaw);
  const [rel, setRel] = useState(null);         // null = carregando pela 1ª vez
  const [buscando, setBuscando] = useState(true);
  const [erro, setErro] = useState(null);
  const [exportando, setExportando] = useState(false);
  const [erroExport, setErroExport] = useState("");
  const req = useRef(0);

  const carregar = useCallback(() => {
    const id = ++req.current;
    setBuscando(true);
    setErro(null);
    carregarDre(ano)
      .then((r) => { if (id === req.current) setRel(r); })
      .catch((e) => { if (id === req.current) { console.error(e); setErro(e); } })
      .finally(() => { if (id === req.current) setBuscando(false); });
  }, [ano]);
  useEffect(() => { carregar(); }, [carregar]);

  const carregando = !rel && buscando;
  const linhas = rel || [];
  const rotulo = rotuloSelecao(sel);
  const bases = basesAv(linhas, sel);
  const ind = indicadoresDre(linhas, sel);
  const nomeLinha = (code, padrao) => { const l = linhas.find((x) => String(x.code) === code); return l ? nomeDre(l.name) : padrao; };

  async function exportar() {
    setExportando(true); setErroExport("");
    try { await exportarDre(linhas, sel, ano); }
    catch (e) { console.error(e); setErroExport("Não foi possível exportar a DRE. Tente novamente."); }
    finally { setExportando(false); }
  }

  return html`<${FinPage} class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-3xl font-black tracking-[-0.045em]">DRE Gerencial</h1>
      <div class="flex items-center gap-3">
        <div class="w-28">
          <select aria-label="Ano" value=${String(ano)} onChange=${(e) => setAno(Number(e.target.value))} class="filter-select h-11 py-0">
            ${anosDre().map((a) => html`<option key=${a} value=${String(a)}>${a}</option>`)}
          </select>
        </div>
        <button type="button" onClick=${exportar} disabled=${carregando || !!erro || exportando}
          class="premium-button-primary h-11 px-4 text-xs disabled:cursor-not-allowed disabled:opacity-50">
          <${Icone} nome=${exportando ? "loader" : "download"} class=${cn("h-4 w-4", exportando && "fin-spin")} /> Exportar</button>
      </div>
    </div>

    ${buscando && rel ? html`<div role="status" class="flex items-center gap-2 text-xs font-semibold text-emerald-700">
      <${Icone} nome="loader" class="h-3 w-3 fin-spin" />Atualizando...</div>` : null}
    ${erroExport ? html`<p role="alert" class="rounded-xl border border-rose-200 bg-white p-3 text-sm text-rose-700">${erroExport}</p>` : null}

    ${erro ? html`<div role="alert" class="rounded-2xl border border-rose-200 bg-white p-8 text-center">
        <h2 class="font-bold">Não foi possível carregar a DRE</h2>
        <p class="mt-2 text-sm text-slate-600">Nenhum dado foi alterado.</p>
        <button type="button" onClick=${carregar} class="premium-button-primary mt-5">Tentar novamente</button>
      </div>` : html`
      <section aria-label="Indicadores da DRE" class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3">
        <${KpiCardDre} rotulo=${nomeLinha("1", "Receita Bruta")} texto=${brl(ind.receitaBruta)} tom="green" carregando=${carregando} />
        <${KpiCardDre} rotulo=${nomeLinha("21", "Lucro Líquido")} texto=${brl(ind.lucroLiquido)} tom="light" negativo=${ind.lucroLiquido < 0} carregando=${carregando} />
        <${KpiCardDre} rotulo="Margem" texto=${pct(ind.margemLiquida)} tom="dark" carregando=${carregando} />
        <${KpiCardDre} rotulo="ROAS" texto=${ind.roas.toFixed(2)} tom="white" carregando=${carregando} />
      </section>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-base font-bold">${sel ? rotulo : "Janeiro a dezembro"} · ${ano}</h2>
          <p class="mt-1 text-xs text-slate-500">Valores em R$ · sem centavos</p>
        </div>
        <p aria-live="polite" class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">Período: ${rotulo}</p>
      </div>

      <section class="fin-dre-report" aria-label="Demonstrativo de resultado">
        <table class="fin-dre-table">
          <caption class="sr-only">DRE de ${ano}, com todos os 12 meses visíveis. Período: ${rotulo}. Selecione os meses pelos cabeçalhos para atualizar o Total, a Análise Vertical e os indicadores. Sem seleção, são considerados todos os meses do ano.</caption>
          <colgroup>
            <col class="fin-dre-col-class" />
            ${MESES_CURTOS.map((m) => html`<col key=${m} />`)}
            <col class="fin-dre-col-total" /><col class="fin-dre-col-av" />
          </colgroup>
          <thead><tr>
            <th scope="col">Classificação</th>
            ${MESES_CURTOS.map((m, i) => {
              const on = !!(sel && sel.includes(i));
              return html`<th key=${m} scope="col" data-selected=${on || undefined}>
                <button type="button" aria-label=${MESES[i]} aria-pressed=${on} title=${`Incluir ou remover ${MESES[i]} do período`}
                  onClick=${() => setSel((s) => alternarMes(s, i))}>${m}</button></th>`;
            })}
            <th scope="col" data-selected=${sel === null || undefined}>
              <button type="button" aria-pressed=${sel === null} title="Considerar todos os meses do ano" onClick=${() => setSel(null)}>Total</button></th>
            <th scope="col" title="Análise Vertical do período selecionado">AV %</th>
          </tr></thead>
          <tbody>
            ${carregando ? Array.from({ length: 8 }, (_, i) => html`<tr key=${i} class="fin-dre-row">
                <th scope="row"><span class="sr-only">Carregando classificação</span><div class="h-4 w-3/4 animate-pulse rounded bg-slate-100"></div></th>
                ${Array.from({ length: 14 }, (_, j) => html`<td key=${j}><div class="ml-auto h-4 w-full animate-pulse rounded bg-slate-100"></div></td>`)}
              </tr>`)
              : linhas.map((l) => html`<${LinhaDre} key=${l.id} linha=${l} nivel=${0} sel=${sel} bases=${bases} />`)}
          </tbody>
        </table>
      </section>`}
  <//>`;
}

/** Linha da DRE (grupo ou categoria); grupos com categorias expandem (estado lembrado por linha, como o Craft). */
function LinhaDre({ linha, nivel, sel, bases, codigoPai }) {
  const [aberta, setAberta] = useLocalState("dre:expanded:" + linha.id, false);
  const code = linha.code || codigoPai || "";
  const temFilhos = !!(linha.children && linha.children.length);
  const nome = nomeDre(linha.name);
  const total = valorNaSelecao(linha, sel);
  const av = avPercent(linha, sel, bases, codigoPai);
  const tom = nivel > 0 ? "category" : code === "1" || linha.isCalculated || DESTAQUE.includes(code) ? "calculation" : "regular";
  const destaque = DESTAQUE.includes(code);
  const cor = (v) => (v < 0 ? "fin-dre-negative" : v > 0 && destaque ? "fin-dre-positive" : "");
  return html`
    <tr class="fin-dre-row" data-tone=${tom}>
      <th scope="row">
        <div class="fin-dre-label" style=${`padding-left:${8 * Math.min(nivel, 3)}px`}>
          ${temFilhos ? html`<button type="button" onClick=${() => setAberta((a) => !a)} aria-expanded=${aberta} aria-label=${`${aberta ? "Recolher" : "Expandir"} ${nome}`}>
              <${Icone} nome=${aberta ? "chevron-down" : "chevron-right"} class="fin-dre-chevron" /><span>${nome}</span></button>`
            : html`<span aria-hidden="true" class="fin-dre-nochevron"></span><span>${nome}</span>`}
        </div>
      </th>
      ${MESES_CURTOS.map((m, i) => {
        const v = Number(linha.months && linha.months[i]) || 0;
        return html`<td key=${m} data-selected=${(sel && sel.includes(i)) || undefined} class=${cn("fin-dre-amount", cor(v))} title=${`${MESES[i]}: ${brl(v)}`}>
          <span class="fin-dre-mlabel">${m}</span>${brlDre(v)}</td>`;
      })}
      <td class=${cn("fin-dre-total", cor(total))} title=${`Total · ${rotuloSelecao(sel)}: ${brl(total)}`}>
        <span class="fin-dre-mlabel">Total</span>${brlDre(total)}</td>
      <td><span class="fin-dre-mlabel">Análise Vertical</span><span class="fin-dre-av">${av.toFixed(1)}%</span></td>
    </tr>
    ${aberta && temFilhos ? linha.children.map((c) => html`<${LinhaDre} key=${c.id} linha=${c} nivel=${nivel + 1} sel=${sel} bases=${bases} codigoPai=${code} />`) : null}`;
}

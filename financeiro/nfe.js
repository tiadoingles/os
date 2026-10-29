// Financeiro · NF-e — placeholder (integração em breve). Sem banco: só a prévia desabilitada do layout futuro.
// Base: ./comum.js (não editar lá).
import { html } from "htm/preact";
import { FinPage, Icone } from "./comum.js";

const COLUNAS = ["Número", "Emissão", "Cliente / Tomador", "Valor", "Status", "PDF / XML"];

export function NfePage() {
  return html`<${FinPage} class="space-y-6">
    <section>
      <p class="text-[16px] font-black uppercase tracking-[0.2em] text-emerald-700">Fiscal</p>
      <h1 class="mt-2 text-3xl font-black tracking-[-0.045em] text-[#07110e]">NF-e</h1>
      <p class="mt-2 text-sm font-medium text-slate-500">Notas fiscais emitidas pela empresa.</p>
    </section>

    <section class="flex flex-col gap-4 rounded-[1.6rem] border border-emerald-200 bg-emerald-50 p-6 md:flex-row md:items-center md:p-7">
      <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-emerald-700"><${Icone} nome="receipt" class="h-6 w-6" /></span>
      <div>
        <h2 class="text-lg font-black tracking-tight text-emerald-950">Integração em breve</h2>
        <p class="mt-1 text-sm font-medium text-emerald-900/80">Esta tela será conectada ao emissor de notas fiscais para trazer todas as NF-e disponíveis, com filtros por período e status e acesso ao PDF e ao XML de cada nota. Enquanto isso, a prévia abaixo mostra como ela vai ficar.</p>
      </div>
    </section>

    <div aria-hidden="true" class="pointer-events-none select-none space-y-5 opacity-50">
      <section class="rounded-[1.4rem] border border-slate-200 bg-white p-3 shadow-sm">
        <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <input type="date" disabled tabIndex="-1" class="filter-select h-11 py-0" />
          <input type="date" disabled tabIndex="-1" class="filter-select h-11 py-0" />
          <select disabled tabIndex="-1" class="filter-select h-11 py-0"><option>Todos os status</option></select>
          <label class="relative"><${Icone} nome="search" class="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
            <input disabled tabIndex="-1" placeholder="Número ou tomador..." class="filter-select h-11 py-0 pl-11" /></label>
        </div>
      </section>
      <section class="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white">
        <div class="overflow-x-auto"><table class="w-full min-w-[900px]">
          <thead><tr class="bg-slate-50 text-left text-[13.5px] font-black uppercase tracking-widest text-slate-400">
            ${COLUNAS.map((c, i) => html`<th class=${"px-4 py-3" + (i === 3 ? " text-right" : "")}>${c}</th>`)}
          </tr></thead>
          <tbody><tr><td colSpan=${COLUNAS.length} class="p-16 text-center">
            <${Icone} nome="file" class="mx-auto h-8 w-8 text-slate-200" />
            <p class="mt-3 text-sm font-black text-slate-600">Nenhuma nota fiscal</p>
            <p class="mt-1 text-xs font-medium text-slate-400">As notas aparecem aqui quando a integração estiver ativa.</p>
          </td></tr></tbody>
        </table></div>
      </section>
    </div>
  <//>`;
}

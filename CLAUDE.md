# Sistema Operacional — Tia do Inglês

App web interno da empresa (Método Tia do Inglês / Fluent Mind Academy).
Front-end sem build (Preact + htm + Tailwind Play CDN, tudo via CDN), Supabase
como backend.

## Arquitetura

- **`app.js`** — o app inteiro num arquivo só: setup do Supabase (`sb`),
  fetch functions por entidade, componentes de página, `NAV` (estrutura do
  menu lateral), `Shell` (sidebar + links de topo/rodapé), `Router` (dispatch
  de rota → componente).
- **`index.html`** — shell HTML, Tailwind config inline, importmap (preact,
  htm, supabase-js, marked via esm.sh), carrega `styles.css`/`config.js`/
  `app.js` com `?v=N` pra cache-busting.
- **`config.js`** — `window.__CONFIG__` (URL + anon key do Supabase, pública,
  protegida por RLS). Gerado localmente, não versionado como segredo.
- **Backend** — Supabase projeto `hmvlkltyvyhlxfyaovpe` (região `sa-east-1`).
  Edge Functions (`ai`, `public-chat`, `sync`, `planilha`, `admin-users`)
  vivem no Supabase, não neste repo — leia/edite via MCP do Supabase
  (`get_edge_function`/`deploy_edge_function`).

## Convenções

- **Fetch**: uma função `async function fetchX() { const { data, error } =
  await sb.from("tabela").select("...")...; if (error) throw error; return
  data || []; }` por entidade.
- **Página**: `useState(null)` = carregando, `useEffect` chama o fetch,
  `notify(errMsg(e), "err")` no catch. Veja `FerramentasPage`/
  `fetchFerramentas` como referência de estilo.
- **RLS**: padrão do OS é `select=true` / `write=app.is_editor()` — desvie
  disso só com razão explícita (ex. dado financeiro sensível), nunca por
  omissão.
- **Rota**: `#/<grupo>/<slug>` pros itens de `NAV`; grupos sem sub-item (ex.
  Base de Conhecimento) usam `#/<grupo>` direto. Links de topo/rodapé (Início,
  Squad, Farol do Lucro, Pedir a IA, Ferramentas, Administração, Meu perfil)
  não passam por `NAV`, são hardcoded no `Shell`.
- **Regras de marca** (qualquer material gerado pro OS produzir): zero
  emoji, nunca diminutivo/linguagem infantil, tom adulto e acolhedor, nunca
  religião/política/tema polêmico.

## Deploy

`git push` na branch `main` publica direto em
`https://tiadoingles.github.io/os/` via GitHub Pages, servindo a raiz da
`main` — **sem build, sem CI, sem teste automatizado**. Isso significa:

1. Sempre bump `?v=N` das 3 tags em `index.html` (styles.css/config.js/app.js)
   quando `app.js`/`styles.css` mudar — sem isso o navegador serve cache.
2. Sempre teste local antes de commitar: `preview_start` com a config
   `os-local` de `.claude/launch.json` (`python3 -m http.server 8532`),
   confira a página no navegador.
3. `revisor-tecnico-qa` (squad, ver abaixo) é o único freio de mão que existe
   pra pegar erro antes de virar produção — não pule essa revisão em mudança
   de schema/RLS/Edge Function.

## Squad de agentes

Todo trabalho de manutenção/melhoria do OS passa pelo squad de subagentes
definido em `.claude/agents/` — **sempre acione o squad em vez de trabalhar
ad hoc**, seja a tarefa nova ou repetida. Estado atual (nome, função, última
tarefa executada, ativo/precisa de atualização) fica em
`public.os_squad_agentes` (Supabase `hmvlkltyvyhlxfyaovpe`) e é visível na
própria página `#/squad` do OS.

**Topo** (2): `maestro-plataforma` (dispatcher geral, entra em pedido que
cruza 2+ abas), `arquiteto-plataforma` (rotas/Shell/NAV/schema cross-módulo).

**Maestro de cada aba** (7, um por grupo do menu) — ponto de entrada de
qualquer pedido sobre aquela aba, delega pro pool/exclusivos certos:
`maestro-base-conhecimento`, `maestro-agenda`, `maestro-pedagogico`,
`maestro-cs`, `maestro-comercial`, `maestro-financeiro`, `maestro-conteudo`.

**Pool compartilhado** (7 — reutilizados por 2+ maestros, não duplique):
`pesquisador-avatar` (dores/desejos da aluna), `designer-canva` (peças no
Canva), `revisor-design-visual` (QA visual), `revisor-conteudo-marca`
(metodologia/marca/tom), `dev-frontend-os` (implementa página/Edge
Function), `revisor-tecnico-qa` (RLS/regressão — o freio de mão), `analista-
requisitos-dados` (levanta requisito de placeholder).

**Especialistas exclusivos** (7 — conhecimento único de uma aba):
`pesquisador-pedagogico`, `redator-pedagogico` (Pedagógico); `redator-
conteudo` (Conteúdo); `curador-qualidade-chat` (CS/Suporte); `curador-base-
conhecimento`, `redator-documentacao`, `revisor-consistencia-kb` (Base de
Conhecimento).

Cada agente atualiza sua própria linha em `os_squad_agentes`
(`ultima_tarefa`, `ultima_execucao_em`, `ativo`) ao terminar uma tarefa real,
e marca `precisa_atualizacao=true` se perceber que seu próprio arquivo em
`.claude/agents/` ficou desatualizado em relação ao que o OS precisa.

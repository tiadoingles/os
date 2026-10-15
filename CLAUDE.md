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
  protegida por RLS) e `AUTH_MODE`. É versionado e o repo é público: **nunca**
  colocar senha ou segredo aqui. `AUTH_MODE: "login"` = tela de e-mail e senha
  (padrão); `"open"` = entrada automática com conta compartilhada
  (`GUEST_EMAIL/GUEST_PASSWORD`), só para testes e desligado.
- **Backend** — Supabase projeto `hmvlkltyvyhlxfyaovpe` (região `sa-east-1`).
  Edge Functions (`ai`, `public-chat`, `sync`, `planilha`, `admin-users`,
  `diagnostico-drive`, `metas-sheet-sync`, `mentorados-sheet`, entre outras)
  vivem no Supabase, não neste repo — leia/edite via MCP do Supabase
  (`get_edge_function`/`deploy_edge_function`).

## Acesso, papéis e permissões

- **Login**: componente `Login` (`app.js`), sem cadastro público. Contas só são criadas
  pelo ADM em Administração (Edge Function `admin-users`, que só aceita `admin`).
  Esqueci a senha = o ADM gera nova senha temporária ("Nova senha"); o usuário troca em
  Meu perfil. (Ainda é preciso desligar "Allow new users to sign up" no painel do
  Supabase: Authentication > Sign In / Providers; não dá para fazer por SQL.)
- **Papéis** (`profiles.role`, enum `user_role`): `admin` (rótulo **ADM**, acesso a tudo),
  `cs` (rótulo **CS**, só a aba CS / Suporte), e os legados `editor` e `leitor`
  (editor/leitor veem tudo menos Administração; leitor não grava). `ROLE_LABEL` em `app.js`.
- **Camada de interface**: bloco `// <permissoes>` em `app.js` (logo após `NAV`):
  `rotaPermitida(role, path)` é a **fonte única**; o `Shell` (menu e links de topo/rodapé)
  e o `Router` (guarda: rota proibida => `Redirecionar` para `rotaEntrada(role)`, nunca
  "página não encontrada" nem conteúdo) passam por ela. Helpers: `ehEditor`,
  `podeEscreverCS`, `navParaRole`, `rotuloRole`, `mensagemErroLogin`. Papel desconhecido
  não ganha privilégio (só `#/perfil`). **Não** compare `me.role !== "leitor"`: use
  `ehEditor(role)` (Base, Agenda, Farol, Ferramentas...) ou `podeEscreverCS(role)` (telas de CS).
  Item novo no grupo `cs` do `NAV` já fica liberado para o CS; item novo em outro grupo
  fica bloqueado para ele automaticamente.
- **Teste dos helpers**: `node scripts/teste-permissoes.js` (extrai o bloco do `app.js`;
  rode antes de mexer em `NAV`/papéis).
- **Camada de banco (a barreira real)** — SQL em `scripts/migrations/` (a migration
  `20261009_papel_cs_helpers_e_rls.sql` só vale depois de aplicada no Supabase; o valor
  `cs` do enum já foi aplicado; conferir `select * from pg_policies` antes de confiar): o papel `cs` NÃO entra em `app.is_editor()`.
  Helpers `app.is_cs()`, `app.is_cs_or_editor()` e `app.cs_section_id()`. Tabelas do CS
  (escrita para cs/editor/admin): `livros_envios`, `faq_interacoes` (só seção `cs-suporte`),
  `cs_diagnosticos`, `cs_metas`; leitura para cs: também `cs_mentorados`, `pesquisa_avatar`,
  `chat_widget_logs`, `sync_status` (só `metas-planilha`/`mentorados-planilha`),
  `automacao_estado` e a seção `cs-suporte` da Base (alimenta o FAQ). As demais tabelas
  têm `select` `to authenticated using (not app.is_cs())`. Tela/tabela nova do CS: dar
  escrita via `app.is_cs_or_editor()`; tabela de outra área: `not app.is_cs()` no select.
- **Edge Functions e papel**: `admin-users` (só admin; aceita leitor/editor/admin/cs),
  `diagnostico-drive`, `metas-sheet-sync`, `mentorados-sheet` (force) e `planilha`
  aceitam editor/admin/cs. `ai` e `sync` só exigem usuário logado (ver lacunas no relatório
  de segurança da tarefa de login).
- **LinkedIn da Tia** (`#/conteudo/linkedin`, `LinkedinPage`/`LinkedinCard`): fila de posts em
  `public.linkedin_posts` (RLS: select `not app.is_cs()`, escrita `app.is_editor()`; SQL em
  `scripts/migrations/20261014_linkedin_*.sql`). Ações da Edge Function `ai` (arquivo
  `linkedin.ts` dentro da função): `linkedin_semana` (gera os rascunhos da grade a partir do
  guia `kb_documents.chave_externa='linkedin:guia-editorial'` + `conteudo_insights` + últimos
  posts; só preenche horários vazios) e `linkedin_reescrever` (devolve texto, não grava); as
  duas exigem editor/admin. Formatos história/case/depoimento (`formato` contendo "história",
  "case" ou "depoimento") seguem a estrutura de roteiro do guia (v2, seção 4.1) e vão de 1.500 a
  2.500 caracteres; os demais, 900 a 1.500 — regra duplicada em `ehFormatoRoteiro`/`faixaTamanho`
  (`linkedin.ts`) e `liFaixaTamanho` (`app.js`), mantenha as duas iguais. Horários em America/Sao_Paulo (UTC-03:00).
- **LinkedIn Fase 3 (publicação automática)** — SQL em `scripts/migrations/20261015_linkedin_publicacao_api.sql`.
  Post `aprovado` é publicado sozinho no perfil pessoal quando chega o `agendado_para` (até 24 h de atraso;
  mais que isso fica parado e a aba pede nova data). Edge Function `linkedin` (`verify_jwt=false`, valida
  por op): `GET /functions/v1/linkedin/callback` (redirect do OAuth, state de uso único 10 min),
  `auth_url`/`status` (editor/admin), `desconectar` (admin), `publicar_pendentes` (header `x-cron-token`,
  cron `linkedin-publicar` */5 min; o token fica só em `app.linkedin_config`, nunca no repo). Segredos
  `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET`; sem eles tudo degrada com "LinkedIn não configurado".
  Token OAuth em `app.linkedin_conexao` (schema não exposto, sem grant, RLS sem política), lido só pelas
  RPCs `linkedin_svc_*` (execute só service_role); o front usa `linkedin_conexao_status()` (editor/admin,
  só nome/expires_at). Status `publicando` = trava atômica (`linkedin_svc_reservar`, lote 3); preso há
  +15 min vira `erro` (nunca republica sozinho). Trigger `app.linkedin_posts_guarda` impede o front de
  mudar status de post publicando/publicado (inclusive via DESFAZER), gravar `linkedin_urn`/`publicado_em`
  e aprovar sem data. `commentary` em little text format (`little.ts` na função: escapa reservados e
  hashtags viram `{hashtag|\#|tag}`); `LinkedIn-Version` na constante `LINKEDIN_VERSION` (renovar antes
  do sunset, ~1 ano por versão). Aviso na Início quando o token expira em ≤7 dias.

## Convenções

- **Fetch**: uma função `async function fetchX() { const { data, error } =
  await sb.from("tabela").select("...")...; if (error) throw error; return
  data || []; }` por entidade.
- **Página**: `useState(null)` = carregando, `useEffect` chama o fetch,
  `notify(errMsg(e), "err")` no catch. Veja `FerramentasPage`/
  `fetchFerramentas` como referência de estilo.
- **RLS**: padrão do OS é `select` para `authenticated` (nunca para o role público/anon)
  excluindo o papel cs (`not app.is_cs()`) / `write=app.is_editor()` — desvie
  disso só com razão explícita (ex. dado financeiro sensível), nunca por
  omissão. Tabelas de CS usam `app.is_cs_or_editor()` na escrita.
- **Rota**: `#/<grupo>/<slug>` pros itens de `NAV`; grupos sem sub-item (ex.
  Base de Conhecimento) usam `#/<grupo>` direto. Links de topo/rodapé (Início,
  Squad, Farol do Lucro, Pedir a IA, Ferramentas, Administração, Meu perfil)
  não passam por `NAV`, são hardcoded no `Shell`.
- **DESFAZER** (padrão de UI de toda tela com escrita): depois de gravar, chame
  `registrarDesfazer(escopo, "rótulo da ação", desfazerX(...))` — usa
  `desfazerCriacao` (exclui o criado), `desfazerEdicao` (regrava o snapshot
  `select("*")` tirado antes) ou `desfazerExclusao` (reinsere com o mesmo id).
  Aparece o aviso "Alteração salva · DESFAZER" (10 s) e o botão DESFAZER no topo
  da aba (renderizado pelo `Shell` via `escopoDesfazer(route)`; pilha de até 20
  por aba, só na memória da sessão, escondido para leitor). A tela recarrega com
  `useAoDesfazer(escopo, fn)`. Conflito (registro mudou depois) pede confirmação.
  Tabela com campos protegidos por trigger (ex. `cs_metas`, `cs_diagnosticos`)
  restaura por RPC `security definer` restrita a editor (`os_restaurar_cs_metas`,
  `os_restaurar_diagnostico`) que usam a versão guardada pelo próprio banco
  (`os_desfazer_snapshots`, limpa após 3 dias), nunca afrouxando RLS nem
  confiando no JSON do cliente. Tela nova com escrita:
  inclua o escopo em `escopoDesfazer`.
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

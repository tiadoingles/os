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
  `diagnostico-drive`, `metas-sheet-sync`, `mentorados-sheet`, `teste-vac-sheet`, entre outras)
  vivem no Supabase, não neste repo — leia/edite via MCP do Supabase
  (`get_edge_function`/`deploy_edge_function`).

## Acesso, papéis e permissões

- **Login**: componente `Login` (`app.js`), sem cadastro público. Contas só são criadas
  pelo ADM em Administração (Edge Function `admin-users`, que só aceita `admin`).
  Esqueci a senha = o ADM gera nova senha temporária ("Nova senha").
- **Troca de senha obrigatória** (`profiles.precisa_trocar_senha`, SQL em
  `scripts/migrations/20261016_troca_senha_e_adm_limitado.sql`): a `admin-users` liga a flag em
  `create` e `resetPassword` (service_role); o trigger `on_auth_user_password_changed` em `auth.users`
  (`app.handle_password_change`) desliga quando `encrypted_password` muda (ou seja, depois de
  `supabase.auth.updateUser({ password })`). O usuário não liga/desliga a flag de ninguém, nem a
  própria sem trocar a senha (`app.protect_profile_role`). Com a flag ligada o `App` mostra só
  `TrocaSenhaObrigatoria` (sem menu/rotas; tem "Sair"). Regras da senha (Tia): mínimo 8 caracteres,
  letras e números, diferente da atual — `regrasSenha`/`mensagemErroSenha` no bloco `<permissoes>`,
  usadas também em Meu perfil (`NovaSenhaForm`). "Diferente da atual" é conferido pelo Supabase
  (erro `same_password`). A regra no servidor depende do painel do Supabase (Auth > Providers >
  Email: mínimo 8 e "Letters and digits"); a senha temporária gerada já atende.
  (Ainda é preciso desligar "Allow new users to sign up" no painel do Supabase:
  Authentication > Sign In / Providers; não dá para fazer por SQL.)
- **Papéis** (`profiles.role`, enum `user_role`): `admin` (rótulo **ADM**, acesso a tudo),
  `adm_limitado` (rótulo **ADM limitado**, ver abaixo), `cs` (rótulo **CS**, só a aba CS / Suporte),
  e os legados `editor` e `leitor` (editor/leitor veem tudo menos Administração; leitor não grava).
  `ROLE_LABEL`/`PAPEIS_ADMIN` em `app.js`.
- **ADM limitado** ("usa tudo, sem mexer na estrutura"): no banco é `role = 'editor'` +
  `profiles.acesso_limitado = true` (check `profiles_acesso_limitado_so_editor`); no front
  `papelEfetivo(perfil)` vira `adm_limitado` ao carregar o perfil. Assim passa como editor em
  `app.is_editor()` e em todas as Edge Functions que checam editor/admin (sem redeploy). Bloqueios:
  Administração (menu/Router + `admin-users` recusa `role<>'admin'` ou `acesso_limitado`), `app_config`,
  excluir documentos/versões/seções e criar seções (já eram só `app.is_admin()`), editar seções
  (`kb_sections` update), registro de Ferramentas (`os_ferramentas` insert/update) e squad
  (`os_squad_agentes` escrita) — via `app.is_editor_estrutura()` (= `is_editor() and not
  is_adm_limitado()`); no front, `podeMexerEstrutura(role)`. Desconectar o LinkedIn segue só admin.
  **Tabela/tela nova que seja estrutura** (configuração global, cadastro que muda o sistema):
  escrita com `app.is_editor_estrutura()` e botão com `podeMexerEstrutura`; o resto do dia a dia usa
  `app.is_editor()`/`ehEditor` normalmente. Exclusões do dia a dia (eventos da agenda, indicadores
  do Farol, fichas/metas de CS, posts) continuam liberadas para ele, com DESFAZER.
  Teste de RLS: `scripts/migrations/teste_rls_adm_limitado.sql`.
- **Camada de interface**: bloco `// <permissoes>` em `app.js` (logo após `NAV`):
  `rotaPermitida(role, path)` é a **fonte única**; o `Shell` (menu e links de topo/rodapé)
  e o `Router` (guarda: rota proibida => `Redirecionar` para `rotaEntrada(role)`, nunca
  "página não encontrada" nem conteúdo) passam por ela. Helpers: `ehEditor`,
  `podeEscreverCS`, `podeMexerEstrutura`, `papelEfetivo`, `navParaRole`, `rotuloRole`, `mensagemErroLogin`. Papel desconhecido
  não ganha privilégio (só `#/perfil`). **Não** compare `me.role !== "leitor"`: use
  `ehEditor(role)` (Base, Agenda, Farol, Ferramentas...) ou `podeEscreverCS(role)` (telas de CS).
  Item novo no grupo `cs` do `NAV` já fica liberado para o CS; item novo em outro grupo
  fica bloqueado para ele automaticamente.
- **Teste dos helpers**: `node scripts/teste-permissoes.js` (extrai o bloco do `app.js`;
  rode antes de mexer em `NAV`/papéis). Sem Node na máquina: rode no console do preview
  (`fetch` do script + `new Function(...)(module)` e `module.exports.executar(textoDoAppJs)`).
- **Camada de banco (a barreira real)** — SQL em `scripts/migrations/`. A migration
  `20261009_papel_cs_helpers_e_rls.sql` foi **aplicada em 16/10/2026** (nome no Supabase:
  `papel_cs_helpers_e_rls`; reverter com `rollback_papel_cs.sql`). O papel `cs` NÃO entra em `app.is_editor()`.
  Helpers `app.is_cs()`, `app.is_cs_or_editor()` (cs/editor/admin, inclui ADM limitado) e `app.cs_section_id()`.
  Tabelas do CS (escrita para cs/editor/admin): `livros_envios`, `faq_interacoes` (cs só na seção `cs-suporte`),
  `cs_diagnosticos`, `cs_metas` (+ RPCs de DESFAZER `os_restaurar_cs_metas`/`os_restaurar_diagnostico`);
  só leitura para cs: `cs_mentorados`, `cs_teste_vac`, `pesquisa_avatar`, `chat_widget_logs`,
  `sync_status` (só `metas-planilha`/`mentorados-planilha`/`teste-vac-planilha`), `automacao_estado`,
  o próprio `profiles` e a seção `cs-suporte` da Base (`kb_sections`/`kb_documents`/`kb_document_versions`,
  alimenta o FAQ; storage `kb-documents` fechado para cs). As demais tabelas
  têm `select` `to authenticated using (not app.is_cs())`; `kb_activity_log` insert também exclui cs.
  Desde esta migration o **anon não lê nenhuma tabela do OS** (antes lia `livros_envios`, `ai_usage_log` etc.).
  Tela/tabela nova do CS: escrita via `app.is_cs_or_editor()`; tabela de outra área: `not app.is_cs()` no select.
  Teste: `scripts/migrations/teste_rls_cs.sql` (cs, editor, admin, leitor, ADM limitado e anon; rollback).
  Lacuna conhecida: a Edge Function `ai` (ação `ask`) aceita qualquer `secao_slug` e o modo geral para
  qualquer logado — para o cs quem limita é só o RLS acima (consultas com o JWT do usuário); e a `sync`
  aceita qualquer logado em todas as ops (roda com service_role).
- **Edge Functions e papel**: `admin-users` (só admin pleno; aceita leitor/editor/admin/cs/adm_limitado;
  `list` devolve `acesso_limitado`/`precisa_trocar_senha`),
  `diagnostico-drive`, `metas-sheet-sync`, `mentorados-sheet`/`teste-vac-sheet` (force) e `planilha`
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

- **Gerador de Materiais das Arenas** (`#/pedagogico/gerador-materiais`, `GeradorMateriaisPage`/`FormArena`/
  `PedidoArena`/`RegrasArena`; SQL em `scripts/migrations/20261016_arenas_previa_regras.sql`, teste de RLS em
  `teste_rls_arena_regras.sql`). Desde 16/10/2026 gera **sob demanda dentro do OS** (a tarefa local
  `gerar-materiais-os` está desativada; não há fila). Fluxo e `materiais_pedidos.status`: formulário →
  `gerando_previa` (o front cria `conteudo` com um placeholder `{nivel,n,tema}` por material e chama a ação
  `arena_gerar` da Edge Function `ai` **uma vez por material**, até 3 em paralelo, `ARENA_PARALELO`; pode repetir
  só o que falhou) → `previa` (cartões com todo o conteúdo + indicadores `checarMaterial`) → ajustes livres
  (`arena_ajustar`, histórico em `materiais_pedidos.ajustes`, DESFAZER) → "Aprovar e gerar PDFs" (`gerando_pdf`:
  pdfmake no navegador, `montarDocArena`/`gerarPdfArena`, upload em `gerados/arenas/<data>-<tema>-<id8>/` com a
  sessão de quem aprovou + .zip via JSZip) → `pronto` → modal "ajustes viram regras?" (`arena_regras_sugerir` →
  `public.arena_regras`, origem `aprendida`, `pendente_skill=true`). `pendente`/`processando` são legado.
  Ações `arena_*` (arquivo `arena.ts` da função `ai`): exigem editor/admin, respeitam a pausa (`automacao_estado`),
  registram custo (`ai:arena_gerar|ajustar|regras`), usam structured outputs (`output_config.format`) + validação
  (`validarMaterial`) e regeram 1 vez se vier fora das regras. Prompt: regras ativas de `arena_regras` (as `base`
  são a semente aprovada em 16/10; só mudam por migration — RLS bloqueia escrita nelas), MYPA, resumo do método,
  exemplos aprovados e a `variacao` dos últimos 10 pedidos prontos. `ehSimNao`/`itemNoTexto` existem em
  `arena.ts` e em `app.js` (`arenaSimNao`/`arenaItemNoTexto`): mantenha iguais. Modo de teste sem senha: header
  `x-arena-teste` igual a `app_config.arena_teste_token` (só existe enquanto essa linha existir; apague após testar).
  PDF: A4, timbrado `assets/timbrado-arenas.jpg` de fundo, margens 2,2/2,5/3,8/3,2 cm, tamanhos da skill; fonte
  **Source Sans 3** (OFL, jsDelivr/@fontsource) porque a licença da Aller (Dalton Maag) não permite hospedá-la no
  repo público; reserva Montserrat. Se uma seção não cabe numa página, cai para leitura 12 / perguntas compactas /
  Glossary 22 → 20 (avisa na tela e no `log`).

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

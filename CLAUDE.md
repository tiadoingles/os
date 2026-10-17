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
  `diagnostico-drive`, `metas-sheet-sync`, `mentorados-sheet`, `teste-vac-sheet`, `nivelamento-sheet`,
  `pesquisas-respostas`, entre outras)
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
- **Acesso por aba** (decisão da Tia, 16/10/2026; SQL em `scripts/migrations/20261016_areas_por_aba.sql`,
  aplicado como `areas_por_aba_enum` + `areas_por_aba_rls`; reverter com `rollback_areas_por_aba.sql`).
  Cada usuário é **ADM** (`profiles.role = 'admin'`: vê e altera tudo, inclusive Início, Farol do Lucro, Pedir a IA,
  Squad, Ferramentas e Administração) ou **equipe** (`role = 'equipe'`) com uma ou mais abas em `profiles.areas`
  (`text[]`, check `profiles_areas_validas` nos 7 slugs do `NAV`: `bc`, `agenda`, `pedagogico`, `cs`, `comercial`,
  `financeiro`, `conteudo`). Quem é da equipe vê só as abas dele e "Meu perfil"; dentro de cada aba cadastra, edita e
  gera. Sem aba: só Meu perfil, com o aviso "Peça ao ADM para liberar suas abas". Ao entrar, cai no 1º item da 1ª aba
  liberada (ordem do menu). A troca de senha obrigatória continua antes de tudo.
  **Legados dormentes**: os valores `editor`, `leitor` e `cs` continuam no enum `user_role` (remover valor de enum exige
  recriar o tipo), mas o check `profiles_role_admin_ou_equipe` só aceita `admin`/`equipe`; o ADM limitado saiu
  (`acesso_limitado` fica sempre false, check `profiles_acesso_limitado_dormente`). Os helpers antigos foram mantidos
  só por segurança: `app.is_editor()` e `app.is_editor_estrutura()` = `app.is_admin()`, `app.is_cs_or_editor()` =
  `app.tem_area('cs')`, `app.is_cs()`/`app.is_adm_limitado()` = false. **Não use os helpers antigos em código novo.**
  Só o ADM muda papel/abas (trigger `app.protect_profile_role`, que também protege `areas`).
- **Camada de interface**: bloco `// <permissoes>` em `app.js` (logo após `NAV`): `rotaPermitida(me, path)` é a
  **fonte única**; o `Shell` (menu e links de topo/rodapé) e o `Router` (guarda: rota proibida => `Redirecionar` para
  `rotaEntrada(me)`, nunca "página não encontrada" nem conteúdo) passam por ela. Helpers (recebem o `me`, a linha de
  `profiles`): `ehAdmin`, `areasDe`, `temArea(me, "cs")`, `areaDaRota`, `navPara`, `podeEscreverRota` (botão DESFAZER
  do topo), `rotuloAcesso`, `normalizarAcesso`, `mensagemErroLogin`. Escrita numa tela = `temArea(me, "<aba da tela>")`;
  telas só do ADM (Início, Farol, Ferramentas, Squad, Administração) = `ehAdmin(me)`. Excluir documento/seção da Base
  e criar seção continuam só do ADM. Item novo num grupo do `NAV` já fica liberado para quem tem aquela aba.
- **Teste dos helpers**: `node scripts/teste-permissoes.js` (extrai o bloco do `app.js`; 2.080 verificações em
  16/10/2026). Sem Node na máquina: rode no console do preview (`fetch` do script + `new Function("module","require", t)(module)`
  e `module.exports.executar(textoDoAppJs)`).
- **Camada de banco (a barreira real)**: `app.tem_area(slug)` (security definer; ADM = todas). Mapa aba → tabelas:
  - `bc`: `kb_sections` (update; insert/delete só ADM), `kb_documents` e `kb_document_versions` (delete só ADM),
    `kb_activity_log`, storage `kb-documents` (delete só ADM). Quem tem `cs` lê só a seção `cs-suporte` (FAQ).
    `profiles`: cada um lê a própria linha; ADM e quem tem `bc` leem todas (responsável/autor dos documentos).
  - `agenda`: `agenda_eventos`.
  - `pedagogico`: `aulas_agenda`, `materiais_pedidos`, `slides_pedidos`, `arena_regras` (escrita só `origem='aprendida'`),
    storage `gerados` (escrita; leitura segue pública).
  - `cs`: `livros_envios`, `faq_interacoes` (só `secao_slug='cs-suporte'`; ADM todas), `cs_diagnosticos`, `cs_metas`
    (delete só manual), `cs_mentorados`, `cs_teste_vac`, `cs_nivelamento`, `cs_pesquisa_respostas` (+ RPC `cs_pesquisa_painel`),
    `cs_mentorado_notas`, `cs_mentorado_vinculos`, `cs_mentorado_eventos` (só leitura) + RPCs `cs_ficha_mentorado`/`cs_mentorados_resumo`,
    `chat_widget_logs`, `pesquisa_avatar`, `nivelamento_respostas`
    (leitura; o insert público do teste continua) e `sync_status` (leitura das chaves `metas-planilha`,
    `mentorados-planilha`, `teste-vac-planilha`, `nivelamento-planilha`, `pesquisas-respostas`); RPCs `os_restaurar_cs_metas`/`os_restaurar_diagnostico`.
  - `conteudo`: `conteudo_calendario`, `conteudo_objetivo_resumo`, `conteudo_insights`, `ig_dia`, `ig_perfil`, `ig_post`,
    `linkedin_posts`; RPC `linkedin_conexao_status`.
  - `comercial`, `financeiro`: nenhuma tabela ainda.
  - **Só ADM**: `app_config`, `ai_usage_log`, `farol_config`, `farol_indicadores`, `os_ferramentas`, `os_squad_agentes`,
    `sync_status` (escrita e demais chaves), `automacao_estado` (escrita; a leitura é de qualquer logado porque as Edge
    Functions conferem a pausa com o JWT de quem chamou), `profiles` (escrita de outros).
  O anon não lê nenhuma tabela do OS. **Tabela nova**: `select`/escrita `to authenticated using (app.tem_area('<aba>'))`;
  transversal/configuração: `app.is_admin()`. Teste: `scripts/migrations/teste_rls_areas.sql` (ADM, `{cs}`,
  `{cs,pedagogico}`, `{conteudo}`, sem aba e anon; rollback; 420 + 51 verificações em 16/10/2026).
- **Edge Functions e área** (checagem no servidor, `role === 'admin' || areas.includes(...)`): `admin-users` (só ADM;
  ações `list`/`create {admin, areas}`/`setAcesso {userId, admin, areas}` (devolve `antes`/`depois` para o DESFAZER;
  recusa tirar o próprio ADM)/`resetPassword`/`delete`); `planilha`, `diagnostico-drive`, `metas-sheet-sync`,
  `mentorados-sheet`, `teste-vac-sheet`, `nivelamento-sheet`, `pesquisas-respostas` = `cs` (os crons continuam pelo
  `x-sync-token`; a op `perguntar` da `pesquisas-respostas` exige usuário com `cs`, nunca o token); `ai`: `classify` = `bc`,
  `ask` com `secao_slug=cs-suporte` = `cs`, com outra seção = `bc`, sem seção (Gerador de conteúdos; Pedir a IA é só do
  ADM na interface) = `conteudo`, `linkedin_*` = `conteudo` (o guia editorial é lido com service_role depois da
  checagem), `arena_*` = `pedagogico`, `status` só pede login; `linkedin`: `status`/`auth_url` = `conteudo`,
  `desconectar` = ADM; `sync` (botões): `envios`/`pesquisas`/`chat-categorias`/`regenerar_resumo_pesquisa` = `cs`,
  `conteudo-metricas`/`conteudo-insights` = `conteudo`, `aulas-praticas` = `pedagogico`, `drive` = `bc`.
- **Contas atuais (16/10/2026)**: contato@ e marcela@ = ADM; suporte@, tutores@, tutores1@ = `{cs}`;
  `sync@os.tiadoingles.com.br` (conta de serviço do `scripts/sync_skills.py`, que só lê `kb_sections` e lê/grava
  `kb_documents`/`kb_document_versions`) = `{bc}`; `teste@os.tiadoingles.com.br` (editor legado do modo aberto) = as 7
  abas, aguardando a Tia decidir se exclui.
- **Ficha do Mentorado** (`#/cs/mentorados?ficha=<email>`, `FichaMentoradoPage`; SQL
  `scripts/migrations/20261017_cs_ficha_mentorado.sql`; teste `scripts/migrations/teste_rls_ficha_mentorado.sql`). Tudo sobre a
  pessoa num lugar: cabeçalho da Lista de Mentorados, alertas da jornada (calculados no front), **anotações da equipe**,
  Diagnóstico, Metas, Teste VAC, Nivelamento, Pesquisas, Chat da Cademí, Envio de livros, linha do tempo e vínculos.
  **Chave** = e-mail da Lista de Mentorados (`lower(trim)`); as outras abas entram por e-mail OU telefone (`app.tel10` = últimos
  10 dígitos) OU vínculo manual (`cs_mentorado_vinculos`, único por tipo+valor, normalizado por trigger). Dados pela RPC
  `cs_ficha_mentorado(email)` e, na lista, `cs_mentorados_resumo()` (pílulas e filtro "dados da ficha"; junções em
  conjunto, ~0,07 s — não volte a fazer uma busca por mentorado). Ambas `security invoker`. `livros_envios` sai sem CPF.
  **Anotações** (`cs_mentorado_notas`): trigger `app.cs_mentorado_notas_guarda` fixa `autor_id`/`autor_nome`/`created_at`
  (o cliente não consegue assinar como outra pessoa nem mudar autor/pessoa ao editar); editar/excluir só o autor ou ADM;
  DESFAZER (escopo `cs/mentorados`) reinsere com o mesmo id e o trigger restaura autor e data da cópia em
  `os_desfazer_snapshots` (só para o próprio autor ou ADM). **Integrações futuras** (Clint, Zoom/presença, Cademí,
  Hotmart): gravar em `cs_mentorado_eventos` (service_role; `(fonte, chave_externa)` único; `mentorado_email` e/ou
  `email`/`telefone`) que a linha do tempo já mostra. Ao conectar ferramenta nova com dados de alunos, perguntar à Tia
  se quer integrar à ficha.
  **Clint (CRM + WhatsApp)** (SQL `scripts/migrations/20261017_cs_clint.sql` e `20261017_cs_clint_mcp.sql`): os dados vêm do
  **conector MCP "clint" do Claude** (decisão da Tia, 17/10/2026: sem API com token, que exige plano Elite), pela tarefa
  agendada local **`sync-clint-ficha-os`** (~/.claude/scheduled-tasks, todo dia 7h40; só roda com o app do Claude aberto).
  Ela faz consultas em massa (`execute_indicator_query`) filtradas pelos e-mails da Lista de Mentorados + vínculos:
  carga completa de 60 mentorados por dia (os nunca buscados/mais antigos) + tudo que mudou desde a última execução
  (`Deal.updatedAt`, `Contact.updatedAt`, `Chat.lastMessageAt`). Grava pela RPC `cs_clint_carregar(tipo, tsv)` (security
  definer, só service_role; texto com uma linha por registro e campos por TAB; ignora quem não é mentorado; junta por id;
  refaz os marcos `cs_mentorado_eventos` fonte `clint`: negócio criado/ganho/perdido, compra, conversa). Cache `cs_clint`:
  contatos (tags), negócios (funil, etapa, status, datas, valor, fonte, motivo de perda, `compra` do checkout: produto,
  status, pagamento, parcelas, valor, data — **sem CPF/endereço/códigos de pagamento**), conversas (canal, atendente,
  status, última mensagem, sem resposta; o texto das mensagens fica nos Docs do relatório diário de WhatsApp). Membros do
  cubo que quebram a consulta: `Deal.lostStatus` e `DealUser.*` (use `DealLostStatus.name`; dono do negócio não vem).
  A Edge Function `clint-sync` (API REST + segredo `CLINT_API_TOKEN`) continua publicada só como alternativa, sem cron.
- **Testes de Nivelamento** (`#/cs/nivelamento`, `NivelamentoPage`; SQL `scripts/migrations/20261017_cs_nivelamento.sql`):
  cache somente leitura `cs_nivelamento` da planilha `1YhlAuX3PqsJ1o0StPPe8GW4zEXsJjYqBY7yjSZhETO8`, SÓ a aba **Novo**
  (respostas do teste da Mentoria avaliadas pela IA da Edge Function pública `nivelamento`). Edge Function
  `nivelamento-sheet` (verify_jwt=false; mesmo molde da `teste-vac-sheet`): ao abrir a aba (>5 min), botão Atualizar e
  cron `os-nivelamento-planilha-30min`. O cabeçalho da aba Novo tem 21 colunas vazias no meio (títulos deslocados): a
  função alinha os títulos não vazios com a largura dos dados. "Na Lista de Mentorados" = e-mail/WhatsApp em `cs_mentorados`.
  Trilha = número de "Trilha indicada" (`SPRINT → Trilha 2 · Básico II` → 2). Mesmo layout do Teste VAC (cards por trilha,
  média por área, área mais fraca, autoavaliação, filtros, CSV).
- **Pesquisas de Alunos** (`#/cs/pesquisas` + `#/cs/pesquisas/mentorados|outros`; SQL
  `scripts/migrations/20261017_cs_pesquisa_respostas.sql`): **Mentorados** = `mentoria-fluent-mind` + `pnl-mentoria`;
  **Outros** = `metodo-tia-do-ingles`, `decole-com-a-tia`, `memorizacao` + `pnl-metodo` (`PESQ_GRUPOS` em `app.js`).
  Respostas individuais em `cs_pesquisa_respostas` (`dados` = `[{p, r}]` na ordem da planilha); `pesquisa_avatar` segue
  com totais e o resumo da IA (cards no fim do detalhe). Edge Function `pesquisas-respostas`: sync (mesmas fontes da op
  `pesquisas` da `sync`; ao abrir a aba >10 min, botão e cron `os-pesquisas-respostas-30min` aos 15/45 min) e op
  `perguntar` (IA com contagens exatas das perguntas de múltipla escolha + amostra das abertas; respeita a pausa de IA;
  custo em `ai_usage_log`, origem `pesquisas:perguntar`; teto de R$ 5/dia somando todas as contas, `TETO_DIA_BRL` na função). Tela inicial usa a RPC `cs_pesquisa_painel` (security invoker,
  sem baixar respostas); o detalhe baixa o grupo em páginas de 1000 (limite do PostgREST). Pergunta de múltipla escolha
  (pizza/filtro): ≤15 respostas distintas, média ≤80 caracteres e (≤6 distintas ou ≤1/3 das respostas) — regra repetida
  em `ehCategoricaPesq` (app.js), `ehCategorica` (Edge Function) e na RPC; mantenha as três iguais.
  `sanitizeHtml` (usado por `Markdown`/`mdToHtml`) remove svg/math, atributos com `:` (xlink), `style`, `formaction`,
  `srcdoc` e URLs que não sejam http(s)/mailto/tel/âncora/relativas: a resposta da IA vem de texto de formulário público.
  **Subrotas**: item do `NAV` com `subrotas: [...]` libera `#/<aba>/<item>/<subrota>` em `rotaPermitida` (só as listadas).
  Teste de RLS das duas tabelas: `scripts/migrations/teste_rls_cs_nivelamento_pesquisas.sql`.
- **LinkedIn da Tia** (`#/conteudo/linkedin`, `LinkedinPage`/`LinkedinCard`): fila de posts em
  `public.linkedin_posts` (RLS: aba `conteudo` via `app.tem_area`; SQL em
  `scripts/migrations/20261014_linkedin_*.sql`). Ações da Edge Function `ai` (arquivo
  `linkedin.ts` dentro da função): `linkedin_semana` (gera os rascunhos da grade a partir do
  guia `kb_documents.chave_externa='linkedin:guia-editorial'` + `conteudo_insights` + últimos
  posts; só preenche horários vazios) e `linkedin_reescrever` (devolve texto, não grava); as
  duas exigem a aba Conteúdo. Formatos história/case/depoimento (`formato` contendo "história",
  "case" ou "depoimento") seguem a estrutura de roteiro do guia (v2, seção 4.1) e vão de 1.500 a
  2.500 caracteres; os demais, 900 a 1.500 — regra duplicada em `ehFormatoRoteiro`/`faixaTamanho`
  (`linkedin.ts`) e `liFaixaTamanho` (`app.js`), mantenha as duas iguais. Horários em America/Sao_Paulo (UTC-03:00).
- **LinkedIn Fase 3 (publicação automática)** — SQL em `scripts/migrations/20261015_linkedin_publicacao_api.sql`.
  Post `aprovado` é publicado sozinho no perfil pessoal quando chega o `agendado_para` (até 24 h de atraso;
  mais que isso fica parado e a aba pede nova data). Edge Function `linkedin` (`verify_jwt=false`, valida
  por op): `GET /functions/v1/linkedin/callback` (redirect do OAuth, state de uso único 10 min),
  `auth_url`/`status` (aba Conteúdo), `desconectar` (ADM), `publicar_pendentes` (header `x-cron-token`,
  cron `linkedin-publicar` */5 min; o token fica só em `app.linkedin_config`, nunca no repo). Segredos
  `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET`; sem eles tudo degrada com "LinkedIn não configurado".
  Token OAuth em `app.linkedin_conexao` (schema não exposto, sem grant, RLS sem política), lido só pelas
  RPCs `linkedin_svc_*` (execute só service_role); o front usa `linkedin_conexao_status()` (aba Conteúdo,
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
  sessão de quem aprovou + .zip via JSZip) → `pronto`. `pendente`/`processando` são legado.
  **Formulário (pedido da Tia, 16/10/2026)**: só Tema (campo único `TemaArenaCombo`: digita livre ou, ao clicar, lista suspensa dos 30 de `ARENA_TEMAS` por categoria, filtrada pelo texto;
  os já usados aparecem marcados), Nível (RC e/ou BIA; 1 material por nível, `quantidade=1`) e Observações extras
  (opcional, `briefing.observacoes`). Narrador/tom/objetivo etc. saíram: o narrador do RC roda sozinho no `arena.ts`
  e pedidos antigos com esses campos continuam abrindo. **Prévia**: Aprovar / Reprovar / campo de feedback livre
  ("Enviar feedback e gerar nova versão" = `arena_ajustar`). Reprovar (`ModalReprovarArena`): "Gerar outra versão do
  zero" (motivo opcional + variação da versão reprovada vão para `briefing.observacoes`, motivo também em
  `briefing.reprovacoes` e em `ajustes` com `escopo:"reprovacao"`; DESFAZER só depois da geração) ou "Descartar o
  pedido". **Aviso de skill**: ao aprovar, se `ajustes.length > briefing.skill_respondido_ate`, abre já no início
  (PDFs seguem em paralelo) o modal "Atualizar a skill com as novas informações?" (`ModalRegrasArena`): Sim →
  `arena_regras_sugerir` → a Tia revisa → `public.arena_regras` (origem `aprendida`, `pendente_skill=true`; valem na
  próxima geração, e entram na skill tia-do-ingles-materials quando pedirem ao Claude); Não → só grava
  `skill_respondido_ate`. Pendência: `arena_regras_sugerir` ainda lê todos os ajustes do pedido (pode repropor regra
  já criada numa 2ª aprovação); o modal já mostra só as correções novas.
  Ações `arena_*` (arquivo `arena.ts` da função `ai`): exigem a aba Pedagógico, respeitam a pausa (`automacao_estado`),
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
- **RLS**: toda tabela do OS tem `select`/escrita `to authenticated` com `app.tem_area('<aba>')` (a aba da tela que
  usa a tabela) ou `app.is_admin()` (configuração/transversal). Nunca para o role público/anon. Os helpers antigos
  (`is_editor`, `is_cs`, `is_cs_or_editor`, `is_editor_estrutura`) estão dormentes: não use.
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
  por aba, só na memória da sessão, só para quem pode gravar naquela rota: `podeEscreverRota`). A tela recarrega com
  `useAoDesfazer(escopo, fn)`. Conflito (registro mudou depois) pede confirmação.
  Tabela com campos protegidos por trigger (ex. `cs_metas`, `cs_diagnosticos`)
  restaura por RPC `security definer` restrita à aba CS (`os_restaurar_cs_metas`,
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

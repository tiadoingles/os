# Gestão de Tarefas — especificação

Pedido da Tia (04/11/2026): uma aba própria no OS que reúna o melhor de Asana, ClickUp, Notion e Monday para os
setores da empresa, com integração ao Google Chat, substituindo o ClickUp. Maestro: `maestro-tarefas`.
Legenda: [C] confirmado pela Tia · [I] inferido · [D] decisão em aberto.

## 0. Arquitetura
- Rota `#/tarefas/<tela>` (`minhas`, `quadro`, `lista`, `configuracoes`), link de topo "Gestão de Tarefas" no `Shell`
  (seção Visão geral), **visível para todo usuário logado** [C]. Não é área de `NAV`/`profiles.areas`:
  `rotaPermitida` libera `tarefas` para todos e o banco decide o que cada um vê.
- Front em `tarefas/` (módulo ES, dependências por `configurarTarefas()` no fim do `app.js`; cada arquivo tem linha
  no importmap com o mesmo `?v=N`): `comum.js` (dados, escrita com DESFAZER, componentes), `index.js` (mapa
  `TELAS_TAR`), `minhas.js`, `quadro.js`, `lista.js`, `detalhe.js` (painel lateral), `configuracoes.js`.
- DESFAZER: um escopo só, `tarefas`. Exclusão de tarefa pela tela = `excluida_em` (lógica).
- Largura: `max-w-[1500px]` (quadro precisa de espaço).

## 1. Banco (`scripts/migrations/20261104_tarefas_base.sql`, aplicada como `tarefas_base`)
Tabelas: `tarefas_setores` (6 iniciais: Gestão, Comercial, CS / Suporte, Pedagógico, Conteúdo, Financeiro),
`tarefas_setor_membros` (papel membro/gestor), `tarefas_projetos`, `tarefas_status` (4 padrão por projeto, tipo
aberto/andamento/concluido), `tarefas` (subtarefa = `parent_id`), `tarefas_participantes`, `tarefas_checklist`,
`tarefas_comentarios` (`mencoes uuid[]`), `tarefas_links`. Todas com `set_updated_at` e `zz_os_atividade`.

Regras de acesso [C]:
- Ver: membro do setor da tarefa, ou envolvido (criador, responsável, participante — também da tarefa-mãe), ou ADM.
- Alterar tarefa, checklist, links e participantes: só envolvido (ou ADM). Comentar: quem vê.
- "Seguir" (inserir a si mesmo como participante) é livre para quem vê, e torna a pessoa envolvida [I, aceito no QA].
- Setores e membros: só ADM. Projetos e status: ADM ou gestor do setor. Nome/cor de setor: todo logado lê.
- Gatilhos: setor da tarefa = setor do projeto; subtarefa herda o projeto da mãe e acompanha quando a mãe muda;
  projeto que muda de setor (só ADM) leva as tarefas; `concluida_em` segue o tipo do status; `criado_por` e autor
  de comentário não são falsificáveis (ADM mantém, para o DESFAZER).
- RPC `tarefas_pessoas()`: id/nome/email de quem tem login (seletores de responsável).
- Teste: `scripts/migrations/teste_rls_tarefas.sql` (24 verificações, 04/11/2026: todas OK).

## 2. Telas (Fase 1)
- **Minhas tarefas**: responsável ou participante, de todos os setores; grupos Atrasadas / Hoje / Próximos 7 dias /
  Mais adiante / Sem prazo; contadores; concluídas recentes.
- **Quadro**: por projeto; colunas = status; arrastar muda status/ordem; "+ Adicionar tarefa" no pé da coluna;
  filtro "Só as minhas".
- **Lista**: por setor (todos os projetos ou um), busca, filtros (situação, responsável, prioridade), ordenação,
  adicionar rápido por projeto.
- **Painel da tarefa**: título, status, responsável, prazo, início, prioridade, projeto, etiquetas, descrição em
  Markdown, subtarefas, checklist com barra, links (Drive/Canva), participantes, comentários com @menção.
- **Configurações**: projetos e colunas (gestor/ADM); setores, pessoas e espaço do Google Chat (ADM).

## 3. Próximas fases
- Fase 2: calendário, linha do tempo, painel do setor, recorrência (pg_cron), modelos de projeto, dependências,
  visões salvas, ações em massa, páginas do projeto (Notion), upload de anexos (bucket privado).
- Fase 3: Google Chat — Edge Function `tarefas-gchat`, fila `tarefas_notificacoes`, avisos no espaço do setor e
  mensagem direta, resumo diário 08h, comando `/tarefa`. Depende da Tia: app do Chat no Google Cloud, secret
  `GOOGLE_CHAT_SA_KEY`, instalação do app pelo Admin do Workspace, espaços por setor.
- Fase 4: importação do ClickUp (conector MCP; `clickup_id` evita duplicar; prévia antes de gravar).
- Fase 5: automações "quando X, então Y".

## 4. Decisões em aberto
- [D] Lista "pessoa → setor(es)" e quem é gestor de cada setor (a Tia cria as contas individuais em Acessos).
- [D] Se "Seguir" deve continuar dando poder de edição (hoje sim) ou virar só "receber avisos".

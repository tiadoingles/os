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

## 2b. Fase 2 (04/11/2026, migration `20261104c_tarefas_fase2.sql`, teste `teste_rls_tarefas_fase2.sql` 32/32)
- **Avisos dentro do OS**: `tarefas_notificacoes` (gerada só por gatilhos; cada um lê/marca/apaga os próprios; coluna
  `enviado_chat_em` reservada para a Fase 3). Tipos: atribuída, menção, comentário, concluída, prazo hoje, atrasada
  (cron `tarefas-avisos-prazo` 08h de Brasília), pedido ao setor, incluído como participante. Só recebe quem pode abrir a
  tarefa (`app.tarefas_pode_ver_por`). Sino no topo do OS (`SinoTarefas`), aba **Avisos**, cartão na Início.
- **Pedidos entre setores**: cada setor tem o projeto **Solicitações** (`aceita_solicitacoes`, só o ADM liga); qualquer
  logado abre tarefa ali e vê só as que abriu; gestores do setor (ou todos os membros, se não houver gestor) são avisados.
- **Seguir só avisa**: `tarefas_participantes.papel` = `colaborador` (altera) | `seguidor` (só avisos). Só quem já está
  envolvido inclui colaboradores.
- **Recorrência** (`recorrencia` = {freq: diaria|dias_uteis|semanal|mensal, intervalo}): ao concluir nasce a próxima
  (checklist desmarcado, mesmos colaboradores); reabrir/DESFAZER apaga a próxima se ninguém mexeu nela.
- **Modelos de projeto** (`tarefas_modelos`, RPC `tarefas_aplicar_modelo`): 3 rascunhos iniciais (Fluxo semanal da aula,
  Onboarding de mentorado, Lançamento) para a Tia ajustar; ao criar projeto, escolhe-se o modelo e a data de início.
- **Dependências** (`tarefas_dependencias`, sem ciclos), selo "Bloqueada" nos cartões.
- **Anexos**: bucket privado `tarefas-anexos`, caminho `<tarefa_id>/...`, até 50 MB; ver = quem vê a tarefa.
- **Etiquetas por setor** (`tarefas_setores.etiquetas`, o gestor edita só isso), **mentorada** (`mentorado_email`, aparece
  na Ficha do Mentorado em "Tarefas da equipe"), **3 prioridades** (alta, normal, baixa), campo Início em "Mais campos".
- Telas novas: Avisos, Calendário (arrastar muda o prazo), Painel do setor, Lixeira (restaurar); Quadro com todos os
  projetos do setor; botão "+ Tarefa" no topo de qualquer tela. Equipe sem aba entra direto em Minhas tarefas.

## 2c. Ajustes de 04/11/2026 (migration `20261104d_tarefas_hora_historico_repeticao.sql`, teste `teste_rls_tarefas_hora_historico.sql` 13/13)
- **Horário limite** (`tarefas.prazo_hora`): opcional, junto do prazo; "Atrasada (hoje às HH:MM)" quando passa. Cron
  `tarefas-avisos-prazo` de hora em hora (minuto 5): atraso no mesmo dia sai na hora; "vence hoje" e atrasos antigos a partir das 8h.
- **Histórico** (`#/tarefas/historico`): concluídas com dono (responsável), quem concluiu (`concluida_por`) e quando
  (`concluida_em`), no prazo ou atrasada, filtros e CSV. Quem/quando gravados pelo banco (não-ADM não forja); reabrir limpa.
- **Repetição**: Não repetir / Diário / Semanal / Mensal / Personalizado (a cada N dias, dias úteis, semanas ou meses;
  dias da semana; termina em). CHECK via `app.tarefas_recorrencia_valida` (precisa de grant para authenticated).

## 3. Próximas fases
- Ainda não feito: linha do tempo (Gantt), visões salvas, ações em massa.
- Fase 3: Google Chat — Edge Function `tarefas-gchat`, fila `tarefas_notificacoes`, avisos no espaço do setor e
  mensagem direta, resumo diário 08h, comando `/tarefa`. Depende da Tia: app do Chat no Google Cloud, secret
  `GOOGLE_CHAT_SA_KEY`, instalação do app pelo Admin do Workspace, espaços por setor.
- Fase 4: importação do ClickUp (conector MCP; `clickup_id` evita duplicar; prévia antes de gravar).
- Fase 5: automações "quando X, então Y".

## 4. Decisões em aberto
- [D] Lista "pessoa → setor(es)" e quem é gestor de cada setor (a Tia cria as contas individuais em Acessos).

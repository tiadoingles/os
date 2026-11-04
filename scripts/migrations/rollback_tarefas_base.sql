-- Reverte 20261104_tarefas_base.sql (APAGA todas as tarefas). Só rodar com autorização da Tia.
drop function if exists public.tarefas_pessoas();
drop table if exists public.tarefas_links, public.tarefas_comentarios, public.tarefas_checklist,
  public.tarefas_participantes, public.tarefas, public.tarefas_status, public.tarefas_projetos,
  public.tarefas_setor_membros, public.tarefas_setores cascade;
drop function if exists app.tarefa_pode_ver(uuid), app.tarefa_envolvido(uuid), app.tarefas_gestor(uuid),
  app.tarefas_membro(uuid), app.tarefas_projeto_status_padrao(), app.tarefas_preparar(),
  app.tarefas_guarda_projeto(), app.tarefas_comentario_guarda(),
  app.tarefas_propagar_filhas(), app.tarefas_projeto_mudou_setor(), app.tarefas_status_guarda(),
  app.tarefas_meus_setores(), app.tarefas_minhas(), app.tarefas_meus_projetos();

-- Ficha do Mentorado · Clint via conector MCP (decisão da Tia, 17/10/2026: usar o conector "clint" que já roda aqui
-- no Claude, como o relatório diário de WhatsApp, em vez da API REST com token, que exige plano Elite).
-- Quem busca os dados é a tarefa agendada local "sync-clint-ficha-os" (~/.claude/scheduled-tasks), com consultas em massa
-- (execute_indicator_query) filtradas pelos e-mails da Lista de Mentorados. Ela grava por esta função, em texto
-- compacto (uma linha por registro, campos separados por TAB), para não ter de reescrever JSON grande.
--   p_tipo 'contatos':  email, contato_id, nome, telefone, tags, criado_em
--   p_tipo 'negocios':  email, negocio_id, funil, etapa, status, criado_em, ganho_em, perdido_em, etapa_desde,
--                       valor_centavos, fonte, arquivado, motivo_perda, produto, compra_status, pagamento, parcelas,
--                       valor_compra, compra_em, assinatura
--   p_tipo 'conversas': email, conversa_id, canal, atendente, status, aberta_em, ultima_msg, sem_resposta
-- email = e-mail da ficha (Lista de Mentorados) ou um e-mail vinculado (cs_mentorado_vinculos); linhas de quem não é
-- mentorado são ignoradas. Datas "1970-01-01..." e campos vazios viram null. Registros entram por id (os anteriores
-- da mesma pessoa ficam; o mesmo id é substituído). Depois a função refaz os marcos da linha do tempo
-- (cs_mentorado_eventos, fonte 'clint') de quem foi tocado. Execute só para postgres/service_role (o MCP do Supabase).
-- A Edge Function clint-sync (API com token) continua publicada, mas o cron dela foi desligado.

select cron.unschedule('os-clint-30min') where exists (select 1 from cron.job where jobname = 'os-clint-30min');

create or replace function app.clint_txt(p text)
returns text language sql immutable set search_path = public as $$
  select case when p is null or btrim(p) = '' or p like '1970-01-01%' then null else btrim(p) end;
$$;

create or replace function public.cs_clint_carregar(p_tipo text, p_tsv text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  linha text; campos text[]; chave text; obj jsonb; qtd int := 0; ignorados int := 0;
  tocados text[] := '{}'; e text;
begin
  if p_tipo not in ('contatos', 'negocios', 'conversas') then raise exception 'tipo inválido: %', p_tipo; end if;
  for linha in select x from regexp_split_to_table(coalesce(p_tsv, ''), '\r?\n') x loop
    if btrim(linha) = '' then continue; end if;
    campos := string_to_array(linha, E'\t');
    e := lower(btrim(campos[1]));
    -- chave da ficha: e-mail da Lista de Mentorados ou dono do vínculo
    select lower(btrim(m.email)) into chave from public.cs_mentorados m where lower(btrim(m.email)) = e limit 1;
    if chave is null then
      select v.mentorado_email into chave from public.cs_mentorado_vinculos v where v.tipo = 'email' and v.valor = e limit 1;
    end if;
    if chave is null then ignorados := ignorados + 1; continue; end if;

    if p_tipo = 'contatos' then
      obj := jsonb_build_object('id', app.clint_txt(campos[2]), 'name', app.clint_txt(campos[3]), 'phone', app.clint_txt(campos[4]), 'email', e,
        'tags', coalesce(to_jsonb(array(select btrim(t) from unnest(string_to_array(coalesce(campos[5], ''), ',')) t where btrim(t) <> '')), '[]'::jsonb),
        'created_at', app.clint_txt(campos[6]));
    elsif p_tipo = 'negocios' then
      obj := jsonb_strip_nulls(jsonb_build_object('id', app.clint_txt(campos[2]), 'origem', app.clint_txt(campos[3]), 'etapa', app.clint_txt(campos[4]),
        'status', upper(app.clint_txt(campos[5])), 'created_at', app.clint_txt(campos[6]), 'won_at', app.clint_txt(campos[7]), 'lost_at', app.clint_txt(campos[8]),
        'updated_stage_at', app.clint_txt(campos[9]),
        'valor', case when app.clint_txt(campos[10]) ~ '^\d+$' and campos[10]::bigint > 0 then round(campos[10]::numeric / 100, 2) end,
        'fonte', app.clint_txt(campos[11]), 'arquivado', app.clint_txt(campos[12]) = 'Sim', 'motivo_perda', app.clint_txt(campos[13]),
        'compra', case when app.clint_txt(campos[14]) is not null then jsonb_strip_nulls(jsonb_build_object(
          'produto', app.clint_txt(campos[14]), 'status', app.clint_txt(campos[15]), 'pagamento', app.clint_txt(campos[16]),
          'parcelas', app.clint_txt(campos[17]), 'valor', app.clint_txt(campos[18]), 'data', app.clint_txt(campos[19]), 'assinatura', app.clint_txt(campos[20]))) end));
    else
      obj := jsonb_strip_nulls(jsonb_build_object('id', app.clint_txt(campos[2]), 'canal', app.clint_txt(campos[3]), 'dono', app.clint_txt(campos[4]),
        'status', app.clint_txt(campos[5]), 'created_at', app.clint_txt(campos[6]), 'last_message_at', app.clint_txt(campos[7]),
        'unread', app.clint_txt(campos[8]) = 'Sim'));
    end if;
    if obj->>'id' is null then ignorados := ignorados + 1; continue; end if;

    insert into public.cs_clint (mentorado_email) values (chave) on conflict (mentorado_email) do nothing;
    if p_tipo = 'contatos' then
      update public.cs_clint set contatos = coalesce((select jsonb_agg(x) from jsonb_array_elements(contatos) x where x->>'id' <> obj->>'id'), '[]'::jsonb) || jsonb_build_array(obj)
        where mentorado_email = chave;
    elsif p_tipo = 'negocios' then
      update public.cs_clint set negocios = coalesce((select jsonb_agg(x) from jsonb_array_elements(negocios) x where x->>'id' <> obj->>'id'), '[]'::jsonb) || jsonb_build_array(obj)
        where mentorado_email = chave;
    else
      update public.cs_clint set conversas = coalesce((select jsonb_agg(x) from jsonb_array_elements(conversas) x where x->>'id' <> obj->>'id'), '[]'::jsonb) || jsonb_build_array(obj)
        where mentorado_email = chave;
    end if;
    if not (chave = any(tocados)) then tocados := tocados || chave; end if;
    qtd := qtd + 1;
  end loop;

  -- ordena, marca encontrado e refaz os marcos da linha do tempo de quem foi tocado
  update public.cs_clint set
    encontrado = jsonb_array_length(contatos) > 0 or jsonb_array_length(negocios) > 0 or jsonb_array_length(conversas) > 0,
    negocios = coalesce((select jsonb_agg(x order by x->>'created_at' desc nulls last) from jsonb_array_elements(negocios) x), '[]'::jsonb),
    conversas = coalesce((select jsonb_agg(x order by x->>'last_message_at' desc nulls last) from jsonb_array_elements(conversas) x), '[]'::jsonb),
    erro = null, sincronizado_em = now()
  where mentorado_email = any(tocados);

  delete from public.cs_mentorado_eventos where fonte = 'clint' and mentorado_email = any(tocados);
  insert into public.cs_mentorado_eventos (mentorado_email, email, fonte, tipo, ocorrido_em, titulo, dados, chave_externa)
  select k.mentorado_email, k.mentorado_email, 'clint', v.tipo, v.quando::timestamptz, v.titulo, v.dados, k.mentorado_email || ':' || v.chave
  from public.cs_clint k
  cross join lateral (
    select 'negocio' tipo, n->>'created_at' quando, 'Negócio criado no Clint: ' || concat_ws(' › ', n->>'origem', n->>'etapa') titulo, n dados, 'deal:' || (n->>'id') || ':criado' chave
      from jsonb_array_elements(k.negocios) n where n->>'created_at' is not null
    union all
    select 'negocio', n->>'won_at', 'Negócio ganho no Clint: ' || concat_ws(' › ', n->>'origem', n->>'etapa'), n, 'deal:' || (n->>'id') || ':ganho'
      from jsonb_array_elements(k.negocios) n where n->>'won_at' is not null
    union all
    select 'negocio', n->>'lost_at', 'Negócio perdido no Clint: ' || concat_ws(' › ', n->>'origem', n->>'etapa') || coalesce(' (' || (n->>'motivo_perda') || ')', ''), n, 'deal:' || (n->>'id') || ':perdido'
      from jsonb_array_elements(k.negocios) n where n->>'lost_at' is not null
    union all
    select 'compra', n->>'created_at', 'Compra: ' || (n->'compra'->>'produto') || coalesce(' · ' || (n->'compra'->>'status'), ''), n->'compra', 'deal:' || (n->>'id') || ':compra'
      from jsonb_array_elements(k.negocios) n where n->'compra'->>'produto' is not null
    union all
    select 'conversa', c->>'last_message_at', 'Conversa no WhatsApp' || coalesce(' (' || (c->>'canal') || ')', '') || coalesce(' com ' || (c->>'dono'), ''), c, 'chat:' || (c->>'id')
      from jsonb_array_elements(k.conversas) c where c->>'last_message_at' is not null
  ) v
  where k.mentorado_email = any(tocados)
  on conflict (fonte, chave_externa) do update set ocorrido_em = excluded.ocorrido_em, titulo = excluded.titulo, dados = excluded.dados, sincronizado_em = now();

  return jsonb_build_object('linhas', qtd, 'ignorados', ignorados, 'mentorados', cardinality(tocados));
end $$;

revoke all on function public.cs_clint_carregar(text, text) from public, anon, authenticated;
grant execute on function public.cs_clint_carregar(text, text) to service_role;

-- Status no OS (Administração > Sincronizações): a tarefa local grava aqui no fim de cada execução.
update public.sync_status set nome = 'Clint — CRM e WhatsApp dos mentorados (tarefa diária no Claude)', tipo = 'local', cadencia_horas = 24
where chave = 'clint';

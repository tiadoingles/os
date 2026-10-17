-- Teste de RLS da Ficha do Mentorado (migration 20261017_cs_ficha_mentorado). Mesmo esquema do
-- teste_rls_areas.sql: transação implícita que termina em RAISE EXCEPTION (rollback; a mensagem traz os
-- resultados). NÃO colocar BEGIN/COMMIT. Usuários fictícios sem senha.
-- Esperado: {cs} lê a ficha, cria nota (autor = ele, mesmo tentando outro autor), edita/exclui só as próprias;
-- ADM edita/exclui qualquer uma; DESFAZER (reinserir com o mesmo id) volta com autor e data originais só
-- para o próprio autor ou ADM; vínculos validados; eventos só leitura; {conteudo}, sem aba e anon nada.
-- Depois conferir: select count(*) from auth.users where email like 'zz-%'; => 0
insert into auth.users (instance_id,id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated','authenticated', e, now(), now(), now(), '{}'::jsonb, '{}'::jsonb
from (values ('aaaaaaaa-0000-0000-0000-0000000000a1'::uuid,'zz-admin@invalid.test'),('aaaaaaaa-0000-0000-0000-0000000000c5'::uuid,'zz-cs@invalid.test'),
 ('aaaaaaaa-0000-0000-0000-0000000000c6'::uuid,'zz-cs2@invalid.test'),('aaaaaaaa-0000-0000-0000-0000000000d1'::uuid,'zz-conteudo@invalid.test'),
 ('aaaaaaaa-0000-0000-0000-0000000000b1'::uuid,'zz-semaba@invalid.test')) v(id,e);
update public.profiles set role='admin', areas='{}', nome='ZZ Admin' where id='aaaaaaaa-0000-0000-0000-0000000000a1';
update public.profiles set role='equipe', areas='{cs}', nome='ZZ CS Um' where id='aaaaaaaa-0000-0000-0000-0000000000c5';
update public.profiles set role='equipe', areas='{cs}', nome='ZZ CS Dois' where id='aaaaaaaa-0000-0000-0000-0000000000c6';
update public.profiles set role='equipe', areas='{conteudo}' where id='aaaaaaaa-0000-0000-0000-0000000000d1';
update public.profiles set role='equipe', areas='{}' where id='aaaaaaaa-0000-0000-0000-0000000000b1';
create table public.t_res(n serial, caso text, resultado text);
grant all on public.t_res to authenticated, anon; grant usage on sequence public.t_res_n_seq to authenticated, anon;
create function public.t_run(p_user uuid, p_caso text, p_sql text, p_mode text default 'dml') returns void language plpgsql as $f$
declare n bigint; r text; t text;
begin
  perform set_config('request.jwt.claims', case when p_user is null then '{"role":"anon"}' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text,''), true);
  execute case when p_user is null then 'set local role anon' else 'set local role authenticated' end;
  begin
    if p_mode = 'val' then execute p_sql into n; r := 'val=' || coalesce(n::text,'null');
    elsif p_mode = 'txt' then execute p_sql into t; r := 'txt=' || coalesce(t,'null');
    else execute p_sql; get diagnostics n = row_count; r := 'rows=' || n; end if;
  exception when others then r := 'ERRO[' || sqlstate || '] ' || left(sqlerrm, 60);
  end;
  reset role;
  insert into public.t_res(caso, resultado) values (p_caso, r);
end $f$;
do $t$
declare
  ad uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1'; cs uuid := 'aaaaaaaa-0000-0000-0000-0000000000c5';
  cs2 uuid := 'aaaaaaaa-0000-0000-0000-0000000000c6'; ct uuid := 'aaaaaaaa-0000-0000-0000-0000000000d1';
  sa uuid := 'aaaaaaaa-0000-0000-0000-0000000000b1';
  em text := (select lower(trim(email)) from public.cs_mentorados order by linha limit 1);
  n1 uuid := 'f0000000-0000-0000-0000-000000000001'; n2 uuid := 'f0000000-0000-0000-0000-000000000002';
  u record;
begin
  -- Ficha e resumo
  perform t_run(cs, 'cs ficha traz o mentorado', format($q$select (public.cs_ficha_mentorado(%L)->>'mentorado' is not null)::int$q$, em), 'val');
  perform t_run(cs, 'cs resumo (itens)', $q$select jsonb_array_length(public.cs_mentorados_resumo())$q$, 'val');
  -- Notas: autor travado
  perform t_run(cs, 'cs cria nota tentando assinar como admin', format($q$insert into public.cs_mentorado_notas(id,mentorado_email,texto,autor_id,autor_nome,created_at) values (%L,%L,'zz nota',%L,'Falso','2020-01-01')$q$, n1, upper(em), ad));
  perform t_run(cs, 'nota: autor gravado (esperado ZZ CS Um)', format($q$select autor_nome from public.cs_mentorado_notas where id=%L$q$, n1), 'txt');
  perform t_run(cs, 'nota: data não é 2020', format($q$select (created_at > now() - interval '1 minute')::int from public.cs_mentorado_notas where id=%L$q$, n1), 'val');
  perform t_run(cs, 'nota: e-mail normalizado', format($q$select (mentorado_email = %L)::int from public.cs_mentorado_notas where id=%L$q$, em, n1), 'val');
  perform t_run(cs, 'cs edita a própria nota', format($q$update public.cs_mentorado_notas set texto='zz editada', autor_nome='Outro' where id=%L$q$, n1));
  perform t_run(cs, 'nota: autor não mudou na edição', format($q$select autor_nome from public.cs_mentorado_notas where id=%L$q$, n1), 'txt');
  perform t_run(cs2, 'cs2 edita nota do cs (NEGADO: 0)', format($q$update public.cs_mentorado_notas set texto='x' where id=%L$q$, n1));
  perform t_run(cs2, 'cs2 exclui nota do cs (NEGADO: 0)', format($q$delete from public.cs_mentorado_notas where id=%L$q$, n1));
  perform t_run(cs2, 'cs2 lê a nota do cs', format($q$select count(*) from public.cs_mentorado_notas where id=%L$q$, n1), 'val');
  perform t_run(ad, 'admin edita nota do cs', format($q$update public.cs_mentorado_notas set texto='zz admin' where id=%L$q$, n1));
  -- DESFAZER da exclusão
  perform t_run(cs, 'cs exclui a própria nota', format($q$delete from public.cs_mentorado_notas where id=%L$q$, n1));
  perform t_run(cs, 'cs desfaz (reinsere mesmo id)', format($q$insert into public.cs_mentorado_notas(id,mentorado_email,texto) values (%L,%L,'zz admin')$q$, n1, em));
  perform t_run(cs, 'desfazer: autor original (ZZ CS Um)', format($q$select autor_nome from public.cs_mentorado_notas where id=%L$q$, n1), 'txt');
  perform t_run(cs, 'cs cria nota 2', format($q$insert into public.cs_mentorado_notas(id,mentorado_email,texto) values (%L,%L,'zz nota 2')$q$, n2, em));
  perform t_run(cs, 'cs exclui nota 2', format($q$delete from public.cs_mentorado_notas where id=%L$q$, n2));
  perform t_run(cs2, 'cs2 reinsere nota 2 do cs (vira autor cs2)', format($q$insert into public.cs_mentorado_notas(id,mentorado_email,texto) values (%L,%L,'zz nota 2')$q$, n2, em));
  perform t_run(cs2, 'nota 2: autor (esperado ZZ CS Dois)', format($q$select autor_nome from public.cs_mentorado_notas where id=%L$q$, n2), 'txt');
  perform t_run(ad, 'admin exclui nota do cs2', format($q$delete from public.cs_mentorado_notas where id=%L$q$, n2));
  perform t_run(cs, 'cs nota vazia (NEGADO)', format($q$insert into public.cs_mentorado_notas(mentorado_email,texto) values (%L,'   ')$q$, em));
  -- Vínculos
  perform t_run(cs, 'cs vincula e-mail', format($q$insert into public.cs_mentorado_vinculos(mentorado_email,tipo,valor) values (%L,'email',' ZZ-Outro@Invalid.Test ')$q$, em));
  perform t_run(cs, 'vínculo normalizado', $q$select valor from public.cs_mentorado_vinculos where valor like 'zz-outro%'$q$, 'txt');
  perform t_run(cs, 'cs vincula e-mail repetido (NEGADO)', format($q$insert into public.cs_mentorado_vinculos(mentorado_email,tipo,valor) values (%L,'email','zz-outro@invalid.test')$q$, em));
  perform t_run(cs, 'cs vincula e-mail inválido (NEGADO)', format($q$insert into public.cs_mentorado_vinculos(mentorado_email,tipo,valor) values (%L,'email','sem-arroba')$q$, em));
  perform t_run(cs, 'cs vincula telefone curto (NEGADO)', format($q$insert into public.cs_mentorado_vinculos(mentorado_email,tipo,valor) values (%L,'telefone','9999-1234')$q$, em));
  perform t_run(cs, 'cs vincula telefone (+55 normaliza)', format($q$insert into public.cs_mentorado_vinculos(mentorado_email,tipo,valor) values (%L,'telefone','+55 (11) 98888-7766')$q$, em));
  perform t_run(cs, 'ficha usa vínculos (chaves)', format($q$select jsonb_array_length(public.cs_ficha_mentorado(%L)->'chaves'->'emails')$q$, em), 'val');
  perform t_run(cs2, 'cs2 remove vínculo', $q$delete from public.cs_mentorado_vinculos where valor = 'zz-outro@invalid.test'$q$);
  -- Eventos: só leitura
  perform t_run(cs, 'cs grava evento (NEGADO)', format($q$insert into public.cs_mentorado_eventos(mentorado_email,fonte,tipo,titulo,chave_externa) values (%L,'zz','x','x','x')$q$, em));
  perform t_run(ad, 'admin grava evento (NEGADO)', format($q$insert into public.cs_mentorado_eventos(mentorado_email,fonte,tipo,titulo,chave_externa) values (%L,'zz','x','x','x')$q$, em));
  perform t_run(cs, 'cs lê eventos', $q$select count(*) from public.cs_mentorado_eventos$q$, 'val');
  -- Fora da aba CS
  for u in select * from (values ('conteudo', ct), ('sem aba', sa), ('anon', null::uuid)) x(nm, id) loop
    perform t_run(u.id, u.nm||' lê notas (0/negado)', 'select count(*) from public.cs_mentorado_notas', 'val');
    perform t_run(u.id, u.nm||' lê vínculos (0/negado)', 'select count(*) from public.cs_mentorado_vinculos', 'val');
    perform t_run(u.id, u.nm||' ficha: mentorado (null/negado)', format($q$select (public.cs_ficha_mentorado(%L)->>'mentorado' is not null)::int$q$, em), 'val');
    perform t_run(u.id, u.nm||' ficha: notas (0/negado)', format($q$select jsonb_array_length(public.cs_ficha_mentorado(%L)->'notas')$q$, em), 'val');
    perform t_run(u.id, u.nm||' cria nota (NEGADO)', format($q$insert into public.cs_mentorado_notas(mentorado_email,texto) values (%L,'zz')$q$, em));
    perform t_run(u.id, u.nm||' resumo (0/negado)', $q$select jsonb_array_length(public.cs_mentorados_resumo())$q$, 'val');
  end loop;
end $t$;
do $r$ begin raise exception E'RESULTADOS\n%', (select string_agg(caso||' => '||resultado, E'\n' order by n) from public.t_res); end $r$;

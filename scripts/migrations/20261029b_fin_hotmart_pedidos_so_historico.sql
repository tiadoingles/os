-- A fila foi trocada pela API oficial (Edge Function hotmart): fin_hotmart_pedidos vira só histórico,
-- gravado pela função com service role. O OS só lê.
drop policy if exists fin_hotmart_pedidos_ins on public.fin_hotmart_pedidos;
drop policy if exists fin_hotmart_pedidos_upd on public.fin_hotmart_pedidos;
revoke insert, update, delete on public.fin_hotmart_pedidos from authenticated;
drop function if exists public.fin_hotmart_pedir_sync();

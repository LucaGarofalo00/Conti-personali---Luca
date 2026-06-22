-- =============================================
-- FinanzApp - RPC riconciliazione saldi  [IDEMPOTENTE]
-- =============================================
-- recompute_fund_balances: ricalcola i saldi dei fondi dal registro (opening_balance + movimenti
--   reali), per riparare eventuali derive. Usata da src/lib/reconcile.ts.
-- set_fund_opening_balance: imposta il saldo "visibile" di un fondo e ricava l'opening_balance
--   coerente con i movimenti già registrati.
--
-- SICUREZZA: SECURITY INVOKER (default) → rispettano le RLS dei fondi. Hardening difensivo:
--  - operano SOLO sui fondi di auth.uid() (il parametro p_user_id è mantenuto per compatibilità
--    col client ma NON è autorevole), così reggono anche se rese SECURITY DEFINER in futuro;
--  - search_path fissato (anti name-hijack).
-- Esegui nell'SQL Editor di Supabase.

create or replace function public.recompute_fund_balances(p_user_id uuid default null)
returns void
language sql
set search_path = public, pg_temp
as $function$
  update public.funds f
  set balance = round(
    coalesce(f.opening_balance, 0) + coalesce((
      select sum(case
        when t.type = 'income'   and t.fund_id = f.id    then t.amount
        when t.type = 'expense'  and t.fund_id = f.id    then -t.amount
        when t.type = 'transfer' and t.fund_id = f.id    then -t.amount
        when t.type = 'transfer' and t.fund_to_id = f.id then t.amount
        else 0 end)
      from public.transactions t
      where t.user_id = f.user_id
        and t.is_memo = false and t.is_planned = false
        and (t.fund_id = f.id or t.fund_to_id = f.id)
    ), 0)
  , 2)
  where f.user_id = auth.uid();   -- autorevole: solo i propri fondi (ignora p_user_id)
$function$;

create or replace function public.set_fund_opening_balance(p_fund_id uuid, p_new_balance numeric)
returns void
language sql
set search_path = public, pg_temp
as $function$
  update public.funds f
  set opening_balance = round(
    p_new_balance - coalesce((
      select sum(case
        when t.type = 'income'   and t.fund_id = f.id    then t.amount
        when t.type = 'expense'  and t.fund_id = f.id    then -t.amount
        when t.type = 'transfer' and t.fund_id = f.id    then -t.amount
        when t.type = 'transfer' and t.fund_to_id = f.id then t.amount
        else 0 end)
      from public.transactions t
      where t.user_id = f.user_id
        and t.is_memo = false and t.is_planned = false
        and (t.fund_id = f.id or t.fund_to_id = f.id)
    ), 0)
  , 2),
  balance = p_new_balance
  where f.id = p_fund_id and f.user_id = auth.uid();   -- solo i propri fondi
$function$;

NOTIFY pgrst, 'reload schema';

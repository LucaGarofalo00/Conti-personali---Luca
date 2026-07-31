-- =============================================
-- FinanzApp - RPC post_transaction  [IDEMPOTENTE]
-- =============================================
-- Insert atomico di una transazione + aggiornamento del saldo del/i fondo/i, nella stessa
-- transazione DB. Usata da src/lib/postTransaction.ts.
--
-- PREREQUISITI: esegui PRIMA supabase-migration.sql e supabase-planned-budget.sql. Questa funzione
-- scrive anche planned_date, fuel_odometer e planned_parent_id: senza quelle colonne l'insert
-- fallisce. (planned_parent_id è la colonna che collega una spesa reale alla pianificata di cui fa
-- parte: se la funzione non la scrive, il "budget a progetto" registra la spesa ma perde il
-- collegamento, e il residuo della pianificata non cala mai.)
--
-- SICUREZZA: SECURITY INVOKER (default) → rispetta le RLS di transactions/funds.
--  - user_id della transazione = auth.uid() (NON si fida di un eventuale p_tx.user_id dal client).
--  - gli UPDATE dei saldi sono vincolati a user_id = auth.uid() (difesa in profondità oltre alle
--    RLS: reggono anche se la funzione venisse ricreata SECURITY DEFINER).
--  - search_path fissato (anti name-hijack).
-- Esegui nell'SQL Editor di Supabase.

create or replace function public.post_transaction(p_tx jsonb, p_apply_balance boolean default true)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_id uuid;
  v_type text := p_tx->>'type';
  v_amount numeric := (p_tx->>'amount')::numeric;
  v_fund uuid := nullif(p_tx->>'fund_id','')::uuid;
  v_fund_to uuid := nullif(p_tx->>'fund_to_id','')::uuid;
  v_is_memo boolean := coalesce((p_tx->>'is_memo')::boolean, false);
  v_is_planned boolean := coalesce((p_tx->>'is_planned')::boolean, false);
begin
  insert into public.transactions (
    user_id, type, amount, description, fund_id, fund_to_id, category,
    budget_id, recurring_expense_id, recurring_income_id, is_memo, is_planned,
    fuel_km, fuel_liters, fuel_price_per_liter, fuel_type, fuel_odometer, date, planned_date,
    planned_parent_id
  ) values (
    auth.uid(),                              -- identità SEMPRE da auth.uid(), mai dal client
    v_type,
    v_amount,
    coalesce(p_tx->>'description',''),
    v_fund,
    v_fund_to,
    coalesce(p_tx->>'category','altro'),
    nullif(p_tx->>'budget_id','')::uuid,
    nullif(p_tx->>'recurring_expense_id','')::uuid,
    nullif(p_tx->>'recurring_income_id','')::uuid,
    v_is_memo,
    v_is_planned,
    nullif(p_tx->>'fuel_km','')::numeric,
    nullif(p_tx->>'fuel_liters','')::numeric,
    nullif(p_tx->>'fuel_price_per_liter','')::numeric,
    nullif(p_tx->>'fuel_type',''),
    nullif(p_tx->>'fuel_odometer','')::numeric,
    coalesce((p_tx->>'date')::date, current_date),
    nullif(p_tx->>'planned_date','')::date,
    nullif(p_tx->>'planned_parent_id','')::uuid
  )
  returning id into v_id;

  -- Memo e pianificate non muovono i saldi.
  if p_apply_balance and not v_is_memo and not v_is_planned then
    if v_type = 'income' and v_fund is not null then
      update public.funds set balance = round(balance + v_amount, 2) where id = v_fund and user_id = auth.uid();
    elsif v_type = 'expense' and v_fund is not null then
      update public.funds set balance = round(balance - v_amount, 2) where id = v_fund and user_id = auth.uid();
    elsif v_type = 'transfer' then
      if v_fund is not null then update public.funds set balance = round(balance - v_amount, 2) where id = v_fund and user_id = auth.uid(); end if;
      if v_fund_to is not null then update public.funds set balance = round(balance + v_amount, 2) where id = v_fund_to and user_id = auth.uid(); end if;
    end if;
  end if;

  return v_id;
end;
$function$;

NOTIFY pgrst, 'reload schema';

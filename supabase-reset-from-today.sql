-- "Ricomincia da oggi" ATOMICO.
--
-- Perché: oggi il reset esegue 3 operazioni separate (upsert inizio periodo + delete movimenti
-- reali + delete pianificate passate). Non sono in transazione: se fallisce a metà si resta con
-- uno stato incoerente (periodo già spostato e storico già cancellato, ma operazione "fallita").
-- Questa funzione le racchiude in UNA sola transazione plpgsql: o tutto o niente.
--
-- Come usarla: esegui questo file nell'SQL Editor di Supabase.
-- Sicurezza: SECURITY INVOKER (default), quindi rispetta le RLS esistenti; in più controlla
-- esplicitamente che si stia resettando il PROPRIO account. NON usare SECURITY DEFINER.
--
-- Lato client (src/lib/resetData.ts) è già usata con FALLBACK: finché questo file non è eseguito,
-- il reset funziona come prima (3 operazioni separate); dopo, diventa atomico.

create or replace function public.reset_from_today(
  p_user_id uuid,
  p_period_start date,
  p_salary_income_id uuid,
  p_anchor_day int
)
returns integer
language plpgsql
-- search_path fissato, come nelle altre funzioni del progetto: difesa da name-hijack (uno schema
-- nel search_path dell'utente che ridefinisce una funzione usata qui dentro).
set search_path = public, pg_temp
as $$
declare
  v_deleted_planned integer;
begin
  -- Si può resettare solo il proprio account.
  if p_user_id is distinct from auth.uid() then
    raise exception 'Non autorizzato';
  end if;

  -- 1) Inizio del periodo corrente = oggi (idempotente).
  insert into public.user_settings (user_id, period_start, salary_income_id, anchor_day, updated_at)
  values (p_user_id, p_period_start, p_salary_income_id, p_anchor_day, now())
  on conflict (user_id) do update
    set period_start = excluded.period_start,
        salary_income_id = excluded.salary_income_id,
        anchor_day = excluded.anchor_day,
        updated_at = now();

  -- 2) Via tutti i movimenti reali (storico).
  delete from public.transactions
   where user_id = p_user_id and is_planned = false;

  -- 3) Via le pianificate PASSATE (data < oggi); quelle future restano. Conta quante eliminate.
  delete from public.transactions
   where user_id = p_user_id and is_planned = true and date < p_period_start;
  get diagnostics v_deleted_planned = row_count;

  return v_deleted_planned;
end;
$$;

-- Ricarica la cache dello schema dell'API REST (PostgREST) così la RPC è subito disponibile.
NOTIFY pgrst, 'reload schema';

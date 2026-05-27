-- Aggiornamenti di saldo ATOMICI per i fondi.
--
-- Perché: oggi il client legge il saldo e poi scrive saldo+delta (read-modify-write).
-- Non è atomico: due operazioni quasi simultanee possono leggere lo stesso valore e far
-- "derivare" il saldo. Con questa funzione l'incremento avviene in un singolo UPDATE lato DB.
--
-- Come usarla: esegui questo file nell'SQL Editor di Supabase.
-- Sicurezza: SECURITY INVOKER (default in SQL), quindi rispetta le RLS esistenti
-- (ogni utente può modificare solo i propri fondi). NON usare SECURITY DEFINER.
--
-- Lato client, una volta deployata, sostituire il pattern attuale con:
--   await supabase.rpc('increment_fund_balance', { p_fund_id: fundId, p_delta: delta })
-- (delta negativo per le uscite, positivo per le entrate / accrediti).

create or replace function public.increment_fund_balance(p_fund_id uuid, p_delta numeric)
returns void
language sql
as $$
  update public.funds
     set balance = balance + p_delta
   where id = p_fund_id;
$$;

-- Ricarica la cache dello schema dell'API REST (PostgREST) così l'RPC è subito disponibile.
NOTIFY pgrst, 'reload schema';

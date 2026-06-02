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

-- Trasferimento ATOMICO tra due fondi: i due aggiornamenti di saldo avvengono nella stessa
-- transazione (funzione plpgsql), quindi non può capitare che il fondo di origine venga
-- scalato e quello di destinazione non accreditato (o viceversa). Il client usa questa RPC
-- con fallback ai due increment separati se non ancora deployata.
create or replace function public.transfer_funds(p_from uuid, p_to uuid, p_delta numeric)
returns void
language plpgsql
as $$
begin
  update public.funds set balance = balance - p_delta where id = p_from;
  update public.funds set balance = balance + p_delta where id = p_to;
end;
$$;

-- (Opzionale ma consigliato) Impedisce a livello DB il doppio addebito di una stessa
-- occorrenza ricorrente nello stesso giorno (es. auto-deduct eseguita da due dispositivi).
-- Trade-off: non potrai avere DUE transazioni reali collegate alla stessa voce ricorrente
-- con la stessa identica data; un eventuale secondo pagamento dello stesso giorno va lasciato
-- scollegato (transazione "extra" a sé). I memo e le pianificate sono esclusi.
create unique index if not exists uniq_tx_recurring_expense_per_day
  on public.transactions (recurring_expense_id, date)
  where recurring_expense_id is not null and is_memo = false and is_planned = false;

-- Ricarica la cache dello schema dell'API REST (PostgREST) così le RPC sono subito disponibili.
NOTIFY pgrst, 'reload schema';

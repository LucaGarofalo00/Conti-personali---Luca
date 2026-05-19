-- =============================================
-- MIGRAZIONE MINIMALE - solo aggiunte colonne
-- =============================================
-- Esegui questo SQL nell'SQL Editor di Supabase.
-- È idempotente: puoi rieseguirlo quante volte vuoi senza fare danni.
-- Aggiunge SOLO le colonne mancanti, non ricrea nulla.
-- =============================================

-- Spese ricorrenti: nuovi campi per trasferimenti e addebito automatico
alter table recurring_expenses add column if not exists fund_to_id uuid references funds(id) on delete set null;
alter table recurring_expenses add column if not exists type text not null default 'expense';
alter table recurring_expenses add column if not exists auto_deduct boolean not null default false;
alter table recurring_expenses add column if not exists end_date date;

-- Spese variabili: campo per la conferma in dashboard
alter table variable_expenses add column if not exists needs_confirmation boolean not null default false;

-- Transazioni: nuovi campi per budget, link a ricorrenti, memo e pianificate
alter table transactions add column if not exists budget_id uuid references weekly_budgets(id) on delete set null;
alter table transactions add column if not exists fund_to_id uuid references funds(id) on delete set null;
alter table transactions add column if not exists recurring_expense_id uuid references recurring_expenses(id) on delete set null;
alter table transactions add column if not exists recurring_income_id uuid references recurring_income(id) on delete set null;
alter table transactions add column if not exists is_memo boolean not null default false;
alter table transactions add column if not exists is_planned boolean not null default false;

-- Indici opzionali per performance
create index if not exists idx_transactions_planned on transactions(user_id, is_planned);
create index if not exists idx_transactions_recurring_expense on transactions(recurring_expense_id);

-- =============================================
-- VERIFICA: dopo aver eseguito, lancia questa query per
-- controllare che tutte le colonne siano presenti.
-- Devi vedere tutte le colonne elencate sotto.
-- =============================================
-- select column_name from information_schema.columns
-- where table_name = 'transactions' and table_schema = 'public'
-- order by ordinal_position;
--
-- Attese in transactions:
--   id, user_id, type, amount, description, fund_id, fund_to_id,
--   category, budget_id, recurring_expense_id, recurring_income_id,
--   is_memo, is_planned, date, created_at
--
-- select column_name from information_schema.columns
-- where table_name = 'recurring_expenses' and table_schema = 'public'
-- order by ordinal_position;
--
-- Attese in recurring_expenses:
--   id, user_id, name, amount, day_of_month, fund_id, fund_to_id,
--   category, type, is_active, auto_deduct, end_date, created_at

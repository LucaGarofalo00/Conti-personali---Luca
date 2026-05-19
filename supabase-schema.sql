-- =============================================
-- FinanzApp - Schema Supabase (IDEMPOTENTE)
-- =============================================
-- Esegui questo SQL nell'editor SQL di Supabase
-- (Dashboard > SQL Editor > New Query).
-- Puoi rieseguirlo in qualsiasi momento: crea le tabelle mancanti
-- e aggiunge le colonne nuove senza toccare i dati esistenti.
-- =============================================

-- ---------------------------------------------
-- TABELLE
-- ---------------------------------------------

-- Fondi (conti, carte, contanti, etc.)
create table if not exists funds (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  type text not null default 'main' check (type in ('main', 'sub')),
  parent_id uuid references funds(id) on delete cascade,
  balance numeric(12,2) not null default 0,
  icon text not null default 'wallet',
  color text not null default '#3B82F6',
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- Entrate ricorrenti (stipendio, lavoro sabato, etc.)
create table if not exists recurring_income (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  amount numeric(12,2) not null,
  is_variable boolean not null default false,
  frequency text not null default 'monthly' check (frequency in ('monthly', 'weekly')),
  day_of_month integer check (day_of_month between 1 and 31),
  day_of_week integer check (day_of_week between 0 and 6),
  delay_days integer not null default 0,
  fund_id uuid references funds(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

-- Spese ricorrenti mensili (con supporto trasferimenti e addebito automatico)
create table if not exists recurring_expenses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  amount numeric(12,2) not null,
  day_of_month integer not null check (day_of_month between 1 and 31),
  fund_id uuid references funds(id) on delete set null,
  fund_to_id uuid references funds(id) on delete set null,
  category text not null default 'altro',
  type text not null default 'expense' check (type in ('expense', 'transfer')),
  is_active boolean not null default true,
  auto_deduct boolean not null default false,
  end_date date,
  created_at timestamptz default now()
);

-- Budget settimanali (sfizi, mangiare fuori, etc.)
create table if not exists weekly_budgets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  amount numeric(12,2) not null,
  fund_id uuid references funds(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

-- Spese variabili ricorrenti (GPL, benzina, etc.)
create table if not exists variable_expenses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  estimated_amount numeric(12,2) not null,
  frequency text not null default 'weekly' check (frequency in ('weekly', 'monthly')),
  fund_id uuid references funds(id) on delete set null,
  category text not null default 'trasporti',
  is_active boolean not null default true,
  needs_confirmation boolean not null default false,
  created_at timestamptz default now()
);

-- Transazioni effettive + pianificate (is_planned = true)
create table if not exists transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  type text not null check (type in ('income', 'expense', 'transfer')),
  amount numeric(12,2) not null,
  description text not null default '',
  fund_id uuid references funds(id) on delete set null,
  fund_to_id uuid references funds(id) on delete set null,
  category text not null default 'altro',
  budget_id uuid references weekly_budgets(id) on delete set null,
  recurring_expense_id uuid references recurring_expenses(id) on delete set null,
  recurring_income_id uuid references recurring_income(id) on delete set null,
  is_memo boolean not null default false,
  is_planned boolean not null default false,
  date date not null default current_date,
  created_at timestamptz default now()
);

-- ---------------------------------------------
-- MIGRATIONS (aggiunge colonne mancanti su DB già esistenti)
-- ---------------------------------------------

alter table recurring_expenses add column if not exists fund_to_id uuid references funds(id) on delete set null;
alter table recurring_expenses add column if not exists type text not null default 'expense';
alter table recurring_expenses add column if not exists auto_deduct boolean not null default false;
alter table recurring_expenses add column if not exists end_date date;

alter table variable_expenses add column if not exists needs_confirmation boolean not null default false;

alter table transactions add column if not exists budget_id uuid references weekly_budgets(id) on delete set null;
alter table transactions add column if not exists recurring_expense_id uuid references recurring_expenses(id) on delete set null;
alter table transactions add column if not exists recurring_income_id uuid references recurring_income(id) on delete set null;
alter table transactions add column if not exists is_memo boolean not null default false;
alter table transactions add column if not exists is_planned boolean not null default false;

-- Assicura che il check constraint su recurring_expenses.type esista
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'recurring_expenses_type_check'
  ) then
    alter table recurring_expenses add constraint recurring_expenses_type_check
      check (type in ('expense', 'transfer'));
  end if;
end$$;

-- ---------------------------------------------
-- Row Level Security (RLS) - idempotente
-- ---------------------------------------------

alter table funds enable row level security;
alter table recurring_expenses enable row level security;
alter table recurring_income enable row level security;
alter table weekly_budgets enable row level security;
alter table variable_expenses enable row level security;
alter table transactions enable row level security;

-- Drop & ricrea le policies (così sono sicure anche su DB già configurati)
drop policy if exists "funds_select" on funds;
drop policy if exists "funds_insert" on funds;
drop policy if exists "funds_update" on funds;
drop policy if exists "funds_delete" on funds;
create policy "funds_select" on funds for select using (auth.uid() = user_id);
create policy "funds_insert" on funds for insert with check (auth.uid() = user_id);
create policy "funds_update" on funds for update using (auth.uid() = user_id);
create policy "funds_delete" on funds for delete using (auth.uid() = user_id);

drop policy if exists "recurring_expenses_select" on recurring_expenses;
drop policy if exists "recurring_expenses_insert" on recurring_expenses;
drop policy if exists "recurring_expenses_update" on recurring_expenses;
drop policy if exists "recurring_expenses_delete" on recurring_expenses;
create policy "recurring_expenses_select" on recurring_expenses for select using (auth.uid() = user_id);
create policy "recurring_expenses_insert" on recurring_expenses for insert with check (auth.uid() = user_id);
create policy "recurring_expenses_update" on recurring_expenses for update using (auth.uid() = user_id);
create policy "recurring_expenses_delete" on recurring_expenses for delete using (auth.uid() = user_id);

drop policy if exists "recurring_income_select" on recurring_income;
drop policy if exists "recurring_income_insert" on recurring_income;
drop policy if exists "recurring_income_update" on recurring_income;
drop policy if exists "recurring_income_delete" on recurring_income;
create policy "recurring_income_select" on recurring_income for select using (auth.uid() = user_id);
create policy "recurring_income_insert" on recurring_income for insert with check (auth.uid() = user_id);
create policy "recurring_income_update" on recurring_income for update using (auth.uid() = user_id);
create policy "recurring_income_delete" on recurring_income for delete using (auth.uid() = user_id);

drop policy if exists "weekly_budgets_select" on weekly_budgets;
drop policy if exists "weekly_budgets_insert" on weekly_budgets;
drop policy if exists "weekly_budgets_update" on weekly_budgets;
drop policy if exists "weekly_budgets_delete" on weekly_budgets;
create policy "weekly_budgets_select" on weekly_budgets for select using (auth.uid() = user_id);
create policy "weekly_budgets_insert" on weekly_budgets for insert with check (auth.uid() = user_id);
create policy "weekly_budgets_update" on weekly_budgets for update using (auth.uid() = user_id);
create policy "weekly_budgets_delete" on weekly_budgets for delete using (auth.uid() = user_id);

drop policy if exists "variable_expenses_select" on variable_expenses;
drop policy if exists "variable_expenses_insert" on variable_expenses;
drop policy if exists "variable_expenses_update" on variable_expenses;
drop policy if exists "variable_expenses_delete" on variable_expenses;
create policy "variable_expenses_select" on variable_expenses for select using (auth.uid() = user_id);
create policy "variable_expenses_insert" on variable_expenses for insert with check (auth.uid() = user_id);
create policy "variable_expenses_update" on variable_expenses for update using (auth.uid() = user_id);
create policy "variable_expenses_delete" on variable_expenses for delete using (auth.uid() = user_id);

drop policy if exists "transactions_select" on transactions;
drop policy if exists "transactions_insert" on transactions;
drop policy if exists "transactions_update" on transactions;
drop policy if exists "transactions_delete" on transactions;
create policy "transactions_select" on transactions for select using (auth.uid() = user_id);
create policy "transactions_insert" on transactions for insert with check (auth.uid() = user_id);
create policy "transactions_update" on transactions for update using (auth.uid() = user_id);
create policy "transactions_delete" on transactions for delete using (auth.uid() = user_id);

-- ---------------------------------------------
-- Indici per performance (idempotenti)
-- ---------------------------------------------

create index if not exists idx_funds_user on funds(user_id);
create index if not exists idx_recurring_expenses_user on recurring_expenses(user_id);
create index if not exists idx_recurring_income_user on recurring_income(user_id);
create index if not exists idx_weekly_budgets_user on weekly_budgets(user_id);
create index if not exists idx_variable_expenses_user on variable_expenses(user_id);
create index if not exists idx_transactions_user_date on transactions(user_id, date desc);
create index if not exists idx_transactions_planned on transactions(user_id, is_planned);
create index if not exists idx_transactions_recurring_expense on transactions(recurring_expense_id);

-- =============================================
-- (Opzionale) Query per individuare duplicati creati dal bug timezone
-- =============================================
-- select description, type, fund_id, fund_to_id, amount, date, count(*) as duplicati
-- from transactions
-- where is_memo = false
-- group by description, type, fund_id, fund_to_id, amount, date
-- having count(*) > 1
-- order by duplicati desc;
--
-- Per pulirli senza scrivere SQL: vai sulla pagina Transazioni, clicca
-- "Seleziona duplicati" e poi "Elimina" (i saldi dei fondi verranno
-- ripristinati automaticamente).

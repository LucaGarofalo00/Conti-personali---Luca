-- =============================================
-- FinanzApp - Impostazioni utente (IDEMPOTENTE)
-- =============================================
-- Esegui questo SQL nell'SQL Editor di Supabase (Dashboard > SQL Editor > New Query).
-- Puoi rieseguirlo quante volte vuoi: crea la tabella se manca, senza toccare i dati.
--
-- A cosa serve: salva le preferenze del PERIODO (ciclo stipendio→stipendio) e quale
-- entrata definisce lo stipendio, così l'app può far seguire al periodo la data REALE
-- dell'accredito (che cambia ogni mese) invece di un giorno fisso.
-- =============================================

create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Data di inizio del PERIODO CORRENTE (giorno reale dello stipendio confermato).
  -- Quando arriva il nuovo stipendio l'app propone di spostarla in avanti.
  period_start date,
  -- Quale entrata ricorrente è "lo stipendio" che definisce il periodo (rilevamento automatico).
  salary_income_id uuid references recurring_income(id) on delete set null,
  -- Giorno tipico atteso dello stipendio: usato SOLO come stima per le previsioni e per i
  -- periodi diversi da quello corrente (1..28). Default 15 = comportamento storico (15→14).
  anchor_day integer not null default 15 check (anchor_day between 1 and 28),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Migrazione idempotente delle colonne (per DB su cui la tabella esisteva già senza qualche campo)
alter table user_settings add column if not exists period_start date;
alter table user_settings add column if not exists salary_income_id uuid references recurring_income(id) on delete set null;
alter table user_settings add column if not exists anchor_day integer not null default 15;
alter table user_settings add column if not exists updated_at timestamptz default now();

-- ---------------------------------------------
-- Row Level Security (RLS) - idempotente
-- ---------------------------------------------
alter table user_settings enable row level security;

drop policy if exists "user_settings_select" on user_settings;
drop policy if exists "user_settings_insert" on user_settings;
drop policy if exists "user_settings_update" on user_settings;
drop policy if exists "user_settings_delete" on user_settings;
create policy "user_settings_select" on user_settings for select using (auth.uid() = user_id);
create policy "user_settings_insert" on user_settings for insert with check (auth.uid() = user_id);
create policy "user_settings_update" on user_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_settings_delete" on user_settings for delete using (auth.uid() = user_id);

-- Ricarica la cache dello schema dell'API REST (PostgREST) così la tabella è subito disponibile.
NOTIFY pgrst, 'reload schema';

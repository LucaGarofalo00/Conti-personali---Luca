-- =============================================
-- FinanzApp - Categorie personalizzate  [IDEMPOTENTE]
-- =============================================
-- Permette all'utente di aggiungere proprie categorie (oltre a quelle predefinite). Il campo
-- `category` sulle transazioni è già testo libero: questa tabella serve solo a far comparire le
-- categorie custom nei menu a tendina. Finché non esegui questo file, l'app mostra solo i default
-- (degrada con grazia, niente errori).

create table if not exists custom_categories (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  created_at timestamptz default now(),
  unique (user_id, name)
);

create index if not exists idx_custom_categories_user on custom_categories(user_id);

alter table custom_categories enable row level security;

drop policy if exists "custom_categories_select" on custom_categories;
drop policy if exists "custom_categories_insert" on custom_categories;
drop policy if exists "custom_categories_update" on custom_categories;
drop policy if exists "custom_categories_delete" on custom_categories;
create policy "custom_categories_select" on custom_categories for select using (auth.uid() = user_id);
create policy "custom_categories_insert" on custom_categories for insert with check (auth.uid() = user_id);
create policy "custom_categories_update" on custom_categories for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "custom_categories_delete" on custom_categories for delete using (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';

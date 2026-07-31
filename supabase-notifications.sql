-- =============================================
-- FinanzApp - Notifiche push (promemoria scadenze)  [IDEMPOTENTE]
-- =============================================
-- Tabella delle sottoscrizioni Web Push. Usata da src/lib/push.ts (upsert su `endpoint` quando
-- l'utente attiva le notifiche, delete quando le disattiva) e letta dalla Edge Function
-- `send-reminders`, che spedisce i promemoria delle scadenze.
-- Esegui nell'SQL Editor di Supabase. Rieseguibile senza effetti collaterali.

create table if not exists public.push_subscriptions (
  -- La chiave è l'endpoint: è il browser/dispositivo a essere iscritto, non l'account. Lo stesso
  -- utente può avere più dispositivi, e l'upsert di push.ts fa `onConflict: 'endpoint'`.
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Ogni utente vede e gestisce SOLO le proprie sottoscrizioni. Senza queste policy la tabella,
-- con RLS attiva, risulterebbe vuota e inscrivibile dal client: l'attivazione fallirebbe.
drop policy if exists "push_subscriptions_select" on public.push_subscriptions;
drop policy if exists "push_subscriptions_insert" on public.push_subscriptions;
drop policy if exists "push_subscriptions_update" on public.push_subscriptions;
drop policy if exists "push_subscriptions_delete" on public.push_subscriptions;

create policy "push_subscriptions_select" on public.push_subscriptions
  for select using ((select auth.uid()) = user_id);
create policy "push_subscriptions_insert" on public.push_subscriptions
  for insert with check ((select auth.uid()) = user_id);
-- L'upsert su endpoint già presente diventa un UPDATE: serve anche questa policy, altrimenti
-- riattivare le notifiche su un dispositivo già iscritto fallisce.
create policy "push_subscriptions_update" on public.push_subscriptions
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "push_subscriptions_delete" on public.push_subscriptions
  for delete using ((select auth.uid()) = user_id);

comment on table public.push_subscriptions is
  'Sottoscrizioni Web Push per i promemoria scadenze. Una riga per dispositivo (endpoint).';

-- ---------------------------------------------------------------------------------------------
-- Esecuzione giornaliera della Edge Function `send-reminders` (opzionale).
-- Richiede le estensioni pg_cron e pg_net (Database → Extensions nella dashboard Supabase).
-- Sostituisci <PROJECT_REF> e <SERVICE_ROLE_KEY> prima di togliere il commento.
-- ---------------------------------------------------------------------------------------------
-- select cron.schedule(
--   'finanzapp-send-reminders',
--   '0 7 * * *',                      -- ogni giorno alle 07:00 UTC
--   $$
--   select net.http_post(
--     url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders',
--     headers := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );

-- Akire88 · tabelle del sito (richieste di contatto e newsletter)
-- Esegui questo file una volta in Supabase > SQL Editor (oppure con `supabase db push`).
-- Il sito NON scrive direttamente nelle tabelle: passa sempre dalle Edge Functions,
-- che usano la chiave service_role lato server. Per questo RLS è attivo e non ci sono
-- policy per gli utenti anonimi: dal browser non si può né leggere né scrivere.

create extension if not exists pgcrypto;

-- Richieste dal modulo "Contattaci"
create table if not exists public.contact_requests (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  tipo        text not null check (char_length(tipo) <= 80),
  nome        text not null check (char_length(nome) between 1 and 120),
  email       text not null check (char_length(email) between 3 and 254),
  azienda     text check (char_length(azienda) <= 160),
  telefono    text check (char_length(telefono) <= 40),
  messaggio   text not null check (char_length(messaggio) between 1 and 5000),
  privacy_ok  boolean not null default false,
  stato       text not null default 'nuova' check (stato in ('nuova', 'in corso', 'chiusa')),
  email_sent  boolean not null default false
);
create index if not exists contact_requests_created_idx on public.contact_requests (created_at desc);

-- Iscritti alla newsletter (doppia conferma)
create table if not exists public.newsletter_subscribers (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique check (char_length(email) between 3 and 254),
  stato            text not null default 'in_attesa' check (stato in ('in_attesa', 'confermato', 'disiscritto')),
  token            uuid not null default gen_random_uuid() unique,
  created_at       timestamptz not null default now(),
  confirmed_at     timestamptz,
  unsubscribed_at  timestamptz
);

alter table public.contact_requests enable row level security;
alter table public.newsletter_subscribers enable row level security;

-- Nessuna policy per "anon" e "authenticated": accesso solo tramite service_role
-- (Edge Functions e il tuo pannello admin lato server).
revoke all on public.contact_requests from anon, authenticated;
revoke all on public.newsletter_subscribers from anon, authenticated;

-- Pulizia automatica (facoltativa, richiede l'estensione pg_cron):
-- richieste più vecchie di 24 mesi e iscrizioni mai confermate dopo 30 giorni.
-- create extension if not exists pg_cron;
-- select cron.schedule('pulizia-akire88', '0 3 * * *', $$
--   delete from public.contact_requests where created_at < now() - interval '24 months';
--   delete from public.newsletter_subscribers where stato = 'in_attesa' and created_at < now() - interval '30 days';
-- $$);

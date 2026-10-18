-- Akire88 · storico delle newsletter inviate dal pannello /admin
-- Esegui una volta in Supabase > SQL Editor.

create table if not exists public.newsletter_campaigns (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  subject        text not null,
  title          text not null,
  body           text not null,
  button_text    text,
  button_url     text,
  recipients     integer not null default 0,
  sent           integer not null default 0,
  failed         integer not null default 0,
  failed_emails  text[] not null default '{}'
);

alter table public.newsletter_campaigns enable row level security;
revoke all on public.newsletter_campaigns from anon, authenticated;

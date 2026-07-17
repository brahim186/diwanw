-- =====================================================================================
-- RIHANIO — MIGRATION DÉPENSES DIVERSES (depenses-diverses.html)
-- À exécuter UNE SEULE FOIS dans Supabase Dashboard > SQL Editor > New query,
-- APRÈS schema.sql et schema-finances.sql.
-- =====================================================================================

create table if not exists public.misc_expenses (
  id             text primary key,         -- uuid généré côté client (crypto.randomUUID())
  "categorie"    text not null,            -- ex: "Administration et Gestion Courante"
  "sousCategorie" text not null,           -- ex: "Fournitures de bureau et d'impression"
  description    text,
  montant        numeric not null default 0,
  "datePaiement" date not null,
  mois           int not null,             -- 1 à 12, dérivé de datePaiement
  annee          int not null,             -- dérivé de datePaiement
  "createdAt"    timestamptz default now()
);

create index if not exists misc_expenses_period_idx on public.misc_expenses (annee, mois);
create index if not exists misc_expenses_categorie_idx on public.misc_expenses ("categorie");

alter table public.misc_expenses enable row level security;

drop policy if exists "misc_expenses_all_authenticated" on public.misc_expenses;
create policy "misc_expenses_all_authenticated" on public.misc_expenses
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
-- =====================================================================================

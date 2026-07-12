-- =====================================================================================
-- Diwan Al Maaref — MIGRATION PERSONNEL ADMINISTRATIF & SOUTIEN + SALAIRES LIÉS
-- (gestion-personnel-administratif.html + volet "Administratif" de gestion-salaires.html)
-- À exécuter UNE SEULE FOIS dans Supabase Dashboard > SQL Editor > New query,
-- APRÈS schema.sql (nécessite public.admins, réutilisé côté client via requireAdmin).
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- 1) Table "staff" — fiche de chaque membre du personnel administratif / de soutien.
--    Pas de compte de connexion (contrairement à "teachers") : id = texte généré côté
--    client (crypto.randomUUID(), préfixé "staff_"), pas une FK vers auth.users.
-- ------------------------------------------------------------------------------------
create table if not exists public.staff (
  id             text primary key,
  "nomComplet"   text not null,
  cnie           text,
  telephone      text,
  "dateEmbauche" date,
  poste          text not null,
  salaire        numeric not null default 0,
  rib            text,
  "createdAt"    timestamptz default now()
);

alter table public.staff enable row level security;

-- Même politique que "teachers"/"notes"/"misc_expenses" : tout compte connecté
-- (admin en pratique, seul rôle qui accède à cette page côté UI) peut lire/écrire.
drop policy if exists "staff_all_authenticated" on public.staff;
create policy "staff_all_authenticated" on public.staff
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');


-- ------------------------------------------------------------------------------------
-- 2) Table "staff_payments" — paiement mensuel de chaque membre du personnel,
--    symétrique de "teacher_payments" (utilisée par gestion-salaires.html).
-- ------------------------------------------------------------------------------------
create table if not exists public.staff_payments (
  id             text primary key,     -- "<staffId>::<année>-<mois sur 2 chiffres>"
  "staffId"      text references public.staff(id) on delete cascade,
  annee          int not null,
  mois           int not null,
  montant        numeric not null default 0,
  statut         text default 'Non payé',
  "datePaiement" date
);

create index if not exists staff_payments_staff_idx on public.staff_payments ("staffId");

alter table public.staff_payments enable row level security;

drop policy if exists "staff_payments_all_authenticated" on public.staff_payments;
create policy "staff_payments_all_authenticated" on public.staff_payments
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- =====================================================================================
-- Remarque : la table "teacher_payments" utilisée par gestion-salaires.html pour les
-- enseignants n'apparaît pas dans le schema.sql que vous avez collé — elle a dû être
-- créée par une migration antérieure non incluse ici. Si jamais elle n'existe pas
-- encore chez vous, voici sa définition (identique à staff_payments, avec teacherId) :
--
-- create table if not exists public.teacher_payments (
--   id             text primary key,   -- "<teacherId>::<année>-<mois>"
--   "teacherId"    uuid references public.teachers(id) on delete cascade,
--   annee          int not null,
--   mois           int not null,
--   montant        numeric not null default 0,
--   statut         text default 'Non payé',
--   "datePaiement" date
-- );
-- alter table public.teacher_payments enable row level security;
-- create policy "teacher_payments_all_authenticated" on public.teacher_payments
--   for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
-- =====================================================================================

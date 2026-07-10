-- =====================================================================================
-- Diwan Al Maaref — schéma Supabase (remplace Firebase Firestore + Google Sheets)
-- À exécuter dans Supabase Dashboard > SQL Editor > New query, une seule fois.
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- 1) TABLES
-- ------------------------------------------------------------------------------------

create table if not exists public.students (
  id                 text primary key,               -- matricule, ex: DA-2026-0001
  "prenom"           text,
  "nom"              text,
  "dateNaissance"    text,
  "lieuNaissance"    text,
  "genre"            text,
  "niveau"           text,
  "nomPere"          text,
  "nomMere"          text,
  "cinPere"          text,
  "cinMere"          text,
  "telPere"          text,
  "telMere"          text,
  "telUrgence"       text,
  "photoURL"         text,
  "acteNaissanceURL" text,
  "cinParentsURL"    text,
  "statut"           text default 'En attente',      -- 'En attente' | 'Accepté' | 'Refusé'
  "groupe"           text default 'Non assigné',
  "horodatage"       timestamptz default now()
);

create table if not exists public.admins (
  id    uuid primary key references auth.users(id) on delete cascade,
  email text
);

create table if not exists public.teachers (
  id           uuid primary key references auth.users(id) on delete cascade,
  "nom"        text,
  "prenom"     text,
  "genre"      text,
  "adresse"    text,
  "telephone"  text,
  "niveaux"    text[] default '{}',
  "groupe"     text,
  "salaire"    numeric,
  "username"   text unique,
  "createdAt"  timestamptz default now()
);

create table if not exists public.notes (
  id       text primary key references public.students(id) on delete cascade,
  examen1  numeric,
  examen2  numeric,
  examen3  numeric
);

create table if not exists public.counters (
  id    text primary key,
  count integer not null default 0,
  year  integer not null
);

-- ------------------------------------------------------------------------------------
-- 2) Génération atomique du matricule (remplace la transaction Firestore)
-- ------------------------------------------------------------------------------------
create or replace function public.generate_matricule()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  yr int := extract(year from now());
  n  int;
begin
  insert into public.counters (id, count, year)
  values ('students', 1, yr)
  on conflict (id) do update
    set count = case when public.counters.year = yr then public.counters.count + 1 else 1 end,
        year  = yr
  returning count into n;

  return 'DA-' || yr || '-' || lpad(n::text, 4, '0');
end;
$$;

grant execute on function public.generate_matricule() to anon, authenticated;

-- ------------------------------------------------------------------------------------
-- 3) RLS — Row Level Security
-- ------------------------------------------------------------------------------------
alter table public.students enable row level security;
alter table public.admins   enable row level security;
alter table public.teachers enable row level security;
alter table public.notes    enable row level security;
alter table public.counters enable row level security;

-- students -----------------------------------------------------------------
-- Lecture publique nécessaire pour : la page "Suivre ma demande" (consultation.html,
-- recherche par nom avant même d'être admis) et le formulaire d'inscription public.
create policy "students_select_all" on public.students
  for select using (true);

-- N'importe qui (visiteur non connecté) peut déposer une demande d'inscription,
-- mais uniquement avec le statut initial "En attente".
create policy "students_insert_public" on public.students
  for insert with check (statut is null or statut = 'En attente');

-- Seuls les comptes connectés (admin ou enseignant) peuvent modifier un dossier
-- (changement de statut, affectation de groupe...).
create policy "students_update_authenticated" on public.students
  for update using (auth.role() = 'authenticated');

create policy "students_delete_authenticated" on public.students
  for delete using (auth.role() = 'authenticated');

-- notes ----------------------------------------------------------------------
create policy "notes_all_authenticated" on public.notes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- teachers ---------------------------------------------------------------------
-- Un enseignant doit pouvoir lire SON PROPRE profil (pour se connecter), et
-- l'admin doit pouvoir lister/ajouter/supprimer tous les enseignants.
create policy "teachers_select_authenticated" on public.teachers
  for select using (auth.role() = 'authenticated');

create policy "teachers_insert_authenticated" on public.teachers
  for insert with check (auth.role() = 'authenticated');

create policy "teachers_delete_authenticated" on public.teachers
  for delete using (auth.role() = 'authenticated');

-- admins -------------------------------------------------------------------
create policy "admins_select_authenticated" on public.admins
  for select using (auth.role() = 'authenticated');

-- counters : pas d'accès direct depuis le client, uniquement via generate_matricule()
-- (fonction security definer) -> aucune policy select/insert/update accordée.

-- ------------------------------------------------------------------------------------
-- 4) STORAGE — bucket public "documents" (photos, actes de naissance, CIN)
-- ------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do nothing;

create policy "documents_public_read" on storage.objects
  for select using (bucket_id = 'documents');

create policy "documents_public_upload" on storage.objects
  for insert with check (bucket_id = 'documents');

create policy "documents_authenticated_manage" on storage.objects
  for update using (bucket_id = 'documents' and auth.role() = 'authenticated');

create policy "documents_authenticated_delete" on storage.objects
  for delete using (bucket_id = 'documents' and auth.role() = 'authenticated');

-- ------------------------------------------------------------------------------------
-- 5) Étapes manuelles restantes (à faire dans le Dashboard Supabase, pas en SQL) :
--
--  a) Authentication > Providers > Email : désactiver "Confirm email"
--     (sinon les comptes enseignants créés depuis l'admin restent bloqués).
--
--  b) Créer votre premier compte administrateur :
--     - Authentication > Users > Add user (email + mot de passe)
--     - copier son "User UID"
--     - puis exécuter :
--       insert into public.admins (id, email) values ('UID-COPIÉ-ICI', 'admin@exemple.com');
-- =====================================================================================

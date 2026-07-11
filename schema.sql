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
drop policy if exists "students_select_all" on public.students;
create policy "students_select_all" on public.students
  for select using (true);

-- N'importe qui (visiteur non connecté) peut déposer une demande d'inscription,
-- mais uniquement avec le statut initial "En attente".
drop policy if exists "students_insert_public" on public.students;
create policy "students_insert_public" on public.students
  for insert with check (statut is null or statut = 'En attente');

-- Seuls les comptes connectés (admin ou enseignant) peuvent modifier un dossier
-- (changement de statut, affectation de groupe...).
drop policy if exists "students_update_authenticated" on public.students;
create policy "students_update_authenticated" on public.students
  for update using (auth.role() = 'authenticated');

drop policy if exists "students_delete_authenticated" on public.students;
create policy "students_delete_authenticated" on public.students
  for delete using (auth.role() = 'authenticated');

-- notes ----------------------------------------------------------------------
drop policy if exists "notes_all_authenticated" on public.notes;
create policy "notes_all_authenticated" on public.notes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- teachers ---------------------------------------------------------------------
-- Un enseignant doit pouvoir lire SON PROPRE profil (pour se connecter), et
-- l'admin doit pouvoir lister/ajouter/supprimer tous les enseignants.
drop policy if exists "teachers_select_authenticated" on public.teachers;
create policy "teachers_select_authenticated" on public.teachers
  for select using (auth.role() = 'authenticated');

drop policy if exists "teachers_insert_authenticated" on public.teachers;
create policy "teachers_insert_authenticated" on public.teachers
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "teachers_delete_authenticated" on public.teachers;
create policy "teachers_delete_authenticated" on public.teachers
  for delete using (auth.role() = 'authenticated');

-- admins -------------------------------------------------------------------
drop policy if exists "admins_select_authenticated" on public.admins;
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

drop policy if exists "documents_public_read" on storage.objects;
create policy "documents_public_read" on storage.objects
  for select using (bucket_id = 'documents');

drop policy if exists "documents_public_upload" on storage.objects;
create policy "documents_public_upload" on storage.objects
  for insert with check (bucket_id = 'documents');

drop policy if exists "documents_authenticated_manage" on storage.objects;
create policy "documents_authenticated_manage" on storage.objects
  for update using (bucket_id = 'documents' and auth.role() = 'authenticated');

drop policy if exists "documents_authenticated_delete" on storage.objects;
create policy "documents_authenticated_delete" on storage.objects
  for delete using (bucket_id = 'documents' and auth.role() = 'authenticated');

-- ------------------------------------------------------------------------------------
-- 5) MIGRATION — Comptes de connexion des élèves admis (à exécuter une seule fois si
--    votre base existe déjà : les sections 1 à 4 ci-dessus sont déjà en place chez vous,
--    seul ce bloc est nouveau et peut être exécuté seul dans le SQL Editor).
-- ------------------------------------------------------------------------------------
create table if not exists public.student_credentials (
  id           uuid primary key references auth.users(id) on delete cascade,
  "studentId"  text unique references public.students(id) on delete cascade,
  email        text,
  password     text,
  "createdAt"  timestamptz default now()
);

alter table public.student_credentials enable row level security;

-- Écriture/lecture directe réservées aux comptes connectés (admin) : c'est l'admin qui
-- crée le compte à l'acceptation, et qui peut ré-afficher les identifiants plus tard
-- (ex: depuis "Élèves Admis"). Les élèves eux-mêmes ne passent PAS par cette policy :
-- ils obtiennent leurs identifiants via la fonction get_student_credentials ci-dessous.
drop policy if exists "student_credentials_insert_authenticated" on public.student_credentials;
create policy "student_credentials_insert_authenticated" on public.student_credentials
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "student_credentials_select_authenticated" on public.student_credentials;
create policy "student_credentials_select_authenticated" on public.student_credentials
  for select using (auth.role() = 'authenticated');

drop policy if exists "student_credentials_update_authenticated" on public.student_credentials;
create policy "student_credentials_update_authenticated" on public.student_credentials
  for update using (auth.role() = 'authenticated');

-- Fonction utilisée par la page publique "Suivi de ma Demande" (visiteur non connecté,
-- sans session) pour révéler l'email/mot de passe d'un élève. Volontairement PAS une
-- policy select publique sur la table (ce qui exposerait tous les mots de passe via un
-- simple .select('*')) : cette fonction ne renvoie les identifiants QUE si le prénom, le
-- nom ET le matricule fournis correspondent exactement à un dossier au statut "Accepté".
create or replace function public.get_student_credentials(p_matricule text, p_prenom text, p_nom text)
returns table(email text, password text)
language sql
security definer
set search_path = public
as $$
  select sc.email, sc.password
  from public.student_credentials sc
  join public.students s on s.id = sc."studentId"
  where s.id = p_matricule
    and s.statut = 'Accepté'
    and lower(s.prenom) = lower(p_prenom)
    and lower(s.nom) = lower(p_nom);
$$;

grant execute on function public.get_student_credentials(text, text, text) to anon, authenticated;

-- ------------------------------------------------------------------------------------
-- 6) Étapes manuelles restantes (à faire dans le Dashboard Supabase, pas en SQL) :
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

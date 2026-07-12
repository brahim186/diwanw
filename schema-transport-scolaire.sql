-- =====================================================================================
-- Diwan Al Maaref — MIGRATION TRANSPORT SCOLAIRE (gestion-transport.html)
-- À exécuter UNE SEULE FOIS dans Supabase Dashboard > SQL Editor > New query,
-- APRÈS schema.sql ET APRÈS schema-personnel-administratif.sql (nécessite public.staff,
-- pour lier chauffeur/accompagnatrice).
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- 1) Table "buses" — fiche de chaque hafila (bus) de transport scolaire.
--    chauffeurId / accompagnatriceId pointent vers public.staff (poste "Chauffeur de
--    Transport Scolaire" / "Accompagnatrice de Transport"), filtré côté client.
-- ------------------------------------------------------------------------------------
create table if not exists public.buses (
  id                   text primary key,        -- ex: "bus_xxxxxxxx" (généré côté client)
  "numBus"             text,                     -- identifiant interne, ex: "Bus 01"
  immatriculation      text not null unique,     -- ex: "12345 | أ | 15"
  capacite             int not null default 0,
  modele               text,
  "chauffeurId"        text references public.staff(id) on delete set null,
  "accompagnatriceId"  text references public.staff(id) on delete set null,
  ligne                text,                     -- trajet / quartiers desservis
  statut               text not null default 'Active',  -- 'Active' | 'En maintenance' | 'À l''arrêt'
  "createdAt"          timestamptz default now()
);

alter table public.buses enable row level security;

drop policy if exists "buses_all_authenticated" on public.buses;
create policy "buses_all_authenticated" on public.buses
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');


-- ------------------------------------------------------------------------------------
-- 2) Rattachement des élèves à un bus (pour calculer automatiquement les places
--    restantes = capacite - nombre d'élèves acceptés affectés à ce bus).
-- ------------------------------------------------------------------------------------
alter table public.students add column if not exists "busId" text references public.buses(id) on delete set null;
create index if not exists students_bus_idx on public.students ("busId");

-- Aucune nouvelle policy nécessaire ici : "students" a déjà une policy update
-- "students_update_authenticated" (auth.role() = 'authenticated'), qui couvre
-- l'écriture du nouveau champ "busId" depuis la page de gestion du transport.
-- =====================================================================================

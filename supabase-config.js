// =====================================================================================
// supabase-config.js — Couche d'accès aux données pour Diwan Al Maaref (Supabase)
// Remplace firebase-config.js. Ce fichier expose volontairement des fonctions au nom
// et à la signature proches de celles de Firebase (doc, getDoc, setDoc, collection,
// query, where, requireAdmin, requireTeacher...) afin que les pages HTML existantes
// n'aient presque rien à changer, à part l'import.
// =====================================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// --- Clés de connexion au projet Supabase ---------------------------------------------
const SUPABASE_URL = 'https://cfacgiulbtlzppkraens.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fmfgWZxctiAj4B7FNS-Z5A_EAsluBBa';

// Client principal (garde la session de l'utilisateur connecté sur le site)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Client secondaire, sans persistance de session : sert uniquement à créer un compte
// enseignant depuis l'espace admin SANS déconnecter l'administrateur en cours.
const secondaryAuthClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, storageKey: 'sb-secondary-teacher-creation' }
});

// "auth" et "db" existent pour garder la même signature que firebase-config.js.
export const auth = supabase;
export const db = supabase;
export const storage = supabase.storage;

// --- Domaine fictif utilisé pour transformer un nom d'utilisateur enseignant en email ---
const TEACHER_EMAIL_DOMAIN = 'teacher.diwanalmaaref.local';
export function usernameToEmail(username) {
  return `${username.toLowerCase()}@${TEACHER_EMAIL_DOMAIN}`;
}

export function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// --- Auth --------------------------------------------------------------------------
export async function signInWithEmailAndPassword(_auth, email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { user: { uid: data.user.id, email: data.user.email } };
}

export async function signOut(_auth) {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Émule onAuthStateChanged(auth, callback) : callback(user|null)
export function onAuthStateChanged(_auth, callback) {
  supabase.auth.getSession().then(({ data }) => {
    const user = data.session?.user;
    callback(user ? { uid: user.id, email: user.email } : null);
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    callback(user ? { uid: user.id, email: user.email } : null);
  });
}

// Crée un compte Auth pour un enseignant SANS déconnecter l'admin courant.
// Nécessite que la confirmation d'email soit DÉSACTIVÉE dans le projet Supabase
// (Authentication > Providers > Email > "Confirm email" = OFF), sinon le compte
// enseignant reste en attente de confirmation et ne peut pas se connecter.
export async function createTeacherAuthAccount(email, password) {
  const { data, error } = await secondaryAuthClient.auth.signUp({ email, password });
  if (error) throw error;
  await secondaryAuthClient.auth.signOut();
  if (!data.user) throw new Error("Compte créé mais confirmation d'email requise côté Supabase. Désactivez 'Confirm email' dans les réglages Auth du projet.");
  return data.user.id;
}

// --- Mini-couche façon Firestore, posée sur des tables Postgres ---------------------
export function collection(_db, table) {
  return { table };
}

export function doc(_db, table, id) {
  return { table, id };
}

export function where(field, op, value) {
  return { field, op, value };
}

// query(collectionRef, where(...), where(...))
export function query(collectionRef, ...clauses) {
  return { table: collectionRef.table, clauses };
}

export async function getDoc(docRef) {
  const { data, error } = await supabase.from(docRef.table).select('*').eq('id', docRef.id).maybeSingle();
  if (error) throw error;
  return { exists: () => !!data, data: () => data || {}, id: docRef.id };
}

// setDoc(doc(db,'students',id), {...}, {merge:true}) -> upsert (PostgREST merge-duplicates
// ne touche que les colonnes fournies, comme setDoc(..., {merge:true}))
export async function setDoc(docRef, dataObj) {
  const row = { id: docRef.id, ...dataObj };
  const { error } = await supabase.from(docRef.table).upsert(row);
  if (error) throw error;
}

export async function updateDoc(docRef, dataObj) {
  const { error } = await supabase.from(docRef.table).update(dataObj).eq('id', docRef.id);
  if (error) throw error;
}

export async function deleteDoc(docRef) {
  const { error } = await supabase.from(docRef.table).delete().eq('id', docRef.id);
  if (error) throw error;
}

// getDocs(collection(db,'x')) ou getDocs(query(collection(db,'x'), where(...)))
export async function getDocs(refOrQuery) {
  let q = supabase.from(refOrQuery.table).select('*');
  for (const clause of refOrQuery.clauses || []) {
    if (clause.op === '==' || !clause.op) q = q.eq(clause.field, clause.value);
    else if (clause.op === '!=') q = q.neq(clause.field, clause.value);
    else if (clause.op === '>') q = q.gt(clause.field, clause.value);
    else if (clause.op === '>=') q = q.gte(clause.field, clause.value);
    else if (clause.op === '<') q = q.lt(clause.field, clause.value);
    else if (clause.op === '<=') q = q.lte(clause.field, clause.value);
  }
  const { data, error } = await q;
  if (error) throw error;
  return { docs: (data || []).map((row) => ({ id: row.id, data: () => row })) };
}

// --- Stockage (Storage) --------------------------------------------------------------
// Tous les documents (photos, actes de naissance, CIN) sont stockés dans le bucket
// public "documents" (voir schema.sql pour la création du bucket et ses policies).
export async function uploadToStorage(path, file) {
  const { error } = await supabase.storage.from('documents').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('documents').getPublicUrl(path);
  return data.publicUrl;
}

// --- Génération atomique du matricule (fonction SQL "generate_matricule", voir schema.sql) --
export async function generateMatricule() {
  const { data, error } = await supabase.rpc('generate_matricule');
  if (error) throw error;
  return data;
}

// --- Gardes d'accès pour les pages -----------------------------------------------------
// requireAdmin : pour les pages avec #dashboard / #noSessionGate (espace-administration,
// admin-dashboard, gestion-enseignants, liste-eleves-admis...).
export function requireAdmin(onAuthenticated) {
  async function evaluate(user) {
    const gate = document.getElementById('noSessionGate');
    const dashboard = document.getElementById('dashboard');

    if (user) {
      const { data: adminRow } = await supabase.from('admins').select('*').eq('id', user.uid).maybeSingle();
      if (adminRow) {
        if (gate) gate.classList.add('hidden');
        if (dashboard) dashboard.classList.remove('hidden');
        onAuthenticated(user, adminRow);
        return;
      }
    }
    if (dashboard) dashboard.classList.add('hidden');
    if (gate) gate.classList.remove('hidden');
  }

  supabase.auth.getSession().then(({ data }) => {
    const user = data.session?.user;
    evaluate(user ? { uid: user.id, email: user.email } : null);
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    evaluate(user ? { uid: user.id, email: user.email } : null);
  });
}

// requireTeacher : pour les pages sans gate visuelle (espace-enseignant, saisie-notes) ;
// redirige directement vers connexion-enseignant.html si l'accès n'est pas valide.
export function requireTeacher(onAuthenticated) {
  let handled = false;
  async function evaluate(user) {
    if (!user) {
      if (!handled) { handled = true; window.location.href = 'connexion-enseignant.html'; }
      return;
    }
    const { data: teacherRow } = await supabase.from('teachers').select('*').eq('id', user.uid).maybeSingle();
    if (!teacherRow) {
      if (!handled) {
        handled = true;
        await supabase.auth.signOut();
        window.location.href = 'connexion-enseignant.html';
      }
      return;
    }
    onAuthenticated(user, teacherRow);
  }

  supabase.auth.getSession().then(({ data }) => {
    const user = data.session?.user;
    evaluate(user ? { uid: user.id, email: user.email } : null);
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    evaluate(user ? { uid: user.id, email: user.email } : null);
  });
}

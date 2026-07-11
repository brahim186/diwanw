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

// --- Domaine utilisé pour générer l'email de connexion d'un élève admis --------------
const STUDENT_EMAIL_DOMAIN = 'diwan-almaaref.ma';

function stripAccents(str) {
  return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Transforme "Mohamed" -> "mohamed" (minuscule, sans accents, sans espaces/tirets/apostrophes)
function slugPart(str) {
  return stripAccents(str).toLowerCase().replace(/[^a-z]/g, '');
}

// Construit prenom.nom@diwan-almaaref.ma (avec un suffixe numérique si ce préfixe
// existe déjà parmi les emails fournis, ex: mohamed.alami2@diwan-almaaref.ma)
export function generateStudentEmail(prenom, nom, existingEmails = []) {
  const base = `${slugPart(prenom)}.${slugPart(nom)}`;
  let local = base;
  let counter = 1;
  while (existingEmails.includes(`${local}@${STUDENT_EMAIL_DOMAIN}`)) {
    counter += 1;
    local = `${base}${counter}`;
  }
  return `${local}@${STUDENT_EMAIL_DOMAIN}`;
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

// Crée un compte Auth pour un élève admis, SANS déconnecter l'admin courant.
// Réutilise exactement le même mécanisme que createTeacherAuthAccount (client
// secondaire sans session persistée) : la fonction est générique, seul le nom change
// pour rester clair dans les pages qui l'utilisent.
export const createStudentAuthAccount = createTeacherAuthAccount;

// Traduit un matricule élève en email de connexion, via la fonction SQL
// "get_student_login_email" (security definer, voir schema.sql). Nécessaire car l'email
// d'un élève est généré à partir de son prénom/nom (generateStudentEmail) et n'est donc
// pas déductible directement du matricule côté client. Retourne null si le matricule ne
// correspond à aucun compte élève créé.
export async function matriculeToEmail(matricule) {
  const { data, error } = await supabase.rpc('get_student_login_email', { p_matricule: matricule });
  if (error) throw error;
  return data || null;
}

// --- Identifiants de connexion des élèves (table "student_credentials") --------------
// Écriture réservée aux comptes connectés (admin) via les policies RLS.
export async function saveStudentCredentials(uid, studentId, email, password) {
  const { error } = await supabase
    .from('student_credentials')
    .upsert({ id: uid, studentId: studentId, email, password });
  if (error) throw error;
}

// Lecture réservée aux comptes connectés (admin) — ex: ré-afficher un identifiant déjà créé.
export async function getStudentCredentialsByStudentId(studentId) {
  const { data, error } = await supabase
    .from('student_credentials')
    .select('*')
    .eq('studentId', studentId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Liste tous les emails élèves déjà attribués (pour éviter les doublons à la création).
export async function listStudentCredentialEmails() {
  const { data, error } = await supabase.from('student_credentials').select('email');
  if (error) throw error;
  return (data || []).map((row) => row.email);
}

// Lecture PUBLIQUE (visiteur non connecté) via la fonction SQL "get_student_credentials"
// (security definer) : ne révèle l'email/mot de passe que si le prénom + nom + matricule
// fournis correspondent exactement à un dossier au statut "Accepté". Utilisé par la page
// "Suivi de ma Demande" (consultation.html) pour révéler les identifiants d'un élève admis.
export async function fetchStudentCredentialsPublic(matricule, prenom, nom) {
  const { data, error } = await supabase.rpc('get_student_credentials', {
    p_matricule: matricule,
    p_prenom: prenom,
    p_nom: nom,
  });
  if (error) throw error;
  return (data && data[0]) || null;
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
  // Empêche onAuthenticated(...) d'être appelé deux fois pour la même session :
  // getSession() ET onAuthStateChange() se déclenchent quasi simultanément au
  // chargement de la page (comportement normal de Supabase v2), et sans ce garde
  // ça exécutait deux fois la logique de la page (ex: deux fetch + deux rendus du
  // tableau en parallèle -> lignes dupliquées visibles quelques instants).
  let lastHandledUid = null;

  async function evaluate(user) {
    const gate = document.getElementById('noSessionGate');
    const dashboard = document.getElementById('dashboard');

    if (user) {
      const { data: adminRow } = await supabase.from('admins').select('*').eq('id', user.uid).maybeSingle();
      if (adminRow) {
        if (gate) gate.classList.add('hidden');
        if (dashboard) dashboard.classList.remove('hidden');
        if (lastHandledUid !== user.uid) {
          lastHandledUid = user.uid;
          onAuthenticated(user, adminRow);
        }
        return;
      }
    }
    lastHandledUid = null;
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

// requireStudent : pour les pages sans gate visuelle (mes-notes) ; redirige directement
// vers connexion-eleve.html si l'accès n'est pas valide. Le profil passé à
// onAuthenticated(user, student) fusionne la ligne "student_credentials" (uid -> studentId)
// et la ligne "students" correspondante (fiche complète), avec un champ "matricule" ajouté.
export function requireStudent(onAuthenticated) {
  let handled = false;
  let lastHandledUid = null;

  async function evaluate(user) {
    if (!user) {
      lastHandledUid = null;
      if (!handled) { handled = true; window.location.href = 'connexion-eleve.html'; }
      return;
    }
    const { data: credRow } = await supabase
      .from('student_credentials')
      .select('*')
      .eq('id', user.uid)
      .maybeSingle();

    if (!credRow) {
      lastHandledUid = null;
      if (!handled) {
        handled = true;
        await supabase.auth.signOut();
        window.location.href = 'connexion-eleve.html';
      }
      return;
    }

    if (lastHandledUid !== user.uid) {
      lastHandledUid = user.uid;
      const { data: studentRow } = await supabase
        .from('students')
        .select('*')
        .eq('id', credRow.studentId)
        .maybeSingle();
      onAuthenticated(user, { ...(studentRow || {}), matricule: credRow.studentId });
    }
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
  // Même garde que requireAdmin : évite le double-appel de onAuthenticated(...)
  // causé par getSession() + onAuthStateChange() se déclenchant tous les deux au
  // chargement -> c'est ce qui produisait les lignes d'élèves dupliquées (même
  // matricule) qui disparaissaient après le second rendu "fantôme".
  let lastHandledUid = null;

  async function evaluate(user) {
    if (!user) {
      lastHandledUid = null;
      if (!handled) { handled = true; window.location.href = 'connexion-enseignant.html'; }
      return;
    }
    const { data: teacherRow } = await supabase.from('teachers').select('*').eq('id', user.uid).maybeSingle();
    if (!teacherRow) {
      lastHandledUid = null;
      if (!handled) {
        handled = true;
        await supabase.auth.signOut();
        window.location.href = 'connexion-enseignant.html';
      }
      return;
    }
    if (lastHandledUid !== user.uid) {
      lastHandledUid = user.uid;
      onAuthenticated(user, teacherRow);
    }
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

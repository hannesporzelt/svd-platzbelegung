// Authentifizierung & Nutzerprofile.
//
// Modell (Etappe 1):
//  - Betrachter:  anonymer Login (wie bisher) – kein Konto nötig, sieht den Plan.
//  - Trainer:     echtes Konto (E-Mail/Passwort). Rolle + zugeordnete Teams
//                 stehen im Firestore-Dokument users/{uid}.
//  - Platzwart:   echtes Konto mit role == "platzwart". Darf alles verwalten.
//
// Den ersten Platzwart legt man in der Firebase-Console an (Authentication ->
// Add user) und setzt dann in Firestore unter users/{uid} das Feld
// role = "platzwart" (siehe Anleitung für den Platzwart).
//
// Fallback: Solange noch KEIN Platzwart-Konto existiert bzw. man nicht
// eingeloggt ist, kann der Platzwart-Bereich notfalls weiterhin per Passwort
// (VITE_ADMIN_PASSWORD) betreten werden. So sperrt sich niemand aus, bevor die
// ersten Konten angelegt sind. Sobald echte Konten genutzt werden, sollte das
// Passwort entfernt werden (siehe Anleitung).

import { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || "1901";
const ADMIN_FLAG = "svd_isAdmin"; // Notfall-Fallback (PIN), sessiongebunden

export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);   // { role, teams, name } aus users/{uid}
  const [authReady, setAuthReady] = useState(false);
  // Notfall-Passwort-Flag (Fallback, falls noch kein echtes Konto existiert)
  const [pinAdmin, setPinAdmin] = useState(
    () => sessionStorage.getItem(ADMIN_FLAG) === "1"
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        // Niemand angemeldet -> anonym anmelden (Betrachter)
        setProfile(null);
        signInAnonymously(auth).catch(() => {});
        return;
      }
      setUser(u);
      if (u.isAnonymous) {
        setProfile(null);
        setAuthReady(true);
        return;
      }
      // Echtes Konto -> Profil laden
      try {
        const snap = await getDoc(doc(db, "users", u.uid));
        setProfile(snap.exists() ? snap.data() : null);
      } catch {
        setProfile(null);
      }
      setAuthReady(true);
    });
    return unsub;
  }, []);

  // ----- Anmeldung mit E-Mail/Passwort -----
  const loginEmail = async (email, password) => {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    // Profil sofort nachladen, damit Rolle/Teams ohne Verzoegerung da sind
    try {
      const snap = await getDoc(doc(db, "users", cred.user.uid));
      setProfile(snap.exists() ? snap.data() : null);
    } catch {
      setProfile(null);
    }
    return cred.user;
  };

  // ----- Passwort-zuruecksetzen-Mail -----
  const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());

  // ----- Abmelden (zurueck zum anonymen Betrachter) -----
  const logout = async () => {
    sessionStorage.removeItem(ADMIN_FLAG);
    setPinAdmin(false);
    setProfile(null);
    await signOut(auth); // onAuthStateChanged meldet danach wieder anonym an
  };

  // ----- Notfall-Fallback: Platzwart per Passwort (PIN) -----
  const loginAdminPin = (pw) => {
    if (pw === ADMIN_PASSWORD) {
      sessionStorage.setItem(ADMIN_FLAG, "1");
      setPinAdmin(true);
      return true;
    }
    return false;
  };

  // Abgeleitete Rollen
  const role = profile?.role || (pinAdmin ? "platzwart" : null);
  const isPlatzwart = role === "platzwart" || pinAdmin;
  const isTrainer = role === "trainer";
  // Teams, die ein eingeloggter Trainer betreuen darf (Liste). Platzwart: alle.
  const myTeams = Array.isArray(profile?.teams) ? profile.teams : [];
  const isLoggedIn = !!user && !user.isAnonymous;

  return {
    user,
    authReady,
    isLoggedIn,
    profile,
    role,
    isPlatzwart,
    isTrainer,
    myTeams,
    loginEmail,
    resetPassword,
    logout,
    // Fallback
    loginAdminPin,
    pinAdmin,
  };
}

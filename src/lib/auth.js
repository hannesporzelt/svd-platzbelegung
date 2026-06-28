// Authentifizierung & Nutzerprofile.

import { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";

// Start-PIN nur beim allerersten Mal (solange in Firestore noch keine PIN
// hinterlegt ist). Danach wird die in der App vom Admin gesetzte PIN benutzt.
const ADMIN_PASSWORD_FALLBACK = import.meta.env.VITE_ADMIN_PASSWORD || "1901";
const ADMIN_FLAG = "svd_isAdmin"; // Notfall-Fallback (PIN), sessiongebunden

export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [pinAdmin, setPinAdmin] = useState(
    () => sessionStorage.getItem(ADMIN_FLAG) === "1"
  );
  // Aktuelle Platzwart-PIN aus Firestore (config/security). Solange nichts
  // hinterlegt ist, gilt der Start-Wert (ADMIN_PASSWORD_FALLBACK).
  const [pin, setPin] = useState(ADMIN_PASSWORD_FALLBACK);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config", "security"),
      (snap) => {
        const v = snap.exists() ? snap.data()?.platzwartPin : null;
        setPin(v && String(v).length > 0 ? String(v) : ADMIN_PASSWORD_FALLBACK);
      },
      () => setPin(ADMIN_PASSWORD_FALLBACK)
    );
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
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

  const loginEmail = async (email, password) => {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    const ref = doc(db, "users", cred.user.uid);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        const neu = { email: cred.user.email || email.trim(), teams: [] };
        await setDoc(ref, neu, { merge: true });
        setProfile(neu);
      } else {
        const data = snap.data();
        if (!data.email && cred.user.email) {
          await setDoc(ref, { email: cred.user.email }, { merge: true });
          data.email = cred.user.email;
        }
        setProfile(data);
      }
    } catch {
      setProfile(null);
    }
    return cred.user;
  };

  const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());

  // ----- Selbst-Registrierung (neues Trainer-Konto) -----
  // Legt das Konto an und ein Profil OHNE Rolle. Der Platzwart schaltet
  // anschließend in der Nutzerverwaltung frei und weist Mannschaften zu.
  const registerEmail = async (email, password, name = "") => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const ref = doc(db, "users", cred.user.uid);
    const neu = { email: cred.user.email || email.trim(), teams: [] };
    if (name.trim()) neu.name = name.trim();
    await setDoc(ref, neu, { merge: true });
    setProfile(neu);
    return cred.user;
  };

  const logout = async () => {
    sessionStorage.removeItem(ADMIN_FLAG);
    setPinAdmin(false);
    setProfile(null);
    await signOut(auth);
  };

  const loginAdminPin = (pw) => {
    if (pw === pin) {
      sessionStorage.setItem(ADMIN_FLAG, "1");
      setPinAdmin(true);
      return true;
    }
    return false;
  };

  // PIN ändern – nur sinnvoll für Admin (wird in der UI so abgesichert).
  // Schreibt nach config/security; firestore.rules erlauben das nur Admins.
  const changePin = async (neuePin) => {
    const clean = String(neuePin || "").trim();
    if (clean.length < 4) throw new Error("PIN muss mindestens 4 Zeichen haben.");
    await setDoc(doc(db, "config", "security"), { platzwartPin: clean }, { merge: true });
    return true;
  };

  // ----- Rollen & Rechte -----
  // role im Profil kann sein: "admin" (Vorstand), "platzwart", "trainer".
  // Die PIN gibt NUR Platzwart-Ebene (niemals Admin).
  const role = profile?.role || (pinAdmin ? "platzwart" : null);
  const isVorstand = role === "admin"; // echter Admin/Vorstand
  // isPlatzwart = Platzwart-EBENE: Admin zählt mit, ebenso PIN-Notfallzugang.
  const isPlatzwart = role === "admin" || role === "platzwart" || pinAdmin;
  const isTrainer = role === "trainer";

  // Granulare Rechte für Platzwarte. Variante 2 (Altbestand-Schutz):
  // Fehlt das rights-Feld komplett -> Platzwart aus dem Altbestand -> alles erlaubt.
  // Sobald der Admin Rechte gesetzt hat, zählt nur noch das Objekt.
  // Admin und PIN-Notfallzugang haben immer alle vier Rechte.
  const rights = profile?.rights;
  const hasRight = (key) => {
    if (isVorstand || pinAdmin) return true;
    if (role !== "platzwart") return false;
    if (!rights || typeof rights !== "object") return true; // Altbestand
    return rights[key] === true;
  };
  const can = {
    irrigation: hasRight("irrigation"),
    locks: hasRight("locks"),
    messages: hasRight("messages"),
    notes: hasRight("notes"),
  };
  // Rückwärtskompatibel: bisher hieß das Recht canEditIrrigation
  const canEditIrrigation = can.irrigation;

  const myTeams = Array.isArray(profile?.teams) ? profile.teams : [];
  const isLoggedIn = !!user && !user.isAnonymous;

  return {
    user, authReady, isLoggedIn, profile, role,
    isVorstand, isPlatzwart, isTrainer, can, canEditIrrigation, myTeams,
    loginEmail, resetPassword, registerEmail, logout,
    loginAdminPin, pinAdmin, changePin,
  };
}

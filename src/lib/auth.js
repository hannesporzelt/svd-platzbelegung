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
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || "1901";
const ADMIN_FLAG = "svd_isAdmin"; // Notfall-Fallback (PIN), sessiongebunden

export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [pinAdmin, setPinAdmin] = useState(
    () => sessionStorage.getItem(ADMIN_FLAG) === "1"
  );

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
    if (pw === ADMIN_PASSWORD) {
      sessionStorage.setItem(ADMIN_FLAG, "1");
      setPinAdmin(true);
      return true;
    }
    return false;
  };

  const role = profile?.role || (pinAdmin ? "platzwart" : null);
  const isPlatzwart = role === "platzwart" || pinAdmin;
  const isTrainer = role === "trainer";
  const myTeams = Array.isArray(profile?.teams) ? profile.teams : [];
  const isLoggedIn = !!user && !user.isAnonymous;

  return {
    user, authReady, isLoggedIn, profile, role, isPlatzwart, isTrainer, myTeams,
    loginEmail, resetPassword, registerEmail, logout, loginAdminPin, pinAdmin,
  };
}

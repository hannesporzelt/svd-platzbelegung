// Authentifizierung & Nutzerprofile.
import { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "firebase/auth";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";

const ADMIN_PASSWORD_FALLBACK = import.meta.env.VITE_ADMIN_PASSWORD || "1901";
const ADMIN_FLAG = "svd_isAdmin";

export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [pinAdmin, setPinAdmin] = useState(
    () => sessionStorage.getItem(ADMIN_FLAG) === "1"
  );
  const [pin, setPin] = useState(ADMIN_PASSWORD_FALLBACK);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      doc(db, "config", "security"),
      (snap) => {
        const v = snap.exists() ? snap.data()?.platzwartPin : null;
        setPin(v && String(v).length > 0 ? String(v) : ADMIN_PASSWORD_FALLBACK);
      },
      () => setPin(ADMIN_PASSWORD_FALLBACK)
    );
    return unsub;
  }, [user]);

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

  // rememberMe: true = browserLocalPersistence (bleibt nach Browser-Neustart)
  //             false = browserSessionPersistence (nur bis Tab geschlossen)
  const loginEmail = async (email, password, rememberMe = true) => {
    await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
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

  // Selbst-Registrierung – speichert Rollen-Wunsch und Mannschafts-Wunsch.
  // Der Admin bestätigt in der Nutzerverwaltung; role bleibt bis dahin leer.
  const registerEmail = async (email, password, name = "", wunschRolle = "", wunschTeams = []) => {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const ref = doc(db, "users", cred.user.uid);
    const neu = {
      email: cred.user.email || email.trim(),
      teams: [],
    };
    if (name.trim()) neu.name = name.trim();
    // Wünsche speichern (kein echter role/teams-Eintrag – Admin muss freischalten)
    if (wunschRolle) neu.wunschRolle = wunschRolle;
    if (wunschTeams && wunschTeams.length > 0) neu.wunschTeams = wunschTeams;
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

  const changePin = async (neuePin) => {
    const clean = String(neuePin || "").trim();
    if (clean.length < 4) throw new Error("PIN muss mindestens 4 Zeichen haben.");
    await setDoc(doc(db, "config", "security"), { platzwartPin: clean }, { merge: true });
    return true;
  };

  const role = profile?.role || (pinAdmin ? "platzwart" : null);
  const isVorstand = role === "admin";
  const isPlatzwart = role === "admin" || role === "platzwart" || pinAdmin;
  const isTrainer = role === "trainer";

  const rights = profile?.rights;
  const hasRight = (key) => {
    if (isVorstand || pinAdmin) return true;
    if (role !== "platzwart") return false;
    if (!rights || typeof rights !== "object") return true;
    return rights[key] === true;
  };
  const can = {
    irrigation: hasRight("irrigation"),
    locks: hasRight("locks"),
    messages: hasRight("messages"),
    notes: hasRight("notes"),
  };
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

// Authentifizierung.
// Alle Besucher melden sich anonym an (für Firestore-Schreibrechte der Trainer).
// Der Admin-Status wird zusätzlich über ein Passwort freigeschaltet.
//
// Das Admin-Passwort liegt in VITE_ADMIN_PASSWORD (Netlify-Env-Variable).
// Hinweis: Da Frontend-Code im Browser läuft, ist das ein praktikabler,
// aber kein hochsicherer Schutz. Wer echte Kontotrennung braucht, nutzt
// Firebase-Custom-Claims (siehe README, Abschnitt "Härtere Sicherheit").

import { useEffect, useState } from "react";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "./firebase";

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || "1901";
const ADMIN_FLAG = "svd_isAdmin";

export function useAuth() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(
    () => sessionStorage.getItem(ADMIN_FLAG) === "1"
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) setUser(u);
      else signInAnonymously(auth).catch(() => {});
    });
    return unsub;
  }, []);

  const loginAdmin = (pw) => {
    if (pw === ADMIN_PASSWORD) {
      sessionStorage.setItem(ADMIN_FLAG, "1");
      setIsAdmin(true);
      return true;
    }
    return false;
  };
  const logoutAdmin = () => {
    sessionStorage.removeItem(ADMIN_FLAG);
    setIsAdmin(false);
  };

  return { user, isAdmin, loginAdmin, logoutAdmin };
}

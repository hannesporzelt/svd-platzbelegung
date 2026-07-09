// api/maehplan-sync.js
// Cron-Job: Synchronisiert Heimspiele aus der Platzbelegung-Firestore
// in die Mähplan-Realtime-Database (_syncedGames).
// Läuft täglich um 03:00 Uhr (siehe vercel.json).
// Gesichert via CRON_SECRET (Bearer-Token im Authorization-Header).

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getDatabase } from "firebase-admin/database";

// ── Authentifizierung ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Nur POST-Anfragen mit korrektem Secret erlauben
  const authHeader = req.headers["authorization"] || "";
  const secret = process.env.CRON_SECRET || "";
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ── Firebase Admin – Platzbelegung (Firestore) ───────────────────────────
  let platzbelegungApp;
  const existingPlatz = getApps().find(a => a.name === "platzbelegung-cron");
  if (existingPlatz) {
    platzbelegungApp = existingPlatz;
  } else {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    platzbelegungApp = initializeApp(
      { credential: cert(serviceAccount) },
      "platzbelegung-cron"
    );
  }

  // ── Firebase Admin – Mähplan (Realtime Database) ─────────────────────────
  let maehplanApp;
  const existingMaeh = getApps().find(a => a.name === "maehplan-cron");
  if (existingMaeh) {
    maehplanApp = existingMaeh;
  } else {
    const maehServiceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_MAEHPLAN || "{}"
    );
    maehplanApp = initializeApp(
      {
        credential: cert(maehServiceAccount),
        databaseURL: "https://svd-maehplan-default-rtdb.europe-west1.firebasedatabase.app",
      },
      "maehplan-cron"
    );
  }

  const fsDb  = getFirestore(platzbelegungApp);
  const rtDb  = getDatabase(maehplanApp);

  const FIELD_MAP = { p1: "Platz 1", p2: "Platz 2", p3: "Platz 3" };
  const TEAM_MAP  = {
    m1: "1. Mannschaft", m2: "2. Mannschaft", m3: "3. Mannschaft",
    ah: "Alte Herren", u19: "U19", u17: "U17", u16: "U16", u15: "U15",
    u14: "U14", u13: "U13", u12: "U12", u11: "U11", u10: "U10", u9: "U9", u7: "U7",
  };

  try {
    // Alle kommenden Heimspiele aus Firestore laden (ab heute)
    const today = new Date().toISOString().slice(0, 10);
    const snap = await fsDb.collection("bookings")
      .where("kind", "==", "match")
      .where("date", ">=", today)
      .get();

    // In Mähplan-Format umwandeln
    const syncedGames = {};
    snap.forEach(docSnap => {
      const b = docSnap.data();
      const field = FIELD_MAP[b.field];
      if (!field) return;
      const key = "sync_" + docSnap.id.replace(/[^A-Za-z0-9_]/g, "_");
      syncedGames[key] = {
        id: key,
        date: b.date,
        time: b.start || "",
        team: TEAM_MAP[b.team] || b.team || "",
        opponent: b.opponent || "Gegner",
        field,
      };
    });

    // Alles auf einmal in die Mähplan-DB schreiben (überschreibt _syncedGames komplett)
    await rtDb.ref("maehplan/_syncedGames").set(
      Object.keys(syncedGames).length > 0 ? syncedGames : null
    );

    console.log(`Mähplan-Sync: ${Object.keys(syncedGames).length} Heimspiele synchronisiert.`);
    return res.status(200).json({
      ok: true,
      synced: Object.keys(syncedGames).length,
      date: today,
    });
  } catch (e) {
    console.error("Mähplan-Sync Fehler:", e.message);
    return res.status(500).json({ error: e.message });
  }
}

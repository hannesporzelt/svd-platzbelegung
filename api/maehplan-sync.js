// api/maehplan-sync.js
// Synchronisiert kommende Heimspiele aus der Platzbelegung-Firestore
// in die Mähplan-Realtime-Database (maehplan/_syncedGames).
//
// Läuft täglich um 03:00 Uhr (vercel.json) UND kann manuell aufgerufen werden.
//
// Benötigt die Umgebungsvariablen in Vercel:
//  - CRON_SECRET                       (identisch mit cron-import.js)
//  - FIREBASE_SERVICE_ACCOUNT          (Platzbelegung – für Firestore-Lesen)
//  - FIREBASE_SERVICE_ACCOUNT_MAEHPLAN (Mähplan – für Realtime DB schreiben)

import admin from "firebase-admin";

// ---- Firebase-Admin: Platzbelegung (Firestore) ----
function getFirestoreDb() {
  // Default-App (wie in cron-import.js) wiederverwenden oder anlegen
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin.firestore();
}

// ---- Firebase-Admin: Mähplan (Realtime Database) ----
function getMaehplanDb() {
  const name = "maehplan-sync";
  let app = admin.apps.find(a => a.name === name);
  if (!app) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_MAEHPLAN;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_MAEHPLAN fehlt");
    app = admin.initializeApp(
      {
        credential: admin.credential.cert(JSON.parse(raw)),
        databaseURL: "https://svd-maehplan-default-rtdb.europe-west1.firebasedatabase.app",
      },
      name
    );
  }
  return admin.database(app);
}

// ---- Mapping: Firestore-Felder → Mähplan-Format ----
const FIELD_MAP = { p1: "Platz 1", p2: "Platz 2", p3: "Platz 3" };
const TEAM_MAP  = {
  m1: "1. Mannschaft", m2: "2. Mannschaft", m3: "3. Mannschaft",
  ah: "Alte Herren", sr: "Schiedsrichter",
  u19: "U19", u17: "U17", u16: "U16", u15: "U15",
  u14: "U14", u13: "U13", u12: "U12", u11: "U11",
  u10: "U10", u9: "U9",  u7:  "U7",
};

function todayKeyBerlin() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// ---- Handler ----
export default async function handler(req, res) {
  // Absicherung: CRON_SECRET prüfen (POST oder GET, Vercel Cron nutzt GET)
  const auth   = req.headers.authorization || "";
  // Eigener Schlüssel für Mähplan-Sync (MAEHPLAN_SYNC_SECRET in Vercel setzen).
  // Fällt auf CRON_SECRET zurück falls MAEHPLAN_SYNC_SECRET nicht gesetzt.
  const secret = process.env.MAEHPLAN_SYNC_SECRET || process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Nicht autorisiert." });
  }

  try {
    const fs    = getFirestoreDb();
    const rtDb  = getMaehplanDb();
    const today = todayKeyBerlin();

    // Alle kommenden, freigegebenen Heimspiele aus Firestore laden
    const snap = await fs.collection("bookings")
      .where("kind",  "==", "match")
      .where("date",  ">=", today)
      .get();

    // In Mähplan-Format umwandeln (Anträge überspringen)
    const syncedGames = {};
    snap.forEach(doc => {
      const b = doc.data();
      if (b.status === "beantragt") return;
      const field = FIELD_MAP[b.field];
      if (!field) return;
      const key = "sync_" + doc.id.replace(/[^A-Za-z0-9_]/g, "_");
      syncedGames[key] = {
        id:       key,
        date:     b.date              || "",
        time:     b.start             || "",
        team:     TEAM_MAP[b.team]    || b.team || "",
        opponent: b.opponent          || "Gegner",
        field,
      };
    });

    // Komplett in Mähplan-DB schreiben (überschreibt _syncedGames vollständig)
    await rtDb.ref("maehplan/_syncedGames")
      .set(Object.keys(syncedGames).length > 0 ? syncedGames : null);

    const count = Object.keys(syncedGames).length;
    console.log(`Mähplan-Sync: ${count} Heimspiel(e) synchronisiert.`);
    return res.status(200).json({ ok: true, synced: count, date: today });

  } catch (e) {
    console.error("Mähplan-Sync Fehler:", e.message);
    return res.status(500).json({ error: e.message || "Unbekannter Fehler" });
  }
}

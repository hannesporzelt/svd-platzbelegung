// api/migrate-maehplan.js
// Einmaliger Migrations-Script: Liest alle Mähplan-Daten aus der
// Realtime Database und schreibt sie in Firestore.
//
// Aufruf (einmalig, in Browser-Konsole):
//   fetch("https://svd-platzbelegung.vercel.app/api/migrate-maehplan", {
//     method: "POST",
//     headers: { "Authorization": "Bearer DEIN_CRON_SECRET" }
//   }).then(r => r.json()).then(console.log)
//
// Benötigt in Vercel:
//   CRON_SECRET
//   FIREBASE_SERVICE_ACCOUNT          (Platzbelegung – Firestore schreiben)
//   FIREBASE_SERVICE_ACCOUNT_MAEHPLAN (Mähplan – Realtime DB lesen)

import admin from "firebase-admin";

function getFirestoreDb() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin.firestore();
}

function getMaehplanRtDb() {
  const name = "maehplan-migrate";
  let app = admin.apps.find(a => a.name === name);
  if (!app) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_MAEHPLAN;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_MAEHPLAN fehlt");
    app = admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(raw)),
      databaseURL: "https://svd-maehplan-default-rtdb.europe-west1.firebasedatabase.app",
    }, name);
  }
  return admin.database(app);
}

// Platz-Name → Firestore-ID
const FIELD_ID = { "Platz 1": "p1", "Platz 2": "p2", "Platz 3": "p3" };

export default async function handler(req, res) {
  const auth   = req.headers.authorization || "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Nicht autorisiert." });
  }

  try {
    const fs   = getFirestoreDb();
    const rtDb = getMaehplanRtDb();

    // 1. Daten aus Realtime DB lesen
    const snap = await rtDb.ref("maehplan").once("value");
    const raw  = snap.val();
    if (!raw) return res.status(200).json({ ok: true, message: "Keine Daten in Realtime DB." });

    // JSON-Blob parsen (die App speichert alles als JSON-String)
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;

    const batch = fs.batch();
    let count = 0;

    // 2. Wochenplan pro Platz (maehplan_plan)
    const currentKW = data._currentKW || null;
    for (const [name, field] of Object.entries(data)) {
      if (name.startsWith("_")) continue;
      const fieldId = FIELD_ID[name];
      if (!fieldId) continue;
      const doc = {
        name,
        notes:       field.notes       || "",
        bemerkung:   field.bemerkung   || "",
        colorBg:     field.colorBg     || "#1a3a1a",
        colorAccent: field.colorAccent || "#4caf50",
        colorLight:  field.colorLight  || "#e8f5e9",
        colorBorder: field.colorBorder || "#2e7d32",
        tasks:       field.tasks       || [],
        updatedTs:   Date.now(),
      };
      // KW nur bei p1 speichern (wird von allen Plätzen geteilt)
      if (fieldId === "p1" && currentKW) doc.currentKW = currentKW;
      batch.set(fs.collection("maehplan_plan").doc(fieldId), doc);
      count++;
    }

    // 3. Arbeitsprotokoll (maehplan_worklog)
    for (const entry of (data._worklog || [])) {
      batch.set(
        fs.collection("maehplan_worklog").doc(entry.id),
        { ...entry, ts: entry.ts || Date.now() }
      );
      count++;
    }

    // 4. Pflegemaßnahmen (maehplan_maintenance)
    for (const entry of (data._maintenanceLog || [])) {
      batch.set(
        fs.collection("maehplan_maintenance").doc(entry.id),
        { ...entry, ts: entry.ts || Date.now() }
      );
      count++;
    }

    // 5. Vormerkungen (maehplan_signups)
    for (const entry of (data._futureSignups || [])) {
      batch.set(
        fs.collection("maehplan_signups").doc(entry.id),
        entry
      );
      count++;
    }

    // 6. Saisonarchiv (maehplan_archive)
    for (const entry of (data._seasonArchive || [])) {
      if (!entry.id) continue;
      batch.set(
        fs.collection("maehplan_archive").doc(entry.id),
        entry
      );
      count++;
    }

    // Heimspiele (_homeGames) werden NICHT migriert –
    // sie kommen direkt aus der bookings-Collection.

    await batch.commit();

    console.log(`Migration abgeschlossen: ${count} Dokumente nach Firestore geschrieben.`);
    return res.status(200).json({ ok: true, migrated: count });

  } catch (e) {
    console.error("Migration Fehler:", e.message);
    return res.status(500).json({ error: e.message });
  }
}

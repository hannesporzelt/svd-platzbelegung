// Nächtlicher Auto-Import der BFV-Heimspiele (Vercel Cron).
//
// Ablauf:
//  1. Prüft das CRON_SECRET (nur Vercel darf auslösen).
//  2. Liest die hinterlegten Kalender aus Firestore (irrigation/_calendars).
//  3. Holt jeden BFV-Kalender, erkennt Heimspiele (Ort enthält "Dörfleins").
//  4. Legt NUR NEUE Spiele an (bfv-<UID>); bestehende werden NIE geändert.
//
// Benötigt die Umgebungsvariablen bei Vercel:
//  - CRON_SECRET            (beliebiger Zufallswert, >= 16 Zeichen)
//  - FIREBASE_SERVICE_ACCOUNT (kompletter JSON-Inhalt des Service-Account-Schlüssels)

import admin from "firebase-admin";

// ---- Firebase-Admin einmalig initialisieren ----
function getDb() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt");
    const cred = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(cred) });
  }
  return admin.firestore();
}

// ---- iCal-Hilfen (eigenständig, ohne Browser-Abhängigkeiten) ----
const unfold = (t) => (t || "").replace(/\r?\n[ \t]/g, "");
const unesc = (s) => (s || "").replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");

function parseIcsDate(raw) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec((raw || "").trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) {
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    const fmt = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const p = fmt.formatToParts(dt).reduce((a, x) => (a[x.type] = x.value, a), {});
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

const fieldFromLoc = (loc) => {
  const m = /Platz\s*(\d+)/i.exec(loc || "");
  return m ? "p" + m[1] : null;
};
function teamsFromSummary(sum) {
  const first = (sum || "").split(",")[0];
  const dash = first.indexOf("-");
  if (dash < 0) return { home: first.trim(), guest: "" };
  return { home: first.slice(0, dash).trim(), guest: first.slice(dash + 1).trim() };
}
const addMin = (hhmm, mins) => {
  const [h, m] = (hhmm || "0:0").split(":").map(Number);
  const t = h * 60 + m + mins;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

function gamesFromIcs(ics, todayKey) {
  const text = unfold(ics);
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  const out = [];
  for (const b of blocks) {
    const body = b.split("END:VEVENT")[0];
    const get = (k) => {
      const m = new RegExp("^" + k + "(?:;[^:]*)?:(.*)$", "mi").exec(body);
      return m ? unesc(m[1].trim()) : "";
    };
    const start = parseIcsDate(get("DTSTART"));
    if (!start) continue;
    const loc = get("LOCATION");
    const isHome = loc.toLowerCase().includes("dörfleins");
    if (todayKey && start.date < todayKey) continue;
    const end = parseIcsDate(get("DTEND"));
    const sum = get("SUMMARY");
    const { home, guest } = teamsFromSummary(sum);
    out.push({
      date: start.date, time: start.time, endTime: end ? end.time : null,
      field: isHome ? fieldFromLoc(loc) : null, isHome, location: loc, home, guest,
      title: sum ? sum.split(",")[0] : `${home} - ${guest}`,
      uid: get("UID"),
    });
  }
  return out;
}

function todayKeyBerlin() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

export default async function handler(req, res) {
  // 1. Absicherung: nur Vercel-Cron mit korrektem Secret
  const auth = req.headers.authorization || "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Nicht autorisiert." });
    return;
  }

  try {
    const db = getDb();

    // 2. Kalender-Liste lesen
    const calSnap = await db.collection("irrigation").doc("_calendars").get();
    const list = (calSnap.exists && calSnap.data().list) || [];
    if (!Array.isArray(list) || list.length === 0) {
      res.status(200).json({ ok: true, message: "Keine Kalender hinterlegt.", added: 0 });
      return;
    }

    const today = todayKeyBerlin();

    // Bestehende künftige Heimspiele auf Platz 1 laden – für die Aufwärm-Regel unten.
    // Bewusst NUR Gleichheitsfilter (field, kind) in der Firestore-Abfrage, damit kein
    // zusammengesetzter Index in der Firebase-Konsole angelegt werden muss; der
    // Datumsfilter (>= heute) passiert danach einfach in JavaScript.
    const existingP1Snap = await db.collection("bookings")
      .where("field", "==", "p1").where("kind", "==", "match").get();
    const existingP1 = existingP1Snap.docs.map((d) => d.data()).filter((b) => b.date >= today);

    // 3. Alle Spiele (Heim + Auswärts) aus allen Kalendern sammeln
    const games = [];
    for (const c of list) {
      try {
        const r = await fetch(c.url, { headers: { "User-Agent": "SVD-Cron/1.0" } });
        if (!r.ok) continue;
        const text = await r.text();
        gamesFromIcs(text, today).forEach((g) => games.push({ ...g, team: c.team }));
      } catch { /* Kalender überspringen */ }
    }

    // Aufwärm-Vorschlag bestimmen (dieselbe Regel wie im manuellen Formular):
    // Platz 2 → immer Aufwärmen auf Platz 3. Platz 1 → Aufwärmen auf Platz 2, falls
    // ein anderes Heimspiel (neu oder schon gespeichert) am selben Tag auf Platz 1
    // endet, das ≤45 Min vor dem Anpfiff dieses Spiels liegt.
    const toMin = (t) => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + m; };
    const p1Pool = [...existingP1, ...games.filter((g) => g.isHome && g.field === "p1")];
    const warmupFor = (g) => {
      if (g.field === "p2") return "p3";
      if (g.field === "p1") {
        const newStart = toMin(g.time);
        const clash = p1Pool.some((o) =>
          o !== g && o.date === g.date &&
          !((o.start || o.time) === g.time && (o.end || o.endTime) === g.endTime) &&
          toMin(o.end || o.endTime) <= newStart && newStart - toMin(o.end || o.endTime) <= 45
        );
        if (clash) return "p2";
      }
      return null;
    };

    // 4. NUR NEUE anlegen (bestehende nie ändern) – Heimspiele -> bookings, Auswärtsspiele -> awayGames
    let added = 0;
    let addedAway = 0;
    for (const g of games) {
      if (!g.uid) continue;
      const id = "bfv-" + String(g.uid).replace(/[^A-Za-z0-9_:-]/g, "");
      if (g.isHome) {
        if (!g.field) continue;
        const ref = db.collection("bookings").doc(id);
        const exists = (await ref.get()).exists;
        if (exists) continue; // Bestehendes NIE anfassen
        await ref.set({
          date: g.date, field: g.field,
          zone: g.field === "p1" ? "voll" : "h1",
          team: g.team, start: g.time, end: g.endTime || addMin(g.time, 100),
          kind: "match", status: "frei", title: g.title, opponent: g.guest || "",
          ...(warmupFor(g) ? { warmupField: warmupFor(g) } : {}),
          bfvUid: g.uid, source: "bfv", ownerUid: "cron",
        });
        added++;
      } else {
        const ref = db.collection("awayGames").doc(id);
        const exists = (await ref.get()).exists;
        if (exists) continue; // Bestehendes NIE anfassen
        await ref.set({
          date: g.date, team: g.team, start: g.time, end: g.endTime || addMin(g.time, 100),
          opponent: g.home || "", venue: g.location || "", title: g.title,
          bfvUid: g.uid, source: "bfv", ownerUid: "cron",
        });
        addedAway++;
      }
    }

    res.status(200).json({ ok: true, scanned: games.length, added, addedAway });
  } catch (e) {
    res.status(500).json({ error: e.message || "Fehler" });
  }
}

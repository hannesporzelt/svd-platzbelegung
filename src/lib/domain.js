// Domänenlogik (frameworkfrei, gut testbar)

export const TEAMS = [
  { id: "m1", name: "1. Mannschaft", color: "#1d4ed8" },
  { id: "m2", name: "2. Mannschaft", color: "#0ea5e9" },
  { id: "m3", name: "3. Mannschaft", color: "#0891b2" },
  { id: "ah", name: "Alte Herren", color: "#525252" },
  { id: "sr", name: "Schiedsrichter", color: "#1a1a1a" },
  { id: "u19", name: "U19", color: "#15803d" },
  { id: "u17", name: "U17", color: "#65a30d" },
  { id: "u17_2", name: "U17/2", color: "#0d9488" },
  { id: "u15", name: "U15", color: "#b91c1c" },
  { id: "u15_2", name: "U15/2", color: "#ea580c" },
  { id: "u13", name: "U13", color: "#6d28d9" },
  { id: "u13_2", name: "U13/2", color: "#c026d3" },
  { id: "u13_3", name: "U13/3", color: "#0369a1" },
  { id: "u13_w", name: "U13 w", color: "#e11d8f" },
  { id: "u11", name: "U11", color: "#9d174d" },
  { id: "u9", name: "U9", color: "#a16207" },
  { id: "u7", name: "U7", color: "#7c2d12" },
  { id: "turnier", name: "Turnier", color: "#1e293b" },
];
export const teamById = (id) => TEAMS.find((t) => t.id === id);

export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const WEEKDAYS_LONG = [
  "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag",
];

// Platz 2: V1+V2 = Hälfte Oberhaid, V3+V4 = Hälfte Hallstadt
// Wählbare Einheiten: ganzer Platz, je eine Hälfte, oder einzelne Viertel.
export const FIELDS = [
  { id: "p1", name: "Platz 1", subtitle: "Spiele · U7-Training", zones: [{ id: "voll", label: "Ganzer Platz" }] },
  {
    id: "p2", name: "Platz 2", subtitle: "Trainingsplatz · ganz / Hälfte / Viertel",
    zones: [
      { id: "p2_voll", label: "Ganzer Platz 2" },
      { id: "h_ob", label: "Hälfte Oberhaid (V1+V2)" },
      { id: "h_ha", label: "Hälfte Hallstadt (V3+V4)" },
      { id: "v1", label: "Viertel 1 · Oberhaid" }, { id: "v2", label: "Viertel 2 · Oberhaid" },
      { id: "v3", label: "Viertel 3 · Hallstadt" }, { id: "v4", label: "Viertel 4 · Hallstadt" },
    ],
  },
  {
    id: "p3", name: "Platz 3", subtitle: "Trainingsplatz · 2 Hälften",
    zones: [{ id: "h1", label: "Hälfte 1" }, { id: "h2", label: "Hälfte 2 · Bahndamm" }],
  },
];
export const fieldById = (id) => FIELDS.find((f) => f.id === id);

// Welche "atomaren" Teilflächen belegt eine Zone? Überlappung = gemeinsame Teilfläche.
const ZONE_UNITS = {
  // Platz 2
  p2_voll: ["v1", "v2", "v3", "v4"],
  h_ob: ["v1", "v2"],
  h_ha: ["v3", "v4"],
  v1: ["v1"], v2: ["v2"], v3: ["v3"], v4: ["v4"],
  // Platz 3
  h1: ["h1"], h2: ["h2"],
  // Platz 1
  voll: ["voll"],
};
const unitsOf = (zone) => ZONE_UNITS[zone] || [zone];
export const zoneCovers = (zone, unit) => unitsOf(zone).includes(unit);


// ---------- Datums-Hilfen (ISO-Woche, Mo=Start) ----------
export const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(
    x.getDate()
  ).padStart(2, "0")}`;
};
export const mondayOf = (d) => {
  const x = new Date(d);
  const wd = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - wd);
  x.setHours(0, 0, 0, 0);
  return x;
};
export const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
export const isoWeek = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7));
  const week1 = new Date(x.getFullYear(), 0, 4);
  return 1 + Math.round(((x - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
};
export const fmtRange = (mon) => {
  const sun = addDays(mon, 6);
  const o = { day: "numeric", month: "short" };
  return `${mon.toLocaleDateString("de-DE", o)} – ${sun.toLocaleDateString("de-DE", {
    ...o, year: "numeric",
  })}`;
};

// ---------- Wiederkehrende Termine (Serien) ----------
// Erzeugt alle Datumswerte (als dayKey) für einen Wochentag zwischen
// Start- und Enddatum (beide inklusive). weekday: 0=Mo .. 6=So.
export const expandRecurrence = (fromKey, toKey, weekday) => {
  const out = [];
  if (!fromKey || !toKey) return out;
  const start = new Date(fromKey + "T12:00");
  const end = new Date(toKey + "T12:00");
  if (isNaN(start) || isNaN(end) || end < start) return out;
  // erstes Vorkommen des Wochentags ab Start finden
  const cur = new Date(start);
  const curWd = (cur.getDay() + 6) % 7;
  let diff = (weekday - curWd + 7) % 7;
  cur.setDate(cur.getDate() + diff);
  // Sicherheitsgrenze: max. ~2 Jahre an Wochen
  let guard = 0;
  while (cur <= end && guard < 110) {
    out.push(dayKey(cur));
    cur.setDate(cur.getDate() + 7);
    guard++;
  }
  return out;
};

// ---------- (entfernt) Auto-Belegung 1./2. Mannschaft ----------
export const autoTrainingForDay = (date) => [];

// ---------- Doppelbelegung erkennen ----------
const toMin = (t) => {
  const [h, m] = (t || "0:0").split(":").map(Number);
  return h * 60 + m;
};
const minToTime = (mins) => {
  const m = Math.max(0, Math.min(24 * 60, mins));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// Vor-/Nachlauf bei Heimspielen: 60 Min Aufwärmen davor, 15 Min Abbau danach.
export const MATCH_PRE_MIN = 60;
export const MATCH_POST_MIN = 15;
export const effectiveSpan = (e, allEntries) => {
  if (e && e.kind === "match") {
    const warmupElsewhere = e.warmupField && e.warmupField !== e.field;
    let pre = warmupElsewhere ? 0 : MATCH_PRE_MIN;
    let post = MATCH_POST_MIN;
    if (Array.isArray(allEntries)) {
      const eStart = toMin(e.start);
      const eEnd = toMin(e.end);
      // Gibt es ein Folge-Heimspiel auf demselben Platz (Abstand <=45 Min)?
      // Dann entfaellt der Nachlauf dieses Spiels (Abbau parallel zum naechsten).
      const nextMatch = allEntries.find((o) =>
        o.id !== e.id && o.kind === "match" && o.field === e.field &&
        o.status !== "beantragt" &&
        toMin(o.start) >= eEnd && toMin(o.start) - eEnd <= 45
      );
      if (nextMatch) post = 0;
      // Gibt es ein Vorgaenger-Heimspiel auf demselben Platz (Abstand <=45 Min)?
      // Dann entfaellt der Vorlauf dieses Spiels (Aufwaermen auf anderem Platz).
      if (!warmupElsewhere && pre > 0) {
        const prevMatch = allEntries.find((o) =>
          o.id !== e.id && o.kind === "match" && o.field === e.field &&
          o.status !== "beantragt" &&
          toMin(o.end) <= eStart && eStart - toMin(o.end) <= 45
        );
        if (prevMatch) pre = 0;
      }
    }
    return { start: minToTime(toMin(e.start) - pre), end: minToTime(toMin(e.end) + post) };
  }
  return { start: e.start, end: e.end };
};

export const timeOverlap = (a, b, allEntries) => {
  const ea = effectiveSpan(a, allEntries), eb = effectiveSpan(b, allEntries);
  return toMin(ea.start) < toMin(eb.end) && toMin(eb.start) < toMin(ea.end);
};

export const zonesOverlap = (a, b) => {
  if (a.field !== b.field) return false;
  if (a.zone === b.zone) return true;
  if (a.field === "p1") return true; // Platz 1 voll = überlappt alles
  const ua = unitsOf(a.zone), ub = unitsOf(b.zone);
  return ua.some((u) => ub.includes(u));
};

export const findConflicts = (candidate, existing) =>
  existing.filter(
    (e) => e.id !== candidate.id && zonesOverlap(candidate, e) && timeOverlap(candidate, e, existing)
  );

const fullZoneOf = (fieldId) => {
  const f = fieldById(fieldId);
  return f ? f.zones[0].id : null;
};

// Dieselbe Auto-Aufwärm-Regel wie im manuellen Heimspiel-Formular, aber für ganze
// Stapel von (importierten) Spielen: Platz 2 → immer Aufwärmen auf Platz 3.
// Platz 1 → Aufwärmen auf Platz 2, falls am selben Tag ein anderes Heimspiel auf
// Platz 1 endet, das ≤45 Min vor dem Anpfiff dieses Spiels liegt. Bereits gesetzte
// warmupField-Werte (z. B. manuell korrigiert) werden nie überschrieben.
export function applyWarmupSuggestions(newBookings, existingBookings) {
  const toMin = (t) => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + m; };
  const allMatches = [...(existingBookings || []), ...newBookings].filter(
    (b) => b.kind === "match" && b.status !== "beantragt"
  );
  return newBookings.map((b) => {
    if (b.kind !== "match" || b.warmupField) return b;
    if (b.field === "p2") return { ...b, warmupField: "p3" };
    if (b.field === "p1") {
      const newStart = toMin(b.start);
      const clash = allMatches.some((o) =>
        o !== b && o.field === "p1" && o.date === b.date &&
        !(o.start === b.start && o.end === b.end) &&
        toMin(o.end) <= newStart && newStart - toMin(o.end) <= 45
      );
      if (clash) return { ...b, warmupField: "p2" };
    }
    return b;
  });
}
export const warmupBlockFor = (match) => {
  if (!match || match.kind !== "match") return null;
  if (!match.warmupField || match.warmupField === match.field) return null;
  return {
    id: (match.id || "match") + "_warmup",
    date: match.date,
    field: match.warmupField,
    zone: fullZoneOf(match.warmupField),
    team: match.team,
    start: minToTime(toMin(match.start) - MATCH_PRE_MIN),
    end: match.start,
    kind: "warmup",
    status: match.status || "frei",
    auto: true, // synthetisch – kein eigenes Firestore-Dokument, nicht löschbar/verschiebbar
  };
};

// Konflikte über einen ganzen Tag (für Admin-Hinweise): Paare finden
export const conflictIdsForEntries = (entries) => {
  const ids = new Set();
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++)
      if (zonesOverlap(entries[i], entries[j]) && timeOverlap(entries[i], entries[j], entries)) {
        ids.add(entries[i].id);
        ids.add(entries[j].id);
      }
  return ids;
};

// ====================================================================
//  BEREGNUNG – Zeitberechnung & Pumpen-Überschneidungsprüfung
//  Wichtig: GEMEINSAME PUMPE -> es darf zu keinem Zeitpunkt mehr als
//  eine Station laufen, auch plattformübergreifend.
// ====================================================================

// Sekundengenaue Hilfen (Beregnung rechnet teils in Sekunden wegen 5-Sek-Pausen)
const toSec = (t) => {
  const [h, m] = (t || "0:0").split(":").map(Number);
  return (h * 60 + m) * 60;
};
const secToTime = (s) => {
  const x = Math.max(0, Math.round(s));
  const hh = String(Math.floor(x / 3600) % 24).padStart(2, "0");
  const mm = String(Math.floor((x % 3600) / 60)).padStart(2, "0");
  return `${hh}:${mm}`;
};
const secToTimeS = (s) => {
  const x = Math.max(0, Math.round(s));
  const hh = String(Math.floor(x / 3600) % 24).padStart(2, "0");
  const mm = String(Math.floor((x % 3600) / 60)).padStart(2, "0");
  const ss = String(x % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};

// Erzeugt die Zeitfenster aller Stationen eines Durchgangs ab Startzeit.
// stationOrder: Array von Stationsnummern in Ablaufreihenfolge.
// runMin: Laufzeit je Station, gapSec: Pause zwischen Stationen.
export const buildPassWindows = (startTime, stationOrder, runMin, gapSec) => {
  const out = [];
  let t = toSec(startTime);
  stationOrder.forEach((st, i) => {
    const start = t;
    const end = start + runMin * 60;
    out.push({ station: st, startSec: start, endSec: end,
               start: secToTime(start), end: secToTime(end) });
    t = end + (i < stationOrder.length - 1 ? gapSec : 0);
  });
  return out;
};

// Kompletter Plan eines Platzes (alle Durchgänge) -> flache Fensterliste.
// plan: { starts:["00:45","03:55"], stationOrder:[1..12], runMin, gapSec, fieldId }
export const buildIrrigationWindows = (plan) => {
  if (!plan || !Array.isArray(plan.starts)) return [];
  const order = plan.stationOrder && plan.stationOrder.length
    ? plan.stationOrder
    : Array.from({ length: plan.stations || 12 }, (_, i) => i + 1);
  const all = [];
  plan.starts.forEach((s, pass) => {
    if (!s) return;
    buildPassWindows(s, order, plan.runMin || 15, plan.gapSec || 0)
      .forEach((w) => all.push({ ...w, pass: pass + 1, field: plan.fieldId }));
  });
  return all;
};

const windowsOverlap = (a, b) => a.startSec < b.endSec && b.startSec < a.endSec;

// Für die einfache 💧-Anzeige (Kalender-Badges, PDFs) reicht "läuft an diesem Tag
// IRGENDEIN Programm dieses Platzes" – das ist die Vereinigung der Tage aller
// Programme. Fällt auf die alte feld-weite "days"-Liste zurück, falls noch kein
// Programm eigene Tage hat (Altdaten vor der Umstellung auf Tage pro Programm).
export const unionIrrigationDays = (fieldIrr) => {
  if (!fieldIrr) return [];
  const progs = fieldIrr.programmes || {};
  const set = new Set();
  let anyProgHasDays = false;
  Object.values(progs).forEach((p) => {
    if (Array.isArray(p.days) && p.days.length > 0) {
      anyProgHasDays = true;
      p.days.forEach((d) => set.add(d));
    }
  });
  if (!anyProgHasDays && Array.isArray(fieldIrr.days)) {
    fieldIrr.days.forEach((d) => set.add(d));
  }
  return Array.from(set);
};

// Prüft eine Liste von Fenstern (z. B. aus mehreren Plätzen zusammengeführt)
// auf Überschneidungen. Gibt Paare zurück, die sich zeitlich überlappen.
export const findIrrigationOverlaps = (windows) => {
  const conflicts = [];
  const sorted = windows.slice().sort((a, b) => a.startSec - b.startSec);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].startSec >= sorted[i].endSec) break; // nichts Späteres kann mehr überlappen
      if (windowsOverlap(sorted[i], sorted[j])) {
        conflicts.push([sorted[i], sorted[j]]);
      }
    }
  }
  return conflicts;
};

// Gesamtdauer eines Durchgangs in Sekunden (für Rückwärtsrechnung).
export const passDurationSec = (stationCount, runMin, gapSec) =>
  stationCount * runMin * 60 + Math.max(0, stationCount - 1) * gapSec;

// Kurzprogramm Heimspiel: aus Anpfiff die Startzeit zurückrechnen, sodass
// die Beregnung "endOffsetMin" vor Anpfiff endet.
export const kickoffToStart = (kickoff, totalDurationSec, endOffsetMin = 30) => {
  const endSec = toSec(kickoff) - endOffsetMin * 60;
  const startSec = endSec - totalDurationSec;
  return { start: secToTime(startSec), end: secToTime(endSec),
           startExact: secToTimeS(startSec), endExact: secToTimeS(endSec) };
};

export const irrTimeFmt = { secToTime, secToTimeS, toSec };

// ====================================================================
//  iCAL-IMPORT (BFV-Spielplan)
//  Parst ICS-Text, erkennt Heimspiele (Ort enthält "Dörfleins"),
//  liest Platz aus dem Ort und rechnet UTC -> lokale Zeit um.
// ====================================================================

// ICS entfaltet "gefaltete" Zeilen (Fortsetzung beginnt mit Leerzeichen).
const unfoldIcs = (text) => (text || "").replace(/\r?\n[ \t]/g, "");

// ICS-Wert entschärfen (\, \; \n)
const icsUnescape = (s) => (s || "")
  .replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");

// "20260705T163000Z" -> {date:"2026-07-05", time:"18:30"} (UTC -> Europe/Berlin)
const parseIcsDate = (raw) => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec((raw || "").trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) {
    // UTC -> Europe/Berlin (berücksichtigt automatisch Sommer-/Winterzeit)
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    const fmt = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = fmt.formatToParts(dt).reduce((a, p) => (a[p.type] = p.value, a), {});
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
};

// Platz aus dem Ort lesen: "...Platz 2,..." -> "p2"
const fieldFromLocation = (loc) => {
  const m = /Platz\s*(\d+)/i.exec(loc || "");
  if (!m) return null;
  return "p" + m[1];
};

// Heim-/Gastmannschaft aus dem Titel "Heim-Gast, Wettbewerb, ..."
const teamsFromSummary = (sum) => {
  const firstPart = (sum || "").split(",")[0]; // "SV Dörfleins - SC Kemmern"
  // Wichtig: nach " - " (mit Leerzeichen) trennen, NICHT nur nach "-" – sonst
  // reißt ein Bindestrich MITTEN im Vereinsnamen (z. B. "JFG Main-Kreuzberg
  // Kickers") die Heim-/Gastmannschaft an der falschen Stelle auseinander.
  const dash = firstPart.indexOf(" - ");
  if (dash >= 0) {
    return { home: firstPart.slice(0, dash).trim(), guest: firstPart.slice(dash + 3).trim() };
  }
  // Fallback, falls ausnahmsweise kein Leerzeichen-Bindestrich vorkommt
  const bare = firstPart.indexOf("-");
  if (bare < 0) return { home: firstPart.trim(), guest: "" };
  return { home: firstPart.slice(0, bare).trim(), guest: firstPart.slice(bare + 1).trim() };
};

// Parst kompletten ICS-Text -> Array aller Spiele
export const parseIcsGames = (icsText) => {
  const text = unfoldIcs(icsText);
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  const games = [];
  blocks.forEach((b) => {
    const body = b.split("END:VEVENT")[0];
    const get = (key) => {
      const re = new RegExp("^" + key + "(?:;[^:]*)?:(.*)$", "mi");
      const m = re.exec(body);
      return m ? icsUnescape(m[1].trim()) : "";
    };
    const start = parseIcsDate(get("DTSTART"));
    if (!start) return;
    const end = parseIcsDate(get("DTEND"));
    const summary = get("SUMMARY");
    const location = get("LOCATION");
    const { home, guest } = teamsFromSummary(summary);
    games.push({
      date: start.date, time: start.time,
      endTime: end ? end.time : null,
      summary, location, home, guest,
      field: fieldFromLocation(location),
      uid: get("UID"),
    });
  });
  return games;
};

// Wandelt erkannte BFV-Heimspiele in Buchungs-Einträge (kind=match) um.
// teamId = die App-Mannschaft, der dieser Kalender zugeordnet ist.
export const icsGamesToBookings = (games, teamId) => {
  return (games || [])
    .filter((g) => g.field) // nur mit erkanntem Platz
    .map((g) => ({
      date: g.date,
      field: g.field,
      zone: fullZoneOf(g.field) || "voll",
      team: teamId || g.team,
      start: g.time,
      end: g.endTime || addMinutes(g.time, 100), // Fallback 100 Min
      kind: "match",
      status: "frei",
      title: g.summary ? g.summary.split(",")[0] : `${g.home} - ${g.guest}`,
      opponent: g.guest || "",
      bfvUid: g.uid,
    }));
};

// kleine Zeit-Hilfe (HH:MM + Minuten)
const addMinutes = (hhmm, mins) => {
  const [h, m] = (hhmm || "0:0").split(":").map(Number);
  const total = h * 60 + m + mins;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
};
export const homeGamesFromIcs = (icsText, todayKey, homeNeedle = "Dörfleins") => {
  const needle = homeNeedle.toLowerCase();
  return parseIcsGames(icsText)
    .filter((g) => (g.location || "").toLowerCase().includes(needle))
    .filter((g) => !todayKey || g.date >= todayKey)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
};

// Kehrseite von homeGamesFromIcs: alles, was NICHT am eigenen Standort liegt,
// ist ein Auswärtsspiel. Nutzt denselben geladenen ICS-Text, kein Zusatz-Abruf nötig.
export const awayGamesFromIcs = (icsText, todayKey, homeNeedle = "Dörfleins") => {
  const needle = homeNeedle.toLowerCase();
  return parseIcsGames(icsText)
    .filter((g) => !(g.location || "").toLowerCase().includes(needle))
    .filter((g) => !todayKey || g.date >= todayKey)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
};

// Wandelt erkannte Auswärtsspiele in rein informative Kalender-Einträge um.
// Kein eigener Platz, keine Zone, keine Konfliktprüfung – nur Anzeige.
// Gegner = "home" aus dem Spieltitel, weil bei einem Auswärtsspiel die
// gastgebende Mannschaft (nicht wir) an erster Stelle im Titel steht.
export const icsGamesToAwayGames = (games, teamId) => {
  return (games || []).map((g) => ({
    date: g.date,
    team: teamId || g.team,
    start: g.time,
    end: g.endTime || addMinutes(g.time, 100),
    opponent: g.home || "",
    venue: g.location || "",
    title: g.summary ? g.summary.split(",")[0] : `${g.home} - ${g.guest}`,
    bfvUid: g.uid,
  }));
};

// ====================================================================
//  HEIMSPIEL-AUTOMATIK
//  Findet kommende Heimspiele (kind=match) der ausgewählten Mannschaften,
//  nimmt pro Tag+Platz den FRÜHESTEN Anpfiff und berechnet die
//  Kurzberegnungs-Startzeiten (Programm B + C bzw. ein Durchgang).
// ====================================================================

// cfg pro Platz: { runMin, gapSec, torStations:[...], endOffsetMin }
export const computeMatchIrrigation = (bookings, triggerTeams, cfgByField, todayKey) => {
  const isTrigger = (t) => Array.isArray(triggerTeams) && triggerTeams.includes(t);
  // nur Heimspiele ab heute, mit auslösender Mannschaft
  const matches = (bookings || []).filter(
    (b) => b.kind === "match" && b.team && isTrigger(b.team) && (!todayKey || b.date >= todayKey)
  );
  // pro Datum + Platz frühesten Anpfiff bestimmen
  const earliest = {}; // key date|field -> booking
  matches.forEach((b) => {
    const key = `${b.date}|${b.field}`;
    if (!earliest[key] || toSec(b.start) < toSec(earliest[key].start)) earliest[key] = b;
  });

  const result = [];
  Object.values(earliest).forEach((b) => {
    const cfg = (cfgByField && cfgByField[b.field]) || {};
    const runMin = cfg.runMin || 5;
    const gapSec = cfg.gapSec || 5;
    const endOffset = cfg.endOffsetMin != null ? cfg.endOffsetMin : 30;
    const tor = Array.isArray(cfg.torStations) ? cfg.torStations : [];
    const stations = cfg.stations || 12;

    if (tor.length > 0 && tor.length < stations) {
      // Zwei-Programm-Lösung: Tor-Regner zuletzt (Prog. C), Rest davor (Prog. B)
      const torDur = passDurationSec(tor.length, runMin, gapSec);
      const restDur = passDurationSec(stations - tor.length, runMin, gapSec);
      const c = kickoffToStart(b.start, torDur, endOffset);
      const bb = kickoffToStart(c.start, restDur, 0);
      result.push({
        date: b.date, field: b.field, team: b.team, kickoff: b.start,
        mode: "BC",
        progB: bb.start, progC: c.start, end: c.end,
        torStations: tor,
      });
    } else {
      // Ein Durchgang über alle Stationen
      const dur = passDurationSec(stations, runMin, gapSec);
      const one = kickoffToStart(b.start, dur, endOffset);
      result.push({
        date: b.date, field: b.field, team: b.team, kickoff: b.start,
        mode: "ONE",
        start: one.start, end: one.end,
      });
    }
  });
  // nach Datum sortieren
  result.sort((a, b) => (a.date + a.field).localeCompare(b.date + b.field));
  return result;
};

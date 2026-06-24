// Domänenlogik (frameworkfrei, gut testbar)

export const TEAMS = [
  { id: "m1", name: "1. Mannschaft", color: "#1d4ed8" },
  { id: "m2", name: "2. Mannschaft", color: "#0ea5e9" },
  { id: "ah", name: "Alte Herren", color: "#525252" },
  { id: "sr", name: "Schiedsrichter", color: "#facc15" },
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
    zones: [{ id: "h1", label: "Hälfte 1" }, { id: "h2", label: "Hälfte 2" }],
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
// Früher wurde das Di/Do-Training der 1./2. Mannschaft fest erzeugt.
// Auf Wunsch entfernt: Es wird jetzt ganz normal über
// "Belegung eintragen -> Wiederkehrend" als Serie angelegt.
// Die Funktion bleibt als leere Liste erhalten, damit die
// Konfliktprüfung an allen Stellen unverändert weiterläuft.
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
// Die gespeicherte Anstoß-/Endzeit bleibt unverändert – diese Funktion liefert
// nur die EFFEKTIV belegte Zeitspanne für Konfliktprüfung und Anzeige.
// Ist das Aufwärmen auf einen ANDEREN Platz ausgelagert (warmupField gesetzt und
// != Spielplatz), entfällt der 60-Min-Vorlauf auf dem Spielplatz – dort gilt dann
// nur Anstoß bis Ende + 15 Min Abbau. Das Aufwärmen wird als eigener Block geführt.
export const MATCH_PRE_MIN = 60;
export const MATCH_POST_MIN = 15;
export const effectiveSpan = (e) => {
  if (e && e.kind === "match") {
    const warmupElsewhere = e.warmupField && e.warmupField !== e.field;
    const pre = warmupElsewhere ? 0 : MATCH_PRE_MIN;
    return { start: minToTime(toMin(e.start) - pre), end: minToTime(toMin(e.end) + MATCH_POST_MIN) };
  }
  // Aufwärm-Block (eigener Eintrag): exakt die gespeicherte Zeit
  return { start: e.start, end: e.end };
};

export const timeOverlap = (a, b) => {
  const ea = effectiveSpan(a), eb = effectiveSpan(b);
  return toMin(ea.start) < toMin(eb.end) && toMin(eb.start) < toMin(ea.end);
};

export const zonesOverlap = (a, b) => {
  if (a.field !== b.field) return false;
  if (a.zone === b.zone) return true;
  if (a.field === "p1") return true; // Platz 1 voll = überlappt alles
  // Überlappung, wenn die belegten Teilflächen sich schneiden
  const ua = unitsOf(a.zone), ub = unitsOf(b.zone);
  return ua.some((u) => ub.includes(u));
};

export const findConflicts = (candidate, existing) =>
  existing.filter(
    (e) => e.id !== candidate.id && zonesOverlap(candidate, e) && timeOverlap(candidate, e)
  );

// Aufwärm-Block für ein Heimspiel mit ausgelagertem Aufwärmen.
// Liefert null, wenn kein separater Block nötig ist (Aufwärmen auf dem Spielplatz).
// Der Block belegt den ganzen Aufwärmplatz von Anstoß-60 bis Anstoß.
const fullZoneOf = (fieldId) => {
  const f = fieldById(fieldId);
  return f ? f.zones[0].id : null;
};
export const warmupBlockFor = (match) => {
  if (!match || match.kind !== "match") return null;
  if (!match.warmupField || match.warmupField === match.field) return null;
  return {
    date: match.date,
    field: match.warmupField,
    zone: fullZoneOf(match.warmupField),
    team: match.team,
    start: minToTime(toMin(match.start) - MATCH_PRE_MIN),
    end: match.start,
    kind: "warmup",          // eigener Typ: Aufwärmen
    status: match.status || "frei",
  };
};

// Konflikte über einen ganzen Tag (für Admin-Hinweise): Paare finden
export const conflictIdsForEntries = (entries) => {
  const ids = new Set();
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++)
      if (zonesOverlap(entries[i], entries[j]) && timeOverlap(entries[i], entries[j])) {
        ids.add(entries[i].id);
        ids.add(entries[j].id);
      }
  return ids;
};

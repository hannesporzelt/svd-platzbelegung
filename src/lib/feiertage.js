// Bayerische Feiertage und Schulferien.
//
// FEIERTAGE: werden automatisch für jedes Jahr berechnet (auch bewegliche wie
//   Ostern/Pfingsten/Fronleichnam über die Osterformel). Hier muss man nie etwas pflegen.
//
// SCHULFERIEN: lassen sich NICHT berechnen – sie werden vom Kultusministerium
//   jährlich festgelegt. Sie stehen unten in SCHULFERIEN als feste Liste.
//   ┌──────────────────────────────────────────────────────────────────┐
//   │  NEUE SCHULJAHRE ERGÄNZEN:                                         │
//   │  Sobald das Ministerium neue Termine veröffentlicht, einfach unten │
//   │  in SCHULFERIEN einen weiteren Block nach demselben Muster anfügen. │
//   │  Quelle: https://www.km.bayern.de/termine/ferien-und-feiertage     │
//   └──────────────────────────────────────────────────────────────────┘

import { dayKey } from "./domain";

// ---- Ostersonntag (Gauß'sche Osterformel) -> Date ----
function osterSonntag(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=März, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const addD = (date, n) => { const x = new Date(date); x.setDate(x.getDate() + n); return x; };

// ---- Gesetzliche Feiertage in Bayern für ein Jahr (Map: dayKey -> Name) ----
// Hinweis: Mariä Himmelfahrt (15.8.) gilt nur in überwiegend katholischen
// Gemeinden – für Dörfleins (Lkr. Bamberg) zutreffend, daher enthalten.
export function feiertageBayern(year) {
  const ostern = osterSonntag(year);
  const feste = [
    [`${year}-01-01`, "Neujahr"],
    [`${year}-01-06`, "Heilige Drei Könige"],
    [`${year}-05-01`, "Tag der Arbeit"],
    [`${year}-08-15`, "Mariä Himmelfahrt"],
    [`${year}-10-03`, "Tag der Deutschen Einheit"],
    [`${year}-11-01`, "Allerheiligen"],
    [`${year}-12-25`, "1. Weihnachtsfeiertag"],
    [`${year}-12-26`, "2. Weihnachtsfeiertag"],
  ];
  const beweglich = [
    [dayKey(addD(ostern, -2)), "Karfreitag"],
    [dayKey(ostern), "Ostersonntag"],
    [dayKey(addD(ostern, 1)), "Ostermontag"],
    [dayKey(addD(ostern, 39)), "Christi Himmelfahrt"],
    [dayKey(addD(ostern, 49)), "Pfingstsonntag"],
    [dayKey(addD(ostern, 50)), "Pfingstmontag"],
    [dayKey(addD(ostern, 60)), "Fronleichnam"],
  ];
  const map = {};
  [...feste, ...beweglich].forEach(([k, name]) => { map[k] = name; });
  return map;
}

// ---- Schulferien Bayern (feste Termine laut Staatsministerium) ----
// Jeder Eintrag: { name, von: "YYYY-MM-DD", bis: "YYYY-MM-DD" } (beide inkl.)
// Quelle: Bayerisches Ministerialblatt 2022 Nr. 747.
export const SCHULFERIEN = [
  // Schuljahr 2025/2026
  { name: "Herbstferien", von: "2025-11-03", bis: "2025-11-07" },
  { name: "Weihnachtsferien", von: "2025-12-22", bis: "2026-01-05" },
  { name: "Frühjahrsferien", von: "2026-02-16", bis: "2026-02-20" },
  { name: "Osterferien", von: "2026-03-30", bis: "2026-04-10" },
  { name: "Pfingstferien", von: "2026-05-26", bis: "2026-06-05" },
  { name: "Sommerferien", von: "2026-08-03", bis: "2026-09-14" },
  // Schuljahr 2026/2027
  { name: "Herbstferien", von: "2026-11-02", bis: "2026-11-06" },
  { name: "Weihnachtsferien", von: "2026-12-24", bis: "2027-01-08" },
  { name: "Frühjahrsferien", von: "2027-02-08", bis: "2027-02-12" },
  { name: "Osterferien", von: "2027-03-22", bis: "2027-04-02" },
  { name: "Pfingstferien", von: "2027-05-18", bis: "2027-05-28" },
  { name: "Sommerferien", von: "2027-08-02", bis: "2027-09-13" },
  // ---- Hier neue Schuljahre anfügen (siehe Hinweis oben) ----
];

// Liefert für einen Tag (Date) den Ferien-Namen oder null.
export function ferienAn(date) {
  const k = dayKey(date);
  const f = SCHULFERIEN.find((s) => k >= s.von && k <= s.bis);
  return f ? f.name : null;
}

// Liefert für einen Tag (Date) den Feiertags-Namen oder null.
export function feiertagAn(date) {
  const map = feiertageBayern(date.getFullYear());
  return map[dayKey(date)] || null;
}

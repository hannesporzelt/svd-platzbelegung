// src/components/MaehplanPanel.jsx
// Integrierter Mähplan – vollständig (Sitzung 1+2)
// Tabs: Wochenplan · Monatskalender · Pflegemaßnahmen · Protokoll · Auswertung

import React, { useState, useMemo, useEffect } from "react";
import {
  useMaehplan,
  WEEKDAYS_MP, WEEKDAYS_FULL, TYPE_ICONS, TYPE_LABELS,
  MAINTENANCE_TYPES, MONTHS_NO_MOW, getDateOfISOWeek, getISOWeek,
  advanceKW, FIELD_NAMES, DEFAULT_PLAN,
} from "../lib/maehplan";
import { C, S } from "../lib/styles";
import { dayKey } from "../lib/domain";

// ── Hilfsstile ────────────────────────────────────────────────────────
const mp = {
  card: (light, border) => ({
    background: light, border: `1px solid ${border}`,
    borderRadius: 12, padding: 14, marginBottom: 14,
  }),
  taskRow: (done, accent) => ({
    border: `1px solid ${done ? "#d1fae5" : "#e5e7eb"}`,
    borderLeft: `4px solid ${done ? "#10b981" : accent}`,
    borderRadius: 8, padding: "10px 12px", marginBottom: 8,
    background: done ? "#f0fdf4" : "#fff", opacity: done ? 0.75 : 1,
  }),
  personTag: {
    display: "inline-flex", alignItems: "center", gap: 4,
    background: "#e5e7eb", borderRadius: 20, padding: "2px 8px",
    fontSize: 12, marginRight: 4, marginBottom: 4,
  },
  btn: { border: `1px solid ${C.border}`, background: "#fff", color: C.ink,
    borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12 },
  okBtn: { border: "none", background: "#10b981", color: "#fff",
    borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600 },
  delBtn: { border: "none", background: "#fef2f2", color: "#dc2626",
    borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12 },
  hint: (bg, border, color) => ({
    fontSize: 12, background: bg, color: color || C.textSec,
    border: `1px solid ${border}`, borderRadius: 8,
    padding: "6px 10px", marginBottom: 10,
  }),
};

const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("de-DE",
  { weekday: "short", day: "numeric", month: "short" });
const fmtDateLong = (d) => new Date(d + "T00:00:00").toLocaleDateString("de-DE",
  { weekday: "long", day: "numeric", month: "long", year: "numeric" });

// ── Wettervorhersage (Open-Meteo, kein API-Key) ───────────────────────
function useWeather() {
  const [weather, setWeather] = useState(null);
  useEffect(() => {
    fetch("https://api.open-meteo.com/v1/forecast?latitude=50.13&longitude=11.05" +
      "&daily=precipitation_sum,temperature_2m_min,temperature_2m_max" +
      "&hourly=temperature_2m&timezone=Europe%2FBerlin&forecast_days=7")
      .then(r => r.json())
      .then(data => {
        if (!data.daily) return;
        const days = data.daily.time.map((date, i) => ({
          date,
          rain: data.daily.precipitation_sum[i] || 0,
          tMin: Math.round(data.daily.temperature_2m_min[i]),
          tMax: Math.round(data.daily.temperature_2m_max[i]),
        }));
        setWeather(days);
      })
      .catch(() => {});
  }, []);
  return weather;
}

// ── Wetter-Badge ─────────────────────────────────────────────────────
function WeatherBadge({ weather, dayIndex }) {
  if (!weather || !weather[dayIndex]) return null;
  const w = weather[dayIndex];
  const icon = w.rain > 5 ? "🌧️" : w.rain > 1 ? "🌦️" : "☀️";
  const color = w.rain > 5 ? "#1d4ed8" : w.rain > 1 ? "#0891b2" : "#15803d";
  return (
    <span style={{ fontSize: 11, color, marginLeft: 6 }}>
      {icon} {w.tMin}–{w.tMax}°C{w.rain > 0.5 ? ` · ${w.rain.toFixed(1)}mm` : ""}
    </span>
  );
}

// ── Aufgaben-Karte ────────────────────────────────────────────────────
function TaskCard({ fieldId, task, accent, canEdit, mpHooks, weather }) {
  const [personInput, setPersonInput] = useState("");
  const [postponeOpen, setPostponeOpen] = useState(false);
  const [postponeDay, setPostponeDay] = useState(
    task.postponedTo !== undefined ? task.postponedTo : task.dayIndex ?? 0
  );
  const [postponeReason, setPostponeReason] = useState(task.postponeReason || "");

  const isPostponed = task.postponedTo !== undefined && task.postponedTo !== null;
  const effectiveDay = task.postponedTo !== undefined ? task.postponedTo : task.dayIndex;

  const handleAddPerson = async () => {
    const name = personInput.trim();
    if (!name) return;
    await mpHooks.addPerson(fieldId, task.id, name);
    setPersonInput("");
  };

  return (
    <div style={mp.taskRow(task.done, accent)}>
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
        <div>
          <span style={{ fontSize: 16 }}>{TYPE_ICONS[task.type] || "📋"}</span>
          {" "}
          <span style={{ fontWeight: 600, fontSize: 14 }}>{TYPE_LABELS[task.type] || task.type}</span>
          {" "}
          <span style={{ fontSize: 12, color: C.textSec }}>
            {task.freeDay
              ? (effectiveDay !== null && effectiveDay !== undefined
                  ? `→ ${WEEKDAYS_FULL[effectiveDay]}` : "(Tag frei wählbar)")
              : `→ ${effectiveDay !== null && effectiveDay !== undefined
                  ? WEEKDAYS_FULL[effectiveDay] : "?"}`}
          </span>
          {weather && effectiveDay !== null && effectiveDay !== undefined && (
            <WeatherBadge weather={weather} dayIndex={effectiveDay} />
          )}
          {isPostponed && (
            <span style={{ fontSize: 11, background: "#fef3c7", color: "#92400e",
              borderRadius: 10, padding: "1px 7px", marginLeft: 6 }}>
              verschoben{task.postponeReason ? ` · ${task.postponeReason}` : ""}
            </span>
          )}
        </div>
        <button onClick={() => mpHooks.toggleDone(fieldId, task.id)}
          style={{ ...mp.btn, background: task.done ? "#10b981" : "#fff",
            color: task.done ? "#fff" : C.textSec, minWidth: 32 }}>
          {task.done ? "✓" : "○"}
        </button>
      </div>

      {task.note && (
        <div style={{ fontSize: 11, color: C.textSec, marginTop: 4, fontStyle: "italic" }}>
          {task.note}
        </div>
      )}

      {/* Personen */}
      <div style={{ marginTop: 8 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
          {(task.persons || []).map((p, i) => (
            <span key={i} style={mp.personTag}>
              👤 {p}
              <button onClick={() => mpHooks.removePerson(fieldId, task.id, i)}
                style={{ background: "none", border: "none", cursor: "pointer",
                  color: "#6b7280", fontSize: 11, padding: 0 }}>✕</button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input type="text" value={personInput}
            onChange={e => setPersonInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAddPerson()}
            placeholder="Name eintragen…"
            style={{ ...S.select, flex: 1, fontSize: 12 }} />
          <button onClick={handleAddPerson} style={mp.okBtn}>+ Eintragen</button>
        </div>
      </div>

      {/* Freier Tag */}
      {task.freeDay && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Tag wählen:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {WEEKDAYS_MP.slice(0, 6).map((wd, i) => (
              <button key={i} onClick={() => mpHooks.setFreeDay(fieldId, task.id, i)}
                style={{ ...mp.btn,
                  background: effectiveDay === i ? accent : "#fff",
                  color: effectiveDay === i ? "#fff" : C.ink,
                  borderColor: effectiveDay === i ? accent : C.border }}>
                {wd}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Verschieben */}
      {canEdit && !task.freeDay && (
        <div style={{ marginTop: 8 }}>
          {!postponeOpen ? (
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setPostponeOpen(true)} style={mp.btn}>↔ Verschieben</button>
              {isPostponed && (
                <button onClick={() => mpHooks.cancelPostpone(fieldId, task.id)}
                  style={{ ...mp.btn, color: "#dc2626" }}>Zurücksetzen</button>
              )}
            </div>
          ) : (
            <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb",
              borderRadius: 8, padding: 10, marginTop: 6 }}>
              <div style={{ fontSize: 12, color: C.textSec, marginBottom: 6 }}>Auf welchen Tag?</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {WEEKDAYS_MP.slice(0, 6).map((wd, i) => (
                  <button key={i} onClick={() => setPostponeDay(i)}
                    style={{ ...mp.btn,
                      background: postponeDay === i ? accent : "#fff",
                      color: postponeDay === i ? "#fff" : C.ink,
                      borderColor: postponeDay === i ? accent : C.border }}>
                    {wd}
                  </button>
                ))}
              </div>
              <input type="text" value={postponeReason}
                onChange={e => setPostponeReason(e.target.value)}
                placeholder="Grund (optional)"
                style={{ ...S.select, fontSize: 12, marginBottom: 8,
                  width: "100%", boxSizing: "border-box" }} />
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={async () => {
                  await mpHooks.postponeTask(fieldId, task.id, postponeDay, postponeReason);
                  setPostponeOpen(false);
                }} style={mp.okBtn}>Speichern</button>
                <button onClick={() => setPostponeOpen(false)} style={mp.btn}>Abbrechen</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Platz-Karte ───────────────────────────────────────────────────────
function FieldCard({ fieldId, fieldData, signups, canEdit, mpHooks, homeGames, weather }) {
  const [bemerkungEdit, setBemerkungEdit] = useState(false);
  const [bemerkungVal, setBemerkungVal] = useState(fieldData.bemerkung || "");

  const accent = fieldData.colorAccent || "#4caf50";
  const light  = fieldData.colorLight  || "#e8f5e9";
  const border = fieldData.colorBorder || "#2e7d32";

  const today = new Date(); today.setHours(0,0,0,0);
  const nextGame = homeGames
    .filter(g => g.field === FIELD_NAMES[fieldId] && new Date(g.date + "T00:00:00") >= today)
    .sort((a,b) => a.date.localeCompare(b.date))[0] || null;

  const nowMonth = new Date().getMonth() + 1;
  const isWinter = MONTHS_NO_MOW.includes(nowMonth);

  return (
    <div style={mp.card(light, border)}>
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: accent }}>
          {fieldData.name || FIELD_NAMES[fieldId]}
        </span>
        <span style={{ fontSize: 12, color: C.textSec }}>{fieldData.notes}</span>
      </div>

      {isWinter && (
        <div style={mp.hint("#f0f9ff", "#bae6fd", "#0369a1")}>
          ❄️ Winterpause – kein Mähen November bis Februar.
        </div>
      )}
      {nextGame && (
        <div style={mp.hint("#fff7ed", "#fed7aa", "#c2410c")}>
          ⚽ Nächstes Heimspiel:{" "}
          <b>{fmtDate(nextGame.date)}</b>
          {nextGame.start ? ` · ${nextGame.start} Uhr` : ""}
          {nextGame.opponent ? ` · vs. ${nextGame.opponent}` : ""}
        </div>
      )}

      {(fieldData.tasks || []).map(task => (
        <TaskCard key={task.id} fieldId={fieldId} task={task}
          accent={accent} canEdit={canEdit} mpHooks={mpHooks} weather={weather} />
      ))}

      {/* Bemerkung */}
      <div style={{ marginTop: 8 }}>
        {bemerkungEdit ? (
          <div>
            <textarea value={bemerkungVal} onChange={e => setBemerkungVal(e.target.value)}
              rows={2} placeholder="Bemerkung zur aktuellen Woche…"
              style={{ ...S.select, width: "100%", boxSizing: "border-box",
                resize: "vertical", fontSize: 12 }} />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button onClick={async () => {
                await mpHooks.updateBemerkung(fieldId, bemerkungVal);
                setBemerkungEdit(false);
              }} style={mp.okBtn}>Speichern</button>
              <button onClick={() => setBemerkungEdit(false)} style={mp.btn}>Abbrechen</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: C.textSec, fontStyle: "italic" }}>
              {fieldData.bemerkung || "Keine Bemerkung"}
            </span>
            <button onClick={() => { setBemerkungVal(fieldData.bemerkung || ""); setBemerkungEdit(true); }}
              style={{ ...mp.btn, fontSize: 11 }}>✎ Bemerkung</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Monatskalender ────────────────────────────────────────────────────
function MonatskalenderTab({ homeGames, worklog, maintenance, kw }) {
  const [calDate, setCalDate] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });

  const year  = calDate.getFullYear();
  const month = calDate.getMonth();

  const shiftMonth = (delta) => {
    const d = new Date(year, month + delta, 1);
    setCalDate(d);
  };

  const MONTHS = ["Januar","Februar","März","April","Mai","Juni",
    "Juli","August","September","Oktober","November","Dezember"];

  // Kalender-Grid: Montag-basiert
  const first = new Date(year, month, 1);
  const gridStart = new Date(first);
  const dow = (first.getDay() + 6) % 7;
  gridStart.setDate(first.getDate() - dow);

  const cells = [];
  const cur = new Date(gridStart);
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  const usedRows = cells.some((d, i) => i >= 35 && d.getMonth() === month) ? 6 : 5;
  const shown = cells.slice(0, usedRows * 7);

  // Daten nach Datum gruppieren
  const gamesByDate = {};
  homeGames.forEach(g => {
    if (!gamesByDate[g.date]) gamesByDate[g.date] = [];
    gamesByDate[g.date].push(g);
  });
  const workByDate = {};
  worklog.forEach(w => {
    if (!workByDate[w.date]) workByDate[w.date] = [];
    workByDate[w.date].push(w);
  });
  const maintByDate = {};
  maintenance.forEach(m => {
    if (!maintByDate[m.date]) maintByDate[m.date] = [];
    maintByDate[m.date].push(m);
  });

  const todayStr = dayKey(new Date());
  const WD = ["Mo","Di","Mi","Do","Fr","Sa","So"];

  return (
    <div>
      {/* Navigation */}
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 12 }}>
        <button onClick={() => shiftMonth(-1)} style={mp.btn}>‹</button>
        <span style={{ fontWeight: 700, fontSize: 16 }}>{MONTHS[month]} {year}</span>
        <button onClick={() => shiftMonth(1)} style={mp.btn}>›</button>
      </div>

      {/* Wochentagsköpfe */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 3 }}>
        {WD.map(w => (
          <div key={w} style={{ textAlign: "center", fontSize: 11,
            fontWeight: 600, color: C.textSec, padding: "4px 0" }}>{w}</div>
        ))}
      </div>

      {/* Kalenderzellen */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {shown.map((d, i) => {
          const dk = dayKey(d);
          const inMonth = d.getMonth() === month;
          const isToday = dk === todayStr;
          const games = gamesByDate[dk] || [];
          const work  = workByDate[dk]  || [];
          const maint = maintByDate[dk] || [];

          return (
            <div key={i} style={{
              minHeight: 70, padding: 4, borderRadius: 6,
              border: `1px solid ${isToday ? "#15803d" : "#e5e7eb"}`,
              background: isToday ? "#f0fdf4" : inMonth ? "#fff" : "#f9fafb",
              opacity: inMonth ? 1 : 0.5,
            }}>
              <div style={{ fontSize: 11, fontWeight: isToday ? 700 : 400,
                color: isToday ? "#15803d" : C.ink, marginBottom: 3 }}>
                {d.getDate()}
              </div>
              {games.map((g, j) => (
                <div key={j} style={{ fontSize: 9, background: "#fb923c",
                  color: "#fff", borderRadius: 3, padding: "1px 3px",
                  marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap" }}>
                  ⚽ {g.opponent || "Heimspiel"}
                </div>
              ))}
              {work.map((w, j) => (
                <div key={j} style={{ fontSize: 9, background: "#bbf7d0",
                  color: "#166534", borderRadius: 3, padding: "1px 3px",
                  marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap" }}>
                  {TYPE_ICONS[w.type] || "🌿"} {w.person}
                </div>
              ))}
              {maint.map((m, j) => (
                <div key={j} style={{ fontSize: 9,
                  background: m.done ? "#e5e7eb" : "#fef3c7",
                  color: m.done ? "#6b7280" : "#92400e",
                  borderRadius: 3, padding: "1px 3px",
                  marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap" }}>
                  {MAINTENANCE_TYPES[m.type]?.icon || "🔧"} {MAINTENANCE_TYPES[m.type]?.label || m.type}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Legende */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap",
        marginTop: 10, fontSize: 11, color: C.textSec }}>
        <span><span style={{ background: "#fb923c", color: "#fff",
          borderRadius: 3, padding: "0 4px" }}>⚽</span> Heimspiel</span>
        <span><span style={{ background: "#bbf7d0", color: "#166534",
          borderRadius: 3, padding: "0 4px" }}>🌿</span> Arbeitsprotokoll</span>
        <span><span style={{ background: "#fef3c7", color: "#92400e",
          borderRadius: 3, padding: "0 4px" }}>🔧</span> Pflegemaßnahme</span>
      </div>
    </div>
  );
}

// ── Auswertung & Archiv ───────────────────────────────────────────────
function AuswertungTab({ worklog, maintenance, archive, kw, mpHooks, isPlatzwart }) {
  const [evalPeriod, setEvalPeriod] = useState("month");
  const [archiveLabel, setArchiveLabel] = useState("");
  const [archiving, setArchiving] = useState(false);

  const now = new Date();
  const inPeriod = (dateStr) => {
    if (evalPeriod === "all") return true;
    const d = new Date(dateStr + "T00:00:00");
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  };

  const filteredWork  = worklog.filter(w => inPeriod(w.date));
  const filteredMaint = maintenance.filter(m => inPeriod(m.date));

  const parseH = (str) =>
    parseFloat((str || "0").replace(",", ".").replace(/[^0-9.]/g, "")) || 0;

  const totalH = filteredWork.reduce((s, w) => s + parseH(w.duration), 0);

  // Stunden je Person
  const byPerson = {};
  filteredWork.forEach(w => {
    byPerson[w.person] = (byPerson[w.person] || 0) + parseH(w.duration);
  });
  const personRows = Object.entries(byPerson)
    .sort((a,b) => b[1]-a[1]);
  const maxH = personRows[0]?.[1] || 1;

  // Stunden je Platz
  const byField = {};
  filteredWork.forEach(w => {
    byField[w.field] = (byField[w.field] || 0) + parseH(w.duration);
  });

  const handleArchive = async () => {
    if (!window.confirm("Aktuelle Saison archivieren? Arbeitsprotokoll und Pflegemaßnahmen werden danach geleert.")) return;
    setArchiving(true);
    await mpHooks.archiveSeason(archiveLabel || `Saison bis KW ${kw?.week}/${kw?.year}`);
    setArchiving(false);
    setArchiveLabel("");
  };

  const fmtH = (h) => h.toFixed(1).replace(".", ",") + " h";

  return (
    <div>
      {/* Zeitraum-Auswahl */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {[["month", "Dieser Monat"], ["all", "Alles"]].map(([k, l]) => (
          <button key={k} onClick={() => setEvalPeriod(k)}
            style={{ ...mp.btn, background: evalPeriod === k ? "#15803d" : "#fff",
              color: evalPeriod === k ? "#fff" : C.ink,
              borderColor: evalPeriod === k ? "#15803d" : C.border }}>
            {l}
          </button>
        ))}
      </div>

      {/* Kennzahlen */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        {[
          ["Arbeitseinsätze", filteredWork.length],
          ["Stunden gesamt", fmtH(totalH)],
          ["Pflegemaßnahmen", filteredMaint.length],
        ].map(([label, val]) => (
          <div key={label} style={{ ...S.card, flex: "1 1 120px", textAlign: "center", padding: 12 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#15803d" }}>{val}</div>
            <div style={{ fontSize: 11, color: C.textSec }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Stunden je Person */}
      {personRows.length > 0 && (
        <>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Stunden je Person</div>
          {personRows.map(([person, h]) => (
            <div key={person} style={{ display: "flex", alignItems: "center",
              gap: 10, marginBottom: 6 }}>
              <span style={{ width: 120, fontSize: 13, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{person}</span>
              <div style={{ flex: 1, background: "#e5e7eb", borderRadius: 4,
                height: 10, overflow: "hidden" }}>
                <div style={{ width: `${Math.round((h/maxH)*100)}%`,
                  height: "100%", background: "#15803d", borderRadius: 4 }} />
              </div>
              <span style={{ fontSize: 12, color: C.textSec, width: 55,
                textAlign: "right" }}>{fmtH(h)}</span>
            </div>
          ))}
        </>
      )}

      {/* Stunden je Platz */}
      {Object.keys(byField).length > 0 && (
        <>
          <div style={{ fontWeight: 600, fontSize: 14, margin: "16px 0 8px" }}>Stunden je Platz</div>
          {Object.entries(byField).sort((a,b)=>b[1]-a[1]).map(([field, h]) => (
            <div key={field} style={{ display: "flex", alignItems: "center",
              gap: 10, marginBottom: 6 }}>
              <span style={{ width: 70, fontSize: 13 }}>{FIELD_NAMES[field] || field}</span>
              <div style={{ flex: 1, background: "#e5e7eb", borderRadius: 4,
                height: 10, overflow: "hidden" }}>
                <div style={{ width: `${Math.round((h/totalH)*100)}%`,
                  height: "100%", background: "#0891b2", borderRadius: 4 }} />
              </div>
              <span style={{ fontSize: 12, color: C.textSec, width: 55,
                textAlign: "right" }}>{fmtH(h)}</span>
            </div>
          ))}
        </>
      )}

      {/* Archiv */}
      {isPlatzwart && (
        <div style={{ marginTop: 24, paddingTop: 16,
          borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
            🗄️ Saison archivieren
          </div>
          <p style={{ fontSize: 13, color: C.textSec, marginTop: 0 }}>
            Archiviert alle Protokolleinträge und Pflegemaßnahmen. Danach starten Protokoll
            und Pflege neu – die archivierten Daten bleiben abrufbar.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="text" value={archiveLabel}
              onChange={e => setArchiveLabel(e.target.value)}
              placeholder={`Saison bis KW ${kw?.week}/${kw?.year}`}
              style={{ ...S.select, flex: 1, minWidth: 180 }} />
            <button onClick={handleArchive} disabled={archiving}
              style={{ ...mp.okBtn, opacity: archiving ? 0.6 : 1 }}>
              {archiving ? "Archiviere…" : "Jetzt archivieren"}
            </button>
          </div>
        </div>
      )}

      {/* Archiv-Liste */}
      {archive.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
            Frühere Saisonen
          </div>
          {archive.map(a => (
            <div key={a.id} style={{ ...S.listRow, flexDirection: "column",
              alignItems: "stretch", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                flexWrap: "wrap", gap: 6 }}>
                <b>{a.label}</b>
                <span style={{ fontSize: 12, color: C.textSec }}>
                  {new Date(a.archivedAt).toLocaleDateString("de-DE")}
                </span>
              </div>
              <div style={{ fontSize: 12, color: C.textSec }}>
                {a.totalEntries} Einsätze · {fmtH(a.totalHours || 0)} ·
                {a.maintenanceCount} Pflegemaßnahmen
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pflegemaßnahmen-Tab ───────────────────────────────────────────────
function PflegeTab({ maintenance, mpHooks, isPlatzwart }) {
  const [field, setField] = useState("p1");
  const [type, setType] = useState("nachsaeen");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [person, setPerson] = useState("");
  const [note, setNote] = useState("");

  const add = async () => {
    await mpHooks.addMaintenance({ field, type, date, person, note });
    setPerson(""); setNote("");
  };

  const open = maintenance.filter(m => !m.done).sort((a,b) => a.date.localeCompare(b.date));
  const done = maintenance.filter(m => m.done).sort((a,b) => b.date.localeCompare(a.date));

  return (
    <div>
      {isPlatzwart && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10,
          padding: 12, marginBottom: 16, background: "#fafaf7" }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
            Maßnahme eintragen
          </div>
          <div style={S.formGrid}>
            {[
              ["Platz", <select value={field} onChange={e => setField(e.target.value)} style={S.select}>
                <option value="p1">Platz 1</option>
                <option value="p2">Platz 2</option>
                <option value="p3">Platz 3</option>
              </select>],
              ["Art", <select value={type} onChange={e => setType(e.target.value)} style={S.select}>
                {Object.entries(MAINTENANCE_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>],
              ["Datum", <input type="date" value={date}
                onChange={e => setDate(e.target.value)} style={S.select} />],
              ["Person", <input type="text" value={person}
                onChange={e => setPerson(e.target.value)}
                placeholder="Wer?" style={S.select} />],
              ["Notiz", <input type="text" value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Optional" style={S.select} />],
            ].map(([label, el]) => (
              <label key={label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 12, color: C.textSec }}>{label}</span>
                {el}
              </label>
            ))}
          </div>
          <button onClick={add} style={{ ...mp.okBtn, marginTop: 10 }}>
            Maßnahme eintragen
          </button>
        </div>
      )}

      {open.length === 0 && (
        <p style={{ color: C.textSec, fontSize: 14 }}>Keine offenen Pflegemaßnahmen.</p>
      )}

      {open.map(m => {
        const mt = MAINTENANCE_TYPES[m.type] || { icon: "🔧", label: m.type };
        return (
          <div key={m.id} style={{ ...S.listRow, flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 240px" }}>
              <b>{mt.icon} {mt.label}</b> · {FIELD_NAMES[m.field] || m.field}
              <div style={{ fontSize: 12, color: C.textSec }}>
                {fmtDate(m.date)}{m.person ? ` · ${m.person}` : ""}
                {m.note ? ` · ${m.note}` : ""}
                {m.carriedOver && <span style={{ color: "#f59e0b" }}> · übertragen</span>}
              </div>
            </span>
            {isPlatzwart && (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => mpHooks.toggleMaintenanceDone(m.id, false)}
                  style={mp.okBtn}>✓ Erledigt</button>
                <button onClick={() => mpHooks.deleteMaintenance(m.id)}
                  style={mp.delBtn}>Löschen</button>
              </div>
            )}
          </div>
        );
      })}

      {done.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: C.textSec,
            marginBottom: 8, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
            Erledigt
          </div>
          {done.slice(0, 10).map(m => {
            const mt = MAINTENANCE_TYPES[m.type] || { icon: "🔧", label: m.type };
            return (
              <div key={m.id} style={{ ...S.listRow, opacity: 0.65, flexWrap: "wrap" }}>
                <span style={{ flex: "1 1 240px" }}>
                  ✓ {mt.icon} {mt.label} · {FIELD_NAMES[m.field] || m.field}
                  <span style={{ fontSize: 12, color: C.textSec }}>
                    {" · "}{fmtDate(m.date)}{m.person ? ` · ${m.person}` : ""}
                  </span>
                </span>
                {isPlatzwart && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => mpHooks.toggleMaintenanceDone(m.id, true)}
                      style={mp.btn}>Zurück</button>
                    <button onClick={() => mpHooks.deleteMaintenance(m.id)}
                      style={mp.delBtn}>Löschen</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Protokoll-Tab ─────────────────────────────────────────────────────
function ProtokollTab({ worklog, mpHooks, isPlatzwart }) {
  const [field, setField] = useState("p1");
  const [type, setType] = useState("mähen");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [person, setPerson] = useState("");
  const [duration, setDuration] = useState("");
  const [note, setNote] = useState("");

  const add = async () => {
    if (!person.trim() || !duration.trim()) return;
    await mpHooks.addWorklogEntry({ field, type, date,
      person: person.trim(), duration: duration.trim(), note: note.trim() });
    setPerson(""); setDuration(""); setNote("");
  };

  const parseH = (str) =>
    parseFloat((str || "0").replace(",", ".").replace(/[^0-9.]/g, "")) || 0;
  const totalH = worklog.reduce((s, w) => s + parseH(w.duration), 0);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ ...S.card, flex: "1 1 120px", textAlign: "center", padding: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#15803d" }}>{worklog.length}</div>
          <div style={{ fontSize: 11, color: C.textSec }}>Einträge gesamt</div>
        </div>
        <div style={{ ...S.card, flex: "1 1 120px", textAlign: "center", padding: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#15803d" }}>
            {totalH.toFixed(1).replace(".", ",")} h
          </div>
          <div style={{ fontSize: 11, color: C.textSec }}>Stunden gesamt</div>
        </div>
      </div>

      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10,
        padding: 12, marginBottom: 16, background: "#fafaf7" }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Arbeit eintragen</div>
        <div style={S.formGrid}>
          {[
            ["Platz", <select value={field} onChange={e => setField(e.target.value)} style={S.select}>
              <option value="p1">Platz 1</option>
              <option value="p2">Platz 2</option>
              <option value="p3">Platz 3</option>
            </select>],
            ["Art", <select value={type} onChange={e => setType(e.target.value)} style={S.select}>
              <option value="mähen">🌿 Mähen</option>
              <option value="striegeln">🪮 Striegeln</option>
              <option value="beides">🌿🪮 Mähen & Striegeln</option>
            </select>],
            ["Datum", <input type="date" value={date}
              onChange={e => setDate(e.target.value)} style={S.select} />],
            ["Person", <input type="text" value={person}
              onChange={e => setPerson(e.target.value)}
              placeholder="Dein Name" style={S.select} />],
            ["Dauer", <input type="text" value={duration}
              onChange={e => setDuration(e.target.value)}
              placeholder="z.B. 1,5 Stunden" style={S.select} />],
            ["Notiz", <input type="text" value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Optional" style={S.select} />],
          ].map(([label, el]) => (
            <label key={label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: C.textSec }}>{label}</span>
              {el}
            </label>
          ))}
        </div>
        <button onClick={add}
          style={{ ...mp.okBtn, marginTop: 10,
            opacity: (!person.trim() || !duration.trim()) ? 0.5 : 1 }}
          disabled={!person.trim() || !duration.trim()}>
          Eintrag speichern
        </button>
      </div>

      {worklog.length === 0 && (
        <p style={{ color: C.textSec, fontSize: 14 }}>Noch keine Einträge.</p>
      )}
      {worklog.map(w => (
        <div key={w.id} style={{ ...S.listRow, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 240px" }}>
            <b>{w.person}</b> · {FIELD_NAMES[w.field] || w.field}
            <div style={{ fontSize: 12, color: C.textSec }}>
              {fmtDate(w.date)} · {TYPE_LABELS[w.type] || w.type} · {w.duration}
              {w.note ? ` · ${w.note}` : ""}
            </div>
          </span>
          {isPlatzwart && (
            <button onClick={() => mpHooks.deleteWorklogEntry(w.id)} style={mp.delBtn}>
              Löschen
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Hauptkomponente ───────────────────────────────────────────────────
export default function MaehplanPanel({ isPlatzwart, bookings }) {
  const [activeTab, setActiveTab] = useState("plan");
  const mpHooks = useMaehplan(true);
  const { plan, kw, worklog, maintenance, signups, archive, ready } = mpHooks;
  const weather = useWeather();

  const homeGames = useMemo(() =>
    (bookings || []).filter(b => b.kind === "match" && b.status !== "beantragt"),
    [bookings]
  );

  if (!ready || !plan) {
    return (
      <div style={{ padding: 24, color: C.textSec, textAlign: "center" }}>
        Lade Mähplan…
      </div>
    );
  }

  const weekMonday = kw ? getDateOfISOWeek(kw.week, kw.year) : new Date();
  const weekEnd    = new Date(weekMonday); weekEnd.setDate(weekEnd.getDate() + 6);
  const kwStr = kw
    ? `KW ${kw.week} · ${weekMonday.toLocaleDateString("de-DE",
        { day: "numeric", month: "short" })} – ${weekEnd.toLocaleDateString("de-DE",
        { day: "numeric", month: "short", year: "numeric" })}`
    : "";

  const TABS = [
    ["plan",     "🌿 Wochenplan"],
    ["kalender", "📅 Monatskalender"],
    ["pflege",   "🔧 Pflegemaßnahmen"],
    ["protokoll","📋 Protokoll"],
    ["auswertung","📊 Auswertung"],
  ];

  const handleResetWeek = async () => {
    if (!window.confirm(
      "Neue Woche starten?\n\nErledigte Aufgaben werden zurückgesetzt. " +
      "Einträge für noch ausstehende Tage bleiben erhalten."
    )) return;
    await mpHooks.resetWeek();
  };

  return (
    <div style={{ ...S.card, marginTop: "1rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: "#15803d" }}>🌱 Mähplan</h2>
          <div style={{ fontSize: 13, color: C.textSec }}>{kwStr}</div>
        </div>
        {isPlatzwart && (
          <button onClick={handleResetWeek}
            style={{ ...mp.btn, background: "#fff7ed", borderColor: "#fb923c",
              color: "#c2410c", fontWeight: 600 }}>
            🔄 Neue Woche starten
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setActiveTab(k)}
            style={{ ...mp.btn, fontWeight: activeTab === k ? 700 : 400,
              background: activeTab === k ? "#15803d" : "#fff",
              color: activeTab === k ? "#fff" : C.ink,
              borderColor: activeTab === k ? "#15803d" : C.border }}>
            {l}
          </button>
        ))}
      </div>

      {activeTab === "plan" && (
        <div>
          {["p1","p2","p3"].map(fid => plan[fid] && (
            <FieldCard key={fid} fieldId={fid} fieldData={plan[fid]}
              signups={signups} canEdit={isPlatzwart}
              mpHooks={mpHooks} homeGames={homeGames} weather={weather} />
          ))}
        </div>
      )}

      {activeTab === "kalender" && (
        <MonatskalenderTab
          homeGames={homeGames} worklog={worklog}
          maintenance={maintenance} kw={kw} />
      )}

      {activeTab === "pflege" && (
        <PflegeTab maintenance={maintenance}
          mpHooks={mpHooks} isPlatzwart={isPlatzwart} />
      )}

      {activeTab === "protokoll" && (
        <ProtokollTab worklog={worklog}
          mpHooks={mpHooks} isPlatzwart={isPlatzwart} />
      )}

      {activeTab === "auswertung" && (
        <AuswertungTab worklog={worklog} maintenance={maintenance}
          archive={archive} kw={kw}
          mpHooks={mpHooks} isPlatzwart={isPlatzwart} />
      )}
    </div>
  );
}

// src/components/MaehplanPanel.jsx
// Integrierter Mähplan im Platzwart-Bereich.
// Sitzung 1: Wochenplan mit Aufgaben, Personen, Verschieben, Neue Woche.

import React, { useState, useMemo } from "react";
import {
  useMaehplan,
  WEEKDAYS_MP, WEEKDAYS_FULL, TYPE_ICONS, TYPE_LABELS,
  MAINTENANCE_TYPES, MONTHS_NO_MOW, getDateOfISOWeek,
  FIELD_NAMES,
} from "../lib/maehplan";
import { C, S } from "../lib/styles";

// ---- Farben & Hilfsstile -------------------------------------------
const mp = {
  card: (accent, light, border) => ({
    background: light,
    border: `1px solid ${border}`,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  }),
  head: (bg, accent) => ({
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: 10,
    color: accent,
    fontWeight: 700, fontSize: 16,
  }),
  taskRow: (done, accent) => ({
    border: `1px solid ${done ? "#d1fae5" : "#e5e7eb"}`,
    borderLeft: `4px solid ${done ? "#10b981" : accent}`,
    borderRadius: 8,
    padding: "10px 12px",
    marginBottom: 8,
    background: done ? "#f0fdf4" : "#fff",
    opacity: done ? 0.75 : 1,
  }),
  personTag: { display: "inline-flex", alignItems: "center", gap: 4,
    background: "#e5e7eb", borderRadius: 20, padding: "2px 8px",
    fontSize: 12, marginRight: 4, marginBottom: 4 },
  btn: { border: `1px solid ${C.border}`, background: "#fff", color: C.ink,
    borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12 },
  okBtn: { border: "none", background: "#10b981", color: "#fff",
    borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600 },
  delBtn: { border: "none", background: "#fef2f2", color: "#dc2626",
    borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 12 },
};

// ---- Wochentag-Bezeichnung -----------------------------------------
function dayLabel(dayIndex, postponedTo) {
  const idx = postponedTo !== undefined ? postponedTo : dayIndex;
  if (idx === null || idx === undefined) return "flexibel";
  return WEEKDAYS_FULL[idx] || "?";
}

// ---- Einzelne Aufgaben-Karte ---------------------------------------
function TaskCard({ fieldId, task, accent, canEdit, mp: mpHooks }) {
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

  const handlePostpone = async () => {
    await mpHooks.postponeTask(fieldId, task.id, postponeDay, postponeReason);
    setPostponeOpen(false);
  };

  const handleCancelPostpone = async () => {
    await mpHooks.cancelPostpone(fieldId, task.id);
    setPostponeOpen(false);
  };

  const handleSetFreeDay = async (dayIdx) => {
    await mpHooks.setFreeDay(fieldId, task.id, dayIdx);
  };

  return (
    <div style={mp.taskRow(task.done, accent)}>
      {/* Kopfzeile */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
        <div>
          <span style={{ fontSize: 16 }}>{TYPE_ICONS[task.type] || "📋"}</span>
          {" "}
          <span style={{ fontWeight: 600, fontSize: 14 }}>{TYPE_LABELS[task.type] || task.type}</span>
          {" "}
          <span style={{ fontSize: 12, color: C.textSec }}>
            {task.freeDay
              ? (effectiveDay !== null && effectiveDay !== undefined
                  ? `→ ${WEEKDAYS_FULL[effectiveDay]}`
                  : "(Tag frei wählbar)")
              : `→ ${dayLabel(task.dayIndex, task.postponedTo)}`}
          </span>
          {isPostponed && (
            <span style={{ fontSize: 11, background: "#fef3c7", color: "#92400e",
              borderRadius: 10, padding: "1px 7px", marginLeft: 6 }}>
              verschoben{task.postponeReason ? ` · ${task.postponeReason}` : ""}
            </span>
          )}
        </div>
        {/* Erledigt-Haken */}
        <button
          onClick={() => mpHooks.toggleDone(fieldId, task.id)}
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
              <button
                onClick={() => mpHooks.removePerson(fieldId, task.id, i)}
                style={{ background: "none", border: "none", cursor: "pointer",
                  color: "#6b7280", fontSize: 11, padding: 0, lineHeight: 1 }}>
                ✕
              </button>
            </span>
          ))}
        </div>
        {/* Person eintragen */}
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="text"
            value={personInput}
            onChange={e => setPersonInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAddPerson()}
            placeholder="Name eintragen…"
            style={{ ...S.select, flex: 1, fontSize: 12 }}
          />
          <button onClick={handleAddPerson} style={mp.okBtn}>+ Eintragen</button>
        </div>
      </div>

      {/* Freier Tag wählen */}
      {task.freeDay && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Tag wählen:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {WEEKDAYS_MP.slice(0, 6).map((wd, i) => (
              <button key={i} onClick={() => handleSetFreeDay(i)}
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

      {/* Verschieben (nur für Platzwart/Admin) */}
      {canEdit && !task.freeDay && (
        <div style={{ marginTop: 8 }}>
          {!postponeOpen ? (
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setPostponeOpen(true)} style={mp.btn}>
                ↔ Verschieben
              </button>
              {isPostponed && (
                <button onClick={handleCancelPostpone} style={{ ...mp.btn, color: "#dc2626" }}>
                  Zurücksetzen
                </button>
              )}
            </div>
          ) : (
            <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb",
              borderRadius: 8, padding: 10, marginTop: 6 }}>
              <div style={{ fontSize: 12, color: C.textSec, marginBottom: 6 }}>
                Auf welchen Tag verschieben?
              </div>
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
              <input
                type="text"
                value={postponeReason}
                onChange={e => setPostponeReason(e.target.value)}
                placeholder="Grund (optional)"
                style={{ ...S.select, fontSize: 12, marginBottom: 8, width: "100%", boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={handlePostpone} style={mp.okBtn}>Speichern</button>
                <button onClick={() => setPostponeOpen(false)} style={mp.btn}>Abbrechen</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Platz-Karte ---------------------------------------------------
function FieldCard({ fieldId, fieldData, kw, signups, canEdit, mpHooks, homeGames }) {
  const [bemerkungEdit, setBemerkungEdit] = useState(false);
  const [bemerkungVal, setBemerkungVal] = useState(fieldData.bemerkung || "");

  const accent = fieldData.colorAccent || "#4caf50";
  const light  = fieldData.colorLight  || "#e8f5e9";
  const border = fieldData.colorBorder || "#2e7d32";

  // Nächstes Heimspiel für diesen Platz
  const today = new Date(); today.setHours(0,0,0,0);
  const nextGame = homeGames
    .filter(g => g.field === FIELD_NAMES[fieldId] && new Date(g.date + "T00:00:00") >= today)
    .sort((a,b) => a.date.localeCompare(b.date))[0] || null;

  // Winterpause?
  const nowMonth = new Date().getMonth() + 1;
  const isWinter = MONTHS_NO_MOW.includes(nowMonth);

  const saveBemerkung = async () => {
    await mpHooks.updateBemerkung(fieldId, bemerkungVal);
    setBemerkungEdit(false);
  };

  return (
    <div style={mp.card(accent, light, border)}>
      {/* Kopf */}
      <div style={mp.head(null, accent)}>
        <span>{fieldData.name || FIELD_NAMES[fieldId]}</span>
        <span style={{ fontSize: 12, fontWeight: 400, color: C.textSec }}>
          {fieldData.notes}
        </span>
      </div>

      {isWinter && (
        <div style={{ fontSize: 12, background: "#f0f9ff", color: "#0369a1",
          border: "1px solid #bae6fd", borderRadius: 8, padding: "6px 10px", marginBottom: 10 }}>
          ❄️ Winterpause – kein Mähen im November bis Februar.
        </div>
      )}

      {nextGame && (
        <div style={{ fontSize: 12, background: "#fff7ed", color: "#c2410c",
          border: "1px solid #fed7aa", borderRadius: 8, padding: "6px 10px", marginBottom: 10 }}>
          ⚽ Nächstes Heimspiel: <b>{new Date(nextGame.date + "T00:00:00")
            .toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" })}</b>
          {nextGame.time ? ` · ${nextGame.time} Uhr` : ""}
          {nextGame.opponent ? ` · vs. ${nextGame.opponent}` : ""}
        </div>
      )}

      {/* Aufgaben */}
      {(fieldData.tasks || []).map(task => (
        <TaskCard
          key={task.id}
          fieldId={fieldId}
          task={task}
          accent={accent}
          canEdit={canEdit}
          mp={mpHooks}
        />
      ))}

      {/* Bemerkung */}
      <div style={{ marginTop: 8 }}>
        {bemerkungEdit ? (
          <div>
            <textarea
              value={bemerkungVal}
              onChange={e => setBemerkungVal(e.target.value)}
              rows={2}
              placeholder="Bemerkung zur aktuellen Woche…"
              style={{ ...S.select, width: "100%", boxSizing: "border-box",
                resize: "vertical", fontSize: 12 }}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button onClick={saveBemerkung} style={mp.okBtn}>Speichern</button>
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
              style={{ ...mp.btn, fontSize: 11 }}>
              ✎ Bemerkung
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Hauptkomponente -----------------------------------------------
export default function MaehplanPanel({ isPlatzwart, bookings }) {
  const [activeTab, setActiveTab] = useState("plan");
  const mpHooks = useMaehplan(true);
  const { plan, kw, worklog, maintenance, signups, archive, ready } = mpHooks;

  // Heimspiele aus bookings (direkt aus Firestore, kein Sync nötig)
  const homeGames = useMemo(() => (bookings || []).filter(b =>
    b.kind === "match" && b.status !== "beantragt"
  ), [bookings]);

  if (!ready || !plan) {
    return (
      <div style={{ padding: 24, color: C.textSec, textAlign: "center" }}>
        Lade Mähplan…
      </div>
    );
  }

  const weekMonday = kw ? getDateOfISOWeek(kw.week, kw.year) : new Date();
  const weekStr = weekMonday.toLocaleDateString("de-DE",
    { day: "numeric", month: "short" });
  const weekEnd = new Date(weekMonday);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toLocaleDateString("de-DE",
    { day: "numeric", month: "short", year: "numeric" });

  const handleResetWeek = async () => {
    if (!window.confirm(
      "Neue Woche starten?\n\nErledigte Aufgaben werden zurückgesetzt. " +
      "Einträge für noch ausstehende Tage dieser Woche bleiben erhalten."
    )) return;
    await mpHooks.resetWeek();
  };

  const TABS = [
    ["plan", "🌿 Wochenplan"],
    ["pflege", "🔧 Pflegemaßnahmen"],
    ["protokoll", "📋 Protokoll"],
  ];

  return (
    <div style={{ ...S.card, marginTop: "1rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: "#15803d" }}>🌱 Mähplan</h2>
          {kw && (
            <div style={{ fontSize: 13, color: C.textSec }}>
              KW {kw.week} · {weekStr} – {weekEndStr}
            </div>
          )}
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

      {/* Tab: Wochenplan */}
      {activeTab === "plan" && (
        <div>
          {["p1", "p2", "p3"].map(fieldId => (
            plan[fieldId] && (
              <FieldCard
                key={fieldId}
                fieldId={fieldId}
                fieldData={plan[fieldId]}
                kw={kw}
                signups={signups}
                canEdit={isPlatzwart}
                mpHooks={mpHooks}
                homeGames={homeGames}
              />
            )
          ))}
        </div>
      )}

      {/* Tab: Pflegemaßnahmen */}
      {activeTab === "pflege" && (
        <PflegeTab
          maintenance={maintenance}
          mpHooks={mpHooks}
          isPlatzwart={isPlatzwart}
        />
      )}

      {/* Tab: Protokoll */}
      {activeTab === "protokoll" && (
        <ProtokollTab
          worklog={worklog}
          mpHooks={mpHooks}
          isPlatzwart={isPlatzwart}
        />
      )}
    </div>
  );
}

// ---- Pflegemaßnahmen-Tab -------------------------------------------
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

  const open  = maintenance.filter(m => !m.done).sort((a,b) => a.date.localeCompare(b.date));
  const done  = maintenance.filter(m => m.done).sort((a,b) => b.date.localeCompare(a.date));

  const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("de-DE",
    { weekday: "short", day: "numeric", month: "short" });

  return (
    <div>
      {isPlatzwart && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10,
          padding: 12, marginBottom: 16, background: "#fafaf7" }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
            Maßnahme eintragen
          </div>
          <div style={S.formGrid}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: C.textSec }}>Platz</span>
              <select value={field} onChange={e => setField(e.target.value)} style={S.select}>
                <option value="p1">Platz 1</option>
                <option value="p2">Platz 2</option>
                <option value="p3">Platz 3</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: C.textSec }}>Art</span>
              <select value={type} onChange={e => setType(e.target.value)} style={S.select}>
                {Object.entries(MAINTENANCE_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: C.textSec }}>Datum</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={S.select} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: C.textSec }}>Person</span>
              <input type="text" value={person} onChange={e => setPerson(e.target.value)}
                placeholder="Wer macht es?" style={S.select} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: C.textSec }}>Notiz</span>
              <input type="text" value={note} onChange={e => setNote(e.target.value)}
                placeholder="Optional" style={S.select} />
            </label>
          </div>
          <button onClick={add} style={{ ...mp.okBtn, marginTop: 10 }}>
            Maßnahme eintragen
          </button>
        </div>
      )}

      {open.length === 0 && (
        <div style={{ color: C.textSec, fontSize: 14, marginBottom: 12 }}>
          Keine offenen Pflegemaßnahmen.
        </div>
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
            <div style={{ display: "flex", gap: 6 }}>
              {isPlatzwart && (
                <>
                  <button onClick={() => mpHooks.toggleMaintenanceDone(m.id, false)}
                    style={mp.okBtn}>✓ Erledigt</button>
                  <button onClick={() => mpHooks.deleteMaintenance(m.id)}
                    style={mp.delBtn}>Löschen</button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {done.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: C.textSec,
            marginBottom: 8, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
            Erledigte Maßnahmen
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

// ---- Protokoll-Tab -------------------------------------------------
function ProtokollTab({ worklog, mpHooks, isPlatzwart }) {
  const [field, setField] = useState("p1");
  const [type, setType] = useState("mähen");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [person, setPerson] = useState("");
  const [duration, setDuration] = useState("");
  const [note, setNote] = useState("");

  const add = async () => {
    if (!person.trim() || !duration.trim()) return;
    await mpHooks.addWorklogEntry({ field, type, date, person: person.trim(),
      duration: duration.trim(), note: note.trim() });
    setPerson(""); setDuration(""); setNote("");
  };

  const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("de-DE",
    { weekday: "short", day: "numeric", month: "short" });

  // Einfache Stundenauswertung
  const totalH = worklog.reduce((sum, w) => {
    const h = parseFloat((w.duration || "0").replace(",", ".").replace(/[^0-9.]/g, "")) || 0;
    return sum + h;
  }, 0);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ ...S.card, flex: "1 1 140px", textAlign: "center", padding: 12 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#15803d" }}>{worklog.length}</div>
          <div style={{ fontSize: 12, color: C.textSec }}>Einträge gesamt</div>
        </div>
        <div style={{ ...S.card, flex: "1 1 140px", textAlign: "center", padding: 12 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#15803d" }}>
            {totalH.toFixed(1).replace(".", ",")} h
          </div>
          <div style={{ fontSize: 12, color: C.textSec }}>Stunden gesamt</div>
        </div>
      </div>

      {/* Eintrag hinzufügen */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10,
        padding: 12, marginBottom: 16, background: "#fafaf7" }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
          Arbeit eintragen
        </div>
        <div style={S.formGrid}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: C.textSec }}>Platz</span>
            <select value={field} onChange={e => setField(e.target.value)} style={S.select}>
              <option value="p1">Platz 1</option>
              <option value="p2">Platz 2</option>
              <option value="p3">Platz 3</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: C.textSec }}>Art</span>
            <select value={type} onChange={e => setType(e.target.value)} style={S.select}>
              <option value="mähen">🌿 Mähen</option>
              <option value="striegeln">🪮 Striegeln</option>
              <option value="beides">🌿🪮 Mähen & Striegeln</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: C.textSec }}>Datum</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={S.select} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: C.textSec }}>Person</span>
            <input type="text" value={person} onChange={e => setPerson(e.target.value)}
              placeholder="Dein Name" style={S.select} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: C.textSec }}>Dauer</span>
            <input type="text" value={duration} onChange={e => setDuration(e.target.value)}
              placeholder="z.B. 1,5 Stunden" style={S.select} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: C.textSec }}>Notiz</span>
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              placeholder="Optional" style={S.select} />
          </label>
        </div>
        <button onClick={add}
          style={{ ...mp.okBtn, marginTop: 10,
            opacity: (!person.trim() || !duration.trim()) ? 0.5 : 1 }}
          disabled={!person.trim() || !duration.trim()}>
          Eintrag speichern
        </button>
      </div>

      {/* Protokollliste */}
      {worklog.length === 0 && (
        <p style={{ color: C.textSec, fontSize: 14 }}>Noch keine Einträge.</p>
      )}
      {worklog.map(w => (
        <div key={w.id} style={{ ...S.listRow, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 240px" }}>
            <b>{w.person}</b> · {FIELD_NAMES[w.field] || w.field}
            <div style={{ fontSize: 12, color: C.textSec }}>
              {fmtDate(w.date)} · {w.type} · {w.duration}
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

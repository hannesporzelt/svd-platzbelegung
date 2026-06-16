import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  TEAMS, FIELDS, teamById, fieldById, WEEKDAYS, WEEKDAYS_LONG,
  dayKey, mondayOf, addDays, isoWeek, fmtRange, expandRecurrence, zoneCovers,
  autoTrainingForDay, findConflicts, conflictIdsForEntries,
} from "./lib/domain";
import { useAuth } from "./lib/auth";
import { useBookings, useLocks, useMessages } from "./lib/data";
import { C, S } from "./lib/styles";
import Pitch from "./components/Pitch";

// Hinweistext für Trainer, wenn der gewünschte Slot belegt ist
const CONFLICT_HINT = "Dieser Platz ist zur gewählten Zeit bereits belegt.\n\nBitte eine andere Uhrzeit oder einen anderen Trainingstag wählen – oder den Platzwart kontaktieren.\n\nDu kannst den Wunsch trotzdem absenden; der Platzwart entscheidet darüber.";

export default function App() {
  const { user, isAdmin, loginAdmin, logoutAdmin } = useAuth();
  const { bookings, bookingsReady, addBooking, addBookingSeries, setBookingStatus, approveSeries, moveBooking, removeBooking, removeSeries } = useBookings();
  const { locks, locksReady, addLock, removeLock } = useLocks();
  const { messages, messagesReady, addMessage, setMessageDone, removeMessage } = useMessages();

  const [view, setView] = useState("viewer"); // viewer | trainer | admin
  const [trainerTeam, setTrainerTeam] = useState("u15");
  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const [activeField, setActiveField] = useState("p2");
  const [calMode, setCalMode] = useState("woche"); // woche | monat
  const [monthAnchor, setMonthAnchor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });

  // Belegungen nach Tag indexieren
  const bookingsByDay = useMemo(() => {
    const map = {};
    bookings.forEach((b) => {
      (map[b.date] ||= []).push(b);
    });
    return map;
  }, [bookings]);

  const entriesForDay = useCallback(
    (date) => [
      ...autoTrainingForDay(date),
      ...(bookingsByDay[dayKey(date)] || []).filter((b) => b.status !== "beantragt"),
    ],
    [bookingsByDay]
  );

  const lockForDayField = useCallback(
    (date, fieldId) =>
      locks.find(
        (l) => l.field === fieldId && date >= new Date(l.from) && date <= new Date(l.to + "T23:59")
      ),
    [locks]
  );

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  // Admin-Hinweise: offene Anträge (beantragte Trainingstage) + Konflikte + Nachrichten
  const pendingCount = bookings.filter((b) => b.status === "beantragt").length;
  const openMsgCount = messages.filter((m) => !m.done).length;
  const weekConflictCount = useMemo(() => {
    let n = 0;
    days.forEach((d) => {
      const ids = conflictIdsForEntries(entriesForDay(d));
      n += ids.size;
    });
    return n;
  }, [days, entriesForDay]);

  const requestAdmin = () => {
    if (isAdmin) { setView("admin"); return; }
    const pw = window.prompt("Platzwart-Zugang – bitte Passwort eingeben:");
    if (pw === null) return;
    if (loginAdmin(pw)) setView("admin");
    else window.alert("Falsches Passwort. Zugang verweigert.");
  };

  const ready = bookingsReady && locksReady && messagesReady;
  if (!user || !ready)
    return (
      <div style={S.shell}>
        <div style={{ padding: "3rem", textAlign: "center", color: C.textSec }}>
          Verbinde mit dem Belegungsplan…
        </div>
      </div>
    );

  return (
    <div style={S.shell}>
      <Header
        view={view}
        setView={(v) => (v === "admin" ? requestAdmin() : setView(v))}
        isAdmin={isAdmin}
        logoutAdmin={() => { logoutAdmin(); setView("viewer"); }}
        trainerTeam={trainerTeam}
        setTrainerTeam={setTrainerTeam}
        notices={pendingCount + weekConflictCount + openMsgCount}
        requestCount={pendingCount}
      />

      {pendingCount > 0 && (
        <div style={{ ...S.warnBanner, background: "#eef4ff", color: "#234", border: "1px solid #b9cdf0" }}>
          📬 {pendingCount} Trainingstag-Antrag{pendingCount === 1 ? "" : "-anträge"} zur Freigabe{isAdmin ? " – im Platzwart-Bereich unter „Trainingstage“ prüfen." : ". Der Platzwart gibt sie frei."}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={S.roleSwitch}>
          <button onClick={() => setCalMode("woche")} style={{ ...S.roleBtn, ...(calMode === "woche" ? S.roleBtnActive : {}) }}>Woche</button>
          <button onClick={() => setCalMode("monat")} style={{ ...S.roleBtn, ...(calMode === "monat" ? S.roleBtnActive : {}) }}>Monat</button>
        </div>
        {calMode === "monat" && (
          <button style={S.navBtn} className="no-print" onClick={() => window.print()}>🖨 Drucken</button>
        )}
      </div>

      {calMode === "woche" && (
        <>
          <WeekNav weekStart={weekStart} setWeekStart={setWeekStart} />

          {isAdmin && (pendingCount > 0 || weekConflictCount > 0 || openMsgCount > 0) && (
            <div style={S.warnBanner}>
              ⚠️ Hinweis für Platzwart:
              {weekConflictCount > 0 && ` ${weekConflictCount} Belegung(en) mit Konflikt in dieser Woche.`}
              {pendingCount > 0 && ` ${pendingCount} Trainingstag-Antrag/-anträge zur Freigabe.`}
              {openMsgCount > 0 && ` ${openMsgCount} neue Nachricht(en) von Trainern.`}
              {" "}Bitte im Platzwart-Bereich prüfen.
            </div>
          )}

          <WeekGrid
            days={days}
            entriesForDay={entriesForDay}
            lockForDayField={lockForDayField}
            activeField={activeField}
            setActiveField={setActiveField}
            isAdmin={isAdmin}
            removeBooking={removeBooking}
          />

          <div style={{ height: 16 }} />

          <FieldVisual
            days={days}
            activeField={activeField}
            setActiveField={setActiveField}
            entriesForDay={entriesForDay}
            lockForDayField={lockForDayField}
          />
        </>
      )}

      {calMode === "monat" && (
        <MonthView
          monthAnchor={monthAnchor}
          setMonthAnchor={setMonthAnchor}
          entriesForDay={entriesForDay}
          lockForDayField={lockForDayField}
          isAdmin={isAdmin}
          removeBooking={removeBooking}
        />
      )}

      {view === "admin" && isAdmin && (
        <AdminPanel
          days={days}
          bookings={bookings}
          bookingsByDay={bookingsByDay}
          addBooking={addBooking}
          addBookingSeries={addBookingSeries}
          setBookingStatus={setBookingStatus}
          approveSeries={approveSeries}
          moveBooking={moveBooking}
          removeBooking={removeBooking}
          removeSeries={removeSeries}
          locks={locks}
          addLock={addLock}
          removeLock={removeLock}
          addMessage={addMessage}
          messages={messages}
          setMessageDone={setMessageDone}
          removeMessage={removeMessage}
        />
      )}

      {view === "trainer" && (
        <TrainerPanel
          trainerTeam={trainerTeam}
          bookings={bookings}
          bookingsByDay={bookingsByDay}
          addBooking={addBooking}
          addBookingSeries={addBookingSeries}
          entriesForDay={entriesForDay}
          addMessage={addMessage}
          messages={messages}
        />
      )}

      {view === "viewer" && (
        <div style={{ ...S.card, marginTop: "1rem", color: C.textSec, fontSize: 14 }}>
          Lesemodus. Trainer können ohne Anmeldung Trainingstage beantragen (einzeln oder wiederkehrend). Die Anträge erscheinen im Kalender, sobald der Platzwart sie freigibt. Der Platzwart pflegt Belegungen, Heimspiele und Sperren.
        </div>
      )}

      <footer style={S.footer}>
        SV Dörfleins · Platzbelegung · Jahresplan mit Wochenansicht ·
        Spieltage: Fr ab 17:00 (Platz 2), Sa/So Platz 1 + 2 ganztägig
      </footer>
    </div>
  );
}

/* ---------------- Header ---------------- */
function Header({ view, setView, isAdmin, logoutAdmin, trainerTeam, setTrainerTeam, notices, requestCount }) {
  return (
    <header style={S.header}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={S.crest}>SVD</div>
        <div>
          <h1 style={S.h1}>SV Dörfleins</h1>
          <p style={S.sub}>Platzbelegung &amp; Trainingsplan</p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={S.roleSwitch}>
          {[["viewer", "Betrachter"], ["trainer", "Trainer"], ["admin", "Platzwart"]].map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} style={{ ...S.roleBtn, ...(view === k ? S.roleBtnActive : {}) }}
              title={k === "admin" && requestCount > 0 ? `${requestCount} Buchungsantrag/-anträge eingegangen` : undefined}>
              {label}
              {k === "admin" && requestCount > 0 && <span style={S.badge}>{requestCount}</span>}
            </button>
          ))}
        </div>
        {view === "trainer" && (
          <select value={trainerTeam} onChange={(e) => setTrainerTeam(e.target.value)} style={{ ...S.select, width: "auto" }}>
            {TEAMS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        {isAdmin && (
          <button style={S.navBtn} onClick={logoutAdmin}>Platzwart abmelden</button>
        )}
      </div>
    </header>
  );
}

/* ---------------- Wochennavigation ---------------- */
function WeekNav({ weekStart, setWeekStart }) {
  return (
    <div style={S.weekNav}>
      <button style={S.navBtn} onClick={() => setWeekStart(addDays(weekStart, -7))}>‹ Vorige Woche</button>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 13, color: C.textSec }}>KW {isoWeek(weekStart)}</div>
        <div style={{ fontWeight: 500, fontSize: 16 }}>{fmtRange(weekStart)}</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={S.navBtn} onClick={() => setWeekStart(mondayOf(new Date()))}>Heute</button>
        <button style={S.navBtn} onClick={() => setWeekStart(addDays(weekStart, 7))}>Nächste Woche ›</button>
      </div>
    </div>
  );
}

/* ---------------- Wochenraster ---------------- */
function WeekGrid({ days, entriesForDay, lockForDayField, activeField, setActiveField, isAdmin, removeBooking }) {
  return (
    <div style={S.card}>
      <div style={S.gridHead}>
        <span>Wochenübersicht</span>
        <div style={S.fieldTabs}>
          {FIELDS.map((f) => (
            <button key={f.id} onClick={() => setActiveField(f.id)} style={{ ...S.tab, ...(activeField === f.id ? S.tabActive : {}) }}>
              {f.name}
            </button>
          ))}
        </div>
      </div>
      <div style={S.weekRow}>
        {days.map((d) => {
          const all = entriesForDay(d);
          const conflictIds = conflictIdsForEntries(all);
          const entries = all.filter((e) => e.field === activeField);
          const lock = lockForDayField(d, activeField);
          const today = dayKey(d) === dayKey(new Date());
          return (
            <div key={dayKey(d)} style={{ ...S.dayCol, ...(today ? S.dayToday : {}) }}>
              <div style={S.dayHead}>
                <span style={{ fontWeight: 500 }}>{WEEKDAYS[(d.getDay() + 6) % 7]}</span>
                <span style={{ color: C.textSec, fontSize: 12 }}>{d.getDate()}.{d.getMonth() + 1}.</span>
              </div>
              {lock && <div style={S.lockChip} title={lock.reason}>⛔ Gesperrt{lock.reason ? `: ${lock.reason}` : ""}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {entries.length === 0 && !lock && <span style={{ color: C.textTer, fontSize: 12, padding: "4px 0" }}>frei</span>}
                {entries.slice().sort((a, b) => a.start.localeCompare(b.start)).map((e) => (
                  <Chip key={e.id} entry={e} conflict={conflictIds.has(e.id)} isAdmin={isAdmin} removeBooking={removeBooking} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <Legend />
    </div>
  );
}

function Chip({ entry, conflict, isAdmin, removeBooking }) {
  const t = teamById(entry.team);
  const P2_SHORT = { p2_voll: "ganz", h_ob: "Oberhaid", h_ha: "Hallstadt", v1: "V1", v2: "V2", v3: "V3", v4: "V4" };
  const zoneLabel = entry.field === "p2" ? (P2_SHORT[entry.zone] || entry.zone)
    : entry.field === "p3" ? (entry.zone === "h1" ? "H1" : "H2") : "";
  const canDelete = isAdmin && removeBooking && !entry.auto;
  const del = () => {
    const d = new Date(entry.date + "T12:00");
    const ds = `${d.getDate()}.${d.getMonth() + 1}.`;
    if (window.confirm(`Belegung löschen?\n\n${t ? t.name : entry.team} · ${ds} · ${entry.start}–${entry.end}`)) {
      removeBooking(entry.id);
    }
  };
  return (
    <div style={{ ...S.chip, borderLeft: `3px solid ${t ? t.color : C.textSec}`, ...(conflict ? { background: "#fbeaea", borderColor: "#e7a5a5" } : {}) }}
      title={conflict ? "Doppelbelegung – gleiche Zone und Zeit" : undefined}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
        <span style={{ fontWeight: 500, fontSize: 12 }}>
          {conflict && <span style={{ color: C.danger }}>⚠️ </span>}
          {t ? t.name : entry.team}
        </span>
        {zoneLabel && <span style={S.zoneBadge}>{zoneLabel}</span>}
      </div>
      <div style={{ fontSize: 11, color: C.textSec }}>
        {entry.start}–{entry.end}{entry.kind === "match" && " · Heimspiel"}{entry.kind === "turnier" && " · Turnier"}{entry.auto && " · fix"}
      </div>
      {canDelete && (
        <button onClick={del} title="Diesen Tag löschen"
          style={{ marginTop: 5, width: "100%", border: `1px solid #e7a5a5`, background: "#fbeaea", color: C.danger, cursor: "pointer", fontSize: 11, fontWeight: 500, borderRadius: 6, padding: "3px 0" }}>
          ✕ löschen
        </button>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
      <div style={S.legend}>
        <span style={S.legItem}><span style={{ fontSize: 12 }}>V1–V4</span> Viertel (Platz 2)</span>
        <span style={S.legItem}><span style={{ fontSize: 12 }}>H1/H2</span> Hälften (Platz 3)</span>
        <span style={S.legItem}>⛔ Platzsperre</span>
        <span style={S.legItem}>⚠️ Doppelbelegung</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 10 }}>
        {TEAMS.map((t) => (
          <span key={t.id} style={S.legItem}><i style={{ ...S.legDot, background: t.color }} />{t.name}</span>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Platzansicht ---------------- */
function FieldVisual({ days, activeField, setActiveField, entriesForDay, lockForDayField }) {
  const [dayIdx, setDayIdx] = useState(() => {
    const i = days.findIndex((d) => dayKey(d) === dayKey(new Date()));
    return i >= 0 ? i : 0;
  });
  const date = days[Math.min(dayIdx, 6)] || days[0];
  const entries = entriesForDay(date).filter((e) => e.field === activeField);
  const lock = lockForDayField(date, activeField);
  // Eine Teilfläche (z. B. v1) zeigt jeden Eintrag, dessen Zone sie abdeckt –
  // also auch eine Hälften- oder Ganzplatz-Belegung.
  const zoneOccupants = (zoneId) => entries.filter((e) => zoneCovers(e.zone, zoneId));

  return (
    <div style={S.card}>
      <div style={S.gridHead}>
        <span>Platzansicht</span>
        <div style={S.fieldTabs}>
          {FIELDS.map((f) => (
            <button key={f.id} onClick={() => setActiveField(f.id)} style={{ ...S.tab, ...(activeField === f.id ? S.tabActive : {}) }}>
              {f.name}
            </button>
          ))}
        </div>
      </div>
      <div style={S.dayPicker}>
        {days.map((d, i) => (
          <button key={dayKey(d)} onClick={() => setDayIdx(i)} style={{ ...S.dayPick, ...(i === dayIdx ? S.dayPickActive : {}) }}>
            {WEEKDAYS[(d.getDay() + 6) % 7]} {d.getDate()}.
          </button>
        ))}
      </div>
      <div style={{ position: "relative" }}>
        {lock && <div style={S.lockOverlay}>⛔ Platz gesperrt{lock.reason ? `: ${lock.reason}` : ""}</div>}
        <Pitch field={activeField} zoneOccupants={zoneOccupants} />
      </div>
      <p style={{ fontSize: 12, color: C.textSec, marginTop: 8 }}>
        {WEEKDAYS_LONG[(date.getDay() + 6) % 7]}, {date.getDate()}.{date.getMonth() + 1}. ·
        {activeField === "p2"
          ? " Platz 2 ist in Viertel (Oberhaid: V1/V2, Hallstadt: V3/V4), Hälften oder ganz buchbar."
          : " Aufteilung nach Belegung."}
      </p>
    </div>
  );
}

/* ---------------- Monatsübersicht (druckbar) ---------------- */
const MONTHS_LONG = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

function MonthView({ monthAnchor, setMonthAnchor, entriesForDay, lockForDayField, isAdmin, removeBooking }) {
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  const shiftMonth = (delta) => { const d = new Date(year, month + delta, 1); setMonthAnchor(d); };
  const toThisMonth = () => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); setMonthAnchor(d); };

  // Raster: erste Zelle = Montag der Woche, in der der Monatsanfang liegt
  const first = new Date(year, month, 1);
  const gridStart = mondayOf(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)); // 6 Wochen
  // letzte Zeile weglassen, wenn komplett im Folgemonat
  const usedRows = cells.some((d, i) => i >= 35 && d.getMonth() === month) ? 6 : 5;
  const shownCells = cells.slice(0, usedRows * 7);

  const fieldShort = { p1: "P1", p2: "P2", p3: "P3" };
  const zoneShort = { p2_voll: "ganz", h_ob: "Ob", h_ha: "Ha", v1: "V1", v2: "V2", v3: "V3", v4: "V4", h1: "H1", h2: "H2", voll: "" };

  const delEntry = (e) => {
    if (e.auto || !e.id) return;
    const d = new Date(e.date + "T12:00");
    if (window.confirm(`Belegung löschen?\n\n${teamById(e.team)?.name || e.team} · ${d.getDate()}.${d.getMonth() + 1}. · ${e.start}–${e.end}`)) {
      removeBooking(e.id);
    }
  };

  return (
    <div style={S.card} className="print-area">
      <div style={S.gridHead}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }} className="no-print">
          <button style={S.navBtn} onClick={() => shiftMonth(-1)}>‹</button>
          <button style={S.navBtn} onClick={toThisMonth}>Heute</button>
          <button style={S.navBtn} onClick={() => shiftMonth(1)}>›</button>
        </div>
        <span style={{ fontSize: 18 }}>{MONTHS_LONG[month]} {year}</span>
      </div>
      {isAdmin && <p style={{ fontSize: 12, color: C.textSec, marginTop: 0 }} className="no-print">Als Platzwart auf einen Eintrag tippen, um ihn zu löschen.</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ fontWeight: 600, fontSize: 12, textAlign: "center", padding: "4px 0", color: C.textSec }}>{w}</div>
        ))}
        {shownCells.map((d) => {
          const inMonth = d.getMonth() === month;
          const today = dayKey(d) === dayKey(new Date());
          const entries = entriesForDay(d).slice().sort((a, b) => a.start.localeCompare(b.start));
          const anyLock = ["p1", "p2", "p3"].map((f) => lockForDayField(d, f)).filter(Boolean);
          return (
            <div key={dayKey(d)} style={{
              border: `1px solid ${C.border}`, borderRadius: 8, minHeight: 92, padding: 5,
              background: inMonth ? (today ? "#eef7f0" : C.surface) : "#f5f4ef",
              opacity: inMonth ? 1 : 0.55,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3, color: today ? C.brand : C.ink }}>{d.getDate()}</div>
              {anyLock.length > 0 && <div style={{ fontSize: 9, color: C.danger, marginBottom: 2 }}>⛔ gesperrt</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {entries.slice(0, 5).map((e) => {
                  const t = teamById(e.team);
                  const deletable = isAdmin && removeBooking && !e.auto && e.id;
                  return (
                    <div key={e.id}
                      onClick={deletable ? () => delEntry(e) : undefined}
                      title={deletable ? "Löschen" : undefined}
                      style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, lineHeight: 1.2, cursor: deletable ? "pointer" : "default" }}>
                      <span style={{ width: 7, height: 7, borderRadius: 2, background: t ? t.color : C.textSec, flex: "none" }} />
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {e.start} {t ? t.name : e.team} <span style={{ color: C.textSec }}>{fieldShort[e.field]}{zoneShort[e.zone] ? "·" + zoneShort[e.zone] : ""}</span>
                        {deletable && <span className="no-print" style={{ color: C.danger }}> ✕</span>}
                      </span>
                    </div>
                  );
                })}
                {entries.length > 5 && <div style={{ fontSize: 9, color: C.textSec }}>+{entries.length - 5} weitere</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: 11, color: C.textSec }}>
        {TEAMS.map((t) => (
          <span key={t.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: t.color, display: "inline-block" }} />{t.name}
          </span>
        ))}
      </div>
      <p style={{ fontSize: 11, color: C.textSec, marginTop: 8 }}>P1 = Platz 1, P2 = Platz 2 (Ob = Oberhaid, Ha = Hallstadt, V1–V4 Viertel), P3 = Platz 3 (H1/H2).</p>
    </div>
  );
}

/* ---------------- Admin ---------------- */
function AdminPanel({ days, bookings, bookingsByDay, addBooking, addBookingSeries, setBookingStatus, approveSeries, moveBooking, removeBooking, removeSeries, locks, addLock, removeLock, addMessage, messages, setMessageDone, removeMessage }) {
  const [tab, setTab] = useState("belegung");
  const pending = bookings.filter((b) => b.status === "beantragt").length;
  const openMsg = messages.filter((m) => !m.done && m.dir !== "out").length;
  return (
    <div style={{ ...S.card, marginTop: "1rem" }}>
      <div style={S.adminTabs}>
        {[
          ["belegung", "Belegung eintragen"],
          ["spiel", "Heimspiel"],
          ["turnier", "Turnier"],
          ["verwalten", "Belegungen verwalten"],
          ["sperre", "Platzsperre"],
          ["trainingstage", `Trainingstage${pending ? ` (${pending})` : ""}`],
          ["nachrichten", `Nachrichten${openMsg ? ` (${openMsg})` : ""}`],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...S.tab, ...(tab === k ? S.tabActive : {}) }}>{l}</button>
        ))}
      </div>
      {tab === "belegung" && <BookingForm days={days} bookings={bookings} bookingsByDay={bookingsByDay} addBooking={addBooking} addBookingSeries={addBookingSeries} removeBooking={removeBooking} removeSeries={removeSeries} kind="training" />}
      {tab === "spiel" && <BookingForm days={days} bookings={bookings} bookingsByDay={bookingsByDay} addBooking={addBooking} addBookingSeries={addBookingSeries} removeBooking={removeBooking} removeSeries={removeSeries} kind="match" />}
      {tab === "turnier" && <BookingForm days={days} bookings={bookings} bookingsByDay={bookingsByDay} addBooking={addBooking} addBookingSeries={addBookingSeries} removeBooking={removeBooking} removeSeries={removeSeries} kind="turnier" />}
      {tab === "verwalten" && <BookingManager bookings={bookings} removeBooking={removeBooking} removeSeries={removeSeries} />}
      {tab === "sperre" && <LockForm locks={locks} addLock={addLock} removeLock={removeLock} />}
      {tab === "trainingstage" && <TrainDayApproval bookings={bookings} setBookingStatus={setBookingStatus} approveSeries={approveSeries} moveBooking={moveBooking} removeBooking={removeBooking} removeSeries={removeSeries} addMessage={addMessage} />}
      {tab === "nachrichten" && <MessageInbox messages={messages} setMessageDone={setMessageDone} removeMessage={removeMessage} />}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, color: C.textSec }}>{label}</span>
      {children}
    </label>
  );
}

// Lesbare Zonen-Bezeichnung für Listen
function zoneText(field, zone) {
  const f = fieldById(field);
  const z = f?.zones.find((x) => x.id === zone);
  return z ? z.label : zone;
}

// Platzwart: alle freigegebenen Belegungen, filterbar nach Mannschaft, einzeln oder als Serie löschbar
function BookingManager({ bookings, removeBooking, removeSeries }) {
  const [team, setTeam] = useState("alle");
  const todayKey = dayKey(new Date());
  const list = bookings
    .filter((b) => b.status !== "beantragt") // Anträge stehen unter "Trainingstage"
    .filter((b) => team === "alle" || b.team === team)
    .filter((b) => b.date >= todayKey) // ab heute
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

  const fmtDate = (dk) => {
    const d = new Date(dk + "T12:00");
    return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
  };

  return (
    <div>
      <p style={{ fontSize: 14, color: C.textSec, marginTop: 0 }}>
        Alle freigegebenen Belegungen ab heute. Über den Filter eine Mannschaft auswählen und einzelne Tage löschen – z. B. wenn ein Trainer einen Ausfall meldet.
      </p>
      <div style={{ marginBottom: 12, maxWidth: 280 }}>
        <Field label="Mannschaft filtern">
          <select value={team} onChange={(e) => setTeam(e.target.value)} style={S.select}>
            <option value="alle">Alle Mannschaften</option>
            {TEAMS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      </div>
      {list.length === 0 && <p style={{ color: C.textSec, fontSize: 14 }}>Keine Belegungen gefunden.</p>}
      {list.map((b) => (
        <div key={b.id} style={{ ...S.listRow, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 260px", borderLeft: `3px solid ${teamById(b.team)?.color || C.textSec}`, paddingLeft: 8 }}>
            <b>{teamById(b.team)?.name || b.team}</b> · {fmtDate(b.date)} · {b.start}–{b.end}
            <div style={{ fontSize: 12, color: C.textSec }}>{fieldById(b.field)?.name} · {zoneText(b.field, b.zone)}{b.kind === "match" ? " · Heimspiel" : ""}{b.kind === "turnier" ? " · Turnier" : ""}{b.seriesId ? " · Teil einer Serie" : ""}</div>
          </span>
          <span style={{ display: "flex", gap: 6 }}>
            {b.seriesId && <button style={S.delBtn} onClick={() => { if (window.confirm("Die ganze Serie löschen (alle Termine)?")) removeSeries(b.seriesId, bookings); }}>Serie löschen</button>}
            <button style={S.delBtn} onClick={() => { if (window.confirm(`Belegung am ${fmtDate(b.date)} löschen?`)) removeBooking(b.id); }}>Diesen Tag löschen</button>
          </span>
        </div>
      ))}
    </div>
  );
}

// Platzwart: Nachrichten von Trainern
function MessageInbox({ messages, setMessageDone, removeMessage }) {
  const sorted = messages.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const open = sorted.filter((m) => !m.done);
  const done = sorted.filter((m) => m.done);
  const fmtTs = (ts) => ts ? new Date(ts).toLocaleString("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div>
      {open.length === 0 && <p style={{ color: C.textSec, fontSize: 14 }}>Keine neuen Nachrichten.</p>}
      {open.map((m) => (
        <div key={m.id} style={S.wishRow}>
          <div style={{ flex: 1 }}>
            <b>{teamById(m.team)?.name || m.team}</b> <span style={{ fontSize: 12, color: C.textSec }}>· {fmtTs(m.ts)}</span>
            <div style={{ fontSize: 14, marginTop: 2 }}>{m.text}</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button style={S.okBtn} onClick={() => setMessageDone(m.id, true)}>Erledigt</button>
            <button style={S.delBtn} onClick={() => { if (window.confirm("Nachricht löschen?")) removeMessage(m.id); }}>Löschen</button>
          </div>
        </div>
      ))}
      {done.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={S.subHead}>Erledigt</div>
          {done.slice(0, 10).map((m) => (
            <div key={m.id} style={{ ...S.listRow, opacity: 0.7 }}>
              <span>{teamById(m.team)?.name} · {fmtTs(m.ts)} · {m.text}</span>
              <span style={{ display: "flex", gap: 6 }}>
                <button style={S.navBtn} onClick={() => setMessageDone(m.id, false)}>Zurück</button>
                <button style={S.delBtn} onClick={() => removeMessage(m.id)}>Löschen</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BookingForm({ days, bookings, bookingsByDay, addBooking, addBookingSeries, removeBooking, removeSeries, kind }) {
  const [mode, setMode] = useState("single"); // single | series
  const [date, setDate] = useState(dayKey(days[0]));
  const [weekday, setWeekday] = useState(1); // 0=Mo..6=So, Standard Di
  const [seriesFrom, setSeriesFrom] = useState(dayKey(days[0]));
  const [seriesTo, setSeriesTo] = useState(dayKey(addDays(days[0], 84))); // ~12 Wochen
  const [team, setTeam] = useState("u15");
  const matchLike = kind === "match" || kind === "turnier";
  const [field, setField] = useState(matchLike ? "p1" : "p2");
  const [zone, setZone] = useState("v1");
  const [start, setStart] = useState(matchLike ? "15:00" : "17:00");
  const [end, setEnd] = useState(matchLike ? "17:00" : "18:30");

  const zones = fieldById(field).zones;
  const safeZone = zones.find((z) => z.id === zone) ? zone : zones[0].id;
  const timeInvalid = !(start < end);

  // Konfliktvorschau nur im Einzelmodus (Serie prüft beim Speichern jeden Termin)
  const allDayEntries = [...autoTrainingForDay(new Date(date + "T12:00")), ...(bookingsByDay[date] || [])];
  const liveConflicts = mode === "single" && !timeInvalid
    ? findConflicts({ id: "__neu__", field, zone: safeZone, team, start, end, kind }, allDayEntries)
    : [];

  const seriesDates = mode === "series" ? expandRecurrence(seriesFrom, seriesTo, weekday) : [];

  const addSingle = () => {
    const entry = { date, field, zone: safeZone, team, start, end, kind };
    const conflicts = findConflicts({ ...entry, id: "__neu__" }, allDayEntries);
    if (conflicts.length > 0) {
      const list = conflicts.map((c) =>
        `• ${teamById(c.team)?.name || c.team} (${fieldById(c.field)?.zones.find((z) => z.id === c.zone)?.label}, ${c.start}–${c.end})${c.auto ? " – fixes Training" : ""}`
      ).join("\n");
      if (!window.confirm(`Achtung – Doppelbelegung!\n\n${fieldById(field)?.name} ist zu dieser Zeit bereits belegt durch:\n${list}\n\nTrotzdem eintragen?`)) return;
    }
    addBooking(entry);
  };

  const addSeries = () => {
    if (seriesDates.length === 0) {
      window.alert("Kein Termin im gewählten Zeitraum. Bitte Datum und Wochentag prüfen.");
      return;
    }
    // Jeden Termin auf Konflikte prüfen
    const conflictDays = [];
    seriesDates.forEach((dk) => {
      const existing = [...autoTrainingForDay(new Date(dk + "T12:00")), ...(bookingsByDay[dk] || [])];
      const c = findConflicts({ id: "__neu__", field, zone: safeZone, team, start, end, kind }, existing);
      if (c.length > 0) conflictDays.push(dk);
    });
    let msg = `Serie anlegen: ${WEEKDAYS_LONG[weekday]}, ${start}–${end}, ${seriesDates.length} Termine vom ${seriesFrom} bis ${seriesTo}.`;
    if (conflictDays.length > 0) {
      msg += `\n\n⚠️ ${conflictDays.length} Termin(e) kollidieren mit bestehenden Belegungen:\n${conflictDays.slice(0, 8).join(", ")}${conflictDays.length > 8 ? " …" : ""}\n\nTrotzdem alle anlegen?`;
    } else {
      msg += "\n\nAlle Termine sind frei. Anlegen?";
    }
    if (!window.confirm(msg)) return;
    const seriesId = `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const entries = seriesDates.map((dk) => ({ date: dk, field, zone: safeZone, team, start, end, kind, seriesId }));
    addBookingSeries(entries);
  };

  const savingRef = useRef(false);
  const add = () => {
    if (timeInvalid) return;
    if (savingRef.current) return; // verhindert doppeltes Anlegen bei Doppelklick / StrictMode
    savingRef.current = true;
    try {
      if (mode === "series") addSeries();
      else addSingle();
    } finally {
      // kurze Sperre, dann wieder freigeben
      setTimeout(() => { savingRef.current = false; }, 800);
    }
  };

  const dayEntries = (bookingsByDay[date] || []).filter((e) => e.field === field);

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button onClick={() => setMode("single")} style={{ ...S.tab, ...(mode === "single" ? S.tabActive : {}) }}>Einzeltermin</button>
        <button onClick={() => setMode("series")} style={{ ...S.tab, ...(mode === "series" ? S.tabActive : {}) }}>Wiederkehrend</button>
      </div>

      <div style={S.formGrid}>
        {mode === "single" ? (
          <Field label="Datum"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={S.select} /></Field>
        ) : (
          <>
            <Field label="Wochentag">
              <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} style={S.select}>
                {WEEKDAYS_LONG.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </Field>
            <Field label="Ab Datum"><input type="date" value={seriesFrom} onChange={(e) => setSeriesFrom(e.target.value)} style={S.select} /></Field>
            <Field label="Bis Datum"><input type="date" value={seriesTo} onChange={(e) => setSeriesTo(e.target.value)} style={S.select} /></Field>
          </>
        )}
        <Field label="Mannschaft">
          <select value={team} onChange={(e) => setTeam(e.target.value)} style={S.select}>
            {TEAMS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Platz">
          <select value={field} onChange={(e) => { setField(e.target.value); setZone(fieldById(e.target.value).zones[0].id); }} style={S.select}>
            {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        <Field label="Zone">
          <select value={safeZone} onChange={(e) => setZone(e.target.value)} style={S.select}>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
          </select>
        </Field>
        <Field label="Von"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={S.select} /></Field>
        <Field label="Bis"><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={S.select} /></Field>
      </div>

      {timeInvalid && <div style={S.warnBanner}>⚠️ Die Endzeit muss nach der Startzeit liegen.</div>}
      {mode === "single" && !timeInvalid && liveConflicts.length > 0 && (
        <div style={S.warnBanner}>
          ⚠️ Doppelbelegung: {fieldById(field)?.name} ist {start}–{end} schon belegt durch{" "}
          {liveConflicts.map((c) => `${teamById(c.team)?.name || c.team}${c.auto ? " (fix)" : ""}`).join(", ")}. Eintragen ist möglich, wird aber nachgefragt.
        </div>
      )}
      {mode === "series" && !timeInvalid && (
        <div style={{ ...S.warnBanner, background: "#eef4ff", color: "#234", border: "1px solid #b9cdf0" }}>
          Serie: <b>{seriesDates.length}</b> {WEEKDAYS_LONG[weekday]}-Termine im gewählten Zeitraum. Konflikte werden beim Anlegen geprüft.
        </div>
      )}

      <button style={{ ...S.primaryBtn, ...(timeInvalid ? S.btnDisabled : {}) }} onClick={add} disabled={timeInvalid}>
        {mode === "series" ? "Serie anlegen" : kind === "match" ? "Heimspiel eintragen" : kind === "turnier" ? "Turnier eintragen" : "Belegung eintragen"}
      </button>

      {mode === "single" && dayEntries.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={S.subHead}>Einträge an diesem Tag ({fieldById(field).name})</div>
          {dayEntries.map((e) => (
            <div key={e.id} style={S.listRow}>
              <span><b>{teamById(e.team)?.name || e.team}</b> · {fieldById(e.field).name} · {fieldById(e.field).zones.find((z) => z.id === e.zone)?.label} · {e.start}–{e.end}{e.kind === "match" && " · Heimspiel"}{e.kind === "turnier" && " · Turnier"}{e.seriesId && " · Serie"}</span>
              <span style={{ display: "flex", gap: 6 }}>
                {e.seriesId && <button style={S.delBtn} onClick={() => { if (window.confirm("Die ganze Serie löschen?")) removeSeries(e.seriesId, bookings); }}>Serie löschen</button>}
                <button style={S.delBtn} onClick={() => removeBooking(e.id)}>Löschen</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LockForm({ locks, addLock, removeLock }) {
  const today = dayKey(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [field, setField] = useState("p1");
  const [reason, setReason] = useState("");
  return (
    <div>
      <div style={S.formGrid}>
        <Field label="Platz">
          <select value={field} onChange={(e) => setField(e.target.value)} style={S.select}>
            {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        <Field label="Von"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={S.select} /></Field>
        <Field label="Bis"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={S.select} /></Field>
        <Field label="Grund"><input type="text" placeholder="z. B. Platzpflege, Frost" value={reason} onChange={(e) => setReason(e.target.value)} style={S.select} /></Field>
      </div>
      <button style={S.primaryBtn} onClick={() => { addLock({ from, to, field, reason }); setReason(""); }}>Sperre anordnen</button>
      {locks.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={S.subHead}>Aktive Sperren</div>
          {locks.map((l) => (
            <div key={l.id} style={S.listRow}>
              <span>⛔ <b>{fieldById(l.field)?.name}</b> · {l.from} – {l.to}{l.reason ? ` · ${l.reason}` : ""}</span>
              <button style={S.delBtn} onClick={() => removeLock(l.id)}>Aufheben</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TrainDayApproval({ bookings, setBookingStatus, approveSeries, moveBooking, removeBooking, removeSeries, addMessage }) {
  const todayKey = dayKey(new Date());
  const pending = bookings
    .filter((b) => b.status === "beantragt" && b.date >= todayKey)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

  // nach Serie gruppieren: Einzeltermine einzeln, Serien zusammengefasst
  const singles = pending.filter((b) => !b.seriesId);
  const seriesMap = {};
  pending.filter((b) => b.seriesId).forEach((b) => { (seriesMap[b.seriesId] ||= []).push(b); });

  const fmtDate = (dk) => {
    const d = new Date(dk + "T12:00");
    return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
  };

  const reject = (b, label) => {
    const reason = window.prompt(`Antrag ablehnen – kurze Nachricht an ${teamById(b.team)?.name} (optional):`, "");
    if (reason === null) return;
    addMessage({ team: b.team, dir: "out", text: `Trainingstag ${label} wurde abgelehnt.${reason ? " " + reason : ""}` });
    removeBooking(b.id);
  };

  const rejectSeries = (sid, list) => {
    const b = list[0];
    const reason = window.prompt(`Ganze Serie ablehnen – kurze Nachricht an ${teamById(b.team)?.name} (optional):`, "");
    if (reason === null) return;
    addMessage({ team: b.team, dir: "out", text: `Die beantragte Trainings-Serie (${WEEKDAYS[(new Date(b.date+"T12:00").getDay()+6)%7]} ${b.start}–${b.end}) wurde abgelehnt.${reason ? " " + reason : ""}` });
    removeSeries(sid, bookings);
  };

  const move = (b) => {
    const neuDatum = window.prompt(`Neues Datum für ${teamById(b.team)?.name} (JJJJ-MM-TT):`, b.date);
    if (!neuDatum) return;
    const neuStart = window.prompt("Neue Startzeit (HH:MM):", b.start);
    if (!neuStart) return;
    const neuEnd = window.prompt("Neue Endzeit (HH:MM):", b.end);
    if (!neuEnd) return;
    if (!(neuStart < neuEnd)) { window.alert("Endzeit muss nach Startzeit liegen."); return; }
    const neu = { date: neuDatum, field: b.field, zone: b.zone, team: b.team, start: neuStart, end: neuEnd, kind: "training", status: "frei" };
    moveBooking(b.id, neu);
    addMessage({ team: b.team, dir: "out", text: `${teamById(b.team)?.name} wurde verschoben auf ${fmtDate(neuDatum)} ${neuStart}–${neuEnd}, bitte prüfen.` });
  };

  const empty = singles.length === 0 && Object.keys(seriesMap).length === 0;

  return (
    <div>
      <p style={{ fontSize: 14, color: C.textSec, marginTop: 0 }}>
        Von Trainern beantragte Trainingstage. Erst nach <b>Freigabe</b> erscheinen sie im Kalender. Du kannst einzelne Termine auch <b>verschieben</b> – der Trainer bekommt dann eine Nachricht.
      </p>
      {empty && <p style={{ color: C.textSec, fontSize: 14 }}>Keine offenen Anträge.</p>}

      {singles.length > 0 && <div style={S.subHead}>Einzelne Trainingstage</div>}
      {singles.map((b) => (
        <div key={b.id} style={{ ...S.listRow, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 260px", borderLeft: `3px solid ${teamById(b.team)?.color || C.textSec}`, paddingLeft: 8 }}>
            <b>{teamById(b.team)?.name || b.team}</b> · {fmtDate(b.date)} · {b.start}–{b.end}
            <div style={{ fontSize: 12, color: C.textSec }}>{fieldById(b.field)?.name} · {zoneText(b.field, b.zone)}</div>
          </span>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button style={S.okBtn} onClick={() => setBookingStatus(b.id, "frei")}>Freigeben</button>
            <button style={S.navBtn} onClick={() => move(b)}>Verschieben</button>
            <button style={S.delBtn} onClick={() => reject(b, fmtDate(b.date))}>Ablehnen</button>
          </span>
        </div>
      ))}

      {Object.entries(seriesMap).map(([sid, list]) => {
        const b = list[0];
        const sorted = list.slice().sort((a, c) => a.date.localeCompare(c.date));
        return (
          <div key={sid} style={{ marginTop: 14 }}>
            <div style={S.subHead}>Serie: {teamById(b.team)?.name} · {WEEKDAYS_LONG[(new Date(b.date+"T12:00").getDay()+6)%7]} · {b.start}–{b.end}</div>
            <div style={{ ...S.listRow, flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 260px", borderLeft: `3px solid ${teamById(b.team)?.color || C.textSec}`, paddingLeft: 8 }}>
                {sorted.length} Termine: {sorted[0].date} bis {sorted[sorted.length-1].date}
                <div style={{ fontSize: 12, color: C.textSec }}>{fieldById(b.field)?.name} · {zoneText(b.field, b.zone)}</div>
              </span>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button style={S.okBtn} onClick={() => approveSeries(sid, bookings)}>Ganze Serie freigeben</button>
                <button style={S.delBtn} onClick={() => rejectSeries(sid, list)}>Serie ablehnen</button>
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              {sorted.map((e) => (
                <div key={e.id} style={{ ...S.listRow, fontSize: 13 }}>
                  <span>{fmtDate(e.date)} · {e.start}–{e.end}</span>
                  <span style={{ display: "flex", gap: 6 }}>
                    <button style={S.okBtn} onClick={() => setBookingStatus(e.id, "frei")}>Freigeben</button>
                    <button style={S.navBtn} onClick={() => move(e)}>Verschieben</button>
                    <button style={S.delBtn} onClick={() => reject(e, fmtDate(e.date))}>Ablehnen</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Trainer ---------------- */
function TrainerPanel({ trainerTeam, bookings, bookingsByDay, addBooking, addBookingSeries, entriesForDay, addMessage, messages }) {
  const [tab, setTab] = useState("eintragen");
  return (
    <div style={{ ...S.card, marginTop: "1rem" }}>
      <div style={S.adminTabs}>
        {[["eintragen", "Trainingstag eintragen"], ["nachricht", "Nachricht an Platzwart"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...S.tab, ...(tab === k ? S.tabActive : {}) }}>{l}</button>
        ))}
      </div>
      {tab === "eintragen" && <TrainerBookingForm trainerTeam={trainerTeam} bookings={bookings} bookingsByDay={bookingsByDay} addBooking={addBooking} addBookingSeries={addBookingSeries} entriesForDay={entriesForDay} />}
      {tab === "nachricht" && <MessageForm trainerTeam={trainerTeam} addMessage={addMessage} messages={messages} />}
    </div>
  );
}

// Trainer trägt Trainingstage direkt ein (Einzeltermin mit Datum oder Serie).
// Erscheint sofort im Kalender; der Platzwart kann später löschen.
function TrainerBookingForm({ trainerTeam, bookings, bookingsByDay, addBooking, addBookingSeries, entriesForDay }) {
  const [mode, setMode] = useState("single"); // single | series
  const [date, setDate] = useState(dayKey(addDays(new Date(), 1)));
  const [weekday, setWeekday] = useState(1);
  const [seriesFrom, setSeriesFrom] = useState(dayKey(addDays(new Date(), 1)));
  const [seriesTo, setSeriesTo] = useState(dayKey(addDays(new Date(), 84)));
  const [field, setField] = useState("p2");
  const [zone, setZone] = useState("p2_voll");
  const [start, setStart] = useState("17:30");
  const [end, setEnd] = useState("19:00");
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);

  const zones = fieldById(field).zones;
  const safeZone = zones.find((z) => z.id === zone) ? zone : zones[0].id;
  const timeInvalid = !(start < end);

  const allDayEntries = [...autoTrainingForDay(new Date(date + "T12:00")), ...(bookingsByDay[date] || [])];
  const liveConflicts = mode === "single" && !timeInvalid
    ? findConflicts({ id: "__neu__", field, zone: safeZone, team: trainerTeam, start, end }, allDayEntries)
    : [];
  const seriesDates = mode === "series" ? expandRecurrence(seriesFrom, seriesTo, weekday) : [];
  const seriesConflicts = mode === "series" && !timeInvalid
    ? seriesDates.filter((dk) => findConflicts({ id: "__neu__", field, zone: safeZone, team: trainerTeam, start, end }, entriesForDay(new Date(dk + "T12:00"))).length > 0)
    : [];

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 2500); };

  const submit = () => {
    if (timeInvalid) return;
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      if (mode === "series") {
        if (seriesDates.length === 0) { window.alert("Kein Termin im gewählten Zeitraum."); return; }
        if (seriesConflicts.length > 0 && !window.confirm(`${CONFLICT_HINT}\n\n(${seriesConflicts.length} von ${seriesDates.length} Terminen betroffen)`)) return;
        const seriesId = `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        addBookingSeries(seriesDates.map((dk) => ({ date: dk, field, zone: safeZone, team: trainerTeam, start, end, kind: "training", seriesId, status: "beantragt" })));
      } else {
        if (liveConflicts.length > 0 && !window.confirm(CONFLICT_HINT)) return;
        addBooking({ date, field, zone: safeZone, team: trainerTeam, start, end, kind: "training", status: "beantragt" });
      }
      flash();
    } finally {
      setTimeout(() => { savingRef.current = false; }, 800);
    }
  };

  // eigene kommende Einträge
  const todayKey = dayKey(new Date());
  const mine = bookings
    .filter((b) => b.team === trainerTeam && b.date >= todayKey)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    .slice(0, 8);

  return (
    <div>
      <p style={{ fontSize: 14, color: C.textSec, marginTop: 0 }}>
        Trage Trainingstage für <b>{teamById(trainerTeam)?.name}</b> ein – einzeln mit Datum oder wiederkehrend. Die Anträge gehen an den Platzwart und erscheinen im Kalender, sobald er sie freigibt.
      </p>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button onClick={() => setMode("single")} style={{ ...S.tab, ...(mode === "single" ? S.tabActive : {}) }}>Einzeltermin</button>
        <button onClick={() => setMode("series")} style={{ ...S.tab, ...(mode === "series" ? S.tabActive : {}) }}>Wiederkehrend</button>
      </div>

      <div style={S.formGrid}>
        {mode === "single" ? (
          <Field label="Datum"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={S.select} /></Field>
        ) : (
          <>
            <Field label="Wochentag">
              <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} style={S.select}>
                {WEEKDAYS_LONG.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </Field>
            <Field label="Ab Datum"><input type="date" value={seriesFrom} onChange={(e) => setSeriesFrom(e.target.value)} style={S.select} /></Field>
            <Field label="Bis Datum"><input type="date" value={seriesTo} onChange={(e) => setSeriesTo(e.target.value)} style={S.select} /></Field>
          </>
        )}
        <Field label="Platz">
          <select value={field} onChange={(e) => { setField(e.target.value); setZone(fieldById(e.target.value).zones[0].id); }} style={S.select}>
            {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        <Field label="Zone">
          <select value={safeZone} onChange={(e) => setZone(e.target.value)} style={S.select}>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
          </select>
        </Field>
        <Field label="Von"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={S.select} /></Field>
        <Field label="Bis"><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={S.select} /></Field>
      </div>

      {timeInvalid && <div style={S.warnBanner}>⚠️ Die Endzeit muss nach der Startzeit liegen.</div>}
      {mode === "single" && !timeInvalid && liveConflicts.length > 0 && (
        <div style={S.warnBanner}>
          ⚠️ {fieldById(field)?.name} ist {start}–{end} schon belegt durch {liveConflicts.map((c) => teamById(c.team)?.name || c.team).join(", ")}. Eintragen ist möglich, wird aber nachgefragt.
        </div>
      )}
      {mode === "series" && !timeInvalid && (
        <div style={{ ...S.warnBanner, background: "#eef4ff", color: "#234", border: "1px solid #b9cdf0" }}>
          {seriesDates.length} {WEEKDAYS_LONG[weekday]}-Termine im Zeitraum.{seriesConflicts.length > 0 ? ` ⚠️ ${seriesConflicts.length} davon bereits belegt.` : ""}
        </div>
      )}

      <button style={{ ...S.primaryBtn, ...(timeInvalid ? S.btnDisabled : {}) }} onClick={submit} disabled={timeInvalid}>
        {mode === "series" ? "Serie beantragen" : "Trainingstag beantragen"}
      </button>
      {saved && <span style={{ marginLeft: 10, color: C.ok, fontSize: 13 }}>✓ Antrag gesendet – wartet auf Freigabe</span>}

      {mine.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={S.subHead}>Meine kommenden Trainingstage</div>
          {mine.map((b) => {
            const d = new Date(b.date + "T12:00");
            const pend = b.status === "beantragt";
            return (
              <div key={b.id} style={S.listRow}>
                <span>{WEEKDAYS[(d.getDay() + 6) % 7]} {d.getDate()}.{d.getMonth() + 1}. · {fieldById(b.field)?.name} · {b.start}–{b.end}{b.seriesId ? " · Serie" : ""}</span>
                <span style={{ fontSize: 12, color: pend ? C.textSec : C.ok }}>{pend ? "wartet auf Freigabe" : "✓ freigegeben"}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MessageForm({ trainerTeam, addMessage, messages }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    addMessage({ team: trainerTeam, text: t, dir: "in" });
    setText(""); setSent(true); setTimeout(() => setSent(false), 2000);
  };
  const incoming = messages.filter((m) => m.team === trainerTeam && m.dir === "out").slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 8);
  const mine = messages.filter((m) => m.team === trainerTeam && m.dir !== "out").slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 5);
  const fmtTs = (ts) => ts ? new Date(ts).toLocaleString("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div>
      {incoming.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={S.subHead}>Nachrichten vom Platzwart</div>
          {incoming.map((m) => (
            <div key={m.id} style={{ ...S.warnBanner, background: "#eef4ff", color: "#234", border: "1px solid #b9cdf0", display: "block" }}>
              {m.text} <span style={{ fontSize: 11, color: C.textSec }}>· {fmtTs(m.ts)}</span>
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 14, color: C.textSec, marginTop: 0 }}>
        Schreib dem Platzwart eine kurze Nachricht (z. B. Ausfall, Hinweis zum Platz, Rückfrage) als <b>{teamById(trainerTeam)?.name}</b>.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Deine Nachricht…"
        rows={4}
        style={{ ...S.select, width: "100%", resize: "vertical", minHeight: 90 }}
      />
      <div style={{ marginTop: 10 }}>
        <button style={{ ...S.primaryBtn, ...(text.trim() ? {} : S.btnDisabled) }} onClick={send} disabled={!text.trim()}>Nachricht senden</button>
        {sent && <span style={{ marginLeft: 10, color: C.ok, fontSize: 13 }}>✓ gesendet</span>}
      </div>
      {mine.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={S.subHead}>Meine letzten Nachrichten</div>
          {mine.map((m) => (
            <div key={m.id} style={S.listRow}>
              <span>{m.text}</span>
              <span style={{ fontSize: 12, color: m.done ? C.ok : C.textSec }}>{m.done ? "✓ erledigt" : "offen"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

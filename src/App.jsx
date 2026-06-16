import React, { useState, useMemo, useCallback } from "react";
import {
  TEAMS, FIELDS, teamById, fieldById, WEEKDAYS, WEEKDAYS_LONG,
  dayKey, mondayOf, addDays, isoWeek, fmtRange, expandRecurrence, zoneCovers,
  autoTrainingForDay, findConflicts, conflictIdsForEntries,
} from "./lib/domain";
import { useAuth } from "./lib/auth";
import { useBookings, useWishes, useTrainingDays, useLocks, useMessages } from "./lib/data";
import { C, S } from "./lib/styles";
import Pitch from "./components/Pitch";

export default function App() {
  const { user, isAdmin, loginAdmin, logoutAdmin } = useAuth();
  const { bookings, bookingsReady, addBooking, addBookingSeries, removeBooking, removeSeries } = useBookings();
  const { wishes, wishesReady, addWish, setWishStatus } = useWishes();
  const { trainDays, trainDaysReady, saveTrainDay, setTrainDayStatus, removeTrainDay } = useTrainingDays();
  const { locks, locksReady, addLock, removeLock } = useLocks();
  const { messages, messagesReady, addMessage, setMessageDone, removeMessage } = useMessages();

  const [view, setView] = useState("viewer"); // viewer | trainer | admin
  const [trainerTeam, setTrainerTeam] = useState("u15");
  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const [activeField, setActiveField] = useState("p2");

  // Belegungen nach Tag indexieren
  const bookingsByDay = useMemo(() => {
    const map = {};
    bookings.forEach((b) => {
      (map[b.date] ||= []).push(b);
    });
    return map;
  }, [bookings]);

  const entriesForDay = useCallback(
    (date) => [...autoTrainingForDay(date), ...(bookingsByDay[dayKey(date)] || [])],
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

  // Admin-Hinweise: offene Wünsche + Konflikte in der aktuellen Woche
  const openWishCount = wishes.filter((w) => w.status === "offen").length;
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

  const ready = bookingsReady && wishesReady && locksReady && trainDaysReady && messagesReady;
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
        notices={openWishCount + weekConflictCount + openMsgCount}
      />

      <WeekNav weekStart={weekStart} setWeekStart={setWeekStart} />

      {isAdmin && (openWishCount > 0 || weekConflictCount > 0 || openMsgCount > 0) && (
        <div style={S.warnBanner}>
          ⚠️ Hinweis für Platzwart:
          {weekConflictCount > 0 && ` ${weekConflictCount} Belegung(en) mit Konflikt in dieser Woche.`}
          {openWishCount > 0 && ` ${openWishCount} offene(r) Trainerwunsch/-wünsche.`}
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

      {view === "admin" && isAdmin && (
        <AdminPanel
          days={days}
          bookings={bookings}
          bookingsByDay={bookingsByDay}
          addBooking={addBooking}
          addBookingSeries={addBookingSeries}
          removeBooking={removeBooking}
          removeSeries={removeSeries}
          wishes={wishes}
          setWishStatus={setWishStatus}
          locks={locks}
          addLock={addLock}
          removeLock={removeLock}
          trainDays={trainDays}
          setTrainDayStatus={setTrainDayStatus}
          removeTrainDay={removeTrainDay}
          messages={messages}
          setMessageDone={setMessageDone}
          removeMessage={removeMessage}
        />
      )}

      {view === "trainer" && (
        <TrainerPanel
          trainerTeam={trainerTeam}
          wishes={wishes}
          addWish={addWish}
          trainDays={trainDays}
          saveTrainDay={saveTrainDay}
          entriesForDay={entriesForDay}
          addMessage={addMessage}
          messages={messages}
        />
      )}

      {view === "viewer" && (
        <div style={{ ...S.card, marginTop: "1rem", color: C.textSec, fontSize: 14 }}>
          Lesemodus. Trainer können ohne Anmeldung Trainingstage melden und Wünsche äußern;
          Konflikte werden dabei sofort angezeigt. Der Platzwart pflegt Belegungen, Heimspiele und
          Sperren und löst gemeldete Konflikte.
        </div>
      )}

      <TrainDaysOverview trainDays={trainDays} />

      <footer style={S.footer}>
        SV Dörfleins · Platzbelegung · Jahresplan mit Wochenansicht ·
        Spieltage: Fr ab 17:00 (Platz 2), Sa/So Platz 1 + 2 ganztägig
      </footer>
    </div>
  );
}

/* ---------------- Header ---------------- */
function Header({ view, setView, isAdmin, logoutAdmin, trainerTeam, setTrainerTeam, notices }) {
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
            <button key={k} onClick={() => setView(k)} style={{ ...S.roleBtn, ...(view === k ? S.roleBtnActive : {}) }}>
              {label}
              {k === "admin" && isAdmin && notices > 0 && <span style={S.badge}>{notices}</span>}
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
        <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {zoneLabel && <span style={S.zoneBadge}>{zoneLabel}</span>}
          {canDelete && (
            <button onClick={del} title="Diesen Tag löschen"
              style={{ border: "none", background: "transparent", color: C.danger, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>×</button>
          )}
        </span>
      </div>
      <div style={{ fontSize: 11, color: C.textSec }}>
        {entry.start}–{entry.end}{entry.kind === "match" && " · Heimspiel"}{entry.kind === "turnier" && " · Turnier"}{entry.auto && " · fix"}
      </div>
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

/* ---------------- Admin ---------------- */
function AdminPanel({ days, bookings, bookingsByDay, addBooking, addBookingSeries, removeBooking, removeSeries, wishes, setWishStatus, locks, addLock, removeLock, trainDays, setTrainDayStatus, removeTrainDay, messages, setMessageDone, removeMessage }) {
  const [tab, setTab] = useState("belegung");
  const open = wishes.filter((w) => w.status === "offen").length;
  const openMsg = messages.filter((m) => !m.done).length;
  return (
    <div style={{ ...S.card, marginTop: "1rem" }}>
      <div style={S.adminTabs}>
        {[
          ["belegung", "Belegung eintragen"],
          ["spiel", "Heimspiel"],
          ["turnier", "Turnier"],
          ["verwalten", "Belegungen verwalten"],
          ["sperre", "Platzsperre"],
          ["trainingstage", "Trainingstage"],
          ["wuensche", `Wünsche${open ? ` (${open})` : ""}`],
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
      {tab === "trainingstage" && <TrainDaysAdmin trainDays={trainDays} setTrainDayStatus={setTrainDayStatus} removeTrainDay={removeTrainDay} />}
      {tab === "wuensche" && <WishInbox wishes={wishes} setWishStatus={setWishStatus} addBooking={addBooking} addBookingSeries={addBookingSeries} bookingsByDay={bookingsByDay} />}
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

// Platzwart: alle Belegungen, filterbar nach Mannschaft, einzeln oder als Serie löschbar
function BookingManager({ bookings, removeBooking, removeSeries }) {
  const [team, setTeam] = useState("alle");
  const todayKey = dayKey(new Date());
  const list = bookings
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
        Alle eingetragenen Belegungen ab heute. Über den Filter eine Mannschaft auswählen und einzelne Tage löschen – z. B. wenn ein Trainer einen Ausfall meldet.
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

  const add = () => {
    if (timeInvalid) return;
    if (mode === "series") addSeries();
    else addSingle();
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

function TrainDaysAdmin({ trainDays, setTrainDayStatus, removeTrainDay }) {
  const entries = Object.entries(trainDays).filter(([, v]) => v && v.days && v.days.length);
  const statusLabel = (s) => s === "abgelehnt" ? "✕ abgelehnt" : s === "bestaetigt" ? "✓ bestätigt" : "offen";
  const statusColor = (s) => s === "abgelehnt" ? C.danger : s === "bestaetigt" ? C.ok : C.textSec;
  return (
    <div>
      <p style={{ fontSize: 14, color: C.textSec, marginTop: 0 }}>Von den Trainern gemeldete regelmäßige Trainingstage. Du kannst sie bestätigen, mit Grund ablehnen oder ganz entfernen.</p>
      {entries.length === 0 && <p style={{ color: C.textSec, fontSize: 14 }}>Noch keine Trainingstage gemeldet.</p>}
      {entries.map(([teamId, v]) => (
        <div key={teamId} style={{ ...S.listRow, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 240px" }}>
            <b>{teamById(teamId)?.name || teamId}</b> · {v.days.map((d) => WEEKDAYS[d]).join(", ")} · {v.start}–{v.end} · {fieldById(v.field)?.name}
            <span style={{ marginLeft: 8, fontSize: 12, color: statusColor(v.status) }}>{statusLabel(v.status)}</span>
            {v.status === "abgelehnt" && v.reason && <div style={{ fontSize: 12, color: C.textSec }}>Grund: {v.reason}</div>}
          </span>
          <span style={{ display: "flex", gap: 6 }}>
            <button style={S.okBtn} onClick={() => setTrainDayStatus(teamId, "bestaetigt", "")}>Bestätigen</button>
            <button style={S.delBtn} onClick={() => {
              const reason = window.prompt(`Trainingstage von ${teamById(teamId)?.name} ablehnen – Grund (optional, wird dem Trainer angezeigt):`, "");
              if (reason === null) return; // abgebrochen
              setTrainDayStatus(teamId, "abgelehnt", reason || "");
            }}>Ablehnen</button>
            <button style={S.delBtn} onClick={() => { if (window.confirm(`Trainingstage von ${teamById(teamId)?.name} ganz löschen?`)) removeTrainDay(teamId); }}>Löschen</button>
          </span>
        </div>
      ))}
    </div>
  );
}

function WishInbox({ wishes, setWishStatus, addBooking, addBookingSeries, bookingsByDay }) {
  const open = wishes.filter((w) => w.status === "offen");
  const closed = wishes.filter((w) => w.status !== "offen");

  const decide = (wish, status) => {
    if (status === "angenommen") {
      if (wish.recur) {
        // Wiederkehrender Wunsch -> ganze Serie erzeugen
        const dates = expandRecurrence(wish.recur.from, wish.recur.to, wish.recur.weekday);
        if (dates.length === 0) { window.alert("Kein Termin im Zeitraum des Wunsches."); return; }
        const conflictDays = [];
        dates.forEach((dk) => {
          const existing = [...autoTrainingForDay(new Date(dk + "T12:00")), ...(bookingsByDay[dk] || [])];
          if (findConflicts({ id: "__neu__", field: wish.field, zone: wish.zone, team: wish.team, start: wish.start, end: wish.end }, existing).length > 0) conflictDays.push(dk);
        });
        let msg = `Serien-Wunsch annehmen: ${WEEKDAYS_LONG[wish.recur.weekday]}, ${wish.start}–${wish.end}, ${dates.length} Termine.`;
        if (conflictDays.length > 0) msg += `\n\n⚠️ ${conflictDays.length} Termin(e) kollidieren:\n${conflictDays.slice(0, 8).join(", ")}${conflictDays.length > 8 ? " …" : ""}\n\nTrotzdem alle anlegen?`;
        else msg += "\n\nAlle frei. Anlegen?";
        if (!window.confirm(msg)) return;
        const seriesId = `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        addBookingSeries(dates.map((dk) => ({ date: dk, field: wish.field, zone: wish.zone, team: wish.team, start: wish.start, end: wish.end, kind: "training", seriesId })));
      } else {
        const entry = { date: wish.date, field: wish.field, zone: wish.zone, team: wish.team, start: wish.start, end: wish.end, kind: "training" };
        const allDayEntries = [...autoTrainingForDay(new Date(wish.date + "T12:00")), ...(bookingsByDay[wish.date] || [])];
        const conflicts = findConflicts({ ...entry, id: "__neu__" }, allDayEntries);
        if (conflicts.length > 0) {
          const list = conflicts.map((c) => `• ${teamById(c.team)?.name || c.team} (${c.start}–${c.end})${c.auto ? " – fix" : ""}`).join("\n");
          if (!window.confirm(`Achtung – Doppelbelegung!\n\n${fieldById(wish.field)?.name} ist belegt durch:\n${list}\n\nWunsch trotzdem annehmen?`)) return;
        }
        addBooking(entry);
      }
      setWishStatus(wish.id, status);
    } else {
      // Ablehnen: optional einen Grund erfassen
      const reason = window.prompt("Grund für die Ablehnung (optional, wird dem Trainer angezeigt):", "") || "";
      setWishStatus(wish.id, status, reason);
    }
  };
  const wishWhen = (w) => w.recur
    ? `jeden ${WEEKDAYS_LONG[w.recur.weekday]} · ${w.recur.from} bis ${w.recur.to}`
    : w.date;
  return (
    <div>
      {open.length === 0 && <p style={{ color: C.textSec, fontSize: 14 }}>Keine offenen Wünsche.</p>}
      {open.map((w) => (
        <div key={w.id} style={S.wishRow}>
          <div>
            <b>{teamById(w.team)?.name || w.team}</b> wünscht {fieldById(w.field)?.name} ({fieldById(w.field)?.zones.find((z) => z.id === w.zone)?.label}) · {wishWhen(w)} · {w.start}–{w.end}
            {w.recur && <span style={{ ...S.zoneBadge, marginLeft: 6 }}>Serie</span>}
            {w.note && <div style={{ fontSize: 12, color: C.textSec }}>„{w.note}"</div>}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button style={S.okBtn} onClick={() => decide(w, "angenommen")}>Annehmen</button>
            <button style={S.delBtn} onClick={() => decide(w, "abgelehnt")}>Ablehnen</button>
          </div>
        </div>
      ))}
      {closed.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={S.subHead}>Bearbeitet</div>
          {closed.slice(-8).reverse().map((w) => (
            <div key={w.id} style={{ ...S.listRow, opacity: 0.7 }}>
              <span>{teamById(w.team)?.name} · {wishWhen(w)} · {w.start}–{w.end}{w.status === "abgelehnt" && w.reason ? ` · Grund: ${w.reason}` : ""}</span>
              <span style={{ fontSize: 12, color: w.status === "angenommen" ? C.ok : C.danger }}>{w.status === "angenommen" ? "✓ angenommen" : "✕ abgelehnt"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Trainer ---------------- */
function TrainerPanel({ trainerTeam, wishes, addWish, trainDays, saveTrainDay, entriesForDay, addMessage, messages }) {
  const [tab, setTab] = useState("trainingstage");
  return (
    <div style={{ ...S.card, marginTop: "1rem" }}>
      <div style={S.adminTabs}>
        {[["trainingstage", "Normale Trainingstage"], ["wunsch", "Wunsch äußern"], ["nachricht", "Nachricht an Platzwart"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...S.tab, ...(tab === k ? S.tabActive : {}) }}>{l}</button>
        ))}
      </div>
      {tab === "trainingstage" && <TrainDaysForm trainerTeam={trainerTeam} trainDays={trainDays} saveTrainDay={saveTrainDay} addWish={addWish} entriesForDay={entriesForDay} />}
      {tab === "wunsch" && <WishForm trainerTeam={trainerTeam} addWish={addWish} wishes={wishes} entriesForDay={entriesForDay} />}
      {tab === "nachricht" && <MessageForm trainerTeam={trainerTeam} addMessage={addMessage} messages={messages} />}
    </div>
  );
}

function MessageForm({ trainerTeam, addMessage, messages }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    addMessage({ team: trainerTeam, text: t });
    setText(""); setSent(true); setTimeout(() => setSent(false), 2000);
  };
  const mine = messages.filter((m) => m.team === trainerTeam).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 5);
  return (
    <div>
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

function TrainDaysForm({ trainerTeam, trainDays, saveTrainDay, addWish, entriesForDay }) {
  const existing = trainDays[trainerTeam] || { days: [], start: "17:30", end: "19:00", field: "p2" };
  const [sel, setSel] = useState(existing.days);
  const [start, setStart] = useState(existing.start);
  const [end, setEnd] = useState(existing.end);
  const [field, setField] = useState(existing.field);
  const [zone, setZone] = useState("p2_voll");
  const [seriesFrom, setSeriesFrom] = useState(dayKey(new Date()));
  const [seriesTo, setSeriesTo] = useState(dayKey(addDays(new Date(), 84)));
  const [saved, setSaved] = useState(false);
  const [sent, setSent] = useState(false);
  const toggle = (i) => setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i].sort()));

  const zones = fieldById(field).zones;
  const safeZone = zones.find((z) => z.id === zone) ? zone : zones[0].id;
  const timeInvalid = !(start < end);

  // Serien-Wunsch: pro gewähltem Wochentag eine Serie an den Platzwart senden
  const sendAsSeries = () => {
    if (timeInvalid || sel.length === 0) return;
    sel.forEach((wd) => {
      addWish({ team: trainerTeam, field, zone: safeZone, start, end, note: "aus Trainingstagen", recur: { weekday: wd, from: seriesFrom, to: seriesTo } });
    });
    setSent(true); setTimeout(() => setSent(false), 2500);
  };

  return (
    <div>
      <p style={{ fontSize: 14, color: C.textSec, marginTop: 0 }}>Melde die regelmäßigen Trainingstage für <b>{teamById(trainerTeam)?.name}</b>. Du kannst sie als Info speichern oder direkt als wiederkehrenden Wunsch an den Platzwart senden.</p>
      {existing.status === "abgelehnt" && (
        <div style={S.warnBanner}>
          ✕ Der Platzwart hat diese Trainingstage abgelehnt{existing.reason ? `: ${existing.reason}` : ""}. Du kannst sie anpassen und erneut speichern.
        </div>
      )}
      {existing.status === "bestaetigt" && (
        <div style={{ ...S.warnBanner, background: "#e1f5ee", color: C.ok, border: "1px solid #9fd8c5" }}>
          ✓ Diese Trainingstage wurden vom Platzwart bestätigt.
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {WEEKDAYS_LONG.map((d, i) => (
          <button key={i} onClick={() => toggle(i)} style={{ ...S.dayPick, ...(sel.includes(i) ? S.dayPickActive : {}) }}>{d}</button>
        ))}
      </div>
      <div style={S.formGrid}>
        <Field label="Von"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={S.select} /></Field>
        <Field label="Bis"><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={S.select} /></Field>
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
      </div>

      {timeInvalid && <div style={S.warnBanner}>⚠️ Die Endzeit muss nach der Startzeit liegen.</div>}

      <button style={S.primaryBtn} onClick={() => { saveTrainDay(trainerTeam, { days: sel, start, end, field, status: "offen", reason: "" }); setSaved(true); setTimeout(() => setSaved(false), 2000); }}>
        Trainingstage speichern
      </button>
      {saved && <span style={{ marginLeft: 10, color: C.ok, fontSize: 13 }}>✓ gespeichert</span>}

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
        <div style={S.subHead}>Als wiederkehrenden Wunsch senden</div>
        <p style={{ fontSize: 13, color: C.textSec, marginTop: 0 }}>
          Sendet für jeden oben gewählten Wochentag eine Serie an den Platzwart (er prüft Konflikte und nimmt an).
        </p>
        <div style={S.formGrid}>
          <Field label="Ab Datum"><input type="date" value={seriesFrom} onChange={(e) => setSeriesFrom(e.target.value)} style={S.select} /></Field>
          <Field label="Bis Datum"><input type="date" value={seriesTo} onChange={(e) => setSeriesTo(e.target.value)} style={S.select} /></Field>
        </div>
        {sel.length === 0 && <div style={{ ...S.warnBanner, background: "#eef4ff", color: "#234", border: "1px solid #b9cdf0" }}>Bitte oben mindestens einen Wochentag wählen.</div>}
        <button
          style={{ ...S.primaryBtn, ...((timeInvalid || sel.length === 0) ? S.btnDisabled : {}) }}
          onClick={sendAsSeries}
          disabled={timeInvalid || sel.length === 0}
        >
          Als Serien-Wunsch an Platzwart senden
        </button>
        {sent && <span style={{ marginLeft: 10, color: C.ok, fontSize: 13 }}>✓ gesendet ({sel.length} Serie(n))</span>}
      </div>
    </div>
  );
}

function WishForm({ trainerTeam, addWish, wishes, entriesForDay }) {
  const [mode, setMode] = useState("single"); // single | series
  const [date, setDate] = useState(dayKey(addDays(new Date(), 1)));
  const [weekday, setWeekday] = useState(1);
  const [seriesFrom, setSeriesFrom] = useState(dayKey(addDays(new Date(), 1)));
  const [seriesTo, setSeriesTo] = useState(dayKey(addDays(new Date(), 84)));
  const [field, setField] = useState("p2");
  const [zone, setZone] = useState("v1");
  const [start, setStart] = useState("17:30");
  const [end, setEnd] = useState("19:00");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const zones = fieldById(field).zones;
  const safeZone = zones.find((z) => z.id === zone) ? zone : zones[0].id;

  const timeInvalid = !(start < end);
  const existingDay = entriesForDay(new Date(date + "T12:00"));
  const liveConflicts = mode === "single" && !timeInvalid
    ? findConflicts({ id: "__neu__", field, zone: safeZone, team: trainerTeam, start, end }, existingDay)
    : [];
  const seriesDates = mode === "series" ? expandRecurrence(seriesFrom, seriesTo, weekday) : [];

  const send = () => {
    if (timeInvalid) return;
    if (mode === "series") {
      if (seriesDates.length === 0) { window.alert("Kein Termin im gewählten Zeitraum."); return; }
      addWish({ team: trainerTeam, field, zone: safeZone, start, end, note, recur: { weekday, from: seriesFrom, to: seriesTo } });
    } else {
      addWish({ team: trainerTeam, date, field, zone: safeZone, start, end, note });
    }
    setNote(""); setSent(true); setTimeout(() => setSent(false), 2000);
  };
  const mine = wishes.filter((w) => w.team === trainerTeam).slice(-6).reverse();

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
        <Field label="Notiz"><input type="text" placeholder="optional" value={note} onChange={(e) => setNote(e.target.value)} style={S.select} /></Field>
      </div>

      {timeInvalid && <div style={S.warnBanner}>⚠️ Die Endzeit muss nach der Startzeit liegen.</div>}
      {mode === "single" && !timeInvalid && liveConflicts.length > 0 && (
        <div style={S.warnBanner}>
          ⚠️ Achtung: {fieldById(field)?.name} ist zu dieser Zeit schon belegt durch{" "}
          {liveConflicts.map((c) => `${teamById(c.team)?.name || c.team}${c.auto ? " (fix)" : ""}`).join(", ")}. Du kannst den Wunsch trotzdem absenden – der Platzwart entscheidet.
        </div>
      )}
      {mode === "series" && !timeInvalid && (
        <div style={{ ...S.warnBanner, background: "#eef4ff", color: "#234", border: "1px solid #b9cdf0" }}>
          Serien-Wunsch: <b>{seriesDates.length}</b> {WEEKDAYS_LONG[weekday]}-Termine. Der Platzwart prüft Konflikte beim Annehmen.
        </div>
      )}

      <button style={{ ...S.primaryBtn, ...(timeInvalid ? S.btnDisabled : {}) }} onClick={send} disabled={timeInvalid}>
        {mode === "series" ? "Serien-Wunsch absenden" : "Wunsch absenden"}
      </button>
      {sent && <span style={{ marginLeft: 10, color: C.ok, fontSize: 13 }}>✓ gesendet</span>}

      {mine.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={S.subHead}>Meine letzten Wünsche</div>
          {mine.map((w) => (
            <div key={w.id} style={S.listRow}>
              <span>{w.recur ? `jeden ${WEEKDAYS_LONG[w.recur.weekday]} (${w.recur.from}–${w.recur.to})` : w.date} · {fieldById(w.field)?.name} · {w.start}–{w.end}{w.status === "abgelehnt" && w.reason ? ` · Grund: ${w.reason}` : ""}</span>
              <span style={{ fontSize: 12, color: w.status === "offen" ? C.textSec : w.status === "angenommen" ? C.ok : C.danger }}>
                {w.status === "offen" ? "offen" : w.status === "angenommen" ? "✓ angenommen" : "✕ abgelehnt"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Trainingstage-Übersicht ---------------- */
function TrainDaysOverview({ trainDays }) {
  const entries = Object.entries(trainDays).filter(([, v]) => v && v.days && v.days.length && v.status !== "abgelehnt");
  if (entries.length === 0) return null;
  return (
    <div style={{ ...S.card, marginTop: "1rem" }}>
      <div style={S.subHead}>Gemeldete Trainingstage</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {entries.map(([teamId, v]) => (
          <div key={teamId} style={{ ...S.chip, borderLeft: `3px solid ${teamById(teamId)?.color || C.textSec}`, minWidth: 180 }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>{teamById(teamId)?.name}{v.status === "bestaetigt" ? " ✓" : ""}</div>
            <div style={{ fontSize: 12, color: C.textSec }}>{v.days.map((d) => WEEKDAYS[d]).join(", ")} · {v.start}–{v.end} · {fieldById(v.field)?.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

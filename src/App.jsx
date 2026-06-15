import React, { useState, useMemo, useCallback } from "react";
import {
  TEAMS, FIELDS, teamById, fieldById, WEEKDAYS, WEEKDAYS_LONG,
  dayKey, mondayOf, addDays, isoWeek, fmtRange,
  autoTrainingForDay, findConflicts, conflictIdsForEntries,
} from "./lib/domain";
import { useAuth } from "./lib/auth";
import { useBookings, useWishes, useTrainingDays, useLocks } from "./lib/data";
import { C, S } from "./lib/styles";
import Pitch from "./components/Pitch";

export default function App() {
  const { user, isAdmin, loginAdmin, logoutAdmin } = useAuth();
  const { bookings, bookingsReady, addBooking, removeBooking } = useBookings();
  const { wishes, wishesReady, addWish, setWishStatus } = useWishes();
  const { trainDays, trainDaysReady, saveTrainDay, removeTrainDay } = useTrainingDays();
  const { locks, locksReady, addLock, removeLock } = useLocks();

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
    const pw = window.prompt("Admin-Zugang – bitte Passwort eingeben:");
    if (pw === null) return;
    if (loginAdmin(pw)) setView("admin");
    else window.alert("Falsches Passwort. Zugang verweigert.");
  };

  const ready = bookingsReady && wishesReady && locksReady && trainDaysReady;
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
        notices={openWishCount + weekConflictCount}
      />

      <WeekNav weekStart={weekStart} setWeekStart={setWeekStart} />

      {isAdmin && (openWishCount > 0 || weekConflictCount > 0) && (
        <div style={S.warnBanner}>
          ⚠️ Hinweis für Admin:
          {weekConflictCount > 0 && ` ${weekConflictCount} Belegung(en) mit Konflikt in dieser Woche.`}
          {openWishCount > 0 && ` ${openWishCount} offene(r) Trainerwunsch/-wünsche.`}
          {" "}Bitte im Admin-Bereich prüfen.
        </div>
      )}

      <WeekGrid
        days={days}
        entriesForDay={entriesForDay}
        lockForDayField={lockForDayField}
        activeField={activeField}
        setActiveField={setActiveField}
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
          bookingsByDay={bookingsByDay}
          addBooking={addBooking}
          removeBooking={removeBooking}
          wishes={wishes}
          setWishStatus={setWishStatus}
          locks={locks}
          addLock={addLock}
          removeLock={removeLock}
          trainDays={trainDays}
          removeTrainDay={removeTrainDay}
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
        />
      )}

      {view === "viewer" && (
        <div style={{ ...S.card, marginTop: "1rem", color: C.textSec, fontSize: 14 }}>
          Lesemodus. Trainer können ohne Anmeldung Trainingstage melden und Wünsche äußern;
          Konflikte werden dabei sofort angezeigt. Der Admin pflegt Belegungen, Heimspiele und
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
          {[["viewer", "Betrachter"], ["trainer", "Trainer"], ["admin", "Admin"]].map(([k, label]) => (
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
          <button style={S.navBtn} onClick={logoutAdmin}>Admin abmelden</button>
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
function WeekGrid({ days, entriesForDay, lockForDayField, activeField, setActiveField }) {
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
                  <Chip key={e.id} entry={e} conflict={conflictIds.has(e.id)} />
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

function Chip({ entry, conflict }) {
  const t = teamById(entry.team);
  const zoneLabel = entry.field === "p2" ? entry.zone.toUpperCase()
    : entry.field === "p3" ? (entry.zone === "h1" ? "H1" : "H2") : "";
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
        {entry.start}–{entry.end}{entry.kind === "match" && " · Heimspiel"}{entry.auto && " · fix"}
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
  const zoneOccupants = (zoneId) => entries.filter((e) => e.zone === zoneId);

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
          ? " 1./2. Mannschaft belegen Di & Do je 2 Viertel (halber Platz) und wechseln wöchentlich zwischen Oberhaid und Hallstadt."
          : " Aufteilung nach Belegung."}
      </p>
    </div>
  );
}

/* ---------------- Admin ---------------- */
function AdminPanel({ days, bookingsByDay, addBooking, removeBooking, wishes, setWishStatus, locks, addLock, removeLock, trainDays, removeTrainDay }) {
  const [tab, setTab] = useState("belegung");
  const open = wishes.filter((w) => w.status === "offen").length;
  return (
    <div style={{ ...S.card, marginTop: "1rem" }}>
      <div style={S.adminTabs}>
        {[
          ["belegung", "Belegung eintragen"],
          ["spiel", "Heimspiel"],
          ["sperre", "Platzsperre"],
          ["trainingstage", "Trainingstage"],
          ["wuensche", `Wünsche${open ? ` (${open})` : ""}`],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...S.tab, ...(tab === k ? S.tabActive : {}) }}>{l}</button>
        ))}
      </div>
      {tab === "belegung" && <BookingForm days={days} bookingsByDay={bookingsByDay} addBooking={addBooking} removeBooking={removeBooking} kind="training" />}
      {tab === "spiel" && <BookingForm days={days} bookingsByDay={bookingsByDay} addBooking={addBooking} removeBooking={removeBooking} kind="match" />}
      {tab === "sperre" && <LockForm locks={locks} addLock={addLock} removeLock={removeLock} />}
      {tab === "trainingstage" && <TrainDaysAdmin trainDays={trainDays} removeTrainDay={removeTrainDay} />}
      {tab === "wuensche" && <WishInbox wishes={wishes} setWishStatus={setWishStatus} addBooking={addBooking} bookingsByDay={bookingsByDay} />}
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

function BookingForm({ days, bookingsByDay, addBooking, removeBooking, kind }) {
  const [date, setDate] = useState(dayKey(days[0]));
  const [team, setTeam] = useState("u15");
  const [field, setField] = useState(kind === "match" ? "p1" : "p2");
  const [zone, setZone] = useState("v1");
  const [start, setStart] = useState(kind === "match" ? "15:00" : "17:00");
  const [end, setEnd] = useState(kind === "match" ? "17:00" : "18:30");

  const zones = fieldById(field).zones;
  const safeZone = zones.find((z) => z.id === zone) ? zone : zones[0].id;
  const candidate = { id: "__neu__", field, zone: safeZone, team, start, end, kind };
  const allDayEntries = [...autoTrainingForDay(new Date(date + "T12:00")), ...(bookingsByDay[date] || [])];
  const timeInvalid = !(start < end);
  const liveConflicts = timeInvalid ? [] : findConflicts(candidate, allDayEntries);

  const add = () => {
    if (timeInvalid) return;
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

  const dayEntries = (bookingsByDay[date] || []).filter((e) => e.field === field);

  return (
    <div>
      <div style={S.formGrid}>
        <Field label="Tag">
          <select value={date} onChange={(e) => setDate(e.target.value)} style={S.select}>
            {days.map((d) => <option key={dayKey(d)} value={dayKey(d)}>{WEEKDAYS_LONG[(d.getDay() + 6) % 7]} {d.getDate()}.{d.getMonth() + 1}.</option>)}
          </select>
        </Field>
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
      {!timeInvalid && liveConflicts.length > 0 && (
        <div style={S.warnBanner}>
          ⚠️ Doppelbelegung: {fieldById(field)?.name} ist {start}–{end} schon belegt durch{" "}
          {liveConflicts.map((c) => `${teamById(c.team)?.name || c.team}${c.auto ? " (fix)" : ""}`).join(", ")}. Eintragen ist möglich, wird aber nachgefragt.
        </div>
      )}

      <button style={{ ...S.primaryBtn, ...(timeInvalid ? S.btnDisabled : {}) }} onClick={add} disabled={timeInvalid}>
        {kind === "match" ? "Heimspiel eintragen" : "Belegung eintragen"}
      </button>

      {dayEntries.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={S.subHead}>Einträge an diesem Tag ({fieldById(field).name})</div>
          {dayEntries.map((e) => (
            <div key={e.id} style={S.listRow}>
              <span><b>{teamById(e.team)?.name || e.team}</b> · {fieldById(e.field).name} · {fieldById(e.field).zones.find((z) => z.id === e.zone)?.label} · {e.start}–{e.end}{e.kind === "match" && " · Heimspiel"}</span>
              <button style={S.delBtn} onClick={() => removeBooking(e.id)}>Löschen</button>
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

function TrainDaysAdmin({ trainDays, removeTrainDay }) {
  const entries = Object.entries(trainDays).filter(([, v]) => v && v.days && v.days.length);
  return (
    <div>
      <p style={{ fontSize: 14, color: C.textSec, marginTop: 0 }}>Von den Trainern gemeldete regelmäßige Trainingstage. Veraltete Meldungen kannst du entfernen.</p>
      {entries.length === 0 && <p style={{ color: C.textSec, fontSize: 14 }}>Noch keine Trainingstage gemeldet.</p>}
      {entries.map(([teamId, v]) => (
        <div key={teamId} style={S.listRow}>
          <span><b>{teamById(teamId)?.name || teamId}</b> · {v.days.map((d) => WEEKDAYS[d]).join(", ")} · {v.start}–{v.end} · {fieldById(v.field)?.name}</span>
          <button style={S.delBtn} onClick={() => { if (window.confirm(`Trainingstage von ${teamById(teamId)?.name} löschen?`)) removeTrainDay(teamId); }}>Löschen</button>
        </div>
      ))}
    </div>
  );
}

function WishInbox({ wishes, setWishStatus, addBooking, bookingsByDay }) {
  const open = wishes.filter((w) => w.status === "offen");
  const closed = wishes.filter((w) => w.status !== "offen");
  const decide = (wish, status) => {
    if (status === "angenommen") {
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
  };
  return (
    <div>
      {open.length === 0 && <p style={{ color: C.textSec, fontSize: 14 }}>Keine offenen Wünsche.</p>}
      {open.map((w) => (
        <div key={w.id} style={S.wishRow}>
          <div>
            <b>{teamById(w.team)?.name || w.team}</b> wünscht {fieldById(w.field)?.name} ({fieldById(w.field)?.zones.find((z) => z.id === w.zone)?.label}) · {w.date} · {w.start}–{w.end}
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
              <span>{teamById(w.team)?.name} · {w.date} · {w.start}–{w.end}</span>
              <span style={{ fontSize: 12, color: w.status === "angenommen" ? C.ok : C.danger }}>{w.status === "angenommen" ? "✓ angenommen" : "✕ abgelehnt"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Trainer ---------------- */
function TrainerPanel({ trainerTeam, wishes, addWish, trainDays, saveTrainDay, entriesForDay }) {
  const [tab, setTab] = useState("trainingstage");
  return (
    <div style={{ ...S.card, marginTop: "1rem" }}>
      <div style={S.adminTabs}>
        {[["trainingstage", "Normale Trainingstage"], ["wunsch", "Wunsch äußern"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...S.tab, ...(tab === k ? S.tabActive : {}) }}>{l}</button>
        ))}
      </div>
      {tab === "trainingstage" && <TrainDaysForm trainerTeam={trainerTeam} trainDays={trainDays} saveTrainDay={saveTrainDay} />}
      {tab === "wunsch" && <WishForm trainerTeam={trainerTeam} addWish={addWish} wishes={wishes} entriesForDay={entriesForDay} />}
    </div>
  );
}

function TrainDaysForm({ trainerTeam, trainDays, saveTrainDay }) {
  const existing = trainDays[trainerTeam] || { days: [], start: "17:30", end: "19:00", field: "p2" };
  const [sel, setSel] = useState(existing.days);
  const [start, setStart] = useState(existing.start);
  const [end, setEnd] = useState(existing.end);
  const [field, setField] = useState(existing.field);
  const [saved, setSaved] = useState(false);
  const toggle = (i) => setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i].sort()));
  return (
    <div>
      <p style={{ fontSize: 14, color: C.textSec, marginTop: 0 }}>Melde die regelmäßigen Trainingstage für <b>{teamById(trainerTeam)?.name}</b>. Der Admin nutzt sie als Grundlage für den Jahresplan.</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {WEEKDAYS_LONG.map((d, i) => (
          <button key={i} onClick={() => toggle(i)} style={{ ...S.dayPick, ...(sel.includes(i) ? S.dayPickActive : {}) }}>{d}</button>
        ))}
      </div>
      <div style={S.formGrid}>
        <Field label="Von"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={S.select} /></Field>
        <Field label="Bis"><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={S.select} /></Field>
        <Field label="Bevorzugter Platz">
          <select value={field} onChange={(e) => setField(e.target.value)} style={S.select}>
            {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
      </div>
      <button style={S.primaryBtn} onClick={() => { saveTrainDay(trainerTeam, { days: sel, start, end, field }); setSaved(true); setTimeout(() => setSaved(false), 2000); }}>
        Trainingstage speichern
      </button>
      {saved && <span style={{ marginLeft: 10, color: C.ok, fontSize: 13 }}>✓ gespeichert</span>}
    </div>
  );
}

function WishForm({ trainerTeam, addWish, wishes, entriesForDay }) {
  const [date, setDate] = useState(dayKey(addDays(new Date(), 1)));
  const [field, setField] = useState("p2");
  const [zone, setZone] = useState("v1");
  const [start, setStart] = useState("17:30");
  const [end, setEnd] = useState("19:00");
  const [note, setNote] = useState("");
  const zones = fieldById(field).zones;
  const safeZone = zones.find((z) => z.id === zone) ? zone : zones[0].id;

  const timeInvalid = !(start < end);
  const existingDay = entriesForDay(new Date(date + "T12:00"));
  const liveConflicts = timeInvalid ? [] : findConflicts({ id: "__neu__", field, zone: safeZone, team: trainerTeam, start, end }, existingDay);

  const send = () => {
    if (timeInvalid) return;
    addWish({ team: trainerTeam, date, field, zone: safeZone, start, end, note });
    setNote("");
  };
  const mine = wishes.filter((w) => w.team === trainerTeam).slice(-6).reverse();

  return (
    <div>
      <div style={S.formGrid}>
        <Field label="Datum"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={S.select} /></Field>
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
      {!timeInvalid && liveConflicts.length > 0 && (
        <div style={S.warnBanner}>
          ⚠️ Achtung: {fieldById(field)?.name} ist zu dieser Zeit schon belegt durch{" "}
          {liveConflicts.map((c) => `${teamById(c.team)?.name || c.team}${c.auto ? " (fix)" : ""}`).join(", ")}. Du kannst den Wunsch trotzdem absenden – der Admin entscheidet.
        </div>
      )}

      <button style={{ ...S.primaryBtn, ...(timeInvalid ? S.btnDisabled : {}) }} onClick={send} disabled={timeInvalid}>Wunsch absenden</button>

      {mine.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={S.subHead}>Meine letzten Wünsche</div>
          {mine.map((w) => (
            <div key={w.id} style={S.listRow}>
              <span>{w.date} · {fieldById(w.field)?.name} · {w.start}–{w.end}</span>
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
  const entries = Object.entries(trainDays).filter(([, v]) => v && v.days && v.days.length);
  if (entries.length === 0) return null;
  return (
    <div style={{ ...S.card, marginTop: "1rem" }}>
      <div style={S.subHead}>Gemeldete Trainingstage</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {entries.map(([teamId, v]) => (
          <div key={teamId} style={{ ...S.chip, borderLeft: `3px solid ${teamById(teamId)?.color || C.textSec}`, minWidth: 180 }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>{teamById(teamId)?.name}</div>
            <div style={{ fontSize: 12, color: C.textSec }}>{v.days.map((d) => WEEKDAYS[d]).join(", ")} · {v.start}–{v.end} · {fieldById(v.field)?.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

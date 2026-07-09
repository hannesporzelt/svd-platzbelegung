// src/lib/maehplan.js
// Firestore-Datenzugriff für den integrierten Mähplan.
// Nutzt dieselbe Firebase-Instanz wie die Platzbelegungsapp.

import { useEffect, useState, useCallback } from "react";
import {
  collection, doc, onSnapshot, setDoc, updateDoc,
  addDoc, deleteDoc, query, where, orderBy, writeBatch,
  getDocs,
} from "firebase/firestore";
import { db } from "./firebase";
import { dayKey } from "./domain";

// ---- Hilfsfunktionen ------------------------------------------------

export function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

export function getDateOfISOWeek(week, year) {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay();
  const monday = new Date(simple);
  monday.setUTCDate(simple.getUTCDate() - (dow <= 4 ? dow - 1 : dow - 8));
  return monday;
}

export function advanceKW(kw) {
  const d = getDateOfISOWeek(kw.week, kw.year);
  d.setUTCDate(d.getUTCDate() + 7);
  return { week: getISOWeek(d), year: d.getUTCFullYear() };
}

export function currentKW() {
  const now = new Date();
  return { week: getISOWeek(now), year: now.getFullYear() };
}

// Standardfarben je Platz
export const FIELD_COLORS = {
  p1: { bg: "#1a3a1a", accent: "#4caf50", light: "#e8f5e9", border: "#2e7d32" },
  p2: { bg: "#1a2e3a", accent: "#29b6f6", light: "#e1f5fe", border: "#0277bd" },
  p3: { bg: "#2a2a1a", accent: "#ffc107", light: "#fff8e1", border: "#f57f17" },
};

export const FIELD_NAMES = { p1: "Platz 1", p2: "Platz 2", p3: "Platz 3" };

export const TYPE_ICONS  = { "mähen": "🌿", "striegeln": "🪮", "beides": "🌿🪮", "duengen": "🧪" };
export const TYPE_LABELS = { "mähen": "Mähen", "striegeln": "Striegeln", "beides": "Mähen & Striegeln", "duengen": "Düngen" };

export const MAINTENANCE_TYPES = {
  "nachsaeen":     { icon: "🌱", label: "Nachsäen" },
  "besanden":      { icon: "🏖️", label: "Besanden" },
  "aerifizieren":  { icon: "🕳️", label: "Aerifizieren" },
  "vertikutieren": { icon: "🍂", label: "Vertikutieren" },
  "striegeln":     { icon: "🪮", label: "Striegeln" },
  "duengen":       { icon: "🧪", label: "Düngen" },
};

export const WEEKDAYS_MP  = ["Mo","Di","Mi","Do","Fr","Sa","So"];
export const WEEKDAYS_FULL = ["Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag","Sonntag"];
export const MONTHS_NO_MOW = [11, 12, 1, 2]; // Winterpause

// Standard-Wochenplan-Daten (falls Firestore leer)
export const DEFAULT_PLAN = {
  p1: {
    name: "Platz 1", notes: "Hauptspielfeld", bemerkung: "",
    ...FIELD_COLORS.p1,
    tasks: [
      { id: "p1-mow-tue", type: "mähen",     dayIndex: 1,    persons: [], done: false },
      { id: "p1-mow-fri", type: "mähen",     dayIndex: 4,    persons: [], done: false },
      { id: "p1-str",     type: "striegeln", dayIndex: null, persons: [], done: false, freeDay: true, note: "Nur nach Heimspielen – Tag frei wählbar" },
    ],
  },
  p2: {
    name: "Platz 2", notes: "Trainingsplatz", bemerkung: "",
    ...FIELD_COLORS.p2,
    tasks: [
      { id: "p2-mow-mon", type: "mähen",     dayIndex: 0, persons: [], done: false },
      { id: "p2-mow-thu", type: "mähen",     dayIndex: 3, persons: [], done: false },
      { id: "p2-str",     type: "striegeln", dayIndex: 0, persons: [], done: false },
    ],
  },
  p3: {
    name: "Platz 3", notes: "Nebenplatz – max. 1x/Woche, kein Sonntag", bemerkung: "",
    ...FIELD_COLORS.p3,
    tasks: [
      { id: "p3-both", type: "beides", dayIndex: 2, persons: [], done: false, note: "Mähen & Striegeln am selben Tag" },
    ],
  },
};

// ---- Haupt-Hook -----------------------------------------------------

export function useMaehplan(enabled = true) {
  const [plan, setPlan]               = useState(null);  // { p1, p2, p3 } je mit tasks etc.
  const [kw, setKw]                   = useState(null);  // { week, year }
  const [worklog, setWorklog]         = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [signups, setSignups]         = useState([]);
  const [archive, setArchive]         = useState([]);
  const [ready, setReady]             = useState(false);

  // Echtzeit-Listener auf maehplan_plan
  useEffect(() => {
    if (!enabled) { setReady(true); return; }
    const unsubs = [];
    const planData = {};
    let loadedCount = 0;

    ["p1", "p2", "p3"].forEach(fieldId => {
      const unsub = onSnapshot(doc(db, "maehplan_plan", fieldId), snap => {
        if (snap.exists()) {
          planData[fieldId] = snap.data();
          if (fieldId === "p1" && snap.data().currentKW) {
            setKw(snap.data().currentKW);
          }
        } else {
          // Noch kein Dokument → Standardwerte
          planData[fieldId] = { ...DEFAULT_PLAN[fieldId] };
          if (fieldId === "p1") {
            setKw(currentKW());
          }
        }
        loadedCount++;
        if (loadedCount >= 3) {
          setPlan({ ...planData });
          setReady(true);
        }
      });
      unsubs.push(unsub);
    });

    return () => unsubs.forEach(u => u());
  }, [enabled]);

  // Echtzeit-Listener auf Arbeitsprotokoll
  useEffect(() => {
    if (!enabled) return;
    const q = query(collection(db, "maehplan_worklog"), orderBy("date", "desc"));
    return onSnapshot(q, snap => {
      setWorklog(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
  }, [enabled]);

  // Echtzeit-Listener auf Pflegemaßnahmen
  useEffect(() => {
    if (!enabled) return;
    const q = query(collection(db, "maehplan_maintenance"), orderBy("date", "desc"));
    return onSnapshot(q, snap => {
      setMaintenance(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
  }, [enabled]);

  // Echtzeit-Listener auf Vormerkungen
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(collection(db, "maehplan_signups"), snap => {
      setSignups(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
  }, [enabled]);

  // Echtzeit-Listener auf Archiv
  useEffect(() => {
    if (!enabled) return;
    const q = query(collection(db, "maehplan_archive"), orderBy("archivedAt", "desc"));
    return onSnapshot(q, snap => {
      setArchive(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
  }, [enabled]);

  // ---- Schreib-Funktionen ------------------------------------------

  // Wochenplan-Dokument für einen Platz speichern
  const savePlan = useCallback(async (fieldId, data) => {
    await setDoc(
      doc(db, "maehplan_plan", fieldId),
      { ...data, updatedTs: Date.now() },
      { merge: true }
    );
  }, []);

  // Einzelne Task-Liste eines Platzes aktualisieren
  const saveTasks = useCallback(async (fieldId, tasks) => {
    await updateDoc(doc(db, "maehplan_plan", fieldId), { tasks, updatedTs: Date.now() });
  }, []);

  // Person zu einer Aufgabe hinzufügen
  const addPerson = useCallback(async (fieldId, taskId, person) => {
    if (!plan || !plan[fieldId]) return;
    const tasks = plan[fieldId].tasks.map(t =>
      t.id === taskId ? { ...t, persons: [...(t.persons || []), person] } : t
    );
    await saveTasks(fieldId, tasks);
  }, [plan, saveTasks]);

  // Person von einer Aufgabe entfernen
  const removePerson = useCallback(async (fieldId, taskId, idx) => {
    if (!plan || !plan[fieldId]) return;
    const tasks = plan[fieldId].tasks.map(t =>
      t.id === taskId ? { ...t, persons: t.persons.filter((_, i) => i !== idx) } : t
    );
    await saveTasks(fieldId, tasks);
  }, [plan, saveTasks]);

  // Aufgabe als erledigt/nicht erledigt markieren
  const toggleDone = useCallback(async (fieldId, taskId) => {
    if (!plan || !plan[fieldId]) return;
    const tasks = plan[fieldId].tasks.map(t =>
      t.id === taskId ? { ...t, done: !t.done } : t
    );
    await saveTasks(fieldId, tasks);
  }, [plan, saveTasks]);

  // Aufgabe verschieben
  const postponeTask = useCallback(async (fieldId, taskId, dayIndex, reason) => {
    if (!plan || !plan[fieldId]) return;
    const tasks = plan[fieldId].tasks.map(t =>
      t.id === taskId ? { ...t, postponedTo: dayIndex, postponeReason: reason || "" } : t
    );
    await saveTasks(fieldId, tasks);
  }, [plan, saveTasks]);

  // Verschiebung aufheben
  const cancelPostpone = useCallback(async (fieldId, taskId) => {
    if (!plan || !plan[fieldId]) return;
    const tasks = plan[fieldId].tasks.map(t =>
      t.id === taskId ? { ...t, postponedTo: undefined, postponeReason: undefined } : t
    );
    await saveTasks(fieldId, tasks);
  }, [plan, saveTasks]);

  // Freien Tag setzen (für Aufgaben mit freeDay)
  const setFreeDay = useCallback(async (fieldId, taskId, dayIndex) => {
    if (!plan || !plan[fieldId]) return;
    const tasks = plan[fieldId].tasks.map(t =>
      t.id === taskId ? { ...t, dayIndex } : t
    );
    await saveTasks(fieldId, tasks);
  }, [plan, saveTasks]);

  // Bemerkung aktualisieren
  const updateBemerkung = useCallback(async (fieldId, text) => {
    await updateDoc(doc(db, "maehplan_plan", fieldId), { bemerkung: text, updatedTs: Date.now() });
  }, []);

  // Neue Woche starten
  const resetWeek = useCallback(async () => {
    if (!plan || !kw) return;
    const todayWd = (new Date().getDay() + 6) % 7;
    const newKw = advanceKW(kw);
    const newKey = newKw.year * 100 + newKw.week;

    const batch = writeBatch(db);

    for (const fieldId of ["p1", "p2", "p3"]) {
      if (!plan[fieldId]) continue;
      const currentSignups = signups.filter(
        s => s.fieldName === fieldId && (s.year * 100 + s.week) === newKey
      );
      const tasks = plan[fieldId].tasks.map(t => {
        const taskDay = t.postponedTo !== undefined ? t.postponedTo : t.dayIndex;
        const isFuture = taskDay !== null && taskDay !== undefined && taskDay > todayWd;
        const matching = currentSignups.filter(s => s.taskId === t.id);
        const pre = matching.map(s => s.person);
        const dayOverride = matching.find(s => s.day !== undefined && s.day !== null);
        if (dayOverride) {
          return { ...t, persons: pre, done: false, postponedTo: dayOverride.day,
            postponeReason: `Vormerkung: ${dayOverride.person}` };
        }
        if (isFuture) {
          return { ...t, persons: pre.length > 0 ? pre : t.persons, done: false,
            postponedTo: undefined, postponeReason: undefined };
        }
        return { ...t, persons: pre, done: false, postponedTo: undefined, postponeReason: undefined };
      });
      const update = { tasks, bemerkung: "", updatedTs: Date.now() };
      if (fieldId === "p1") update.currentKW = newKw;
      batch.update(doc(db, "maehplan_plan", fieldId), update);
    }

    // Abgelaufene Vormerkungen löschen
    const staleSignups = signups.filter(s => (s.year * 100 + s.week) <= newKey);
    staleSignups.forEach(s => batch.delete(doc(db, "maehplan_signups", s.id)));

    // Offene Pflegemaßnahmen in neue Woche verschieben
    const newMondayStr = getDateOfISOWeek(newKw.week, newKw.year)
      .toISOString().slice(0, 10);
    maintenance.filter(m => m.done === false).forEach(m => {
      batch.update(doc(db, "maehplan_maintenance", m.id),
        { date: newMondayStr, carriedOver: true });
    });

    await batch.commit();
    setKw(newKw);
  }, [plan, kw, signups, maintenance]);

  // ---- Arbeitsprotokoll ------------------------------------------

  const addWorklogEntry = useCallback(async (entry) => {
    await addDoc(collection(db, "maehplan_worklog"), {
      ...entry, ts: Date.now(),
    });
  }, []);

  const deleteWorklogEntry = useCallback(async (id) => {
    await deleteDoc(doc(db, "maehplan_worklog", id));
  }, []);

  // ---- Pflegemaßnahmen -------------------------------------------

  const addMaintenance = useCallback(async (entry) => {
    await addDoc(collection(db, "maehplan_maintenance"), {
      ...entry, done: false, ts: Date.now(),
    });
  }, []);

  const toggleMaintenanceDone = useCallback(async (id, currentDone) => {
    await updateDoc(doc(db, "maehplan_maintenance", id), { done: !currentDone });
  }, []);

  const deleteMaintenance = useCallback(async (id) => {
    await deleteDoc(doc(db, "maehplan_maintenance", id));
  }, []);

  // ---- Vormerkungen ----------------------------------------------

  const addSignup = useCallback(async (entry) => {
    await addDoc(collection(db, "maehplan_signups"), entry);
  }, []);

  const removeSignup = useCallback(async (id) => {
    await deleteDoc(doc(db, "maehplan_signups", id));
  }, []);

  // ---- Saisonarchiv ----------------------------------------------

  const archiveSeason = useCallback(async (label) => {
    const totalHours = worklog.reduce((sum, w) => {
      const h = parseFloat((w.duration || "0").replace(",", ".")) || 0;
      return sum + h;
    }, 0);
    await addDoc(collection(db, "maehplan_archive"), {
      label: label || `Saison bis KW ${kw?.week}/${kw?.year}`,
      archivedAt: Date.now(),
      totalEntries: worklog.length,
      totalHours,
      maintenanceCount: maintenance.length,
      worklog: [...worklog],
      maintenanceLog: [...maintenance],
    });
    // Worklog und Maintenance leeren
    const batch = writeBatch(db);
    worklog.forEach(w => batch.delete(doc(db, "maehplan_worklog", w.id)));
    maintenance.forEach(m => batch.delete(doc(db, "maehplan_maintenance", m.id)));
    await batch.commit();
  }, [worklog, maintenance, kw]);

  return {
    plan, kw, worklog, maintenance, signups, archive, ready,
    savePlan, saveTasks,
    addPerson, removePerson, toggleDone,
    postponeTask, cancelPostpone, setFreeDay,
    updateBemerkung, resetWeek,
    addWorklogEntry, deleteWorklogEntry,
    addMaintenance, toggleMaintenanceDone, deleteMaintenance,
    addSignup, removeSignup,
    archiveSeason,
  };
}

// ── Monatsplanung: geplante Mähtage berechnen ─────────────────────────
// Gibt für jeden Tag im Monat zurück welche Plätze gemäht/gestriegelt werden.
// Berücksichtigt dayIndex und postponedTo der aktuellen Woche.
// Format: { "2026-07-01": ["p1","p2"], "2026-07-04": ["p3"], ... }
export function getMaehDaysForMonth(plan, year, month) {
  if (!plan) return {};
  const result = {};

  // Alle Tage des Monats durchgehen
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const wd = (d.getDay() + 6) % 7; // 0=Mo..6=So
    const dk = `${year}-${String(month + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;

    const fieldsToday = [];
    for (const [fieldId, fieldData] of Object.entries(plan)) {
      if (!fieldData || !fieldData.tasks) continue;
      for (const task of fieldData.tasks) {
        if (task.type !== "mähen" && task.type !== "striegeln" && task.type !== "beides") continue;
        // Effektiver Tag: verschoben oder Standard
        const effectiveDay = task.postponedTo !== undefined && task.postponedTo !== null
          ? task.postponedTo : task.dayIndex;
        if (effectiveDay === wd) {
          if (!fieldsToday.includes(fieldId)) fieldsToday.push(fieldId);
        }
      }
    }
    if (fieldsToday.length > 0) result[dk] = fieldsToday;
  }
  return result;
}

// Gibt für einen Wochentag (0=Mo..6=So) zurück welche Plätze gemäht werden
export function getMaehFieldsForWeekday(plan, wd) {
  if (!plan) return [];
  const fields = [];
  for (const [fieldId, fieldData] of Object.entries(plan)) {
    if (!fieldData || !fieldData.tasks) continue;
    for (const task of fieldData.tasks) {
      if (task.type !== "mähen" && task.type !== "striegeln" && task.type !== "beides") continue;
      const effectiveDay = task.postponedTo !== undefined && task.postponedTo !== null
        ? task.postponedTo : task.dayIndex;
      if (effectiveDay === wd && !fields.includes(fieldId)) {
        fields.push(fieldId);
      }
    }
  }
  return fields;
}

// Gibt zurück ob eine Aufgabe für einen Platz an einem Wochentag besetzt ist
// (d.h. mindestens eine Person eingetragen und erledigt oder geplant)
export function getMaehStatusForDay(plan, fieldId, wd) {
  if (!plan || !plan[fieldId]) return null;
  for (const task of (plan[fieldId].tasks || [])) {
    if (task.type !== "mähen" && task.type !== "striegeln" && task.type !== "beides") continue;
    const effectiveDay = task.postponedTo !== undefined && task.postponedTo !== null
      ? task.postponedTo : task.dayIndex;
    if (effectiveDay === wd) {
      return {
        done: task.done,
        persons: task.persons || [],
        type: task.type,
      };
    }
  }
  return null;
}

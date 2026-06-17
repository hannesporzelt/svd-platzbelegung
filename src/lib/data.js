// Datenzugriff auf Firestore – Echtzeit, geräteübergreifend synchron.
//
// Collections:
//   bookings      manuelle Belegungen + Heimspiele  { date, field, zone, team, start, end, kind, seriesId? }
//   wishes        Trainerwünsche                    { team, date|recur, field, zone, start, end, note, status }
//                 recur (optional) = { weekday, from, to } für wiederkehrende Wünsche
//   trainingDays  gemeldete Trainingstage           docId = teamId; { days:[], start, end, field }
//   locks         Platzsperren                      { field, from, to, reason }
//   messages      Nachrichten Trainer -> Admin       { team, text, ts, done }

import { useEffect, useState } from "react";
import {
  collection, doc, addDoc, deleteDoc, updateDoc, setDoc, onSnapshot, writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";

function useCollection(name) {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, name), (snap) => {
      setItems(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
      setReady(true);
    });
    return unsub;
  }, [name]);
  return { items, ready };
}

export function useBookings() {
  const { items, ready } = useCollection("bookings");
  // Inhaltsbasierte ID für direkte Einzelbelegungen des Platzwarts:
  // schützt vor versehentlichem Doppelklick (identischer Eintrag -> dasselbe Dokument).
  const contentId = (b) =>
    [b.date, b.field, b.zone, b.team, b.start, b.end, b.kind || "training"]
      .join("_")
      .replace(/[^A-Za-z0-9_:-]/g, "");
  // Eindeutige ID (für Anträge und Serien): mehrere Einträge kollidieren nie.
  const uniqueId = () => `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Welche ID ein Eintrag bekommt: Anträge und Serienteile immer eindeutig,
  // direkte Einzelbelegungen inhaltsbasiert (Doppelklick-Schutz).
  const idFor = (b) => (b.status === "beantragt" || b.seriesId ? uniqueId() : contentId(b));
  return {
    bookings: items,
    bookingsReady: ready,
    addBooking: (b) => setDoc(doc(db, "bookings", idFor(b)), b),
    // Mehrere Belegungen einer Serie auf einmal schreiben (gemeinsame seriesId)
    addBookingSeries: async (entries) => {
      const batch = writeBatch(db);
      entries.forEach((e) => batch.set(doc(db, "bookings", uniqueId()), e));
      await batch.commit();
    },
    // Status eines Antrags ändern (z. B. "frei" = freigegeben)
    setBookingStatus: (id, status) => updateDoc(doc(db, "bookings", id), { status }),
    // Alle Einträge einer Serie freigeben
    approveSeries: async (seriesId, allBookings) => {
      const batch = writeBatch(db);
      allBookings.filter((b) => b.seriesId === seriesId).forEach((b) => batch.update(doc(db, "bookings", b.id), { status: "frei" }));
      await batch.commit();
    },
    // Einen Termin verschieben: neuen Datensatz mit eindeutiger ID anlegen, alten löschen
    moveBooking: async (oldId, newData) => {
      const { id, ...clean } = newData;
      await setDoc(doc(db, "bookings", uniqueId()), clean);
      await deleteDoc(doc(db, "bookings", oldId));
    },
    removeBooking: (id) => deleteDoc(doc(db, "bookings", id)),
    // Ganze Serie anhand der seriesId entfernen
    removeSeries: async (seriesId, allBookings) => {
      const batch = writeBatch(db);
      allBookings.filter((b) => b.seriesId === seriesId).forEach((b) => batch.delete(doc(db, "bookings", b.id)));
      await batch.commit();
    },
  };
}

export function useWishes() {
  const { items, ready } = useCollection("wishes");
  return {
    wishes: items,
    wishesReady: ready,
    addWish: (w) => addDoc(collection(db, "wishes"), { ...w, status: "offen" }),
    // Status setzen, optional mit Grund (z. B. beim Ablehnen)
    setWishStatus: (id, status, reason = "") => updateDoc(doc(db, "wishes", id), { status, reason }),
  };
}

export function useTrainingDays() {
  const { items, ready } = useCollection("trainingDays");
  const map = {};
  items.forEach((it) => { map[it.id] = it; });
  return {
    trainDays: map,
    trainDaysReady: ready,
    saveTrainDay: (teamId, data) => setDoc(doc(db, "trainingDays", teamId), data),
    // Status/Grund setzen, ohne die Meldung zu löschen (z. B. ablehnen)
    setTrainDayStatus: (teamId, status, reason = "") =>
      updateDoc(doc(db, "trainingDays", teamId), { status, reason }),
    removeTrainDay: (teamId) => deleteDoc(doc(db, "trainingDays", teamId)),
  };
}

export function useLocks() {
  const { items, ready } = useCollection("locks");
  return {
    locks: items,
    locksReady: ready,
    addLock: (l) => addDoc(collection(db, "locks"), l),
    removeLock: (id) => deleteDoc(doc(db, "locks", id)),
  };
}

// Nutzerprofile (Rolle + zugeordnete Teams).
//   users   docId = uid; { role: "trainer"|"platzwart", teams: [teamId,...], name, email }
// Wird vom Platzwart in der Nutzerverwaltung gepflegt. Der Login liest das
// eigene Profil separat (siehe lib/auth.js).
export function useUsers() {
  const { items, ready } = useCollection("users");
  return {
    users: items,
    usersReady: ready,
    // Profil anlegen/überschreiben (docId = uid des Kontos aus der Firebase-Console)
    saveUser: (uid, data) => setDoc(doc(db, "users", uid), data, { merge: true }),
    setUserRole: (uid, role) => updateDoc(doc(db, "users", uid), { role }),
    setUserTeams: (uid, teams) => updateDoc(doc(db, "users", uid), { teams }),
    removeUser: (uid) => deleteDoc(doc(db, "users", uid)),
  };
}

// Nachrichten von Trainern an den Admin
//   messages   { team, text, ts, done }
export function useMessages() {
  const { items, ready } = useCollection("messages");
  return {
    messages: items,
    messagesReady: ready,
    addMessage: (m) => addDoc(collection(db, "messages"), { ...m, done: false, ts: Date.now() }),
    setMessageDone: (id, done) => updateDoc(doc(db, "messages", id), { done }),
    removeMessage: (id) => deleteDoc(doc(db, "messages", id)),
  };
}

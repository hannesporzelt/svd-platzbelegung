// Datenzugriff auf Firestore – Echtzeit, geräteübergreifend synchron.

import { useEffect, useState } from "react";
import {
  collection, doc, addDoc, deleteDoc, updateDoc, setDoc, onSnapshot, writeBatch,
  query, where, getDocs,
} from "firebase/firestore";
import { db, auth } from "./firebase";

const uid = () => auth.currentUser?.uid || null;

function useCollection(name, enabled = true) {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled) { setItems([]); setReady(true); return; }
    const unsub = onSnapshot(collection(db, name), (snap) => {
      setItems(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
      setReady(true);
    });
    return unsub;
  }, [name, enabled]);
  return { items, ready };
}

export function useBookings() {
  const { items, ready } = useCollection("bookings");
  const contentId = (b) =>
    [b.date, b.field, b.zone, b.team, b.start, b.end, b.kind || "training"]
      .join("_")
      .replace(/[^A-Za-z0-9_:-]/g, "");
  const uniqueId = () => `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const idFor = (b) => (b.status === "beantragt" || b.seriesId ? uniqueId() : contentId(b));
  return {
    bookings: items,
    bookingsReady: ready,
    addBooking: (b) => {
      const withOwner = { ...b, ownerUid: b.ownerUid || uid() };
      return setDoc(doc(db, "bookings", idFor(withOwner)), withOwner);
    },
    // Importiert BFV-Spiele: Doc-ID = bfv-<UID>, daher überschreibt ein erneuter
    // Import dasselbe Spiel (Update bei Verschiebung), statt Dubletten zu erzeugen.
    // existing = aktuelle bookings; bei platzManuell bleibt der gesetzte Platz/Zone erhalten.
    importBookings: async (games, existing) => {
      const batch = writeBatch(db);
      const owner = uid();
      const byId = {};
      (existing || []).forEach((b) => { if (b.id) byId[b.id] = b; });
      let count = 0;
      games.forEach((g) => {
        if (!g.bfvUid) return;
        const id = "bfv-" + String(g.bfvUid).replace(/[^A-Za-z0-9_:-]/g, "");
        const prev = byId[id];
        let entry = { ...g, ownerUid: owner, source: "bfv" };
        // Platz-Schutz: wurde der Platz manuell gesetzt, BFV-Platz/Zone NICHT überschreiben
        if (prev && prev.platzManuell) {
          entry = { ...entry, field: prev.field, zone: prev.zone, platzManuell: true };
        }
        batch.set(doc(db, "bookings", id), entry);
        count++;
      });
      await batch.commit();
      return count;
    },
    addBookingSeries: async (entries) => {
      const batch = writeBatch(db);
      const owner = uid();
      entries.forEach((e) => batch.set(doc(db, "bookings", uniqueId()), { ...e, ownerUid: e.ownerUid || owner }));
      await batch.commit();
    },
    setBookingStatus: (id, status) => updateDoc(doc(db, "bookings", id), { status }),
    approveSeries: async (seriesId, allBookings) => {
      const batch = writeBatch(db);
      allBookings.filter((b) => b.seriesId === seriesId).forEach((b) => batch.update(doc(db, "bookings", b.id), { status: "frei" }));
      await batch.commit();
    },
    moveBooking: async (oldId, newData) => {
      const { id, ...clean } = newData;
      // BFV-importierte Spiele behalten ihre feste Doc-ID (bfv-<UID>), damit der
      // Import sie weiter erkennt. Verschiebung markiert den Platz als manuell.
      if (typeof oldId === "string" && oldId.startsWith("bfv-")) {
        await setDoc(doc(db, "bookings", oldId), {
          ...clean, ownerUid: clean.ownerUid || uid(), source: "bfv", platzManuell: true,
        });
        return;
      }
      await setDoc(doc(db, "bookings", uniqueId()), { ...clean, ownerUid: clean.ownerUid || uid() });
      await deleteDoc(doc(db, "bookings", oldId));
    },
    removeBooking: async (id, allBookings) => {
      let grp = null;
      if (Array.isArray(allBookings)) {
        grp = allBookings.find((b) => b.id === id)?.matchGroup || null;
      }
      if (!grp) {
        try {
          const cur = await getDocs(query(collection(db, "bookings"), where("__name__", "==", id)));
          grp = cur.docs[0]?.data()?.matchGroup || null;
        } catch { /* ignore */ }
      }
      await deleteDoc(doc(db, "bookings", id));
      if (grp) {
        try {
          const snap = await getDocs(query(collection(db, "bookings"), where("matchGroup", "==", grp)));
          await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, "bookings", d.id))));
        } catch { /* ignore */ }
      }
    },
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

// Tagesnotizen (z. B. "Platz 2 zu nass"). docId = Datum (YYYY-MM-DD).
//   notes   { text, ts }   – sichtbar für alle, geschrieben vom Platzwart.
export function useNotes() {
  const { items, ready } = useCollection("notes");
  const map = {};
  items.forEach((it) => { map[it.id] = it; });
  return {
    notes: map,
    notesReady: ready,
    // Notiz setzen oder (bei leerem Text) löschen
    setNote: (dateKey, text) => {
      const t = (text || "").trim();
      if (!t) return deleteDoc(doc(db, "notes", dateKey));
      return setDoc(doc(db, "notes", dateKey), { text: t, ts: Date.now() });
    },
    removeNote: (dateKey) => deleteDoc(doc(db, "notes", dateKey)),
  };
}

export function useUsers(enabled = true) {
  const { items, ready } = useCollection("users", enabled);
  return {
    users: items,
    usersReady: ready,
    saveUser: (uid, data) => setDoc(doc(db, "users", uid), data, { merge: true }),
    setUserRole: (uid, role) => updateDoc(doc(db, "users", uid), { role }),
    setUserTeams: (uid, teams) => updateDoc(doc(db, "users", uid), { teams }),
    // Rechte-Objekt eines Platzwarts setzen (nur Admin nutzt das in der UI).
    // rights z. B. { irrigation:true, locks:false, messages:true, notes:true }
    setUserRights: (uid, rights) => updateDoc(doc(db, "users", uid), { rights }),
    removeUser: (uid) => deleteDoc(doc(db, "users", uid)),
  };
}

// Beregnungsplan: ein Dokument pro Platz unter irrigation/{fieldId}.
// Inhalt z. B. { days:["Mo","Do"], runMin:15, gapSec:5, passes:2,
//   start1:"00:45", start2:"03:55", stations:12, updatedTs }.
export function useIrrigation() {
  const { items, ready } = useCollection("irrigation");
  const map = {};
  items.forEach((it) => { map[it.id] = it; });
  return {
    irrigation: map,
    irrigationReady: ready,
    saveIrrigation: (fieldId, data) =>
      setDoc(doc(db, "irrigation", fieldId), { ...data, updatedTs: Date.now() }, { merge: true }),
    removeIrrigation: (fieldId) => deleteDoc(doc(db, "irrigation", fieldId)),
  };
}

export function useMessages() {
  const { items, ready } = useCollection("messages");
  return {
    messages: items,
    messagesReady: ready,
    addMessage: (m) => addDoc(collection(db, "messages"), { ...m, senderUid: uid(), done: false, ts: Date.now() }),
    setMessageDone: (id, done) => updateDoc(doc(db, "messages", id), { done }),
    removeMessage: (id) => deleteDoc(doc(db, "messages", id)),
  };
}

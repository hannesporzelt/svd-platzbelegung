// Datenzugriff auf Firestore – Echtzeit, geräteübergreifend synchron.
//
// Collections:
//   bookings      manuelle Belegungen + Heimspiele  { date, field, zone, team, start, end, kind }
//   wishes        Trainerwünsche                    { team, date, field, zone, start, end, note, status }
//   trainingDays  gemeldete Trainingstage           docId = teamId; { days:[], start, end, field }
//   locks         Platzsperren                      { field, from, to, reason }

import { useEffect, useState } from "react";
import {
  collection, doc, addDoc, deleteDoc, updateDoc, setDoc, onSnapshot,
} from "firebase/firestore";
import { db } from "./firebase";

function useCollection(name) {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, name), (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setReady(true);
    });
    return unsub;
  }, [name]);
  return { items, ready };
}

export function useBookings() {
  const { items, ready } = useCollection("bookings");
  return {
    bookings: items,
    bookingsReady: ready,
    addBooking: (b) => addDoc(collection(db, "bookings"), b),
    removeBooking: (id) => deleteDoc(doc(db, "bookings", id)),
  };
}

export function useWishes() {
  const { items, ready } = useCollection("wishes");
  return {
    wishes: items,
    wishesReady: ready,
    addWish: (w) => addDoc(collection(db, "wishes"), { ...w, status: "offen" }),
    setWishStatus: (id, status) => updateDoc(doc(db, "wishes", id), { status }),
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

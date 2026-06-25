import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  TEAMS, FIELDS, teamById, fieldById, WEEKDAYS, WEEKDAYS_LONG,
  dayKey, mondayOf, addDays, isoWeek, fmtRange, expandRecurrence, zoneCovers,
  autoTrainingForDay, findConflicts, conflictIdsForEntries, effectiveSpan, warmupBlockFor,
  zonesOverlap, timeOverlap,
} from "./lib/domain";
import { useAuth } from "./lib/auth";
import { useBookings, useLocks, useMessages, useUsers, useNotes } from "./lib/data";
import { C, S } from "./lib/styles";
import Pitch from "./components/Pitch";

// Hinweistext für Trainer, wenn der gewünschte Slot belegt ist
const CONFLICT_HINT = "Dieser Platz ist zur gewählten Zeit bereits belegt.\n\nBitte eine andere Uhrzeit oder einen anderen Trainingstag wählen – oder den Platzwart kontaktieren.\n\nDu kannst den Wunsch trotzdem absenden; der Platzwart entscheidet darüber.";

const MONTHS_PDF = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

// jsPDF bei Bedarf vom CDN laden (kein Build-Paket nötig)
function loadJsPDF() {
  return new Promise((resolve, reject) => {
    if (window.jspdf && window.jspdf.jsPDF) return resolve(window.jspdf.jsPDF);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = () => reject(new Error("PDF-Bibliothek konnte nicht geladen werden. Besteht eine Internetverbindung?"));
    document.head.appendChild(s);
  });
}

// Monatsplan als PDF erzeugen (DIN A4 quer), als Kalenderraster gezeichnet.
async function exportMonthPDF(monthAnchor, entriesForDay) {
  let jsPDF;
  try {
    jsPDF = await loadJsPDF();
  } catch (e) {
    window.alert(e.message || "PDF konnte nicht erstellt werden.");
    return;
  }
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  const first = new Date(year, month, 1);
  const gridStart = mondayOf(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const usedRows = cells.some((d, i) => i >= 35 && d.getMonth() === month) ? 6 : 5;
  const shown = cells.slice(0, usedRows * 7);

  const fieldShort = { p1: "P1", p2: "P2", p3: "P3" };
  const zoneShort = { p2_voll: "ganz", h_ob: "Ob", h_ha: "Ha", v1: "V1", v2: "V2", v3: "V3", v4: "V4", h1: "H1", h2: "H2", voll: "" };

  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297, H = 210, M = 8;
  const gridW = W - 2 * M;
  const colW = gridW / 7;
  const headerY = M + 8;
  const gridTop = headerY + 6;
  const gridH = H - gridTop - M;
  const rowH = gridH / usedRows;

  // Titel
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(15);
  pdf.setTextColor(15, 110, 62);
  pdf.text(`SV Dörfleins – Platzbelegung · ${MONTHS_PDF[month]} ${year}`, M, M + 4);

  // Wochentagsköpfe
  pdf.setFontSize(9); pdf.setTextColor(95, 94, 90);
  WEEKDAYS.forEach((w, i) => { pdf.text(w, M + i * colW + 1.5, headerY + 3); });

  const todayKeyStr = dayKey(new Date());
  pdf.setDrawColor(200);

  shown.forEach((d, idx) => {
    const r = Math.floor(idx / 7), c = idx % 7;
    const x = M + c * colW, y = gridTop + r * rowH;
    const inMonth = d.getMonth() === month;
    const isToday = dayKey(d) === todayKeyStr;
    if (!inMonth) { pdf.setFillColor(245, 244, 239); pdf.rect(x, y, colW, rowH, "F"); }
    else if (isToday) { pdf.setFillColor(238, 247, 240); pdf.rect(x, y, colW, rowH, "F"); }
    pdf.rect(x, y, colW, rowH, "S");
    // Datum
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(9);
    pdf.setTextColor(inMonth ? 28 : 150, inMonth ? 28 : 150, inMonth ? 26 : 150);
    pdf.text(String(d.getDate()), x + 1.5, y + 4);
    // Einträge
    const entries = entriesForDay(d).slice().sort((a, b) => a.start.localeCompare(b.start));
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(6.5);
    let ey = y + 8;
    const maxLines = Math.floor((rowH - 8) / 2.7);
    entries.slice(0, maxLines).forEach((e) => {
      const t = teamById(e.team);
      if (t) { const col = hexToRgb(t.color); pdf.setFillColor(col.r, col.g, col.b); pdf.circle(x + 2, ey - 1, 0.7, "F"); }
      pdf.setTextColor(40, 40, 40);
      const z = zoneShort[e.zone] ? "·" + zoneShort[e.zone] : "";
      let label = `${e.start} ${t ? t.name : e.team} ${fieldShort[e.field] || ""}${z}`;
      label = pdf.splitTextToSize(label, colW - 4)[0];
      pdf.text(label, x + 3.5, ey);
      ey += 2.7;
    });
    if (entries.length > maxLines) {
      pdf.setTextColor(120); pdf.text(`+${entries.length - maxLines} weitere`, x + 3.5, ey);
    }
  });

  pdf.save(`Platzbelegung-${year}-${String(month + 1).padStart(2, "0")}.pdf`);
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "#666666");
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 102, g: 102, b: 102 };
}

export default function App() {
  const { user, authReady, isLoggedIn, role, isPlatzwart, isTrainer, myTeams, profile, loginEmail, resetPassword, registerEmail, logout, loginAdminPin, pinAdmin } = useAuth();
  const isAdmin = isPlatzwart; // Kompatibilität: bestehender Code nutzt isAdmin = Platzwart-Rechte
  const [showLogin, setShowLogin] = useState(false);
  const { bookings, bookingsReady, addBooking, addBookingSeries, setBookingStatus, approveSeries, moveBooking, removeBooking, removeSeries } = useBookings();
  const { locks, locksReady, addLock, removeLock } = useLocks();
  const { notes, notesReady, setNote } = useNotes();
  const { messages, messagesReady, addMessage, setMessageDone, removeMessage } = useMessages();
  const { users, saveUser, setUserRole, setUserTeams, removeUser } = useUsers(isPlatzwart);

  const [view, setView] = useState("viewer"); // viewer | trainer | admin
  const [msgsSeen, setMsgsSeen] = useState(false); // Login-Hinweis nur bis zum Ansehen zeigen
  const [trainerTeam, setTrainerTeam] = useState("u15");

  // Wenn ein Trainer eingeloggt ist: erstes zugeordnetes Team vorauswählen
  React.useEffect(() => {
    if (isTrainer && myTeams.length > 0 && !myTeams.includes(trainerTeam)) {
      setTrainerTeam(myTeams[0]);
    }
  }, [isTrainer, myTeams]); // eslint-disable-line react-hooks/exhaustive-deps
  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const [activeField, setActiveField] = useState("p2");
  const [calMode, setCalMode] = useState("woche"); // woche | monat
  const [monthAnchor, setMonthAnchor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [moveTarget, setMoveTarget] = useState(null); // Belegung, die im Plan verschoben wird

  // Belegung im Plan verschieben (behält Status bei, ohne automatische Trainer-Nachricht)
  const doMovePlan = (b, neu) => {
    const { id, ...rest } = b;
    moveBooking(b.id, { ...rest, ...neu });
    setMoveTarget(null);
  };

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

  // Admin-Hinweise: offene Anträge (beantragte Trainingstage, ab heute) + Konflikte + Nachrichten
  const todayKeyTop = dayKey(new Date());
  const pendingCount = bookings.filter((b) => b.status === "beantragt" && b.date >= todayKeyTop).length;
  const openMsgCount = messages.filter((m) => !m.done).length;
  // Neue Nachrichten vom Platzwart an den eingeloggten Trainer (für Login-Hinweis)
  const trainerInbox = (isTrainer && user?.uid)
    ? messages.filter((m) =>
        m.dir === "out" && !m.done &&
        (m.toAll || (m.recipientUid && m.recipientUid === user.uid) || (m.team && myTeams.includes(m.team))))
    : [];
  const trainerUnread = trainerInbox.length;
  const weekConflictCount = useMemo(() => {
    let n = 0;
    days.forEach((d) => {
      const ids = conflictIdsForEntries(entriesForDay(d));
      n += ids.size;
    });
    return n;
  }, [days, entriesForDay]);

  // Platzwart-Bereich öffnen: eingeloggter Platzwart kommt direkt rein,
  // sonst Login-Maske anzeigen (echtes Konto oder Notfall-Passwort).
  const requestAdmin = () => {
    if (isPlatzwart) { setView("admin"); return; }
    setShowLogin(true);
  };

  // Trainer-Bereich öffnen: eingeloggter Trainer/Platzwart direkt,
  // sonst Login-Maske.
  const requestTrainer = () => {
    if (isTrainer || isPlatzwart) { setView("trainer"); return; }
    setShowLogin(true);
  };

  const ready = bookingsReady && locksReady && messagesReady && notesReady && authReady;
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
      {moveTarget && <MoveDialogOverlay entry={moveTarget} onCancel={() => setMoveTarget(null)} onSave={doMovePlan} />}
      {showLogin && (
        <LoginOverlay
          onClose={() => setShowLogin(false)}
          loginEmail={loginEmail}
          resetPassword={resetPassword}
          registerEmail={registerEmail}
          loginAdminPin={loginAdminPin}
        />
      )}
      <Header
        view={view}
        setView={(v) => (v === "admin" ? requestAdmin() : v === "trainer" ? requestTrainer() : setView(v))}
        isAdmin={isAdmin}
        isLoggedIn={isLoggedIn}
        role={role}
        myTeams={myTeams}
        profile={profile}
        onLoginClick={() => setShowLogin(true)}
        logoutAdmin={async () => { await logout(); setView("viewer"); }}
        trainerTeam={trainerTeam}
        setTrainerTeam={setTrainerTeam}
        notices={pendingCount + weekConflictCount + openMsgCount}
        requestCount={pendingCount}
        calMode={calMode}
        setCalMode={setCalMode}
        onPrint={() => window.print()}
        onPdf={() => exportMonthPDF(monthAnchor, entriesForDay)}
      />

      {pendingCount > 0 && (
        <div style={{ ...S.warnBanner, background: "#eef4ff", color: "#234", border: "1px solid #b9cdf0" }}>
          📬 {pendingCount} Trainingstag-Antrag{pendingCount === 1 ? "" : "-anträge"} zur Freigabe{isAdmin ? " – im Platzwart-Bereich unter „Trainingstage“ prüfen." : ". Der Platzwart gibt sie frei."}
        </div>
      )}

      {trainerUnread > 0 && !msgsSeen && (
        <div style={{ ...S.warnBanner, background: "#fff8e1", color: "#7a5d00", border: "1px solid #f0e0a8", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>📬 Du hast {trainerUnread} neue Nachricht{trainerUnread === 1 ? "" : "en"} vom Platzwart.</span>
          <button style={{ ...S.navBtn, whiteSpace: "nowrap" }} onClick={() => { setView("trainer"); setMsgsSeen(true); }}>Nachrichten ansehen</button>
        </div>
      )}

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
            onMove={setMoveTarget}
            notes={notes}
            setNote={setNote}
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
          notes={notes}
          setNote={setNote}
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
          onMove={setMoveTarget}
          users={users}
          saveUser={saveUser}
          setUserRole={setUserRole}
          setUserTeams={setUserTeams}
          removeUser={removeUser}
        />
      )}

      {view === "trainer" && (isTrainer || isPlatzwart) && (
        <TrainerPanel
          trainerTeam={trainerTeam}
          bookings={bookings}
          bookingsByDay={bookingsByDay}
          addBooking={addBooking}
          addBookingSeries={addBookingSeries}
          entriesForDay={entriesForDay}
          addMessage={addMessage}
          messages={messages}
          myUid={user?.uid}
          myTeams={myTeams}
        />
      )}

      {view === "trainer" && !isTrainer && !isPlatzwart && (
        <div style={{ ...S.card, marginTop: "1rem", color: C.textSec, fontSize: 14 }}>
          Zum Eintragen von Trainingszeiten bitte oben rechts <b>anmelden</b>. Den Zugang bekommst du vom Platzwart.
        </div>
      )}

      {view === "viewer" && (
        <div style={{ ...S.card, marginTop: "1rem", color: C.textSec, fontSize: 14 }}>
          Lesemodus. Angemeldete Trainer können Trainingstage beantragen (einzeln oder wiederkehrend); die Anträge erscheinen im Kalender, sobald der Platzwart sie freigibt. Der Platzwart pflegt Belegungen, Heimspiele und Sperren.
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
function Header({ view, setView, isAdmin, isLoggedIn, role, myTeams, profile, onLoginClick, logoutAdmin, trainerTeam, setTrainerTeam, notices, requestCount, calMode, setCalMode, onPrint, onPdf }) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Welche Teams darf der Trainer im Dropdown wählen?
  const teamOptions = (role === "trainer" && myTeams.length > 0)
    ? TEAMS.filter((t) => myTeams.includes(t.id))
    : TEAMS;
  // Rollenanzeige rechts oben
  const roleLabel = view === "admin" ? "Platzwart" : view === "trainer" ? "Trainer" : "Betrachter";

  const ROLES = [["viewer", "Betrachter"], ["trainer", "Trainer"], ["admin", "Platzwart"]];
  const close = () => setMenuOpen(false);

  return (
    <header style={S.header}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Hauptmenü-Knopf */}
        <div style={{ position: "relative" }} className="no-print">
          <button onClick={() => setMenuOpen((o) => !o)} aria-label="Menü"
            style={{ ...S.navBtn, fontSize: 18, lineHeight: 1, padding: "8px 12px", position: "relative" }}>
            ☰{requestCount > 0 && <span style={{ ...S.badge, position: "absolute", top: -6, right: -6 }}>{requestCount}</span>}
          </button>
          {menuOpen && (
            <>
              <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
              <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, minWidth: 230, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,0.16)", padding: 8 }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", color: C.textTer, padding: "6px 8px 2px" }}>Ansicht</div>
                {[["woche", "Woche"], ["monat", "Monat"]].map(([k, l]) => (
                  <button key={k} onClick={() => { setCalMode(k); close(); }}
                    style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: calMode === k ? C.brand : "transparent", color: calMode === k ? "#fff" : C.ink, cursor: "pointer", fontSize: 14, borderRadius: 7, padding: "8px 10px" }}>
                    {l}
                  </button>
                ))}

                {calMode === "monat" && (
                  <>
                    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", color: C.textTer, padding: "8px 8px 2px" }}>Monatsplan</div>
                    <button onClick={() => { close(); onPrint && onPrint(); }} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent", color: C.ink, cursor: "pointer", fontSize: 14, borderRadius: 7, padding: "8px 10px" }}>🖨 Drucken</button>
                    <button onClick={() => { close(); onPdf && onPdf(); }} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent", color: C.ink, cursor: "pointer", fontSize: 14, borderRadius: 7, padding: "8px 10px" }}>⬇ Als PDF speichern</button>
                  </>
                )}

                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", color: C.textTer, padding: "8px 8px 2px" }}>Rolle</div>
                {ROLES.map(([k, l]) => (
                  <button key={k} onClick={() => { setView(k); close(); }}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", textAlign: "left", border: "none", background: view === k ? C.brand : "transparent", color: view === k ? "#fff" : C.ink, cursor: "pointer", fontSize: 14, borderRadius: 7, padding: "8px 10px" }}>
                    <span>{l}</span>
                    {k === "admin" && requestCount > 0 && <span style={{ ...S.badge, ...(view === k ? { background: "#fff", color: C.brand } : {}) }}>{requestCount}</span>}
                  </button>
                ))}

                {view === "trainer" && (
                  <>
                    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", color: C.textTer, padding: "8px 8px 2px" }}>Mannschaft</div>
                    <div style={{ padding: "2px 6px 6px" }}>
                      <select value={trainerTeam} onChange={(e) => setTrainerTeam(e.target.value)} style={S.select}>
                        {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <div style={S.crest}>SVD</div>
        <div>
          <h1 style={S.h1}>SV Dörfleins</h1>
          <p style={S.sub}>Platzbelegung &amp; Trainingsplan</p>
        </div>
      </div>

      {/* Rechts: aktuelle Rolle + Anmelden/Abmelden (immer sichtbar) */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} className="no-print">
        <span style={{ fontSize: 12, color: C.textSec }}>{roleLabel}</span>
        {isLoggedIn ? (
          <button style={S.navBtn} onClick={logoutAdmin} title={profile?.name || profile?.email || ""}>Abmelden</button>
        ) : (
          <button style={S.navBtn} onClick={onLoginClick}>Anmelden</button>
        )}
      </div>
    </header>
  );
}

/* ---------------- Login-Maske (E-Mail/Passwort) ---------------- */
function LoginOverlay({ onClose, loginEmail, resetPassword, registerEmail, loginAdminPin }) {
  const [mode, setMode] = useState("login"); // login | register
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  const doLogin = async () => {
    setErr(""); setInfo(""); setBusy(true);
    try {
      await loginEmail(email, pw);
      onClose();
    } catch (e) {
      if (!email.trim() && loginAdminPin(pw)) { onClose(); return; }
      setErr("Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.");
    } finally {
      setBusy(false);
    }
  };

  const doRegister = async () => {
    setErr(""); setInfo("");
    if (!email.trim()) { setErr("Bitte eine E-Mail-Adresse eintragen."); return; }
    if (pw.length < 6) { setErr("Das Passwort muss mindestens 6 Zeichen haben."); return; }
    if (pw !== pw2) { setErr("Die beiden Passwörter stimmen nicht überein."); return; }
    setBusy(true);
    try {
      await registerEmail(email, pw, name);
      setInfo("Konto erstellt! Der Platzwart schaltet dich in Kürze als Trainer frei und weist dir deine Mannschaft zu.");
      setTimeout(onClose, 2500);
    } catch (e) {
      const code = e?.code || "";
      if (code === "auth/email-already-in-use") setErr("Für diese E-Mail gibt es bereits ein Konto. Bitte anmelden.");
      else if (code === "auth/invalid-email") setErr("Diese E-Mail-Adresse ist ungültig.");
      else if (code === "auth/weak-password") setErr("Das Passwort ist zu schwach (mindestens 6 Zeichen).");
      else setErr("Registrierung fehlgeschlagen. Bitte später erneut versuchen.");
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    setErr(""); setInfo("");
    if (!email.trim()) { setErr("Bitte zuerst die E-Mail-Adresse eintragen."); return; }
    try {
      await resetPassword(email);
      setInfo("E-Mail zum Zurücksetzen des Passworts wurde versendet.");
    } catch {
      setErr("Konnte die E-Mail nicht versenden. Adresse korrekt?");
    }
  };

  const isReg = mode === "register";
  return (
    <div style={ovl.backdrop} onClick={onClose}>
      <div style={ovl.box} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 4px" }}>{isReg ? "Neues Trainer-Konto" : "Anmelden"}</h3>
        <p style={{ fontSize: 13, color: C.textSec, marginTop: 0 }}>
          {isReg
            ? "Lege dein Trainer-Konto an. Nach der Registrierung schaltet dich der Platzwart frei und weist dir deine Mannschaft zu."
            : "Für Trainer und Platzwart. Betrachter brauchen keine Anmeldung."}
        </p>
        {isReg && (
          <>
            <label style={ovl.label}>Name (optional)</label>
            <input style={S.select} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Vor- und Nachname" />
          </>
        )}
        <label style={ovl.label}>E-Mail</label>
        <input style={S.select} type="email" autoComplete="username" value={email}
          onChange={(e) => setEmail(e.target.value)} placeholder="name@example.de" />
        <label style={ovl.label}>Passwort</label>
        <input style={S.select} type="password" autoComplete={isReg ? "new-password" : "current-password"} value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !isReg) doLogin(); }} />
        {isReg && (
          <>
            <label style={ovl.label}>Passwort wiederholen</label>
            <input style={S.select} type="password" autoComplete="new-password" value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doRegister(); }} />
          </>
        )}
        {err && <p style={{ color: "#b91c1c", fontSize: 13 }}>{err}</p>}
        {info && <p style={{ color: "#15803d", fontSize: 13 }}>{info}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {isReg ? (
            <button style={{ ...S.primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={doRegister}>
              {busy ? "Konto wird erstellt…" : "Konto erstellen"}
            </button>
          ) : (
            <button style={{ ...S.primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={doLogin}>
              {busy ? "Anmelden…" : "Anmelden"}
            </button>
          )}
          <button style={S.navBtn} onClick={onClose}>Abbrechen</button>
        </div>
        {!isReg && <button style={ovl.linkBtn} onClick={doReset}>Passwort vergessen?</button>}
        <div style={{ marginTop: 10, fontSize: 13 }}>
          {isReg ? (
            <button style={ovl.linkBtn} onClick={() => { setMode("login"); setErr(""); setInfo(""); }}>
              Schon ein Konto? Hier anmelden
            </button>
          ) : (
            <button style={ovl.linkBtn} onClick={() => { setMode("register"); setErr(""); setInfo(""); }}>
              Noch kein Konto? Als Trainer registrieren
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const ovl = {
  backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 },
  box: { background: "#fff", borderRadius: 12, padding: 20, width: "100%", maxWidth: 360, boxShadow: "0 10px 40px rgba(0,0,0,0.25)" },
  label: { display: "block", fontSize: 12, color: C.textSec, marginTop: 10, marginBottom: 4 },
  linkBtn: { background: "none", border: "none", color: C.textSec, textDecoration: "underline", cursor: "pointer", fontSize: 13, marginTop: 12, padding: 0 },
};

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
function WeekGrid({ days, entriesForDay, lockForDayField, activeField, setActiveField, isAdmin, removeBooking, onMove, notes, setNote }) {
  return (
    <div style={S.card} className="print-area">
      <div style={S.gridHead}>
        <span>Wochenübersicht</span>
        <div style={S.fieldTabs} className="no-print">
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
          const dk = dayKey(d);
          const note = notes && notes[dk];
          return (
            <div key={dk} style={{ ...S.dayCol, ...(today ? S.dayToday : {}) }}>
              <div style={S.dayHead}>
                <span style={{ fontWeight: 500 }}>{WEEKDAYS[(d.getDay() + 6) % 7]}</span>
                <span style={{ color: C.textSec, fontSize: 12 }}>{d.getDate()}.{d.getMonth() + 1}.</span>
              </div>
              {lock && <div style={S.lockChip} title={lock.reason}>⛔ Gesperrt{lock.reason ? `: ${lock.reason}` : ""}</div>}
              {note && note.text && <NoteChip text={note.text} />}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {entries.length === 0 && !lock && <span style={{ color: C.textTer, fontSize: 12, padding: "4px 0" }}>frei</span>}
                {entries.slice().sort((a, b) => a.start.localeCompare(b.start)).map((e) => (
                  <Chip key={e.id} entry={e} conflict={conflictIds.has(e.id)} isAdmin={isAdmin} removeBooking={removeBooking} onMove={onMove} />
                ))}
              </div>
              {isAdmin && setNote && (
                <div className="no-print" style={{ display: "flex", gap: 4, marginTop: 6 }}>
                  <button
                    onClick={() => {
                      const eingabe = window.prompt(`Notiz für ${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()}.${d.getMonth() + 1}.:`, note?.text || "");
                      if (eingabe !== null) setNote(dk, eingabe);
                    }}
                    style={{ flex: 1, border: `1px dashed ${C.border}`, background: "transparent", color: C.textSec, cursor: "pointer", fontSize: 11, borderRadius: 6, padding: "3px 0" }}>
                    {note?.text ? "✎ Notiz" : "+ Notiz"}
                  </button>
                  {note?.text && (
                    <button
                      title="Notiz löschen"
                      onClick={() => { if (window.confirm("Notiz wirklich löschen?")) setNote(dk, ""); }}
                      style={{ border: `1px solid #e7a5a5`, background: "#fbeaea", color: C.danger, cursor: "pointer", fontSize: 11, borderRadius: 6, padding: "3px 8px" }}>
                      ✕
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Legend />
    </div>
  );
}

// Tagesnotiz-Anzeige (gelb hinterlegt)
function NoteChip({ text }) {
  return (
    <div style={{ background: "#fff8e1", border: "1px solid #f0e0a8", color: "#7a5d00", fontSize: 11, borderRadius: 6, padding: "4px 6px", marginBottom: 6, lineHeight: 1.35 }}
      title={text}>
      📝 {text}
    </div>
  );
}

function Chip({ entry, conflict, isAdmin, removeBooking, onMove }) {
  const t = teamById(entry.team);
  const P2_SHORT = { p2_voll: "ganz", h_ob: "Oberhaid", h_ha: "Hallstadt", v1: "V1", v2: "V2", v3: "V3", v4: "V4" };
  const zoneLabel = entry.field === "p2" ? (P2_SHORT[entry.zone] || entry.zone)
    : entry.field === "p3" ? (entry.zone === "h1" ? "H1" : "H2") : "";
  const canEdit = isAdmin && !entry.auto;
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
        {entry.kind === "warmup"
          ? <>Aufwärmen {entry.start}–{entry.end}</>
          : entry.kind === "match"
          ? <>Anstoß {entry.start}{entry.opponent ? ` · vs. ${entry.opponent}` : ""}<br />
              <span style={{ fontSize: 10 }}>
                {entry.warmupField && entry.warmupField !== entry.field
                  ? <>Aufwärmen auf {fieldById(entry.warmupField)?.name} · Platz belegt {entry.start}–{effectiveSpan(entry).end}</>
                  : <>Platz belegt {effectiveSpan(entry).start}–{effectiveSpan(entry).end} (inkl. Auf-/Abwärmen)</>}
              </span></>
          : <>{entry.start}–{entry.end}{entry.kind === "turnier" && " · Turnier"}{entry.auto && " · fix"}</>}
      </div>
      {canEdit && (
        <div style={{ display: "flex", gap: 4, marginTop: 5 }}>
          {onMove && (
            <button onClick={() => onMove(entry)} title="Verschieben"
              style={{ flex: 1, border: `1px solid ${C.border}`, background: C.surface, color: C.ink, cursor: "pointer", fontSize: 11, fontWeight: 500, borderRadius: 6, padding: "3px 0" }}>
              ↔ verschieben
            </button>
          )}
          {removeBooking && (
            <button onClick={del} title="Diesen Tag löschen"
              style={{ flex: 1, border: `1px solid #e7a5a5`, background: "#fbeaea", color: C.danger, cursor: "pointer", fontSize: 11, fontWeight: 500, borderRadius: 6, padding: "3px 0" }}>
              ✕ löschen
            </button>
          )}
        </div>
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

function MonthView({ monthAnchor, setMonthAnchor, entriesForDay, lockForDayField, isAdmin, removeBooking, notes, setNote }) {
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
              {notes && notes[dayKey(d)]?.text && (
                <div style={{ fontSize: 9, color: "#7a5d00", background: "#fff8e1", borderRadius: 4, padding: "1px 3px", marginBottom: 2, lineHeight: 1.25, overflowWrap: "anywhere", wordBreak: "break-word" }} title={notes[dayKey(d)].text}>
                  📝 {notes[dayKey(d)].text}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {entries.slice(0, 5).map((e) => {
                  const t = teamById(e.team);
                  const deletable = isAdmin && removeBooking && !e.auto && e.id;
                  return (
                    <div key={e.id}
                      onClick={deletable ? () => delEntry(e) : undefined}
                      title={deletable ? "Löschen" : undefined}
                      style={{ display: "flex", alignItems: "flex-start", gap: 4, fontSize: 10, lineHeight: 1.25, cursor: deletable ? "pointer" : "default" }}>
                      <span style={{ width: 7, height: 7, borderRadius: 2, background: t ? t.color : C.textSec, flex: "none", marginTop: 3 }} />
                      <span style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
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
// Menügruppen für den Platzwart-Bereich. Jede Gruppe bündelt zusammengehörige Funktionen.
const ADMIN_MENU = [
  { group: "Eintragen", items: [
    ["belegung", "Belegung eintragen"],
    ["spiel", "Heimspiel"],
    ["turnier", "Turnier"],
    ["sperre", "Platzsperre"],
  ] },
  { group: "Verwalten", items: [
    ["verwalten", "Belegungen verwalten"],
    ["trainingstage", "Trainingstage freigeben"],
    ["konflikte", "Konflikte"],
    ["statistik", "Statistik"],
  ] },
  { group: "Kommunikation", items: [
    ["nachrichten", "Nachrichten"],
  ] },
  { group: "Konten", items: [
    ["nutzer", "Nutzer verwalten"],
  ] },
];
const ADMIN_LABELS = ADMIN_MENU.reduce((acc, g) => { g.items.forEach(([k, l]) => { acc[k] = l; }); return acc; }, {});

function AdminPanel({ days, bookings, bookingsByDay, addBooking, addBookingSeries, setBookingStatus, approveSeries, moveBooking, removeBooking, removeSeries, locks, addLock, removeLock, addMessage, messages, setMessageDone, removeMessage, onMove, users, saveUser, setUserRole, setUserTeams, removeUser }) {
  const [tab, setTab] = useState("belegung");
  const [menuOpen, setMenuOpen] = useState(false);
  const pending = bookings.filter((b) => b.status === "beantragt" && b.date >= dayKey(new Date())).length;
  const openMsg = messages.filter((m) => !m.done && m.dir !== "out").length;
  // Anzahl Tage mit Konflikten ab heute (für Badge im Menü)
  const conflictDayCount = (() => {
    const today = dayKey(new Date());
    const byDay = {};
    bookings.filter((b) => b.status !== "beantragt" && b.date >= today).forEach((b) => { (byDay[b.date] ||= []).push(b); });
    let n = 0;
    Object.values(byDay).forEach((list) => { if (conflictIdsForEntries(list).size > 0) n++; });
    return n;
  })();
  // Badge-Zahl je Menüpunkt
  const badgeFor = (k) => k === "trainingstage" ? pending : k === "nachrichten" ? openMsg : k === "konflikte" ? conflictDayCount : 0;

  const choose = (k) => { setTab(k); setMenuOpen(false); };

  return (
    <div style={{ ...S.card, marginTop: "1rem" }}>
      {/* Klappmenü-Kopf: zeigt aktuellen Bereich, öffnet die Gruppenliste */}
      <div style={{ position: "relative", marginBottom: 14 }}>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          style={{ ...S.navBtn, display: "flex", alignItems: "center", gap: 8, fontWeight: 500, width: "100%", justifyContent: "space-between" }}>
          <span>☰ {ADMIN_LABELS[tab] || "Menü"}</span>
          <span style={{ color: C.textSec, fontSize: 12 }}>{menuOpen ? "▲" : "▼"}</span>
        </button>
        {menuOpen && (
          <>
            {/* Klick außerhalb schließt das Menü */}
            <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,0.16)", padding: 8, maxHeight: 380, overflowY: "auto" }}>
              {ADMIN_MENU.map((grp) => (
                <div key={grp.group} style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", color: C.textTer, padding: "6px 8px 2px" }}>{grp.group}</div>
                  {grp.items.map(([k, l]) => {
                    const b = badgeFor(k);
                    const active = tab === k;
                    return (
                      <button key={k} onClick={() => choose(k)}
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", textAlign: "left", border: "none", background: active ? C.brand : "transparent", color: active ? "#fff" : C.ink, cursor: "pointer", fontSize: 14, borderRadius: 7, padding: "8px 10px" }}>
                        <span>{l}</span>
                        {b > 0 && <span style={{ ...S.badge, ...(active ? { background: "#fff", color: C.brand } : {}) }}>{b}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {tab === "belegung" && <BookingForm days={days} bookings={bookings} bookingsByDay={bookingsByDay} addBooking={addBooking} addBookingSeries={addBookingSeries} removeBooking={removeBooking} removeSeries={removeSeries} kind="training" />}
      {tab === "spiel" && <BookingForm days={days} bookings={bookings} bookingsByDay={bookingsByDay} addBooking={addBooking} addBookingSeries={addBookingSeries} removeBooking={removeBooking} removeSeries={removeSeries} kind="match" />}
      {tab === "turnier" && <BookingForm days={days} bookings={bookings} bookingsByDay={bookingsByDay} addBooking={addBooking} addBookingSeries={addBookingSeries} removeBooking={removeBooking} removeSeries={removeSeries} kind="turnier" />}
      {tab === "verwalten" && <BookingManager bookings={bookings} removeBooking={removeBooking} removeSeries={removeSeries} onMove={onMove} />}
      {tab === "konflikte" && <ConflictOverview bookings={bookings} removeBooking={removeBooking} onMove={onMove} />}
      {tab === "statistik" && <StatsPanel bookings={bookings} />}
      {tab === "sperre" && <LockForm locks={locks} addLock={addLock} removeLock={removeLock} />}
      {tab === "trainingstage" && <TrainDayApproval bookings={bookings} setBookingStatus={setBookingStatus} approveSeries={approveSeries} moveBooking={moveBooking} removeBooking={removeBooking} removeSeries={removeSeries} addMessage={addMessage} />}
      {tab === "nachrichten" && <MessageInbox messages={messages} setMessageDone={setMessageDone} removeMessage={removeMessage} users={users} addMessage={addMessage} />}
      {tab === "nutzer" && <UserManager users={users} saveUser={saveUser} setUserRole={setUserRole} setUserTeams={setUserTeams} removeUser={removeUser} />}
    </div>
  );
}

/* ---------------- Konfliktübersicht ---------------- */
// Listet alle echten Doppelbelegungen ab heute, nach Tag gruppiert.
function ConflictOverview({ bookings, removeBooking, onMove }) {
  const today = dayKey(new Date());
  const fmtDate = (dk) => {
    const d = new Date(dk + "T12:00");
    return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
  };
  // Belegungen ab heute nach Tag gruppieren (Anträge ausgenommen)
  const byDay = {};
  bookings
    .filter((b) => b.status !== "beantragt" && b.date >= today)
    .forEach((b) => { (byDay[b.date] ||= []).push(b); });

  // Pro Tag die konkreten Konfliktpaare bestimmen
  const days = Object.keys(byDay).sort();
  const conflictDays = [];
  days.forEach((dk) => {
    const list = byDay[dk];
    const pairs = [];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (zonesOverlap(list[i], list[j]) && timeOverlap(list[i], list[j]))
          pairs.push([list[i], list[j]]);
    if (pairs.length) conflictDays.push({ dk, pairs });
  });

  const total = conflictDays.reduce((n, d) => n + d.pairs.length, 0);

  const line = (b) => `${teamById(b.team)?.name || b.team} · ${fieldById(b.field)?.name} (${zoneText(b.field, b.zone)}) · ${b.start}–${b.end}${b.kind === "match" ? " · Heimspiel" : b.kind === "turnier" ? " · Turnier" : ""}`;

  return (
    <div>
      <p style={{ fontSize: 14, color: C.textSec, marginTop: 0 }}>
        Übersicht aller Doppelbelegungen ab heute – also Termine, die sich denselben Platzbereich zur selben Zeit teilen. Du kannst direkt verschieben oder löschen.
      </p>
      {total === 0 && (
        <div style={{ ...S.warnBanner, background: "#e1f5ee", color: C.ok, border: "1px solid #a9ddca" }}>
          ✓ Keine Konflikte gefunden. Alle Belegungen ab heute sind überschneidungsfrei.
        </div>
      )}
      {conflictDays.map(({ dk, pairs }) => (
        <div key={dk} style={{ marginBottom: 16 }}>
          <div style={S.subHead}>{fmtDate(dk)} · {pairs.length} Konflikt{pairs.length === 1 ? "" : "e"}</div>
          {pairs.map(([a, b], idx) => (
            <div key={idx} style={{ border: "1px solid #e7a5a5", background: "#fdf3f3", borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 13, marginBottom: 6 }}>⚠️ Überschneidung:</div>
              {[a, b].map((bk) => (
                <div key={bk.id} style={{ ...S.listRow, borderTop: "none", padding: "4px 0", flexWrap: "wrap" }}>
                  <span style={{ flex: "1 1 240px", borderLeft: `3px solid ${teamById(bk.team)?.color || C.textSec}`, paddingLeft: 8 }}>{line(bk)}</span>
                  <span style={{ display: "flex", gap: 6 }}>
                    {onMove && <button style={S.navBtn} onClick={() => onMove(bk)}>Verschieben</button>}
                    <button style={S.delBtn} onClick={() => { if (window.confirm(`Löschen?\n\n${line(bk)}`)) removeBooking(bk.id, bookings); }}>Löschen</button>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Statistik ---------------- */
// Wertet die vorhandenen Belegungen aus: Stunden je Platz und je Mannschaft,
// im wählbaren Zeitraum. Keine neue Datenbank nötig.
function StatsPanel({ bookings }) {
  const today = new Date();
  const iso = (d) => dayKey(d);
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(new Date(today.getFullYear(), today.getMonth() + 1, 0)));

  const toMin = (t) => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + m; };
  const list = bookings.filter((b) => b.status !== "beantragt" && b.date >= from && b.date <= to);

  const hoursOf = (b) => Math.max(0, (toMin(b.end) - toMin(b.start))) / 60;

  // je Platz
  const perField = {};
  FIELDS.forEach((f) => { perField[f.id] = 0; });
  // je Mannschaft
  const perTeam = {};
  let totalH = 0, totalCount = list.length;
  list.forEach((b) => {
    const h = hoursOf(b);
    totalH += h;
    if (perField[b.field] != null) perField[b.field] += h;
    perTeam[b.team] = (perTeam[b.team] || 0) + h;
  });

  const teamRows = Object.entries(perTeam)
    .map(([id, h]) => ({ id, name: teamById(id)?.name || id, color: teamById(id)?.color || C.textSec, h }))
    .sort((a, b) => b.h - a.h);
  const maxTeamH = teamRows.reduce((m, r) => Math.max(m, r.h), 0) || 1;
  const maxFieldH = Math.max(...Object.values(perField), 1);
  const fmtH = (h) => h.toFixed(1).replace(".", ",") + " h";

  const Bar = ({ value, max, color }) => (
    <div style={{ background: "#eee9df", borderRadius: 4, height: 10, flex: 1, overflow: "hidden" }}>
      <div style={{ width: `${Math.round((value / max) * 100)}%`, height: "100%", background: color, borderRadius: 4 }} />
    </div>
  );

  return (
    <div>
      <p style={{ fontSize: 14, color: C.textSec, marginTop: 0 }}>
        Auswertung der eingetragenen Belegungen im gewählten Zeitraum (Anträge zählen nicht mit).
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14, maxWidth: 420 }}>
        <Field label="Von"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={S.select} /></Field>
        <Field label="Bis"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={S.select} /></Field>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ ...S.card, flex: "1 1 150px", textAlign: "center" }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: C.brand }}>{totalCount}</div>
          <div style={{ fontSize: 12, color: C.textSec }}>Belegungen</div>
        </div>
        <div style={{ ...S.card, flex: "1 1 150px", textAlign: "center" }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: C.brand }}>{fmtH(totalH)}</div>
          <div style={{ fontSize: 12, color: C.textSec }}>Gesamtstunden</div>
        </div>
      </div>

      {totalCount === 0 && <p style={{ color: C.textSec, fontSize: 14 }}>Keine Belegungen im gewählten Zeitraum.</p>}

      {totalCount > 0 && (
        <>
          <div style={S.subHead}>Auslastung je Platz</div>
          <div style={{ marginBottom: 18 }}>
            {FIELDS.map((f) => (
              <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ width: 70, fontSize: 13 }}>{f.name}</span>
                <Bar value={perField[f.id]} max={maxFieldH} color={C.brand} />
                <span style={{ width: 60, fontSize: 12, color: C.textSec, textAlign: "right" }}>{fmtH(perField[f.id])}</span>
              </div>
            ))}
          </div>

          <div style={S.subHead}>Stunden je Mannschaft</div>
          <div>
            {teamRows.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ width: 110, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                <Bar value={r.h} max={maxTeamH} color={r.color} />
                <span style={{ width: 60, fontSize: 12, color: C.textSec, textAlign: "right" }}>{fmtH(r.h)}</span>
              </div>
            ))}
          </div>
        </>
      )}
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
function BookingManager({ bookings, removeBooking, removeSeries, onMove }) {
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
        Alle freigegebenen Belegungen ab heute. Über den Filter eine Mannschaft auswählen und einzelne Tage verschieben oder löschen – z. B. wenn ein Trainer einen Ausfall meldet.
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
            <div style={{ fontSize: 12, color: C.textSec }}>{fieldById(b.field)?.name} · {zoneText(b.field, b.zone)}{b.kind === "match" ? (b.opponent ? ` · vs. ${b.opponent}` : " · Heimspiel") : ""}{b.kind === "match" ? ` · belegt ${effectiveSpan(b).start}–${effectiveSpan(b).end}` : ""}{b.kind === "turnier" ? " · Turnier" : ""}{b.seriesId ? " · Teil einer Serie" : ""}</div>
          </span>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {onMove && <button style={S.navBtn} onClick={() => onMove(b)}>Verschieben</button>}
            {b.seriesId && <button style={S.delBtn} onClick={() => { if (window.confirm("Die ganze Serie löschen (alle Termine)?")) removeSeries(b.seriesId, bookings); }}>Serie löschen</button>}
            <button style={S.delBtn} onClick={() => { if (window.confirm(`Belegung am ${fmtDate(b.date)} löschen?`)) removeBooking(b.id); }}>Diesen Tag löschen</button>
          </span>
        </div>
      ))}
    </div>
  );
}

// Platzwart: Nachrichten von Trainern
function MessageInbox({ messages, setMessageDone, removeMessage, users, addMessage }) {
  // Inbox zeigt nur eingehende Nachrichten (Trainer -> Platzwart)
  const userById = {};
  (users || []).forEach((u) => { userById[u.id] = u; });
  const senderLabel = (m) => {
    const u = m.senderUid ? userById[m.senderUid] : null;
    const who = u ? (u.name || u.email) : null;
    const team = teamById(m.team)?.name || m.team;
    return who ? `${team} · ${who}` : team;
  };
  const all = messages.filter((m) => m.dir !== "out");
  const sorted = all.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const open = sorted.filter((m) => !m.done);
  const done = sorted.filter((m) => m.done);
  const fmtTs = (ts) => ts ? new Date(ts).toLocaleString("de-DE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

  // ----- Senden an Trainer (an alle / Mannschaft / Person) -----
  const [target, setTarget] = useState("all");       // "all" | team:<id> | user:<uid>
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  // Nur echte Trainer-Konten als Einzelempfänger anbieten
  const trainerUsers = (users || []).filter((u) => u.role === "trainer");
  const send = () => {
    const t = text.trim();
    if (!t) return;
    const base = { dir: "out", text: t };
    if (target === "all") base.toAll = true;
    else if (target.startsWith("team:")) base.team = target.slice(5);
    else if (target.startsWith("user:")) base.recipientUid = target.slice(5);
    addMessage(base);
    setText(""); setSent(true); setTimeout(() => setSent(false), 2000);
  };

  return (
    <div>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 18, background: "#fafaf7" }}>
        <div style={S.subHead}>Nachricht an Trainer senden</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ ...S.select, width: "auto", minWidth: 200 }}>
            <option value="all">An alle Trainer</option>
            <optgroup label="An eine Mannschaft">
              {TEAMS.map((t) => <option key={t.id} value={`team:${t.id}`}>{t.name}</option>)}
            </optgroup>
            {trainerUsers.length > 0 && (
              <optgroup label="An eine Person">
                {trainerUsers.map((u) => <option key={u.id} value={`user:${u.id}`}>{u.name || u.email}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Nachricht an die Trainer…" rows={3}
          style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 14, fontFamily: "inherit", resize: "vertical" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <button style={{ ...S.primaryBtn, ...(text.trim() ? {} : S.btnDisabled) }} disabled={!text.trim()} onClick={send}>Senden</button>
          {sent && <span style={{ color: C.ok, fontSize: 13 }}>✓ Nachricht gesendet</span>}
        </div>
      </div>

      <div style={S.subHead}>Eingegangene Nachrichten</div>
      {open.length === 0 && <p style={{ color: C.textSec, fontSize: 14 }}>Keine neuen Nachrichten.</p>}
      {open.map((m) => (
        <div key={m.id} style={S.wishRow}>
          <div style={{ flex: 1 }}>
            <b>{senderLabel(m)}</b> <span style={{ fontSize: 12, color: C.textSec }}>· {fmtTs(m.ts)}</span>
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
              <span>{senderLabel(m)} · {fmtTs(m.ts)} · {m.text}</span>
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

/* ---------------- Nutzerverwaltung (Platzwart) ---------------- */
function UserManager({ users, saveUser, setUserRole, setUserTeams, removeUser }) {
  const list = (users || []).slice().sort((a, b) => {
    if ((a.role === "platzwart") !== (b.role === "platzwart")) return a.role === "platzwart" ? -1 : 1;
    return (a.name || a.email || "").localeCompare(b.name || b.email || "");
  });
  const [editId, setEditId] = useState(null);
  const [draftTeams, setDraftTeams] = useState([]);

  const startEdit = (u) => { setEditId(u.id); setDraftTeams(Array.isArray(u.teams) ? u.teams : []); };
  const toggleTeam = (tid) => setDraftTeams((d) => d.includes(tid) ? d.filter((x) => x !== tid) : [...d, tid]);
  const saveTeams = (u) => { setUserTeams(u.id, draftTeams); setEditId(null); };

  const noRole = list.filter((u) => u.role !== "trainer" && u.role !== "platzwart");

  return (
    <div>
      <p style={{ fontSize: 13, color: C.textSec, marginTop: 0 }}>
        Übersicht aller angemeldeten Nutzer. Konten werden in der Firebase-Console angelegt; nach der ersten Anmeldung erscheinen sie hier automatisch (mit E-Mail). Rolle und Teams vergibst du hier.
      </p>

      {noRole.length > 0 && (
        <div style={{ ...S.warnBanner, background: "#fff7ed", color: "#7c2d12", border: "1px solid #fed7aa", display: "block", marginBottom: 12 }}>
          {noRole.length} neue Anmeldung{noRole.length === 1 ? "" : "en"} ohne Rolle – bitte unten als Trainer freischalten.
        </div>
      )}

      {list.length === 0 && <p style={{ color: C.textSec, fontSize: 14 }}>Noch keine Nutzerprofile vorhanden.</p>}

      {list.map((u) => {
        const isNew = u.role !== "trainer" && u.role !== "platzwart";
        return (
          <div key={u.id} style={{ ...S.wishRow, flexDirection: "column", alignItems: "stretch", gap: 6, ...(isNew ? { background: "#fff7ed" } : {}) }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div>
                <b>{u.name || "(ohne Name)"}</b>
                <span style={{ marginLeft: 8, fontSize: 12, padding: "1px 8px", borderRadius: 10, background: u.role === "platzwart" ? "#fde68a" : u.role === "trainer" ? "#dbeafe" : "#fed7aa", color: "#334" }}>
                  {u.role === "platzwart" ? "Platzwart" : u.role === "trainer" ? "Trainer" : "neu – ohne Rolle"}
                </span>
              </div>
              <span style={{ fontSize: 13, color: C.textSec }}>{u.email || "(keine E-Mail)"}</span>
            </div>

            {isNew && (
              <div>
                <button style={S.okBtn} onClick={() => setUserRole(u.id, "trainer")}>Als Trainer freischalten</button>
              </div>
            )}

            {u.role === "trainer" && (
              <div style={{ fontSize: 13 }}>
                {editId === u.id ? (
                  <div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0" }}>
                      {TEAMS.map((t) => (
                        <button key={t.id} onClick={() => toggleTeam(t.id)}
                          style={{ ...S.roleBtn, ...(draftTeams.includes(t.id) ? S.roleBtnActive : {}), fontSize: 12 }}>
                          {t.name}
                        </button>
                      ))}
                    </div>
                    <button style={S.okBtn} onClick={() => saveTeams(u)}>Teams speichern</button>
                    <button style={{ ...S.navBtn, marginLeft: 6 }} onClick={() => setEditId(null)}>Abbrechen</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ color: C.textSec }}>
                      Teams: {Array.isArray(u.teams) && u.teams.length ? u.teams.map((tid) => teamById(tid)?.name || tid).join(", ") : "—"}
                    </span>
                    <button style={S.navBtn} onClick={() => startEdit(u)}>Teams bearbeiten</button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
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
  const [opponent, setOpponent] = useState(""); // Gegner bei Heimspielen
  const [warmupField, setWarmupField] = useState(""); // "" = auf dem Spielplatz

  const zones = fieldById(field).zones;
  const safeZone = zones.find((z) => z.id === zone) ? zone : zones[0].id;
  const timeInvalid = !(start < end);

  // Konfliktvorschau nur im Einzelmodus (Serie prüft beim Speichern jeden Termin)
  const allDayEntries = [
    ...autoTrainingForDay(new Date(date + "T12:00")),
    ...((bookingsByDay[date] || []).filter((b) => b.status !== "beantragt")),
  ];
  const liveConflicts = mode === "single" && !timeInvalid
    ? findConflicts({ id: "__neu__", field, zone: safeZone, team, start, end, kind }, allDayEntries)
    : [];

  const seriesDates = mode === "series" ? expandRecurrence(seriesFrom, seriesTo, weekday) : [];

  const addSingle = () => {
    const entry = { date, field, zone: safeZone, team, start, end, kind };
    if (kind === "match" && opponent.trim()) entry.opponent = opponent.trim();
    if (kind === "match" && warmupField && warmupField !== field) entry.warmupField = warmupField;
    // Gemeinsame Gruppe für Spiel + ausgelagerten Aufwärm-Block (zum gemeinsamen Löschen)
    const grp = (kind === "match" && warmupField && warmupField !== field)
      ? `mg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` : null;
    if (grp) entry.matchGroup = grp;

    // Aufwärm-Block (nur wenn auf anderen Platz ausgelagert)
    const warmup = warmupBlockFor({ ...entry, id: "__neu__" });
    if (warmup && grp) warmup.matchGroup = grp;

    // Konflikte für Spiel UND Aufwärm-Block prüfen
    const conflicts = findConflicts({ ...entry, id: "__neu__" }, allDayEntries);
    let warmupConflicts = [];
    if (warmup) {
      const warmupDayEntries = [
        ...autoTrainingForDay(new Date(date + "T12:00")),
        ...((bookingsByDay[date] || []).filter((b) => b.status !== "beantragt")),
      ];
      warmupConflicts = findConflicts({ ...warmup, id: "__warmup__" }, warmupDayEntries);
    }
    const allConf = [...conflicts, ...warmupConflicts];
    if (allConf.length > 0) {
      const list = allConf.map((c) =>
        `• ${teamById(c.team)?.name || c.team} (${fieldById(c.field)?.name}, ${fieldById(c.field)?.zones.find((z) => z.id === c.zone)?.label}, ${c.start}–${c.end})${c.auto ? " – fixes Training" : ""}`
      ).join("\n");
      if (!window.confirm(`Achtung – Doppelbelegung!\n\nFolgende Belegung(en) kollidieren${warmup ? " (Spiel und/oder Aufwärmplatz)" : ""}:\n${list}\n\nTrotzdem eintragen?`)) return;
    }
    addBooking(entry);
    if (warmup) addBooking(warmup);
  };

  const addSeries = () => {
    if (seriesDates.length === 0) {
      window.alert("Kein Termin im gewählten Zeitraum. Bitte Datum und Wochentag prüfen.");
      return;
    }
    // Jeden Termin auf Konflikte prüfen
    const conflictDays = [];
    seriesDates.forEach((dk) => {
      const existing = [...autoTrainingForDay(new Date(dk + "T12:00")), ...((bookingsByDay[dk] || []).filter((b) => b.status !== "beantragt"))];
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

  const dayEntries = (bookingsByDay[date] || []).filter((e) => e.field === field && e.status !== "beantragt");

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
        {kind === "match" && (
          <Field label="Gegner">
            <input type="text" placeholder="z. B. TSV Musterdorf" value={opponent} onChange={(e) => setOpponent(e.target.value)} style={S.select} />
          </Field>
        )}
        {kind === "match" && (
          <Field label="Aufwärmen auf">
            <select value={warmupField} onChange={(e) => setWarmupField(e.target.value)} style={S.select}>
              <option value="">Spielplatz ({fieldById(field)?.name})</option>
              {FIELDS.filter((f) => f.id !== field).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
        )}
      </div>

      {kind === "match" && !timeInvalid && (() => {
        const wf = warmupField && warmupField !== field ? warmupField : null;
        const wb = wf ? warmupBlockFor({ kind, date, field, start, end, team, warmupField: wf }) : null;
        const spielEnd = effectiveSpan({ kind, start, end, warmupField: wf, field }).end;
        // Prüfen, ob der Aufwärm-Block (oder das Aufwärmen auf dem Spielplatz) kollidiert
        const dayEntriesAll = [
          ...autoTrainingForDay(new Date(date + "T12:00")),
          ...((bookingsByDay[date] || []).filter((b) => b.status !== "beantragt")),
        ];
        let warmupClash = [];
        if (wb) {
          warmupClash = findConflicts({ ...wb, id: "__wmcheck__" }, dayEntriesAll);
        }
        // Falls Aufwärmplatz belegt: freien Platz vorschlagen
        let suggestion = null;
        if (warmupClash.length > 0) {
          for (const f of FIELDS) {
            if (f.id === field) continue; // nicht der Spielplatz
            const probe = warmupBlockFor({ kind, date, field, start, end, team, warmupField: f.id });
            if (probe && findConflicts({ ...probe, id: "__probe__" }, dayEntriesAll).length === 0) {
              suggestion = f; break;
            }
          }
        }
        return (
          <>
            <div style={{ ...S.warnBanner, background: "#eef4ff", color: "#234", border: "1px solid #b9cdf0" }}>
              Anstoß <b>{start}</b>, Ende {end}.{" "}
              {wb
                ? <>Aufwärmen auf <b>{fieldById(wf)?.name}</b> ({wb.start}–{wb.end}). Spielplatz {fieldById(field)?.name} belegt {start}–{spielEnd}.</>
                : <>Spielplatz wird inkl. Aufwärmen (1 Std. vorher) und Abbau (15 Min. danach) von <b>{effectiveSpan({ kind, start, end }).start}</b> bis <b>{spielEnd}</b> geblockt.</>}
            </div>
            {warmupClash.length > 0 && (
              <div style={S.warnBanner}>
                ⚠️ Der Aufwärmplatz {fieldById(wf)?.name} ist {wb.start}–{wb.end} bereits belegt.
                {suggestion ? <> Vorschlag: Aufwärmen auf <b>{suggestion.name}</b> (dort frei).</> : <> Alle anderen Plätze sind zu dieser Zeit ebenfalls belegt.</>}
              </div>
            )}
          </>
        );
      })()}

      {timeInvalid && <div style={S.warnBanner}>⚠️ Die Endzeit muss nach der Startzeit liegen.</div>}
      {mode === "single" && !timeInvalid && liveConflicts.length > 0 && (
        <div style={S.warnBanner}>
          ⚠️ Doppelbelegung: {fieldById(field)?.name} ({zoneText(field, safeZone)}) ist {start}–{end} schon belegt durch{" "}
          {liveConflicts.map((c) => `${teamById(c.team)?.name || c.team} (${zoneText(c.field, c.zone)})${c.auto ? " – fix" : ""}`).join(", ")}. Eintragen ist möglich, wird aber nachgefragt.
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
              <span><b>{teamById(e.team)?.name || e.team}</b> · {fieldById(e.field).name} · {fieldById(e.field).zones.find((z) => z.id === e.zone)?.label} · {e.start}–{e.end}{e.kind === "match" && (e.opponent ? ` · vs. ${e.opponent}` : " · Heimspiel")}{e.kind === "turnier" && " · Turnier"}{e.seriesId && " · Serie"}</span>
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
  const [moveTarget, setMoveTarget] = useState(null); // die zu verschiebende Belegung
  const todayKey = dayKey(new Date());
  const pending = bookings
    .filter((b) => b.status === "beantragt" && b.date >= todayKey)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  // Vergangene, nie bearbeitete Anträge (können nur noch entfernt werden)
  const stale = bookings
    .filter((b) => b.status === "beantragt" && b.date < todayKey)
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
    addMessage({ team: b.team, recipientUid: b.ownerUid || null, dir: "out", text: `Trainingstag ${label} wurde abgelehnt.${reason ? " " + reason : ""}` });
    removeBooking(b.id);
  };

  const rejectSeries = (sid, list) => {
    const b = list[0];
    const reason = window.prompt(`Ganze Serie ablehnen – kurze Nachricht an ${teamById(b.team)?.name} (optional):`, "");
    if (reason === null) return;
    addMessage({ team: b.team, recipientUid: b.ownerUid || null, dir: "out", text: `Die beantragte Trainings-Serie (${WEEKDAYS[(new Date(b.date+"T12:00").getDay()+6)%7]} ${b.start}–${b.end}) wurde abgelehnt.${reason ? " " + reason : ""}` });
    removeSeries(sid, bookings);
  };

  const move = (b) => setMoveTarget(b);

  const doMove = (b, neu) => {
    moveBooking(b.id, { ...neu, team: b.team, kind: "training", status: "frei" });
    addMessage({ team: b.team, recipientUid: b.ownerUid || null, dir: "out", text: `${teamById(b.team)?.name} wurde verschoben auf ${fmtDate(neu.date)} ${neu.start}–${neu.end} (${fieldById(neu.field)?.name}, ${zoneText(neu.field, neu.zone)}), bitte prüfen.` });
    setMoveTarget(null);
  };

  const empty = singles.length === 0 && Object.keys(seriesMap).length === 0;

  return (
    <div>
      {moveTarget && <MoveDialog entry={moveTarget} onCancel={() => setMoveTarget(null)} onSave={doMove} />}
      <p style={{ fontSize: 14, color: C.textSec, marginTop: 0 }}>
        Von Trainern beantragte Trainingstage. Erst nach <b>Freigabe</b> erscheinen sie im Kalender. Du kannst einzelne Termine auch <b>verschieben</b> (Datum, Zeit, Platz und Einteilung) – der Trainer bekommt dann eine Nachricht.
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

      {stale.length > 0 && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          <div style={S.subHead}>Ältere offene Anträge (Datum vergangen)</div>
          <p style={{ fontSize: 12, color: C.textSec, marginTop: 0 }}>Diese Anträge liegen in der Vergangenheit und können nur noch entfernt werden.</p>
          {stale.map((b) => (
            <div key={b.id} style={{ ...S.listRow, fontSize: 13, opacity: 0.8 }}>
              <span>{teamById(b.team)?.name} · {fmtDate(b.date)} · {b.start}–{b.end} · {fieldById(b.field)?.name}</span>
              <button style={S.delBtn} onClick={() => removeBooking(b.id)}>Entfernen</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Verschieben-Dialog ---------------- */
function MoveDialog({ entry, onCancel, onSave }) {
  const [date, setDate] = useState(entry.date);
  const [field, setField] = useState(entry.field);
  const [zone, setZone] = useState(entry.zone);
  const [start, setStart] = useState(entry.start);
  const [end, setEnd] = useState(entry.end);
  const zones = fieldById(field).zones;
  const safeZone = zones.find((z) => z.id === zone) ? zone : zones[0].id;
  const timeInvalid = !(start < end);

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 14, background: "#f7fbff" }}>
      <div style={S.subHead}>{teamById(entry.team)?.name} verschieben</div>
      <div style={S.formGrid}>
        <Field label="Datum"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={S.select} /></Field>
        <Field label="Platz">
          <select value={field} onChange={(e) => { setField(e.target.value); setZone(fieldById(e.target.value).zones[0].id); }} style={S.select}>
            {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        <Field label="Einteilung / Zone">
          <select value={safeZone} onChange={(e) => setZone(e.target.value)} style={S.select}>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
          </select>
        </Field>
        <Field label="Von"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={S.select} /></Field>
        <Field label="Bis"><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={S.select} /></Field>
      </div>
      {timeInvalid && <div style={S.warnBanner}>⚠️ Die Endzeit muss nach der Startzeit liegen.</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button style={{ ...S.primaryBtn, ...(timeInvalid ? S.btnDisabled : {}) }} disabled={timeInvalid}
          onClick={() => onSave(entry, { date, field, zone: safeZone, start, end })}>
          Verschieben & Trainer benachrichtigen
        </button>
        <button style={S.navBtn} onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
}

/* ---------------- Verschieben-Overlay (Wochenplan / Liste) ---------------- */
function MoveDialogOverlay({ entry, onCancel, onSave }) {
  const [date, setDate] = useState(entry.date);
  const [field, setField] = useState(entry.field);
  const [zone, setZone] = useState(entry.zone);
  const [start, setStart] = useState(entry.start);
  const [end, setEnd] = useState(entry.end);
  const zones = fieldById(field).zones;
  const safeZone = zones.find((z) => z.id === zone) ? zone : zones[0].id;
  const timeInvalid = !(start < end);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 12px", zIndex: 1000 }}
      onClick={onCancel}>
      <div style={{ ...S.card, maxWidth: 520, width: "100%", marginTop: 0 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.subHead}>{teamById(entry.team)?.name} verschieben</div>
        <div style={S.formGrid}>
          <Field label="Datum"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={S.select} /></Field>
          <Field label="Platz">
            <select value={field} onChange={(e) => { setField(e.target.value); setZone(fieldById(e.target.value).zones[0].id); }} style={S.select}>
              {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
          <Field label="Einteilung / Zone">
            <select value={safeZone} onChange={(e) => setZone(e.target.value)} style={S.select}>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
            </select>
          </Field>
          <Field label="Von"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={S.select} /></Field>
          <Field label="Bis"><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={S.select} /></Field>
        </div>
        {timeInvalid && <div style={S.warnBanner}>⚠️ Die Endzeit muss nach der Startzeit liegen.</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button style={{ ...S.primaryBtn, ...(timeInvalid ? S.btnDisabled : {}) }} disabled={timeInvalid}
            onClick={() => onSave(entry, { date, field, zone: safeZone, start, end })}>
            Verschieben
          </button>
          <button style={S.navBtn} onClick={onCancel}>Abbrechen</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Trainer ---------------- */
function TrainerPanel({ trainerTeam, bookings, bookingsByDay, addBooking, addBookingSeries, entriesForDay, addMessage, messages, myUid, myTeams }) {
  const [tab, setTab] = useState("eintragen");
  return (
    <div style={{ ...S.card, marginTop: "1rem" }}>
      <div style={S.adminTabs}>
        {[["eintragen", "Trainingstag eintragen"], ["nachricht", "Nachricht an Platzwart"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...S.tab, ...(tab === k ? S.tabActive : {}) }}>{l}</button>
        ))}
      </div>
      {tab === "eintragen" && <TrainerBookingForm trainerTeam={trainerTeam} bookings={bookings} bookingsByDay={bookingsByDay} addBooking={addBooking} addBookingSeries={addBookingSeries} entriesForDay={entriesForDay} />}
      {tab === "nachricht" && <MessageForm trainerTeam={trainerTeam} addMessage={addMessage} messages={messages} myUid={myUid} myTeams={myTeams} />}
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

  const allDayEntries = [
    ...autoTrainingForDay(new Date(date + "T12:00")),
    ...((bookingsByDay[date] || []).filter((b) => b.status !== "beantragt")),
  ];
  const liveConflicts = mode === "single" && !timeInvalid
    ? findConflicts({ id: "__neu__", field, zone: safeZone, team: trainerTeam, start, end }, allDayEntries)
    : [];
  const seriesDates = mode === "series" ? expandRecurrence(seriesFrom, seriesTo, weekday) : [];
  const seriesConflicts = mode === "series" && !timeInvalid
    ? seriesDates.filter((dk) => findConflicts({ id: "__neu__", field, zone: safeZone, team: trainerTeam, start, end }, [...autoTrainingForDay(new Date(dk + "T12:00")), ...((bookingsByDay[dk] || []).filter((b) => b.status !== "beantragt"))]).length > 0)
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
          ⚠️ {fieldById(field)?.name} ({zoneText(field, safeZone)}) ist {start}–{end} schon belegt durch {liveConflicts.map((c) => `${teamById(c.team)?.name || c.team} (${zoneText(c.field, c.zone)})`).join(", ")}. Eintragen ist möglich, wird aber nachgefragt.
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

function MessageForm({ trainerTeam, addMessage, messages, myUid, myTeams }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const teams = Array.isArray(myTeams) && myTeams.length ? myTeams : [trainerTeam];
  const send = () => {
    const t = text.trim();
    if (!t) return;
    addMessage({ team: trainerTeam, text: t, dir: "in" });
    setText(""); setSent(true); setTimeout(() => setSent(false), 2000);
  };
  // Eingehend (vom Platzwart): an alle, an mich persönlich ODER an eines meiner Teams
  const incoming = messages
    .filter((m) => m.dir === "out" && (m.toAll || (m.recipientUid && m.recipientUid === myUid) || (m.team && teams.includes(m.team))))
    .slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 8);
  // Meine gesendeten: was ich selbst geschickt habe
  const mine = messages
    .filter((m) => m.dir !== "out" && ((m.senderUid && m.senderUid === myUid) || (!m.senderUid && m.team === trainerTeam)))
    .slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 5);
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

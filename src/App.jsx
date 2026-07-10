import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  TEAMS, FIELDS, teamById, fieldById, WEEKDAYS, WEEKDAYS_LONG,
  dayKey, mondayOf, addDays, isoWeek, fmtRange, expandRecurrence, zoneCovers,
  autoTrainingForDay, findConflicts, conflictIdsForEntries, effectiveSpan, warmupBlockFor,
  zonesOverlap, timeOverlap,
  buildIrrigationWindows, findIrrigationOverlaps, passDurationSec, kickoffToStart, computeMatchIrrigation, homeGamesFromIcs, icsGamesToBookings,
} from "./lib/domain";
import { useAuth } from "./lib/auth";
import { useBookings, useLocks, useMessages, useUsers, useNotes, useIrrigation } from "./lib/data";
import { C, S } from "./lib/styles";
import { ferienAn, feiertagAn } from "./lib/feiertage";
import Pitch from "./components/Pitch";
import MaehplanPanel from "./components/MaehplanPanel";
import { useMaehplan, getMaehFieldsForWeekday, getMaehStatusForDay, getMaehStatusForDate, getMaehDaysForMonth } from "./lib/maehplan";

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
async function exportMonthPDF(monthAnchor, entriesForDay, irrDays) {
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
    // Beregnungs-Markierung P1/P2 rechts neben der Datumszahl
    if (irrDays) {
      const wd = WEEKDAYS[(d.getDay() + 6) % 7];
      let mx = x + colW - 1.5;
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(6);
      if (irrDays.p2 && irrDays.p2.includes(wd)) { pdf.setTextColor(29, 111, 184); pdf.text("P2", mx, y + 4, { align: "right" }); mx -= 5; }
      if (irrDays.p1 && irrDays.p1.includes(wd)) { pdf.setTextColor(15, 110, 62); pdf.text("P1", mx, y + 4, { align: "right" }); }
    }
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

// Wochenplan als PDF (DIN A4 quer): 7 Tagesspalten mit den Einträgen.
async function exportWeekPDF(weekDays, entriesForDay, irrDays) {
  let jsPDF;
  try {
    jsPDF = await loadJsPDF();
  } catch (e) {
    window.alert(e.message || "PDF konnte nicht erstellt werden.");
    return;
  }
  const fieldShort = { p1: "P1", p2: "P2", p3: "P3" };
  const zoneShort = { p2_voll: "ganz", h_ob: "Ob", h_ha: "Ha", v1: "V1", v2: "V2", v3: "V3", v4: "V4", h1: "H1", h2: "H2", voll: "" };

  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297, H = 210, M = 8;
  const gridW = W - 2 * M;
  const colW = gridW / 7;
  const titleY = M + 4;
  const headTop = M + 8;
  const headH = 7;
  const gridTop = headTop + headH;
  const gridH = H - gridTop - M;

  const mon = weekDays[0], sun = weekDays[6];
  const fmt = (d) => `${d.getDate()}.${d.getMonth() + 1}.`;
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(14); pdf.setTextColor(15, 110, 62);
  pdf.text(`SV Dörfleins – Platzbelegung · Woche ${fmt(mon)}–${fmt(sun)}${sun.getFullYear()}`, M, titleY);

  const todayKeyStr = dayKey(new Date());
  weekDays.forEach((d, i) => {
    const x = M + i * colW;
    const isToday = dayKey(d) === todayKeyStr;
    // Kopf
    pdf.setFillColor(isToday ? 225 : 240, isToday ? 240 : 240, isToday ? 230 : 240);
    pdf.rect(x, headTop, colW, headH, "F");
    pdf.setDrawColor(200); pdf.rect(x, headTop, colW, headH, "S");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); pdf.setTextColor(40, 40, 40);
    pdf.text(`${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()}.${d.getMonth() + 1}.`, x + 1.5, headTop + 4.8);
    // Beregnungs-Markierung (P1 grün / P2 blau) rechts im Kopf
    if (irrDays) {
      const wd = WEEKDAYS[(d.getDay() + 6) % 7];
      let mx = x + colW - 2;
      pdf.setFontSize(6.5); pdf.setFont("helvetica", "bold");
      if (irrDays.p2 && irrDays.p2.includes(wd)) { pdf.setTextColor(29, 111, 184); pdf.text("P2", mx, headTop + 4.6, { align: "right" }); mx -= 6; }
      if (irrDays.p1 && irrDays.p1.includes(wd)) { pdf.setTextColor(15, 110, 62); pdf.text("P1", mx, headTop + 4.6, { align: "right" }); }
    }
    // Spaltenkörper
    pdf.rect(x, gridTop, colW, gridH, "S");
    const entries = entriesForDay(d).slice().sort((a, b) => a.start.localeCompare(b.start));
    let ey = gridTop + 5;
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7);
    entries.forEach((e) => {
      if (ey > gridTop + gridH - 3) return;
      const t = teamById(e.team);
      if (t) { const col = hexToRgb(t.color); pdf.setFillColor(col.r, col.g, col.b); pdf.circle(x + 2, ey - 1.2, 0.8, "F"); }
      pdf.setTextColor(30, 30, 30);
      const z = zoneShort[e.zone] ? "·" + zoneShort[e.zone] : "";
      const line1 = `${e.start} ${t ? t.name : e.team}`;
      const line2 = `${fieldShort[e.field] || ""}${z}${e.kind === "match" ? " · Heimspiel" : e.kind === "turnier" ? " · Turnier" : ""}`;
      pdf.text(pdf.splitTextToSize(line1, colW - 5)[0], x + 3.6, ey);
      ey += 3.1;
      if (ey <= gridTop + gridH - 3) { pdf.setTextColor(110, 110, 110); pdf.text(pdf.splitTextToSize(line2, colW - 5)[0], x + 3.6, ey); ey += 3.6; }
    });
    if (entries.length === 0) { pdf.setTextColor(150, 150, 150); pdf.text("frei", x + 3.6, gridTop + 5); }
  });

  pdf.save(`Platzbelegung-Woche-${dayKey(mon)}.pdf`);
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "#666666");
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 102, g: 102, b: 102 };
}
function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Erkennt schmale Bildschirme (Handy). Layout richtet sich nach Bildschirmbreite,
// nicht nach Rolle – so bekommt jeder am Handy die mobile Ansicht, am PC die breite.
function useIsMobile(maxWidth = 720) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth <= maxWidth : false
  );
  React.useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= maxWidth);
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [maxWidth]);
  return isMobile;
}

export default function App() {
  // ----- Theme (hell / dunkel / automatisch) -----
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem("svd_theme") || "auto"; } catch { return "auto"; }
  });
  React.useEffect(() => {
    const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const apply = () => {
      const dark = theme === "dark" || (theme === "auto" && mq && mq.matches);
      document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    };
    apply();
    if (theme === "auto" && mq) {
      mq.addEventListener ? mq.addEventListener("change", apply) : mq.addListener(apply);
      return () => { mq.removeEventListener ? mq.removeEventListener("change", apply) : mq.removeListener(apply); };
    }
  }, [theme]);
  const setTheme = (t) => {
    setThemeState(t);
    try { localStorage.setItem("svd_theme", t); } catch { /* ignore */ }
  };

  const { user, authReady, isLoggedIn, role, isVorstand, isPlatzwart, isTrainer, canEditIrrigation, myTeams, profile, loginEmail, resetPassword, registerEmail, logout, loginAdminPin, pinAdmin, changePin } = useAuth();
  const isAdmin = isPlatzwart; // Kompatibilität: bestehender Code nutzt isAdmin = Platzwart-Rechte
  const [showLogin, setShowLogin] = useState(false);
  const { bookings, bookingsReady, addBooking, addBookingSeries, setBookingStatus, approveSeries, moveBooking, removeBooking, removeSeries, importBookings } = useBookings();
  const { locks, locksReady, addLock, removeLock } = useLocks();
  const { notes, notesReady, setNote } = useNotes();
  const { messages, messagesReady, addMessage, setMessageDone, removeMessage } = useMessages();
  const { users, saveUser, setUserRole, setUserTeams, setUserRights, removeUser } = useUsers(isPlatzwart);
  const { irrigation, irrigationReady, saveIrrigation } = useIrrigation();
  const maehplanCfg = (irrigation && irrigation._maehplan) || {};
  const maehplanOn = maehplanCfg.enabled === true;
  // Mähplan-Daten für Symbole in Wochen- und Monatsansicht
  const { plan: maehplan, signups: maehSignups, kw: maehKw } = useMaehplan(maehplanOn);

  // Heimspiel-Kurzberegnung für HEUTE (für Spieltag-Banner im Plan)
  const todayMatchIrr = useMemo(() => {
    const a = (irrigation && irrigation._auto) || {};
    if (!a.triggerTeams || a.triggerTeams.length === 0) return [];
    const today = dayKey(new Date());
    const cfg = {
      p1: { runMin: a.shortRunMin || 5, gapSec: a.shortGapSec || 5, torStations: a.torP1 || [3, 12, 7, 8], stations: 12, endOffsetMin: a.endOffsetMin != null ? a.endOffsetMin : 30 },
      p2: { runMin: a.shortRunMin || 5, gapSec: a.shortGapSec || 5, torStations: a.torP2 || [], stations: 12, endOffsetMin: a.endOffsetMin != null ? a.endOffsetMin : 30 },
    };
    return computeMatchIrrigation(bookings, a.triggerTeams, cfg, today).filter((m) => m.date === today);
  }, [irrigation, bookings]);

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
  const [teamFilter, setTeamFilter] = useState("all"); // "all" | "mine" | teamId
  // Trainer sehen beim Anmelden zunächst nur ihre Mannschaften
  React.useEffect(() => {
    if (isTrainer && myTeams && myTeams.length > 0) setTeamFilter("mine");
    else setTeamFilter("all");
  }, [isTrainer, myTeams]);
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
  const openMsgCount = messages.filter((m) => !m.done && m.dir !== "out").length;
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

  // Vorstand-Bereich öffnen: nur echte Admins; sonst Login-Maske.
  const requestVorstand = () => {
    if (isVorstand) { setView("vorstand"); return; }
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
      <div className="app-shell" style={S.shell}>
        <div style={{ padding: "3rem", textAlign: "center", color: C.textSec }}>
          Verbinde mit dem Belegungsplan…
        </div>
      </div>
    );

  return (
    <div className="app-shell" style={S.shell}>
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
        setView={(v) => (v === "admin" ? requestAdmin() : v === "trainer" ? requestTrainer() : v === "vorstand" ? requestVorstand() : v === "maehplan" ? setView("maehplan") : setView(v))}
        isAdmin={isAdmin}
        isVorstand={isVorstand}
        isPlatzwart={isPlatzwart}
        maehplanOn={maehplanOn}
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
        onPdf={() => exportMonthPDF(monthAnchor, entriesForDay, { p1: (irrigation?.p1?.days) || [], p2: (irrigation?.p2?.days) || [] })}
        onWeekPdf={() => exportWeekPDF(days, entriesForDay, { p1: (irrigation?.p1?.days) || [], p2: (irrigation?.p2?.days) || [] })}
        theme={theme}
        setTheme={setTheme}
      />

      {isPlatzwart && todayMatchIrr.length > 0 && (
        <div style={{ ...S.warnBanner, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", display: "block" }}>
          💧 <b>Heute Kurzberegnung vor Heimspiel:</b>{" "}
          {todayMatchIrr.map((m, i) => {
            const platz = m.field === "p1" ? "Platz 1" : "Platz 2";
            return (
              <span key={i}>
                {i > 0 && " · "}
                {platz} (Anpfiff {m.kickoff}): {m.mode === "BC"
                  ? `Prog. B ${m.progB}, Prog. C ${m.progC}`
                  : `Start ${m.start}`}
              </span>
            );
          })}
        </div>
      )}

      {pendingCount > 0 && (
        <div style={{ ...S.warnBanner, background: "var(--c-info-bg, #eef4ff)", color: "#234", border: "1px solid #b9cdf0" }}>
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
            teamFilter={teamFilter}
            setTeamFilter={setTeamFilter}
            myTeams={myTeams}
            irrigation={irrigation}
            maehplan={maehplan}
            maehSignups={maehSignups}
            maehKw={maehKw}
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
          irrigation={irrigation}
          maehplan={maehplan}
          maehSignups={maehSignups}
          maehKw={maehKw}
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
          setUserRights={setUserRights}
          removeUser={removeUser}
          isVorstand={isVorstand}
          changePin={changePin}
          irrigation={irrigation}
          saveIrrigation={saveIrrigation}
          canEditIrrigation={canEditIrrigation}
          importBookings={importBookings}
        />
      )}

      {view === "vorstand" && isVorstand && (
        <VorstandPanel
          users={users}
          saveUser={saveUser}
          setUserRole={setUserRole}
          setUserTeams={setUserTeams}
          setUserRights={setUserRights}
          removeUser={removeUser}
          isVorstand={isVorstand}
          changePin={changePin}
          irrigation={irrigation}
          saveIrrigation={saveIrrigation}
          importBookings={importBookings}
          bookings={bookings}
        />
      )}

      {view === "maehplan" && maehplanOn && isPlatzwart && (
        <MaehplanPanel isPlatzwart={isPlatzwart} bookings={bookings} />
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
function Header({ view, setView, isAdmin, isVorstand, isPlatzwart, isLoggedIn, role, myTeams, profile, onLoginClick, logoutAdmin, trainerTeam, setTrainerTeam, notices, requestCount, calMode, setCalMode, onPrint, onPdf, onWeekPdf, theme, setTheme, maehplanOn }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const teamOptions = (role === "trainer" && myTeams.length > 0)
    ? TEAMS.filter((t) => myTeams.includes(t.id))
    : TEAMS;
  const roleLabel = view === "maehplan" ? "Mähplan" : view === "vorstand" ? "Vorstand" : view === "admin" ? "Platzwart" : view === "trainer" ? "Trainer" : "Betrachter";

  const ROLES = [
    ["viewer", "Betrachter"], ["trainer", "Trainer"], ["admin", "Platzwart"],
    ...(isVorstand ? [["vorstand", "Vorstand"]] : []),
    ...(maehplanOn && isPlatzwart ? [["maehplan", "Mähplan"]] : []),
  ];
  const close = () => setMenuOpen(false);

  return (
    <header style={S.header}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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

                {calMode === "woche" && (
                  <>
                    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", color: C.textTer, padding: "8px 8px 2px" }}>Wochenplan</div>
                    <button onClick={() => { close(); onPrint && onPrint(); }} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent", color: C.ink, cursor: "pointer", fontSize: 14, borderRadius: 7, padding: "8px 10px" }}>🖨 Drucken</button>
                    <button onClick={() => { close(); onWeekPdf && onWeekPdf(); }} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent", color: C.ink, cursor: "pointer", fontSize: 14, borderRadius: 7, padding: "8px 10px" }}>⬇ Woche als PDF</button>
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

                {setTheme && (
                  <>
                    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", color: C.textTer, padding: "8px 8px 2px" }}>Darstellung</div>
                    {[["auto", "Automatisch"], ["light", "Hell"], ["dark", "Dunkel"]].map(([k, l]) => (
                      <button key={k} onClick={() => { setTheme(k); }}
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", textAlign: "left", border: "none", background: theme === k ? C.brand : "transparent", color: theme === k ? "#fff" : C.ink, cursor: "pointer", fontSize: 14, borderRadius: 7, padding: "8px 10px" }}>
                        <span>{l}</span>
                        {theme === k && <span style={{ fontSize: 12 }}>✓</span>}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <img src="/logo.png" alt="SV Dörfleins" style={{ width: 46, height: 46, objectFit: "contain", flex: "none" }} />
        <div>
          <h1 style={S.h1}>SV Dörfleins</h1>
          <p style={S.sub}>Platzbelegung &amp; Trainingsplan</p>
        </div>
      </div>

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
  const [mode, setMode] = useState("login");
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
  const isMobile = useIsMobile();
  return (
    <div style={S.weekNav}>
      <button style={S.navBtn} onClick={() => setWeekStart(addDays(weekStart, -7))}>{isMobile ? "‹" : "‹ Vorige Woche"}</button>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 13, color: C.textSec }}>KW {isoWeek(weekStart)}</div>
        <div style={{ fontWeight: 500, fontSize: 16 }}>{fmtRange(weekStart)}</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={S.navBtn} onClick={() => setWeekStart(mondayOf(new Date()))}>Heute</button>
        <button style={S.navBtn} onClick={() => setWeekStart(addDays(weekStart, 7))}>{isMobile ? "›" : "Nächste Woche ›"}</button>
      </div>
    </div>
  );
}

/* ---------------- Wochenraster ---------------- */
function WeekGrid({ days, entriesForDay, lockForDayField, activeField, setActiveField, isAdmin, removeBooking, onMove, notes, setNote, teamFilter, setTeamFilter, myTeams, irrigation, maehplan, maehSignups, maehKw }) {
  const isMobile = useIsMobile();
  const todayIdx = days.findIndex((d) => dayKey(d) === dayKey(new Date()));
  const [dayIdx, setDayIdx] = useState(todayIdx >= 0 ? todayIdx : 0);
  React.useEffect(() => {
    const t = days.findIndex((d) => dayKey(d) === dayKey(new Date()));
    setDayIdx(t >= 0 ? t : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0] && dayKey(days[0])]);
  const irrDays = {
    p1: (irrigation && irrigation.p1 && irrigation.p1.days) || [],
    p2: (irrigation && irrigation.p2 && irrigation.p2.days) || [],
  };
  const matchesFilter = (e) => {
    if (!teamFilter || teamFilter === "all") return true;
    if (teamFilter === "mine") return myTeams && myTeams.includes(e.team);
    return e.team === teamFilter;
  };
  const filterActive = teamFilter && teamFilter !== "all";
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
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: C.textSec }}>Mannschaft:</span>
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} style={{ ...S.select, width: "auto", minWidth: 160 }}>
          <option value="all">Alle Mannschaften</option>
          {myTeams && myTeams.length > 0 && <option value="mine">Nur meine Mannschaften</option>}
          {TEAMS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {filterActive && (
          <button onClick={() => setTeamFilter("all")}
            style={{ border: `1px solid ${C.border}`, background: C.surface, color: C.textSec, cursor: "pointer", fontSize: 12, borderRadius: 999, padding: "4px 10px" }}>
            ✕ Filter zurücksetzen
          </button>
        )}
      </div>
      {(() => {
        const renderDay = (d) => {
          const all = entriesForDay(d);
          const conflictIds = conflictIdsForEntries(all);
          const fieldEntries = all.filter((e) => e.field === activeField);
          const entries = fieldEntries.filter(matchesFilter);
          const hiddenCount = fieldEntries.length - entries.length;
          const lock = lockForDayField(d, activeField);
          const today = dayKey(d) === dayKey(new Date());
          const dk = dayKey(d);
          const note = notes && notes[dk];
          return (
            <div key={dk} style={{ ...S.dayCol, ...(today ? S.dayToday : {}), ...(isMobile ? { minWidth: 0, width: "100%" } : {}) }}>
              <div style={S.dayHead}>
                <span style={{ fontWeight: 500 }}>{WEEKDAYS[(d.getDay() + 6) % 7]}</span>
                <span style={{ color: C.textSec, fontSize: 12 }}>{d.getDate()}.{d.getMonth() + 1}.</span>
              </div>
              {(() => {
                const wd = WEEKDAYS[(d.getDay() + 6) % 7];
                const p1on = irrDays.p1.includes(wd);
                const p2on = irrDays.p2.includes(wd);
                if (!p1on && !p2on) return null;
                return (
                  <div style={{ display: "flex", gap: 4, marginBottom: 4 }} title="Beregnung an diesem Tag">
                    {p1on && <span style={{ fontSize: 11, color: "#0f6e3e", background: "#e3f1ea", borderRadius: 5, padding: "1px 5px", fontWeight: 500 }}>💧 P1</span>}
                    {p2on && <span style={{ fontSize: 11, color: "#1d6fb8", background: "#e4eef8", borderRadius: 5, padding: "1px 5px", fontWeight: 500 }}>💧 P2</span>}
                  </div>
                );
              })()}
              {feiertagAn(d) && <div style={{ fontSize: 10, color: "#7a3f00", background: "#ffe8cc", borderRadius: 5, padding: "2px 5px", marginBottom: 4, fontWeight: 500 }} title="Gesetzlicher Feiertag">🎌 {feiertagAn(d)}</div>}
              {!feiertagAn(d) && ferienAn(d) && <div style={{ fontSize: 10, color: "#1d6b4f", background: "#e1f3ea", borderRadius: 5, padding: "2px 5px", marginBottom: 4 }} title="Schulferien Bayern">🏖️ {ferienAn(d)}</div>}
              {(() => {
                if (!maehplan) return null;
                const wd = (d.getDay() + 6) % 7;
                if (!maehplan) return null;
                const dkStr = dayKey(d);
                const MAEH_COLORS = { p1: { color: "#15803d", bg: "#dcfce7" }, p2: { color: "#0369a1", bg: "#dbeafe" }, p3: { color: "#92400e", bg: "#fef3c7" } };
                const MAEH_NAMES = { p1: "P1", p2: "P2", p3: "P3" };
                const TYPE_ICO = { "mähen": "🌿", "striegeln": "🪮", "beides": "🌿🪮", "duengen": "🧪", "sonstiges": "📝" };
                // Aufgaben aus Wochenplan
                const planItems = [];
                ["p1","p2","p3"].forEach(fid => {
                  if (!maehplan[fid]?.tasks) return;
                  maehplan[fid].tasks.forEach(task => {
                    if (!task.type) return;
                    const effDay = task.postponedTo !== undefined ? task.postponedTo : task.dayIndex;
                    if (effDay !== wd) return;
                    const status = getMaehStatusForDate(maehplan, fid, dkStr, maehSignups, maehKw);
                    const besetzt = status?.persons?.length > 0;
                    planItems.push({ fid, task, status, besetzt });
                  });
                });
                if (planItems.length === 0) return null;
                return (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 4 }}>
                    {planItems.map(({ fid, task, status, besetzt }, i) => {
                      const c = MAEH_COLORS[fid] || MAEH_COLORS.p1;
                      const icon = TYPE_ICO[task.type] || "📋";
                      return (
                        <span key={i} style={{ fontSize: 11, color: c.color,
                          background: besetzt ? c.bg : "transparent",
                          border: `1px ${besetzt ? "solid" : "dashed"} ${c.color}`,
                          borderRadius: 5, padding: "1px 5px", fontWeight: 500,
                          opacity: status?.done ? 0.5 : 1 }}
                          title={`${icon} ${MAEH_NAMES[fid]}${besetzt ? ": " + status.persons.join(", ") : ": offen"}`}>
                          {icon} {MAEH_NAMES[fid]}{besetzt ? " ✓" : ""}
                        </span>
                      );
                    })}
                  </div>
                );
              })()}
              {lock && <div style={S.lockChip} title={lock.reason}>⛔ Gesperrt{lock.reason ? `: ${lock.reason}` : ""}</div>}
              {note && note.text && <NoteChip text={note.text} />}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {entries.length === 0 && !lock && (
                  <span style={{ color: C.textTer, fontSize: 12, padding: "4px 0" }}>
                    {filterActive && hiddenCount > 0 ? "—" : "frei"}
                  </span>
                )}
                {entries.slice().sort((a, b) => a.start.localeCompare(b.start)).map((e) => (
                  <Chip key={e.id} entry={e} conflict={conflictIds.has(e.id)} isAdmin={isAdmin} removeBooking={removeBooking} onMove={onMove} />
                ))}
                {filterActive && hiddenCount > 0 && (
                  <span style={{ color: C.textTer, fontSize: 10, fontStyle: "italic" }}>{hiddenCount} ausgeblendet</span>
                )}
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
        };

        if (isMobile) {
          const d = days[Math.min(dayIdx, days.length - 1)];
          return (
            <div>
              <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                <button onClick={() => setDayIdx((i) => Math.max(0, i - 1))} disabled={dayIdx <= 0}
                  style={{ ...S.navBtn, opacity: dayIdx <= 0 ? 0.4 : 1, padding: "8px 14px" }}>← Vortag</button>
                <span style={{ fontWeight: 600, fontSize: 14, textAlign: "center" }}>
                  {WEEKDAYS_LONG ? WEEKDAYS_LONG[(d.getDay() + 6) % 7] : WEEKDAYS[(d.getDay() + 6) % 7]}, {d.getDate()}.{d.getMonth() + 1}.
                </span>
                <button onClick={() => setDayIdx((i) => Math.min(days.length - 1, i + 1))} disabled={dayIdx >= days.length - 1}
                  style={{ ...S.navBtn, opacity: dayIdx >= days.length - 1 ? 0.4 : 1, padding: "8px 14px" }}>Folgetag →</button>
              </div>
              <div className="no-print" style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap", justifyContent: "center" }}>
                {days.map((dd, i) => {
                  const sel = i === dayIdx;
                  const isToday = dayKey(dd) === dayKey(new Date());
                  return (
                    <button key={i} onClick={() => setDayIdx(i)}
                      style={{ border: `1px solid ${sel ? C.brand : C.border}`, background: sel ? C.brand : C.surface, color: sel ? "#fff" : (isToday ? C.brand : C.ink), cursor: "pointer", fontSize: 12, borderRadius: 8, padding: "5px 9px", fontWeight: sel || isToday ? 600 : 400, minWidth: 38 }}>
                      {WEEKDAYS[(dd.getDay() + 6) % 7]}
                    </button>
                  );
                })}
              </div>
              {renderDay(d)}
            </div>
          );
        }

        return <div style={S.weekRow}>{days.map(renderDay)}</div>;
      })()}
      <Legend />
    </div>
  );
}

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
  const teamColor = t ? t.color : "#888888";
  const tint = hexToRgba(teamColor, 0.12);
  return (
    <div style={{ ...S.chip, background: tint, borderLeft: `4px solid ${teamColor}`, ...(conflict ? { background: "#fbeaea", borderColor: "#e7a5a5" } : {}) }}
      title={conflict ? "Doppelbelegung – gleiche Zone und Zeit" : undefined}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>
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
  const [showTeams, setShowTeams] = useState(false);
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
      <div style={{ ...S.legend, alignItems: "center" }}>
        <span style={S.legItem}><span style={{ fontSize: 12 }}>V1–V4</span> Viertel (Platz 2)</span>
        <span style={S.legItem}><span style={{ fontSize: 12 }}>H1/H2</span> Hälften (Platz 3)</span>
        <span style={S.legItem}>⛔ Platzsperre</span>
        <span style={S.legItem}>⚠️ Doppelbelegung</span>
        <button onClick={() => setShowTeams((s) => !s)} className="no-print"
          style={{ border: `1px solid ${C.border}`, background: C.surface, color: C.textSec, cursor: "pointer", fontSize: 12, borderRadius: 999, padding: "3px 10px" }}>
          {showTeams ? "Mannschaftsfarben ausblenden" : "Mannschaftsfarben anzeigen"}
        </button>
      </div>
      {showTeams && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 10 }}>
          {TEAMS.map((t) => (
            <span key={t.id} style={S.legItem}><i style={{ ...S.legDot, background: t.color }} />{t.name}</span>
          ))}
        </div>
      )}
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

function MonthView({ monthAnchor, setMonthAnchor, entriesForDay, lockForDayField, isAdmin, removeBooking, notes, setNote, irrigation, maehplan, maehSignups, maehKw }) {
  const irrDays = {
    p1: (irrigation && irrigation.p1 && irrigation.p1.days) || [],
    p2: (irrigation && irrigation.p2 && irrigation.p2.days) || [],
  };
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  // Geplante Mähtage für diesen Monat (KW-genau mit Vormerkungen)
  const maehDays = React.useMemo(() =>
    getMaehDaysForMonth(maehplan, year, month, maehSignups, maehKw),
    [maehplan, year, month, maehSignups, maehKw]
  );
  const shiftMonth = (delta) => { const d = new Date(year, month + delta, 1); setMonthAnchor(d); };
  const toThisMonth = () => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); setMonthAnchor(d); };

  const first = new Date(year, month, 1);
  const gridStart = mondayOf(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
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
              {(() => {
                const wd = WEEKDAYS[(d.getDay() + 6) % 7];
                const p1on = irrDays.p1.includes(wd);
                const p2on = irrDays.p2.includes(wd);
                if (!p1on && !p2on) return null;
                return (
                  <div style={{ display: "flex", gap: 3, marginBottom: 2 }} title="Beregnung">
                    {p1on && <span style={{ fontSize: 8.5, color: "#0f6e3e", background: "#e3f1ea", borderRadius: 4, padding: "0 3px", fontWeight: 600 }}>💧P1</span>}
                    {p2on && <span style={{ fontSize: 8.5, color: "#1d6fb8", background: "#e4eef8", borderRadius: 4, padding: "0 3px", fontWeight: 600 }}>💧P2</span>}
                  </div>
                );
              })()}
              {feiertagAn(d) && <div style={{ fontSize: 8.5, color: "#7a3f00", background: "#ffe8cc", borderRadius: 4, padding: "1px 3px", marginBottom: 2, lineHeight: 1.2, overflowWrap: "anywhere" }} title="Feiertag">{feiertagAn(d)}</div>}
              {!feiertagAn(d) && ferienAn(d) && <div style={{ fontSize: 8.5, color: "#1d6b4f", background: "#e1f3ea", borderRadius: 4, padding: "1px 3px", marginBottom: 2, lineHeight: 1.2, overflowWrap: "anywhere" }} title="Schulferien">{ferienAn(d)}</div>}
              {anyLock.length > 0 && <div style={{ fontSize: 9, color: C.danger, marginBottom: 2 }}>⛔ gesperrt</div>}
              {(() => {
                const dk2 = dayKey(d);
                const maehEntries = maehDays[dk2] || [];
                if (maehEntries.length === 0) return null;
                const MAEH_COLORS = { p1: { color: "#15803d", bg: "#dcfce7" }, p2: { color: "#0369a1", bg: "#dbeafe" }, p3: { color: "#92400e", bg: "#fef3c7" } };
                const MAEH_NAMES = { p1: "P1", p2: "P2", p3: "P3" };
                return (
                  <div style={{ display: "flex", gap: 2, flexWrap: "wrap", marginBottom: 2 }}>
                    {maehEntries.map(({ fieldId: fid, persons, done, taskType }, i) => {
                      const besetzt = persons && persons.length > 0;
                      const c = MAEH_COLORS[fid] || { color: "#15803d", bg: "#dcfce7" };
                      const TYPE_ICO2 = { "mähen": "🌿", "striegeln": "🪮", "beides": "🌿🪮", "duengen": "🧪", "sonstiges": "📝" };
                      const icon = TYPE_ICO2[taskType] || "🌿";
                      return (
                        <span key={i} style={{ fontSize: 8, color: c.color,
                          background: besetzt ? c.bg : "transparent",
                          borderRadius: 3, padding: "0 3px", fontWeight: 600,
                          border: `1px ${besetzt ? "solid" : "dashed"} ${c.color}`,
                          opacity: done ? 0.5 : 1 }}
                          title={besetzt ? `${icon} ${MAEH_NAMES[fid]}: ${persons.join(", ")}` : `${icon} ${MAEH_NAMES[fid]}: offen`}>
                          {icon}{MAEH_NAMES[fid]}{besetzt ? "✓" : "?"}
                        </span>
                      );
                    })}
                  </div>
                );
              })()}
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
  { group: "Pflege", items: [
    ["beregnung", "Beregnung"],
    ["maehplan_pw", "Mähplan"],
  ] },
];
const ADMIN_LABELS = ADMIN_MENU.reduce((acc, g) => { g.items.forEach(([k, l]) => { acc[k] = l; }); return acc; }, {});

function AdminPanel({ days, bookings, bookingsByDay, addBooking, addBookingSeries, setBookingStatus, approveSeries, moveBooking, removeBooking, removeSeries, locks, addLock, removeLock, addMessage, messages, setMessageDone, removeMessage, onMove, users, saveUser, setUserRole, setUserTeams, setUserRights, removeUser, isVorstand, changePin, irrigation, saveIrrigation, canEditIrrigation, importBookings }) {
  const [tab, setTab] = useState("belegung");
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = isVorstand
    ? [...ADMIN_MENU, { group: "Vorstand", items: [
        ["v_nutzer", "Nutzerverwaltung"],
        ["v_kalender", "Spielplan-Kalender"],
        ["v_maehplan", "Mähplan-Schalter"],
      ] }]
    : ADMIN_MENU;
  const labels = menu.reduce((acc, g) => { g.items.forEach(([k, l]) => { acc[k] = l; }); return acc; }, {});
  const groupOfTab = (t) => {
    const g = menu.find((grp) => grp.items.some(([k]) => k === t));
    return g ? g.group : menu[0].group;
  };
  const [openGroup, setOpenGroup] = useState(groupOfTab("belegung"));
  const pending = bookings.filter((b) => b.status === "beantragt" && b.date >= dayKey(new Date())).length;
  const openMsg = messages.filter((m) => !m.done && m.dir !== "out").length;
  const conflictDayCount = (() => {
    const today = dayKey(new Date());
    const byDay = {};
    bookings.filter((b) => b.status !== "beantragt" && b.date >= today).forEach((b) => { (byDay[b.date] ||= []).push(b); });
    let n = 0;
    Object.values(byDay).forEach((list) => { if (conflictIdsForEntries(list).size > 0) n++; });
    return n;
  })();
  const badgeFor = (k) => k === "trainingstage" ? pending : k === "nachrichten" ? openMsg : k === "konflikte" ? conflictDayCount : 0;

  const choose = (k) => { setTab(k); setOpenGroup(groupOfTab(k)); setMenuOpen(false); };
  const openMenu = () => { setOpenGroup(groupOfTab(tab)); setMenuOpen((o) => !o); };

  return (
    <div style={{ ...S.card, marginTop: "1rem" }}>
      <div style={{ position: "relative", marginBottom: 14 }}>
        <button
          onClick={openMenu}
          style={{ ...S.navBtn, display: "flex", alignItems: "center", gap: 8, fontWeight: 500, width: "100%", justifyContent: "space-between" }}>
          <span>☰ {labels[tab] || "Menü"}</span>
          <span style={{ color: C.textSec, fontSize: 12 }}>{menuOpen ? "▲" : "▼"}</span>
        </button>
        {menuOpen && (
          <>
            <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,0.16)", padding: 8, maxHeight: 380, overflowY: "auto" }}>
              {menu.map((grp) => {
                const expanded = openGroup === grp.group;
                const groupBadge = grp.items.reduce((sum, [k]) => sum + (badgeFor(k) || 0), 0);
                return (
                  <div key={grp.group} style={{ marginBottom: 4 }}>
                    <button
                      onClick={() => setOpenGroup(expanded ? null : grp.group)}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", textAlign: "left", border: "none", background: "transparent", color: C.textSec, cursor: "pointer", fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", padding: "6px 8px", fontWeight: 600 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {grp.group}
                        {!expanded && groupBadge > 0 && <span style={{ ...S.badge }}>{groupBadge}</span>}
                      </span>
                      <span style={{ fontSize: 10 }}>{expanded ? "▲" : "▼"}</span>
                    </button>
                    {expanded && grp.items.map(([k, l]) => {
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
                );
              })}
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
      {tab === "beregnung" && <IrrigationPanel irrigation={irrigation} saveIrrigation={saveIrrigation} canEdit={canEditIrrigation} bookings={bookings} />}
      {tab === "maehplan_pw" && <MaehplanPanel isPlatzwart={true} bookings={bookings} />}
      {tab === "v_nutzer" && isVorstand && (
        <UserManager users={users} saveUser={saveUser} setUserRole={setUserRole} setUserTeams={setUserTeams} setUserRights={setUserRights} removeUser={removeUser} isVorstand={isVorstand} changePin={changePin} />
      )}
      {tab === "v_kalender" && isVorstand && (
        <CalendarImport irrigation={irrigation} saveIrrigation={saveIrrigation} canEdit={isVorstand} importBookings={importBookings} bookings={bookings} />
      )}
      {tab === "v_maehplan" && isVorstand && (
        <MaehplanToggle irrigation={irrigation} saveIrrigation={saveIrrigation} />
      )}
    </div>
  );
}

/* ---------------- Konfliktübersicht ---------------- */
function ConflictOverview({ bookings, removeBooking, onMove }) {
  const today = dayKey(new Date());
  const fmtDate = (dk) => {
    const d = new Date(dk + "T12:00");
    return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
  };
  const byDay = {};
  bookings
    .filter((b) => b.status !== "beantragt" && b.date >= today)
    .forEach((b) => { (byDay[b.date] ||= []).push(b); });

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
            <div key={idx} style={{ border: "1px solid #e7a5a5", background: "var(--c-danger-bg, #fdf3f3)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
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
function StatsPanel({ bookings }) {
  const today = new Date();
  const iso = (d) => dayKey(d);
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(new Date(today.getFullYear(), today.getMonth() + 1, 0)));

  const toMin = (t) => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + m; };
  const list = bookings.filter((b) => b.status !== "beantragt" && b.date >= from && b.date <= to);

  const hoursOf = (b) => Math.max(0, (toMin(b.end) - toMin(b.start))) / 60;

  const perField = {};
  FIELDS.forEach((f) => { perField[f.id] = 0; });
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

function zoneText(field, zone) {
  const f = fieldById(field);
  const z = f?.zones.find((x) => x.id === zone);
  return z ? z.label : zone;
}

function BookingManager({ bookings, removeBooking, removeSeries, onMove }) {
  const [team, setTeam] = useState("alle");
  const todayKey = dayKey(new Date());
  const list = bookings
    .filter((b) => b.status !== "beantragt")
    .filter((b) => team === "alle" || b.team === team)
    .filter((b) => b.date >= todayKey)
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

function MessageInbox({ messages, setMessageDone, removeMessage, users, addMessage }) {
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

  const [target, setTarget] = useState("all");
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
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
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 18, background: "var(--c-soft, #fafaf7)" }}>
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

/* ---------------- Beregnung ---------------- */
const IRR_FIELDS = [
  { id: "p1", name: "Platz 1", geraet: "Regulus" },
  { id: "p2", name: "Platz 2", geraet: "Water Control+ SC" },
];
const IRR_WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const IRR_DEFAary = {
  p1: { days: ["Mo", "Do"], runMin: 15, gapSec: 5, stations: 12, starts: ["00:45", "03:55"] },
  p2: { days: ["Mi", "Fr"], runMin: 15, gapSec: 5, stations: 12, starts: ["00:45", "03:55"] },
};

function IrrigationPanel({ irrigation, saveIrrigation, canEdit, bookings }) {
  const initial = (fid) => {
    const fromDb = irrigation && irrigation[fid];
    return fromDb ? { ...IRR_DEFAary[fid], ...fromDb } : { ...IRR_DEFAary[fid] };
  };
  const [draft, setDraft] = useState({ p1: initial("p1"), p2: initial("p2") });
  const [savedMsg, setSavedMsg] = useState(null);

  const autoFromDb = (irrigation && irrigation._auto) || {};
  const [auto, setAuto] = useState({
    triggerTeams: autoFromDb.triggerTeams || [],
    endOffsetMin: autoFromDb.endOffsetMin != null ? autoFromDb.endOffsetMin : 30,
    torP1: autoFromDb.torP1 || [3, 12, 7, 8],
    torP2: autoFromDb.torP2 || [],
    shortRunMin: autoFromDb.shortRunMin || 5,
    shortGapSec: autoFromDb.shortGapSec || 5,
  });
  React.useEffect(() => {
    const a = (irrigation && irrigation._auto) || {};
    setAuto({
      triggerTeams: a.triggerTeams || [],
      endOffsetMin: a.endOffsetMin != null ? a.endOffsetMin : 30,
      torP1: a.torP1 || [3, 12, 7, 8],
      torP2: a.torP2 || [],
      shortRunMin: a.shortRunMin || 5,
      shortGapSec: a.shortGapSec || 5,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irrigation?._auto?.updatedTs]);

  const [torP1Text, setTorP1Text] = useState((autoFromDb.torP1 || [3, 12, 7, 8]).join(", "));
  const [torP2Text, setTorP2Text] = useState((autoFromDb.torP2 || []).join(", "));
  React.useEffect(() => {
    const a = (irrigation && irrigation._auto) || {};
    setTorP1Text((a.torP1 || [3, 12, 7, 8]).join(", "));
    setTorP2Text((a.torP2 || []).join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irrigation?._auto?.updatedTs]);

  const parseStations = (txt) =>
    (txt || "").split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n));

  const toggleTrigger = (tid) => setAuto((a) => ({
    ...a,
    triggerTeams: a.triggerTeams.includes(tid)
      ? a.triggerTeams.filter((x) => x !== tid)
      : [...a.triggerTeams, tid],
  }));
  const saveAuto = async () => {
    try {
      const torP1 = parseStations(torP1Text);
      const torP2 = parseStations(torP2Text);
      const toSave = { ...auto, torP1, torP2 };
      setAuto(toSave);
      await saveIrrigation("_auto", toSave);
      setSavedMsg("Heimspiel-Einstellungen gespeichert.");
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (e) {
      setSavedMsg("Speichern fehlgeschlagen: " + (e.message || ""));
    }
  };

  const today = dayKey(new Date());
  const matchPlan = computeMatchIrrigation(
    bookings, auto.triggerTeams,
    {
      p1: { runMin: auto.shortRunMin, gapSec: auto.shortGapSec, torStations: parseStations(torP1Text), stations: 12, endOffsetMin: auto.endOffsetMin },
      p2: { runMin: auto.shortRunMin, gapSec: auto.shortGapSec, torStations: parseStations(torP2Text), stations: 12, endOffsetMin: auto.endOffsetMin },
    },
    today
  );

  React.useEffect(() => {
    setDraft({ p1: initial("p1"), p2: initial("p2") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irrigation?.p1?.updatedTs, irrigation?.p2?.updatedTs]);

  const upd = (fid, patch) => setDraft((d) => ({ ...d, [fid]: { ...d[fid], ...patch } }));
  const toggleDay = (fid, wd) => {
    const cur = draft[fid].days || [];
    upd(fid, { days: cur.includes(wd) ? cur.filter((x) => x !== wd) : [...cur, wd] });
  };
  const setStart = (fid, idx, val) => {
    const s = [...(draft[fid].starts || [])];
    s[idx] = val;
    upd(fid, { starts: s });
  };

  const overlapsByDay = {};
  IRR_WEEKDAYS.forEach((wd) => {
    const todays = [];
    ["p1", "p2"].forEach((fid) => {
      if ((draft[fid].days || []).includes(wd)) {
        buildIrrigationWindows({
          fieldId: fid,
          starts: (draft[fid].starts || []).filter(Boolean),
          stations: draft[fid].stations || 12,
          runMin: draft[fid].runMin || 15,
          gapSec: draft[fid].gapSec || 0,
        }).forEach((w) => todays.push(w));
      }
    });
    const conf = findIrrigationOverlaps(todays);
    if (conf.length > 0) overlapsByDay[wd] = conf;
  });
  const hasOverlap = Object.keys(overlapsByDay).length > 0;

  const save = async (fid) => {
    if (hasOverlap) return;
    try {
      await saveIrrigation(fid, draft[fid]);
      setSavedMsg(`${IRR_FIELDS.find((f) => f.id === fid).name} gespeichert.`);
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (e) {
      setSavedMsg("Speichern fehlgeschlagen: " + (e.message || ""));
    }
  };

  return (
    <div>
      <p style={{ fontSize: 13, color: C.textSec, marginTop: 0 }}>
        Beregnungszeiten für beide Plätze. Beide Plätze teilen sich <b>eine Pumpe</b> – es darf nie mehr
        als eine Station gleichzeitig laufen. {canEdit ? "Du kannst die Zeiten ändern." : "Nur ansehen – Änderungsrecht hat der Admin vergeben."}
      </p>

      {hasOverlap && (
        <div style={{ ...S.warnBanner, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", display: "block", marginBottom: 12 }}>
          ⚠️ <b>Pumpen-Konflikt:</b> An folgenden Tagen überschneiden sich Stationen beider Plätze:{" "}
          {Object.keys(overlapsByDay).join(", ")}. Bitte Startzeiten oder Tage anpassen. Solange ein Konflikt besteht, ist Speichern gesperrt.
        </div>
      )}
      {savedMsg && (
        <div style={{ ...S.warnBanner, background: "#ecfdf5", color: "#065f46", border: "1px solid #a7f3d0", display: "block", marginBottom: 12 }}>
          ✓ {savedMsg}
        </div>
      )}

      {IRR_FIELDS.map((f) => {
        const d = draft[f.id];
        const windows = buildIrrigationWindows({
          fieldId: f.id, starts: (d.starts || []).filter(Boolean),
          stations: d.stations || 12, runMin: d.runMin || 15, gapSec: d.gapSec || 0,
        });
        const lastEnd = windows.length ? windows[windows.length - 1].end : "—";
        return (
          <div key={f.id} style={{ ...S.card, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
              <h3 style={{ margin: "0 0 6px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: f.id === "p1" ? "#0f6e3e" : "#1d6fb8", display: "inline-block" }} />
                {f.name} <span style={{ fontSize: 12, color: C.textSec, fontWeight: 400 }}>· {f.geraet}</span></h3>
              <span style={{ fontSize: 12, color: C.textSec }}>Ende letzte Station: <b>{lastEnd}</b></span>
            </div>

            <div style={{ margin: "8px 0" }}>
              <div style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Bewässerungstage</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {IRR_WEEKDAYS.map((wd) => {
                  const on = (d.days || []).includes(wd);
                  const fieldColor = f.id === "p1" ? "#0f6e3e" : "#1d6fb8";
                  const activeStyle = on
                    ? { background: fieldColor, color: "#fff", borderColor: fieldColor, fontWeight: 600 }
                    : {};
                  return (
                    <button key={wd} disabled={!canEdit} onClick={() => toggleDay(f.id, wd)}
                      style={{ ...S.roleBtn, border: `1px solid ${C.border}`, ...activeStyle, fontSize: 12, opacity: canEdit ? 1 : 0.85 }}>
                      {wd}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "8px 0" }}>
              <label style={{ fontSize: 12, color: C.textSec }}>
                Laufzeit/Station (Min)
                <input type="number" min="1" max="99" disabled={!canEdit} value={d.runMin}
                  onChange={(e) => upd(f.id, { runMin: Number(e.target.value) })}
                  style={{ ...S.select, maxWidth: 90, marginTop: 2 }} />
              </label>
              <label style={{ fontSize: 12, color: C.textSec }}>
                Pause/Station (Sek)
                <input type="number" min="0" max="99" disabled={!canEdit} value={d.gapSec}
                  onChange={(e) => upd(f.id, { gapSec: Number(e.target.value) })}
                  style={{ ...S.select, maxWidth: 90, marginTop: 2 }} />
              </label>
            </div>

            <div style={{ margin: "8px 0" }}>
              <div style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Startzeiten der Durchgänge</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[0, 1].map((idx) => (
                  <input key={idx} type="time" disabled={!canEdit} value={(d.starts || [])[idx] || ""}
                    onChange={(e) => setStart(f.id, idx, e.target.value)}
                    style={{ ...S.select, maxWidth: 130 }} />
                ))}
              </div>
            </div>

            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, color: C.brand }}>Stationszeiten anzeigen</summary>
              <div style={{ marginTop: 6, fontSize: 12, color: C.textSec, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 4 }}>
                {windows.map((w, i) => (
                  <div key={i}>D{w.pass} · Station {w.station}: <b>{w.start}–{w.end}</b></div>
                ))}
              </div>
            </details>

            {canEdit && (
              <div style={{ marginTop: 10 }}>
                <button style={{ ...S.okBtn, opacity: hasOverlap ? 0.5 : 1, cursor: hasOverlap ? "not-allowed" : "pointer" }}
                  onClick={() => save(f.id)} disabled={hasOverlap}>
                  {f.name} speichern
                </button>
                {hasOverlap && <span style={{ fontSize: 12, color: "#991b1b", marginLeft: 8 }}>Erst Pumpen-Konflikt lösen</span>}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ ...S.card, marginTop: 14, background: "#eff6ff", border: "1px solid #bfdbfe" }}>
        <h3 style={{ margin: "0 0 6px" }}>⚽ Heimspiel-Automatik</h3>
        <p style={{ fontSize: 12, color: C.textSec, marginTop: 0 }}>
          Für angehakte Mannschaften wird vor Heimspielen automatisch die Kurzberegnung berechnet
          (pro Tag und Platz zählt der früheste Anpfiff). Beregnung endet {auto.endOffsetMin} Min vor Anpfiff.
        </p>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: C.textSec, marginBottom: 4 }}>Diese Mannschaften lösen Kurzberegnung aus:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {TEAMS.map((t) => {
              const on = auto.triggerTeams.includes(t.id);
              return (
                <button key={t.id} disabled={!canEdit} onClick={() => toggleTrigger(t.id)}
                  style={{ ...S.roleBtn, fontSize: 12, opacity: canEdit ? 1 : 0.6,
                    ...(on ? { background: t.color, color: "#fff", borderColor: t.color, fontWeight: 700, boxShadow: `0 0 0 2px ${t.color}55` } : {}) }}>
                  {on ? "✓ " : "○ "}{t.name}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: C.textSec }}>Ende vor Anpfiff (Min)
            <input type="number" min="0" max="120" disabled={!canEdit} value={auto.endOffsetMin}
              onChange={(e) => setAuto((a) => ({ ...a, endOffsetMin: Number(e.target.value) }))}
              style={{ ...S.select, maxWidth: 90, marginTop: 2 }} />
          </label>
          <label style={{ fontSize: 12, color: C.textSec }}>Laufzeit/Station (Min)
            <input type="number" min="1" max="30" disabled={!canEdit} value={auto.shortRunMin}
              onChange={(e) => setAuto((a) => ({ ...a, shortRunMin: Number(e.target.value) }))}
              style={{ ...S.select, maxWidth: 90, marginTop: 2 }} />
          </label>
          <label style={{ fontSize: 12, color: C.textSec }}>Tor-Regner Platz 1 (Nr., Komma)
            <input type="text" disabled={!canEdit} value={torP1Text}
              onChange={(e) => setTorP1Text(e.target.value)}
              placeholder="z.B. 3, 12, 7, 8"
              style={{ ...S.select, maxWidth: 160, marginTop: 2 }} />
          </label>
          <label style={{ fontSize: 12, color: C.textSec }}>Tor-Regner Platz 2 (Nr., Komma)
            <input type="text" disabled={!canEdit} value={torP2Text}
              onChange={(e) => setTorP2Text(e.target.value)}
              placeholder="z.B. 4, 9"
              style={{ ...S.select, maxWidth: 160, marginTop: 2 }} />
          </label>
        </div>

        {canEdit && <button style={S.okBtn} onClick={saveAuto}>Heimspiel-Einstellungen speichern</button>}

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Kommende Heimspiele mit Kurzberegnung</div>
          {matchPlan.length === 0 && (
            <div style={{ fontSize: 13, color: C.textSec }}>Keine anstehenden Heimspiele der ausgewählten Mannschaften.</div>
          )}
          {matchPlan.map((m, i) => {
            const d = new Date(m.date + "T12:00");
            const datum = d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
            const platz = m.field === "p1" ? "Platz 1" : m.field === "p2" ? "Platz 2" : m.field;
            const team = teamById(m.team)?.name || m.team;
            return (
              <div key={i} style={{ ...S.wishRow, flexDirection: "column", alignItems: "stretch", gap: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                  <b>{datum} · {platz}</b>
                  <span style={{ fontSize: 13, color: C.textSec }}>{team} · Anpfiff {m.kickoff}</span>
                </div>
                {m.mode === "BC" ? (
                  <div style={{ fontSize: 13 }}>
                    Programm B starten <b>{m.progB}</b> · Programm C (Tor {m.torStations.join(", ")}) starten <b>{m.progC}</b> · Ende {m.end}
                  </div>
                ) : (
                  <div style={{ fontSize: 13 }}>
                    Beregnung starten <b>{m.start}</b> · Ende {m.end}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <KickoffCalc />
    </div>
  );
}

function CalendarImport({ irrigation, saveIrrigation, canEdit, importBookings, bookings }) {
  const saved = (irrigation && irrigation._calendars) || {};
  const [cals, setCals] = useState(Array.isArray(saved.list) ? saved.list : []);
  const [newUrl, setNewUrl] = useState("");
  const [newTeam, setNewTeam] = useState(TEAMS[0]?.id || "");
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState(null);
  const [autoMsg, setAutoMsg] = useState(null);
  const autoRanRef = useRef(false);

  React.useEffect(() => {
    const s = (irrigation && irrigation._calendars) || {};
    setCals(Array.isArray(s.list) ? s.list : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irrigation?._calendars?.updatedTs]);

  React.useEffect(() => {
    if (autoRanRef.current) return;
    if (!canEdit || !importBookings) return;
    const list = (irrigation && irrigation._calendars && irrigation._calendars.list) || [];
    if (!Array.isArray(list) || list.length === 0) return;
    autoRanRef.current = true;
    (async () => {
      try {
        setAutoMsg("Heimspiele werden automatisch abgeglichen…");
        const today = dayKey(new Date());
        const all = [];
        for (const c of list) {
          try {
            const resp = await fetch("/api/bfv-ical?url=" + encodeURIComponent(c.url));
            if (!resp.ok) continue;
            const text = await resp.text();
            homeGamesFromIcs(text, today).forEach((g) => all.push({ ...g, team: c.team }));
          } catch { /* einzelnen Kalender überspringen */ }
        }
        if (all.length === 0) { setAutoMsg(null); return; }
        const newBookings = [];
        all.forEach((g) => icsGamesToBookings([g], g.team).forEach((b) => newBookings.push(b)));
        const n = await importBookings(newBookings, bookings);
        setAutoMsg(`${n} Heimspiel(e) automatisch abgeglichen.`);
        setTimeout(() => setAutoMsg(null), 4000);
      } catch {
        setAutoMsg(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irrigation?._calendars?.updatedTs, canEdit]);

  const addCal = () => {
    const u = newUrl.trim();
    if (!u) return;
    setCals((c) => [...c, { url: u, team: newTeam }]);
    setNewUrl("");
  };
  const removeCal = (i) => setCals((c) => c.filter((_, idx) => idx !== i));
  const saveCals = async () => {
    try {
      await saveIrrigation("_calendars", { list: cals });
      setMsg("Kalender gespeichert.");
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setMsg("Speichern fehlgeschlagen: " + (e.message || ""));
    }
  };

  const fetchAll = async () => {
    setLoading(true); setMsg(null);
    const today = dayKey(new Date());
    const all = [];
    try {
      for (const c of cals) {
        const resp = await fetch("/api/bfv-ical?url=" + encodeURIComponent(c.url));
        if (!resp.ok) { setMsg("Ein Kalender konnte nicht geladen werden."); continue; }
        const text = await resp.text();
        homeGamesFromIcs(text, today).forEach((g) => all.push({ ...g, team: c.team }));
      }
      all.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      setGames(all);
      if (all.length === 0) setMsg("Keine kommenden Heimspiele gefunden.");
    } catch (e) {
      setMsg("Abruf fehlgeschlagen: " + (e.message || ""));
    } finally {
      setLoading(false);
    }
  };

  const doImport = async () => {
    if (!importBookings || games.length === 0) return;
    setImporting(true); setMsg(null);
    try {
      const newBookings = [];
      games.forEach((g) => {
        icsGamesToBookings([g], g.team).forEach((b) => newBookings.push(b));
      });
      const n = await importBookings(newBookings, bookings);
      setMsg(`${n} Heimspiel(e) in den Plan eingetragen/aktualisiert.`);
    } catch (e) {
      setMsg("Eintragen fehlgeschlagen: " + (e.message || ""));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ ...S.card, marginTop: 14, background: "#f5f3ff", border: "1px solid #ddd6fe" }}>
      <h3 style={{ margin: "0 0 6px" }}>📅 Spielplan-Kalender (BFV)</h3>
      <p style={{ fontSize: 12, color: C.textSec, marginTop: 0 }}>
        BFV-Kalender-Links hinterlegen (pro Mannschaft einer). Beim Öffnen dieses Bereichs werden die
        Heimspiele automatisch abgeglichen und eingetragen. Manuell geht es jederzeit über die Knöpfe unten.
      </p>
      {autoMsg && (
        <div style={{ ...S.warnBanner, background: "#eff6ff", color: "#1e40af", border: "1px solid #bfdbfe", display: "block", marginBottom: 10 }}>
          🔄 {autoMsg}
        </div>
      )}

      {cals.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {cals.map((c, i) => (
            <div key={i} style={{ ...S.wishRow }}>
              <span style={{ fontSize: 12, wordBreak: "break-all" }}>
                <b>{teamById(c.team)?.name || c.team}</b><br />{c.url}
              </span>
              {canEdit && <button style={S.delBtn} onClick={() => removeCal(i)}>Entfernen</button>}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginBottom: 8 }}>
          <label style={{ fontSize: 12, color: C.textSec, flex: "1 1 240px" }}>BFV-Kalender-Link
            <input type="text" placeholder="https://service.bfv.de/rest/icsexport/..." value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)} style={{ ...S.select, width: "100%", marginTop: 2 }} />
          </label>
          <label style={{ fontSize: 12, color: C.textSec }}>Mannschaft
            <select value={newTeam} onChange={(e) => setNewTeam(e.target.value)} style={{ ...S.select, marginTop: 2 }}>
              {TEAMS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <button style={S.navBtn} onClick={addCal}>+ Hinzufügen</button>
        </div>
      )}

      {canEdit && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={S.okBtn} onClick={saveCals}>Kalender speichern</button>
          <button style={S.navBtn} onClick={fetchAll} disabled={loading || cals.length === 0}>
            {loading ? "Lade…" : "Heimspiele abrufen"}
          </button>
        </div>
      )}
      {msg && <div style={{ fontSize: 12, color: C.textSec, marginTop: 6 }}>{msg}</div>}

      {games.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Erkannte Heimspiele ({games.length})</div>
            {canEdit && (
              <button style={S.primaryBtn} onClick={doImport} disabled={importing}>
                {importing ? "Trage ein…" : "In Plan eintragen"}
              </button>
            )}
          </div>
          {games.map((g, i) => {
            const d = new Date(g.date + "T12:00");
            const datum = d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
            const platz = g.field === "p1" ? "Platz 1" : g.field === "p2" ? "Platz 2" : (g.field || "?");
            return (
              <div key={i} style={{ ...S.wishRow }}>
                <span style={{ fontSize: 13 }}>
                  <b>{datum} · {g.time}</b> · {platz}<br />
                  <span style={{ color: C.textSec }}>{g.home} – {g.guest} ({teamById(g.team)?.name || g.team})</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KickoffCalc() {
  const [kickoff, setKickoff] = useState("15:00");
  const [runMin, setRunMin] = useState(5);
  const [gapSec, setGapSec] = useState(5);
  const [endOffset, setEndOffset] = useState(30);
  const totalDur = passDurationSec(12, runMin, gapSec);
  const torDur = passDurationSec(4, runMin, gapSec);
  const restDur = passDurationSec(8, runMin, gapSec);
  const cCalc = kickoffToStart(kickoff, torDur, endOffset);
  const bCalc = kickoffToStart(cCalc.start, restDur, 0);

  return (
    <div style={{ ...S.card, marginTop: 14, background: "#fff7ed", border: "1px solid #fed7aa" }}>
      <h3 style={{ margin: "0 0 6px" }}>🏟 Kurzprogramm Heimspiel · Platz 1</h3>
      <p style={{ fontSize: 12, color: C.textSec, marginTop: 0 }}>
        Rechnet die Startzeiten zurück, sodass die Beregnung {endOffset} Min vor Anpfiff endet.
        Tor-Regner (3, 12, 7, 8) laufen zuletzt als Programm C, die übrigen 8 davor als Programm B.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <label style={{ fontSize: 12, color: C.textSec }}>Anpfiff
          <input type="time" value={kickoff} onChange={(e) => setKickoff(e.target.value)} style={{ ...S.select, maxWidth: 120, marginTop: 2 }} />
        </label>
        <label style={{ fontSize: 12, color: C.textSec }}>Laufzeit/Station (Min)
          <input type="number" min="1" max="30" value={runMin} onChange={(e) => setRunMin(Number(e.target.value))} style={{ ...S.select, maxWidth: 90, marginTop: 2 }} />
        </label>
        <label style={{ fontSize: 12, color: C.textSec }}>Pause (Sek)
          <input type="number" min="0" max="30" value={gapSec} onChange={(e) => setGapSec(Number(e.target.value))} style={{ ...S.select, maxWidth: 90, marginTop: 2 }} />
        </label>
        <label style={{ fontSize: 12, color: C.textSec }}>Ende vor Anpfiff (Min)
          <input type="number" min="0" max="120" value={endOffset} onChange={(e) => setEndOffset(Number(e.target.value))} style={{ ...S.select, maxWidth: 90, marginTop: 2 }} />
        </label>
      </div>
      <div style={{ marginTop: 10, fontSize: 14 }}>
        <div>▶ <b>Programm B</b> (8 Stationen, ohne Tor) starten: <b>{bCalc.start}</b></div>
        <div>▶ <b>Programm C</b> (Tor-Regner 3, 12, 7, 8) starten: <b>{cCalc.start}</b></div>
        <div style={{ color: C.textSec, marginTop: 4 }}>Ende (30 Min vor Anpfiff): {cCalc.end} · Gesamtdauer ca. {Math.round(totalDur / 60)} Min</div>
      </div>
    </div>
  );
}

/* ---------------- Mähplan (eingebettet) ---------------- */
/* ---------------- Vorstand-Bereich (nur Admin) ---------------- */
function VorstandPanel({ users, saveUser, setUserRole, setUserTeams, setUserRights, removeUser, isVorstand, changePin, irrigation, saveIrrigation, importBookings, bookings }) {
  return (
    <div style={{ ...S.card, marginTop: "1rem" }}>
      <h2 style={{ marginTop: 0, fontSize: 20, display: "flex", alignItems: "center", gap: 8 }}>
        🏛 Vorstand
      </h2>
      <p style={{ fontSize: 13, color: C.textSec, marginTop: 0 }}>
        Bereich nur für den Vorstand/Admin: Rollen und Rechte vergeben, Nutzer verwalten und die Notfall-PIN ändern.
      </p>
      <UserManager
        users={users}
        saveUser={saveUser}
        setUserRole={setUserRole}
        setUserTeams={setUserTeams}
        setUserRights={setUserRights}
        removeUser={removeUser}
        isVorstand={isVorstand}
        changePin={changePin}
      />
      <CalendarImport
        irrigation={irrigation}
        saveIrrigation={saveIrrigation}
        canEdit={isVorstand}
        importBookings={importBookings}
        bookings={bookings}
      />
      <MaehplanToggle irrigation={irrigation} saveIrrigation={saveIrrigation} />
    </div>
  );
}

function MaehplanToggle({ irrigation, saveIrrigation }) {
  const cfg = (irrigation && irrigation._maehplan) || {};
  const [enabled, setEnabled] = useState(cfg.enabled === true);
  const [msg, setMsg] = useState(null);

  React.useEffect(() => {
    const c = (irrigation && irrigation._maehplan) || {};
    setEnabled(c.enabled === true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irrigation?._maehplan?.updatedTs]);

  const save = async () => {
    try {
      await saveIrrigation("_maehplan", { enabled });
      setMsg("Gespeichert.");
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setMsg("Speichern fehlgeschlagen: " + (e.message || ""));
    }
  };

  return (
    <div style={{ ...S.card, marginTop: 14, background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
      <h3 style={{ margin: "0 0 6px" }}>🌱 Mähplan-Bereich</h3>
      <p style={{ fontSize: 12, color: C.textSec, marginTop: 0 }}>
        Wenn aktiviert, erscheint der Menüpunkt „Mähplan" für Platzwarte und Vorstand
        direkt in der Platzbelegungsapp (integriert, keine separate App mehr nötig).
      </p>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 8 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Mähplan-Bereich aktiviert
      </label>
      <button style={S.okBtn} onClick={save}>Speichern</button>
      {msg && <span style={{ fontSize: 12, color: C.textSec, marginLeft: 8 }}>{msg}</span>}
    </div>
  );
}

/* ---------------- Nutzerverwaltung (Admin) ---------------- */
function PinChanger({ changePin }) {
  const [open, setOpen] = useState(false);
  const [v1, setV1] = useState("");
  const [v2, setV2] = useState("");
  const [msg, setMsg] = useState(null);

  const save = async () => {
    setMsg(null);
    if (v1.length < 4) { setMsg({ t: "err", x: "PIN muss mindestens 4 Zeichen haben." }); return; }
    if (v1 !== v2) { setMsg({ t: "err", x: "Die beiden Eingaben stimmen nicht überein." }); return; }
    try {
      await changePin(v1);
      setMsg({ t: "ok", x: "Neue Platzwart-PIN gespeichert." });
      setV1(""); setV2("");
    } catch (e) {
      setMsg({ t: "err", x: e.message || "Speichern fehlgeschlagen." });
    }
  };

  return (
    <div style={{ background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <b style={{ fontSize: 14 }}>🔑 Notfall-PIN (Platzwart-Ebene)</b>
        <button style={S.navBtn} onClick={() => setOpen((o) => !o)}>{open ? "Schließen" : "PIN ändern"}</button>
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 12, color: C.textSec, marginTop: 0 }}>
            Die PIN gibt nur Platzwart-Rechte (keinen Admin-Zugang). Sie wirkt sofort auf allen Geräten.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <input type="password" inputMode="numeric" placeholder="Neue PIN" value={v1}
              onChange={(e) => setV1(e.target.value)} style={{ ...S.select, maxWidth: 160 }} />
            <input type="password" inputMode="numeric" placeholder="Wiederholen" value={v2}
              onChange={(e) => setV2(e.target.value)} style={{ ...S.select, maxWidth: 160 }} />
            <button style={S.okBtn} onClick={save}>Speichern</button>
          </div>
          {msg && <div style={{ marginTop: 6, fontSize: 13, color: msg.t === "ok" ? "#166534" : C.danger }}>{msg.x}</div>}
        </div>
      )}
    </div>
  );
}

const RIGHT_DEFS = [
  ["irrigation", "Beregnung ändern"],
  ["locks", "Plätze sperren"],
  ["messages", "Nachrichten an Trainer"],
  ["notes", "Tagesnotizen pflegen"],
];

function UserManager({ users, saveUser, setUserRole, setUserTeams, setUserRights, removeUser, isVorstand, changePin }) {
  const list = (users || []).slice().sort((a, b) => {
    const rank = (r) => (r === "admin" ? 0 : r === "platzwart" ? 1 : r === "trainer" ? 2 : 3);
    if (rank(a.role) !== rank(b.role)) return rank(a.role) - rank(b.role);
    return (a.name || a.email || "").localeCompare(b.name || b.email || "");
  });
  const [editId, setEditId] = useState(null);
  const [draftTeams, setDraftTeams] = useState([]);

  const startEdit = (u) => { setEditId(u.id); setDraftTeams(Array.isArray(u.teams) ? u.teams : []); };
  const toggleTeam = (tid) => setDraftTeams((d) => d.includes(tid) ? d.filter((x) => x !== tid) : [...d, tid]);
  const saveTeams = (u) => { setUserTeams(u.id, draftTeams); setEditId(null); };

  const rightOn = (u, key) => !u.rights || typeof u.rights !== "object" ? true : u.rights[key] === true;
  const toggleRight = (u, key) => {
    const base = (u.rights && typeof u.rights === "object") ? u.rights : { irrigation: true, locks: true, messages: true, notes: true };
    setUserRights(u.id, { ...base, [key]: !rightOn(u, key) });
  };

  const noRole = list.filter((u) => u.role !== "trainer" && u.role !== "platzwart" && u.role !== "admin");

  return (
    <div>
      <p style={{ fontSize: 13, color: C.textSec, marginTop: 0 }}>
        Übersicht aller angemeldeten Nutzer. Konten werden in der Firebase-Console angelegt; nach der ersten Anmeldung erscheinen sie hier automatisch. Rolle, Teams und Rechte vergibt der Admin hier.
      </p>

      {isVorstand && <PinChanger changePin={changePin} />}

      {noRole.length > 0 && (
        <div style={{ ...S.warnBanner, background: "#fff7ed", color: "#7c2d12", border: "1px solid #fed7aa", display: "block", marginBottom: 12 }}>
          {noRole.length} neue Anmeldung{noRole.length === 1 ? "" : "en"} ohne Rolle – bitte unten freischalten.
        </div>
      )}

      {list.length === 0 && <p style={{ color: C.textSec, fontSize: 14 }}>Noch keine Nutzerprofile vorhanden.</p>}

      {list.map((u) => {
        const isNew = u.role !== "trainer" && u.role !== "platzwart" && u.role !== "admin";
        const roleBg = u.role === "admin" ? "#c7d2fe" : u.role === "platzwart" ? "#fde68a" : u.role === "trainer" ? "#dbeafe" : "#fed7aa";
        const roleLabel = u.role === "admin" ? "Admin / Vorstand" : u.role === "platzwart" ? "Platzwart" : u.role === "trainer" ? "Trainer" : "neu – ohne Rolle";
        return (
          <div key={u.id} style={{ ...S.wishRow, flexDirection: "column", alignItems: "stretch", gap: 6, ...(isNew ? { background: "#fff7ed" } : {}) }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div>
                <b>{u.name || "(ohne Name)"}</b>
                <span style={{ marginLeft: 8, fontSize: 12, padding: "1px 8px", borderRadius: 10, background: roleBg, color: "#334" }}>
                  {roleLabel}
                </span>
              </div>
              <span style={{ fontSize: 13, color: C.textSec }}>{u.email || "(keine E-Mail)"}</span>
            </div>

            {isVorstand && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <span style={{ fontSize: 12, color: C.textSec, alignSelf: "center" }}>Rolle:</span>
                {["admin", "platzwart", "trainer"].map((r) => (
                  <button key={r} onClick={() => setUserRole(u.id, r)}
                    style={{ ...S.roleBtn, ...(u.role === r ? S.roleBtnActive : {}), fontSize: 12 }}>
                    {r === "admin" ? "Als Admin" : r === "platzwart" ? "Als Platzwart" : "Als Trainer"}
                  </button>
                ))}
              </div>
            )}

            {isVorstand && u.role === "platzwart" && (
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 12, color: C.textSec, marginBottom: 6 }}>Rechte dieses Platzwarts:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {RIGHT_DEFS.map(([key, label]) => {
                    const on = rightOn(u, key);
                    return (
                      <button key={key} onClick={() => toggleRight(u, key)}
                        style={{ ...S.roleBtn, ...(on ? S.roleBtnActive : {}), fontSize: 12 }}
                        title={on ? "An – klicken zum Abschalten" : "Aus – klicken zum Einschalten"}>
                        {on ? "✓ " : "○ "}{label}
                      </button>
                    );
                  })}
                </div>
                {(!u.rights || typeof u.rights !== "object") && (
                  <div style={{ fontSize: 11, color: "#92400e", marginTop: 6 }}>
                    Noch keine Rechte gesetzt – dieser Platzwart hat aktuell alle vier (Altbestand). Sobald du einen Schalter änderst, gilt nur noch die Auswahl.
                  </div>
                )}
              </div>
            )}

            {isNew && isVorstand && (
              <div>
                <button style={S.okBtn} onClick={() => setUserRole(u.id, "trainer")}>Als Trainer freischalten</button>
              </div>
            )}

            {u.role === "trainer" && (
              <div style={{ fontSize: 13 }}>
                {editId === u.id ? (
                  <div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0" }}>
                      {TEAMS.map((t) => {
                        const on = draftTeams.includes(t.id);
                        return (
                          <button key={t.id} onClick={() => toggleTeam(t.id)}
                            style={{ ...S.roleBtn, fontSize: 12,
                              ...(on ? { background: t.color, color: "#fff", borderColor: t.color, fontWeight: 700, boxShadow: `0 0 0 2px ${t.color}55` } : {}) }}>
                            {on ? "✓ " : ""}{t.name}
                          </button>
                        );
                      })}
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
  const [mode, setMode] = useState("single");
  const [date, setDate] = useState(dayKey(days[0]));
  const [weekday, setWeekday] = useState(1);
  const [seriesFrom, setSeriesFrom] = useState(dayKey(days[0]));
  const [seriesTo, setSeriesTo] = useState(dayKey(addDays(days[0], 84)));
  const [team, setTeam] = useState("u15");
  const matchLike = kind === "match" || kind === "turnier";
  const [field, setField] = useState(matchLike ? "p1" : "p2");
  const [zone, setZone] = useState("v1");
  const [start, setStart] = useState(matchLike ? "15:00" : "17:00");
  const [end, setEnd] = useState(matchLike ? "17:00" : "18:30");
  const [opponent, setOpponent] = useState("");
  const [warmupField, setWarmupField] = useState("");

  // Automatischer Aufwärm-Vorschlag für Heimspiele:
  // • Platz 2 → immer Platz 3 vorschlagen
  // • Platz 1 → Platz 2 vorschlagen, wenn ein anderes Heimspiel an demselben Tag
  //   auf Platz 1 existiert, dessen Ende maximal 45 Min vor dem neuen Anpfiff liegt.
  const toMin = (t) => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + m; };
  React.useEffect(() => {
    if (kind !== "match") return;
    if (field === "p2") { setWarmupField("p3"); return; }
    if (field === "p1" && start) {
      const newStart = toMin(start);
      const clashes = (bookingsByDay[date] || []).filter((b) =>
        b.field === "p1" && b.kind === "match" && b.status !== "beantragt" &&
        b.start !== start && // nicht dasselbe Spiel
        toMin(b.end) <= newStart && newStart - toMin(b.end) <= 45
      );
      setWarmupField(clashes.length > 0 ? "p2" : "");
      return;
    }
    setWarmupField("");
  }, [kind, field, date, start]); // eslint-disable-line react-hooks/exhaustive-deps

  const zones = fieldById(field).zones;
  const safeZone = zones.find((z) => z.id === zone) ? zone : zones[0].id;
  const timeInvalid = !(start < end);

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
    const grp = (kind === "match" && warmupField && warmupField !== field)
      ? `mg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` : null;
    if (grp) entry.matchGroup = grp;

    const warmup = warmupBlockFor({ ...entry, id: "__neu__" });
    if (warmup && grp) warmup.matchGroup = grp;

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
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      if (mode === "series") addSeries();
      else addSingle();
    } finally {
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
          <Field label={warmupField && warmupField !== field ? "Aufwärmen auf (automatisch vorgeschlagen)" : "Aufwärmen auf"}>
            <select value={warmupField} onChange={(e) => setWarmupField(e.target.value)} style={{ ...S.select, ...(warmupField && warmupField !== field ? { borderColor: "#0891b2", fontWeight: 500 } : {}) }}>
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
        const dayEntriesAll = [
          ...autoTrainingForDay(new Date(date + "T12:00")),
          ...((bookingsByDay[date] || []).filter((b) => b.status !== "beantragt")),
        ];
        let warmupClash = [];
        if (wb) {
          warmupClash = findConflicts({ ...wb, id: "__wmcheck__" }, dayEntriesAll);
        }
        let suggestion = null;
        if (warmupClash.length > 0) {
          for (const f of FIELDS) {
            if (f.id === field) continue;
            const probe = warmupBlockFor({ kind, date, field, start, end, team, warmupField: f.id });
            if (probe && findConflicts({ ...probe, id: "__probe__" }, dayEntriesAll).length === 0) {
              suggestion = f; break;
            }
          }
        }
        return (
          <>
            <div style={{ ...S.warnBanner, background: "var(--c-info-bg, #eef4ff)", color: "#234", border: "1px solid #b9cdf0" }}>
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
        <div style={{ ...S.warnBanner, background: "var(--c-info-bg, #eef4ff)", color: "#234", border: "1px solid #b9cdf0" }}>
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
  const [moveTarget, setMoveTarget] = useState(null);
  const todayKey = dayKey(new Date());
  const pending = bookings
    .filter((b) => b.status === "beantragt" && b.date >= todayKey)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const stale = bookings
    .filter((b) => b.status === "beantragt" && b.date < todayKey)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

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

/* ---------------- Freie Zeiten finden (Trainer) ---------------- */
// Rahmenzeiten: Sa/So ab 09:00, sonst ab 15:00; Ende immer 22:00.
const SLOT_FRAME = { weekendStartH: 9, weekdayStartH: 15, endH: 22 };

// Teilen zwei Zonen desselben Platzes eine atomare Fläche? (nutzt zoneCovers)
function zonesShareArea(field, zoneA, zoneB) {
  if (field === "p1") return true;
  if (zoneA === zoneB) return true;
  const ATOMIC = { p2: ["v1", "v2", "v3", "v4"], p3: ["h1", "h2"], p1: ["voll"] };
  const f = fieldById(field);
  const units = ATOMIC[field] || (f ? f.zones.map((z) => z.id) : []);
  const ua = units.filter((u) => zoneCovers(zoneA, u));
  const ub = units.filter((u) => zoneCovers(zoneB, u));
  return ua.some((u) => ub.includes(u));
}

function FreeSlotFinder({ bookings }) {
  const toMin = (t) => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + m; };
  const minToTime = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const todayK = dayKey(new Date());

  const [from, setFrom] = useState(todayK);
  const [to, setTo] = useState(dayKey(addDays(new Date(), 6)));
  const [field, setField] = useState("p2");
  const [zone, setZone] = useState("p2_voll");
  const [minLen, setMinLen] = useState(60);

  const zones = fieldById(field).zones;
  const safeZone = zones.find((z) => z.id === zone) ? zone : zones[0].id;
  const rangeInvalid = !(from <= to);

  const frameFor = (dateKey) => {
    const d = new Date(dateKey + "T12:00");
    const wd = (d.getDay() + 6) % 7;
    const startH = (wd === 5 || wd === 6) ? SLOT_FRAME.weekendStartH : SLOT_FRAME.weekdayStartH;
    return { start: startH * 60, end: SLOT_FRAME.endH * 60 };
  };

  const span = (e) => {
    const s = effectiveSpan(e);
    return { s: toMin(s.start), e: toMin(s.end) };
  };

  const gapsForDay = (dateKey) => {
    const frame = frameFor(dateKey);
    const blocks = (bookings || [])
      .filter((b) => b.date === dateKey && b.field === field && b.status !== "beantragt")
      .filter((b) => zonesShareArea(field, safeZone, b.zone))
      .map(span)
      .map((s) => ({ s: Math.max(frame.start, s.s), e: Math.min(frame.end, s.e) }))
      .filter((s) => s.e > s.s)
      .sort((a, b) => a.s - b.s);
    const merged = [];
    for (const b of blocks) {
      if (merged.length && b.s <= merged[merged.length - 1].e)
        merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, b.e);
      else merged.push({ ...b });
    }
    const out = [];
    let cur = frame.start;
    for (const m of merged) {
      if (m.s > cur) out.push({ start: cur, end: m.s });
      cur = Math.max(cur, m.e);
    }
    if (cur < frame.end) out.push({ start: cur, end: frame.end });
    return out.filter((g) => g.end - g.start >= minLen);
  };

  // Maximal 60 Tage durchsuchen (Schutz gegen versehentlich riesige Zeiträume)
  const days = (() => {
    if (rangeInvalid) return [];
    const out = [];
    let cur = new Date(from + "T12:00");
    const end = new Date(to + "T12:00");
    let guard = 0;
    while (cur <= end && guard < 60) {
      out.push(dayKey(cur));
      cur = addDays(cur, 1);
      guard++;
    }
    return out;
  })();

  const dayResults = days.map((dk) => ({ date: dk, gaps: gapsForDay(dk) })).filter((r) => r.gaps.length > 0);
  const tooLong = !rangeInvalid && (() => {
    const cur = new Date(from + "T12:00");
    const end = new Date(to + "T12:00");
    return Math.round((end - cur) / 86400000) >= 60;
  })();

  const zoneLabel = zones.find((z) => z.id === safeZone)?.label || safeZone;

  return (
    <div>
      <p style={{ fontSize: 14, color: C.textSec, marginTop: 0 }}>
        Finde freie Zeitfenster in einem Zeitraum. Wähle Platz, Bereich, sowie Von- und Bis-Datum –
        die Lücken berücksichtigen alle Belegungen, die denselben Platzbereich betreffen
        (z. B. ist ein Viertel belegt, wenn die ganze Hälfte gebucht ist).
        Rahmenzeiten: Sa/So ab 09:00, sonst ab 15:00, bis 22:00.
      </p>

      <div style={S.formGrid}>
        <Field label="Von"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={S.select} /></Field>
        <Field label="Bis"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={S.select} /></Field>
        <Field label="Platz">
          <select value={field} onChange={(e) => { setField(e.target.value); setZone(fieldById(e.target.value).zones[0].id); }} style={S.select}>
            {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        <Field label="Bereich / Zone">
          <select value={safeZone} onChange={(e) => setZone(e.target.value)} style={S.select}>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
          </select>
        </Field>
        <Field label="Mindestdauer">
          <select value={minLen} onChange={(e) => setMinLen(Number(e.target.value))} style={S.select}>
            <option value={30}>30 Minuten</option>
            <option value={60}>1 Stunde</option>
            <option value={90}>1,5 Stunden</option>
            <option value={120}>2 Stunden</option>
          </select>
        </Field>
      </div>

      {rangeInvalid && <div style={S.warnBanner}>⚠️ Das Bis-Datum muss nach dem Von-Datum liegen.</div>}
      {tooLong && <div style={S.warnBanner}>⚠️ Der Zeitraum ist zu lang – es werden maximal 60 Tage durchsucht.</div>}

      {!rangeInvalid && (
        <div style={{ ...S.subHead, marginTop: 8 }}>
          Freie Zeiten {fieldById(field).name} · {zoneLabel}
        </div>
      )}

      {!rangeInvalid && dayResults.length === 0 && (
        <div style={{ ...S.warnBanner, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", display: "block" }}>
          Keine freien Fenster von mindestens {minLen} Minuten im gewählten Zeitraum.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {dayResults.map(({ date, gaps }) => {
          const d = new Date(date + "T12:00");
          return (
            <div key={date}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
                {WEEKDAYS_LONG[(d.getDay() + 6) % 7]}, {d.getDate()}.{d.getMonth() + 1}.{d.getFullYear()}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {gaps.map((g, i) => {
                  const len = g.end - g.start;
                  const h = Math.floor(len / 60), m = len % 60;
                  const lenTxt = (h ? `${h} Std ` : "") + (m ? `${m} Min` : (h ? "" : "0 Min"));
                  return (
                    <div key={i} style={{ ...S.listRow, borderLeft: `4px solid ${C.ok}`, paddingLeft: 10 }}>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{minToTime(g.start)} – {minToTime(g.end)}</span>
                      <span style={{ fontSize: 13, color: C.textSec }}>frei · {lenTxt.trim()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
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
        {[["eintragen", "Trainingstag eintragen"], ["frei", "Freie Zeiten"], ["nachricht", "Nachricht an Platzwart"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...S.tab, ...(tab === k ? S.tabActive : {}) }}>{l}</button>
        ))}
      </div>
      {tab === "eintragen" && <TrainerBookingForm trainerTeam={trainerTeam} bookings={bookings} bookingsByDay={bookingsByDay} addBooking={addBooking} addBookingSeries={addBookingSeries} entriesForDay={entriesForDay} />}
      {tab === "frei" && <FreeSlotFinder bookings={bookings} />}
      {tab === "nachricht" && <MessageForm trainerTeam={trainerTeam} addMessage={addMessage} messages={messages} myUid={myUid} myTeams={myTeams} />}
    </div>
  );
}

function TrainerBookingForm({ trainerTeam, bookings, bookingsByDay, addBooking, addBookingSeries, entriesForDay }) {
  const [mode, setMode] = useState("single");
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
        <div style={{ ...S.warnBanner, background: "var(--c-info-bg, #eef4ff)", color: "#234", border: "1px solid #b9cdf0" }}>
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
  const incoming = messages
    .filter((m) => m.dir === "out" && (m.toAll || (m.recipientUid && m.recipientUid === myUid) || (m.team && teams.includes(m.team))))
    .slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 8);
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
            <div key={m.id} style={{ ...S.warnBanner, background: "var(--c-info-bg, #eef4ff)", color: "#234", border: "1px solid #b9cdf0", display: "block" }}>
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

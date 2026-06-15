# SV Dörfleins – Platzbelegung

Web-App zur Platzbelegung mit Wochenansicht, Fußballfeld-Visualisierung,
Trainerwünschen und Platzwart-Verwaltung. Frontend: React + Vite. Backend:
Firebase (Firestore + Auth). Hosting: Netlify.

Alle Daten (Belegungen, Wünsche, Trainingstage, Sperren) liegen in Firestore
und werden in Echtzeit auf allen Geräten synchron gehalten.

---

## Funktionen

- Wochenansicht über das ganze Jahr (vor/zurück blättern, „Heute")
- Drei Plätze: Platz 1 (ganz), Platz 2 (4 Viertel: Oberhaid / Hallstadt),
  Platz 3 (2 Hälften)
- Automatik: 1./2. Mannschaft Di & Do 18:30–21:00 auf Platz 2, je 2 Viertel
  (halber Platz), wöchentlicher Wechsel zwischen Oberhaid und Hallstadt
- 15 Mannschaften mit klar unterscheidbaren Farben
- Fußballfeld-Visualisierung für Platz 1/2/3 mit eingetragenen Mannschaften
- Trainer (ohne Login): Trainingstage melden und Wünsche äußern; Konflikte
  werden sofort angezeigt
- Platzwart (Passwort): Belegungen, Heimspiele, Sperren eintragen, Wünsche
  annehmen/ablehnen, Trainingstage löschen
- Doppelbelegungs-Warnung überall + Hinweiszähler für den Platzwart

---

## 1. Voraussetzungen

- Node.js 20+ (https://nodejs.org)
- Ein Google-Konto (für Firebase)
- Ein Netlify-Konto (kostenlos, https://netlify.com)

---

## 2. Firebase einrichten

1. Auf https://console.firebase.google.com ein neues Projekt anlegen
   (z. B. „svd-platzbelegung"). Google Analytics ist nicht nötig.
2. Links **Build → Firestore Database** öffnen → **Datenbank erstellen** →
   im **Produktionsmodus** starten, Region z. B. `eur3 (europe-west)`.
3. Links **Build → Authentication → Sign-in method** öffnen →
   **Anonym** aktivieren.
4. Oben im Projekt das **Web-Symbol `</>`** klicken, App registrieren
   (Name beliebig, „Firebase Hosting" NICHT ankreuzen). Es erscheint ein
   `firebaseConfig`-Block mit `apiKey`, `authDomain`, `projectId` usw.
   Diese Werte werden gleich gebraucht.

### Sicherheitsregeln hochladen

Die Datei `firestore.rules` enthält die Regeln. Entweder:

- **Einfach:** In der Firebase-Konsole unter **Firestore → Regeln** den Inhalt
  von `firestore.rules` einfügen und veröffentlichen, oder
- **Per CLI:** `npm i -g firebase-tools`, dann `firebase login` und
  `firebase deploy --only firestore:rules` (firebase.json liegt bei).

---

## 3. Lokal starten (optional, zum Testen)

```bash
cd svd-app
npm install
cp .env.example .env      # dann .env mit deinen Firebase-Werten füllen
npm run dev
```

Die App läuft auf http://localhost:5173.

---

## 4. Auf Netlify veröffentlichen

### Variante A – über GitHub (empfohlen)

1. Den Ordner `svd-app` in ein GitHub-Repository legen (push).
2. In Netlify **Add new site → Import an existing project** → GitHub →
   das Repo wählen. Build-Einstellungen werden aus `netlify.toml` erkannt
   (Build: `npm run build`, Publish: `dist`).
3. Unter **Site settings → Environment variables** alle Schlüssel aus
   `.env.example` mit euren echten Werten anlegen (inkl.
   `VITE_ADMIN_PASSWORD`).
4. **Deploy** auslösen. Nach ein paar Minuten ist die App online.

### Variante B – ohne GitHub (per CLI)

```bash
npm i -g netlify-cli
cd svd-app
npm install
npm run build
netlify deploy --prod
```

Beim ersten Mal nach Site und Publish-Verzeichnis (`dist`) fragen lassen.
Die Umgebungsvariablen vorher in `.env` setzen oder im Netlify-Dashboard.

---

## 5. Platzwart-Zugang

Oben rechts auf **Platzwart** klicken → Passwort eingeben. Das Passwort steht in
`VITE_ADMIN_PASSWORD` (Standard `1901`, unbedingt ändern). Der Platzwart bleibt
für die Browser-Sitzung angemeldet; **Platzwart abmelden** beendet sie.

Der Platzwart sieht oben einen Hinweis, wenn es in der aktuellen Woche
Doppelbelegungen oder offene Trainerwünsche gibt; der Zähler am Platzwart-Knopf
zeigt die Gesamtzahl.

---

## 6. Härtere Sicherheit (optional)

Das Frontend-Passwort hält Gelegenheitszugriffe ab, ist aber kein echter
Schutz auf Datenebene – technisch könnte ein angemeldeter Nutzer die
Firestore-Schreib-API direkt ansprechen. Für echten Schutz:

1. In Firebase Auth ein **E-Mail/Passwort-Konto** für den Platzwart anlegen.
2. Diesem Konto per Platzwart-SDK einen **Custom Claim** `admin: true` geben
   (kleines Node-Skript mit `firebase-admin`, Beispiel auf Anfrage).
3. In `firestore.rules` auf **Stufe B** umstellen (die mit `/* B */`
   markierten Zeilen aktivieren, die Stufe-A-Zeilen entfernen).
4. Im Frontend `src/lib/auth.js` auf `signInWithEmailAndPassword` umstellen.

Sag Bescheid, dann liefere ich die fertige Stufe-B-Variante.

---

## Projektstruktur

```
svd-app/
├─ index.html
├─ package.json
├─ vite.config.js
├─ netlify.toml          Netlify Build + SPA-Routing
├─ firebase.json         Firestore-Deploy
├─ firestore.rules       Sicherheitsregeln
├─ .env.example          Vorlage für Umgebungsvariablen
└─ src/
   ├─ main.jsx
   ├─ App.jsx            Haupt-App (Rollen, Wochen-/Platzansicht, Panels)
   ├─ index.css
   ├─ components/
   │  └─ Pitch.jsx       SVG-Fußballfeld
   └─ lib/
      ├─ firebase.js     Firebase-Init
      ├─ auth.js         Anonyme Anmeldung + Platzwart-Passwort
      ├─ data.js         Firestore-Echtzeit-Hooks
      ├─ domain.js       Teams, Plätze, Datumslogik, Konflikterkennung
      └─ styles.js       Farb- und Style-Tokens
```

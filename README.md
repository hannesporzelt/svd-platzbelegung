# Update einspielen

Alle Dateien hier haben genau den Pfad, den sie auch in deinem Repo `svd-platzbelegung` haben. Einfach überschreiben bzw. neu einfügen:

```
svd-platzbelegung/
├── index.html            ← ÜBERSCHREIBEN (Manifest + Apple-Icon-Verweis ergänzt)
├── src/
│   ├── App.jsx            ← ÜBERSCHREIBEN (Wischen, Textsuche, Gegner-Anzeige, Mähplan-Symbole im Wochen-PDF, Bugfixes)
│   └── main.jsx            ← ÜBERSCHREIBEN (Service-Worker-Registrierung ergänzt)
└── public/
    ├── manifest.json       ← NEU
    ├── sw.js                ← NEU
    └── icons/
        ├── icon-192.png     ← NEU
        ├── icon-512.png     ← NEU
        └── apple-touch-icon.png ← NEU (aus eurem echten Vereinslogo erzeugt)
```

Alles andere in deinem Repo (`domain.js`, `firestore.rules`, `src/components/`, `src/lib/`, usw.) bleibt unverändert – hier ist nichts davon enthalten, weil nichts davon angefasst wurde.

## Was neu ist gegenüber deinem hochgeladenen Stand

- **Mobile Wochen- und Monatsansicht:** jetzt zusätzlich per Wisch-Geste (links/rechts) navigierbar, nicht nur über die Pfeil-Buttons
- **Textsuche:** neues Suchfeld oberhalb des Kalenders – Mannschaft/Gegner eintippen, springt zum nächsten passenden Termin
- **App installierbar (PWA):** eigenes Icon auf dem Handy-Startbildschirm, startet ohne Browserleiste

(Alles andere – Gegner-Anzeige, Mähplan-Symbole im Wochen-PDF, der Vorstand-Bugfix, die Schnellzugriff-Navigation – war schon in der Datei enthalten, die du hochgeladen hast, und ist unverändert übernommen.)

## Nach dem Einspielen

Commit, Push – Vercel deployt automatisch. Danach auf dem Handy testen:
- **iPhone (Safari):** Teilen-Symbol → „Zum Home-Bildschirm"
- **Android (Chrome):** Menü (⋮) → „App installieren"

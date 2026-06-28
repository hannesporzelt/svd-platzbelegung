// Vercel Serverless Function: holt einen BFV-iCal-Spielplan und gibt ihn als
// Text zurück. Nötig, weil der Browser den BFV-Server nicht direkt laden darf
// (CORS/robots). Aufruf aus der App: /api/bfv-ical?url=<encodeURIComponent(link)>
//
// Sicherheit: es werden nur URLs von service.bfv.de bzw. service-prod.bfv.de
// zugelassen, damit die Funktion nicht als offener Proxy missbraucht wird.

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Parameter 'url' fehlt." });
    return;
  }

  let target;
  try {
    target = new URL(url);
  } catch {
    res.status(400).json({ error: "Ungültige URL." });
    return;
  }

  const allowedHosts = ["service.bfv.de", "service-prod.bfv.de"];
  if (!allowedHosts.includes(target.hostname)) {
    res.status(403).json({ error: "Nur BFV-Kalender-Links sind erlaubt." });
    return;
  }

  try {
    const r = await fetch(target.toString(), {
      headers: { "User-Agent": "SVD-Platzbelegung/1.0", Accept: "text/calendar, text/plain, */*" },
    });
    if (!r.ok) {
      res.status(502).json({ error: `BFV antwortete mit Status ${r.status}.` });
      return;
    }
    const text = await r.text();
    // kurz cachen, damit nicht jeder Seitenaufruf den BFV trifft
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(text);
  } catch (e) {
    res.status(502).json({ error: "Abruf fehlgeschlagen: " + (e.message || "") });
  }
}

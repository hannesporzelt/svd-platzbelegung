import React from "react";
import { teamById } from "../lib/domain";

export default function Pitch({ field, zoneOccupants }) {
  const W = 640, H = 360, pad = 10;
  const innerW = W - pad * 2, innerH = H - pad * 2;
  const grass = "#2f8f57";
  const line = "#ffffff";

  const ZoneLabel = ({ x, y, w, h, zoneId, label }) => {
    const occ = zoneOccupants(zoneId);
    const cx = x + w / 2, cy = y + h / 2;
    const shown = occ.slice(0, 3);
    return (
      <g>
        <text x={x + 8} y={y + 18} fill="rgba(255,255,255,.85)" fontSize="12" fontWeight="500">{label}</text>
        {occ.length === 0 ? (
          <text x={cx} y={cy} fill="rgba(255,255,255,.6)" fontSize="13" textAnchor="middle">frei</text>
        ) : (
          shown.map((e, i) => {
            const t = teamById(e.team);
            return (
              <g key={e.id} transform={`translate(${cx}, ${cy + (i - (shown.length - 1) / 2) * 26})`}>
                <rect x={-78} y={-11} width={156} height={22} rx={5} fill={t ? t.color : "#444"} opacity="0.92" />
                <text x={0} y={4} fill="#fff" fontSize="12" fontWeight="500" textAnchor="middle">
                  {(t ? t.name : e.team)} · {e.start}
                </text>
              </g>
            );
          })
        )}
      </g>
    );
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", borderRadius: 12 }}>
      <rect x="0" y="0" width={W} height={H} fill={grass} />
      {Array.from({ length: 8 }).map((_, i) => (
        <rect key={i} x={pad + (innerW / 8) * i} y={pad} width={innerW / 8} height={innerH}
          fill={i % 2 ? "#2b8551" : "#318f59"} />
      ))}
      <rect x={pad} y={pad} width={innerW} height={innerH} fill="none" stroke={line} strokeWidth="2" />
      <line x1={W / 2} y1={pad} x2={W / 2} y2={H - pad} stroke={line} strokeWidth="2" />
      <circle cx={W / 2} cy={H / 2} r="42" fill="none" stroke={line} strokeWidth="2" />
      <circle cx={W / 2} cy={H / 2} r="3" fill={line} />
      <rect x={pad} y={H / 2 - 55} width="46" height="110" fill="none" stroke={line} strokeWidth="2" />
      <rect x={W - pad - 46} y={H / 2 - 55} width="46" height="110" fill="none" stroke={line} strokeWidth="2" />

      {field === "p2" && (
        <>
          <line x1={pad} y1={H / 2} x2={W - pad} y2={H / 2} stroke="rgba(255,255,255,.55)" strokeWidth="2" strokeDasharray="8 6" />
          <ZoneLabel x={pad} y={pad} w={innerW / 2} h={innerH / 2} zoneId="v3" label="Viertel 3 · Hallstadt" />
          <ZoneLabel x={W / 2} y={pad} w={innerW / 2} h={innerH / 2} zoneId="v1" label="Viertel 1 · Oberhaid" />
          <ZoneLabel x={pad} y={H / 2} w={innerW / 2} h={innerH / 2} zoneId="v4" label="Viertel 4 · Hallstadt" />
          <ZoneLabel x={W / 2} y={H / 2} w={innerW / 2} h={innerH / 2} zoneId="v2" label="Viertel 2 · Oberhaid" />
        </>
      )}
      {field === "p3" && (
        <>
          <ZoneLabel x={pad} y={pad} w={innerW / 2} h={innerH} zoneId="h1" label="Hälfte 1" />
          <ZoneLabel x={W / 2} y={pad} w={innerW / 2} h={innerH} zoneId="h2" label="Bahndamm" />
        </>
      )}
      {field === "p1" && (
        <ZoneLabel x={pad} y={pad} w={innerW} h={innerH} zoneId="voll" label="Platz 1 · ganzer Platz" />
      )}
    </svg>
  );
}

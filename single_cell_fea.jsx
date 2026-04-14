import { useState, useRef, useEffect, useCallback } from "react";

const UI = {
  bg:"#060a16",panel:"#0c1222",border:"#172040",
  accent:"#00e5ff",accentD:"#007a8a",text:"#d0daea",dim:"#3e506e",
  danger:"#ff2e50",warn:"#ffb020",success:"#00e676",purple:"#b388ff",
};

// ─── Mesh generation: triangulated disk ───
function generateCellMesh(cx, cy, radius, rings, sectors) {
  const nodes = []; // {x, y, x0, y0, vx, vy, fixed, boundary, fx, fy}
  const tris = [];  // [i, j, k]
  const edges = []; // [i, j, restLen]
  const edgeSet = new Set();

  // Center node
  nodes.push({ x: cx, y: cy, x0: cx, y0: cy, vx: 0, vy: 0, fixed: false, boundary: false, fx: 0, fy: 0 });

  // Concentric rings
  for (let r = 1; r <= rings; r++) {
    const rad = (r / rings) * radius;
    const nSec = Math.max(8, Math.round(sectors * (r / rings)));
    for (let s = 0; s < nSec; s++) {
      const angle = (s / nSec) * Math.PI * 2;
      const x = cx + Math.cos(angle) * rad;
      const y = cy + Math.sin(angle) * rad;
      nodes.push({ x, y, x0: x, y0: y, vx: 0, vy: 0, fixed: false, boundary: r === rings, fx: 0, fy: 0 });
    }
  }

  // Build triangles: center to first ring
  const firstRingStart = 1;
  const firstRingCount = Math.max(8, Math.round(sectors * (1 / rings)));
  for (let s = 0; s < firstRingCount; s++) {
    const a = 0; // center
    const b = firstRingStart + s;
    const c = firstRingStart + (s + 1) % firstRingCount;
    tris.push([a, b, c]);
  }

  // Build triangles between consecutive rings
  let prevStart = 1;
  let prevCount = firstRingCount;
  for (let r = 2; r <= rings; r++) {
    const curCount = Math.max(8, Math.round(sectors * (r / rings)));
    const curStart = prevStart + prevCount;

    // Connect prevRing to curRing
    let pi = 0, ci = 0;
    while (pi < prevCount || ci < curCount) {
      const pa = prevStart + pi % prevCount;
      const pb = prevStart + (pi + 1) % prevCount;
      const ca = curStart + ci % curCount;
      const cb = curStart + (ci + 1) % curCount;

      if (pi < prevCount && (ci >= curCount || (pi / prevCount) <= (ci / curCount))) {
        tris.push([pa, cb, ca]);
        tris.push([pa, pb, cb]);
        pi++;
      } else {
        tris.push([ca, pa, cb]);
        ci++;
      }
      if (pi >= prevCount && ci >= curCount) break;
    }

    prevStart = curStart;
    prevCount = curCount;
  }

  // Extract unique edges from triangles
  function addEdge(a, b) {
    const key = Math.min(a, b) + "-" + Math.max(a, b);
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    const dx = nodes[a].x - nodes[b].x;
    const dy = nodes[a].y - nodes[b].y;
    edges.push([a, b, Math.sqrt(dx * dx + dy * dy)]);
  }
  for (const [a, b, c] of tris) { addEdge(a, b); addEdge(b, c); addEdge(a, c); }

  return { nodes, tris, edges };
}

// ─── Stress calculation for a triangle ───
function triStress(nodes, tri, E, nu) {
  const [ai, bi, ci] = tri;
  const a = nodes[ai], b = nodes[bi], c = nodes[ci];
  // Reference (undeformed)
  const X1 = a.x0, Y1 = a.y0, X2 = b.x0, Y2 = b.y0, X3 = c.x0, Y3 = c.y0;
  // Current (deformed)
  const x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y, x3 = c.x, y3 = c.y;

  // Area of reference triangle
  const A0 = 0.5 * ((X2 - X1) * (Y3 - Y1) - (X3 - X1) * (Y2 - Y1));
  if (Math.abs(A0) < 1e-10) return { vonMises: 0, pressure: 0, area: 0, maxPrincipal: 0 };

  // Deformation gradient F
  const dX = [[X2 - X1, X3 - X1], [Y2 - Y1, Y3 - Y1]];
  const dx2 = [[x2 - x1, x3 - x1], [y2 - y1, y3 - y1]];

  const det0 = dX[0][0] * dX[1][1] - dX[0][1] * dX[1][0];
  if (Math.abs(det0) < 1e-10) return { vonMises: 0, pressure: 0, area: 0, maxPrincipal: 0 };

  const inv0 = [[dX[1][1] / det0, -dX[0][1] / det0], [-dX[1][0] / det0, dX[0][0] / det0]];
  const F = [
    [dx2[0][0] * inv0[0][0] + dx2[0][1] * inv0[1][0], dx2[0][0] * inv0[0][1] + dx2[0][1] * inv0[1][1]],
    [dx2[1][0] * inv0[0][0] + dx2[1][1] * inv0[1][0], dx2[1][0] * inv0[0][1] + dx2[1][1] * inv0[1][1]]
  ];

  // Green-Lagrange strain: E = 0.5*(F^T*F - I)
  const exx = 0.5 * (F[0][0] * F[0][0] + F[1][0] * F[1][0] - 1);
  const eyy = 0.5 * (F[0][1] * F[0][1] + F[1][1] * F[1][1] - 1);
  const exy = 0.5 * (F[0][0] * F[0][1] + F[1][0] * F[1][1]);

  // Plane stress: sigma = D * epsilon
  const factor = E / (1 - nu * nu);
  const sxx = factor * (exx + nu * eyy);
  const syy = factor * (eyy + nu * exx);
  const sxy = factor * (1 - nu) / 2 * exy * 2;

  // Von Mises
  const vm = Math.sqrt(sxx * sxx + syy * syy - sxx * syy + 3 * sxy * sxy);
  // Pressure (hydrostatic)
  const press = -(sxx + syy) / 2;
  // Max principal
  const avg = (sxx + syy) / 2;
  const R = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
  const maxP = avg + R;

  // Current area
  const A1 = 0.5 * ((x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1));

  return { vonMises: vm, pressure: press, area: A1, maxPrincipal: maxP, strain: Math.sqrt(exx*exx + eyy*eyy + 2*exy*exy) };
}

// ─── Color maps ───
function stressColor(t) {
  t = Math.min(Math.max(t, 0), 1);
  if (t < 0.2) return lerpRGB([20, 60, 140], [30, 160, 200], t / 0.2);
  if (t < 0.4) return lerpRGB([30, 160, 200], [50, 210, 100], (t - 0.2) / 0.2);
  if (t < 0.6) return lerpRGB([50, 210, 100], [220, 200, 40], (t - 0.4) / 0.2);
  if (t < 0.8) return lerpRGB([220, 200, 40], [240, 100, 30], (t - 0.6) / 0.2);
  return lerpRGB([240, 100, 30], [255, 30, 60], (t - 0.8) / 0.2);
}
function lerpRGB(a, b, t) {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

function Sl({ label, value, min, max, step, onChange, unit, color }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: UI.dim, marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ color: color || UI.accent, fontFamily: "monospace" }}>
          {value >= 1000 ? (value / 1000).toFixed(1) + "k" : step >= 1 ? value : value.toFixed(step < 0.1 ? 3 : 2)}{unit ? ` ${unit}` : ""}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", height: 3, appearance: "none", background: `linear-gradient(to right,${color || UI.accent} ${pct}%,${UI.border} ${pct}%)`, borderRadius: 2, outline: "none", cursor: "pointer" }} />
    </div>
  );
}

function pL(p) { if (Math.abs(p) < 100) return p.toFixed(1) + " Pa"; if (Math.abs(p) < 1e5) return (p / 1e3).toFixed(1) + " kPa"; return (p / 1e6).toFixed(2) + " MPa"; }

export default function SingleCellFEA() {
  const canvasRef = useRef(null);
  const meshRef = useRef(null);
  const animRef = useRef(null);
  const dragRef = useRef(null);

  const [W] = useState(700);
  const [H] = useState(620);
  const cx = W / 2, cy = H / 2, radius = 180;

  const [elasticMod, setElasticMod] = useState(800);
  const [poissonR, setPoissonR] = useState(0.45);
  const [memStrength, setMemStrength] = useState(3000);
  const [internalP, setInternalP] = useState(30);
  const [springK, setSpringK] = useState(200);
  const [damping, setDamping] = useState(0.88);
  const [meshRings, setMeshRings] = useState(8);
  const [meshSectors, setMeshSectors] = useState(32);
  const [tool, setTool] = useState("push"); // push, pull, pin, plate-h, plate-v
  const [forceMultiplier, setForceMultiplier] = useState(5);
  const [viewMode, setViewMode] = useState("vonMises"); // vonMises, pressure, strain, displacement
  const [stressScale, setStressScale] = useState(2000);
  const [showMesh, setShowMesh] = useState(true);
  const [showNodes, setShowNodes] = useState(false);
  const [running, setRunning] = useState(true);
  const [stats, setStats] = useState({ maxVM: 0, avgVM: 0, maxDisp: 0, ruptured: 0, integrity: 100 });

  // Plate state
  const [plateH, setPlateH] = useState({ active: false, y1: cy - radius - 40, y2: cy + radius + 40 });
  const [plateV, setPlateV] = useState({ active: false, x1: cx - radius - 40, x2: cx + radius + 40 });
  const [plateHCompress, setPlateHCompress] = useState(0);
  const [plateVCompress, setPlateVCompress] = useState(0);

  const runRef = useRef(true);
  const plateRef = useRef({ h: plateH, v: plateV, hC: 0, vC: 0 });

  useEffect(() => { plateRef.current = { h: plateH, v: plateV, hC: plateHCompress, vC: plateVCompress }; }, [plateH, plateV, plateHCompress, plateVCompress]);

  const initMesh = useCallback(() => {
    const m = generateCellMesh(cx, cy, radius, meshRings, meshSectors);
    // Compute rest area for each tri
    for (const tri of m.tris) {
      const a = m.nodes[tri[0]], b = m.nodes[tri[1]], c = m.nodes[tri[2]];
      tri.restArea = 0.5 * Math.abs((b.x0 - a.x0) * (c.y0 - a.y0) - (c.x0 - a.x0) * (b.y0 - a.y0));
      tri.ruptured = false;
      tri.stress = { vonMises: 0, pressure: 0, strain: 0, maxPrincipal: 0 };
    }
    meshRef.current = m;
  }, [cx, cy, radius, meshRings, meshSectors]);

  useEffect(() => { initMesh(); }, [initMesh]);

  const simulate = useCallback(() => {
    const m = meshRef.current;
    if (!m) return;
    const { nodes, edges, tris } = m;
    const dt = 0.016;
    const pl = plateRef.current;

    // Reset forces
    for (const n of nodes) {
      if (n.fixed) { n.vx = 0; n.vy = 0; continue; }
      n.fx = 0; n.fy = 0;
    }

    // Spring forces along edges
    for (const [ai, bi, rest] of edges) {
      const a = nodes[ai], b = nodes[bi];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      const stretch = dist - rest;
      const f = springK * stretch;
      const fx = f * dx / dist, fy = f * dy / dist;
      if (!a.fixed) { a.fx += fx; a.fy += fy; }
      if (!b.fixed) { b.fx -= fx; b.fy -= fy; }
    }

    // Internal pressure: push boundary nodes outward
    for (const n of nodes) {
      if (!n.boundary) continue;
      const dx = n.x - cx, dy = n.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      n.fx += (dx / dist) * internalP;
      n.fy += (dy / dist) * internalP;
    }

    // Plate forces (horizontal plates = top/bottom)
    if (pl.h.active) {
      const topY = cy - radius + pl.hC;
      const botY = cy + radius - pl.hC;
      for (const n of nodes) {
        if (n.y < topY) {
          const overlap = topY - n.y;
          n.fy += overlap * 50;
          n.y = topY;
        }
        if (n.y > botY) {
          const overlap = n.y - botY;
          n.fy -= overlap * 50;
          n.y = botY;
        }
      }
    }
    // Plate forces (vertical plates = left/right)
    if (pl.v.active) {
      const leftX = cx - radius + pl.vC;
      const rightX = cx + radius - pl.vC;
      for (const n of nodes) {
        if (n.x < leftX) {
          const overlap = leftX - n.x;
          n.fx += overlap * 50;
          n.x = leftX;
        }
        if (n.x > rightX) {
          const overlap = n.x - rightX;
          n.fx -= overlap * 50;
          n.x = rightX;
        }
      }
    }

    // Integrate
    for (const n of nodes) {
      if (n.fixed) continue;
      n.vx = (n.vx + n.fx * dt) * damping;
      n.vy = (n.vy + n.fy * dt) * damping;
      n.x += n.vx * dt;
      n.y += n.vy * dt;
    }

    // Compute stress per triangle
    let maxVM = 0, sumVM = 0, ruptCount = 0;
    for (const tri of tris) {
      const s = triStress(nodes, tri, elasticMod, poissonR);
      tri.stress = s;
      if (s.vonMises > memStrength && !tri.ruptured) {
        tri.ruptured = true;
      }
      if (tri.ruptured) ruptCount++;
      maxVM = Math.max(maxVM, s.vonMises);
      sumVM += s.vonMises;
    }

    // Displacement stats
    let maxDisp = 0;
    for (const n of nodes) {
      const dx = n.x - n.x0, dy = n.y - n.y0;
      maxDisp = Math.max(maxDisp, Math.sqrt(dx * dx + dy * dy));
    }

    const integrity = Math.max(0, 100 * (1 - ruptCount / tris.length));
    setStats({ maxVM, avgVM: tris.length > 0 ? sumVM / tris.length : 0, maxDisp, ruptured: ruptCount, integrity });
  }, [springK, internalP, damping, elasticMod, poissonR, memStrength, cx, cy, radius]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const m = meshRef.current;
    if (!canvas || !m) return;
    const ctx = canvas.getContext("2d");
    const { nodes, tris, edges } = m;

    ctx.fillStyle = UI.bg;
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = "#ffffff06";
    ctx.lineWidth = 0.5;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // Plates
    const pl = plateRef.current;
    if (pl.h.active) {
      const topY = cy - radius + pl.hC;
      const botY = cy + radius - pl.hC;
      ctx.fillStyle = "#ff2e5018";
      ctx.fillRect(0, 0, W, topY);
      ctx.fillRect(0, botY, W, H - botY);
      ctx.strokeStyle = UI.danger;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, topY); ctx.lineTo(W, topY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, botY); ctx.lineTo(W, botY); ctx.stroke();
      // Arrows
      for (let x = 60; x < W; x += 100) {
        drawArrow(ctx, x, topY - 20, x, topY + 5, UI.danger);
        drawArrow(ctx, x, botY + 20, x, botY - 5, UI.danger);
      }
    }
    if (pl.v.active) {
      const leftX = cx - radius + pl.vC;
      const rightX = cx + radius - pl.vC;
      ctx.fillStyle = "#b388ff18";
      ctx.fillRect(0, 0, leftX, H);
      ctx.fillRect(rightX, 0, W - rightX, H);
      ctx.strokeStyle = UI.purple;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(leftX, 0); ctx.lineTo(leftX, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rightX, 0); ctx.lineTo(rightX, H); ctx.stroke();
      for (let y = 60; y < H; y += 100) {
        drawArrow(ctx, leftX - 20, y, leftX + 5, y, UI.purple);
        drawArrow(ctx, rightX + 20, y, rightX - 5, y, UI.purple);
      }
    }

    // Draw triangles filled with stress color
    for (const tri of tris) {
      const a = nodes[tri[0]], b = nodes[tri[1]], c = nodes[tri[2]];
      let val = 0;
      if (viewMode === "vonMises") val = tri.stress.vonMises / stressScale;
      else if (viewMode === "pressure") val = Math.abs(tri.stress.pressure) / stressScale;
      else if (viewMode === "strain") val = (tri.stress.strain || 0) * 10;
      else if (viewMode === "displacement") {
        const d1 = Math.sqrt((a.x - a.x0) ** 2 + (a.y - a.y0) ** 2);
        const d2 = Math.sqrt((b.x - b.x0) ** 2 + (b.y - b.y0) ** 2);
        const d3 = Math.sqrt((c.x - c.x0) ** 2 + (c.y - c.y0) ** 2);
        val = ((d1 + d2 + d3) / 3) / (radius * 0.3);
      }

      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.closePath();

      if (tri.ruptured) {
        ctx.fillStyle = `rgba(255,30,60,${0.3 + 0.3 * Math.sin(Date.now() * 0.005)})`;
      } else {
        ctx.fillStyle = stressColor(val);
      }
      ctx.fill();

      if (showMesh) {
        ctx.strokeStyle = tri.ruptured ? "#ff2e5060" : "#ffffff12";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // Draw nodes
    if (showNodes) {
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.fixed ? 4 : 2, 0, Math.PI * 2);
        ctx.fillStyle = n.fixed ? UI.warn : (n.boundary ? UI.accent + "80" : "#ffffff30");
        ctx.fill();
      }
    }

    // Fixed nodes always visible (pin markers)
    for (const n of nodes) {
      if (!n.fixed) continue;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = UI.warn;
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.stroke();
      // Pin symbol
      ctx.beginPath();
      ctx.moveTo(n.x, n.y + 5);
      ctx.lineTo(n.x - 4, n.y + 12);
      ctx.lineTo(n.x + 4, n.y + 12);
      ctx.closePath();
      ctx.fillStyle = UI.warn + "80";
      ctx.fill();
    }

    // Drag force indicator
    if (dragRef.current && dragRef.current.active) {
      const d = dragRef.current;
      ctx.strokeStyle = tool === "push" ? UI.danger : UI.success;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(d.startX, d.startY);
      ctx.lineTo(d.curX, d.curY);
      ctx.stroke();
      ctx.setLineDash([]);
      // Arrow head
      drawArrow(ctx, d.startX, d.startY, d.curX, d.curY, tool === "push" ? UI.danger : UI.success);
    }

    // Stress scale bar
    const sx = W - 28, sy = 40, sh = H - 100;
    for (let i = 0; i < sh; i++) {
      ctx.fillStyle = stressColor(1 - i / sh);
      ctx.fillRect(sx, sy + i, 14, 1);
    }
    ctx.strokeStyle = "#ffffff20";
    ctx.strokeRect(sx, sy, 14, sh);
    ctx.font = "9px monospace";
    ctx.fillStyle = UI.dim;
    ctx.textAlign = "right";
    ctx.fillText(pL(stressScale), sx - 3, sy + 4);
    ctx.fillText(pL(stressScale / 2), sx - 3, sy + sh / 2);
    ctx.fillText("0", sx - 3, sy + sh);

  }, [W, H, cx, cy, radius, viewMode, stressScale, showMesh, showNodes, tool]);

  function drawArrow(ctx, x1, y1, x2, y2, color) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 3) return;
    const nx = dx / len, ny = dy / len;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 8 * nx + 4 * ny, y2 - 8 * ny - 4 * nx);
    ctx.lineTo(x2 - 8 * nx - 4 * ny, y2 - 8 * ny + 4 * nx);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Animation loop
  useEffect(() => { runRef.current = running; }, [running]);

  useEffect(() => {
    let active = true;
    const loop = () => {
      if (!active) return;
      if (runRef.current) {
        for (let i = 0; i < 3; i++) simulate();
      }
      draw();
      animRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => { active = false; if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [simulate, draw]);

  // Mouse interaction
  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) };
  };

  const findNode = (x, y, maxDist = 20) => {
    const m = meshRef.current; if (!m) return -1;
    let best = -1, bestD = maxDist;
    for (let i = 0; i < m.nodes.length; i++) {
      const n = m.nodes[i];
      const d = Math.sqrt((n.x - x) ** 2 + (n.y - y) ** 2);
      if (d < bestD) { best = i; bestD = d; }
    }
    return best;
  };

  const handleMouseDown = (e) => {
    const pos = getPos(e);
    if (tool === "pin") {
      const ni = findNode(pos.x, pos.y);
      if (ni >= 0) {
        const n = meshRef.current.nodes[ni];
        n.fixed = !n.fixed;
        if (n.fixed) { n.vx = 0; n.vy = 0; }
      }
      return;
    }
    if (tool === "push" || tool === "pull") {
      dragRef.current = { active: true, startX: pos.x, startY: pos.y, curX: pos.x, curY: pos.y, nodeIdx: findNode(pos.x, pos.y, 30) };
    }
  };

  const handleMouseMove = (e) => {
    if (!dragRef.current || !dragRef.current.active) return;
    const pos = getPos(e);
    dragRef.current.curX = pos.x;
    dragRef.current.curY = pos.y;

    // Apply continuous force while dragging
    if (dragRef.current.nodeIdx >= 0 && meshRef.current) {
      const n = meshRef.current.nodes[dragRef.current.nodeIdx];
      if (!n.fixed) {
        const dx = pos.x - dragRef.current.startX;
        const dy = pos.y - dragRef.current.startY;
        const sign = tool === "push" ? 1 : -1;
        n.fx += dx * forceMultiplier * sign * 0.1;
        n.fy += dy * forceMultiplier * sign * 0.1;
      }
    }
  };

  const handleMouseUp = () => {
    if (dragRef.current && dragRef.current.active && meshRef.current) {
      const d = dragRef.current;
      if (d.nodeIdx >= 0) {
        const n = meshRef.current.nodes[d.nodeIdx];
        if (!n.fixed) {
          const dx = d.curX - d.startX;
          const dy = d.curY - d.startY;
          const sign = tool === "push" ? 1 : -1;
          n.vx += dx * forceMultiplier * sign * 0.3;
          n.vy += dy * forceMultiplier * sign * 0.3;
        }
      }
    }
    dragRef.current = null;
  };

  const resetMesh = () => {
    initMesh();
    setPlateHCompress(0);
    setPlateVCompress(0);
  };

  const bs = a => ({ padding: "4px 8px", fontSize: 9, border: `1px solid ${a ? UI.accent : UI.border}`, background: a ? UI.accentD + "25" : "transparent", color: a ? UI.accent : UI.dim, borderRadius: 3, cursor: "pointer", fontFamily: "monospace" });

  return (
    <div style={{ background: UI.bg, height: "100vh", color: UI.text, fontFamily: "'IBM Plex Sans',sans-serif", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "7px 12px", borderBottom: `1px solid ${UI.border}`, display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: running ? UI.success : UI.danger, boxShadow: running ? `0 0 6px ${UI.success}` : "none" }} />
        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace" }}>Single Cell FEA</span>
        <span style={{ fontSize: 9, color: UI.dim, fontFamily: "monospace" }}>2D Cross-Section · Deformable Mesh</span>
        <div style={{ display: "flex", gap: 3, marginLeft: 12 }}>
          <button onClick={() => setRunning(!running)} style={{ ...bs(running), borderColor: running ? UI.danger : UI.accent, color: running ? UI.danger : UI.accent }}>{running ? "⏸" : "▶"}</button>
          <button onClick={() => simulate()} style={bs(false)}>Step</button>
          <button onClick={resetMesh} style={bs(false)}>Reset</button>
        </div>
        <div style={{ display: "flex", gap: 2, marginLeft: 12 }}>
          <span style={{ fontSize: 8, color: UI.dim, alignSelf: "center" }}>TOOL:</span>
          {[["push", "👊 Push"], ["pull", "🧲 Pull"], ["pin", "📌 Pin"]].map(([k, l]) =>
            <button key={k} onClick={() => setTool(k)} style={bs(tool === k)}>{l}</button>
          )}
        </div>
        <div style={{ display: "flex", gap: 2, marginLeft: 12 }}>
          <span style={{ fontSize: 8, color: UI.dim, alignSelf: "center" }}>VIEW:</span>
          {[["vonMises", "Von Mises"], ["pressure", "Pressure"], ["strain", "Strain"], ["displacement", "Disp."]].map(([k, l]) =>
            <button key={k} onClick={() => setViewMode(k)} style={bs(viewMode === k)}>{l}</button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left Panel */}
        <div style={{ width: 195, background: UI.panel, borderRight: `1px solid ${UI.border}`, overflowY: "auto", padding: 10, flexShrink: 0 }}>
          <div style={{ fontSize: 8, textTransform: "uppercase", color: UI.dim, marginBottom: 4 }}>Material</div>
          <Sl label="Elastic Modulus" value={elasticMod} min={100} max={5000} step={50} onChange={setElasticMod} unit="Pa" />
          <Sl label="Poisson Ratio" value={poissonR} min={0.1} max={0.49} step={0.01} onChange={setPoissonR} />
          <Sl label="Membrane Str." value={memStrength} min={500} max={20000} step={100} onChange={setMemStrength} unit="Pa" color={UI.danger} />
          <Sl label="Internal Pressure" value={internalP} min={0} max={200} step={5} onChange={setInternalP} unit="Pa" color={UI.success} />
          <Sl label="Spring K" value={springK} min={50} max={1000} step={10} onChange={setSpringK} />
          <Sl label="Damping" value={damping} min={0.5} max={0.99} step={0.01} onChange={setDamping} />

          <div style={{ fontSize: 8, textTransform: "uppercase", color: UI.dim, marginBottom: 4, marginTop: 8 }}>Interaction</div>
          <Sl label="Force Multiplier" value={forceMultiplier} min={1} max={30} step={1} onChange={setForceMultiplier} />
          <Sl label="Stress Scale" value={stressScale} min={200} max={20000} step={200} onChange={setStressScale} unit="Pa" color={UI.warn} />

          <div style={{ fontSize: 8, textTransform: "uppercase", color: UI.dim, marginBottom: 4, marginTop: 8 }}>Mesh</div>
          <Sl label="Rings" value={meshRings} min={3} max={15} step={1} onChange={v => { setMeshRings(v); }} />
          <Sl label="Sectors" value={meshSectors} min={12} max={48} step={4} onChange={v => { setMeshSectors(v); }} />
          <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
            <button onClick={() => setShowMesh(!showMesh)} style={bs(showMesh)}>{showMesh ? "☑" : "☐"} Mesh</button>
            <button onClick={() => setShowNodes(!showNodes)} style={bs(showNodes)}>{showNodes ? "☑" : "☐"} Nodes</button>
          </div>

          <div style={{ fontSize: 8, textTransform: "uppercase", color: UI.dim, marginBottom: 4, marginTop: 10 }}>Compression Plates</div>
          <button onClick={() => setPlateH(p => ({ ...p, active: !p.active }))} style={{ ...bs(plateH.active), width: "100%", marginBottom: 4, textAlign: "left" }}>
            {plateH.active ? "☑" : "☐"} Top/Bottom Plates
          </button>
          {plateH.active && <Sl label="H Compress" value={plateHCompress} min={0} max={radius * 0.8} step={2} onChange={setPlateHCompress} color={UI.danger} />}
          <button onClick={() => setPlateV(p => ({ ...p, active: !p.active }))} style={{ ...bs(plateV.active), width: "100%", marginBottom: 4, textAlign: "left" }}>
            {plateV.active ? "☑" : "☐"} Left/Right Plates
          </button>
          {plateV.active && <Sl label="V Compress" value={plateVCompress} min={0} max={radius * 0.8} step={2} onChange={setPlateVCompress} color={UI.purple} />}

          <div style={{ fontSize: 8, textTransform: "uppercase", color: UI.dim, marginBottom: 4, marginTop: 10 }}>Guide</div>
          <div style={{ fontSize: 8, color: UI.dim, lineHeight: 1.7 }}>
            <p style={{ margin: "0 0 2px" }}>👊 <b style={{ color: UI.text }}>Push</b> — drag on cell to push</p>
            <p style={{ margin: "0 0 2px" }}>🧲 <b style={{ color: UI.text }}>Pull</b> — drag to pull node</p>
            <p style={{ margin: "0 0 2px" }}>📌 <b style={{ color: UI.text }}>Pin</b> — click to fix/unfix node</p>
            <p style={{ margin: "0 0 2px" }}>🔴 <b style={{ color: UI.text }}>Plates</b> — compress from sides</p>
          </div>
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <canvas ref={canvasRef} width={W} height={H}
            onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
            style={{ flex: 1, width: "100%", cursor: tool === "pin" ? "crosshair" : "pointer" }} />

          {/* Stats bar */}
          <div style={{ background: UI.panel, borderTop: `1px solid ${UI.border}`, padding: "6px 12px", display: "flex", gap: 16, fontSize: 9, fontFamily: "monospace", flexWrap: "wrap" }}>
            <div><span style={{ color: UI.dim }}>MAX σ </span><span style={{ color: UI.warn }}>{pL(stats.maxVM)}</span></div>
            <div><span style={{ color: UI.dim }}>AVG σ </span><span style={{ color: UI.accent }}>{pL(stats.avgVM)}</span></div>
            <div><span style={{ color: UI.dim }}>MAX DISP </span><span style={{ color: UI.purple }}>{stats.maxDisp.toFixed(1)} px</span></div>
            <div><span style={{ color: UI.dim }}>RUPTURES </span><span style={{ color: stats.ruptured > 0 ? UI.danger : UI.dim }}>{stats.ruptured}</span></div>
            <div style={{ marginLeft: "auto" }}>
              <span style={{ color: UI.dim }}>INTEGRITY </span>
              <span style={{ color: stats.integrity > 70 ? UI.success : stats.integrity > 30 ? UI.warn : UI.danger }}>{stats.integrity.toFixed(0)}%</span>
            </div>
          </div>
        </div>

        {/* Right Panel — FEA Info */}
        <div style={{ width: 180, background: UI.panel, borderLeft: `1px solid ${UI.border}`, overflowY: "auto", padding: 10, flexShrink: 0 }}>
          <div style={{ fontSize: 8, textTransform: "uppercase", color: UI.dim, marginBottom: 3 }}>Stress Scale</div>
          <div style={{ display: "flex", height: 8, borderRadius: 2, overflow: "hidden", marginBottom: 2 }}>
            {Array.from({ length: 25 }, (_, i) => <div key={i} style={{ flex: 1, background: stressColor(i / 24) }} />)}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: UI.dim, marginBottom: 10 }}><span>0</span><span>{pL(stressScale)}</span></div>

          <div style={{ fontSize: 8, textTransform: "uppercase", color: UI.dim, marginBottom: 4 }}>View Modes</div>
          <div style={{ fontSize: 8, color: UI.dim, lineHeight: 1.7, marginBottom: 10 }}>
            <p style={{ margin: "0 0 2px" }}><span style={{ color: UI.accent }}>Von Mises</span> — equivalent stress (σ_VM)</p>
            <p style={{ margin: "0 0 2px" }}><span style={{ color: UI.accent }}>Pressure</span> — hydrostatic (σ_h)</p>
            <p style={{ margin: "0 0 2px" }}><span style={{ color: UI.accent }}>Strain</span> — Green-Lagrange (ε)</p>
            <p style={{ margin: 0 }}><span style={{ color: UI.accent }}>Disp.</span> — displacement field</p>
          </div>

          <div style={{ fontSize: 8, textTransform: "uppercase", color: UI.dim, marginBottom: 4 }}>FEA Method</div>
          <div style={{ background: UI.bg, padding: "6px 8px", borderRadius: 3, fontFamily: "monospace", fontSize: 7, lineHeight: 1.8, color: UI.dim, marginBottom: 10 }}>
            Triangular CST elements<br />
            Green-Lagrange strain:<br />
            &nbsp; E = ½(F^T·F - I)<br />
            Plane stress σ = D·ε<br />
            Von Mises:<br />
            &nbsp; σ_vm = √(σx²+σy²-σxσy+3τ²)<br />
            Spring-mass deformation<br />
            Verlet integration
          </div>

          <div style={{ fontSize: 8, textTransform: "uppercase", color: UI.dim, marginBottom: 4 }}>Rupture</div>
          <div style={{ fontSize: 8, color: UI.dim, lineHeight: 1.7 }}>
            <p style={{ margin: 0 }}>When σ_VM exceeds membrane strength, the element ruptures (flashing red). Integrity = % of intact elements.</p>
          </div>

          <div style={{ fontSize: 8, textTransform: "uppercase", color: UI.dim, marginBottom: 4, marginTop: 10 }}>Cell Model</div>
          <div style={{ fontSize: 8, color: UI.dim, lineHeight: 1.7 }}>
            <p style={{ margin: "0 0 2px" }}>• <span style={{ color: UI.text }}>Mesh</span>: triangulated disk (CST)</p>
            <p style={{ margin: "0 0 2px" }}>• <span style={{ color: UI.text }}>Internal P</span>: cytoplasm turgor</p>
            <p style={{ margin: "0 0 2px" }}>• <span style={{ color: UI.text }}>Springs</span>: cytoskeleton</p>
            <p style={{ margin: "0 0 2px" }}>• <span style={{ color: UI.text }}>Boundary</span>: cell membrane</p>
            <p style={{ margin: 0 }}>• <span style={{ color: UI.text }}>Plates</span>: adjacent cell / substrate</p>
          </div>
        </div>
      </div>
    </div>
  );
}

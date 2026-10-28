/** Budget canvases: Edges (end-cut), Faces (sides+angles), Vertices (2-plane). */

/** Standard OSB sheet, mm (long × short). */
export const OSB_SHEET_MM = { long: 2500, short: 1250 };

/**
 * Axis cut length → overall envelope along the board (mm).
 * End face tilted by α,β from square across the width face.
 */
export function strutOverallLength(cutLength, width, degA, degB) {
  const rad = (d) => ((d || 0) * Math.PI) / 180;
  return (
    cutLength +
    (width / 2) * (Math.tan(rad(degA)) + Math.tan(rad(degB)))
  );
}

/**
 * Flat triangle from side lengths; rotate longest side along +x;
 * place a vertex at sheet origin. Returns mm coords + sheet size.
 */
export function layoutPanelOnSheet(sideLengths, sheet = OSB_SHEET_MM) {
  const pts = triangleFromSides(sideLengths);
  const edges = [
    { i: 0, j: 1, len: sideLengths[0] },
    { i: 1, j: 2, len: sideLengths[1] },
    { i: 2, j: 0, len: sideLengths[2] },
  ];
  edges.sort((a, b) => b.len - a.len);
  const { i, j } = edges[0];
  const dx = pts[j].x - pts[i].x;
  const dy = pts[j].y - pts[i].y;
  const ang = Math.atan2(dy, dx);
  const cos = Math.cos(-ang);
  const sin = Math.sin(-ang);
  let rot = pts.map((p) => ({
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  }));
  // flip so the third vertex has y ≥ 0 (into the sheet)
  const k = 3 - i - j;
  if (rot[k].y < 0) rot = rot.map((p) => ({ x: p.x, y: -p.y }));
  const minX = Math.min(...rot.map((p) => p.x));
  const minY = Math.min(...rot.map((p) => p.y));
  const panel = rot.map((p) => ({ x: p.x - minX, y: p.y - minY }));
  return {
    panel,
    sheetW: sheet.long,
    sheetH: sheet.short,
  };
}

export function renderBudget(container, geom, products) {
  container.innerHTML = '';
  if (!products) {
    container.innerHTML = '<p class="hint">No Piped/timber data.</p>';
    return;
  }

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = products.note;
  container.appendChild(note);

  container.appendChild(
    section('Edges (struts / cut list)', products.edgeGroups, drawStrut, 420, 210),
  );
  container.appendChild(
    section('Faces (panels)', products.faceGroups, drawFace, 420, 240),
  );
  container.appendChild(
    section('Vertices (Piped hubs)', products.hubGroups, drawHub, 300, 200, {
      dataAttr: 'data-hub-index',
    }),
  );
}

/** Outline the Vertices card for hub type `index` (A, B, …); clear if null. */
export function highlightHubCard(container, index, color) {
  container.querySelectorAll('.product.is-hub-pick').forEach((el) => {
    el.classList.remove('is-hub-pick');
    el.style.removeProperty('--hub-pick-color');
  });
  if (index == null) return;
  const card = container.querySelector(`.product[data-hub-index="${index}"]`);
  if (!card) return;
  card.classList.add('is-hub-pick');
  if (color) card.style.setProperty('--hub-pick-color', color);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function section(title, groups, drawer, cw, ch, opts = {}) {
  const wrap = document.createElement('div');
  const h = document.createElement('h2');
  h.textContent = title;
  wrap.appendChild(h);

  const ul = document.createElement('ul');
  ul.className = 'budget-list';

  for (const g of groups) {
    const li = document.createElement('li');
    li.className = 'product';
    if (opts.dataAttr) li.setAttribute(opts.dataAttr, g.index);

    const idx = document.createElement('i');
    idx.className = 'product-index';
    idx.style.backgroundColor = g.color;
    idx.textContent = g.index;

    const label = document.createElement('span');
    label.textContent = `${g.count} pcs · ${summarize(g)}`;

    li.appendChild(idx);
    li.appendChild(label);

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    drawer(canvas, g);
    li.appendChild(canvas);
    ul.appendChild(li);
  }

  wrap.appendChild(ul);
  return wrap;
}

function summarize(g) {
  const s = g.sample;
  if (s.cutLength != null) {
    // Label = angle from long edge to end face (90 − endCutDeg from square).
    const a = Math.round(90 - (s.endCutDegA ?? 0));
    const b = Math.round(90 - (s.endCutDegB ?? 0));
    const overall = Math.round(
      strutOverallLength(s.cutLength, s.width, s.endCutDegA, s.endCutDegB),
    );
    const axis = Math.round(s.cutLength);
    const len =
      overall === axis
        ? `L=${axis} mm`
        : `len.=${overall} · axis=${axis} mm`;
    return `${len} · ${Math.round(s.width)}×${Math.round(s.thickness)} · cut ${a}°/${b}°`;
  }
  if (s.sideLengths) {
    return (
      s.sideLengths.map((x) => Math.round(x)).join(' / ') +
      ' mm · ' +
      (s.anglesDeg || []).map((d) => `${d.toFixed(0)}°`).join(' ')
    );
  }
  if (s.valence != null) return `${s.valence}-way · Ø${s.pipeD} mm`;
  return g.key;
}

function drawStrut(canvas, group) {
  const ctx = canvas.getContext('2d');
  const s = group.sample;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  const degA = s.endCutDegA ?? 0;
  const degB = s.endCutDegB ?? 0;
  const overall = strutOverallLength(s.cutLength, s.width, degA, degB);
  const tipA = (s.width / 2) * Math.tan((degA * Math.PI) / 180);
  const tipB = (s.width / 2) * Math.tan((degB * Math.PI) / 180);
  const tipAFull = tipA * 2;
  const tipBFull = tipB * 2;

  // Exaggerated section height so the bevel reads; labels stay true mm.
  const padL = 48;
  const padR = 88;
  const padT = 36;
  const padB = 42;
  const faceH = Math.max(28, Math.min(56, H * 0.28));
  const scaleX = (W - padL - padR) / (overall || 1);
  const yTop = padT + 8;
  const yBot = yTop + faceH;

  // Corners in px: long edge on top
  const TL = { x: padL, y: yTop };
  const TR = { x: padL + overall * scaleX, y: yTop };
  const BL = { x: padL + tipAFull * scaleX, y: yBot };
  const BR = { x: padL + (overall - tipBFull) * scaleX, y: yBot };

  ctx.beginPath();
  ctx.moveTo(TL.x, TL.y);
  ctx.lineTo(TR.x, TR.y);
  ctx.lineTo(BR.x, BR.y);
  ctx.lineTo(BL.x, BL.y);
  ctx.closePath();
  ctx.fillStyle = '#f0f4f7';
  ctx.fill();
  ctx.strokeStyle = group.color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Width dim (left)
  dimV(ctx, padL - 18, yTop, yBot, `${Math.round(s.width)}`);

  // Overall length dim (above)
  dimH(ctx, TL.x, TR.x, yTop - 14, `${Math.round(overall)}`);

  // Axis length when it differs
  if (Math.round(overall) !== Math.round(s.cutLength)) {
    const ax0 = padL + tipA * scaleX;
    const ax1 = padL + (overall - tipB) * scaleX;
    dimH(ctx, ax0, ax1, yBot + 16, `ось ${Math.round(s.cutLength)}`);
  }

  // End-cut angle arcs (from long edge)
  drawEndAngle(ctx, TL, BL, degA, true);
  drawEndAngle(ctx, TR, BR, degB, false);

  // Thickness stub (end view) on the right
  const tw = Math.max(10, Math.min(22, (s.thickness / s.width) * faceH));
  const tx0 = W - padR + 28;
  ctx.fillStyle = '#e8eef3';
  ctx.strokeStyle = group.color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(tx0, yTop, tw, faceH);
  ctx.fill();
  ctx.stroke();
  dimH(ctx, tx0, tx0 + tw, yBot + 14, `${Math.round(s.thickness)}`);
  ctx.fillStyle = '#666';
  ctx.font = '9px Tahoma, sans-serif';
  ctx.fillText('торец', tx0 - 4, yTop - 4);

  ctx.fillStyle = '#666';
  ctx.font = '10px Tahoma, sans-serif';
  ctx.fillText(
    `${Math.round(s.width)}×${Math.round(s.thickness)} · L/R/in ${fmtB(s.bevelSides[0])}/${fmtB(s.bevelSides[1])}/${fmtB(s.bevelInner)}`,
    8,
    H - 8,
  );
}

/** Angle mark at the long tip: ref along long edge, arc to end face. Label = 90 − deg. */
function drawEndAngle(ctx, longPt, shortPt, deg, left) {
  const label = `${Math.round(90 - deg)}°`;
  ctx.strokeStyle = '#c0392b';
  ctx.fillStyle = '#c0392b';
  ctx.lineWidth = 1;
  // reference along long (top) edge, inward
  const refLen = 18;
  const rx = left ? longPt.x + refLen : longPt.x - refLen;
  ctx.beginPath();
  ctx.moveTo(longPt.x, longPt.y);
  ctx.lineTo(rx, longPt.y);
  ctx.stroke();
  // arc from long edge toward cut face
  const cutAng = Math.atan2(shortPt.y - longPt.y, shortPt.x - longPt.x);
  const start = left ? 0 : Math.PI;
  const end = cutAng;
  const r = 14;
  ctx.beginPath();
  ctx.arc(longPt.x, longPt.y, r, Math.min(start, end), Math.max(start, end));
  ctx.stroke();
  ctx.font = '11px Tahoma, sans-serif';
  ctx.fillText(label, longPt.x + (left ? 8 : -36), longPt.y - 8);
}

function dimH(ctx, x0, x1, y, text) {
  ctx.strokeStyle = '#1a73e8';
  ctx.fillStyle = '#1a73e8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.moveTo(x0, y - 4);
  ctx.lineTo(x0, y + 4);
  ctx.moveTo(x1, y - 4);
  ctx.lineTo(x1, y + 4);
  ctx.stroke();
  ctx.font = '11px Tahoma, sans-serif';
  const tw = ctx.measureText(text).width;
  ctx.fillText(text, (x0 + x1) / 2 - tw / 2, y - 4);
}

function dimV(ctx, x, y0, y1, text) {
  ctx.strokeStyle = '#1a73e8';
  ctx.fillStyle = '#1a73e8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.moveTo(x - 4, y0);
  ctx.lineTo(x + 4, y0);
  ctx.moveTo(x - 4, y1);
  ctx.lineTo(x + 4, y1);
  ctx.stroke();
  ctx.font = '11px Tahoma, sans-serif';
  ctx.fillText(text, x - 28, (y0 + y1) / 2 + 4);
}

function fmtB(v) {
  return Math.round(v);
}

function triangleFromSides(sides) {
  const a = sides[0];
  const b = sides[1];
  const c = sides[2];
  const x2 = (c * c + a * a - b * b) / (2 * a);
  const y2 = Math.sqrt(Math.max(0, c * c - x2 * x2));
  return [
    { x: 0, y: 0 },
    { x: a, y: 0 },
    { x: x2, y: y2 },
  ];
}

function drawFace(canvas, group) {
  const ctx = canvas.getContext('2d');
  const s = group.sample;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  const sides = s.sideLengths;
  const { panel, sheetW, sheetH } = layoutPanelOnSheet(sides);

  const maxX = Math.max(sheetW, ...panel.map((p) => p.x));
  const maxY = Math.max(sheetH, ...panel.map((p) => p.y));
  const pad = 28;
  const scale = Math.min((W - pad * 2) / (maxX || 1), (H - pad * 2 - 14) / (maxY || 1));

  const toPx = (p) => ({
    x: pad + p.x * scale,
    y: H - pad - 12 - p.y * scale,
  });

  const sheetPx = [
    toPx({ x: 0, y: 0 }),
    toPx({ x: sheetW, y: 0 }),
    toPx({ x: sheetW, y: sheetH }),
    toPx({ x: 0, y: sheetH }),
  ];

  ctx.beginPath();
  ctx.moveTo(sheetPx[0].x, sheetPx[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(sheetPx[i].x, sheetPx[i].y);
  ctx.closePath();
  ctx.fillStyle = '#f7f5ef';
  ctx.fill();
  ctx.strokeStyle = '#9aa3ad';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#666';
  ctx.font = '10px Tahoma, sans-serif';
  ctx.fillText(
    `OSB ${sheetW}×${sheetH}`,
    sheetPx[3].x + 4,
    sheetPx[3].y + 12,
  );

  const mapped = panel.map(toPx);
  const cx = (mapped[0].x + mapped[1].x + mapped[2].x) / 3;
  const cy = (mapped[0].y + mapped[1].y + mapped[2].y) / 3;

  ctx.beginPath();
  ctx.moveTo(mapped[0].x, mapped[0].y);
  ctx.lineTo(mapped[1].x, mapped[1].y);
  ctx.lineTo(mapped[2].x, mapped[2].y);
  ctx.closePath();
  ctx.fillStyle = '#eef6fb';
  ctx.fill();
  ctx.strokeStyle = group.color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Remap side labels to current vertex order after rotation
  const edgeLens = [0, 1, 2].map((i) => {
    const p = panel[i];
    const q = panel[(i + 1) % 3];
    return Math.hypot(q.x - p.x, q.y - p.y);
  });

  ctx.fillStyle = '#333';
  ctx.font = '11px Tahoma, sans-serif';
  for (let i = 0; i < 3; i++) {
    const p = mapped[i];
    const q = mapped[(i + 1) % 3];
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    const ox = (mx - cx) * 0.15;
    const oy = (my - cy) * 0.15;
    ctx.fillText(`${Math.round(edgeLens[i])}`, mx + ox - 12, my + oy - 2);
  }

  const angs = cornerAnglesDeg(panel);
  ctx.font = '10px Tahoma, sans-serif';
  for (let i = 0; i < 3; i++) {
    const p = mapped[i];
    const label = `${angs[i].toFixed(1)}°`;
    const lx = p.x + (cx - p.x) * 0.28;
    const ly = p.y + (cy - p.y) * 0.28;
    ctx.fillText(label, lx - 12, ly + 3);
  }
}

function cornerAnglesDeg(pts) {
  return [0, 1, 2].map((i) => {
    const prev = pts[(i + 2) % 3];
    const cur = pts[i];
    const next = pts[(i + 1) % 3];
    const u = { x: prev.x - cur.x, y: prev.y - cur.y };
    const v = { x: next.x - cur.x, y: next.y - cur.y };
    const lu = Math.hypot(u.x, u.y);
    const lv = Math.hypot(v.x, v.y);
    if (lu < 1e-12 || lv < 1e-12) return 0;
    const cos = Math.min(1, Math.max(-1, (u.x * v.x + u.y * v.y) / (lu * lv)));
    return (Math.acos(cos) * 180) / Math.PI;
  });
}

function drawHub(canvas, group) {
  const ctx = canvas.getContext('2d');
  const s = group.sample;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2;
  const cy = H / 2 + 8;
  const R = Math.min(W, H) * 0.32;
  const pipeR = Math.max(10, Math.min(28, (s.pipeD / 108) * 18));
  const rays = s.rays || [];
  const n = rays.length || s.valence || 0;
  const gaps = s.gapDeg || s.anglesDeg || [];

  ctx.beginPath();
  ctx.arc(cx, cy, pipeR, 0, Math.PI * 2);
  ctx.fillStyle = '#dfe6ec';
  ctx.fill();
  ctx.strokeStyle = group.color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#333';
  ctx.font = '11px Tahoma, sans-serif';
  ctx.fillText(`${n}-way · Ø${s.pipeD}`, 8, 14);
  ctx.fillStyle = '#666';
  ctx.font = '9px Tahoma, sans-serif';
  ctx.fillText('gap ⊥ pipe · polar to axis', 8, 26);

  // Equal visual spacing for drawing (actual gaps labeled)
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x0 = cx + Math.cos(ang) * pipeR;
    const y0 = cy + Math.sin(ang) * pipeR;
    const x1 = cx + Math.cos(ang) * (pipeR + R);
    const y1 = cy + Math.sin(ang) * (pipeR + R);

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = '#2c3e50';
    ctx.lineWidth = 3;
    ctx.stroke();

    const polar = rays[i]?.polarDeg ?? 0;
    ctx.fillStyle = '#1a73e8';
    ctx.font = '10px Tahoma, sans-serif';
    ctx.fillText(
      `${Math.round(polar)}°`,
      x1 + Math.cos(ang) * 4 - 8,
      y1 + Math.sin(ang) * 4 + 3,
    );

    const gap = gaps[i] ?? 0;
    const midAng = ang + Math.PI / n;
    const gx = cx + Math.cos(midAng) * (pipeR + R * 0.55);
    const gy = cy + Math.sin(midAng) * (pipeR + R * 0.55);
    ctx.fillStyle = '#c0392b';
    ctx.fillText(`${Math.round(gap)}°`, gx - 10, gy + 3);
  }
}

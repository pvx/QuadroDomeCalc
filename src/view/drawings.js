/** Budget canvases: Edges (end-cut), Faces (sides+angles), Vertices (2-plane). */

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
    section('Edges (struts / cut list)', products.edgeGroups, drawStrut, 280, 150),
  );
  container.appendChild(
    section('Faces (panels)', products.faceGroups, drawFace, 280, 160),
  );
  container.appendChild(
    section('Vertices (Piped hubs)', products.hubGroups, drawHub, 300, 200),
  );
}

function section(title, groups, drawer, cw, ch) {
  const wrap = document.createElement('div');
  const h = document.createElement('h2');
  h.textContent = title;
  wrap.appendChild(h);

  const ul = document.createElement('ul');
  ul.className = 'budget-list';

  for (const g of groups) {
    const li = document.createElement('li');
    li.className = 'product';

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
    const a = Math.round(s.endCutDegA ?? 0);
    const b = Math.round(s.endCutDegB ?? 0);
    return `L=${Math.round(s.cutLength)} mm · cut ${a}°/${b}°`;
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

  const thickPx = Math.max(10, Math.min(32, (s.thickness / s.width) * 48));
  const y = H / 2 - 4;
  const x0 = 36;
  const x1 = W - 36;
  const lenPx = x1 - x0;

  // Offset of tip from square end along length, from endCutDeg
  const tip = (deg) =>
    Math.min(lenPx * 0.22, Math.tan(((deg || 0) * Math.PI) / 180) * (thickPx / 2));
  const tA = tip(s.endCutDegA);
  const tB = tip(s.endCutDegB);

  ctx.beginPath();
  ctx.moveTo(x0 + tA, y - thickPx / 2);
  ctx.lineTo(x1 - tB, y - thickPx / 2);
  ctx.lineTo(x1, y);
  ctx.lineTo(x1 - tB, y + thickPx / 2);
  ctx.lineTo(x0 + tA, y + thickPx / 2);
  ctx.lineTo(x0, y);
  ctx.closePath();
  ctx.fillStyle = '#f0f4f7';
  ctx.fill();
  ctx.strokeStyle = group.color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#333';
  ctx.font = '12px Tahoma, sans-serif';
  ctx.fillText(`${Math.round(s.cutLength)} mm`, (x0 + x1) / 2 - 28, y - thickPx / 2 - 10);

  ctx.font = '11px Tahoma, sans-serif';
  ctx.fillText(`${Math.round(s.endCutDegA ?? 0)}°`, 6, y + 4);
  ctx.fillText(`${Math.round(s.endCutDegB ?? 0)}°`, W - 28, y + 4);

  ctx.fillStyle = '#666';
  ctx.font = '10px Tahoma, sans-serif';
  ctx.fillText(
    `${Math.round(s.width)}×${Math.round(s.thickness)} · L/R/in ${fmtB(s.bevelSides[0])}/${fmtB(s.bevelSides[1])}/${fmtB(s.bevelInner)}`,
    8,
    H - 8,
  );
}

function fmtB(v) {
  return Math.round(v);
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
  const a = sides[0];
  const b = sides[1];
  const c = sides[2];
  const x2 = (c * c + a * a - b * b) / (2 * a);
  const y2 = Math.sqrt(Math.max(0, c * c - x2 * x2));
  const pts = [
    { x: 0, y: 0 },
    { x: a, y: 0 },
    { x: x2, y: -y2 },
  ];

  const pad = 36;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(
    (W - pad * 2) / (maxX - minX || 1),
    (H - pad * 2) / (maxY - minY || 1),
  );
  const mapped = pts.map((p) => ({
    x: pad + (p.x - minX) * scale,
    y: H - pad - (p.y - minY) * scale,
  }));

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

  ctx.fillStyle = '#333';
  ctx.font = '11px Tahoma, sans-serif';
  for (let i = 0; i < 3; i++) {
    const p = mapped[i];
    const q = mapped[(i + 1) % 3];
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    const ox = (mx - cx) * 0.15;
    const oy = (my - cy) * 0.15;
    ctx.fillText(`${Math.round(sides[i])}`, mx + ox - 12, my + oy - 2);
  }

  const angs = s.anglesDeg || [];
  ctx.font = '10px Tahoma, sans-serif';
  for (let i = 0; i < 3; i++) {
    const p = mapped[i];
    const label = `${(angs[i] ?? 0).toFixed(1)}°`;
    const lx = p.x + (cx - p.x) * 0.28;
    const ly = p.y + (cy - p.y) * 0.28;
    ctx.fillText(label, lx - 12, ly + 3);
  }
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

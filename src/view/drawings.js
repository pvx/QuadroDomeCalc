/** Budget canvases: Edges (end-cut), Faces (sides+angles), Vertices (2-plane). */

/** Standard OSB sheet, mm (long × short). */
export const OSB_SHEET_MM = { long: 2500, short: 1250 };

/** Default timber stock length for Edges packing (mm). */
export const DEFAULT_STOCK_MM = 6000;
/** Default saw kerf between pieces on one stock bar (mm). */
export const DEFAULT_KERF_MM = 3;

/** Survive Recalculate rebuild of the budget DOM. */
let stockLengthMm = DEFAULT_STOCK_MM;
let sawKerfMm = DEFAULT_KERF_MM;
/** Active budget tab id: edges | stock | faces | vertices */
let activeBudgetTab = 'edges';

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

/** Label cut angle (from long edge) → bevel from square (deg). */
function bevelFromLabel(cutLabel) {
  return Math.max(0, 90 - (cutLabel ?? 90));
}

/**
 * Nesting overlap along the stock when two matching bevels meet (mm).
 * One shared kerf; tips nest by width·tan(bevel).
 */
export function nestOverlapMm(widthMm, cutLabelDeg) {
  const bevel = bevelFromLabel(cutLabelDeg);
  if (!(bevel > 0) || !(widthMm > 0)) return 0;
  return widthMm * Math.tan((bevel * Math.PI) / 180);
}

function anglesMatch(a, b) {
  return Math.round(a) === Math.round(b);
}

function leftCut(piece, flipped) {
  return flipped ? piece.cutB : piece.cutA;
}

function rightCut(piece, flipped) {
  return flipped ? piece.cutA : piece.cutB;
}

function barUsedMm(bar) {
  if (!bar.pieces.length) return 0;
  const last = bar.pieces[bar.pieces.length - 1];
  return last.startMm + last.overallMm;
}

/**
 * Try placing `piece` at the end of `bar`. Returns placement or null.
 * Same open angle required; next piece is preferably flipped 180°.
 */
function tryPlace(bar, piece, kerfMm, stockMm) {
  if (piece.overallMm > stockMm + 1e-9) return null;
  if (!bar.pieces.length) {
    return { flipped: false, startMm: 0, usedMm: piece.overallMm, nest: 0 };
  }
  const last = bar.pieces[bar.pieces.length - 1];
  const open = rightCut(last, last.flipped);
  const opts = [];
  for (const flipped of [false, true]) {
    if (!anglesMatch(leftCut(piece, flipped), open)) continue;
    const nest = nestOverlapMm(piece.widthMm, open);
    const startMm = last.startMm + last.overallMm - nest + kerfMm;
    const usedMm = startMm + piece.overallMm;
    if (usedMm <= stockMm + 1e-6) {
      opts.push({ flipped, startMm, usedMm, nest });
    }
  }
  if (!opts.length) return null;
  opts.sort((a, b) => {
    const altA = a.flipped === !last.flipped ? 0 : 1;
    const altB = b.flipped === !last.flipped ? 0 : 1;
    if (altA !== altB) return altA - altB;
    return a.usedMm - b.usedMm;
  });
  return opts[0];
}

function appendPiece(bar, piece, place) {
  bar.pieces.push({
    ...piece,
    overallMm: piece.overallMm,
    flipped: place.flipped,
    startMm: place.startMm,
    nestMm: place.nest ?? 0,
  });
}

function sharesAngle(bar, piece) {
  for (const pl of bar.pieces) {
    if (
      anglesMatch(pl.cutA, piece.cutA) ||
      anglesMatch(pl.cutA, piece.cutB) ||
      anglesMatch(pl.cutB, piece.cutA) ||
      anglesMatch(pl.cutB, piece.cutB)
    ) {
      return true;
    }
  }
  return false;
}

function stripPlacement(p) {
  return {
    overallMm: p.overallMm,
    axisMm: p.axisMm,
    widthMm: p.widthMm,
    cutA: p.cutA,
    cutB: p.cutB,
    color: p.color,
    index: p.index,
    edgeId: p.edgeId,
  };
}

/** Move pieces off emptiest bars when that removes a bar. */
function emptyBars(bars, stockMm, kerfMm) {
  let list = bars.map((b) => ({
    pieces: b.pieces.map((p) => ({ ...p })),
  }));
  let progress = true;
  while (progress && list.length > 1) {
    progress = false;
    list.sort((a, b) => stockMm - barUsedMm(a) - (stockMm - barUsedMm(b)));
    for (let di = 0; di < list.length; di++) {
      const donor = list[di];
      const trial = list
        .filter((_, i) => i !== di)
        .map((b) => ({ pieces: b.pieces.map((p) => ({ ...p })) }));
      let ok = true;
      for (const placed of donor.pieces) {
        const raw = stripPlacement(placed);
        let best = null;
        for (let bi = 0; bi < trial.length; bi++) {
          const place = tryPlace(trial[bi], raw, kerfMm, stockMm);
          if (!place) continue;
          const leftover = stockMm - place.usedMm;
          if (
            !best ||
            leftover < best.leftover - 1e-6 ||
            (Math.abs(leftover - best.leftover) < 1e-6 &&
              sharesAngle(trial[bi], raw) &&
              !best.hasSame)
          ) {
            best = { bi, place, leftover, hasSame: sharesAngle(trial[bi], raw) };
          }
        }
        if (!best) {
          ok = false;
          break;
        }
        appendPiece(trial[best.bi], raw, best.place);
      }
      if (ok) {
        list = trial;
        progress = true;
        break;
      }
    }
  }
  return list;
}

/**
 * Pack edge pieces onto stock bars.
 * Same cut angle + 180° flip → one kerf and nested tips; minimize bar count.
 *
 * @param {object[]} pieces { overallMm, widthMm, cutA, cutB, color?, index?, ... }
 * @returns {{ bars: object[], oversized: object[], barCount: number }}
 */
export function packStockBars(pieces, stockMm, kerfMm = 0) {
  const stock = Math.max(0, Number(stockMm) || 0);
  const kerf = Math.max(0, Number(kerfMm) || 0);
  const oversized = [];
  const fit = [];
  for (const p of pieces || []) {
    if (!(p.overallMm > 0)) continue;
    if (p.overallMm > stock + 1e-9) oversized.push(p);
    else fit.push(p);
  }
  fit.sort((a, b) => b.overallMm - a.overallMm || (a.index || '').localeCompare(b.index || ''));

  let bars = [];
  for (const piece of fit) {
    let best = null;
    for (let bi = 0; bi < bars.length; bi++) {
      const place = tryPlace(bars[bi], piece, kerf, stock);
      if (!place) continue;
      const leftover = stock - place.usedMm;
      const hasSame = sharesAngle(bars[bi], piece);
      if (
        !best ||
        leftover < best.leftover - 1e-6 ||
        (Math.abs(leftover - best.leftover) < 1e-6 && hasSame && !best.hasSame)
      ) {
        best = { bi, place, leftover, hasSame };
      }
    }
    if (best) {
      appendPiece(bars[best.bi], piece, best.place);
    } else {
      const bar = { pieces: [] };
      const place = tryPlace(bar, piece, kerf, stock);
      if (!place) {
        oversized.push(piece);
        continue;
      }
      appendPiece(bar, piece, place);
      bars.push(bar);
    }
  }

  bars = emptyBars(bars, stock, kerf);

  return {
    bars: bars.map((b) => {
      const usedMm = barUsedMm(b);
      return {
        pieces: b.pieces,
        usedMm,
        leftoverMm: Math.max(0, stock - usedMm),
      };
    }),
    oversized,
    barCount: bars.length,
  };
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

  const tabs = [
    { id: 'edges', label: 'Edges (struts / cut list)' },
    { id: 'stock', label: 'Stock (timber bars)' },
    { id: 'faces', label: 'Faces (panels)' },
    { id: 'vertices', label: 'Vertices (Piped hubs)' },
  ];

  const tabList = document.createElement('div');
  tabList.className = 'budget-tabs';
  tabList.setAttribute('role', 'tablist');

  const panels = document.createElement('div');
  panels.className = 'budget-panels';

  const panelById = {
    edges: sectionPanel(products.edgeGroups, drawStrut, 420, 210),
    stock: stockPanel(products.edgeGroups),
    faces: sectionPanel(products.faceGroups, drawFace, 420, 240),
    vertices: sectionPanel(products.hubGroups, drawHub, 300, 200, {
      dataAttr: 'data-hub-index',
    }),
  };

  for (const t of tabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'budget-tab';
    btn.setAttribute('role', 'tab');
    btn.dataset.tab = t.id;
    btn.textContent = t.label;
    tabList.appendChild(btn);

    const panel = panelById[t.id];
    panel.classList.add('budget-panel');
    panel.dataset.tab = t.id;
    panel.setAttribute('role', 'tabpanel');
    panels.appendChild(panel);
  }

  const activate = (id) => {
    activeBudgetTab = id;
    tabList.querySelectorAll('.budget-tab').forEach((b) => {
      const on = b.dataset.tab === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panels.querySelectorAll('.budget-panel').forEach((p) => {
      p.hidden = p.dataset.tab !== id;
    });
  };

  tabList.addEventListener('click', (e) => {
    const btn = e.target.closest('.budget-tab');
    if (!btn) return;
    activate(btn.dataset.tab);
  });

  container.appendChild(tabList);
  container.appendChild(panels);
  activate(
    tabs.some((t) => t.id === activeBudgetTab) ? activeBudgetTab : 'edges',
  );
}

/** Build packing pieces from edge type groups (label angles = 90 − endCutDeg). */
export function piecesFromEdgeGroups(groups) {
  const pieces = [];
  for (const g of groups || []) {
    for (const u of g.units) {
      const cutA = Math.round(90 - (u.endCutDegA ?? 0));
      const cutB = Math.round(90 - (u.endCutDegB ?? 0));
      pieces.push({
        overallMm: strutOverallLength(
          u.cutLength,
          u.width,
          u.endCutDegA,
          u.endCutDegB,
        ),
        axisMm: u.cutLength,
        widthMm: u.width,
        cutA,
        cutB,
        color: g.color,
        index: g.index,
        edgeId: u.edgeId,
      });
    }
  }
  return pieces;
}

function renderStockBlock(container, groups, stockMm, kerfMm) {
  container.innerHTML = '';
  const packed = packStockBars(piecesFromEdgeGroups(groups), stockMm, kerfMm);

  const summary = document.createElement('p');
  summary.className = 'stock-summary';
  summary.textContent = `${packed.barCount} bars × ${Math.round(stockMm)} mm`;
  container.appendChild(summary);

  if (packed.oversized.length) {
    const warn = document.createElement('p');
    warn.className = 'stock-warn hint';
    const maxL = Math.max(...packed.oversized.map((p) => p.overallMm));
    warn.textContent = `${packed.oversized.length} piece(s) longer than stock (max ${Math.round(maxL)} mm)`;
    container.appendChild(warn);
  }

  const layout = document.createElement('div');
  layout.className = 'stock-layout';
  packed.bars.forEach((bar, i) => {
    const row = document.createElement('div');
    row.className = 'stock-bar-row';
    const cap = document.createElement('div');
    cap.className = 'stock-bar-cap';
    cap.textContent = `Bar ${i + 1} · used ${Math.round(bar.usedMm)} · left ${Math.round(bar.leftoverMm)}`;
    row.appendChild(cap);
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 90;
    canvas.className = 'stock-bar-canvas';
    drawStockBar(canvas, bar, stockMm);
    row.appendChild(canvas);
    layout.appendChild(row);
  });
  container.appendChild(layout);
}

/**
 * Draw one packed stock bar: trapezoids in stock scale, 180° flips, kerf, leftover.
 */
export function drawStockBar(canvas, bar, stockMm) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  const padL = 28;
  const padR = 12;
  const padT = 22;
  const padB = 18;
  const faceH = Math.max(22, Math.min(36, H * 0.38));
  const yTop = padT;
  const yBot = yTop + faceH;
  const scaleX = (W - padL - padR) / (stockMm || 1);

  // Full stock outline
  ctx.strokeStyle = '#9aa5b1';
  ctx.lineWidth = 1;
  ctx.strokeRect(padL, yTop, stockMm * scaleX, faceH);
  ctx.fillStyle = '#f7f9fb';
  ctx.fillRect(padL, yTop, stockMm * scaleX, faceH);

  dimH(ctx, padL, padL + stockMm * scaleX, yTop - 10, `${Math.round(stockMm)}`);

  for (const p of bar.pieces || []) {
    const tipA = nestOverlapMm(p.widthMm, leftCut(p, p.flipped));
    const tipB = nestOverlapMm(p.widthMm, rightCut(p, p.flipped));
    const x0 = padL + p.startMm * scaleX;
    const x1 = padL + (p.startMm + p.overallMm) * scaleX;
    // Long edge top when not flipped; bottom when flipped 180°
    let TL;
    let TR;
    let BL;
    let BR;
    if (!p.flipped) {
      TL = { x: x0, y: yTop };
      TR = { x: x1, y: yTop };
      BL = { x: x0 + tipA * scaleX, y: yBot };
      BR = { x: x1 - tipB * scaleX, y: yBot };
    } else {
      BL = { x: x0, y: yBot };
      BR = { x: x1, y: yBot };
      TL = { x: x0 + tipA * scaleX, y: yTop };
      TR = { x: x1 - tipB * scaleX, y: yTop };
    }

    ctx.beginPath();
    ctx.moveTo(TL.x, TL.y);
    ctx.lineTo(TR.x, TR.y);
    ctx.lineTo(BR.x, BR.y);
    ctx.lineTo(BL.x, BL.y);
    ctx.closePath();
    ctx.fillStyle = hexWithAlpha(p.color, 0.22);
    ctx.fill();
    ctx.strokeStyle = p.color || '#666';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const midX = (x0 + x1) / 2;
    const midY = (yTop + yBot) / 2 + 3;
    ctx.fillStyle = '#222';
    ctx.font = '10px Tahoma, sans-serif';
    ctx.textAlign = 'center';
    const wide = (x1 - x0) > 70;
    const label = wide
      ? `${p.index || ''} ${Math.round(p.overallMm)} · ${Math.round(p.cutA)}°/${Math.round(p.cutB)}°`
      : `${p.index || ''}`;
    ctx.fillText(label.trim(), midX, midY);
    ctx.textAlign = 'left';
  }

  if (bar.leftoverMm > 1) {
    const lx0 = padL + bar.usedMm * scaleX;
    const lx1 = padL + stockMm * scaleX;
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    ctx.fillRect(lx0, yTop, lx1 - lx0, faceH);
    ctx.fillStyle = '#888';
    ctx.font = '10px Tahoma, sans-serif';
    ctx.textAlign = 'center';
    if (lx1 - lx0 > 36) {
      ctx.fillText(`${Math.round(bar.leftoverMm)}`, (lx0 + lx1) / 2, yBot + 12);
    }
    ctx.textAlign = 'left';
  }
}

function hexWithAlpha(color, alpha) {
  if (!color) return `rgba(120,120,120,${alpha})`;
  // hsl(h, 78%, 52%) from palette
  const m = /^hsl\((\d+),\s*([\d.]+)%,\s*([\d.]+)%\)$/i.exec(String(color).trim());
  if (m) {
    return `hsla(${m[1]}, ${m[2]}%, ${m[3]}%, ${alpha})`;
  }
  return color;
}

/** Outline the Vertices card for hub type `index` (A, B, …); clear if null. */
export function highlightHubCard(container, index, color) {
  container.querySelectorAll('.product.is-hub-pick').forEach((el) => {
    el.classList.remove('is-hub-pick');
    el.style.removeProperty('--hub-pick-color');
  });
  if (index == null) return;
  const verticesTab = container.querySelector('.budget-tab[data-tab="vertices"]');
  if (verticesTab && activeBudgetTab !== 'vertices') {
    verticesTab.click();
  }
  const card = container.querySelector(`.product[data-hub-index="${index}"]`);
  if (!card) return;
  card.classList.add('is-hub-pick');
  if (color) card.style.setProperty('--hub-pick-color', color);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function sectionPanel(groups, drawer, cw, ch, opts = {}) {
  const wrap = document.createElement('div');
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

function stockPanel(edgeGroups) {
  const wrap = document.createElement('div');
  wrap.className = 'stock-section';

  if (!edgeGroups?.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No edge stock data.';
    wrap.appendChild(empty);
    return wrap;
  }

  const controls = document.createElement('div');
  controls.className = 'stock-controls';

  const stockLabel = document.createElement('label');
  stockLabel.textContent = 'Stock length, mm';
  const stockInput = document.createElement('input');
  stockInput.type = 'number';
  stockInput.min = '1';
  stockInput.step = '1';
  stockInput.value = String(stockLengthMm);
  stockInput.name = 'stockLengthMm';
  stockLabel.appendChild(stockInput);

  const kerfLabel = document.createElement('label');
  kerfLabel.textContent = 'Saw kerf, mm';
  const kerfInput = document.createElement('input');
  kerfInput.type = 'number';
  kerfInput.min = '0';
  kerfInput.step = '0.1';
  kerfInput.value = String(sawKerfMm);
  kerfInput.name = 'sawKerfMm';
  kerfLabel.appendChild(kerfInput);

  controls.appendChild(stockLabel);
  controls.appendChild(kerfLabel);
  wrap.appendChild(controls);

  const stockBlock = document.createElement('div');
  stockBlock.className = 'stock-block';
  wrap.appendChild(stockBlock);

  const refresh = () => {
    stockLengthMm = Math.max(1, Number(stockInput.value) || DEFAULT_STOCK_MM);
    sawKerfMm = Math.max(0, Number(kerfInput.value) || 0);
    stockInput.value = String(stockLengthMm);
    kerfInput.value = String(sawKerfMm);
    renderStockBlock(stockBlock, edgeGroups, stockLengthMm, sawKerfMm);
  };

  stockInput.addEventListener('change', refresh);
  stockInput.addEventListener('input', refresh);
  kerfInput.addEventListener('change', refresh);
  kerfInput.addEventListener('input', refresh);
  refresh();

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

/**
 * Canvas angles (rad, 0 = +x, CCW) for hub rays from azimuth gaps (deg).
 * Ray 0 at −π/2 (up); gap[i] is the sector from ray i to ray i+1.
 */
export function hubRayAngles(gapDeg) {
  const n = gapDeg.length;
  const angs = new Array(n);
  let a = -Math.PI / 2;
  for (let i = 0; i < n; i++) {
    angs[i] = a;
    a += ((gapDeg[i] || 0) * Math.PI) / 180;
  }
  return angs;
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
  const rayAngs = hubRayAngles(
    gaps.length === n ? gaps : Array.from({ length: n }, () => 360 / (n || 1)),
  );

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

  for (let i = 0; i < n; i++) {
    const ang = rayAngs[i];
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
    const next = rayAngs[(i + 1) % n] + (i + 1 === n ? 2 * Math.PI : 0);
    const midAng = (ang + next) / 2;
    const gx = cx + Math.cos(midAng) * (pipeR + R * 0.55);
    const gy = cy + Math.sin(midAng) * (pipeR + R * 0.55);
    ctx.fillStyle = '#c0392b';
    ctx.fillText(`${Math.round(gap)}°`, gx - 10, gy + 3);
  }
}

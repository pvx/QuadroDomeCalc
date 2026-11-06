/** Budget canvases: Edges (end-cut), Faces (sides+angles), Vertices (2-plane). */

/** Standard OSB sheet, mm (long × short). */
export const OSB_SHEET_MM = { long: 2500, short: 1250 };

/** Default timber stock length for Edges packing (mm). */
export const DEFAULT_STOCK_MM = 6000;
/** Default saw kerf between pieces on one stock bar (mm). */
export const DEFAULT_KERF_MM = 3;

/** Default steel sheet for hub ear nesting (mm). */
export const DEFAULT_EAR_SHEET_MM = { w: 1500, h: 3000 };
export const DEFAULT_EAR_LENGTH_MM = 200;
export const DEFAULT_EAR_WIDTH_MM = 150;
export const DEFAULT_EAR_HOLES = 2;
export const DEFAULT_EAR_HOLE_D_MM = 12;
export const DEFAULT_EAR_GAP_MM = 3;

/** Survive Recalculate rebuild of the budget DOM. */
let stockLengthMm = DEFAULT_STOCK_MM;
let sawKerfMm = DEFAULT_KERF_MM;
let earLengthMm = DEFAULT_EAR_LENGTH_MM;
let earWidthMm = DEFAULT_EAR_WIDTH_MM;
let earHoleCount = DEFAULT_EAR_HOLES;
let earHoleDMm = DEFAULT_EAR_HOLE_D_MM;
let earSheetWMm = DEFAULT_EAR_SHEET_MM.w;
let earSheetHMm = DEFAULT_EAR_SHEET_MM.h;
let earGapMm = DEFAULT_EAR_GAP_MM;
/** Active budget tab id: edges | stock | faces | vertices | ears */
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
 * Same open angle → nest + one kerf (prefer 180° flip). Different angle → kerf only.
 */
function tryPlace(bar, piece, kerfMm, stockMm) {
  if (piece.overallMm > stockMm + 1e-9) return null;
  if (!bar.pieces.length) {
    return { flipped: false, startMm: 0, usedMm: piece.overallMm, nest: 0 };
  }
  const last = bar.pieces[bar.pieces.length - 1];
  const open = rightCut(last, last.flipped);
  const lastEnd = last.startMm + last.overallMm;
  const opts = [];
  for (const flipped of [false, true]) {
    const match = anglesMatch(leftCut(piece, flipped), open);
    const nest = match ? nestOverlapMm(piece.widthMm, open) : 0;
    const startMm = lastEnd - nest + kerfMm;
    const usedMm = startMm + piece.overallMm;
    if (usedMm <= stockMm + 1e-6) {
      opts.push({ flipped, startMm, usedMm, nest, match });
    }
  }
  if (!opts.length) return null;
  // Prefer nesting (smaller used), then 180° alternation.
  opts.sort((a, b) => {
    if (Math.abs(a.usedMm - b.usedMm) > 1e-6) return a.usedMm - b.usedMm;
    const altA = a.flipped === !last.flipped ? 0 : 1;
    const altB = b.flipped === !last.flipped ? 0 : 1;
    return altA - altB;
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
 * Same cut angle + 180° flip → nest + one kerf; different angles still share a bar
 * (kerf only). Primary goal: minimize bar count, then leftover.
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

/** Round slant to 0.1° for grouping identical ears. */
export function earSlantKey(endCutDeg) {
  return Math.round((endCutDeg ?? 0) * 10) / 10;
}

/**
 * Right trapezoid ear: long L at y=0, short S at y=W, square left, slant right.
 * α = endCutDeg (from square). S = L − W·tan(α).
 */
export function earTrapezoid(lengthMm, widthMm, endCutDeg) {
  const L = Math.max(0, Number(lengthMm) || 0);
  const W = Math.max(0, Number(widthMm) || 0);
  const alpha = Math.max(0, Number(endCutDeg) || 0);
  const rad = (alpha * Math.PI) / 180;
  const run = W * Math.tan(rad);
  const S = L - run;
  const valid = S > 1e-9 && L > 0 && W > 0;
  const area = valid ? ((L + S) / 2) * W : 0;
  const outline = valid
    ? [
        { x: 0, y: 0 },
        { x: L, y: 0 },
        { x: S, y: W },
        { x: 0, y: W },
      ]
    : [];
  return { L, W, S, alpha, run, area, valid, outline };
}

/**
 * Hole centers on midline, shifted away from the slant to the square end.
 * Spaced along the short parallel side: x = k·S/(C+1), y = W/2.
 * α = 0 → S = L (unchanged).
 */
export function earHoleCenters(lengthMm, widthMm, count, holeDMm, endCutDeg = 0) {
  const W = Math.max(0, Number(widthMm) || 0);
  const C = Math.max(0, Math.floor(Number(count) || 0));
  const r = Math.max(0, (Number(holeDMm) || 0) / 2);
  const t = earTrapezoid(lengthMm, widthMm, endCutDeg);
  const span = t.valid ? t.S : Math.max(0, Number(lengthMm) || 0);
  const holes = [];
  for (let k = 1; k <= C; k++) {
    holes.push({ x: (k * span) / (C + 1), y: W / 2, r });
  }
  return holes;
}

/** True if a hole disk stays inside the trapezoid (incl. slant). */
export function earHoleFits(trap, hole) {
  if (!trap.valid) return false;
  const { x, y, r } = hole;
  if (x - r < -1e-9 || y - r < -1e-9 || y + r > trap.W + 1e-9) return false;
  // Left vertical x≥0 already; long/short via y. Slant: (L,0)–(S,W).
  // Line ax+by+c=0; signed distance toward interior (left of directed slant).
  const x1 = trap.L;
  const y1 = 0;
  const x2 = trap.S;
  const y2 = trap.W;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // inward normal (pointing toward −x / left): (dy, −dx) or opposite
  let nx = dy / len;
  let ny = -dx / len;
  // Ensure normal points toward interior (test point near left).
  if (nx * (0 - x1) + ny * (trap.W / 2 - y1) < 0) {
    nx = -nx;
    ny = -ny;
  }
  const dist = nx * (x - x1) + ny * (y - y1);
  if (dist < r - 1e-9) return false;
  // Short side: if x > S on top band, also need x+r ≤ local width at y.
  const localRight = trap.L - (trap.run * y) / (trap.W || 1);
  return x + r <= localRight + 1e-9;
}

/**
 * Pair bbox length when two identical ears nest slant-to-slant (180° flip).
 * Gap g is normal to the cut → adds g/cos(α) along the long axis.
 */
export function earPairLengthMm(lengthMm, widthMm, endCutDeg, gapMm = 0) {
  const t = earTrapezoid(lengthMm, widthMm, endCutDeg);
  if (!t.valid) return 0;
  const g = Math.max(0, Number(gapMm) || 0);
  const rad = (t.alpha * Math.PI) / 180;
  const along = g > 0 && Math.cos(rad) > 1e-9 ? g / Math.cos(rad) : g;
  return t.L + t.S + along;
}

/** Slant edge length of a right trapezoid ear (mm). */
export function earSlantLenMm(lengthMm, widthMm, endCutDeg) {
  const t = earTrapezoid(lengthMm, widthMm, endCutDeg);
  if (!t.valid) return 0;
  return Math.hypot(t.run, t.W);
}

/** Outer perimeter of one ear trapezoid, no holes (mm). */
export function earPerimeterMm(lengthMm, widthMm, endCutDeg) {
  const t = earTrapezoid(lengthMm, widthMm, endCutDeg);
  if (!t.valid) return 0;
  return t.L + t.S + t.W + Math.hypot(t.run, t.W);
}

/**
 * Total cut length for packed ear sheets (mm).
 * Gap ≈ 0 → shared edges cut once (nested pair slant + touching placement sides).
 * Holes: full circumference each.
 */
export function earSheetsCutLengthMm(
  sheets,
  gapMm = 0,
  holeCount = 0,
  holeDMm = 0,
) {
  const g = Math.max(0, Number(gapMm) || 0);
  const C = Math.max(0, Math.floor(Number(holeCount) || 0));
  const D = Math.max(0, Number(holeDMm) || 0);
  const holeOne = C * Math.PI * D;
  const share = g < 1e-9;
  let cut = 0;

  for (const sheet of sheets || []) {
    const pls = sheet.placements || [];
    for (const pl of pls) {
      for (const ear of pl.ears || []) {
        const a = ear.endCutDeg ?? pl.alpha;
        cut += earPerimeterMm(ear.lengthMm, ear.widthMm, a);
        cut += holeOne;
      }
      if (share && pl.kind === 'pair' && pl.ears?.length >= 2) {
        const e0 = pl.ears[0];
        cut -= earSlantLenMm(e0.lengthMm, e0.widthMm, e0.endCutDeg ?? pl.alpha);
      }
    }
    if (share && pls.length > 1) {
      cut -= sharedPlacementEdgesMm(pls);
    }
  }
  return Math.max(0, cut);
}

/** Length of coincident AABB edges between placements (gap = 0), counted once. */
function sharedPlacementEdgesMm(placements) {
  let shared = 0;
  const eps = 1e-6;
  for (let i = 0; i < placements.length; i++) {
    const a = placements[i];
    const ax1 = a.x;
    const ay1 = a.y;
    const ax2 = a.x + a.boxW;
    const ay2 = a.y + a.boxH;
    for (let j = i + 1; j < placements.length; j++) {
      const b = placements[j];
      const bx1 = b.x;
      const by1 = b.y;
      const bx2 = b.x + b.boxW;
      const by2 = b.y + b.boxH;
      // Vertical contact: a's right ↔ b's left (or swap)
      if (Math.abs(ax2 - bx1) < eps || Math.abs(bx2 - ax1) < eps) {
        const y0 = Math.max(ay1, by1);
        const y1 = Math.min(ay2, by2);
        if (y1 > y0 + eps) shared += y1 - y0;
      }
      // Horizontal contact: a's bottom ↔ b's top (or swap)
      if (Math.abs(ay2 - by1) < eps || Math.abs(by2 - ay1) < eps) {
        const x0 = Math.max(ax1, bx1);
        const x1 = Math.min(ax2, bx2);
        if (x1 > x0 + eps) shared += x1 - x0;
      }
    }
  }
  return shared;
}

/**
 * One ear per strut end from edge products.
 * @param {Map<number,string>|Record<number,string>} [hubColorByNode] nodeId → Vertices hub color
 */
export function earsFromEdgeProducts(
  edgeProducts,
  lengthMm,
  widthMm,
  hubColorByNode = null,
) {
  const colorOf = (nodeId) => {
    if (!hubColorByNode) return '#888888';
    if (typeof hubColorByNode.get === 'function') {
      return hubColorByNode.get(nodeId) || '#888888';
    }
    return hubColorByNode[nodeId] || '#888888';
  };
  const ears = [];
  for (const e of edgeProducts || []) {
    const ends = [
      { endCut: e.endCutDegA, hubNodeId: e.startNodeId },
      { endCut: e.endCutDegB, hubNodeId: e.endNodeId },
    ];
    for (const { endCut, hubNodeId } of ends) {
      const alpha = earSlantKey(endCut);
      const trap = earTrapezoid(lengthMm, widthMm, alpha);
      ears.push({
        edgeId: e.edgeId,
        hubNodeId,
        hubColor: colorOf(hubNodeId),
        endCutDeg: alpha,
        lengthMm: trap.L,
        widthMm: trap.W,
        shortMm: trap.S,
        areaMm2: trap.area,
        valid: trap.valid,
      });
    }
  }
  return ears;
}

/** nodeId → hub group color from Vertices (Piped hubs) cards. */
export function hubColorByNodeFromGroups(hubGroups) {
  const map = new Map();
  for (const g of hubGroups || []) {
    for (const u of g.units || []) map.set(u.id, g.color);
  }
  return map;
}

/**
 * Pack ears onto sheets: same slant → pairs (180°), then shelf rows.
 * Tries both sheet orientations; fewer sheets, then less scrap.
 *
 * @returns {{
 *   sheets: object[],
 *   sheetCount: number,
 *   sheetW: number,
 *   sheetH: number,
 *   totalAreaMm2: number,
 *   scrapRatio: number,
 *   oversized: object[],
 *   invalid: object[],
 *   holeWarnings: number,
 *   earCount: number,
 * }}
 */
export function packEarSheets(
  ears,
  sheetW,
  sheetH,
  gapMm = 0,
  holeOpts = {},
) {
  const g = Math.max(0, Number(gapMm) || 0);
  const holeCount = Math.max(0, Math.floor(Number(holeOpts.count) || 0));
  const holeD = Math.max(0, Number(holeOpts.diameterMm) || 0);

  const invalid = [];
  const valid = [];
  for (const e of ears || []) {
    if (!e.valid) invalid.push(e);
    else valid.push(e);
  }

  const totalAreaMm2 = valid.reduce((s, e) => s + e.areaMm2, 0);
  let holeWarnings = 0;
  for (const e of valid) {
    const trap = earTrapezoid(e.lengthMm, e.widthMm, e.endCutDeg);
    for (const h of earHoleCenters(
      e.lengthMm,
      e.widthMm,
      holeCount,
      holeD,
      e.endCutDeg,
    )) {
      if (!earHoleFits(trap, h)) holeWarnings += 1;
    }
  }

  if (!valid.length) {
    return {
      sheets: [],
      sheetCount: 0,
      sheetW: Number(sheetW) || 0,
      sheetH: Number(sheetH) || 0,
      totalAreaMm2: 0,
      scrapRatio: 0,
      cutLengthMm: 0,
      oversized: [],
      invalid,
      holeWarnings,
      earCount: (ears || []).length,
    };
  }

  // Group by slant
  const bySlant = new Map();
  for (const e of valid) {
    const k = earSlantKey(e.endCutDeg);
    if (!bySlant.has(k)) bySlant.set(k, []);
    bySlant.get(k).push(e);
  }

  /** Build placeable units (pairs + singles) for one orientation. */
  function unitsFor(sw, sh) {
    const usableW = sw - 2 * g;
    const usableH = sh - 2 * g;
    const oversized = [];
    const units = [];
    for (const [alpha, list] of bySlant) {
      const sample = list[0];
      const L = sample.lengthMm;
      const W = sample.widthMm;
      const pairLen = earPairLengthMm(L, W, alpha, g);
      const singleFits =
        L <= usableW + 1e-9 && W <= usableH + 1e-9;
      const pairFits =
        pairLen <= usableW + 1e-9 && W <= usableH + 1e-9;
      // Also allow rotating the unit 90° on the sheet (L along H).
      const singleRot =
        W <= usableW + 1e-9 && L <= usableH + 1e-9;
      const pairRot =
        W <= usableW + 1e-9 && pairLen <= usableH + 1e-9;

      let remaining = list.slice();
      while (remaining.length >= 2) {
        if (pairFits || pairRot) {
          const a = remaining.shift();
          const b = remaining.shift();
          units.push({
            kind: 'pair',
            alpha,
            ears: [a, b],
            boxW: pairFits ? pairLen : W,
            boxH: pairFits ? W : pairLen,
            rotatePair: !pairFits && pairRot,
          });
        } else if (singleFits || singleRot) {
          // Fall back to two singles
          for (let i = 0; i < 2 && remaining.length; i++) {
            const a = remaining.shift();
            units.push({
              kind: 'single',
              alpha,
              ears: [a],
              boxW: singleFits ? L : W,
              boxH: singleFits ? W : L,
              rotatePair: false,
            });
          }
        } else {
          oversized.push(...remaining.splice(0, 2));
        }
      }
      if (remaining.length === 1) {
        const a = remaining[0];
        if (singleFits || singleRot) {
          units.push({
            kind: 'single',
            alpha,
            ears: [a],
            boxW: singleFits ? L : W,
            boxH: singleFits ? W : L,
            rotatePair: false,
          });
        } else {
          oversized.push(a);
        }
      }
    }
    return { units, oversized, usableW, usableH };
  }

  function shelfPack(units, usableW, usableH, sw, sh) {
    const pool = units.slice();
    const sheets = [];

    function newSheet() {
      const sheet = {
        sheetW: sw,
        sheetH: sh,
        placements: [],
        cursorX: 0,
        cursorY: 0,
        rowH: 0,
      };
      sheets.push(sheet);
      return sheet;
    }

    function placeAt(sheet, u) {
      const x = g + sheet.cursorX;
      const y = g + sheet.cursorY;
      sheet.placements.push({
        ...u,
        x,
        y,
        holeCount,
        holeDMm: holeD,
      });
      sheet.cursorX += u.boxW + g;
      sheet.rowH = Math.max(sheet.rowH, u.boxH);
    }

    function singleFromEar(ear, alpha) {
      const L = ear.lengthMm;
      const W = ear.widthMm;
      return {
        kind: 'single',
        alpha,
        ears: [ear],
        boxW: L <= usableW + 1e-9 ? L : W,
        boxH: L <= usableW + 1e-9 ? W : L,
        rotatePair: false,
      };
    }

    /** Widest unit that fits remW × maxH; may split a pair into singles. */
    function pickFor(remW, maxH, openRow) {
      let best = null; // { index, unit, split?: single[] }
      for (let i = 0; i < pool.length; i++) {
        const u = pool[i];
        const fitsDirect =
          u.boxW <= remW + 1e-9 && u.boxH <= maxH + 1e-9;
        if (fitsDirect) {
          if (
            !best ||
            u.boxW > best.unit.boxW + 1e-9 ||
            (Math.abs(u.boxW - best.unit.boxW) < 1e-9 &&
              u.boxH > best.unit.boxH)
          ) {
            best = { index: i, unit: u };
          }
          continue;
        }
        if (u.kind !== 'pair') continue;
        const s0 = singleFromEar(u.ears[0], u.alpha);
        const s1 = singleFromEar(u.ears[1], u.alpha);
        // Both singles must fit the row height; first must fit remW.
        // Second may wrap only when opening would allow — here we only
        // fill the current residual, so require both in remW as a sequence
        // or at least the first in remW (place one now, leave other in pool).
        if (s0.boxH > maxH + 1e-9 || s1.boxH > maxH + 1e-9) continue;
        if (s0.boxW > remW + 1e-9) continue;
        // Prefer full pair-as-two if both fit in remW with gap between.
        const both =
          s0.boxW + g + s1.boxW <= remW + 1e-9;
        const split = both ? [s0, s1] : [s0];
        const fillW = both ? s0.boxW + g + s1.boxW : s0.boxW;
        const leftover = u.ears[1];
        if (
          !best ||
          fillW > best.unit.boxW + 1e-9 ||
          (Math.abs(fillW - best.unit.boxW) < 1e-9 && !best.split)
        ) {
          best = {
            index: i,
            unit: { ...u, boxW: fillW, boxH: Math.max(s0.boxH, s1.boxH) },
            split,
            leftover: both ? null : leftover,
            leftoverAlpha: u.alpha,
          };
        }
      }
      void openRow;
      return best;
    }

    let sheet = null;

    const take = (c, into) => {
      pool.splice(c.index, 1);
      if (c.split) {
        for (const s of c.split) placeAt(into, s);
        if (c.leftover) {
          pool.push(singleFromEar(c.leftover, c.leftoverAlpha));
        }
      } else {
        placeAt(into, c.unit);
      }
    };

    while (pool.length) {
      if (!sheet) sheet = newSheet();

      const remH = usableH - sheet.cursorY;
      // Open row: widest that fits in full width × remaining height
      let choice = pickFor(usableW, remH, false);
      if (!choice) {
        if (sheet.placements.length > 0) {
          sheet = newSheet();
          choice = pickFor(usableW, usableH, false);
        }
        if (!choice) {
          pool.shift();
          continue;
        }
      }

      take(choice, sheet);

      // Fill row residual with widest remaining that fits boxH ≤ rowH
      for (;;) {
        const remW = usableW - sheet.cursorX;
        if (remW <= 1e-9) break;
        const fill = pickFor(remW, sheet.rowH, true);
        if (!fill) break;
        take(fill, sheet);
      }

      // Close row
      sheet.cursorY += sheet.rowH + g;
      sheet.cursorX = 0;
      sheet.rowH = 0;
      if (sheet.cursorY + 1e-9 >= usableH) sheet = null;
    }

    return sheets.map(({ sheetW: w, sheetH: h, placements }) => ({
      sheetW: w,
      sheetH: h,
      placements,
    }));
  }

  function score(sheets, oversized, sw, sh) {
    const sheetCount = sheets.length;
    const scrap =
      sheetCount > 0
        ? (sheetCount * sw * sh - totalAreaMm2) / (sheetCount * sw * sh)
        : 0;
    return { sheetCount, scrap, oversized, sheets, sw, sh };
  }

  const o1 = unitsFor(sheetW, sheetH);
  const s1 = shelfPack(o1.units, o1.usableW, o1.usableH, sheetW, sheetH);
  const r1 = score(s1, o1.oversized, sheetW, sheetH);

  const o2 = unitsFor(sheetH, sheetW);
  const s2 = shelfPack(o2.units, o2.usableW, o2.usableH, sheetH, sheetW);
  const r2 = score(s2, o2.oversized, sheetH, sheetW);

  let best = r1;
  if (
    r2.sheetCount < r1.sheetCount ||
    (r2.sheetCount === r1.sheetCount && r2.scrap < r1.scrap - 1e-12) ||
    (r2.sheetCount === r1.sheetCount &&
      Math.abs(r2.scrap - r1.scrap) < 1e-12 &&
      r2.oversized.length < r1.oversized.length)
  ) {
    best = r2;
  }
  // Prefer orientation that packs when one has all oversized
  if (r1.sheets.length === 0 && r2.sheets.length > 0) best = r2;
  if (r2.sheets.length === 0 && r1.sheets.length > 0) best = r1;

  const cutLengthMm = earSheetsCutLengthMm(
    best.sheets,
    g,
    holeCount,
    holeD,
  );

  return {
    sheets: best.sheets,
    sheetCount: best.sheetCount,
    sheetW: best.sw,
    sheetH: best.sh,
    totalAreaMm2,
    scrapRatio: best.scrap,
    cutLengthMm,
    oversized: best.oversized,
    invalid,
    holeWarnings,
    earCount: (ears || []).length,
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
    { id: 'ears', label: 'Ears (hub plates)' },
    { id: 'vertices', label: 'Vertices (Piped hubs)' },
  ];

  const tabList = document.createElement('div');
  tabList.className = 'budget-tabs';
  tabList.setAttribute('role', 'tablist');

  const panels = document.createElement('div');
  panels.className = 'budget-panels';

  const panelById = {
    edges: edgesPanel(products.edgeGroups),
    stock: stockPanel(products.edgeGroups),
    ears: earsPanel(products.edgeProducts, products.hubGroups),
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

/**
 * Edges cut list as JSON: stock length `r` + rows { name, length, qty } (all strings).
 * `length` = overall strut envelope (same «len.» as the Edges cards).
 */
export function edgeCutListJson(edgeGroups, stockMm) {
  return JSON.stringify(
    {
      r: String(Math.round(Number(stockMm) || 0)),
      rows: (edgeGroups || []).map((g) => {
        const s = g.sample;
        const length = Math.round(
          strutOverallLength(s.cutLength, s.width, s.endCutDegA, s.endCutDegB),
        );
        return {
          name: String(g.index),
          length: String(length),
          qty: String(g.count),
        };
      }),
    },
    null,
    2,
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
  const sample = groups?.[0]?.sample;
  const w = sample?.width;
  const t = sample?.thickness;
  let summaryText = `${packed.barCount} bars × ${Math.round(stockMm)} mm`;
  if (packed.barCount > 0 && w > 0 && t > 0) {
    const volM3 = (packed.barCount * stockMm * w * t) / 1e9;
    summaryText += ` ( ${volM3.toFixed(3)} m³ )`;
  }
  summary.textContent = summaryText;
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

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function edgesPanel(edgeGroups) {
  const wrap = sectionPanel(edgeGroups, drawStrut, 420, 210);
  const controls = document.createElement('div');
  controls.className = 'stock-controls';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'linkish';
  btn.textContent = 'Export JSON';
  btn.addEventListener('click', () => {
    downloadText(
      edgeCutListJson(edgeGroups, stockLengthMm),
      'quadro-edges-cutlist.json',
    );
  });
  controls.appendChild(btn);
  wrap.prepend(controls);
  return wrap;
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

function numField(labelText, name, value, attrs = {}) {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'number';
  input.name = name;
  input.value = String(value);
  for (const [k, v] of Object.entries(attrs)) input.setAttribute(k, String(v));
  label.appendChild(input);
  return { label, input };
}

function earsPanel(edgeProducts, hubGroups) {
  const wrap = document.createElement('div');
  wrap.className = 'stock-section';

  if (!edgeProducts?.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No Piped ear data.';
    wrap.appendChild(empty);
    return wrap;
  }
  const hubColors = hubColorByNodeFromGroups(hubGroups);

  const controls = document.createElement('div');
  controls.className = 'stock-controls';

  const len = numField('Ear length, mm', 'earLengthMm', earLengthMm, {
    min: 1,
    step: 1,
  });
  const wid = numField('Ear width, mm', 'earWidthMm', earWidthMm, {
    min: 1,
    step: 1,
  });
  const holes = numField('Holes', 'earHoleCount', earHoleCount, {
    min: 0,
    step: 1,
  });
  const holeD = numField('Hole Ø, mm', 'earHoleDMm', earHoleDMm, {
    min: 0,
    step: 0.1,
  });
  const sw = numField('Sheet W, mm', 'earSheetWMm', earSheetWMm, {
    min: 1,
    step: 1,
  });
  const sh = numField('Sheet H, mm', 'earSheetHMm', earSheetHMm, {
    min: 1,
    step: 1,
  });
  const gap = numField('Gap, mm', 'earGapMm', earGapMm, {
    min: 0,
    step: 0.1,
  });

  for (const f of [len, wid, holes, holeD, sw, sh, gap]) {
    controls.appendChild(f.label);
  }
  wrap.appendChild(controls);

  const block = document.createElement('div');
  block.className = 'stock-block';
  wrap.appendChild(block);

  const refresh = () => {
    earLengthMm = Math.max(1, Number(len.input.value) || DEFAULT_EAR_LENGTH_MM);
    earWidthMm = Math.max(1, Number(wid.input.value) || DEFAULT_EAR_WIDTH_MM);
    earHoleCount = Math.max(0, Math.floor(Number(holes.input.value) || 0));
    earHoleDMm = Math.max(0, Number(holeD.input.value) || 0);
    earSheetWMm = Math.max(1, Number(sw.input.value) || DEFAULT_EAR_SHEET_MM.w);
    earSheetHMm = Math.max(1, Number(sh.input.value) || DEFAULT_EAR_SHEET_MM.h);
    earGapMm = Math.max(0, Number(gap.input.value) || 0);
    len.input.value = String(earLengthMm);
    wid.input.value = String(earWidthMm);
    holes.input.value = String(earHoleCount);
    holeD.input.value = String(earHoleDMm);
    sw.input.value = String(earSheetWMm);
    sh.input.value = String(earSheetHMm);
    gap.input.value = String(earGapMm);
    renderEarsBlock(block, edgeProducts, {
      lengthMm: earLengthMm,
      widthMm: earWidthMm,
      holeCount: earHoleCount,
      holeDMm: earHoleDMm,
      sheetW: earSheetWMm,
      sheetH: earSheetHMm,
      gapMm: earGapMm,
      hubColors,
    });
  };

  for (const f of [len, wid, holes, holeD, sw, sh, gap]) {
    f.input.addEventListener('change', refresh);
    f.input.addEventListener('input', refresh);
  }
  refresh();

  return wrap;
}

function renderEarsBlock(container, edgeProducts, opts) {
  container.innerHTML = '';
  const ears = earsFromEdgeProducts(
    edgeProducts,
    opts.lengthMm,
    opts.widthMm,
    opts.hubColors,
  );
  const packed = packEarSheets(ears, opts.sheetW, opts.sheetH, opts.gapMm, {
    count: opts.holeCount,
    diameterMm: opts.holeDMm,
  });

  const summary = document.createElement('p');
  summary.className = 'stock-summary';
  const areaM2 = packed.totalAreaMm2 / 1e6;
  const scrapPct = (packed.scrapRatio * 100).toFixed(1);
  const cutM = (packed.cutLengthMm || 0) / 1000;
  summary.textContent =
    `${packed.earCount} ears · ${packed.sheetCount} sheets × ` +
    `${Math.round(packed.sheetW)}×${Math.round(packed.sheetH)} mm · ` +
    `parts ${areaM2.toFixed(3)} m² · scrap ${scrapPct}% · ` +
    `cut ${cutM.toFixed(3)} m`;
  container.appendChild(summary);

  if (packed.invalid.length) {
    const warn = document.createElement('p');
    warn.className = 'stock-warn hint';
    warn.textContent = `${packed.invalid.length} ear(s) invalid (short side ≤ 0 for given slant)`;
    container.appendChild(warn);
  }
  if (packed.oversized.length) {
    const warn = document.createElement('p');
    warn.className = 'stock-warn hint';
    warn.textContent = `${packed.oversized.length} ear(s) larger than sheet`;
    container.appendChild(warn);
  }
  if (packed.holeWarnings > 0) {
    const warn = document.createElement('p');
    warn.className = 'stock-warn hint';
    warn.textContent = `${packed.holeWarnings} hole(s) intersect the slant edge`;
    container.appendChild(warn);
  }

  const layout = document.createElement('div');
  layout.className = 'stock-layout';
  packed.sheets.forEach((sheet, i) => {
    const row = document.createElement('div');
    row.className = 'stock-bar-row';
    const cap = document.createElement('div');
    cap.className = 'stock-bar-cap';
    const n = sheet.placements.reduce((s, p) => s + p.ears.length, 0);
    cap.textContent = `Sheet ${i + 1} · ${n} ears · ${Math.round(sheet.sheetW)}×${Math.round(sheet.sheetH)}`;
    row.appendChild(cap);
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = Math.max(
      160,
      Math.round((720 * sheet.sheetH) / sheet.sheetW),
    );
    drawEarSheet(canvas, sheet);
    row.appendChild(canvas);
    layout.appendChild(row);
  });
  container.appendChild(layout);
}

/** Draw one sheet with nested ear trapezoids + holes. */
function drawEarSheet(canvas, sheet) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f4f6f8';
  ctx.fillRect(0, 0, W, H);

  const pad = 12;
  const sw = sheet.sheetW;
  const sh = sheet.sheetH;
  const scale = Math.min((W - 2 * pad) / sw, (H - 2 * pad) / sh);
  const ox = pad;
  const oy = pad;

  const toPx = (x, y) => ({ x: ox + x * scale, y: oy + y * scale });

  // Sheet outline
  const a = toPx(0, 0);
  const b = toPx(sw, 0);
  const c = toPx(sw, sh);
  const d = toPx(0, sh);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = '#7a8694';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  for (const pl of sheet.placements) {
    drawEarPlacement(ctx, pl, toPx, scale);
  }
}

function drawEarPlacement(ctx, pl, toPx, scale) {
  const alpha = pl.alpha;
  const ear0 = pl.ears[0];
  const L = ear0.lengthMm;
  const W = ear0.widthMm;
  const trap = earTrapezoid(L, W, alpha);
  const holes = earHoleCenters(
    L,
    W,
    pl.holeCount || 0,
    pl.holeDMm || 0,
    alpha,
  );
  const pairSpan =
    pl.kind === 'pair' ? (pl.rotatePair ? pl.boxH : pl.boxW) : L;
  const rotated =
    pl.rotatePair ||
    (pl.kind === 'single' && Math.abs(pl.boxW - W) < 1e-6);

  // Local ear (ex,ey) → sheet mm. Flipped = 180° nest: (span−ex, W−ey).
  const mapEar = (ex, ey, flipped) => {
    const lx = flipped ? pairSpan - ex : ex;
    const ly = flipped ? W - ey : ey;
    const sx = rotated ? pl.x + ly : pl.x + lx;
    const sy = rotated ? pl.y + lx : pl.y + ly;
    return toPx(sx, sy);
  };

  const drawOne = (flipped, ear) => {
    if (!trap.outline.length) return;
    const pts = trap.outline.map((p) => mapEar(p.x, p.y, flipped));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = ear?.hubColor || '#888888';
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#2c3e50';
    ctx.lineWidth = 1;
    ctx.stroke();

    for (const h of holes) {
      const c = mapEar(h.x, h.y, flipped);
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(1, h.r * scale), 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#555';
      ctx.stroke();
    }
  };

  if (pl.kind === 'pair') {
    drawOne(false, pl.ears[0]);
    drawOne(true, pl.ears[1]);
  } else {
    drawOne(false, pl.ears[0]);
  }

  const labelAt = toPx(pl.x + pl.boxW / 2, pl.y + pl.boxH / 2);
  ctx.fillStyle = '#1a73e8';
  ctx.font = '20px Tahoma, sans-serif';
  ctx.fillText(`${alpha}°`, labelAt.x - 16, labelAt.y + 6);
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

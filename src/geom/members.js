/**
 * Solid timber placement: prism with ends || Piped axis.
 * Units match callers (mm or m). No Three.js.
 */

import { hubWallNormal } from './piped.js';

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function len(v) {
  return Math.hypot(v.x, v.y, v.z);
}
function norm(v) {
  const L = len(v) || 1;
  return { x: v.x / L, y: v.y / L, z: v.z / L };
}

/**
 * Timber box along edge A→B, shortened by hub cuts at both ends.
 * Frame: axisX = thickness (tangent), axisY = along edge, axisZ = width (outward).
 */
export function timberSegment(a, b, cutA, cutB, outward) {
  const chord = sub(b, a);
  const chordLen = len(chord);
  const dir = norm(chord);
  const cutAClamped = Math.max(0, Math.min(cutA, chordLen * 0.49));
  const cutBClamped = Math.max(0, Math.min(cutB, chordLen * 0.49));
  const length = Math.max(1e-9, chordLen - cutAClamped - cutBClamped);

  const start = add(a, scale(dir, cutAClamped));
  const center = add(start, scale(dir, length / 2));

  let widthAxis = sub(outward, scale(dir, dot(outward, dir)));
  if (len(widthAxis) < 1e-9) {
    const fallback =
      Math.abs(dir.z) < 0.9
        ? { x: 0, y: 0, z: 1 }
        : { x: 1, y: 0, z: 0 };
    widthAxis = sub(fallback, scale(dir, dot(fallback, dir)));
  }
  const axisZ = norm(widthAxis);
  const axisX = norm(cross(dir, axisZ));
  const axisY = dir;

  return {
    center,
    length,
    axisX,
    axisY,
    axisZ,
  };
}

/**
 * Intersect line origin + t·dir with plane (point, normal).
 */
function hitPlane(origin, dir, point, normal) {
  const denom = dot(dir, normal);
  if (Math.abs(denom) < 1e-12) {
    // parallel: fall back to projecting origin onto plane along normal
    return add(origin, scale(normal, -dot(sub(origin, point), normal)));
  }
  const t = dot(sub(point, origin), normal) / denom;
  return add(origin, scale(dir, t));
}

/**
 * Hexahedron timber: rectangular section, ends on planes || pipe axes at hubs.
 * cornersA[0..3] at hub A, cornersB[0..3] at hub B (same section corner order).
 *
 * @returns {{ cornersA: object[], cornersB: object[], axisX, axisY, axisZ, center, length }}
 */
export function timberPrism(a, b, cutA, cutB, radA, radB, thickness, width) {
  const dir = norm(sub(b, a));
  const mid = scale(add(a, b), 0.5);
  const outward = radA && radB ? scale(add(radA, radB), 0.5) : mid;
  const seg = timberSegment(a, b, cutA, cutB, outward);
  const { axisX, axisZ } = seg;
  const ht = thickness / 2;
  const hw = width / 2;

  const nA = hubWallNormal(dir, radA);
  const nB = hubWallNormal(scale(dir, -1), radB);
  const pA = add(a, scale(dir, cutA));
  const pB = add(b, scale(dir, -cutB));

  const signs = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];

  const cornersA = [];
  const cornersB = [];
  for (const [sx, sz] of signs) {
    const offset = add(scale(axisX, sx * ht), scale(axisZ, sz * hw));
    const origin = add(a, offset);
    cornersA.push(hitPlane(origin, dir, pA, nA));
    cornersB.push(hitPlane(origin, dir, pB, nB));
  }

  return {
    cornersA,
    cornersB,
    axisX: seg.axisX,
    axisY: seg.axisY,
    axisZ: seg.axisZ,
    center: seg.center,
    length: seg.length,
  };
}

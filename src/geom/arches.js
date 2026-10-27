/**
 * Ideal smooth arches in vertical planes x=±a/2, y=±a/2,
 * and optional equal-angle polyline discretization (analytical mode only).
 */
import { archRho, GEOM_EPS } from './sphere.js';

/**
 * Equal-angle samples for side y = +a/2.
 * @param {*} sphere
 * @param {number} segments number of straight segments (≥1)
 */
export function sampleArchYPositive(sphere, segments = 16) {
  const { a, c } = sphere;
  const rho = archRho(sphere);
  if (rho < GEOM_EPS) throw new Error('Arch radius rho is too small.');

  const half = a / 2;
  const ratio = half / rho;
  if (ratio > 1 + GEOM_EPS) {
    throw new Error(`arcsin: (a/2)/rho = ${ratio} > 1.`);
  }
  const alpha = Math.asin(Math.min(1, Math.max(-1, ratio)));
  const n = Math.max(1, Math.floor(segments));
  const points = [];

  for (let i = 0; i <= n; i++) {
    const theta = -alpha + (2 * alpha * i) / n;
    points.push({
      x: rho * Math.sin(theta),
      y: half,
      z: c + rho * Math.cos(theta),
      theta,
    });
  }
  return { side: 'y+', rho, alpha, points };
}

/** Four arches by D4 symmetry from y=+a/2. */
export function sampleAllArches(sphere, segments = 16) {
  const base = sampleArchYPositive(sphere, segments);
  const rotate = (p, k) => {
    // k * 90° around Z: (x,y) → (-y,x)
    let { x, y, z } = p;
    for (let i = 0; i < k; i++) {
      const nx = -y;
      const ny = x;
      x = nx;
      y = ny;
    }
    return { x, y, z };
  };

  const sides = [
    { side: 'y+', points: base.points },
    { side: 'x-', points: base.points.map((p) => rotate(p, 1)) },
    { side: 'y-', points: base.points.map((p) => rotate(p, 2)) },
    { side: 'x+', points: base.points.map((p) => rotate(p, 3)) },
  ];

  return {
    mode: 'equal-angle-analytical',
    note:
      'Equal-angle discretization — analytical mode. Not aligned with the XY mesh.',
    rho: base.rho,
    alpha: base.alpha,
    sides,
  };
}

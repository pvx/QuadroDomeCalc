/**
 * Ideal smooth arches in vertical planes x=±a/2, y=±b/2,
 * and optional equal-angle polyline discretization (analytical mode only).
 */
import { archRhoAt, GEOM_EPS } from './sphere.js';

/**
 * Equal-angle samples for side y = +b/2.
 */
export function sampleArchYPositive(sphere, segments = 16) {
  const a = sphere.a;
  const b = sphere.b ?? a;
  const { c } = sphere;
  const halfB = b / 2;
  const rho = archRhoAt(sphere, halfB);
  if (rho < GEOM_EPS) throw new Error('Arch radius rho is too small.');

  const halfAlong = a / 2;
  const ratio = halfAlong / rho;
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
      y: halfB,
      z: c + rho * Math.cos(theta),
      theta,
    });
  }
  return { side: 'y+', rho, alpha, points };
}

/**
 * Equal-angle samples for side x = +a/2.
 */
export function sampleArchXPositive(sphere, segments = 16) {
  const a = sphere.a;
  const b = sphere.b ?? a;
  const { c } = sphere;
  const halfA = a / 2;
  const rho = archRhoAt(sphere, halfA);
  if (rho < GEOM_EPS) throw new Error('Arch radius rho is too small.');

  const halfAlong = b / 2;
  const ratio = halfAlong / rho;
  if (ratio > 1 + GEOM_EPS) {
    throw new Error(`arcsin: (b/2)/rho = ${ratio} > 1.`);
  }
  const alpha = Math.asin(Math.min(1, Math.max(-1, ratio)));
  const n = Math.max(1, Math.floor(segments));
  const points = [];

  for (let i = 0; i <= n; i++) {
    const theta = -alpha + (2 * alpha * i) / n;
    points.push({
      x: halfA,
      y: rho * Math.sin(theta),
      z: c + rho * Math.cos(theta),
      theta,
    });
  }
  return { side: 'x+', rho, alpha, points };
}

/** Four arches by mirroring (works for square and rectangle). */
export function sampleAllArches(sphere, segments = 16) {
  const yPlus = sampleArchYPositive(sphere, segments);
  const xPlus = sampleArchXPositive(sphere, segments);

  const sides = [
    { side: 'y+', points: yPlus.points },
    {
      side: 'y-',
      points: yPlus.points.map((p) => ({ x: p.x, y: -p.y, z: p.z, theta: p.theta })),
    },
    { side: 'x+', points: xPlus.points },
    {
      side: 'x-',
      points: xPlus.points.map((p) => ({ x: -p.x, y: p.y, z: p.z, theta: p.theta })),
    },
  ];

  return {
    mode: 'equal-angle-analytical',
    note:
      'Equal-angle discretization — analytical mode. Not aligned with the XY mesh.',
    rhoY: yPlus.rho,
    rhoX: xPlus.rho,
    rho: yPlus.rho,
    alphaY: yPlus.alpha,
    alphaX: xPlus.alpha,
    alpha: yPlus.alpha,
    sides,
  };
}

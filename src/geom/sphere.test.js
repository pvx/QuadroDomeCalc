import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sphereFromSupports,
  surfaceZ,
  archRho,
  archMidHeight,
} from './sphere.js';
import { aFromDiagonalOnAxes, hFromA, REFERENCE_MM } from './index.js';

describe('sphereFromSupports', () => {
  const a = aFromDiagonalOnAxes(REFERENCE_MM.diagonalOnAxes);
  const h = REFERENCE_MM.heightSurface;

  it('matches formulas for reference pavilion dims', () => {
    const s = sphereFromSupports(a, h);
    assert.ok(Math.abs(s.c - (h / 2 - (a * a) / (4 * h))) < 1e-9);
    assert.ok(Math.abs(s.R - (h / 2 + (a * a) / (4 * h))) < 1e-9);
    assert.ok(s.c <= 0);
    assert.ok(h <= s.hMax + 1e-9);
  });

  it('passes through supports and apex', () => {
    const s = sphereFromSupports(a, h);
    const zCorner = surfaceZ(a / 2, a / 2, s);
    assert.ok(Math.abs(zCorner) < 1e-6, `corner z=${zCorner}`);
    assert.ok(Math.abs(surfaceZ(0, 0, s) - h) < 1e-6);
  });

  it('rejects h > hypot(a,b)/2 with clear error', () => {
    assert.throws(
      () => sphereFromSupports(1000, 1000 / Math.SQRT2 + 1),
      /does not support/,
    );
  });

  it('rectangle: corners at z=0 and hMax = hypot(a,b)/2', () => {
    const ar = 8000;
    const br = 5000;
    const hr = Math.min(3000, Math.hypot(ar, br) / 2 * 0.9);
    const s = sphereFromSupports(ar, hr, br);
    assert.ok(Math.abs(s.hMax - Math.hypot(ar, br) / 2) < 1e-9);
    assert.equal(s.b, br);
    assert.ok(Math.abs(surfaceZ(ar / 2, br / 2, s)) < 1e-6);
    assert.ok(Math.abs(surfaceZ(-ar / 2, -br / 2, s)) < 1e-6);
    assert.ok(Math.abs(surfaceZ(0, 0, s) - hr) < 1e-6);
  });

  it('rejects point far outside disc', () => {
    const s = sphereFromSupports(a, h);
    assert.throws(() => surfaceZ(s.R + 10, 0, s), /outside the horizontal/);
  });

  it('arch mid height = c + rho', () => {
    const s = sphereFromSupports(a, h);
    assert.equal(archMidHeight(s), s.c + archRho(s));
  });

  it('hFromA keeps reference ratio and stays under a/√2', () => {
    const h0 = hFromA(a);
    assert.ok(Math.abs(h0 - h) < 1, `expected ~${h}, got ${h0}`);
    const a2 = a * 1.5;
    const h2 = hFromA(a2);
    assert.ok(h2 <= a2 / Math.SQRT2);
    assert.ok(Math.abs(h2 / a2 - h / a) < 1e-6 || h2 >= a2 / Math.SQRT2 * 0.99);
  });
});

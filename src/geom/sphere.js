/**
 * Sphere through four corner supports (±a/2, ±a/2, 0) and apex (0, 0, h).
 * Upper-branch graph model: z = c + sqrt(R² - x² - y²), requires c ≤ 0 ⟺ 0 < h ≤ a/√2.
 */

const EPS = 1e-10;

/**
 * @param {number} a side of support square on axes (same units as h)
 * @param {number} h apex height above support plane
 * @returns {{ a:number, h:number, c:number, R:number, hMax:number }}
 */
export function sphereFromSupports(a, h) {
  if (!(a > 0)) throw new Error('Parameter a (axis-to-axis side) must be > 0.');
  if (!(h > 0)) throw new Error('Parameter h (apex height) must be > 0.');

  const hMax = a / Math.SQRT2;
  if (h > hMax + EPS) {
    throw new Error(
      `Graph surface z=c+√(R²−x²−y²) does not support h > a/√2. ` +
        `Now h=${fmt(h)}, a/√2=${fmt(hMax)}. A different surface representation is required.`,
    );
  }

  const c = h / 2 - (a * a) / (4 * h);
  const R = h / 2 + (a * a) / (4 * h);

  if (!(R > 0)) throw new Error('Sphere radius R is not positive.');
  if (c > EPS) {
    throw new Error(
      `Internal error: h ≤ a/√2 should give c ≤ 0, got c=${fmt(c)}.`,
    );
  }

  return { a, h, c, R, hMax };
}

/**
 * Upper branch z(x,y). Throws if point is substantially outside the sphere disc.
 */
export function surfaceZ(x, y, sphere) {
  const { c, R } = sphere;
  const r2 = x * x + y * y;
  const under = R * R - r2;
  if (under < -EPS) {
    throw new Error(
      `Point (x,y)=(${fmt(x)},${fmt(y)}) is outside the horizontal projection of the sphere (R²−x²−y²=${fmt(under)}).`,
    );
  }
  const s = under < 0 ? 0 : Math.sqrt(under);
  return c + s;
}

/** Arch circle radius in a vertical face plane x=±a/2 or y=±a/2. */
export function archRho(sphere) {
  const { a, R } = sphere;
  const under = R * R - (a * a) / 4;
  if (under < -EPS) {
    throw new Error(`Arch: R² − a²/4 < 0 (${fmt(under)}).`);
  }
  return under < 0 ? 0 : Math.sqrt(under);
}

/** Mid-arch opening height f = c + rho (ideal smooth surface). */
export function archMidHeight(sphere) {
  return sphere.c + archRho(sphere);
}

function fmt(n) {
  return Number(n).toPrecision(8);
}

export const GEOM_EPS = EPS;

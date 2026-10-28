/**
 * Sphere through four corner supports (±a/2, ±b/2, 0) and apex (0, 0, h).
 * Upper-branch graph model: z = c + sqrt(R² - x² - y²), requires c ≤ 0 ⟺ 0 < h ≤ hypot(a,b)/2.
 */

const EPS = 1e-10;

/**
 * @param {number} a length of support rectangle on X (same units as h)
 * @param {number} h apex height above support plane
 * @param {number} [b=a] width of support rectangle on Y
 * @returns {{ a:number, b:number, h:number, c:number, R:number, hMax:number }}
 */
export function sphereFromSupports(a, h, b = a) {
  if (!(a > 0)) throw new Error('Parameter a (axis-to-axis length) must be > 0.');
  if (!(b > 0)) throw new Error('Parameter b (axis-to-axis width) must be > 0.');
  if (!(h > 0)) throw new Error('Parameter h (apex height) must be > 0.');

  const hMax = Math.hypot(a, b) / 2;
  if (h > hMax + EPS) {
    throw new Error(
      `Graph surface z=c+√(R²−x²−y²) does not support h > hypot(a,b)/2. ` +
        `Now h=${fmt(h)}, hypot(a,b)/2=${fmt(hMax)}. A different surface representation is required.`,
    );
  }

  const d2 = (a * a + b * b) / 4;
  const c = h / 2 - d2 / (2 * h);
  const R = h / 2 + d2 / (2 * h);

  if (!(R > 0)) throw new Error('Sphere radius R is not positive.');
  if (c > EPS) {
    throw new Error(
      `Internal error: h ≤ hypot(a,b)/2 should give c ≤ 0, got c=${fmt(c)}.`,
    );
  }

  return { a, b, h, c, R, hMax };
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

/** Arch circle radius in vertical face plane at half-span (a/2 or b/2). */
export function archRhoAt(sphere, halfSpan) {
  const { R } = sphere;
  const under = R * R - halfSpan * halfSpan;
  if (under < -EPS) {
    throw new Error(`Arch: R² − half² < 0 (${fmt(under)}).`);
  }
  return under < 0 ? 0 : Math.sqrt(under);
}

/** Arch radius in planes x=±a/2 (legacy single-rho when a=b). */
export function archRho(sphere) {
  return archRhoAt(sphere, sphere.a / 2);
}

/** Arch radius in planes y=±b/2. */
export function archRhoY(sphere) {
  const b = sphere.b ?? sphere.a;
  return archRhoAt(sphere, b / 2);
}

/** Mid-arch opening height on the a-face (x=±a/2): f = c + rho. */
export function archMidHeight(sphere) {
  return sphere.c + archRho(sphere);
}

/** Mid-arch opening height on the b-face (y=±b/2). */
export function archMidHeightY(sphere) {
  return sphere.c + archRhoY(sphere);
}

function fmt(n) {
  return Number(n).toPrecision(8);
}

export const GEOM_EPS = EPS;

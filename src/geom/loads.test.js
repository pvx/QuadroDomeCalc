import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuadroGeometry } from './index.js';
import { applyPipedProducts } from './piped.js';
import { computeLoads } from './loads.js';

function fixture(n = 4) {
  const geom = buildQuadroGeometry({ a: 6000, h: 3500, n, units: 'mm' });
  const products = applyPipedProducts(geom, {
    pipeD: 108,
    beamsWidth: 150,
    beamsThickness: 50,
  });
  return { geom, products };
}

describe('computeLoads', () => {
  it('equal Fz with no wind; sum equals dead + snow', () => {
    const { geom, products } = fixture();
    const loads = computeLoads(geom, products, { snowKPa: 1, windKPa: 0 });
    const fzs = loads.supports.map((s) => s.FzKN);
    assert.ok(fzs.every((v) => Math.abs(v - fzs[0]) < 1e-9));
    const sum = fzs.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - loads.forces.verticalKN) < 1e-9);
    assert.ok(Math.abs(loads.forces.verticalKN - (loads.forces.deadKN + loads.forces.snowKN)) < 1e-9);
  });

  it('wind keeps ΣFz, leeward > windward, left/right match', () => {
    const { geom, products } = fixture();
    const base = computeLoads(geom, products, { snowKPa: 0, windKPa: 0 });
    const wind = computeLoads(geom, products, { snowKPa: 0, windKPa: 0.5 });
    const sumBase = base.supports.reduce((s, x) => s + x.FzKN, 0);
    const sumWind = wind.supports.reduce((s, x) => s + x.FzKN, 0);
    assert.ok(Math.abs(sumBase - sumWind) < 1e-9);
    assert.ok(wind.forces.windFxKN > 0);

    const byId = Object.fromEntries(wind.supports.map((s) => [s.id, s]));
    // S0 (−x,−y), S1 (+x,−y), S2 (+x,+y), S3 (−x,+y)
    assert.ok(byId.S1.FzKN > byId.S0.FzKN, 'leeward +x > windward −x');
    assert.ok(Math.abs(byId.S0.FzKN - byId.S3.FzKN) < 1e-9);
    assert.ok(Math.abs(byId.S1.FzKN - byId.S2.FzKN) < 1e-9);
  });

  it('snow horizontal projection ≈ a·b', () => {
    const { geom, products } = fixture(6);
    const loads = computeLoads(geom, products, { snowKPa: 1 });
    const aM = geom.params.a * 1e-3;
    const bM = (geom.params.b ?? geom.params.a) * 1e-3;
    const area = aM * bM;
    assert.ok(
      Math.abs(loads.forces.snowAreaM2 - area) / area < 0.02,
      `snowArea=${loads.forces.snowAreaM2} vs a·b=${area}`,
    );
  });

  it('snow horizontal projection ≈ a·b for rectangle', () => {
    const geom = buildQuadroGeometry({ a: 8000, b: 5000, h: 2800, n: 6, units: 'mm' });
    const products = applyPipedProducts(geom, {
      pipeD: 108,
      beamsWidth: 150,
      beamsThickness: 50,
    });
    const loads = computeLoads(geom, products, { snowKPa: 1 });
    const area = 8 * 5;
    assert.ok(
      Math.abs(loads.forces.snowAreaM2 - area) / area < 0.02,
      `snowArea=${loads.forces.snowAreaM2} vs 40`,
    );
  });

  it('rejects wall that fills the pipe', () => {
    const { geom, products } = fixture();
    assert.throws(
      () => computeLoads(geom, products, { pipeWallMm: 54 }),
      /does not fit/,
    );
  });
});

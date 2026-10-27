/**
 * Dead + surface loads and support reactions (no member forces).
 * Geom / products in mm. Densities kg/m³. Snow/wind kPa.
 */

const G = 9.81; // m/s²
const MM3_TO_M3 = 1e-9;
const MM2_TO_M2 = 1e-6;

export const DEFAULT_LOADS = {
  densityTimber: 500,
  densitySteel: 7850,
  densityOsb: 620,
  pipeWallMm: 5,
  pipeLengthMm: 150,
  osbThicknessMm: 10,
  osbFaceHeightMm: 0,
  plateThicknessMm: 8,
  plateEmbedMm: 150,
  platesPerEnd: 1,
  snowKPa: 0,
  windKPa: 0,
};

/**
 * @param {ReturnType<import('./index.js').buildQuadroGeometry>} geom
 * @param {ReturnType<import('./piped.js').applyPipedProducts>} products
 * @param {Partial<typeof DEFAULT_LOADS>} opts
 */
export function computeLoads(geom, products, opts = {}) {
  const p = { ...DEFAULT_LOADS, ...opts };
  const pipeD = products.pipeD;
  const wall = p.pipeWallMm;
  if (!(wall > 0)) throw new Error('Pipe wall thickness must be > 0.');
  if (2 * wall >= pipeD) {
    throw new Error(
      `Pipe wall ${wall} mm does not fit in Ø${pipeD} mm (need 2t < D).`,
    );
  }
  if (!(p.osbThicknessMm > 0)) throw new Error('OSB thickness must be > 0.');
  if (!(p.plateThicknessMm > 0)) throw new Error('Plate thickness must be > 0.');
  if (!(p.plateEmbedMm >= 0)) throw new Error('Plate embed cannot be < 0.');
  if (!(p.platesPerEnd >= 0)) throw new Error('Plates per end cannot be < 0.');

  const W = products.beamsWidth;
  const T = products.beamsThickness;
  const pipeLen = p.pipeLengthMm > 0 ? p.pipeLengthMm : W;
  const gap = products.hubGapMm ?? 5;
  const pipeR = pipeD / 2;

  let timberVolMm3 = 0;
  for (const e of products.edgeProducts) {
    timberVolMm3 += e.cutLength * W * T;
  }
  const timberKg = timberVolMm3 * MM3_TO_M3 * p.densityTimber;

  let osbAreaMm2 = 0;
  for (const f of products.faceProducts) osbAreaMm2 += f.area;
  const osbKg = osbAreaMm2 * p.osbThicknessMm * MM3_TO_M3 * p.densityOsb;

  const innerD = pipeD - 2 * wall;
  const hubVolOneMm3 =
    (Math.PI / 4) * (pipeD * pipeD - innerD * innerD) * pipeLen;
  const hubs = (products.hubs || []).filter((h) => h.valence > 0);
  const hubKg = hubs.length * hubVolOneMm3 * MM3_TO_M3 * p.densitySteel;

  let plateVolMm3 = 0;
  for (const e of products.edgeProducts) {
    const stubA = e.cutA * (gap / (pipeR + gap));
    const stubB = e.cutB * (gap / (pipeR + gap));
    const lenA = p.plateEmbedMm + stubA;
    const lenB = p.plateEmbedMm + stubB;
    plateVolMm3 +=
      p.platesPerEnd * p.plateThicknessMm * W * (lenA + lenB);
  }
  const plateKg = plateVolMm3 * MM3_TO_M3 * p.densitySteel;

  const deadKg = timberKg + osbKg + hubKg + plateKg;
  const deadKN = (deadKg * G) / 1000;

  let snowAreaMm2 = 0;
  let windSilhouetteMm2 = 0;
  let windMomentNum = 0; // Σ (area·nx·z_centroid) for nx>0
  for (const tri of geom.triangles) {
    const nz = tri.normal.z;
    const nx = tri.normal.x;
    snowAreaMm2 += tri.area * Math.max(0, nz);
    const contrib = tri.area * Math.max(0, nx);
    if (contrib > 0) {
      windSilhouetteMm2 += contrib;
      const [i0, i1, i2] = tri.nodeIds;
      const A = geom.nodes[i0];
      const B = geom.nodes[i1];
      const C = geom.nodes[i2];
      const zc = (A.z + B.z + C.z) / 3;
      windMomentNum += contrib * zc;
    }
  }

  const snowAreaM2 = snowAreaMm2 * MM2_TO_M2;
  const windSilhouetteM2 = windSilhouetteMm2 * MM2_TO_M2;
  const snowKN = p.snowKPa * snowAreaM2;
  const windFxKN = p.windKPa * windSilhouetteM2;
  const zCpMm =
    windSilhouetteMm2 > 0 ? windMomentNum / windSilhouetteMm2 : 0;
  const windMomentKNm = windFxKN * (zCpMm * 1e-3); // F·z

  const a = geom.params.a;
  const verticalKN = deadKN + snowKN;
  const share = verticalKN / 4;
  // Wind couple about Y through origin: leeward (+x) +M/(2a), windward (−x) −M/(2a)
  const couple = a > 0 ? windMomentKNm / (2 * (a * 1e-3)) : 0;

  const supports = geom.supports.map((s) => {
    const windVz = s.x > 0 ? couple : -couple;
    return {
      id: s.id,
      x: s.x,
      y: s.y,
      z: s.z,
      FzKN: share + windVz,
      FxShareKN: windFxKN / 4,
      note:
        'Fx/4 is an equal share of the horizontal force, not a rigid-joint analysis.',
    };
  });

  return {
    note:
      'Self-weight + snow/wind (kPa). Rigid Piped joint (pine, steel, 150 mm plates) ' +
      'is used for mass only. Not member forces and not a strength check.',
    materials: {
      timberKg,
      osbKg,
      hubKg,
      plateKg,
      deadKg,
    },
    volumes: {
      timberM3: timberVolMm3 * MM3_TO_M3,
      osbM3: osbAreaMm2 * p.osbThicknessMm * MM3_TO_M3,
      hubM3: hubs.length * hubVolOneMm3 * MM3_TO_M3,
      plateM3: plateVolMm3 * MM3_TO_M3,
      hubCount: hubs.length,
    },
    forces: {
      deadKN,
      snowKN,
      windFxKN,
      verticalKN,
      snowAreaM2,
      windSilhouetteM2,
      zCpMm,
      windMomentKNm,
    },
    params: { ...p, pipeD, beamsWidth: W, beamsThickness: T, hubGapMm: gap },
    supports,
  };
}

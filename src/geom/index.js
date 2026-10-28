/**
 * Quadro dome geometry API (stage 1: geometry only).
 * Not a strength check. Not an exact reverse-engineering of a photo.
 */
import {
  sphereFromSupports,
  archMidHeight,
  archMidHeightY,
  archRho,
  archRhoY,
} from './sphere.js';
import { buildSymmetricXYMesh, flipSupportCornerDiagonals } from './mesh.js';
import { sampleAllArches } from './arches.js';
import { buildTopology } from './topology.js';

/** Reference dims from the CAD screenshot (mm) — display / assumption helpers. */
export const REFERENCE_MM = {
  outer: 7010,
  inner: 6500,
  heightSurface: 4183,
  diagonalOnAxes: 9553.52,
};

/**
 * Working hypothesis: 9553.52 mm is the diagonal between opposite support axes.
 * a = diagonal / √2 (square).
 */
export function aFromDiagonalOnAxes(diagonal) {
  if (!(diagonal > 0)) throw new Error('Axis diagonal must be > 0.');
  return diagonal / Math.SQRT2;
}

/**
 * Auto height from reference CAD proportion of hMax.
 * When b=a, equals previous h = a · (4183/a_ref), clamped to h ≤ hypot(a,b)/2.
 */
export function hFromA(a, b = a) {
  const aRef = aFromDiagonalOnAxes(REFERENCE_MM.diagonalOnAxes);
  const ratio = REFERENCE_MM.heightSurface / aRef;
  const hMax = Math.hypot(a, b) / 2;
  // same fraction of hMax as square: (a·ratio)/(a/√2) = ratio·√2
  const h = (ratio * Math.SQRT2) * hMax;
  // stay slightly under hMax so c ≤ 0 holds numerically
  return Math.min(h, hMax * 0.999);
}

/** Reference ratio h/a (documented assumption, square). */
export function referenceHeightRatio() {
  const aRef = aFromDiagonalOnAxes(REFERENCE_MM.diagonalOnAxes);
  return REFERENCE_MM.heightSurface / aRef;
}

export function defaultAssumptionsMm() {
  const diagonalOnAxes = REFERENCE_MM.diagonalOnAxes;
  const a = aFromDiagonalOnAxes(diagonalOnAxes);
  const ratio = referenceHeightRatio();
  return {
    units: 'mm',
    a,
    b: a,
    h: REFERENCE_MM.heightSurface,
    n: 8,
    diagonalOnAxes,
    outer: REFERENCE_MM.outer,
    inner: REFERENCE_MM.inner,
    heightRatio: ratio,
    assumptions: [
      '9553.52 mm is a hypothesis: the square diagonal between opposite support axes → a = 9553.52/√2.',
      'Outer size 7010, inner size 6500, and axis sizes a×b are different quantities and are not substituted for each other.',
      `Auto-h: height keeps the reference fraction of hMax = hypot(a,b)/2 (square: h = a · ${ratio.toFixed(4)}).`,
      'Reference height 4183 mm is the design surface height (possibly the outer cladding surface, not the frame nodes).',
      'The mesh is a parametric XY approximation (D4 when a=b, mirror when a≠b), not an exact copy of the drawing and not a classic geodesic dome.',
      'Piped: edge shortening ≈ pipeD/2 at the hub; bevels from timber W×T and adjacent normals are an approximation, not a machine cut angle and not a strength check.',
    ],
  };
}

/**
 * @param {{ a:number, b?:number, h:number, n:number, units?:string, includeAnalyticalArches?:boolean, supportBrace?:boolean }} params
 */
export function buildQuadroGeometry(params) {
  const a = params.a;
  const b = params.b ?? a;
  const h = params.h;
  const n = params.n;
  const units = params.units || 'mm';
  const supportBrace = params.supportBrace !== false;

  const sphere = sphereFromSupports(a, h, b);
  const mesh = buildSymmetricXYMesh(sphere, n);
  if (supportBrace) flipSupportCornerDiagonals(mesh, a, b);
  const topology = buildTopology(mesh, sphere);

  const supports = [
    { id: 'S0', x: -a / 2, y: -b / 2, z: 0 },
    { id: 'S1', x: +a / 2, y: -b / 2, z: 0 },
    { id: 'S2', x: +a / 2, y: +b / 2, z: 0 },
    { id: 'S3', x: -a / 2, y: +b / 2, z: 0 },
  ];

  const rhoA = archRho(sphere);
  const rhoB = archRhoY(sphere);
  const result = {
    meta: {
      stage: 'geometry-only',
      units,
      generator: mesh.generator,
      note: mesh.note,
      safeForConstruction: false,
      disclaimer:
        'The model does not confirm that the structure is safe to build.',
    },
    params: { a, b, h, n, supportBrace },
    sphere: {
      c: sphere.c,
      R: sphere.R,
      hMax: sphere.hMax,
      equation: 'x² + y² + (z − c)² = R²',
      upperBranch: 'z = c + √(R² − x² − y²)',
    },
    supports,
    arches: {
      rho: rhoA,
      rhoA,
      rhoB,
      midHeightIdeal: archMidHeight(sphere),
      midHeightIdealA: archMidHeight(sphere),
      midHeightIdealB: archMidHeightY(sphere),
      note:
        'Opening height f = c+ρ is on the ideal smooth surface. ' +
        'Clear opening after section and cladding is not computed at this stage.',
      boundaryEdgeCount: topology.edges.filter((e) => e.category === 'arch-boundary')
        .length,
    },
    nodes: topology.nodes,
    edges: topology.edges,
    triangles: topology.triangles,
    normalAngles: topology.normalAngles,
    stats: {
      nodeCount: topology.nodes.length,
      edgeCount: topology.edges.length,
      triangleCount: topology.triangles.length,
      edgeTypeCount: topology.edgeTypeCount,
      internalEdges: topology.edges.filter((e) => e.category === 'internal').length,
      archBoundaryEdges: topology.edges.filter((e) => e.category === 'arch-boundary')
        .length,
      surfaceArea: topology.triangles.reduce((s, t) => s + t.area, 0),
      totalEdgeLength: topology.edges.reduce((s, e) => s + e.length, 0),
    },
  };

  if (params.includeAnalyticalArches) {
    result.analyticalArches = sampleAllArches(sphere, Math.max(8, n));
  }

  return result;
}

/** Adapter for Three.js viewer expecting meters + verts/edges/faces arrays. */
export function toViewerModel(geom) {
  const scale = geom.meta.units === 'mm' ? 0.001 : 1;
  const verts = geom.nodes.map((n) => ({
    x: n.x * scale,
    y: n.y * scale,
    z: n.z * scale,
  }));
  const faces = geom.triangles.map((t) => t.nodeIds);
  const edges = geom.edges.map((e) => ({
    id: e.id,
    i: e.startNodeId,
    j: e.endNodeId,
    length: e.length * scale,
    selvage: e.category === 'arch-boundary',
    category: e.category,
    typeId: e.typeId,
  }));
  const a = geom.params.a * scale;
  const b = (geom.params.b ?? geom.params.a) * scale;
  const h = geom.params.h * scale;
  return {
    length: a,
    width: b,
    height: h,
    wallHeight: 0,
    frequency: geom.params.n,
    verts,
    faces,
    edges,
    neighbors: [],
    baseIdx: [],
    supports: geom.supports.map((s) => ({
      x: s.x * scale,
      y: s.y * scale,
      z: s.z * scale,
    })),
    sphere: {
      c: geom.sphere.c * scale,
      R: geom.sphere.R * scale,
    },
    meta: geom.meta,
    geom,
  };
}

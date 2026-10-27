# Quadro Dome Calculator

Parametric calculator for a **quadro dome**: a spherical shell on four corner supports, four arched openings, and a symmetric XY triangulation.

Geometry, a **Piped/timber** cut list (Edges / Faces / Vertices), and dead plus surface **loads** (masses and support reactions). Not a strength check.

## Important

- The model does **not** confirm that a build is safe.
- The mesh is an engineering approximation with D4 symmetry. It is not an exact reconstruction of a drawing, and not a classic geodesic dome.
- Piped shortening is about `pipeD / 2` at the hub. Bevels come from timber width × thickness and adjacent face normals: an approximation, not a machine cut angle.
- Loads are self-weight, snow, and wind as vertical support reactions. No member forces, no stress check.
- Outer size, inner size, and size on the support axes are **different** numbers. Only `a` (axis-to-axis side) drives the mesh. Outer and inner values from the reference drawing are for comparison only.

## Run

```bash
npm install
npm test
npm run dev
```

`npm test` runs `node --test src/geom/*.test.js`. `npm run build` produces a static Vite bundle.

## Layout

| Module | Role |
|--------|------|
| `src/geom/sphere.js` | `c`, `R`, `z(x,y)`, limit `h ≤ a/√2` |
| `src/geom/arches.js` | ideal arches + equal-angle samples (analytical mode) |
| `src/geom/mesh.js` | even `n`, one quadrant rotated by 90° |
| `src/geom/topology.js` | edges, triangles, angle between normals |
| `src/geom/piped.js` | cut length, bevels, Edges / Faces / hub groups |
| `src/geom/members.js` | timber segment and prism for the viewer |
| `src/geom/loads.js` | timber, steel, OSB mass; snow and wind; support reactions |
| `src/geom/index.js` | `buildQuadroGeometry`, `toViewerModel` |
| `src/view/scene.js` | Three.js viewer (Base / Carcass / Schema / Cover) |
| `src/view/drawings.js` | cut-list budget |
| `src/report/stats.js` | text report |
| `src/export/obj.js` | download the frame as `.obj` |

Entry point: `buildQuadroGeometry({ a, h, n, supportBrace })`, then `applyPipedProducts` and `computeLoads`. Units in the geometry API are millimetres. The viewer scales to metres.

## Sphere

Supports at `(±a/2, ±a/2, 0)`, apex at `(0, 0, h)`:

- `c = h/2 − a²/(4h)`
- `R = h/2 + a²/(4h)`
- `z = c + √(R² − x² − y²)` when `0 < h ≤ a/√2`

Reference drawing (mm), used as defaults and for the auto-height ratio: outer `7010`, inner `6500`, surface height `4183`, axis diagonal `9553.52`. Working hypothesis: that diagonal is the square diagonal between opposite support axes, so `a = diagonal / √2`. Auto height keeps `h/a` from that drawing and clamps to `h ≤ a/√2`.

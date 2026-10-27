import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { timberPrism } from '../geom/members.js';
import { addDimensions } from './dimensions.js';

const PIPE = 0x7a8694;
const tmpColor = new THREE.Color();

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f6f8);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  camera.position.set(9, -11, 6);
  camera.up.set(0, 0, 1);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.target.set(0, 0, 1.5);

  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(6, -8, 10);
  scene.add(sun);

  const root = new THREE.Group();
  scene.add(root);

  let mode = 'carcass';
  let model = null;
  let fittedOnce = false;
  let lastSpan = 0;

  function resize() {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    const h = canvas.clientHeight || canvas.parentElement.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }

  function clear() {
    root.traverse((c) => {
      if (c === root) return;
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
        else c.material.dispose();
      }
    });
    root.clear();
  }

  function fitCamera(length, height) {
    const span = Math.max(length, height, 1);
    camera.position.set(span * 1.1, -span * 1.3, span * 0.75);
    controls.target.set(0, 0, height * 0.35);
    controls.update();
    lastSpan = span;
    fittedOnce = true;
  }

  function setMode(next) {
    mode = next;
    if (model) renderDome(model, { fit: mode === 'base' });
  }

  function renderDome(d, opts = {}) {
    model = d;
    clear();
    const { verts, edges, faces, length, width, height, supports } = d;
    const forceFit = opts.fit === true;

    // Ground square on axes a×a
    const shape = new THREE.Shape();
    shape.moveTo(-length / 2, -width / 2);
    shape.lineTo(length / 2, -width / 2);
    shape.lineTo(length / 2, width / 2);
    shape.lineTo(-length / 2, width / 2);
    shape.closePath();
    const baseGeom = new THREE.ShapeGeometry(shape);
    root.add(
      new THREE.Mesh(
        baseGeom,
        new THREE.MeshBasicMaterial({
          color: 0xd5dde5,
          transparent: true,
          opacity: mode === 'base' ? 0.95 : 0.25,
          side: THREE.DoubleSide,
        }),
      ),
    );
    root.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(baseGeom),
        new THREE.LineBasicMaterial({ color: 0x556677 }),
      ),
    );

    // Supports
    if (supports) {
      for (const s of supports) {
        const g = new THREE.SphereGeometry(Math.max(length * 0.012, 0.05), 12, 12);
        const m = new THREE.Mesh(
          g,
          new THREE.MeshLambertMaterial({ color: 0x222222 }),
        );
        m.position.set(s.x, s.y, s.z);
        root.add(m);
      }
    }

    // Overall dimensions (a between supports, diagonal, height h)
    addDimensions(root, { a: length, h: height });

    if (mode === 'base') {
      camera.position.set(0, 0, Math.max(length, width) * 1.35);
      controls.target.set(0, 0, 0);
      controls.update();
      // still show frame lightly under dims in base? skip frame below
      const span = Math.max(length, height, 1);
      if (forceFit || !fittedOnce || Math.abs(span - lastSpan) / Math.max(lastSpan, 1e-6) > 0.15) {
        lastSpan = span;
        fittedOnce = true;
      }
      return;
    }

    const solid = mode === 'carcass' || mode === 'cover';
    const products = d.products;
    const sphereC = d.sphere?.c ?? 0;

    if (solid && products?.edgeCuts?.length === edges.length) {
      addSolidFrame(root, verts, edges, products, sphereC);
    } else {
      addLineFrame(root, verts, edges);
    }

    if (mode === 'schema') {
      const pts = verts.flatMap((v) => [v.x, v.y, v.z]);
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      root.add(
        new THREE.Points(
          pg,
          new THREE.PointsMaterial({ color: 0xc0392b, size: 0.05 }),
        ),
      );
    }

    if (mode === 'cover' && products?.panels?.length) {
      addCoverPanels(root, products.panels);
    } else if (mode === 'cover') {
      const positions = [];
      const normals = [];
      for (const f of faces) {
        const a = verts[f[0]];
        const b = verts[f[1]];
        const c = verts[f[2]];
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        const ab = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
        const ac = new THREE.Vector3(c.x - a.x, c.y - a.y, c.z - a.z);
        const n = new THREE.Vector3().crossVectors(ab, ac).normalize();
        for (let k = 0; k < 3; k++) normals.push(n.x, n.y, n.z);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      root.add(
        new THREE.Mesh(
          g,
          new THREE.MeshLambertMaterial({
            color: 0x9bb8cc,
            transparent: true,
            opacity: 0.75,
            side: THREE.DoubleSide,
          }),
        ),
      );
    }

    // Analytical arches overlay
    if (d.analyticalArches) {
      for (const side of d.analyticalArches.sides) {
        const pts = side.points.map(
          (p) =>
            new THREE.Vector3(
              p.x * (d.geom?.meta.units === 'mm' ? 0.001 : 1),
              p.y * (d.geom?.meta.units === 'mm' ? 0.001 : 1),
              p.z * (d.geom?.meta.units === 'mm' ? 0.001 : 1),
            ),
        );
        root.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: 0x1a73e8 }),
          ),
        );
      }
    }

    // Refit only on first paint or when overall size changed a lot (not every tweak)
    const span = Math.max(length, height, 1);
    if (forceFit || !fittedOnce || Math.abs(span - lastSpan) / lastSpan > 0.15) {
      fitCamera(length, height);
    }
  }

  function frame() {
    resize();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  frame();

  return { setMode, renderDome, getMode: () => mode };
}

function addLineFrame(root, verts, edges) {
  const internal = [];
  const boundary = [];
  for (const e of edges) {
    const a = verts[e.i];
    const b = verts[e.j];
    const arr = e.category === 'arch-boundary' || e.selvage ? boundary : internal;
    arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  if (internal.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(internal, 3));
    root.add(
      new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({ color: 0x4a5560 }),
      ),
    );
  }
  if (boundary.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(boundary, 3));
    root.add(
      new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({ color: 0x8b4513 }),
      ),
    );
  }
}

function radialAt(v, sphereC) {
  const r = { x: v.x, y: v.y, z: v.z - sphereC };
  const L = Math.hypot(r.x, r.y, r.z);
  if (L < 1e-12) return { x: 0, y: 0, z: 1 };
  return { x: r.x / L, y: r.y / L, z: r.z / L };
}

function pushVert(pos, col, p, c) {
  pos.push(p.x, p.y, p.z);
  col.push(c.r, c.g, c.b);
}

/** Quad as two triangles (a-b-c, a-c-d). */
function pushQuad(pos, col, c, a, b, d, e) {
  pushVert(pos, col, a, c);
  pushVert(pos, col, b, c);
  pushVert(pos, col, d, c);
  pushVert(pos, col, a, c);
  pushVert(pos, col, d, c);
  pushVert(pos, col, e, c);
}

function addCoverPanels(root, panels) {
  const positions = [];
  const colors = [];
  for (const pan of panels) {
    const [a, b, c] = pan.corners;
    tmpColor.set(pan.color || '#9bb8cc');
    pushVert(positions, colors, a, tmpColor);
    pushVert(positions, colors, b, tmpColor);
    pushVert(positions, colors, c, tmpColor);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  root.add(
    new THREE.Mesh(
      g,
      new THREE.MeshLambertMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    ),
  );
}

function addSolidFrame(root, verts, edges, products, sphereC) {
  const { beamsWidth, beamsThickness, pipeD, edgeCuts } = products;
  const positions = [];
  const colors = [];

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const cut = edgeCuts[i];
    const A = verts[e.i];
    const B = verts[e.j];
    const prism = timberPrism(
      A,
      B,
      cut.cutA,
      cut.cutB,
      radialAt(A, sphereC),
      radialAt(B, sphereC),
      beamsThickness,
      beamsWidth,
    );
    const ca = prism.cornersA;
    const cb = prism.cornersB;
    tmpColor.set(cut.color || '#888888');

    pushQuad(positions, colors, tmpColor, ca[0], ca[1], ca[2], ca[3]);
    pushQuad(positions, colors, tmpColor, cb[0], cb[3], cb[2], cb[1]);
    for (let k = 0; k < 4; k++) {
      const n = (k + 1) % 4;
      pushQuad(positions, colors, tmpColor, ca[k], cb[k], cb[n], ca[n]);
    }
  }

  const timberGeom = new THREE.BufferGeometry();
  timberGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  timberGeom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  timberGeom.computeVertexNormals();
  root.add(
    new THREE.Mesh(
      timberGeom,
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    ),
  );

  const pipeR = pipeD / 2;
  const cylGeom = new THREE.CylinderGeometry(pipeR, pipeR, beamsWidth, 16);
  const pipeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const hubs = new THREE.InstancedMesh(cylGeom, pipeMat, verts.length);
  const dummy = new THREE.Object3D();
  const yUp = new THREE.Vector3(0, 1, 0);
  const radial = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const hubColors = products.hubColors || [];

  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    radial.set(v.x, v.y, v.z - sphereC);
    if (radial.lengthSq() < 1e-12) radial.set(0, 0, 1);
    else radial.normalize();
    quat.setFromUnitVectors(yUp, radial);
    dummy.position.set(v.x, v.y, v.z);
    dummy.quaternion.copy(quat);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    hubs.setMatrixAt(i, dummy.matrix);
    tmpColor.set(hubColors[i] || PIPE);
    hubs.setColorAt(i, tmpColor);
  }
  hubs.instanceMatrix.needsUpdate = true;
  if (hubs.instanceColor) hubs.instanceColor.needsUpdate = true;
  root.add(hubs);
}

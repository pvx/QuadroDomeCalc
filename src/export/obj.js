import { timberPrism } from '../geom/members.js';

export function domeToOBJ(model) {
  const lines = [
    '# Quadro Dome — geometry stage',
    '# Not validated for construction',
    'o quadro_sphere_xy',
    '',
  ];
  for (const v of model.verts) {
    lines.push(`v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}`);
  }
  lines.push('');
  for (const f of model.faces) {
    lines.push(`f ${f[0] + 1} ${f[1] + 1} ${f[2] + 1}`);
  }
  lines.push('');
  for (const e of model.edges) {
    lines.push(`l ${e.i + 1} ${e.j + 1}`);
  }
  return lines.join('\n');
}

/**
 * Solid carcass + cover: each beam, hub pipe, and panel is its own `o` with
 * private vertices (OBJ face indices never cross parts).
 */
export function modelToOBJ(model) {
  const products = model.products;
  if (!products?.edgeCuts?.length) {
    throw new Error('Model products missing — recalculate first.');
  }

  const lines = [
    '# Quadro Dome — solid model (carcass + cover)',
    '# Not validated for construction',
    '',
  ];
  let vBase = 0; // absolute 0-based; OBJ faces use 1-based = vBase + local + 1

  const pushVerts = (verts) => {
    for (const p of verts) {
      lines.push(`v ${p.x.toFixed(6)} ${p.y.toFixed(6)} ${p.z.toFixed(6)}`);
    }
  };
  const pushFace = (indices) => {
    lines.push(`f ${indices.map((i) => vBase + i + 1).join(' ')}`);
  };
  const finishPart = (nVerts) => {
    vBase += nVerts;
    lines.push('');
  };

  const { verts, edges } = model;
  const sphereC = model.sphere?.c ?? 0;
  const { beamsWidth, beamsThickness, pipeD, edgeCuts, panels } = products;
  const osbT = products.osbThickness ?? 0.01;
  const osbH = products.osbFaceHeight ?? 0;
  const pipeLength = products.pipeLength ?? beamsWidth;

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const cut = edgeCuts[i];
    const prism = timberPrism(
      verts[e.i],
      verts[e.j],
      cut.cutA,
      cut.cutB,
      radialAt(verts[e.i], sphereC),
      radialAt(verts[e.j], sphereC),
      beamsThickness,
      beamsWidth,
    );
    const ca = prism.cornersA;
    const cb = prism.cornersB;
    // 8 verts: 0..3 = ca, 4..7 = cb
    lines.push(`o beam_${e.id ?? i}`);
    pushVerts([...ca, ...cb]);
    pushFace([0, 1, 2, 3]);
    pushFace([4, 7, 6, 5]);
    for (let k = 0; k < 4; k++) {
      const n = (k + 1) % 4;
      pushFace([k, 4 + k, 4 + n, n]);
    }
    finishPart(8);
  }

  const pipeR = pipeD / 2;
  const hubSegs = 16;
  for (let i = 0; i < verts.length; i++) {
    const mesh = cylinderMesh(verts[i], radialAt(verts[i], sphereC), pipeR, pipeLength, hubSegs);
    lines.push(`o hub_${i}`);
    pushVerts(mesh.verts);
    for (const f of mesh.faces) pushFace(f);
    finishPart(mesh.verts.length);
  }

  if (panels?.length) {
    for (const pan of panels) {
      const [a0, b0, c0] = pan.corners;
      const n = triangleOutward(a0, b0, c0, sphereC);
      const botOff = scale(n, osbH);
      const topOff = scale(n, osbH + osbT);
      const bot = [add(a0, botOff), add(b0, botOff), add(c0, botOff)];
      const top = [add(a0, topOff), add(b0, topOff), add(c0, topOff)];
      lines.push(`o panel_${pan.id}`);
      pushVerts([...bot, ...top]);
      pushFace([0, 1, 2]);
      pushFace([3, 5, 4]);
      pushFace([0, 3, 4, 1]);
      pushFace([1, 4, 5, 2]);
      pushFace([2, 5, 3, 0]);
      finishPart(6);
    }
  }

  return lines.join('\n');
}

function radialAt(v, sphereC) {
  const r = { x: v.x, y: v.y, z: v.z - sphereC };
  const L = Math.hypot(r.x, r.y, r.z);
  if (L < 1e-12) return { x: 0, y: 0, z: 1 };
  return { x: r.x / L, y: r.y / L, z: r.z / L };
}

/** Face normal pointing away from sphere center. */
function triangleOutward(a, b, c, sphereC) {
  const n = norm(cross(sub(b, a), sub(c, a)));
  const mid = {
    x: (a.x + b.x + c.x) / 3,
    y: (a.y + b.y + c.y) / 3,
    z: (a.z + b.z + c.z) / 3,
  };
  const radial = radialAt(mid, sphereC);
  if (n.x * radial.x + n.y * radial.y + n.z * radial.z < 0) {
    return { x: -n.x, y: -n.y, z: -n.z };
  }
  return n;
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function norm(v) {
  const L = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / L, y: v.y / L, z: v.z / L };
}

/** Solid cylinder: axis = unit radial, height along axis, center at hub. */
function cylinderMesh(center, axis, radius, height, segs) {
  const ax = norm(axis);
  const tmp =
    Math.abs(ax.z) < 0.9
      ? { x: 0, y: 0, z: 1 }
      : { x: 1, y: 0, z: 0 };
  const u = norm(cross(ax, tmp));
  const v = cross(ax, u);
  const half = height / 2;
  const bot = [];
  const top = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const offset = add(scale(u, Math.cos(a) * radius), scale(v, Math.sin(a) * radius));
    bot.push(add(add(center, scale(ax, -half)), offset));
    top.push(add(add(center, scale(ax, half)), offset));
  }
  const verts = [...bot, ...top];
  const faces = [];
  for (let i = 0; i < segs; i++) {
    const n = (i + 1) % segs;
    faces.push([i, n, segs + n, segs + i]);
  }
  // caps (fan); reverse one for outward normals
  const botCap = [];
  const topCap = [];
  for (let i = 0; i < segs; i++) {
    botCap.push(segs - 1 - i);
    topCap.push(segs + i);
  }
  faces.push(botCap);
  faces.push(topCap);
  return { verts, faces };
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadOBJ(model, filename = 'quadro-dome.obj') {
  downloadText(domeToOBJ(model), filename);
}

export function downloadModelOBJ(model, filename = 'quadro-dome-model.obj') {
  downloadText(modelToOBJ(model), filename);
}

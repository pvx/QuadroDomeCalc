import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuadroGeometry, toViewerModel } from '../geom/index.js';
import { applyPipedProducts } from '../geom/piped.js';
import { modelToOBJ } from './obj.js';

function buildTestModel() {
  const geom = buildQuadroGeometry({
    a: 5000,
    h: 2500,
    n: 4,
    units: 'mm',
  });
  const products = applyPipedProducts(geom, {
    pipeD: 108,
    beamsWidth: 150,
    beamsThickness: 50,
  });
  const model = toViewerModel(geom);
  const mm = 0.001;
  model.products = {
    pipeD: products.pipeD * mm,
    pipeLength: 0.15,
    beamsWidth: products.beamsWidth * mm,
    beamsThickness: products.beamsThickness * mm,
    osbThickness: 0.01,
    osbFaceHeight: 0,
    edgeCuts: products.edgeProducts.map((e) => ({
      edgeId: e.edgeId,
      cutA: e.cutA * mm,
      cutB: e.cutB * mm,
      cutLength: e.cutLength * mm,
      category: e.category,
    })),
    panels: products.faceProducts.map((f) => ({
      id: f.id,
      corners: f.corners.map((p) => ({
        x: p.x * mm,
        y: p.y * mm,
        z: p.z * mm,
      })),
    })),
  };
  return { model, geom, products };
}

describe('modelToOBJ', () => {
  it('one object per beam, hub, panel; faces stay inside each part', () => {
    const { model, products } = buildTestModel();
    const text = modelToOBJ(model);

    const beams = [...text.matchAll(/^o beam_/gm)];
    const hubs = [...text.matchAll(/^o hub_/gm)];
    const panels = [...text.matchAll(/^o panel_/gm)];
    assert.equal(beams.length, products.edgeProducts.length);
    assert.equal(hubs.length, model.verts.length);
    assert.equal(panels.length, products.faceProducts.length);

    // each panel is a 6-vert prism (OSB thickness)
    const panelBlock = text.split(/^o panel_/m).slice(1)[0];
    const panelVerts = [...panelBlock.matchAll(/^v /gm)];
    assert.equal(panelVerts.length, 6);
  });

  it('face height offsets panel; thickness stays OSB thickness', () => {
    const { model } = buildTestModel();
    model.products.osbThickness = 0.01;
    model.products.osbFaceHeight = 0.05;
    const pan = model.products.panels[0];
    const text = modelToOBJ(model);
    const block = text.split(`o panel_${pan.id}\n`)[1].split(/\no /)[0];
    const verts = [...block.matchAll(/^v ([-\d.]+) ([-\d.]+) ([-\d.]+)/gm)].map(
      (m) => ({ x: +m[1], y: +m[2], z: +m[3] }),
    );
    assert.equal(verts.length, 6);
    const mid = (i, j, k) => ({
      x: (verts[i].x + verts[j].x + verts[k].x) / 3,
      y: (verts[i].y + verts[j].y + verts[k].y) / 3,
      z: (verts[i].z + verts[j].z + verts[k].z) / 3,
    });
    const bot = mid(0, 1, 2);
    const top = mid(3, 4, 5);
    const depth = Math.hypot(top.x - bot.x, top.y - bot.y, top.z - bot.z);
    assert.ok(Math.abs(depth - 0.01) < 1e-6, `depth ${depth}`);
    const c0 = pan.corners[0];
    const lift = Math.hypot(verts[0].x - c0.x, verts[0].y - c0.y, verts[0].z - c0.z);
    assert.ok(Math.abs(lift - 0.05) < 1e-6, `lift ${lift}`);

    // Parse parts: after each `o` until next `o` or EOF, faces must reference
    // only vertices declared in that part (OBJ 1-based absolute indices).
    const lines = text.split('\n');
    let vCount = 0;
    let partStart = 0;
    let partName = null;
    const checkPart = (endLine) => {
      if (!partName) return;
      let localVerts = 0;
      for (let i = partStart; i < endLine; i++) {
        if (lines[i].startsWith('v ')) localVerts++;
      }
      const lo = vCount - localVerts + 1;
      const hi = vCount;
      for (let i = partStart; i < endLine; i++) {
        if (!lines[i].startsWith('f ')) continue;
        for (const tok of lines[i].slice(2).trim().split(/\s+/)) {
          const idx = Number(tok.split('/')[0]);
          assert.ok(
            idx >= lo && idx <= hi,
            `${partName}: face index ${idx} outside ${lo}..${hi}`,
          );
        }
      }
    };
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('o ')) {
        checkPart(i);
        partName = lines[i].slice(2).trim();
        partStart = i + 1;
      } else if (lines[i].startsWith('v ')) {
        vCount++;
      }
    }
    checkPart(lines.length);
  });
});

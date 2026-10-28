import { buildQuadroGeometry, toViewerModel } from './geom/index.js';
import { applyPipedProducts } from './geom/piped.js';
import { computeLoads } from './geom/loads.js';
import { createScene } from './view/scene.js';
import { renderBudget } from './view/drawings.js';
import { buildReport } from './report/stats.js';
import { bindForm, readParams } from './ui/form.js';
import { downloadOBJ, downloadModelOBJ } from './export/obj.js';

const form = document.getElementById('options');
const reportEl = document.getElementById('report');
const budgetEl = document.getElementById('budget');
const errorEl = document.getElementById('error');
const canvas = document.getElementById('viewport');
const modeList = document.getElementById('mode-list');

const viewer = createScene(canvas);
let currentModel = null;
let currentGeom = null;

function recalculate(params) {
  errorEl.hidden = true;
  errorEl.textContent = '';
  try {
    const geom = buildQuadroGeometry({
      a: params.a,
      b: params.b,
      h: params.h,
      n: params.n,
      units: 'mm',
      includeAnalyticalArches: params.includeAnalyticalArches,
      supportBrace: params.supportBrace,
    });
    const products = applyPipedProducts(geom, {
      pipeD: params.pipeD,
      beamsWidth: params.beamsWidth,
      beamsThickness: params.beamsThickness,
      hubGapMm: params.hubGapMm,
      panelGapMm: params.panelGapMm,
    });
    const loads = computeLoads(geom, products, {
      densityTimber: params.densityTimber,
      densitySteel: params.densitySteel,
      densityOsb: params.densityOsb,
      pipeWallMm: params.pipeWallMm,
      pipeLengthMm: params.pipeLengthMm,
      osbThicknessMm: params.osbThicknessMm,
      osbFaceHeightMm: params.osbFaceHeightMm,
      plateThicknessMm: params.plateThicknessMm,
      plateEmbedMm: params.plateEmbedMm,
      platesPerEnd: params.platesPerEnd,
      snowKPa: params.snowKPa,
      windKPa: params.windKPa,
    });
    const model = toViewerModel(geom);
    const mm = 0.001;
    const colorByEdge = new Map();
    for (const g of products.edgeGroups) {
      for (const u of g.units) colorByEdge.set(u.edgeId, g.color);
    }
    const colorByFace = new Map();
    for (const g of products.faceGroups) {
      for (const u of g.units) colorByFace.set(u.id, g.color);
    }
    const colorByHub = new Map();
    for (const g of products.hubGroups) {
      for (const u of g.units) colorByHub.set(u.id, g.color);
    }
    model.products = {
      pipeD: products.pipeD * mm,
      pipeLength: params.pipeLengthMm * mm,
      beamsWidth: products.beamsWidth * mm,
      beamsThickness: products.beamsThickness * mm,
      osbThickness: params.osbThicknessMm * mm,
      osbFaceHeight: params.osbFaceHeightMm * mm,
      edgeCuts: products.edgeProducts.map((e) => ({
        edgeId: e.edgeId,
        cutA: e.cutA * mm,
        cutB: e.cutB * mm,
        cutLength: e.cutLength * mm,
        category: e.category,
        color: colorByEdge.get(e.edgeId) || '#888888',
      })),
      panels: products.faceProducts.map((f) => ({
        id: f.id,
        corners: f.corners.map((p) => ({
          x: p.x * mm,
          y: p.y * mm,
          z: p.z * mm,
        })),
        color: colorByFace.get(f.id) || '#9bb8cc',
      })),
      hubColors: model.verts.map((_, i) => colorByHub.get(i) || '#7a8694'),
    };
    if (geom.analyticalArches) {
      model.analyticalArches = geom.analyticalArches;
      model.geom = geom;
    }
    currentGeom = geom;
    currentModel = model;
    viewer.renderDome(model);
    reportEl.textContent = buildReport(geom, products, loads);
    renderBudget(budgetEl, geom, products);
  } catch (err) {
    console.error(err);
    errorEl.hidden = false;
    errorEl.textContent = err.message || String(err);
    reportEl.textContent = 'Parameter error — see the message above.';
    budgetEl.innerHTML = '';
  }
}

modeList.addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-btn');
  if (!btn) return;
  modeList.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  viewer.setMode(btn.dataset.mode);
});

document.getElementById('btn-obj').addEventListener('click', () => {
  if (!currentModel || !currentGeom) return;
  downloadOBJ(
    currentModel,
    `quadro-a${Math.round(currentGeom.params.a)}-b${Math.round(currentGeom.params.b ?? currentGeom.params.a)}-n${currentGeom.params.n}.obj`,
  );
});

document.getElementById('btn-model-obj').addEventListener('click', () => {
  if (!currentModel?.products?.edgeCuts?.length || !currentGeom) return;
  downloadModelOBJ(
    currentModel,
    `quadro-a${Math.round(currentGeom.params.a)}-b${Math.round(currentGeom.params.b ?? currentGeom.params.a)}-n${currentGeom.params.n}-model.obj`,
  );
});

bindForm(form, recalculate);
recalculate(readParams(form));

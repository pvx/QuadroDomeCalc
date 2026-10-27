import {
  aFromDiagonalOnAxes,
  defaultAssumptionsMm,
  hFromA,
} from '../geom/index.js';

function el(form, name) {
  const node = form.elements.namedItem(name);
  if (!node) throw new Error(`Missing form field "${name}"`);
  return node;
}

export function readParams(form) {
  const diagonalOnAxes = num(el(form, 'diagonalOnAxes').value, 9553.52);
  const fromDiag = el(form, 'aFromDiag').checked;
  let a = num(el(form, 'a').value, aFromDiagonalOnAxes(diagonalOnAxes));
  if (fromDiag) {
    a = aFromDiagonalOnAxes(diagonalOnAxes);
    el(form, 'a').value = round1(a);
  } else {
    el(form, 'diagonalOnAxes').value = round2(a * Math.SQRT2);
  }

  const autoH = el(form, 'autoH').checked;
  let h = num(el(form, 'h').value, 4183);
  if (autoH) {
    h = hFromA(a);
    el(form, 'h').value = round1(h);
  }

  return {
    diagonalOnAxes: fromDiag ? diagonalOnAxes : a * Math.SQRT2,
    a,
    h,
    n: Math.max(2, Math.floor(num(el(form, 'n').value, 8))),
    outer: num(el(form, 'outer').value, 7010),
    inner: num(el(form, 'inner').value, 6500),
    aFromDiag: fromDiag,
    autoH,
    includeAnalyticalArches: el(form, 'analyticalArches').checked,
    supportBrace: el(form, 'supportBrace').checked,
    pipeD: num(el(form, 'pipeD').value, 108),
    beamsWidth: num(el(form, 'beamsWidth').value, 200),
    beamsThickness: num(el(form, 'beamsThickness').value, 60),
    densityTimber: num(el(form, 'densityTimber').value, 500),
    densitySteel: num(el(form, 'densitySteel').value, 7850),
    densityOsb: num(el(form, 'densityOsb').value, 620),
    pipeWallMm: num(el(form, 'pipeWallMm').value, 5),
    osbThicknessMm: num(el(form, 'osbThicknessMm').value, 10),
    plateThicknessMm: num(el(form, 'plateThicknessMm').value, 8),
    plateEmbedMm: num(el(form, 'plateEmbedMm').value, 150),
    platesPerEnd: num(el(form, 'platesPerEnd').value, 1),
    snowKPa: num(el(form, 'snowKPa').value, 0),
    windKPa: num(el(form, 'windKPa').value, 0),
    units: 'mm',
  };
}

export function bindForm(form, onChange) {
  const defaults = defaultAssumptionsMm();
  el(form, 'a').value = round1(defaults.a);
  el(form, 'h').value = round1(defaults.h);
  el(form, 'diagonalOnAxes').value = round2(defaults.a * Math.SQRT2);
  el(form, 'aFromDiag').checked = false;
  el(form, 'autoH').checked = true;

  form.addEventListener('submit', (e) => e.preventDefault());

  const syncFromDiag = () => {
    if (!el(form, 'aFromDiag').checked) return;
    const diag = num(el(form, 'diagonalOnAxes').value, 9553.52);
    el(form, 'a').value = round1(aFromDiagonalOnAxes(diag));
  };

  const syncH = () => {
    if (!el(form, 'autoH').checked) return;
    const a = num(el(form, 'a').value, defaults.a);
    el(form, 'h').value = round1(hFromA(a));
  };

  const emit = () => {
    syncFromDiag();
    syncH();
    onChange(readParams(form));
  };

  const names = [
    'diagonalOnAxes',
    'a',
    'aFromDiag',
    'outer',
    'inner',
    'h',
    'autoH',
    'n',
    'analyticalArches',
    'supportBrace',
    'pipeD',
    'beamsWidth',
    'beamsThickness',
    'densityTimber',
    'densitySteel',
    'densityOsb',
    'pipeWallMm',
    'osbThicknessMm',
    'plateThicknessMm',
    'plateEmbedMm',
    'platesPerEnd',
    'snowKPa',
    'windKPa',
  ];

  for (const name of names) {
    const node = el(form, name);
    const onEdit = () => {
      if (name === 'a') el(form, 'aFromDiag').checked = false;
      if (name === 'h') el(form, 'autoH').checked = false;
      if (name === 'aFromDiag' || name === 'diagonalOnAxes') syncFromDiag();
      if (name === 'a' || name === 'aFromDiag' || name === 'diagonalOnAxes' || name === 'autoH') {
        syncH();
      }
      emit();
    };
    node.addEventListener('input', onEdit);
    node.addEventListener('change', onEdit);
  }

  const recalcBtn = document.getElementById('btn-recalc');
  if (recalcBtn) recalcBtn.addEventListener('click', emit);

  return { emit };
}

function num(v, fallback) {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function round1(n) {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function round2(n) {
  return (Math.round(n * 100) / 100).toFixed(2);
}

import * as THREE from 'three';

/**
 * Overall dimensions (scene units = meters; labels in mm).
 * a — distance between adjacent supports on axes; h — apex height.
 */
export function addDimensions(root, { a, h }) {
  const group = new THREE.Group();
  group.name = 'dimensions';

  const half = a / 2;
  const offset = Math.max(a * 0.08, 0.25);
  const blue = 0x1a73e8;
  const orange = 0xe67e22;
  const green = 0x27ae60;

  const aMm = formatMm(a * 1000);
  const hMm = formatMm(h * 1000);
  const diagMm = formatMm(a * Math.SQRT2 * 1000);

  // Side a (between adjacent supports)
  const yOff = -half - offset;
  addDimLine(
    group,
    new THREE.Vector3(-half, yOff, 0),
    new THREE.Vector3(half, yOff, 0),
    `${aMm} mm`,
    blue,
    a,
  );
  addGuide(group, new THREE.Vector3(-half, -half, 0), new THREE.Vector3(-half, yOff, 0), blue);
  addGuide(group, new THREE.Vector3(half, -half, 0), new THREE.Vector3(half, yOff, 0), blue);

  const xOff = half + offset;
  addDimLine(
    group,
    new THREE.Vector3(xOff, -half, 0),
    new THREE.Vector3(xOff, half, 0),
    `${aMm} mm`,
    blue,
    a,
  );
  addGuide(group, new THREE.Vector3(half, -half, 0), new THREE.Vector3(xOff, -half, 0), blue);
  addGuide(group, new THREE.Vector3(half, half, 0), new THREE.Vector3(xOff, half, 0), blue);

  // Diagonal between opposite supports
  addDimLine(
    group,
    new THREE.Vector3(-half, -half, 0.01),
    new THREE.Vector3(half, half, 0.01),
    `${diagMm} mm`,
    orange,
    a,
  );

  // Height h
  const hx = half + offset * 1.7;
  addDimLine(
    group,
    new THREE.Vector3(hx, 0, 0),
    new THREE.Vector3(hx, 0, h),
    `${hMm} mm`,
    green,
    a,
  );
  addGuide(group, new THREE.Vector3(half, 0, 0), new THREE.Vector3(hx, 0, 0), green);
  addGuide(group, new THREE.Vector3(0, 0, h), new THREE.Vector3(hx, 0, h), green);

  root.add(group);
  return group;
}

function formatMm(mm) {
  const n = Math.round(mm * 100) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function addGuide(group, a, b, color) {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([a, b]),
    new THREE.LineDashedMaterial({
      color,
      dashSize: 0.1,
      gapSize: 0.07,
      transparent: true,
      opacity: 0.75,
    }),
  );
  line.computeLineDistances();
  group.add(line);
}

function addDimLine(group, from, to, text, color, spanHint) {
  const mat = new THREE.LineBasicMaterial({ color });
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), mat));

  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length() || 1;
  dir.multiplyScalar(1 / len);
  const tick =
    Math.abs(dir.z) > 0.9
      ? new THREE.Vector3(0.12, 0, 0)
      : new THREE.Vector3(-dir.y, dir.x, 0).normalize().multiplyScalar(0.12);

  for (const p of [from, to]) {
    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          p.clone().add(tick),
          p.clone().sub(tick),
        ]),
        mat,
      ),
    );
  }

  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  group.add(makeSpriteLabel(text, mid, Math.max(spanHint * 0.18, 0.7), color));
}

function makeSpriteLabel(text, position, scale, color) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSize = 24;
  ctx.font = `600 ${fontSize}px Tahoma, Verdana, sans-serif`;
  const tw = ctx.measureText(text).width;
  const pad = 4;
  canvas.width = Math.ceil(tw + pad * 2);
  canvas.height = Math.ceil(fontSize + pad * 2);
  ctx.font = `600 ${fontSize}px Tahoma, Verdana, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  sprite.position.copy(position);
  const aspect = canvas.width / canvas.height;
  const h = scale * 0.22;
  sprite.scale.set(h * aspect, h, 1);
  sprite.renderOrder = 20;
  return sprite;
}

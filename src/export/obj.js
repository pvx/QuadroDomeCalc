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

export function downloadOBJ(model, filename = 'quadro-dome.obj') {
  const blob = new Blob([domeToOBJ(model)], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

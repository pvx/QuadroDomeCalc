export function buildReport(geom, products, loads) {
  const { params, sphere, arches, stats, meta } = geom;
  const b = params.b ?? params.a;
  const archLines =
    Math.abs((arches.rhoA ?? arches.rho) - (arches.rhoB ?? arches.rho)) > 1e-6
      ? [
          `Arch ρx (face x=±a/2): ${fmt(arches.rhoA ?? arches.rho)}`,
          `Arch ρy (face y=±b/2): ${fmt(arches.rhoB ?? arches.rho)}`,
          `Opening fx = c+ρx = ${fmt(arches.midHeightIdealA ?? arches.midHeightIdeal)}`,
          `Opening fy = c+ρy = ${fmt(arches.midHeightIdealB ?? arches.midHeightIdeal)}`,
        ]
      : [
          `Arch: ρ = ${fmt(arches.rho)}`,
          `Opening height (ideal surface) f = c+ρ = ${fmt(arches.midHeightIdeal)}`,
        ];
  const lines = [
    `STAGE: geometry + Piped/timber + loads (no member forces)`,
    meta.disclaimer,
    '',
    `a (length on X): ${fmt(params.a)} ${meta.units}`,
    `b (width on Y): ${fmt(b)} ${meta.units}`,
    `h (surface apex): ${fmt(params.h)} ${meta.units}`,
    `n (cells): ${params.n}`,
    '',
    `Sphere: c = ${fmt(sphere.c)}, R = ${fmt(sphere.R)}`,
    `Graph-model limit: h ≤ hypot(a,b)/2 = ${fmt(sphere.hMax)}`,
    '',
    ...archLines,
    '',
    `Nodes: ${stats.nodeCount}`,
    `Edges: ${stats.edgeCount} (internal ${stats.internalEdges}, arch ${stats.archBoundaryEdges})`,
    `Triangles: ${stats.triangleCount}`,
    `Shell area: ${fmt(stats.surfaceArea)} ${meta.units}²`,
    `Chord sum: ${fmt(stats.totalEdgeLength)} ${meta.units}`,
  ];

  if (products) {
    lines.push(
      '',
      `Connection: ${products.connectionType}`,
      `Pipe Ø: ${products.pipeD} mm` +
        (loads?.params?.pipeLengthMm != null
          ? ` · L ${loads.params.pipeLengthMm} mm`
          : ''),
      `Timber: ${products.beamsWidth} × ${products.beamsThickness} mm`,
      ...(loads?.params?.osbThicknessMm != null
        ? [
            `OSB thickness: ${loads.params.osbThicknessMm} mm` +
              (loads.params.osbFaceHeightMm != null
                ? ` · face height ${loads.params.osbFaceHeightMm} mm`
                : ''),
          ]
        : []),
      `Timber–pipe gap: ${products.hubGapMm ?? 5} mm`,
      `OSB panel gap: ${products.panelGapMm ?? 8} mm`,
      `Cut-list sum (timber): ${fmt(products.stats.timberTotalMm)} mm`,
      `Edge types: ${products.stats.edgeTypeCount}`,
      `Face types: ${products.stats.faceTypeCount}`,
      `Vertex types (hubs): ${products.stats.hubTypeCount}`,
      products.note,
    );
  }

  if (loads) {
    const m = loads.materials;
    const f = loads.forces;
    const lp = loads.params;
    lines.push(
      '',
      '—— Loads (masses / reactions) ——',
      loads.note,
      `ρ: pine ${lp.densityTimber}, steel ${lp.densitySteel}, OSB ${lp.densityOsb} kg/m³`,
      `Pipe wall ${lp.pipeWallMm} mm · L ${lp.pipeLengthMm} mm · OSB ${lp.osbThicknessMm} mm · ` +
        `plate ${lp.plateThicknessMm}×${lp.beamsWidth}×(${lp.plateEmbedMm}+tail) mm ×${lp.platesPerEnd}/end`,
      `Timber: ${fmt(m.timberKg)} kg`,
      `Hubs (hollow pipe ×${loads.volumes.hubCount}): ${fmt(m.hubKg)} kg`,
      `Plates: ${fmt(m.plateKg)} kg`,
      `OSB3: ${fmt(m.osbKg)} kg`,
      `Total mass: ${fmt(m.deadKg)} kg · weight ${fmt(f.deadKN)} kN`,
      `Snow ${lp.snowKPa} kPa · Ahoriz ${fmt(f.snowAreaM2)} m² → ${fmt(f.snowKN)} kN`,
      `Wind +X ${lp.windKPa} kPa · silhouette ${fmt(f.windSilhouetteM2)} m² → Fx ${fmt(f.windFxKN)} kN`,
      `Wind pressure-center z: ${fmt(f.zCpMm)} mm · M = ${fmt(f.windMomentKNm)} kN·m`,
      `Σ Fz supports = ${fmt(f.verticalKN)} kN`,
    );
    for (const s of loads.supports) {
      lines.push(
        `${s.id} (${fmt(s.x)}, ${fmt(s.y)}): Fz ${fmt(s.FzKN)} kN, Fx≈ ${fmt(s.FxShareKN)} kN`,
      );
    }
    lines.push(loads.supports[0]?.note || '');
  }

  lines.push('', geom.meta.note);
  return lines.join('\n');
}

function fmt(n) {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(2);
  if (abs >= 1) return n.toFixed(4);
  return n.toPrecision(6);
}

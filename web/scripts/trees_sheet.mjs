// Isolated production-renderer control sheet; uses the existing Vite server only.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = new URL('../out/fix-v7/trees/', import.meta.url); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1435 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/trees-control.html', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto('http://127.0.0.1:5173/trees-control.html');
  const report = await page.evaluate(async base => {
    const { silhouetteBuilding, CITY3D_MATERIALS } = await import(`${base}render/city3dMeshes.ts`);
    const { treeDwelling, TREE_FAMILIES } = await import(`${base}render/cityTrees.ts`);
    const { buildingRoof, roofLight } = await import(`${base}render/cityMassing.ts`);
    const { UrbanBuildingPass } = await import(`${base}ui/urbanBuilding3d.ts`);
    const { buildingTint } = await import(`${base}render/buildingPalette.ts`);
    document.head.innerHTML = '<style>*{box-sizing:border-box}body{margin:0;background:#eee9dc;color:#343e31;font:16px system-ui}h1{font-size:25px;margin:20px 28px 4px}p{margin:0 28px 16px;color:#67705e}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#c9cdbd}.cell{background:#f5f1e7;text-align:center;height:440px}canvas{display:block;margin:auto}b{display:block;font-size:17px}small{color:#68705e}</style>';
    document.body.innerHTML = '<h1>Elven tree dwellings · 12 stable lot seeds</h1><p>Production 3D mesh + matching plan · oak / umbrella / oval / willow / clustered · common metre scale</p><div class="grid"></div>';
    const ring = Array.from({ length: 16 }, (_, i) => ({ x: 6 * Math.cos(i * Math.PI / 8), y: 6 * Math.sin(i * Math.PI / 8) }));
    const seeds = [];
    for (let i = 0; seeds.length < 12 && i < 500; i++) {
      const seed = `lot-${i}`, tree = treeDwelling(ring, 11.5, 5.7, seed), target = TREE_FAMILIES[seeds.length % 5];
      if (tree.family === target) seeds.push({ seed, tree });
    }
    const report = [], rendered = [];
    for (const { seed, tree } of seeds) {
      const tone = Math.round(Number(seed.slice(4)) % 16) / 15;
      const footprint = [{ outer: ring, holes: [] }], massing = [{ floors: 1, eave_m: 11.5, rise_m: 5.7, roof: 'dome', ridges: [], cover: 'turf', wall: 'wood', tone,
        volumes: [{ ring: ring.map(p => [p.x, p.y]), eave_m: 11.5, rise_m: 5.7, roof: 'dome', ridges: [], form: 'tree', tree_seed: seed }] }];
      const building = silhouetteBuilding({ id: seed, parcel_id: seed, function: 'domestic', culture: { culture: 'elven', pack: '', mode: 'inspired', borrowing: null }, recipe_id: 'silhouette', variant_id: '', ground_z_m: 0,
        footprint, roof_footprint: footprint, volumes: [], structural_features: [], transform: { origin: { x: 0, y: 0 }, orientation_deg: 0 }, programme: { role: 'dwelling.house', massing } });
      rendered.push(building);
      const cell = document.createElement('div'); cell.className = 'cell'; document.querySelector('.grid').append(cell);
      const canvas = document.createElement('canvas'); canvas.width = 399; canvas.height = 285; cell.append(canvas);
      const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true }); if (!gl) throw Error('WebGL2 unavailable');
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0.961, 0.945, 0.906, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      let draws = 0; const draw = gl.drawArrays.bind(gl); gl.drawArrays = (...args) => { draws++; draw(...args); };
      const pass = new UrbanBuildingPass(gl); pass.setScene({ buildings: [building], materials: CITY3D_MATERIALS }, { style: 'cartographic', diagnostic: 'none' });
      const h = 19, w = h * canvas.width / canvas.height;
      const matrix = new Float32Array([0.866 / w, -0.25 / h, -0.433 / 80, 0, 0, 0.866 / h, -0.5 / 80, 0, 0.5 / w, 0.433 / h, 0.75 / 80, 0, 0, 0, 0, 1]);
      pass.draw({ matrix, cameraX: 0, cameraY: 0, targetHeight: 12, exaggeration: 1, focal: 300, distance: 60 });
      const plan = document.createElement('canvas'); plan.width = 399; plan.height = 104; cell.append(plan); const ctx = plan.getContext('2d');
      const tint = buildingTint('elven', 'wood', 'turf', tone), rgb = c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;
      for (const face of buildingRoof(footprint, massing)) {
        if (face.normal[2] < 0.08) continue;
        ctx.beginPath(); face.points.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](199.5 + p.x * 6.5, 52 + p.y * 6.5)); ctx.closePath();
        const light = roofLight(face.normal); ctx.fillStyle = rgb(tint.roof.map(v => Math.max(0, Math.min(1, v * (1 + light))))); ctx.fill();
      }
      const label = document.createElement('b'); label.textContent = `${tree.family} · ${tree.platforms.length} platform${tree.platforms.length > 1 ? 's' : ''}`; cell.append(label);
      const small = document.createElement('small'); small.textContent = `${seed} · scale ${tree.scale.toFixed(2)} · trunk ${(tree.trunkRadius / tree.radius * 100).toFixed(0)}%`; cell.append(small);
      report.push({ seed, family: tree.family, platforms: tree.platforms.map(p => p.shape), drawCalls: draws, faces: building.volumes[0].roof_mesh.faces.length, renderer: gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) });
    }
    // Variant geometry must not add draw calls: twelve variants, one palette.
    const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2');
    let draws = 0; const draw = gl.drawArrays.bind(gl); gl.drawArrays = (...args) => { draws++; draw(...args); };
    const pass = new UrbanBuildingPass(gl), materials = rendered[0].volumes[0].materials;
    const buildings = rendered.map(b => ({ ...b, volumes: b.volumes.map(v => ({ ...v, materials, roof_mesh: { ...v.roof_mesh, faces: v.roof_mesh.faces.map(f => ({ ...f, material: f.material.includes(':opening') ? f.material : f.material.includes(':cover:') ? materials.cladding : materials.coating })) } })) }));
    pass.setScene({ buildings, materials: CITY3D_MATERIALS }, { style: 'cartographic', diagnostic: 'none' });
    pass.draw({ matrix: new Float32Array([0.03, 0, 0, 0, 0, 0.03, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 1]), cameraX: 0, cameraY: 0, targetHeight: 0, exaggeration: 1, focal: 300, distance: 60 });
    if (draws !== 3) throw Error(`Tree batching regression: ${draws} draws for 12 variants`);
    return { specimens: report, batchProbe: { buildings: buildings.length, drawCalls: draws } };
  }, `/@fs/${new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')}`);
  if (errors.length) throw Error(errors.join('\n'));
  await page.screenshot({ path: new URL('trees-sheet.png', out).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  writeFileSync(new URL('report.json', out), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }

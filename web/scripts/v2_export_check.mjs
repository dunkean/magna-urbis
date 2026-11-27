/** Exercise the export dialog in Chrome and import the resulting files with installed tools. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { gunzipSync, unzipSync } from 'fflate';
import { chromium } from 'playwright';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5174/v2.html' },
    project: { type: 'string' },
    formats: { type: 'string', default: 'png,svg,glb,obj,godot,dd2vtt,unity,capture3d' },
    cdp: { type: 'string' },
    visible: { type: 'boolean' },
    out: { type: 'string', default: 'out' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log('npm run test:v2:exports -- --project <.muproj> [--url http://127.0.0.1:5174/v2.html] [--formats png,svg,glb,obj,godot,dd2vtt,unity,capture3d] [--cdp http://127.0.0.1:9222] [--visible] [--out out]');
  process.exit(0);
}

const url = new URL(values.url);
const formats = values.formats.split(',').map(format => format.trim());
assert(formats.length && formats.every(format => ['png', 'svg', 'glb', 'obj', 'godot', 'dd2vtt', 'unity', 'capture3d'].includes(format)), 'Unknown export format.');
assert(values.project || values.cdp, 'Use --project for a fresh Chrome session, or --cdp with a Magna Urbis tab containing a map.');
if (values.cdp) {
  const endpoint = new URL(values.cdp);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname), 'Use a loopback Chrome debugging endpoint.');
}

await mkdir(resolve(values.out), { recursive: true });
const out = await mkdtemp(join(resolve(values.out), 'v2-export-check-'));
const run = promisify(execFile);
const tool = async (exe, args) => run(exe, args, { timeout: 180000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
const programFiles = process.env.ProgramW6432 ?? process.env.ProgramFiles ?? '';
const local = process.env.LOCALAPPDATA ?? '';
const blenderRoot = join(programFiles, 'Blender Foundation');
const blenderDir = existsSync(blenderRoot) ? (await readdir(blenderRoot)).filter(name => name.startsWith('Blender ')).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))[0] : undefined;
const blender = process.env.MAGNA_BLENDER ?? (blenderDir && join(blenderRoot, blenderDir, 'blender.exe'));
const godot = process.env.MAGNA_GODOT ?? join(local, 'Microsoft', 'WinGet', 'Links', 'godot_console.exe');
const inkscape = process.env.MAGNA_INKSCAPE ?? join(programFiles, 'Inkscape', 'bin', 'inkscape.com');
const unityCli = join(local, 'Microsoft', 'WindowsApps', 'unity.exe');

function pngSize(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Expected a PNG.');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

async function unpack(bytes, destination) {
  const entries = unzipSync(bytes);
  assert(Object.keys(entries).length, 'Empty archive.');
  for (const [name, body] of Object.entries(entries)) {
    const file = resolve(destination, name);
    assert(!isAbsolute(name) && file.startsWith(destination + sep), 'Archive entry escapes the destination.');
    if (name.endsWith('/')) await mkdir(file, { recursive: true });
    else {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, body);
    }
  }
  return entries;
}

async function checkInApp(format, file, bytes) {
  if (format === 'png' || format === 'capture3d') return { pixels: pngSize(bytes) };
  if (format === 'svg') {
    assert.match(bytes.toString('utf8', 0, 512), /<svg\b[^>]*viewBox=/, 'Missing SVG viewport.');
    if (!existsSync(inkscape)) return { status: 'skipped', reason: 'Inkscape CLI unavailable' };
    const preview = join(out, 'inkscape.png');
    await tool(inkscape, [file, '--export-width=800', `--export-filename=${preview}`]);
    return { app: 'Inkscape', pixels: pngSize(await readFile(preview)) };
  }
  if (format === 'dd2vtt') {
    const data = JSON.parse(bytes);
    assert(data.resolution.pixels_per_grid >= 50, 'Invalid UVTT grid.');
    assert(Array.isArray(data.line_of_sight) && Array.isArray(data.portals));
    return { pixels: pngSize(Buffer.from(data.image, 'base64')), walls: data.line_of_sight.length, doors: data.portals.length, status: 'manual', reason: 'MapTool import needs its desktop UI' };
  }
  if (format === 'unity') {
    const payload = Buffer.from(gunzipSync(bytes));
    assert(payload.includes(Buffer.from('map.obj')) && payload.includes(Buffer.from('map.mtl')), 'Missing Unity mesh assets.');
    let unity = process.env.MAGNA_UNITY;
    if (existsSync(unityCli)) {
      const { stdout } = await tool(unityCli, ['license', '--no-banner', '--format', 'json']);
      if (!JSON.parse(stdout).data.items.length) return { status: 'skipped', reason: 'No active Unity license' };
      if (!unity) {
        const { stdout } = await tool(unityCli, ['editors', '-i', '--no-banner', '--format', 'json']);
        unity = JSON.parse(stdout).data.items.find(editor => existsSync(editor.location))?.location;
      }
    }
    if (!unity || !existsSync(unity)) return { status: 'skipped', reason: 'Unity Editor unavailable' };
    const project = join(out, 'unity-project');
    await tool(unity, ['-batchmode', '-nographics', '-quit', '-createProject', project, '-logFile', join(out, 'unity-create.log')]);
    await tool(unity, ['-batchmode', '-nographics', '-quit', '-projectPath', project, '-importPackage', file, '-logFile', join(out, 'unity-import.log')]);
    const assetRoot = join(project, 'Assets', 'Magna Urbis');
    const folders = await readdir(assetRoot);
    assert(
      folders.some(folder => existsSync(join(assetRoot, folder, 'map.obj'))),
      'Unity did not import map.obj.',
    );
    return { app: 'Unity', assets: folders.length };
  }
  if (format === 'godot') {
    const project = join(out, 'godot-project');
    const entries = await unpack(bytes, project);
    assert(entries['project.godot'] && entries['map.tscn'] && entries['map.glb']);
    if (!existsSync(godot)) return { status: 'skipped', reason: 'Godot CLI unavailable' };
    const imported = await tool(godot, ['--headless', '--path', project, '--editor', '--import']);
    const executed = await tool(godot, ['--headless', '--path', project, '--quit-after', '4']);
    assert.doesNotMatch(imported.stderr + executed.stderr, /(?:SCRIPT |Parse )?ERROR:/, 'Godot logged an import or scene error.');
    return { app: 'Godot', scene: 'map.tscn' };
  }

  let mesh = file;
  if (format === 'glb') assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  else {
    const directory = join(out, 'obj');
    const entries = await unpack(bytes, directory);
    assert(entries['map.obj'] && entries['map.mtl']);
    mesh = join(directory, 'map.obj');
  }
  if (!blender || !existsSync(blender)) return { status: 'skipped', reason: 'Blender CLI unavailable' };
  const operator = format === 'glb' ? 'bpy.ops.import_scene.gltf' : 'bpy.ops.wm.obj_import';
  const expression = `import bpy; bpy.ops.wm.read_factory_settings(use_empty=True); ${operator}(filepath=${JSON.stringify(mesh)}); meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']; assert meshes; print('MESHAUDIT', len(meshes), sum(len(o.data.polygons) for o in meshes))`;
  const { stdout } = await tool(blender, ['--background', '--python-exit-code', '1', '--python-expr', expression]);
  const counts = stdout.match(/MESHAUDIT (\d+) (\d+)/);
  assert(counts && Number(counts[2]) > 0, 'Blender imported no faces.');
  return { app: 'Blender', objects: Number(counts[1]), faces: Number(counts[2]) };
}

const browser = values.cdp ? await chromium.connectOverCDP(values.cdp) : await chromium.launch({ channel: process.env.MAGNA_BROWSER_CHANNEL ?? 'chrome', headless: !values.visible, args: ['--enable-unsafe-webgpu'] });
const report = {};
try {
  const pages = browser
    .contexts()
    .flatMap(context => context.pages())
    .filter(page => {
      const current = new URL(page.url());
      return current.origin === url.origin && current.pathname === url.pathname;
    });
  if (values.cdp) assert.equal(pages.length, 1, 'Open exactly one Magna Urbis tab at --url in the debugging session.');
  const page = values.cdp ? pages[0] : await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  if (!values.cdp) {
    url.searchParams.set('empty', '');
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  }
  if (values.project) {
    await page.locator('#import-open').click();
    const project = resolve(values.project);
    if (values.cdp) {
      assert(existsSync(project), 'Project file unavailable.');
      // The attached browser is local, so let Chrome read the file directly even for large projects.
      const session = await page.context().newCDPSession(page);
      try {
        const { root } = await session.send('DOM.getDocument');
        const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#project-file' });
        await session.send('DOM.setFileInputFiles', { nodeId, files: [project] });
      } finally {
        await session.detach();
      }
    } else await page.locator('#project-file').setInputFiles(project);
    await page.locator('#import-dialog').waitFor({ state: 'hidden', timeout: 90000 });
  }

  const save = async (format, button) => {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), button.click()]);
    const suffix = { obj: 'obj.zip', godot: 'godot.zip', unity: 'unitypackage', capture3d: '3d.png' }[format] ?? format;
    const path = join(out, `map.${suffix}`);
    await download.saveAs(path);
    return path;
  };
  for (const format of formats) {
    // Close the export settings after any failure so the other formats can still be checked.
    try {
      if (format === 'capture3d') {
        const tilt = page.locator('#view3d');
        if (await tilt.isDisabled()) {
          report[format] = { status: 'skipped', reason: (await tilt.getAttribute('title')) ?? '3D is disabled' };
          continue;
        }
        try {
          await page.locator('[data-camera="tilt"]').first().waitFor({ state: 'attached', timeout: 20000 });
        } catch {
          const reason = await page.evaluate(() => window.__muLive?.reason ?? 'No map compositor with 3D available');
          report[format] = { status: 'skipped', reason };
          continue;
        }
        if ((await tilt.getAttribute('aria-pressed')) !== 'true') await tilt.click();
        const shortcut = page.locator('#capture3d');
        await shortcut.waitFor({ state: 'visible' });
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 45000 }), shortcut.click()]);
        const shortcutFile = join(out, 'toolbar.3d.png');
        await download.saveAs(shortcutFile);
        await page.locator('#export-open').click();
        await page.locator('#export-format').selectOption('capture3d');
        assert(!(await page.locator('#export-map-options').isVisible()), '3D capture should use the visible camera without map export options.');
        const file = await save(format, page.locator('#export-go'));
        const result = await checkInApp(format, file, await readFile(file));
        assert.deepEqual(result.pixels, pngSize(await readFile(shortcutFile)));
        report[format] = { file, shortcutFile, ...result };
        console.log(format, 'ok');
        continue;
      }

      await page.locator('#export-open').click();
      await page.locator('#export-format').selectOption('png');
      if (format === 'svg') await page.locator('#export-style').selectOption('atlas');
      await page.locator('#export-format').selectOption(format);
      await page.locator('#export-resolution').selectOption('1600');
      await page.locator('#export-crop').check();
      if (format === 'dd2vtt') await page.locator('#export-vtt-building-walls').check();
      await page.locator('#export-go').click();
      const crop = page.locator('dialog.export-crop');
      await crop.waitFor({ state: 'visible', timeout: 90000 });
      const box = await crop.locator('.export-crop-overlay').boundingBox();
      assert(box);
      await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.26);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.82, box.y + box.height * 0.94, { steps: 8 });
      await page.mouse.up();
      const measurement = await crop.locator('[data-size="pixels"]').textContent();
      assert(measurement?.includes('×'));
      const file = await save(format, crop.locator('[data-action="export"]'));
      await page.locator('#export-dialog').waitFor({ state: 'hidden' });
      const result = await checkInApp(format, file, await readFile(file));
      if (format === 'png') {
        const [width, height] = measurement.split('×').map(side => Number(side.replace(/\D/g, '')));
        assert.deepEqual(result.pixels, [width, height]);
      }
      report[format] = { file, measurement, ...result };
      console.log(format, report[format].status ?? 'ok');
    } catch (error) {
      report[format] = { status: 'failed', reason: error.message };
      if (await page.locator('dialog.export-crop').isVisible()) await page.keyboard.press('Escape');
      if (await page.locator('#export-dialog').isVisible()) await page.keyboard.press('Escape');
      console.error(format, error.message);
    }
  }
} finally {
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(join(out, 'report.json'));
if (Object.values(report).some(check => check.status === 'failed')) process.exitCode = 1;

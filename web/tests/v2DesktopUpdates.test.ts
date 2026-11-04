import { describe, expect, it } from 'vitest';
import { selectDesktopUpdate } from '../src/v2/desktopUpdates';

const current = { version: '0.2.2', platform: 'windows-x86_64' };
function release(version: string, names = [`Magna Urbis V2_${version}_x64-setup.exe`]) {
  return { tag_name: `desktop-v${version}`, draft: false, prerelease: true,
    assets: names.map(name => ({ name, size: 200, state: 'uploaded', browser_download_url: `https://github.com/dunkean/magna-urbis/releases/download/desktop-v${version}/${encodeURIComponent(name)}` })) };
}

describe('desktop installer updates', () => {
  it('includes published prereleases and picks the highest version numerically', () => {
    const result = selectDesktopUpdate([release('0.2.9'), release('0.2.10'), release('0.2.3')], current);
    expect(result).toEqual({ version: '0.2.10', url: release('0.2.10').assets[0].browser_download_url });
  });
  it('ignores current/older versions, drafts, other releases and missing installers', () => {
    expect(selectDesktopUpdate([release('0.2.2'), release('0.1.0'), { ...release('1.0.0'), draft: true },
      { ...release('2.0.0'), tag_name: 'v2.0.0' }, release('3.0.0', ['portable.zip', 'Magna_3.0.0_arm64-setup.exe']), release('bad')], current)).toBeUndefined();
  });
  it('does not impose compatibility bounds across major versions', () => {
    expect(selectDesktopUpdate([release('8.0.0')], current)?.version).toBe('8.0.0');
  });
  it('compares prerelease identifiers and ignores build metadata', () => {
    const info = { ...current, version: '1.0.0-beta.2' };
    expect(selectDesktopUpdate([release('1.0.0-beta.10'), release('1.0.0-alpha'), release('1.0.0-beta.3')], info)?.version).toBe('1.0.0-beta.10');
    expect(selectDesktopUpdate([release('1.0.0-beta.10'), release('1.0.0')], info)?.version).toBe('1.0.0');
    expect(selectDesktopUpdate([release('1.0.0+build.2')], { ...current, version: '1.0.0+build.1' })).toBeUndefined();
  });
  it('selects Linux packages with AppImage fallback and never offers another platform', () => {
    const info = { ...current, platform: 'linux-x86_64' };
    const packages = ['Magna_0.3.0_amd64.deb', 'Magna_0.3.0_amd64.AppImage'];
    expect(selectDesktopUpdate([release('0.3.0', packages)], info)?.url).toMatch(/\.deb$/);
    expect(selectDesktopUpdate([release('0.3.0', packages.slice(1))], info)?.url).toMatch(/\.AppImage$/);
    expect(selectDesktopUpdate([release('0.3.0')], info)).toBeUndefined();
    expect(selectDesktopUpdate([release('0.3.0')], { ...current, platform: 'windows-aarch64' })).toBeUndefined();
  });
  it('ignores invalid, incomplete or foreign download assets', () => {
    const valid = release('0.3.0');
    for (const changes of [{ size: 0 }, { state: 'new' }, { browser_download_url: 'https://example.com/setup.exe' },
      { browser_download_url: valid.assets[0].browser_download_url + '?redirect=1' }]) {
      expect(selectDesktopUpdate([{ ...valid, assets: [{ ...valid.assets[0], ...changes }] }], current)).toBeUndefined();
    }
    expect(selectDesktopUpdate([null, {}, { ...valid, assets: [null] }], current)).toBeUndefined();
    expect(() => selectDesktopUpdate({}, current)).toThrow();
  });
});

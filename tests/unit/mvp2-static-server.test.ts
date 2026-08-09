import * as path from 'node:path';
import { resolveStaticAssetPath, staticCacheControl, staticContentType } from '../../server/mvp2/api';

describe('MVP2 production static server', () => {
  test.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['app.js', 'text/javascript; charset=utf-8'],
    ['app.mjs', 'text/javascript; charset=utf-8'],
    ['app.css', 'text/css; charset=utf-8'],
    ['map.json', 'application/json; charset=utf-8'],
    ['sprite.svg', 'image/svg+xml'],
    ['background.webp', 'image/webp'],
    ['font.woff2', 'font/woff2'],
    ['engine.wasm', 'application/wasm'],
    ['unknown.bin', 'application/octet-stream'],
  ])('serves %s with a browser-safe MIME type', (fileName, expected) => {
    expect(staticContentType(fileName)).toBe(expected);
  });

  test('resolves files only inside the production build directory', () => {
    const root = path.resolve('/tmp/aisland-dist');
    expect(resolveStaticAssetPath(root, '/')).toBe(path.join(root, 'index.html'));
    expect(resolveStaticAssetPath(root, '/assets/app.js')).toBe(path.join(root, 'assets/app.js'));
    expect(resolveStaticAssetPath(root, '/../secret.txt')).toBeNull();
    expect(resolveStaticAssetPath(root, '/%2e%2e/secret.txt')).toBeNull();
  });

  test('caches only fingerprinted build assets as immutable', () => {
    expect(staticCacheControl('/dist/index.html')).toBe('no-cache');
    expect(staticCacheControl('/dist/generated/maps/island-01/map.runtime.json')).toBe('no-cache');
    expect(staticCacheControl('/dist/assets/index-091e7fe5.js')).toBe('public, max-age=31536000, immutable');
  });
});

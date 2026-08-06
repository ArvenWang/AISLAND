// assets:audit — every generated production image must have a manifest entry
// and every source asset must map to a license file (PRD 5.6 / 21.1).

import * as fs from 'fs';
import * as path from 'path';

export function runAudit() {
  const root = path.join(__dirname, '../..');
  const errors: string[] = [];

  // 1. License files must exist for every source directory used.
  const licenseDir = path.join(root, 'assets/source/mvp2/licenses');
  // Directory -> license file. AI-generated dirs are self-produced assets
  // declared in NOTICE-ASSETS.md and need no third-party license file.
  const licenseMap: Record<string, string> = {
    'calciumtrice-outdoor': 'calciumtrice-outdoor-CC-BY-4.0.txt',
    'pixel-boy-ninja-adventure': 'pixel-boy-ninja-adventure-CC0.txt',
    'island-tileset': 'island-tileset-OGA-BY-3.0.txt',
    'whispers-avalon': 'whispers-of-avalon-CC-BY-3.0.txt',
    'zoria': 'zoria-tileset-CC-BY-4.0.txt',
  };
  const aiGeneratedDirs = ['generated-props', 'generated-terrain'];
  for (const [d, l] of Object.entries(licenseMap)) {
    if (!fs.existsSync(path.join(licenseDir, l))) errors.push(`missing license file: ${l}`);
  }
  const originalDirs = fs.readdirSync(path.join(root, 'assets/source/mvp2/original'));
  for (const d of originalDirs) {
    if (aiGeneratedDirs.includes(d)) continue;
    if (!(d in licenseMap)) errors.push(`unlicensed source dir: ${d}`);
  }

  // 2. Generated images must have manifests.
  const genDir = path.join(root, 'public/generated/maps/aisland-mvp2');
  const metas: string[] = [];
  for (const f of fs.readdirSync(genDir)) {
    if (f.endsWith('.meta.json')) metas.push(f.replace('.meta.json', ''));
  }
  for (const f of fs.readdirSync(genDir)) {
    if (!f.endsWith('.png')) continue;
    const base = f.replace('.png', '');
    if (['terrain', 'decals', 'effects'].includes(base)) continue; // covered by sourceHash/map runtime atlas
    if (!metas.includes(base) && !fs.existsSync(path.join(genDir, base + '.meta.json'))) {
      errors.push(`generated png without manifest: ${f}`);
    }
  }
  // characters/props meta should be copied by compile; verify.
  for (const m of ['characters.meta.json', 'props.meta.json']) {
    if (!fs.existsSync(path.join(genDir, m))) errors.push(`missing generated manifest: ${m}`);
  }

  // 3. Normalized sources must match generated outputs (hash equality).
  const srcNorm = path.join(root, 'assets/source/mvp2/normalized-32px');
  const hashFile = (p: string) => {
    const b = fs.readFileSync(p);
    let h = 0;
    for (let i = 0; i < b.length; i++) h = (h * 31 + b[i]) >>> 0;
    return h.toString(36);
  };
  for (const f of ['terrain.png', 'decals.png', 'props.png', 'effects.png', 'characters.png']) {
    const a = path.join(srcNorm, f);
    const b = path.join(genDir, f);
    if (!fs.existsSync(a)) errors.push(`normalized source missing: ${f}`);
    if (!fs.existsSync(b)) errors.push(`generated output missing: ${f}`);
    if (fs.existsSync(a) && fs.existsSync(b) && hashFile(a) !== hashFile(b)) {
      errors.push(`generated output differs from normalized source: ${f}`);
    }
  }

  if (errors.length) {
    console.error('assets:audit FAIL');
    for (const e of errors) console.error(' -', e);
    process.exit(1);
  }
  console.log('assets:audit PASS');
}

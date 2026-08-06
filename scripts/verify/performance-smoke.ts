// PRD 21.1 performance smoke: map generation/build wall time and runtime map
// sizes stay within gates so the game remains playable on a normal machine.
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

function main() {
  const errors: string[] = [];
  const root = path.join(__dirname, '../..');
  const t0 = Date.now();
  execSync('npx tsx scripts/map/run.ts generate', { cwd: root, stdio: 'pipe' });
  const generateMs = Date.now() - t0;
  const t1 = Date.now();
  execSync('npx tsx scripts/map/run.ts build', { cwd: root, stdio: 'pipe' });
  const buildMs = Date.now() - t1;

  const runtimePath = path.join(root, 'public/generated/maps/aisland-mvp2/map.runtime.json');
  const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
  const terrain = fs.statSync(path.join(root, 'public/generated/maps/aisland-mvp2/terrain.png')).size;
  const props = fs.statSync(path.join(root, 'public/generated/maps/aisland-mvp2/props.png')).size;

  if (generateMs > 120000) errors.push(`map generate took ${generateMs}ms (>120s gate)`);
  if (buildMs > 60000) errors.push(`map build took ${buildMs}ms (>60s gate)`);
  if (terrain > 16 * 1024 * 1024) errors.push(`terrain atlas ${terrain} bytes (>16MB gate)`);
  if (props > 4 * 1024 * 1024) errors.push(`props atlas ${props} bytes (>4MB gate)`);

  console.log(`performance-smoke: generate ${generateMs}ms, build ${buildMs}ms, terrain ${(terrain / 1024).toFixed(0)}KB, props ${(props / 1024).toFixed(0)}KB, map ${runtime.width}x${runtime.height}`);
  if (errors.length) {
    console.error('performance-smoke FAIL');
    for (const e of errors) console.error(' -', e);
    process.exit(1);
  }
  console.log('performance-smoke PASS');
}

main();

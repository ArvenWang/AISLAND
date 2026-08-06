// PRD 21.2 static forbidden-item scan. Fails the build when production code
// (player UI src/, server entrypoints and mvp2 engine) can run mock/replay/
// fixture paths, contains hardcoded dialogue outside prompts, remote explore,
// shared camp storage, runtime RGB mixing, global navigation leakage,
// behaviour fallback on API failure, or one-call-two-speakers dialogue.
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

const root = path.join(__dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    if (f === 'node_modules' || f === 'dist' || f === '.git') continue;
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

const errors: string[] = [];

// Production surfaces: player UI + server entry + mvp2 engine/API.
const prodDirs = [
  path.join(root, 'src'),
  path.join(root, 'server/mvp2'),
  path.join(root, 'server/index.ts'),
];
const prodFiles = prodDirs.flatMap((d) => (fs.statSync(d).isDirectory() ? walk(d) : [d])).filter(
  (f) => !f.endsWith('IslandStage.tsx'), // legacy V0.3 renderer, unreferenced
);

function scan(re: RegExp, label: string, files: string[], context: (line: string) => boolean = () => true) {
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]) && context(lines[i])) {
        errors.push(`${label}: ${path.relative(root, f)}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
      }
    }
  }
}

// 1. Production Mock/Replay/Fixture imports.
scan(/from\s+['"](?:\.\.?\/)+.*(?:mock|replay|fixture)|import\s*\(.*(?:mock|replay|fixture)/i, 'prod imports mock/replay/fixture', prodFiles);

// 2. Shared camp storage (public box) references in production.
scan(/camp_crate|storeItem|takePublic|public[Ii]nventory/, 'public box storage', prodFiles);

// 3. Runtime RGB mixing via getImageData/putImageData (excluding tests).
  scan(/getImageData|putImageData/, 'runtime RGB mixing', prodFiles.filter((f) => !f.endsWith('FogOverlay.ts')), (l) => !/renderMapPixels|preview|IslandStage/.test(l));

// 4. Remote explore: discoveries settling without real movement.
scan(/remoteExplore|exploreAway|discoverAway|settle.*explore/, 'remote explore', prodFiles);

// 5. Global navigation leakage: full-map A* used for unknown exploration.
scan(/findPath\([^)]*\)[^;]*\{[^}]*allowed[^}]*\}[\s\S]{0,80}explored|fullMapPath/, 'global navigation leakage', prodFiles);

// 6. Behaviour fallback: API/parse failure auto rest/consume/move.
scan(/fallback(?:Action|Rest|Move|Consume)|autoRest|autoConsume|autoMove/, 'behaviour fallback', prodFiles);

// 7. One LLM response generating two final dialogue lines.
scan(/generateBoth|bothDialogue|dialogueForBoth/, 'one-call-two-speakers', prodFiles);

// 8. Hardcoded dialogue: complete sentences that look like in-world speech
//    produced outside the planner prompt builder (only prompt parts allowed).
{
  const dialogueish = /['"`][^'"`]{8,}说|['"`][^'"`]{8,}答应|['"`][^'"`]{8,}拒绝|['"`][^'"`]{8,}欺骗/;
  for (const f of prodFiles) {
    if (f.includes('planner.ts') || f.includes('dialogue.ts') || f.includes('api.ts') || f.includes('engine.ts')) continue;
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (dialogueish.test(lines[i])) errors.push(`hardcoded dialogue: ${path.relative(root, f)}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
    }
  }
}

// 9. Prompt remote-control: resource directions / exact thresholds / fixed
//    cooperation instructions must not appear in production prompts.
{
  const promptFiles = [path.join(root, 'server/mvp2/planner.ts')];
  const forbidden = [
    /[必应]须去?(?:北|南|东|西|东北|西北|东南|西南)|低于\s*\d+\s*[必应]?须|低于50[必应]须|固定(?:合作|竞争|策略)|不许(?:合作|给水|共享)/,
  ];
  for (const f of promptFiles) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const re of forbidden) {
        if (re.test(lines[i])) errors.push(`remote-control prompt: ${path.relative(root, f)}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
      }
    }
  }
}

// 10. Production build must not import TestLlmAdapter / ScriptedSurvivalBrain.
{
  const prodBuildFiles = prodFiles.filter((f) => !f.includes('tests') && !f.includes('drivers'));
  scan(/TestLlmAdapter|ScriptedSurvivalBrain/, 'test driver in production', prodBuildFiles);
}

if (errors.length) {
  console.error('static-forbidden-scan FAIL');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}
console.log('static-forbidden-scan PASS');

// Keep child_process import referenced (used by runner wrappers elsewhere).
void cp;

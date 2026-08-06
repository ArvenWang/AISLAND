// Unified CLI runner: npx tsx scripts/map/run.ts <generate|build|validate|analyze|preview|audit>
import { run } from './generate-map';
import * as path from 'path';
import { build } from './compile-tiled';
import { runValidation } from './validate-wang';
import { runAnalysis } from './analyze-map';
import { runPreview } from './render-map-preview';
import { runAudit } from './assets-audit';
import { runRealProps } from './real-props';
import { runRealAssets } from './real-assets';

const cmd = process.argv[2] ?? 'build';
const root = path.join(__dirname, '../..');
switch (cmd) {
  case 'generate': {
    const seed = process.argv[3] ? parseInt(process.argv[3], 10) : 20260807;
    runRealAssets();
    runRealProps();
    run(seed, path.join(root, 'assets/source/mvp2'));
    break;
  }
  case 'build':
    build();
    break;
  case 'validate':
    runValidation();
    break;
  case 'analyze':
    runAnalysis();
    break;
  case 'preview':
    runPreview();
    break;
  case 'audit':
    runAudit();
    break;
  default:
    console.error('unknown command', cmd);
    process.exit(1);
}

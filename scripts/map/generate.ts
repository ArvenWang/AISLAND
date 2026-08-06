import * as path from 'path';
import { run } from './generate-map';

const seed = process.argv[2] ? parseInt(process.argv[2], 10) : 20260807;
const outDir = process.argv[3] ?? path.join(__dirname, '../../assets/source/mvp2');
run(seed, outDir);

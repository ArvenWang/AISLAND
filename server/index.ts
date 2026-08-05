// Server entrypoint: env config, API server bootstrap.

import 'dotenv/config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadExistingWorlds } from './api/server';

const port = Number(process.env.PORT ?? 8787);
const distDir = join(process.cwd(), 'dist');
const staticDir = existsSync(join(distDir, 'index.html')) ? distDir : undefined;

if (process.env.LLM_MODE === 'real' && !process.env.LLM_API_KEY) {
  console.warn('[island] LLM_MODE=real but LLM_API_KEY is not set. Real runs will fail; set it in .env');
}

const server = loadExistingWorlds(port, staticDir);
server.start();

process.on('SIGINT', () => {
  console.log('[island] shutting down');
  process.exit(0);
});

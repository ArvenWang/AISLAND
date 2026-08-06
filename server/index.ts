// Server entrypoint: env config, MVP2 API server bootstrap.
// The legacy V0.3 API (server/api/server.ts) stays in the repo as a runnable
// reference on main; the MVP2 branch serves the mvp2 engine on the API port.

import 'dotenv/config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Mvp2ApiServer } from './mvp2/api';

const port = Number(process.env.PORT ?? 8787);
const distDir = join(process.cwd(), 'dist');
const staticDir = existsSync(join(distDir, 'index.html')) ? distDir : undefined;

if (process.env.LLM_MODE === 'real' && !process.env.LLM_API_KEY) {
  console.warn('[island] LLM_MODE=real but LLM_API_KEY is not set. Real runs will fail; set it in .env');
}

const server = new Mvp2ApiServer(port, staticDir);
server.start();

process.on('SIGINT', () => {
  console.log('[island] shutting down');
  process.exit(0);
});

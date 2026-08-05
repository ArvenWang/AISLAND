// World snapshot persistence + export bundles (SAVE-001..004, LOG-003/004).

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { getProfile } from '../engine/profile';
import { Rng } from '../engine/rng';
import type { ExportBundle, WorldState } from '../engine/types';

const DATA_DIR = join(process.cwd(), 'server', 'data', 'worlds');

export function worldsDir(): string {
  return DATA_DIR;
}

export function ensureWorldsDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

export function worldFilePath(worldId: string): string {
  return join(DATA_DIR, `${worldId}.json`);
}

/** JSON-safe serialization (rng instance -> state, Set -> array). */
export function serializeWorld(world: WorldState): unknown {
  const { rng: _rng, operationIds: _operationIds, ...rest } = world as WorldState & { rng?: unknown };
  return {
    ...rest,
    rngState: world.rng.stateValue,
    operationIds: [...world.operationIds],
  };
}

export function deserializeWorld(data: Record<string, unknown>): WorldState {
  const world = {
    ...data,
    operationIds: new Set((data.operationIds as string[]) ?? []),
  } as unknown as WorldState;
  world.rng = new Rng(world.rngState ?? 0);
  return world;
}

export function saveWorld(world: WorldState): string {
  ensureWorldsDir();
  const path = worldFilePath(world.worldId);
  writeFileSync(path, JSON.stringify(serializeWorld(world), null, 2));
  return path;
}

export function loadWorld(worldId: string): WorldState | null {
  const path = worldFilePath(worldId);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    return deserializeWorld(data);
  } catch {
    return null;
  }
}

export function listWorlds(): Array<{ worldId: string; status: string; gameTime: number; fixture: string; seed: number }> {
  ensureWorldsDir();
  const out: Array<{ worldId: string; status: string; gameTime: number; fixture: string; seed: number }> = [];
  for (const f of readdirSync(DATA_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const w = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8'));
      out.push({
        worldId: w.worldId,
        status: w.status,
        gameTime: w.gameTime,
        fixture: w.scenario?.fixture,
        seed: w.scenario?.seed,
      });
    } catch {
      // skip corrupt files
    }
  }
  return out;
}

export function codeCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: process.cwd(), encoding: 'utf8' }).trim().slice(0, 12);
  } catch {
    return 'unknown';
  }
}

export function buildExportBundle(world: WorldState): ExportBundle {
  const profileIds = Object.keys(world.agents);
  const { rng, operationIds, ...rest } = world;
  void rng;
  void operationIds;
  return {
    manifest: {
      worldId: world.worldId,
      scenarioVersion: world.scenario.scenarioVersion,
      promptVersion: world.scenario.promptVersion,
      fixture: world.scenario.fixture,
      seed: world.scenario.seed,
      model: world.scenario.llm.model,
      codeCommit: codeCommit(),
      createdAt: new Date(Date.now()).toISOString(),
      endedAt: world.finalStats ? new Date().toISOString() : '',
      durationMinutes: world.scenario.durationMinutes,
    },
    scenario: world.scenario,
    profiles: Object.fromEntries(profileIds.map((id) => [id, getProfile(id)])),
    events: world.events,
    'final-state': rest as unknown as WorldState,
    metrics: world.finalStats?.metrics ?? { cooperationEvents: [], competitionEvents: [], reciprocityLoops: 0, strategyShifts: [], allianceWindows: [], contentionEvents: [], promises: { total: 0, fulfilled: 0, broken: 0, cancelled: 0, impossible: 0, pending: 0 }, outcomeClass: 'unknown', wasteRate: 0, invalidActionCount: 0, hiddenInfoViolations: 0, llmWaitFraction: 0, conversationCount: 0, requestResponseCount: 0, perAgentLabels: {} },
    'llm-usage': world.llmUsage,
  };
}

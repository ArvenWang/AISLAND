import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { LlmAdapter } from '../../server/llm/adapter';
import { gameMasterValidate, isSelfIntroduction, startAction, stepWorldMovement } from '../../server/mvp2/engine';
import { RealLlmBrain, buildPlannerMessages } from '../../server/mvp2/planner';
import { createMvp2World } from '../../server/mvp2/world';

const CASES = [
  { seed: 41001, actorId: 'agent_a', otherId: 'agent_b' },
  { seed: 41002, actorId: 'agent_a', otherId: 'agent_c' },
  { seed: 41003, actorId: 'agent_b', otherId: 'agent_c' },
];

function makeBrain() {
  const scenario = {
    seed: 1,
    llm: {
      provider: process.env.LLM_PROVIDER ?? 'deepseek',
      model: process.env.LLM_MODEL ?? 'deepseek-v4-flash',
      mode: 'real',
      temperature: 0.3,
      maxTokens: 900,
      timeoutMs: 25000,
      injectInvalidJsonRate: 0,
      injectTimeoutRate: 0,
      inject429Rate: 0,
    },
  };
  return new RealLlmBrain(new LlmAdapter(scenario as never) as never);
}

function commitTalk(world: ReturnType<typeof createMvp2World>, actorId: string, targetId: string, text: string): void {
  const action = startAction(world, world.agents[actorId], { type: 'talk', target: { kind: 'agent', agentId: targetId }, text });
  if (!action) throw new Error(`could not start scripted talk ${actorId}->${targetId}`);
  stepWorldMovement(world, 30);
}

async function runCase(input: typeof CASES[number]) {
  const map = RuntimeMap.loadDefault();
  const world = createMvp2World(`identity_probe_${input.seed}`, input.seed, map);
  const actor = world.agents[input.actorId];
  const other = world.agents[input.otherId];
  const third = Object.values(world.agents).find((candidate) => candidate.id !== actor.id && candidate.id !== other.id)!;
  actor.x = 20; actor.y = 46;
  other.x = 21; other.y = 46;
  third.x = 30; third.y = 40;
  for (const agent of Object.values(world.agents)) agent.cognitive.visible.fill(1);

  commitTalk(world, actor.id, other.id, `你好，我叫${actor.name}。`);
  commitTalk(world, other.id, actor.id, `认识你很高兴，我叫${other.name}。`);
  for (const conversation of Object.values(world.conversations)) {
    conversation.status = 'ended';
    conversation.updatedAt = world.gameTime;
  }
  actor.pendingConversation = undefined;
  other.pendingConversation = undefined;

  other.x = 60; other.y = 20;
  stepWorldMovement(world, 1);
  other.x = actor.x + 1; other.y = actor.y;
  stepWorldMovement(world, 1);
  commitTalk(world, other.id, actor.id, `${actor.name}，我们之前已经互相介绍过。你现在有什么发现？`);

  const prompt = buildPlannerMessages(world, actor, []).map((message) => message.content).join('\n');
  const promptHasMutualIdentityFact = prompt.includes(`我和${other.name}此前已经互相介绍过`);
  const promptHasPastConversation = prompt.includes('过去的对话记录');
  const promptHasReunionMemory = prompt.includes(`再次在近处遇见了${other.name}`);
  const result = await makeBrain().requestDecision(world, actor.id);
  if (!result) {
    const failedLedger = world.llmLedger.at(-1);
    return {
      seed: input.seed,
      actorId: actor.id,
      actorName: actor.name,
      otherId: other.id,
      otherName: other.name,
      promptHasMutualIdentityFact,
      promptHasPastConversation,
      promptHasReunionMemory,
      nextActionType: null,
      attemptedSelfIntroduction: false,
      validation: null,
      guardBlockedAttempt: false,
      provider: failedLedger?.provider,
      model: failedLedger?.model,
      llmStatus: failedLedger?.status ?? 'missing_ledger',
      passed: false,
    };
  }
  const attemptedSelfIntroduction = result.action.type === 'talk' && isSelfIntroduction(result.action.text ?? '', actor.name);
  const validation = gameMasterValidate(world, actor, result.action);
  const guardBlockedAttempt = attemptedSelfIntroduction && !validation.ok && validation.reason === 'redundant_self_introduction';
  const ledger = world.llmLedger.filter((entry) => entry.status === 'ok').at(-1);
  return {
    seed: input.seed,
    actorId: actor.id,
    actorName: actor.name,
    otherId: other.id,
    otherName: other.name,
    promptHasMutualIdentityFact,
    promptHasPastConversation,
    promptHasReunionMemory,
    nextActionType: result.action.type,
    nextTalkText: result.action.type === 'talk' ? result.action.text : undefined,
    attemptedSelfIntroduction,
    validation,
    guardBlockedAttempt,
    provider: ledger?.provider,
    model: ledger?.model,
    llmStatus: ledger?.status,
    passed: promptHasMutualIdentityFact
      && promptHasPastConversation
      && promptHasReunionMemory
      && (!attemptedSelfIntroduction || guardBlockedAttempt)
      && ledger?.status === 'ok',
  };
}

async function main() {
  if (!process.env.LLM_API_KEY) throw new Error('LLM_API_KEY is required for the real identity-memory probe');
  const cases = [];
  for (const input of CASES) cases.push(await runCase(input));
  const report = {
    schema: 'aisland.phase31.identity_memory_real_probe.v1',
    generatedAt: new Date().toISOString(),
    realCalls: cases.length,
    passed: cases.every((entry) => entry.passed),
    cases,
  };
  const output = path.resolve('acceptance/phase31/followup/identity-memory-real-probe.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

void main();

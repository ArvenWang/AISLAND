// LLM adapter: OpenAI-compatible (DeepSeek), with mock / replay / real modes,
// retries, timeout, fault injection and usage tracking (PRD 21.1-21.4).

import { hashString, Rng } from '../engine/rng';
import type { ScenarioConfig } from '../engine/types';

export type LlmCallResult = {
  content: string | null;
  status: 'ok' | 'parse_failed' | 'timeout' | 'error' | '429' | 'refused';
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  model: string;
};

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type LlmOptions = {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  seed?: number;
};

export class LlmAdapter {
  private scenario: ScenarioConfig;
  private replayStore: Map<string, string> = new Map();
  private rng: Rng;
  public failNextWith429 = false;
  public failNextWithTimeout = false;

  constructor(scenario: ScenarioConfig, replayResponses?: Array<{ promptHash: string; response: string }>) {
    this.scenario = scenario;
    this.rng = new Rng(scenario.seed ^ hashString('llm'));
    for (const r of replayResponses ?? []) this.replayStore.set(r.promptHash, r.response);
  }

  get mode() {
    return this.scenario.llm.mode;
  }

  async chat(messages: LlmMessage[], options: LlmOptions = {}): Promise<LlmCallResult> {
    const start = Date.now();
    const cfg = this.scenario.llm;
    const promptText = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
    const promptHash = hashString(promptText).toString(36);

    // Fault injection applies in every mode except replay (deterministic tests
    // must stay clean); real API acceptance uses it via fixtures (21.4).
    if (this.mode !== 'replay') {
      if (cfg.injectInvalidJsonRate && this.rng.chance(cfg.injectInvalidJsonRate)) {
        const bad = '{invalid json!!!';
        return {
          content: bad,
          status: 'parse_failed',
          latencyMs: 120,
          promptTokens: estimateTokens(promptText),
          completionTokens: 5,
          cachedTokens: 0,
          model: cfg.model,
        };
      }
      if (cfg.injectTimeoutRate && this.rng.chance(cfg.injectTimeoutRate)) {
        await sleep(60);
        return {
          content: null,
          status: 'timeout',
          latencyMs: cfg.timeoutMs + 5,
          promptTokens: estimateTokens(promptText),
          completionTokens: 0,
          cachedTokens: 0,
          model: cfg.model,
        };
      }
      if (cfg.inject429Rate && this.rng.chance(cfg.inject429Rate)) {
        await sleep(30);
        return {
          content: null,
          status: '429',
          latencyMs: 80,
          promptTokens: estimateTokens(promptText),
          completionTokens: 0,
          cachedTokens: 0,
          model: cfg.model,
        };
      }
    }

    if (this.mode === 'mock') {
      return this.mockResponse(promptText, promptHash, options, start);
    }
    if (this.mode === 'replay') {
      const recorded = this.replayStore.get(promptHash);
      if (!recorded) {
        return {
          content: null,
          status: 'error',
          latencyMs: Date.now() - start,
          promptTokens: estimateTokens(promptText),
          completionTokens: 0,
          cachedTokens: 0,
          model: cfg.model,
        };
      }
      return {
        content: recorded,
        status: 'ok',
        latencyMs: 3,
        promptTokens: estimateTokens(promptText),
        completionTokens: estimateTokens(recorded),
        cachedTokens: 0,
        model: cfg.model,
      };
    }

    // Real mode with manual fault injection switches (D batch).
    if (this.failNextWith429) {
      this.failNextWith429 = false;
      return {
        content: null,
        status: '429',
        latencyMs: 50,
        promptTokens: estimateTokens(promptText),
        completionTokens: 0,
        cachedTokens: 0,
        model: cfg.model,
      };
    }
    if (this.failNextWithTimeout) {
      this.failNextWithTimeout = false;
      await sleep(50);
      return {
        content: null,
        status: 'timeout',
        latencyMs: cfg.timeoutMs,
        promptTokens: estimateTokens(promptText),
        completionTokens: 0,
        cachedTokens: 0,
        model: cfg.model,
      };
    }

    const apiUrl = process.env.LLM_API_URL || 'https://api.deepseek.com/v1';
    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) {
      return {
        content: null,
        status: 'error',
        latencyMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        model: cfg.model,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const resp = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          temperature: options.temperature ?? cfg.temperature,
          max_tokens: options.maxTokens ?? cfg.maxTokens,
          // DeepSeek flash: disable chain-of-thought output to cut latency/cost.
          reasoning_effort: (process.env.LLM_REASONING_EFFORT as 'none' | 'low' | 'medium' | 'high' | undefined) ?? 'none',
          ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (resp.status === 429) {
        return {
          content: null,
          status: '429',
          latencyMs: Date.now() - start,
          promptTokens: estimateTokens(promptText),
          completionTokens: 0,
          cachedTokens: 0,
          model: cfg.model,
        };
      }
      if (!resp.ok) {
        return {
          content: null,
          status: 'error',
          latencyMs: Date.now() - start,
          promptTokens: estimateTokens(promptText),
          completionTokens: 0,
          cachedTokens: 0,
          model: cfg.model,
        };
      }
      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number };
      };
      const content = data.choices?.[0]?.message?.content ?? null;
      const status: LlmCallResult['status'] = content ? 'ok' : 'refused';
      return {
        content,
        status,
        latencyMs: Date.now() - start,
        promptTokens: data.usage?.prompt_tokens ?? estimateTokens(promptText),
        completionTokens: data.usage?.completion_tokens ?? estimateTokens(content ?? ''),
        cachedTokens: data.usage?.prompt_cache_hit_tokens ?? 0,
        model: cfg.model,
      };
    } catch (err) {
      clearTimeout(timer);
      const aborted = (err as Error).name === 'AbortError';
      return {
        content: null,
        status: aborted ? 'timeout' : 'error',
        latencyMs: Date.now() - start,
        promptTokens: estimateTokens(promptText),
        completionTokens: 0,
        cachedTokens: 0,
        model: cfg.model,
      };
    }
  }

  private mockResponse(promptText: string, promptHash: string, _options: LlmOptions, _start: number): LlmCallResult {
    // Deterministic mock: mirrors the JSON the real model would return.
    const rng = new Rng(hashString(promptHash) ^ this.scenario.seed);
    const content = promptText.includes('initiatorMessage') ? mockDialogue(promptText, rng) : mockDecision(promptText, rng);
    return {
      content,
      status: 'ok',
      latencyMs: 2,
      promptTokens: estimateTokens(promptText),
      completionTokens: estimateTokens(content),
      cachedTokens: 0,
      model: 'mock-deterministic',
    };
  }
}

function parseMockState(promptText: string, who: string): {
  water: number;
  food: number;
  stamina: number;
  inventory: { water: number; food: number };
  locations: string[];
} {
  const block = promptText.split(`【${who}】`)[1]?.split(/【回应方】|【相关背景】|【对话规则】/)[0] ?? '';
  const w = Number(block.match(/口渴(\d+)/)?.[1] ?? 60);
  const f = Number(block.match(/饥饿(\d+)/)?.[1] ?? 60);
  const s = Number(block.match(/体力(\d+)/)?.[1] ?? 60);
  const inv = block.match(/库存 水(\d+) 食(\d+)/);
  const inventory = { water: Number(inv?.[1] ?? 0), food: Number(inv?.[2] ?? 0) };
  const locations = (block.match(/他知道的地点：([^\n]+)/)?.[1] ?? '').split('、').filter(Boolean);
  return { water: w, food: f, stamina: s, inventory, locations };
}

function mockDialogue(promptText: string, rng: Rng): string {
  const init = parseMockState(promptText, '发起方');
  const resp = parseMockState(promptText, '回应方');
  const initLocations = parseMockState(promptText, '发起方').locations;

  let initiator: Record<string, unknown>;
  if (init.water < 45 && init.inventory.water < 1) {
    initiator = { type: 'request_resource', text: '我快渴得撑不住了，能给我一份水吗？', resource: 'water', amount: 1 };
  } else if (init.food < 40 && init.inventory.food < 1) {
    initiator = { type: 'request_resource', text: '我饿得厉害，能不能分我一点食物？', resource: 'food', amount: 1 };
  } else {
    const secret = initLocations.find((l) => !resp.locations.includes(l) && !l.includes('坠机'));
    if (secret && rng.chance(0.55)) {
      initiator = { type: 'share_location', text: `我发现了${secret}，位置告诉你。`, locationId: secret };
    } else {
      initiator = { type: 'social_chat', text: rng.chance(0.5) ? '这岛上的资源比想象中紧张，我们得想清楚怎么分配。' : '你那边情况怎么样？' };
    }
  }

  let responder: Record<string, unknown>;
  if (initiator.type === 'request_resource') {
    const res = initiator.resource as 'water' | 'food';
    if (resp.inventory[res] >= 1) {
      responder = { type: 'accept_request', text: '行，我手头够，回头给你一份。', resource: res, amount: 1 };
    } else {
      responder = { type: 'reject_request', text: '我也没有了，实在抱歉。', resource: res, amount: 0 };
    }
  } else if (initiator.type === 'share_location') {
    responder = { type: 'social_chat', text: '谢谢，这信息很关键。' };
  } else {
    responder = { type: 'social_chat', text: rng.chance(0.5) ? '先保住自己，再谈合作吧。' : '嗯，我同意先摸清地形。' };
  }
  return JSON.stringify({ initiatorMessage: initiator, responderMessages: [responder] });
}

function mockDecision(promptText: string, rng: Rng): string {
  // Parse the available actions list embedded in the prompt (format "【N】label").
  const lines = promptText.split('\n');
  const actions: Array<{ index: number; label: string }> = [];
  for (const line of lines) {
    const m = line.match(/【(\d+)】(.+)/);
    if (m) actions.push({ index: Number(m[1]), label: m[2] });
  }
  if (actions.length === 0) {
    return JSON.stringify({ actionIndex: 0, publicIntent: '原地等待', privateMotive: '没有可用动作' });
  }
  const idx = pickActionIndex(actions, promptText, rng);
  const chosen = actions.find((a) => a.index === idx) ?? actions[0];
  const fallback = actions.find((a) => a.index !== idx && /休息|原地/.test(a.label)) ?? actions[0];
  return JSON.stringify({
    actionIndex: idx,
    publicIntent: chosen.label,
    privateMotive: mockMotive(chosen.label, promptText, rng),
    fallbackActionIndex: fallback.index,
  });
}

function pickActionIndex(actions: Array<{ index: number; label: string }>, promptText: string, rng: Rng): number {
  const urgentWater = promptText.includes('口渴度') && /口渴度[:：]\s*(\d+)/.test(promptText);
  let water = 60;
  const wm = promptText.match(/口渴度[:：]\s*(\d+)/);
  if (wm) water = Number(wm[1]);
  let food = 60;
  const fm = promptText.match(/饥饿度[:：]\s*(\d+)/);
  if (fm) food = Number(fm[1]);
  let stamina = 60;
  const sm = promptText.match(/体力[:：]\s*(\d+)/);
  if (sm) stamina = Number(sm[1]);
  const knowsWaterSource = /淡水泉|采集淡水|前往淡水/.test(promptText);
  const knowsFoodSource = /椰林|潮池|采集食物/.test(promptText);

  const score = (label: string): number => {
    let s = rng.next() * 3;
    if (water < 25) {
      if (/喝水|取水|采集淡水|前往淡水/.test(label)) s += 30;
      if (/交谈|探索/.test(label)) s -= 8;
      if (/休息/.test(label)) s -= 4;
    } else if (water < 45) {
      if (/喝水|取水|采集淡水|前往淡水/.test(label)) s += 12;
    }
    if (food < 25) {
      if (/进食|取食|采集食物|椰林|潮池/.test(label)) s += 30;
      if (/休息/.test(label)) s -= 4;
    } else if (food < 45) {
      if (/进食|取食|采集食物|椰林|潮池/.test(label)) s += 10;
    }
    // Unknown resource: prioritize exploring likely directions.
    if (water < 50 && !knowsWaterSource) {
      if (/探索|前往/.test(label) && /北|东/.test(label)) s += 13;
      else if (/探索|前往/.test(label)) s += 3;
    }
    if (food < 50 && !knowsFoodSource) {
      if (/探索|前往/.test(label) && /南|东/.test(label)) s += 9;
      else if (/探索|前往/.test(label)) s += 3;
    }
    if (stamina < 15 && /休息/.test(label)) s += 20;
    if (/探索/.test(label) && water > 35 && food > 35 && !knowsWaterSource) s += 8;
    if (/交谈/.test(label) && water > 30 && food > 30 && rng.chance(0.12)) s += 5;
    if (/给.*水|给.*食/.test(label) && (water > 55 || food > 60)) s += 5;
    // Honor outstanding promises.
    const promiseMatch = promptText.match(/我承诺给[^\n]*?(\d+) (水|食物)/);
    if (promiseMatch && /给.*(水|食)/.test(label)) s += 18;
    if (/拾取|背包/.test(label)) s += 12;
    if (/公共箱取/.test(label) && (water < 50 || food < 50)) s += 8;
    return s;
  };
  let best = actions[0];
  let bestScore = -Infinity;
  for (const a of actions) {
    const s = score(a.label);
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  void urgentWater;
  return best.index;
}

function mockMotive(label: string, promptText: string, rng: Rng): string {
  const water = Number(promptText.match(/口渴度[:：]\s*(\d+)/)?.[1] ?? 60);
  const food = Number(promptText.match(/饥饿度[:：]\s*(\d+)/)?.[1] ?? 60);
  if (water < 25) return '我快撑不住了，必须先解决水的问题。';
  if (food < 25) return '饿得厉害，食物优先。';
  if (/给/.test(label)) return rng.chance(0.5) ? '帮对方一把，将来或许有回报。' : '他处境不好，我手里够用就分一点。';
  if (/交谈|请求/.test(label)) return '我需要确认对方的态度，再决定合作还是保留。';
  if (/探索/.test(label)) return '多掌握一处地点，就多一分主动权。';
  return '先稳住自己的状态，再考虑其他。';
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Chinese chars ≈ 1 token each; ASCII words ≈ 0.3 token/char.
  let ascii = 0;
  let cjk = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 128) ascii++;
    else cjk++;
  }
  return Math.ceil(ascii / 4 + cjk * 0.85);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function formatKeyFingerprint(key: string | undefined): string {
  if (!key) return 'not set';
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

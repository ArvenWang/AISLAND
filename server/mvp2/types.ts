// MVP2 world types: the server-authoritative simulation on the 256x192 map.
// P3 covers items/survival; agent brains (planner/dialogue) land in P4/P5.

import type { RuntimeMap } from '../engine/map/runtimeMap';
import type { CognitiveMap } from '../engine/perception/cognitiveMap';

export type ItemKind = 'water' | 'food' | 'wood' | 'lighter' | 'tinder' | 'backpack';

export type GroundItem = {
  itemId: string;
  kind: ItemKind;
  quantity: number;
  x: number;
  y: number;
  source: 'wreckage' | 'dropped' | 'harvested' | 'death';
  droppedBy?: string;
  seenBy: string[];
  claimRecords: Array<{ agentId: string; text: string; gameTime: number }>;
  createdAt: number;
};

export type Inventory = Partial<Record<ItemKind, number>>;

export type Needs = {
  water: number; // 0..100 (lower = more thirsty)
  food: number;
  stamina: number;
  health: number;
  sleepNeed: number; // 0..100 (higher = more tired)
};

export type MentalState = {
  mentalStability: number; // 0..100
  fear: number; // 0..100
  socialSafety: number; // 0..100
};

export type AgentState = {
  id: string;
  profileId: string;
  name: string;
  x: number;
  y: number;
  facing: { x: number; y: number };
  needs: Needs;
  mental: MentalState;
  inventory: Inventory;
  carryUsed: number;
  isAlive: boolean;
  cognitive: CognitiveMap;
  currentAction: ActionInstance | null;
  sleep: { sleeping: boolean; since: number; comfort: number; fireNearby: boolean } | null;
  knowledge: {
    introducedTo: string[];
    knownItems: string[];
    knownFires: string[];
    knownResources: string[];
    claimsHeard: string[];
  };
  relationships: Record<string, { trust: number; resentment: number; dependency: number; affinity: number }>;
  plan: AgentPlan | null;
  stats: {
    harvested: Record<string, number>;
    consumed: Record<string, number>;
    gave: Record<string, number>;
    tookUnattended: number;
    promisesKept: number;
    promisesBroken: number;
  };
  decisions: number;
  lastDecisionAt: number;
};

export type ActionType =
  | 'move'
  | 'explore'
  | 'pickup_item'
  | 'drop_item'
  | 'offer_item'
  | 'accept_handover'
  | 'refuse_handover'
  | 'take_unattended_item'
  | 'search_wreckage'
  | 'harvest_water'
  | 'harvest_food'
  | 'harvest_wood'
  | 'consume'
  | 'build_fire'
  | 'add_fuel'
  | 'sleep'
  | 'wake'
  | 'rest'
  | 'shout'
  | 'talk'
  | 'observe';

export type ActionTarget =
  | { kind: 'cell'; x: number; y: number }
  | { kind: 'item'; itemId: string }
  | { kind: 'agent'; agentId: string }
  | { kind: 'wreck'; wreckId: string }
  | { kind: 'resource'; resourceId: string }
  | { kind: 'fire'; fireId: string }
  | { kind: 'direction'; bearingDeg: number }
  | { kind: 'none' };

export type ActionSpec = {
  type: ActionType;
  target: ActionTarget;
  amount?: number;
  itemKind?: ItemKind;
  text?: string;
  speechAct?: string;
  durationMinutes?: number;
  path?: Array<{ x: number; y: number }>;
};

export type VisualPhase = 'approach' | 'prepare' | 'perform' | 'commit' | 'recover' | 'done' | 'interrupted';

export type ActionInstance = {
  actionId: string;
  actorId: string;
  type: ActionType;
  target: ActionTarget;
  amount?: number;
  itemKind?: ItemKind;
  startedAt: number;
  endsAt: number;
  commitAt?: number;
  phase: VisualPhase;
  progress: number; // 0..1
  path?: Array<{ x: number; y: number }>;
  waypointIndex: number;
  visualActionId: string;
  sourceRequestId?: string;
  text?: string;
};

export type FireState = 'burning' | 'weak' | 'embers' | 'out';

export type FireEntity = {
  fireId: string;
  x: number;
  y: number;
  fuel: number; // island-minutes of burn left
  state: FireState;
  createdBy: string;
  lastFueledBy: string;
  lightRadius: number;
};

export type ResourceNode = {
  resourceId: string;
  kind: 'spring' | 'berry_bush' | 'wood_pile';
  x: number;
  y: number;
  stock: number;
  capacity: number;
  regenPerHour: number;
  depletedAppearance: boolean;
};

export type WreckSite = {
  wreckId: string;
  x: number;
  y: number;
  searched: boolean;
  contents: Inventory;
};

export type WorldEvent = {
  eventId: string;
  worldId: string;
  gameTime: number;
  type: string;
  actorId?: string;
  targetId?: string;
  locationId?: string;
  payload: Record<string, unknown>;
  observers: string[];
  salience: number;
  sourceActionId?: string;
  visualActionId?: string;
};

export type AgentPlan = {
  planId: string;
  longTermGoal: string;
  currentObjective: string;
  steps: Array<{ kind: string; description: string }>;
  stepIndex: number;
  abortConditions: Array<{ kind: string; description: string }>;
  assumptions: string[];
  evidenceEventIds: string[];
  createdAt: number;
  updatedAt: number;
  exploration?: ExplorationPlanData;
};

export type ExplorationPlanData = {
  mode: 'follow_coast' | 'head_inland' | 'follow_slope' | 'follow_sound' | 'search_local' | 'return_to_landmark';
  approximateBearing?: number;
  feature?: string;
  objectiveText: string;
  returnByGameTime?: number;
  abortConditions: string[];
};

export type LlmProvenance = {
  llmRequestId: string;
  agentId: string;
  provider: string;
  model: string;
  promptHash: string;
  responseHash: string;
  status: string;
  tokenUsage: { input: number; output: number; cached: number };
  latencyMs: number;
  gameTime: number;
};

export type Mvp2World = {
  worldId: string;
  seed: number;
  map: RuntimeMap;
  gameTime: number;
  status: 'running' | 'paused' | 'ended';
  agents: Record<string, AgentState>;
  groundItems: Record<string, GroundItem>;
  fires: Record<string, FireEntity>;
  resources: Record<string, ResourceNode>;
  wrecks: Record<string, WreckSite>;
  events: WorldEvent[];
  llmLedger: LlmProvenance[];
  conservationLedger: Array<{ gameTime: number; itemId: string; kind: string; delta: number; note: string }>;
  actionSeq: number;
  eventSeq: number;
  endedReason?: string;
};

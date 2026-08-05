// Core data contracts for the AI Native Island simulation.
// Mirrors PRD 附录 D (core TypeScript data contracts) and section 12.1.

export type ResourceType = 'water' | 'food';

export type TerrainKind = 'water' | 'shallow' | 'sand' | 'grass' | 'dirt' | 'rock' | 'cliff';

export type Vec2 = { x: number; y: number };

// ---------------------------------------------------------------------------
// CharacterProfile (PRD 7.4 / 20.1)
// ---------------------------------------------------------------------------

export type ExperienceModifier = {
  id: string;
  /** What this modifier changes (e.g. initialTrust, scarcitySensitivity). */
  target: string;
  /** Signed additive delta. */
  value: number;
  /** Source biography fact id. */
  sourceFactId: string;
};

export type CharacterProfile = {
  id: string; // agent_a / agent_b / agent_c
  name: string;
  title: string;
  version: string;
  physical: {
    strength: number; // 0-100
    endurance: number; // 0-100
    mobility: number; // 0-100
    metabolism: number; // 0-100 (higher = needs decay faster)
    painTolerance: number; // 0-100
  };
  skills: Record<string, number>; // navigation, observation, waterFinding, foraging, loadHandling, harvestEfficiency, negotiation, plantKnowledge, criticalNeedAssessment
  personality: {
    empathy: number; // 0-100
    dominance: number; // 0-100
    riskTolerance: number; // 0-100
    impulsivity: number; // 0-100
    lossAversion: number; // 0-100
    conflictAvoidance: number; // 0-100
    honestyPreference: number; // 0-100
    reciprocitySensitivity: number; // 0-100
    futureOrientation: number; // 0-100
    normAdherence: number; // 0-100
  };
  moralCosts: {
    deceptionCost: number; // 0-100
    theftCost: number; // 0-100
    harmCost: number; // 0-100
    corpseConsumptionCost: number; // reserved, feature flag off
  };
  experienceModifiers: ExperienceModifier[];
  backgroundFacts: Array<{
    id: string;
    text: string;
    sourceParameterIds: string[];
  }>;
  spriteSheet: string; // f1..f8 / p1..p3
};

// ---------------------------------------------------------------------------
// World state
// ---------------------------------------------------------------------------

export type NeedLevels = {
  water: number; // 0-100 satiation
  food: number; // 0-100 satiation
  stamina: number; // 0-100
  health: number; // 0-100
};

export type Inventory = {
  water: number;
  food: number;
};

export type KnowledgeFact = {
  factId: string;
  ownerId: string;
  factType: 'location' | 'observation' | 'belief';
  targetId: string; // location id or subject agent id
  value: string;
  source: 'discovery' | 'share' | 'inference' | 'observation';
  confidence: number; // 0-1
  verified: boolean;
  gameTime: number;
  sourceEventId?: string;
};

export type RelationshipState = {
  fromId: string;
  toId: string;
  trust: number; // -100..100
  resentment: number; // 0..100
  dependency: number; // 0..100
  affinity: number; // -100..100
  updatedAt: number;
  deltas: RelationshipDelta[];
};

export type RelationshipDelta = {
  sourceEventId: string;
  ruleId: string;
  field: 'trust' | 'resentment' | 'dependency' | 'affinity';
  delta: number;
  gameTime: number;
  explanation: string;
};

export type PromiseStatus = 'pending' | 'fulfilled' | 'broken' | 'cancelled' | 'impossible';

export type PromiseRecord = {
  promiseId: string;
  promiserId: string;
  recipientId: string;
  actionType: 'give' | 'share_location' | 'store';
  resource?: ResourceType;
  amount?: number;
  locationId?: string;
  deadline: number; // game time
  createdAt: number;
  status: PromiseStatus;
  statusChangedAt?: number;
  statusReason?: string;
  adjudicationEventId?: string;
  sourceEventId?: string;
};

export type AgentStrategy = {
  label: string; // 合作中 / 优先自保 / 资源控制 / 关系修复 / 观望
  windowStart: number;
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type SpeechActType =
  | 'request_resource'
  | 'offer_trade'
  | 'promise'
  | 'share_location'
  | 'warn'
  | 'accuse'
  | 'threaten'
  | 'social_chat'
  | 'accept_request'
  | 'reject_request'
  | 'cancel_promise';

export type SpeechAct = {
  type: SpeechActType;
  text: string;
  resource?: ResourceType;
  amount?: number;
  locationId?: string;
  promiseId?: string;
  deadline?: number | string;
};

export type Action =
  | { type: 'move'; targetId: string }
  | { type: 'explore'; targetId: string }
  | { type: 'harvest'; targetId: string; amount: number }
  | { type: 'consume'; resource: ResourceType; amount: number }
  | { type: 'give'; targetId: string; resource: ResourceType; amount: number }
  | { type: 'store'; targetId: string; resource: ResourceType; amount: number }
  | { type: 'take'; targetId: string; resource: ResourceType; amount: number }
  | { type: 'talk'; targetId: string; speechAct?: SpeechAct }
  | { type: 'rest'; targetId?: string; durationMinutes?: number }
  | { type: 'loot_backpack'; targetId: string };

export type ActionIntent = {
  requestId: string;
  actorId: string;
  snapshotVersion: number;
  requestedGameTime: number;
  action: Action;
  publicIntent: string;
  privateMotive: string;
  fallback?: Action;
};

export type ValidatedAction = {
  intent: ActionIntent;
  startTime: number;
  endTime: number;
  notes: string[];
};

export type ActionInstance = {
  instanceId: string;
  actorId: string;
  action: Action;
  publicIntent: string;
  privateMotive: string;
  sourceOperationId?: string;
  startedAt: number;
  endsAt: number;
  status: 'running' | 'completed' | 'interrupted' | 'failed';
  path?: Vec2[];
  reservation?: {
    nodeId: string;
    amount: number;
  };
};

// ---------------------------------------------------------------------------
// Resources / map
// ---------------------------------------------------------------------------

export type ResourceNode = {
  id: string;
  kind: 'spring' | 'grove' | 'tide_pool' | 'emergency';
  resource: ResourceType;
  position: Vec2;
  stock: number;
  capacity: number;
  regenRule: 'none' | 'restore_to_capacity_daily' | 'add_daily';
  regenAmount?: number;
  harvestDurationMinutes: number;
  interactionRadius: number; // tiles
  failureChance: number; // 0-1 (tide pool)
  discoveredBy: string[]; // agent ids that have discovered this node
  harvestHistory: Array<{ gameTime: number; actorId: string; amount: number }>;
};

export type Container = {
  id: string;
  kind: 'camp_crate' | 'corpse_backpack';
  position: Vec2;
  inventory: Inventory;
  ownerId?: string; // for corpse backpacks: the dead agent id
};

export type MapLocation = {
  id: string;
  name: string;
  kind: 'camp' | 'zone' | 'node' | 'ridge' | 'beach';
  position: Vec2;
  radius: number;
  discoveryZone?: Vec2[]; // tiles that trigger discovery
  description: string;
};

export type WorldEvent = {
  eventId: string;
  worldId: string;
  worldVersion: number;
  gameTime: number;
  type: string;
  actorId?: string;
  targetId?: string;
  locationId?: string;
  payload: Record<string, unknown>;
  observers: string[];
  salience: number; // 0-10
  sourceOperationId?: string;
};

export type Message = {
  messageId: string;
  conversationId: string;
  speakerId: string;
  speechAct: SpeechAct;
  gameTime: number;
};

export type Conversation = {
  conversationId: string;
  participants: [string, string];
  startedAt: number;
  endsAt: number;
  messages: Message[];
  status: 'active' | 'ended';
};

export type AgentState = {
  id: string;
  name: string;
  profileId: string;
  position: Vec2;
  facing: Vec2;
  needs: NeedLevels;
  inventory: Inventory;
  currentAction?: ActionInstance;
  knownLocations: string[];
  knowledgeFacts: KnowledgeFact[];
  relationships: Record<string, RelationshipState>; // key: other agent id
  promises: PromiseRecord[]; // promises where this agent is promiser
  recentEvents: string[]; // eventIds the agent has observed (recent window)
  strategy: AgentStrategy;
  isAlive: boolean;
  deathTime?: number;
  stress: number; // 0-100
  fear: number;
  desperation: number;
  perceivedScarcity: number;
  socialSecurity: number;
  grievance: Record<string, number>;
  stats: {
    harvested: Inventory;
    consumed: Inventory;
    given: Inventory;
    storedToPublic: Inventory;
    takenFromPublic: Inventory;
    received: Inventory;
    requestsMade: number;
    requestsReceived: number;
    refusalsMade: number;
    promisesFulfilled: number;
    promisesBroken: number;
    locationsShared: number;
    wasted: Inventory;
  };
  decisionCount: number;
  lastDecisionTime: number;
  invalidActionStreak: number;
  lastInvalidAction?: string;
  planDebug?: {
    requestedGameTime: number;
    rawOutput?: string;
    validationResult: string;
    fallbackUsed: boolean;
    latencyMs: number;
  };
};

// ---------------------------------------------------------------------------
// Scenario / world
// ---------------------------------------------------------------------------

export type FixtureId =
  | 'FX-BASE'
  | 'FX-WATER-SECRET'
  | 'FX-DEPENDENCY'
  | 'FX-CONTENTION'
  | 'FX-PROMISE-CRISIS'
  | 'FX-DEATH-BAG'
  | 'FX-LLM-INVALID'
  | 'FX-LLM-LATENCY';

export type ScenarioConfig = {
  scenarioVersion: string;
  promptVersion: string;
  fixture: FixtureId;
  seed: number;
  durationMinutes: number; // 6480 = day5 18:00
  realSecondsPerIslandMinute: number;
  timeScale: number;
  initialConditions: {
    emergencyWater: number;
    emergencyFood: number;
    springInitial: number;
    springDailyRegen: number;
    groveStock: number;
    tidePoolDaily: number;
    waterNeedPerDay: number;
    foodNeedPerDay: number;
    waterSecretFor?: string; // agent id receiving private water clue (FX-WATER-SECRET)
    accelerateNeedsFor?: string; // FX-DEATH-BAG
    contentionAt?: { nodeId: string; agents: string[] }; // FX-CONTENTION
    promiseCrisisFor?: string; // FX-PROMISE-CRISIS
  };
  llm: {
    provider: string;
    model: string;
    mode: 'mock' | 'replay' | 'real';
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    injectInvalidJsonRate?: number;
    injectTimeoutRate?: number;
    inject429Rate?: number;
  };
  featureFlags: {
    corpseConsumption: false;
  };
};

export type WorldConfig = {
  worldId: string;
  scenario: ScenarioConfig;
  createdAt: number;
  lastSavedAt?: number;
};

export type WorldState = {
  worldId: string;
  worldVersion: number;
  gameTime: number; // island minutes from day1 06:00
  status: 'setup' | 'running' | 'paused' | 'ended';
  scenario: ScenarioConfig;
  map: IslandMap;
  agents: Record<string, AgentState>;
  resources: Record<string, ResourceNode>;
  containers: Record<string, Container>;
  events: WorldEvent[];
  conversations: Record<string, Conversation>;
  relationshipHistory: Record<string, Record<string, Array<{ gameTime: number; trust: number; resentment: number; dependency: number; affinity: number }>>>;
  promiseLedger: PromiseRecord[];
  operationIds: Set<string>;
  rngState: number;
  /** Transient seeded RNG instance (not serialized directly; rebuilt from rngState). */
  rng: import('./rng').Rng;
  decisionFreeze: boolean;
  decisionBatch?: {
    batchId: string;
    requestedGameTime: number;
    snapshotVersion: number;
    pending: Record<string, boolean>;
    startedWallMs: number;
  };
  llmUsage: {
    calls: Array<{
      requestId: string;
      kind: 'planner' | 'dialogue' | 'repair' | 'summary';
      agentId: string;
      worldVersion: number;
      promptVersion: string;
      latencyMs: number;
      promptTokens: number;
      completionTokens: number;
      cachedTokens: number;
      status: 'ok' | 'parse_failed' | 'timeout' | 'error' | '429' | 'refused';
      model: string;
      estimatedCostUsd: number;
    }>;
    summary: {
      plannerCalls: number;
      dialogueCalls: number;
      repairCalls: number;
      totalPromptTokens: number;
      totalCompletionTokens: number;
      totalCachedTokens: number;
      totalCostUsd: number;
      p95LatencyMs: number;
      avgLatencyMs: number;
    };
  };
  finalStats?: FinalStats;
};

export type IslandMap = {
  width: number;
  height: number;
  tileDim: number;
  tilesetUrl: string;
  tilesetDimX: number;
  tilesetDimY: number;
  terrain: TerrainKind[][]; // [y][x]
  terrainTile: number[][]; // [y][x] tile index into tileset
  objectTiles: Array<{ x: number; y: number; sheet: 'rpg' | 'gentle'; tileIndex: number }>;
  locations: MapLocation[];
  resourceNodes: ResourceNode[];
  containers: Array<{ id: string; kind: 'camp_crate'; position: Vec2 }>;
  spawnPoints: Vec2[];
  interactionZones: Array<{ id: string; position: Vec2; radius: number }>;
  passable: boolean[][]; // [y][x]
  moveCost: number[][]; // [y][x] multiplier
  tiledJson: unknown; // original Tiled-style JSON for validation / export
};

export type FinalStats = {
  endedAt: number;
  endReason: string;
  survivors: string[];
  deaths: Array<{ agentId: string; gameTime: number; cause: string }>;
  perAgent: Record<
    string,
    {
      alive: boolean;
      finalHealth: number;
      harvested: Inventory;
      consumed: Inventory;
      given: Inventory;
      received: Inventory;
      stored: Inventory;
      taken: Inventory;
      wasted: Inventory;
      refusals: number;
      fulfilled: number;
      broken: number;
      locationsDiscovered: string[];
      locationsShared: number;
    }
  >;
  metrics: BehaviorMetrics;
  timeline: Array<{ gameTime: number; text: string; eventId: string }>;
};

export type BehaviorMetrics = {
  cooperationEvents: string[];
  competitionEvents: string[];
  reciprocityLoops: number;
  strategyShifts: Array<{ agentId: string; from: string; to: string; gameTime: number; triggerEventId: string }>;
  allianceWindows: Array<{ pair: [string, string]; from: number; to: number }>;
  contentionEvents: string[];
  promises: { total: number; fulfilled: number; broken: number; cancelled: number; impossible: number; pending: number };
  outcomeClass: string;
  wasteRate: number;
  invalidActionCount: number;
  hiddenInfoViolations: number;
  llmWaitFraction: number;
  conversationCount: number;
  requestResponseCount: number;
  perAgentLabels: Record<string, string[]>;
};

export type ExportBundle = {
  manifest: {
    worldId: string;
    scenarioVersion: string;
    promptVersion: string;
    fixture: FixtureId;
    seed: number;
    model: string;
    codeCommit: string;
    createdAt: string;
    endedAt: string;
    durationMinutes: number;
  };
  scenario: ScenarioConfig;
  profiles: Record<string, CharacterProfile>;
  events: WorldEvent[];
  'final-state': WorldState;
  metrics: BehaviorMetrics;
  'llm-usage': WorldState['llmUsage'];
};

export type ObserverContext = {
  world: WorldState;
  event: WorldEvent;
};

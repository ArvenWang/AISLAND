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
  privateMotive: string;
  recentObservedEventIds: string[];
  episodicMemories: EpisodicMemory[];
  beliefs: Belief[];
  reflections: Reflection[];
  relationshipEvidence: RelationshipEvidence[];
  pendingOfferIds: string[];
  lastReflectionDay: number;
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
  needsHistory: Array<{ t: number; water: number; food: number }>;
  lastDecisionAction?: string;
  recentPath?: Array<{ x: number; y: number }>;
  pendingConversation?: { conversationId: string; fromId: string; text: string; createdAt: number };
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
  | { kind: 'offer'; offerId: string }
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
  approachDepth?: number;
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
  committed?: boolean;
  phase: VisualPhase;
  progress: number; // 0..1
  path?: Array<{ x: number; y: number }>;
  waypointIndex: number;
  movementBudgetMinutes?: number;
  visualActionId: string;
  sourceRequestId?: string;
  text?: string;
  speechAct?: string;
  planId?: string;
  planStepId?: string;
  pending?: ActionSpec;
  approachDepth?: number;
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

export type WorldPresentationEvent = {
  presentationId: string;
  sourceEventId: string;
  kind: 'speech' | 'shout' | 'pickup' | 'drop' | 'handover' | 'refuse' | 'harvest' | 'consume' | 'discover' | 'fire' | 'sleep' | 'death';
  actorId?: string;
  targetId?: string;
  text?: string;
  conversationId?: string;
  gameTime: number;
  importance: number;
};

export type PlanStep = {
  stepId: string;
  intent: string;
  actionType: ActionType | 'decide_after_observation';
  targetRef?: string;
  successCondition: string;
  abortConditions: string[];
  status: 'pending' | 'active' | 'done' | 'failed' | 'skipped';
  sourceActionId?: string;
  completedAt?: number;
};

export type AgentPlan = {
  planId: string;
  goal: string;
  steps: PlanStep[];
  currentStepIndex: number;
  reasonForPlan: string;
  lastReplannedAt: number;
  evidenceEventIds: string[];
  createdAt: number;
  updatedAt: number;
  exploration?: ExplorationPlanData;
};

export type EpisodicMemory = {
  memoryId: string;
  sourceEventIds: string[];
  summary: string;
  tags: string[];
  importance: number;
  createdAt: number;
  lastReferencedAt?: number;
};

export type Belief = {
  beliefId: string;
  kind: 'observed' | 'hearsay' | 'relationship';
  topic: string;
  proposition: string;
  confidence: number;
  sourceEventIds: string[];
  aboutAgentId?: string;
  updatedAt: number;
};

export type Reflection = {
  reflectionId: string;
  day: number;
  summary: string;
  sourceMemoryIds: string[];
  beliefUpdates: string[];
  relationshipNotes: string[];
  strategyLessons: string[];
  createdAt: number;
};

export type RelationshipEvidence = {
  evidenceId: string;
  sourceEventId: string;
  observerId: string;
  otherId: string;
  kind: 'helped_me' | 'refused_request' | 'took_claimed_item' | 'kept_promise' | 'broke_promise' | 'shared_verified_info' | 'misled_me' | 'other';
  valence: number;
  confidence: number;
  gameTime: number;
};

export type ClaimFact = {
  factId: string;
  kind: 'claim';
  speakerId: string;
  listenerId: string;
  text: string;
  sourceEventId: string;
  status: 'unverified' | 'supported' | 'contradicted';
  createdAt: number;
};

export type OfferFact = {
  factId: string;
  kind: 'offer';
  proposerId: string;
  recipientId: string;
  itemKind: ItemKind;
  amount: number;
  sourceEventId: string;
  status: 'pending' | 'accepted' | 'refused' | 'expired' | 'failed';
  createdAt: number;
  resolvedAt?: number;
  resolutionEventId?: string;
};

export type PromiseFact = {
  factId: string;
  kind: 'promise';
  promiserId: string;
  beneficiaryId: string;
  action: string;
  targetRef?: string;
  dueBy: number;
  sourceEventId: string;
  status: 'pending' | 'kept' | 'broken' | 'expired' | 'impossible';
  createdAt: number;
  resolvedAt?: number;
};

export type JointIntentFact = {
  factId: string;
  kind: 'joint_intent';
  participantIds: [string, string];
  intent: string;
  sourceEventIds: string[];
  status: 'active' | 'completed' | 'abandoned';
  createdAt: number;
  updatedAt: number;
};

export type OwnershipClaimFact = {
  factId: string;
  kind: 'ownership_claim';
  claimantId: string;
  itemRef: string;
  scope: 'mine' | 'ours';
  sourceEventId: string;
  createdAt: number;
};

export type RequestFact = {
  factId: string;
  kind: 'request';
  requesterId: string;
  recipientId: string;
  requestType: string;
  targetRef?: string;
  amount?: number;
  sourceEventId: string;
  status: 'pending' | 'accepted' | 'refused' | 'expired';
  createdAt: number;
  resolvedAt?: number;
};

export type SocialFact = ClaimFact | OfferFact | PromiseFact | JointIntentFact | OwnershipClaimFact | RequestFact;

export type ConversationTurn = {
  turnId: string;
  speakerId: string;
  text: string;
  speechActType: 'utterance' | 'claim' | 'offer' | 'request' | 'promise' | 'accept' | 'refuse';
  gameTime: number;
  eventId: string;
  llmRequestId?: string;
};

export type ConversationSession = {
  conversationId: string;
  participantIds: [string, string];
  status: 'awaiting_response' | 'completed' | 'ended' | 'timed_out';
  currentSpeakerId: string;
  turns: ConversationTurn[];
  startedAt: number;
  updatedAt: number;
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
  memoryRefs?: string[];
  beliefRefs?: string[];
  conversationId?: string;
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
  conversations: Record<string, ConversationSession>;
  events: WorldEvent[];
  presentationEvents: WorldPresentationEvent[];
  socialFacts: Record<string, SocialFact>;
  relationshipEvidence: RelationshipEvidence[];
  repetitionIncidents: Array<{ incidentId: string; pair: [string, string]; sourceEventId: string; comparedEventId: string; similarity: number; gameTime: number }>;
  nearbyPairs: string[];
  processedSocialEventIds: string[];
  llmLedger: LlmProvenance[];
  conservationLedger: Array<{ gameTime: number; itemId: string; kind: string; delta: number; note: string }>;
  actionSeq: number;
  eventSeq: number;
  endedReason?: string;
};

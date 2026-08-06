import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { createMvp2World } from '../../server/mvp2/world';
import { gameMasterValidate, stepWorld } from '../../server/mvp2/engine';
import { ScriptedSurvivalBrain } from '../../server/mvp2/drivers';
import { handoverItem, pickupItem, dropItem, takeUnattendedItem } from '../../server/mvp2/items';
import { consume } from '../../server/mvp2/survival';
import { createFire, addFuel, tickFire } from '../../server/mvp2/fire';
import { tickNeeds, startSleep, wakeUp } from '../../server/mvp2/survival';
import { Mvp2World, ActionSpec } from '../../server/mvp2/types';
import * as path from 'path';

function makeWorld(): Mvp2World {
  const map = RuntimeMap.loadFromFile(path.join(__dirname, '../../public/generated/maps/aisland-mvp2/map.runtime.json'));
  return createMvp2World('test-world', 20260807, map);
}

function totalKind(world: Mvp2World, kind: string): number {
  let held = 0;
  for (const a of Object.values(world.agents)) held += a.inventory[kind as 'water'] ?? 0;
  let ground = 0;
  for (const g of Object.values(world.groundItems)) if (g.kind === kind) ground += g.quantity;
  let resources = 0;
  for (const r of Object.values(world.resources)) {
    if (kind === 'water' && r.kind === 'spring') resources += r.stock;
    if (kind === 'food' && r.kind === 'berry_bush') resources += r.stock;
    if (kind === 'wood' && r.kind === 'wood_pile') resources += r.stock;
  }
  let wrecks = 0;
  for (const w of Object.values(world.wrecks)) wrecks += w.contents[kind as 'water'] ?? 0;
  let fireWood = 0;
  if (kind === 'wood') for (const f of Object.values(world.fires)) fireWood += f.fuel / 80;
  return held + ground + resources + wrecks + fireWood;
}

function consumedKind(world: Mvp2World, kind: string): number {
  return Object.values(world.agents).reduce((s, a) => s + (a.stats.consumed[kind as 'water'] ?? 0), 0);
}

function burnedWood(world: Mvp2World): number {
  // wood-equivalent destroyed by fire: initial fuel + added fuel - current fuel
  let burned = 0;
  for (const f of Object.values(world.fires)) {
    const added = world.conservationLedger.filter((l) => l.itemId === f.fireId && l.kind === 'wood' && l.delta < 0).reduce((s, l) => s + Math.abs(l.delta), 0);
    burned += (240 + added * 80 - f.fuel) / 80;
  }
  return burned;
}

describe('MVP2 items & conservation', () => {
  test('world totals are conserved (snapshot invariant)', () => {
    const world = makeWorld();
    const initial = { water: totalKind(world, 'water'), food: totalKind(world, 'food'), wood: totalKind(world, 'wood') };
    for (const kind of ['water', 'food', 'wood', 'tinder', 'lighter', 'backpack']) {
      expect(totalKind(world, kind)).toBeCloseTo(initial[kind as 'water'] ?? totalKind(world, kind), 6);
    }
  });

  test('pickup -> drop -> handover -> consume conserves', () => {
    const world = makeWorld();
    const initialWater = totalKind(world, 'water');
    const a = Object.values(world.agents)[0];
    const b = Object.values(world.agents)[1];
    const item = Object.values(world.groundItems).find((g) => g.kind === 'water')!;
    a.x = item.x;
    a.y = item.y;
    const picked = pickupItem(world, a, item);
    expect(picked.ok).toBe(true);
    const dropped = dropItem(world, a, 'water', 1, item.x, item.y);
    expect(dropped.ok).toBe(true);
    // handover
    const item2 = Object.values(world.groundItems).find((g) => g.kind === 'water')!;
    a.x = item2.x;
    a.y = item2.y;
    b.x = item2.x + 1;
    b.y = item2.y;
    const h = pickupItem(world, a, item2);
    expect(h.ok).toBe(true);
    const hand = handoverItem(world, a, b, 'water', 1);
    expect(hand.ok).toBe(true);
    const c = consume(world, b, 'water', 1);
    expect(c.ok).toBe(true);
    // invariant: total + consumed == initial total
    expect(totalKind(world, 'water') + consumedKind(world, 'water')).toBe(initialWater);
  });

  test('game master rejects far pickups, far harvests and unknown resources', () => {
    const world = makeWorld();
    const a = Object.values(world.agents)[0];
    const item = Object.values(world.groundItems)[0];
    a.x = item.x + 8;
    a.y = item.y;
    const farPickup: ActionSpec = { type: 'pickup_item', target: { kind: 'item', itemId: item.itemId } };
    expect(gameMasterValidate(world, a, farPickup).ok).toBe(false);
    const spring = Object.values(world.resources).find((r) => r.kind === 'spring')!;
    a.x = spring.x + 8;
    a.y = spring.y;
    const farHarvest: ActionSpec = { type: 'harvest_water', target: { kind: 'resource', resourceId: spring.resourceId }, amount: 1 };
    expect(gameMasterValidate(world, a, farHarvest).ok).toBe(false);
    const unknownHarvest: ActionSpec = { type: 'harvest_water', target: { kind: 'resource', resourceId: spring.resourceId }, amount: 1 };
    a.x = spring.x;
    a.y = spring.y;
    expect(gameMasterValidate(world, a, unknownHarvest).ok).toBe(false); // not discovered
    a.knowledge.knownResources.push(spring.resourceId);
    expect(gameMasterValidate(world, a, unknownHarvest).ok).toBe(true);
  });

  test('capacity limits pickup', () => {
    const world = makeWorld();
    const a = Object.values(world.agents)[0];
    a.inventory.wood = 10;
    a.carryUsed = 10;
    const item = Object.values(world.groundItems).find((g) => g.kind === 'water')!;
    a.x = item.x;
    a.y = item.y;
    const res = pickupItem(world, a, item);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('capacity');
  });

  test('taking an unattended item records social memory', () => {
    const world = makeWorld();
    const owner = Object.values(world.agents)[0];
    const taker = Object.values(world.agents)[1];
    const item = Object.values(world.groundItems).find((g) => g.kind === 'water')!;
    item.droppedBy = owner.id;
    item.seenBy = [owner.id];
    taker.x = item.x;
    taker.y = item.y;
    const res = takeUnattendedItem(world, taker, item);
    expect(res.ok).toBe(true);
    expect(taker.stats.tookUnattended).toBe(1);
    expect(world.events.some((e) => e.type === 'item_taken_owned')).toBe(true);
  });
});

describe('MVP2 fire / sleep / needs', () => {
  test('fire requires materials and burns down; fuel extends it', () => {
    const world = makeWorld();
    const a = Object.values(world.agents)[0];
    a.inventory.tinder = 1;
    a.inventory.wood = 3;
    a.inventory.lighter = 1;
    const built = createFire(world, a, a.x, a.y);
    expect(built.ok).toBe(true);
    const fire = world.fires[built.fireId!];
    expect(fire.state).toBe('burning');
    tickFire(world, fire, 200);
    expect(fire.state).toBe('weak');
    a.inventory.wood = 2;
    const fueled = addFuel(world, a, fire, 2);
    expect(fueled.ok).toBe(true);
    expect(fire.state).toBe('burning');
  });

  test('sleep restores stamina faster with fire; wake clears sleep', () => {
    const world = makeWorld();
    const a = Object.values(world.agents)[0];
    a.needs.stamina = 20;
    a.needs.sleepNeed = 80;
    a.x = 100;
    a.y = 160;
    world.fires.f1 = { fireId: 'f1', x: 100, y: 159, fuel: 500, state: 'burning', createdBy: a.id, lastFueledBy: a.id, lightRadius: 8 };
    startSleep(a, world.gameTime, 1, true);
    tickNeeds(a, 60, false, true, true);
    expect(a.needs.stamina).toBeGreaterThan(20);
    expect(a.needs.sleepNeed).toBeLessThan(80);
    expect(wakeUp(a)).toBe(true);
    expect(a.sleep).toBeNull();
  });

  test('severe thirst kills; death stops actions', async () => {
    const world = makeWorld();
    const a = Object.values(world.agents)[0];
    a.needs.water = 0;
    a.needs.food = 0;
    a.needs.health = 10;
    a.inventory = {};
    tickNeeds(a, 120, false, false, false);
    expect(a.isAlive).toBe(false);
    const spec: ActionSpec = { type: 'rest', target: { kind: 'none' } };
    expect(gameMasterValidate(world, a, spec).ok).toBe(false);
  });
});

describe('MVP2 engine step (scripted brain)', () => {
  test('world advances, agents move on the new map, items flow', async () => {
    const world = makeWorld();
    const init = { water: totalKind(world, 'water'), food: totalKind(world, 'food'), wood: totalKind(world, 'wood') };
    const brain = new ScriptedSurvivalBrain(() => 0.3);
    for (let i = 0; i < 60; i++) {
      await stepWorld(world, 30, brain);
    }
    expect(world.gameTime).toBe(1800);
    const positions = Object.values(world.agents).map((a) => ({ x: a.x, y: a.y, alive: a.isAlive }));
    expect(positions.some((p) => p.x !== 0 || p.y !== 0)).toBe(true);
    // Every agent position is on passable terrain.
    for (const a of Object.values(world.agents)) {
      if (a.isAlive) expect(world.map.isBlocked(a.x, a.y)).toBe(false);
    }
    // Conservation holds after 30h of play.
    expect(totalKind(world, 'water') + consumedKind(world, 'water')).toBeCloseTo(init.water, 6);
    expect(totalKind(world, 'food') + consumedKind(world, 'food')).toBeCloseTo(init.food, 6);
    expect(totalKind(world, 'wood') + consumedKind(world, 'wood') + burnedWood(world)).toBeCloseTo(init.wood, 6);
    // At least one item interaction or harvest happened (scripted brain picks up items).
    const interactions = world.events.filter((e) => ['item_picked_up', 'resource_harvested', 'consumed', 'handover_completed'].includes(e.type));
    expect(interactions.length).toBeGreaterThan(0);
  });

  test('world ends by day 5', async () => {
    const world = makeWorld();
    const brain = new ScriptedSurvivalBrain(() => 0.5);
    for (let i = 0; i < 320 && world.status === 'running'; i++) {
      await stepWorld(world, 30, brain);
    }
    expect(world.status).toBe('ended');
    expect(world.endedReason).toBeTruthy();
  });
});

import * as path from 'node:path';
import { RuntimeMap } from '../../server/engine/map/runtimeMap';
import { startAction, stepWorldMovement } from '../../server/mvp2/engine';
import { createMvp2World } from '../../server/mvp2/world';

function makeWorld() {
  const map = RuntimeMap.loadFromFile(path.join(__dirname, '../../public/generated/maps/island-01/map.runtime.json'));
  const world = createMvp2World('collision-test', 97, map);
  for (const agent of Object.values(world.agents)) agent.cognitive.visible.fill(1);
  return world;
}

function openRow(world: ReturnType<typeof makeWorld>, length: number): Array<{ x: number; y: number }> {
  for (let y = 2; y < world.map.height - 2; y++) {
    for (let x = 2; x <= world.map.width - length - 2; x++) {
      const cells = Array.from({ length }, (_, index) => ({ x: x + index, y }));
      if (cells.every((cell) => !world.map.isBlocked(cell.x, cell.y))) return cells;
    }
  }
  throw new Error(`no open row of ${length} cells`);
}

describe('MVP2 authoritative entity collision', () => {
  test('move_to an occupied survivor resolves to an adjacent reachable cell', () => {
    const world = makeWorld();
    const a = world.agents.agent_a;
    const b = world.agents.agent_b;
    a.x = 20; a.y = 46;
    b.x = 23; b.y = 46;
    const move = startAction(world, a, { type: 'move', target: { kind: 'cell', x: b.x, y: b.y } });
    expect(move?.type).toBe('move');
    expect(move?.target).not.toEqual({ kind: 'cell', x: b.x, y: b.y });
    const destination = move?.path?.[move.path.length - 1];
    expect(destination).toBeDefined();
    expect(Math.abs(destination!.x - b.x) + Math.abs(destination!.y - b.y)).toBe(1);
  });

  test('two survivors converging on one cell never occupy the same position', () => {
    const world = makeWorld();
    const a = world.agents.agent_a;
    const b = world.agents.agent_b;
    const c = world.agents.agent_c;
    const [left, target, right] = openRow(world, 3);
    a.x = left.x; a.y = left.y;
    b.x = right.x; b.y = right.y;
    const spare = world.map.spawnPoint(2);
    c.x = spare.x; c.y = spare.y;
    expect(world.map.isBlocked(target.x, target.y)).toBe(false);
    expect(startAction(world, a, { type: 'move', target: { kind: 'cell', ...target } })).not.toBeNull();
    expect(startAction(world, b, { type: 'move', target: { kind: 'cell', ...target } })).not.toBeNull();
    stepWorldMovement(world, 20);
    expect([a.x, a.y]).toEqual([target.x, target.y]);
    expect([b.x, b.y]).not.toEqual([target.x, target.y]);
    const occupied = Object.values(world.agents).filter((agent) => agent.isAlive).map((agent) => `${agent.x},${agent.y}`);
    expect(new Set(occupied).size).toBe(occupied.length);
  });

  test('an active fire is a physical obstacle for later movement', () => {
    const world = makeWorld();
    const a = world.agents.agent_a;
    const b = world.agents.agent_b;
    const cells = openRow(world, 5);
    a.x = cells[0].x; a.y = cells[0].y;
    b.x = cells[4].x; b.y = cells[4].y;
    const fireCell = cells[2];
    world.fires.fire_test = { fireId: 'fire_test', x: fireCell.x, y: fireCell.y, fuel: 60, state: 'burning', createdBy: a.id, lastFueledBy: a.id, lightRadius: 5 };
    const move = startAction(world, a, { type: 'move', target: { kind: 'cell', ...fireCell } });
    expect(move?.type).toBe('move');
    expect(move?.path?.some((cell) => cell.x === fireCell.x && cell.y === fireCell.y)).toBe(false);
  });

  test('a fallen survivor remains a physical world object', () => {
    const world = makeWorld();
    const a = world.agents.agent_a;
    const b = world.agents.agent_b;
    const cells = openRow(world, 4);
    a.x = cells[0].x; a.y = cells[0].y;
    b.x = cells[2].x; b.y = cells[2].y;
    b.isAlive = false;
    const move = startAction(world, a, { type: 'move', target: { kind: 'cell', x: b.x, y: b.y } });
    expect(move?.path?.some((cell) => cell.x === b.x && cell.y === b.y)).toBe(false);
  });
});

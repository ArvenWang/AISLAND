import type { Mvp2World } from './types';

export function isWorldCellOccupied(world: Mvp2World, x: number, y: number, exceptAgentId?: string): boolean {
  const occupiedByAgent = Object.values(world.agents).some((other) => other.id !== exceptAgentId && other.x === x && other.y === y);
  const occupiedByFire = Object.values(world.fires).some((fire) => fire.state !== 'out' && fire.x === x && fire.y === y);
  return occupiedByAgent || occupiedByFire;
}

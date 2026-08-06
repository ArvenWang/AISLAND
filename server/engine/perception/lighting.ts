// Day/night cycle from game time (1 island day = 1440 minutes).

export type LightPhase = 'dawn' | 'day' | 'dusk' | 'night';

export function lightPhaseAt(gameTime: number): LightPhase {
  const t = gameTime % 1440;
  if (t >= 300 && t < 360) return 'dawn';
  if (t >= 360 && t < 1080) return 'day';
  if (t >= 1080 && t < 1140) return 'dusk';
  return 'night';
}

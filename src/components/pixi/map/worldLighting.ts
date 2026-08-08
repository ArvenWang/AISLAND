export type WorldLighting = {
  phase: 'dawn' | 'day' | 'dusk' | 'night';
  color: string;
  opacity: number;
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/**
 * Screen-space environmental light for the island clock.
 *
 * The server remains authoritative for visibility and survival effects. This
 * curve only makes that state legible to the player. It stays intentionally
 * restrained so silhouettes and interactable state art remain readable.
 */
export function worldLightingAt(gameTime: number): WorldLighting {
  const minute = ((gameTime % 1440) + 1440) % 1440;
  if (minute < 360) {
    return {
      phase: 'dawn',
      color: '#647594',
      opacity: lerp(0.36, 0.03, minute / 360),
    };
  }
  if (minute < 720) {
    return { phase: 'day', color: '#ffffff', opacity: 0 };
  }
  if (minute < 960) {
    return {
      phase: 'dusk',
      color: '#8c655e',
      opacity: lerp(0.02, 0.48, (minute - 720) / 240),
    };
  }
  return {
    phase: 'night',
    color: '#1b2d50',
    opacity: lerp(0.48, 0.62, (minute - 960) / 480),
  };
}

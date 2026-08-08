import { worldLightingAt } from '../../src/components/pixi/map/worldLighting';

describe('Phase 3 world lighting', () => {
  test('tracks the island clock without obscuring daylight', () => {
    expect(worldLightingAt(0)).toEqual({ phase: 'dawn', color: '#647594', opacity: 0.36 });
    expect(worldLightingAt(360)).toEqual({ phase: 'day', color: '#ffffff', opacity: 0 });
    expect(worldLightingAt(720).phase).toBe('dusk');
    expect(worldLightingAt(959).opacity).toBeGreaterThan(0.47);
    expect(worldLightingAt(960)).toEqual({ phase: 'night', color: '#1b2d50', opacity: 0.48 });
    expect(worldLightingAt(1439).opacity).toBeGreaterThan(0.61);
  });

  test('wraps negative and multi-day times onto the same daily curve', () => {
    expect(worldLightingAt(1440)).toEqual(worldLightingAt(0));
    expect(worldLightingAt(-1)).toEqual(worldLightingAt(1439));
  });
});

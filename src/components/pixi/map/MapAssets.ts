// Loads the compiled MVP2 map runtime JSON and atlas textures.

import * as PIXI from 'pixi.js';
import type { RuntimeMapData } from '../../../../server/engine/map/runtimeMap';

const BASE = '/generated/maps/aisland-mvp2';

export type MapAssets = {
  map: RuntimeMapData;
  terrain: PIXI.Texture;
  decals: PIXI.Texture;
  props: PIXI.Texture;
  effects: PIXI.Texture;
  characters: PIXI.Texture;
  propMeta: Record<string, unknown>;
  charMeta: Record<string, unknown>;
};

let cache: Promise<MapAssets> | null = null;

export function loadMapAssets(): Promise<MapAssets> {
  if (cache) return cache;
  cache = (async () => {
    const [map, propMeta, charMeta] = await Promise.all([
      fetch(`${BASE}/map.runtime.json`).then((r) => r.json() as Promise<RuntimeMapData>),
      fetch(`${BASE}/props.meta.json`).then((r) => r.json()),
      fetch(`${BASE}/characters.meta.json`).then((r) => r.json()),
    ]);
    const texture = (url: string) => PIXI.Texture.from(url, { scaleMode: PIXI.SCALE_MODES.NEAREST });
    return {
      map,
      terrain: texture(`${BASE}/${map.atlas.terrain}`),
      decals: texture(`${BASE}/${map.atlas.decals}`),
      props: texture(`${BASE}/${map.atlas.props}`),
      effects: texture(`${BASE}/${map.atlas.effects}`),
      characters: texture(`${BASE}/${map.atlas.characters}`),
      propMeta,
      charMeta,
    };
  })();
  return cache;
}

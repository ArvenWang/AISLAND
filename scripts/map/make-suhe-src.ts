// One-off: generate suhe's (orange) source sheet from ninja_blue via the same
// palette swap used for the character atlas.
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { paletteSwap } from './pixel-art';

const src = path.join(__dirname, '../../assets/source/mvp2/original/pixel-boy-ninja-adventure/ninja_blue.png');
const out = path.join(__dirname, '../../public/generated/char-src/ninja_orange.png');
const png = PNG.sync.read(fs.readFileSync(src));
const buf: { w: number; h: number; data: Uint8ClampedArray } = { w: png.width, h: png.height, data: new Uint8ClampedArray(png.data) };
const swapped = paletteSwap(buf, [
  [[84, 120, 186], [204, 122, 58]],
  [[118, 158, 214], [228, 152, 78]],
  [[52, 78, 122], [152, 84, 40]],
  [[206, 224, 244], [242, 228, 198]],
]);
const outPng = new PNG({ width: swapped.w, height: swapped.h });
outPng.data = Buffer.from(swapped.data);
fs.writeFileSync(out, PNG.sync.write(outPng));
console.log('written', out);

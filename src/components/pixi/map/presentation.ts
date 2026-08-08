export function speechBubbleDurationMs(text: string): number {
  return Math.max(3500, Math.min(7000, (2.8 + [...text].length * 0.065) * 1000));
}

export function speechBubbleOverlapRatio(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const overlap = width * height;
  return overlap / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

export type RGB = [number, number, number];

export function hexToRGB(hex: string): RGB {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const v = Number.parseInt(h, 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

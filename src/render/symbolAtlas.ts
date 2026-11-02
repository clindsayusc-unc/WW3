/** Renders MIL-STD-2525 symbols with milsymbol (MIT) into a canvas atlas, with a count badge (D-038). */
import ms from 'milsymbol';
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';

export const ATLAS_SIZE = 2048;
export const TILE = 128;
const COLS = ATLAS_SIZE / TILE;

export type Affiliation = 'F' | 'H' | 'N' | 'U';

export interface AtlasTile {
  index: number;
  u: number;
  v: number;
}

export class SymbolAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private tiles = new Map<string, AtlasTile>();
  private next = 0;
  private pending = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_SIZE;
    this.canvas.height = ATLAS_SIZE;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.anisotropy = 4;
    this.texture.colorSpace = SRGBColorSpace;
  }

  /** Returns the tile for a symbol + count, drawing it on first use. */
  get(sidc: string, affiliation: Affiliation, count: number, color?: string): AtlasTile {
    const key = `${sidc}|${affiliation}|${Math.min(count, 99)}|${color ?? ''}`;
    const hit = this.tiles.get(key);
    if (hit) return hit;
    const index = this.next++;
    if (index >= COLS * COLS) throw new Error('symbol atlas full');
    const tile = { index, u: (index % COLS) / COLS, v: Math.floor(index / COLS) / COLS };
    this.tiles.set(key, tile);
    this.draw(tile, sidc.slice(0, 1) + affiliation + sidc.slice(2), count, color);
    return tile;
  }

  private draw(tile: AtlasTile, sidc: string, count: number, color?: string): void {
    const symbol = new ms.Symbol(sidc, {
      size: 60,
      strokeWidth: 4,
      outlineWidth: 4,
      outlineColor: 'rgba(0,0,0,0.95)',
      colorMode: 'Dark',
      iconColor: '#ffffff',
      ...(color ? { fillColor: color } : {}),
    });
    const svg = symbol.asSVG();
    const img = new Image();
    const x = (tile.index % COLS) * TILE;
    const y = Math.floor(tile.index / COLS) * TILE;
    this.pending++;
    img.onload = () => {
      const ctx = this.ctx;
      ctx.clearRect(x, y, TILE, TILE);
      const sw = img.width;
      const sh = img.height;
      const scale = Math.min((TILE - 24) / sw, (TILE - 24) / sh);
      const w = sw * scale;
      const h = sh * scale;
      ctx.drawImage(img, x + (TILE - w) / 2, y + (TILE - h) / 2 + 4, w, h);
      if (count > 1) {
        // Count badge, top-right.
        const bx = x + TILE - 26;
        const by = y + 8;
        ctx.beginPath();
        ctx.roundRect(bx - 6, by, 30, 22, 6);
        ctx.fillStyle = 'rgba(8,12,20,0.92)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = '700 15px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.min(count, 99)), bx + 9, by + 11);
      }
      this.pending--;
      this.texture.needsUpdate = true;
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
}

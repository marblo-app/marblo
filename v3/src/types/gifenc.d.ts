// `gifenc` ships no type declarations (plain JS, ESM+CJS). Hand-written
// surface for the bits `lib/replay/export/gif.ts` actually calls — anything
// not declared here is invisible to the compiler.
declare module "gifenc" {
  export type GifencPaletteEntry =
    | [number, number, number]
    | [number, number, number, number];

  export interface GifencQuantizeOptions {
    format?: "rgb565" | "rgb444" | "rgba4444";
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: GifencQuantizeOptions
  ): GifencPaletteEntry[];

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifencPaletteEntry[],
    format?: "rgb565" | "rgb444" | "rgba4444"
  ): Uint8Array;

  export interface GifencWriteFrameOptions {
    transparent?: boolean;
    transparentIndex?: number;
    delay?: number;
    palette?: GifencPaletteEntry[] | null;
    repeat?: number;
    colorDepth?: number;
    dispose?: number;
    first?: boolean;
  }

  export interface GifencEncoder {
    reset(): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    readonly buffer: ArrayBufferLike;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: GifencWriteFrameOptions
    ): void;
  }

  export interface GifencEncoderOptions {
    initialCapacity?: number;
    auto?: boolean;
  }

  export function GIFEncoder(opts?: GifencEncoderOptions): GifencEncoder;
}

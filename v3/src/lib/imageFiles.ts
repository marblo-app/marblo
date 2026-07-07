// Image file detection + MIME lookup for the Code tab preview.
// When an open file is one of these, CodeTab renders <ImagePreview> (a rendered
// image) instead of the Monaco text editor — SVGs and rasters alike show as
// pictures rather than raw XML / mojibake bytes.

const IMAGE_MIME: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
  avif: "image/avif",
};

export function fileExt(p: string): string {
  const dot = p.lastIndexOf(".");
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (dot < 0 || dot < slash) return "";
  return p.slice(dot + 1).toLowerCase();
}

export function isImageFile(p: string): boolean {
  return fileExt(p) in IMAGE_MIME;
}

export function isSvgFile(p: string): boolean {
  return fileExt(p) === "svg";
}

export function imageMime(p: string): string {
  return IMAGE_MIME[fileExt(p)] ?? "application/octet-stream";
}

/** Data URL for an SVG whose text we already have (no disk round-trip). */
export function svgDataUrl(svgText: string): string {
  // base64 keeps the URL robust against any characters in the markup.
  return `data:image/svg+xml;base64,${btoa(
    unescape(encodeURIComponent(svgText)),
  )}`;
}

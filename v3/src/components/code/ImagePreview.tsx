import { useEffect, useState } from "react";
import { imageMime, isSvgFile, svgDataUrl } from "../../lib/imageFiles";
import { CodeEditor } from "./CodeEditor";

interface ImagePreviewProps {
  filePath: string;
  /** Already-read text content — used directly for SVG + the "source" view. */
  content: string;
  language: string;
}

/**
 * Renders an image file (svg/png/jpg/webp/gif/ico/…) as a picture instead of
 * Monaco text. SVGs come straight from the loaded text; rasters are fetched as
 * base64 over IPC (the text content is meaningless bytes for them). SVGs get a
 * Preview ↔ Source toggle so the markup is still one click away.
 */
export function ImagePreview({
  filePath,
  content,
  language,
}: ImagePreviewProps) {
  const svg = isSvgFile(filePath);
  const [view, setView] = useState<"preview" | "source">("preview");
  const [dataUrl, setDataUrl] = useState<string | null>(
    svg ? svgDataUrl(content) : null,
  );
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDims(null);
    if (svg) {
      setError(null);
      setDataUrl(svgDataUrl(content));
      return;
    }
    let alive = true;
    setDataUrl(null);
    setError(null);
    window.electronAPI.fs
      .readFileBase64(filePath)
      .then((b64) => {
        if (alive) setDataUrl(`data:${imageMime(filePath)};base64,${b64}`);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [filePath, content, svg]);

  const toolbar = (
    <div className="flex items-center gap-3 border-b border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-400">
      <span className="truncate">{filePath.split(/[/\\]/).pop()}</span>
      {dims && (
        <span className="text-gray-500">
          {dims.w} × {dims.h}
        </span>
      )}
      <span className="text-gray-600 uppercase">{imageMime(filePath)}</span>
      {svg && (
        <div className="ml-auto flex overflow-hidden rounded border border-gray-700">
          <button
            type="button"
            onClick={() => setView("preview")}
            className={`px-2 py-0.5 ${
              view === "preview"
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-700"
            }`}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => setView("source")}
            className={`px-2 py-0.5 ${
              view === "source"
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-700"
            }`}
          >
            Source
          </button>
        </div>
      )}
    </div>
  );

  if (svg && view === "source") {
    return (
      <div className="flex h-full flex-col">
        {toolbar}
        <div className="min-h-0 flex-1">
          <CodeEditor
            filePath={filePath}
            content={content}
            language={language}
            readOnly
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {toolbar}
      <div
        className="min-h-0 flex-1 overflow-auto"
        style={{
          // Checkerboard so image transparency is visible.
          backgroundColor: "#1e1e1e",
          backgroundImage:
            "linear-gradient(45deg,#2a2a2a 25%,transparent 25%),linear-gradient(-45deg,#2a2a2a 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2a 75%),linear-gradient(-45deg,transparent 75%,#2a2a2a 75%)",
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0,0 10px,10px -10px,-10px 0",
        }}
      >
        <div className="grid min-h-full place-items-center p-6">
          {error ? (
            <div className="text-sm text-red-400">
              이미지를 불러오지 못했습니다: {error}
            </div>
          ) : dataUrl ? (
            <img
              src={dataUrl}
              alt={filePath}
              onLoad={(e) => {
                const img = e.currentTarget;
                setDims({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                imageRendering: "auto",
              }}
            />
          ) : (
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
          )}
        </div>
      </div>
    </div>
  );
}

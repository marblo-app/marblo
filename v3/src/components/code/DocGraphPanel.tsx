import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "../../stores/editorStore";
import { useTranslation } from "../../lib/i18n";
import {
  collectMarkdownPaths,
  joinProjectPath,
  toProjectRelative,
  type DocSource,
} from "../../lib/docGraphAnalysis";
import { DocGraphView } from "./DocGraphView";

/**
 * Code 사이드바 Graph 하위탭 — 프로젝트 루트의 md 를 읽어 문서 관계 그래프를
 * 그린다. 커넥터 문서는 후속; 초기엔 로컬 위키 증명.
 *
 * 읽기는 패널이 보일 때만. 파일 수가 많으면 상한(collectMarkdownPaths)으로
 * 잘리고, 개별 read 실패는 건너뛴다(한 파일 때문에 전체가 비면 안 된다).
 */

const MAX_MD_FILES = 300;
const READ_CONCURRENCY = 8;

export function DocGraphPanel() {
  const { t } = useTranslation();
  const rootPath = useEditorStore((s) => s.rootPath);
  const openFile = useEditorStore((s) => s.openFile);

  const [sources, setSources] = useState<DocSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);
  const genRef = useRef(0);

  const load = useCallback(async () => {
    const root = useEditorStore.getState().rootPath;
    if (!root || !window.electronAPI?.fs) {
      setSources([]);
      setError(null);
      setScanned(0);
      return;
    }

    const gen = ++genRef.current;
    setLoading(true);
    setError(null);

    try {
      const tree = await window.electronAPI.fs.readTree(root);
      if (gen !== genRef.current) return;

      // readTree 는 절대 경로를 준다. 그래프 id·위키링크 해석은 상대 경로 기준.
      const absPaths = collectMarkdownPaths(tree, { maxFiles: MAX_MD_FILES });
      setScanned(absPaths.length);

      const loaded: DocSource[] = [];
      for (let i = 0; i < absPaths.length; i += READ_CONCURRENCY) {
        if (gen !== genRef.current) return;
        const batch = absPaths.slice(i, i + READ_CONCURRENCY);
        const results = await Promise.all(
          batch.map(async (absPath) => {
            try {
              const content = await window.electronAPI.fs.readFile(
                root,
                absPath,
              );
              return {
                path: toProjectRelative(root, absPath),
                content,
              } satisfies DocSource;
            } catch {
              return null;
            }
          }),
        );
        for (const r of results) {
          if (r) loaded.push(r);
        }
      }

      if (gen !== genRef.current) return;
      setSources(loaded);
    } catch (err) {
      if (gen !== genRef.current) return;
      setSources([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      genRef.current += 1;
    };
  }, [rootPath, load]);

  const handleOpen = useCallback(
    (relPath: string) => {
      const root = useEditorStore.getState().rootPath;
      if (!root) return;
      // FileTree 와 같이 절대 경로로 열어 탭 키·활성 파일이 일치하게 한다.
      void openFile(joinProjectPath(root, relPath));
    },
    [openFile],
  );

  if (!rootPath) {
    return (
      <div
        className="flex h-full items-center justify-center px-3 text-center text-xs text-gray-500"
        data-testid="doc-graph-no-root"
      >
        {t("code.docGraph.noRoot")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="doc-graph-panel">
      <div className="flex flex-shrink-0 items-center gap-1 border-b border-gray-700/60 px-2 py-1">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-gray-700 hover:text-gray-200 disabled:opacity-50"
          title={t("code.docGraph.refresh")}
        >
          {loading ? t("code.docGraph.loading") : t("code.docGraph.refresh")}
        </button>
        {!loading && scanned > 0 && (
          <span className="text-[10px] text-gray-600">
            {t("code.docGraph.scanned", { count: scanned })}
          </span>
        )}
      </div>

      {error ? (
        <div className="px-3 py-4 text-xs text-red-400">{error}</div>
      ) : loading && sources.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-gray-500">
          {t("code.docGraph.loading")}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <DocGraphView sources={sources} onOpenDoc={handleOpen} />
        </div>
      )}
    </div>
  );
}

export default DocGraphPanel;

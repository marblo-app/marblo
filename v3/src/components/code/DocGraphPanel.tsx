import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "../../stores/editorStore";
import { useTranslation } from "../../lib/i18n";
import {
  buildDocGraph,
  collectFolderPrefixesFromPaths,
  collectMarkdownPaths,
  collectTopLevelFolders,
  filterDocSources,
  joinProjectPath,
  toProjectRelative,
  type DocGraphExternalLinks,
  type DocSource,
} from "../../lib/docGraphAnalysis";
import {
  ConnectorGuidePanel,
  ConnectorGuideStep,
  ConnectorGuideSteps,
} from "../harness/ConnectorGuidePanel";
import { DocGraphView } from "./DocGraphView";

/**
 * Code 탭의 파일 그래프 서브탭 — 프로젝트 루트의 md 를 읽어 문서 관계 그래프를
 * 그린다. 커넥터 문서는 후속; 초기엔 로컬 위키 증명.
 *
 * 읽기는 패널이 보일 때만. 파일 수가 많으면 상한(collectMarkdownPaths)으로
 * 잘리고, 개별 read 실패는 건너뛴다(한 파일 때문에 전체가 비면 안 된다).
 *
 * 폴더 스코프: 드롭다운으로 루트 직속 폴더(docs·강의 등)를 고르면 그 prefix
 * 아래 md 만 노드·엣지·백링크·orphan 판정. 기본=전체. 스코프 밖 링크는
 * 제외(기본) 또는 경계 노드로 표시.
 */

const MAX_MD_FILES = 300;
const READ_CONCURRENCY = 8;
const GUIDE_STORAGE_KEY = "marblo.docGraph.guide.open";
const SCOPE_STORAGE_KEY = "marblo.docGraph.folderScope";
const EXTERNAL_STORAGE_KEY = "marblo.docGraph.externalLinks";

/** 전체 루트 스코프 센티널 — select value. */
const SCOPE_ALL = "";

interface DocGraphPanelProps {
  onDocumentOpened?: () => void;
}

function readStoredScope(): string {
  try {
    return window.localStorage.getItem(SCOPE_STORAGE_KEY) ?? SCOPE_ALL;
  } catch {
    return SCOPE_ALL;
  }
}

function readStoredExternal(): DocGraphExternalLinks {
  try {
    const v = window.localStorage.getItem(EXTERNAL_STORAGE_KEY);
    return v === "boundary" ? "boundary" : "exclude";
  } catch {
    return "exclude";
  }
}

export function DocGraphPanel({ onDocumentOpened }: DocGraphPanelProps = {}) {
  const { t } = useTranslation();
  const rootPath = useEditorStore((s) => s.rootPath);
  const openFile = useEditorStore((s) => s.openFile);

  const [sources, setSources] = useState<DocSource[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [folderPrefix, setFolderPrefix] = useState<string>(readStoredScope);
  const [externalLinks, setExternalLinks] =
    useState<DocGraphExternalLinks>(readStoredExternal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(0);
  const genRef = useRef(0);

  const load = useCallback(async () => {
    const root = useEditorStore.getState().rootPath;
    if (!root || !window.electronAPI?.fs) {
      setSources([]);
      setFolders([]);
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

      const fromTree = collectTopLevelFolders(tree, root);

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

      const fromPaths = collectFolderPrefixesFromPaths(
        loaded.map((s) => s.path),
      );
      const merged = Array.from(new Set([...fromTree, ...fromPaths])).sort(
        (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }),
      );
      setFolders(merged);
      setSources(loaded);

      // 저장된 스코프가 더 이상 없으면 전체로 되돌린다.
      setFolderPrefix((prev) => {
        if (!prev) return SCOPE_ALL;
        if (merged.includes(prev)) return prev;
        try {
          window.localStorage.setItem(SCOPE_STORAGE_KEY, SCOPE_ALL);
        } catch {
          /* ignore */
        }
        return SCOPE_ALL;
      });
    } catch (err) {
      if (gen !== genRef.current) return;
      setSources([]);
      setFolders([]);
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

  const handleScopeChange = useCallback(
    (next: string) => {
      setFolderPrefix(next);
      try {
        window.localStorage.setItem(SCOPE_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const handleExternalChange = useCallback((next: DocGraphExternalLinks) => {
    setExternalLinks(next);
    try {
      window.localStorage.setItem(EXTERNAL_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const handleOpen = useCallback(
    (relPath: string) => {
      const root = useEditorStore.getState().rootPath;
      if (!root) return;
      // FileTree 와 같이 절대 경로로 열어 탭 키·활성 파일이 일치하게 한다.
      void openFile(joinProjectPath(root, relPath)).then(() => {
        onDocumentOpened?.();
      });
    },
    [openFile, onDocumentOpened],
  );

  const scopeOptions = useMemo(
    () => ({
      folderPrefix: folderPrefix || undefined,
      externalLinks: folderPrefix ? externalLinks : ("exclude" as const),
    }),
    [folderPrefix, externalLinks],
  );

  const scopedSources = useMemo(
    () => filterDocSources(sources, scopeOptions),
    [sources, scopeOptions],
  );

  const edgeCount = useMemo(
    () =>
      scopedSources.length === 0
        ? 0
        : buildDocGraph(scopedSources, scopeOptions).edges.length,
    [scopedSources, scopeOptions],
  );
  const showNoLinksHint =
    !loading && scopedSources.length > 0 && edgeCount === 0;

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
      <div className="flex-shrink-0 px-2 pt-1">
        <ConnectorGuidePanel
          toggleLabel={t("code.docGraph.guide.toggle")}
          storageKey={GUIDE_STORAGE_KEY}
          className="mt-0 rounded border border-[#313244] bg-[#1e1e2e]"
        >
          <ConnectorGuideSteps>
            <ConnectorGuideStep>
              1. {t("code.docGraph.guide.step1")}
            </ConnectorGuideStep>
            <ConnectorGuideStep>
              2. {t("code.docGraph.guide.step2")}
            </ConnectorGuideStep>
            <ConnectorGuideStep>
              3. {t("code.docGraph.guide.step3")}
            </ConnectorGuideStep>
            <ConnectorGuideStep>
              4. {t("code.docGraph.guide.step4")}
            </ConnectorGuideStep>
          </ConnectorGuideSteps>
          <p
            className="rounded border border-[#313244] bg-[#181825] px-3 py-2 text-[#a6adc8]"
            data-testid="doc-graph-guide-diff"
          >
            {t("code.docGraph.guide.diff")}
          </p>
        </ConnectorGuidePanel>
      </div>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-gray-700/60 px-2 py-1">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-gray-700 hover:text-gray-200 disabled:opacity-50"
          title={t("code.docGraph.refresh")}
        >
          {loading ? t("code.docGraph.loading") : t("code.docGraph.refresh")}
        </button>

        <label
          className="ml-1 flex items-center gap-1 text-[10px] text-gray-500"
          data-testid="doc-graph-scope"
        >
          <span className="whitespace-nowrap">{t("code.docGraph.scope.label")}</span>
          <select
            value={folderPrefix}
            onChange={(e) => handleScopeChange(e.target.value)}
            className="max-w-[140px] rounded border border-gray-700 bg-gray-900 px-1 py-0.5 text-[10px] text-gray-300"
            aria-label={t("code.docGraph.scope.label")}
            data-testid="doc-graph-scope-select"
          >
            <option value={SCOPE_ALL}>{t("code.docGraph.scope.all")}</option>
            {folders.map((folder) => (
              <option key={folder} value={folder}>
                {folder}/
              </option>
            ))}
          </select>
        </label>

        {folderPrefix ? (
          <label
            className="flex items-center gap-1 text-[10px] text-gray-500"
            data-testid="doc-graph-external"
          >
            <span className="whitespace-nowrap">
              {t("code.docGraph.external.label")}
            </span>
            <select
              value={externalLinks}
              onChange={(e) =>
                handleExternalChange(e.target.value as DocGraphExternalLinks)
              }
              className="max-w-[120px] rounded border border-gray-700 bg-gray-900 px-1 py-0.5 text-[10px] text-gray-300"
              aria-label={t("code.docGraph.external.label")}
              data-testid="doc-graph-external-select"
            >
              <option value="exclude">
                {t("code.docGraph.external.exclude")}
              </option>
              <option value="boundary">
                {t("code.docGraph.external.boundary")}
              </option>
            </select>
          </label>
        ) : null}

        {!loading && scanned > 0 && (
          <span className="text-[10px] text-gray-600">
            {t("code.docGraph.scanned", { count: scanned })}
            {folderPrefix
              ? ` · ${t("code.docGraph.scope.filtered", { count: scopedSources.length })}`
              : ""}
          </span>
        )}
      </div>

      {showNoLinksHint && (
        <div
          className="flex-shrink-0 border-b border-amber-900/40 bg-amber-950/30 px-3 py-1.5 text-[11px] text-amber-200/90"
          data-testid="doc-graph-no-links-hint"
        >
          {t("code.docGraph.noLinksHint")}
        </div>
      )}

      {error ? (
        <div className="px-3 py-4 text-xs text-red-400">{error}</div>
      ) : loading && sources.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-gray-500">
          {t("code.docGraph.loading")}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <DocGraphView sources={scopedSources} onOpenDoc={handleOpen} />
        </div>
      )}
    </div>
  );
}

export default DocGraphPanel;

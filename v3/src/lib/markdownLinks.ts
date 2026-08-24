/**
 * 마크다운 링크 href → 무엇을 할지 — **순수 함수**, DOM/스토어/IPC 무관.
 *
 * 왜 필요한가(티켓 9XXzjqJzWVmTc6ASnETU): MarkdownPreview 의 `a` 렌더러가 모든
 * 링크에 target="_blank" 를 붙였다. 상대경로·앵커는 앱 origin(localhost)으로
 * 해석되므로 main 의 setWindowOpenHandler 가 "내부 내비게이션" 으로 보고
 * action:"allow" 를 준다 → 라우트 없는 **빈 BrowserWindow**. 렌더러에서 미리
 * 갈래를 정해 내부 링크는 기본동작을 취소하는 것이 이 모듈의 존재 이유다.
 *
 * 갈래는 넷뿐이다:
 *  - anchor   : 같은 문서 안 스크롤
 *  - external : http(s) — 종전대로 target="_blank" → main 이 OS 브라우저로
 *  - file     : 저장소 안 경로 — editorStore.openFile 로 앱 안에서
 *  - ignore   : 그 외 — 아무것도 안 한다(★빈 창 금지)
 *
 * 경로 해석은 docGraphAnalysis 의 정규화·조인을 재사용한다. 다만 저장소 밖
 * 탈출은 **조용히 잘라내지 않고 거절**한다 — `../../../etc/passwd` 가
 * `<root>/etc/passwd` 로 클램프돼 엉뚱한 파일을 여는 일이 없어야 한다.
 */

import {
  joinProjectPath,
  normalizeDocPath,
  toProjectRelative,
} from "./docGraphAnalysis";

export type MarkdownLinkIgnoreReason =
  /** href 가 비었거나 경로 성분이 없다. */
  | "empty"
  /** mailto:, file:, data:, javascript: … — 여는 주체가 우리가 아니다. */
  | "unsupported-scheme"
  /** 현재 문서 경로/프로젝트 루트를 모른다(예: 노트북 셀 안 마크다운). */
  | "no-context"
  /** `..` 가 프로젝트 루트를 벗어난다. */
  | "outside-root";

export type MarkdownLinkTarget =
  | { kind: "anchor"; anchor: string }
  | { kind: "external"; url: string }
  | { kind: "file"; path: string }
  | { kind: "ignore"; reason: MarkdownLinkIgnoreReason };

export interface MarkdownLinkContext {
  /** 프로젝트 루트 절대 경로. 없으면 저장소 안 경로를 해석할 수 없다. */
  rootPath: string | null;
  /** 링크가 들어 있는 문서의 절대 경로(상대경로 해석 기준). */
  filePath: string | null;
}

/** `mailto:`, `https:`, `C:` … 스킴(또는 윈도 드라이브)으로 시작하는가. */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function ignore(reason: MarkdownLinkIgnoreReason): MarkdownLinkTarget {
  return { kind: "ignore", reason };
}

function decodeLoose(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * `dir` 기준으로 `target` 을 합쳐 프로젝트 상대 경로를 만든다.
 * `..` 가 루트 위로 올라가면 **null** — 클램프하지 않고 거절한다.
 */
export function resolveInsideRoot(dir: string, target: string): string | null {
  const stack = dir ? dir.split("/").filter((p) => p && p !== ".") : [];
  for (const part of target.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return null; // 루트 탈출
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}

function dirnameOf(relPath: string): string {
  const i = relPath.lastIndexOf("/");
  return i <= 0 ? "" : relPath.slice(0, i);
}

/**
 * 마크다운 href 를 실행 가능한 갈래로 분류한다.
 *
 * 판정 순서가 곧 규칙이다: 앵커 → 스킴 → 저장소 경로.
 */
export function resolveMarkdownLinkTarget(
  href: string | null | undefined,
  ctx: MarkdownLinkContext,
): MarkdownLinkTarget {
  const raw = (href ?? "").trim();
  if (!raw) return ignore("empty");

  // 1) 순수 앵커 — 같은 문서 안 스크롤.
  if (raw.startsWith("#")) {
    const anchor = decodeLoose(raw.slice(1)).trim();
    return anchor ? { kind: "anchor", anchor } : ignore("empty");
  }

  // 2) 프로토콜 상대(`//host/path`) — 브라우저가 http(s) 로 보는 외부 링크다.
  //    종전 동작(OS 브라우저)을 유지하기 위해 external 로 분류한다.
  if (raw.startsWith("//")) return { kind: "external", url: `https:${raw}` };

  // 3) 스킴이 있으면 http(s) 만 외부로 넘기고 나머지는 손대지 않는다.
  //    (윈도 드라이브 `C:\...` 도 여기서 걸러진다 — 저장소 경로가 아니다.)
  if (SCHEME_RE.test(raw)) {
    return /^https?:/i.test(raw)
      ? { kind: "external", url: raw }
      : ignore("unsupported-scheme");
  }

  // 4) 저장소 안 경로. 쿼리·프래그먼트는 파일 경로가 아니므로 떼어낸다.
  const bare = raw.split("#")[0]?.split("?")[0] ?? "";
  const target = normalizeDocPath(decodeLoose(bare));
  if (!target || target === "/") return ignore("empty");

  const { rootPath, filePath } = ctx;
  if (!rootPath || !filePath) return ignore("no-context");

  let rel: string | null;
  if (target.startsWith("/")) {
    // 루트 상대(`/docs/foo.md`) — docGraphAnalysis 의 해석과 같은 규칙.
    rel = resolveInsideRoot("", target.slice(1));
  } else {
    const fromRel = toProjectRelative(rootPath, filePath);
    // 현재 문서가 루트 밖이면 기준점이 없다 — 열지 않는다.
    if (!fromRel || fromRel.startsWith("/") || /^[a-z]:/i.test(fromRel)) {
      return ignore("outside-root");
    }
    rel = resolveInsideRoot(dirnameOf(fromRel), target);
  }

  if (rel === null) return ignore("outside-root");
  if (!rel) return ignore("empty"); // 루트 디렉터리 자체는 열 파일이 아니다

  return { kind: "file", path: joinProjectPath(rootPath, rel) };
}

/**
 * 헤딩 텍스트 → 앵커 id. GitHub 규칙의 실용적 부분집합:
 * 소문자화 → 문장부호 제거 → 공백을 `-` 로. 한글·숫자는 유니코드 letter/number 로 남는다.
 */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

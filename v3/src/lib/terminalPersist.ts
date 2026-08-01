/**
 * 프로젝트별 사용자 spawn 터미널 메타데이터 영속화.
 *
 * 왜: 셸 PTY 는 claude/codex 처럼 resume 메커니즘이 없어 PTY 자체는 매번
 * 새로 띄울 수밖에 없음. 하지만 "어떤 터미널 탭이 있었다" 는 정보(이름·
 * cwd·shell 옵션)는 localStorage 에 박아두고 앱 재시작 시 같은 모양으로
 * 재spawn 하면 사용자 입장에선 "터미널이 살아있는" 것처럼 보임 (히스토리
 * 없음은 이 모델의 한계 — 셸 자체가 stateless 라 어쩔 수 없음).
 *
 * Scope: 프로젝트 단위. 다른 프로젝트로 전환하면 그 프로젝트의 터미널
 * 셋만 보이도록 키에 projectId 포함. detachAllSessions (프로젝트 전환
 * 시 호출됨) 와 시맨틱 정합.
 *
 * Name-based dedup: 같은 이름이 두 번 push 되지 않도록 add() 가 자체
 * dedup. 이름 충돌 시 첫 entry 만 유지 (사용자 시점에서 자연스러움).
 *
 * ★cwd 는 "핀"이지 스냅샷이 아니다 (티켓 D8yiihCWgDMd3AU7xkEy).
 * v1 은 생성 시점의 rootPath 를 그대로 cwd 로 박아 저장했다. name dedup 때문에
 * 그 최초 값이 영구히 이기므로, 워크트리를 한 번 보고("이 워크트리 보기")
 * 터미널을 연 사용자는 이후 **모든** 재시작에서 그 워크트리 cwd 로 터미널이
 * 떴다 — 현재 rootPath 가 순수 로컬 폴더여도. 게다가 그 워크트리가 reap 되면
 * 죽은 cwd 로 pty:create → ENOENT → notifyRootPathMissing → 살아있는 창의
 * rootPath 까지 다른 폴더로 갈아치웠다.
 *
 * v2 규칙: 호출자가 **명시적으로 준** cwd 만 핀으로 저장한다. 주변값(ambient
 * rootPath)은 저장하지 않고, 복구 시점의 현재 rootPath 를 따른다. 레거시 v1
 * 저장분은 읽을 때 cwd 만 벗겨서 v2 로 옮긴다 (탭 목록 자체는 그대로 유지).
 */

const KEY_PREFIX_V1 = "marblo:v3:terminals:";
const KEY_PREFIX = "marblo:v3:terminals:v2:";

export interface PersistedTerminal {
  name: string;
  cwd?: string;
  command?: string;
  args?: string[];
}

function key(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`;
}

function legacyKey(projectId: string): string {
  return `${KEY_PREFIX_V1}${projectId}`;
}

function safeJSONParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return v as T;
  } catch {
    return fallback;
  }
}

export function readPersistedTerminals(projectId: string): PersistedTerminal[] {
  if (typeof window === "undefined" || !projectId) return [];
  const raw = window.localStorage.getItem(key(projectId));
  if (raw !== null) {
    const arr = safeJSONParse<PersistedTerminal[]>(raw, []);
    return Array.isArray(arr) ? arr : [];
  }
  return migrateLegacy(projectId);
}

/**
 * v1 → v2 일회성 이관. 탭(name/command/args)은 살리고 **cwd 핀만 벗긴다** —
 * v1 의 cwd 는 사용자가 고른 값이 아니라 생성 시점 rootPath 가 흘러든 것이라
 * 신뢰할 수 없다(위 파일 주석 참조). v2 키를 항상 쓰므로(빈 배열이어도)
 * 다음 읽기부터는 v1 을 쳐다보지 않는다 — 좀비 부활 방지.
 */
function migrateLegacy(projectId: string): PersistedTerminal[] {
  const legacy = safeJSONParse<PersistedTerminal[]>(
    window.localStorage.getItem(legacyKey(projectId)),
    [],
  );
  const migrated = (Array.isArray(legacy) ? legacy : [])
    .filter((t): t is PersistedTerminal => !!t && typeof t.name === "string")
    .map(({ name, command, args }) => ({
      name,
      ...(command ? { command } : {}),
      ...(args ? { args } : {}),
    }));
  writePersistedTerminals(projectId, migrated);
  return migrated;
}

/**
 * 복구 시점에 영속 cwd 핀을 신뢰해도 되는지 판정한다.
 *
 * undefined 를 돌려주면 호출자(createSession)가 **현재** rootPath 로 스폰한다 —
 * 이게 "터미널이 지금 열려 있는 폴더에서 뜬다"의 근거다. 죽은 경로를 그대로
 * 넘기면 pty:create 가 ENOENT 로 던지고, 메인의 notifyRootPathMissing 이
 * 살아있는 창의 rootPath 까지 다른 폴더로 갈아치운다 — 그 캐스케이드를 여기서
 * 끊는다. 존재 확인이 실패하면(IPC 문제 등) 핀을 버리는 쪽이 안전하다.
 */
export async function resolveRestoreCwd(
  persistedCwd: string | undefined,
  pathExists: (p: string) => Promise<boolean>,
): Promise<string | undefined> {
  if (!persistedCwd) return undefined;
  try {
    return (await pathExists(persistedCwd)) ? persistedCwd : undefined;
  } catch {
    return undefined;
  }
}

function writePersistedTerminals(
  projectId: string,
  list: PersistedTerminal[],
): void {
  if (typeof window === "undefined" || !projectId) return;
  try {
    window.localStorage.setItem(key(projectId), JSON.stringify(list));
  } catch {
    /* quota / disabled — ignore */
  }
}

/** name 기준 dedup add. 같은 name 이 이미 있으면 그대로 둠. */
export function addPersistedTerminal(
  projectId: string,
  terminal: PersistedTerminal,
): void {
  if (!projectId || !terminal.name) return;
  const list = readPersistedTerminals(projectId);
  if (list.some((t) => t.name === terminal.name)) return;
  list.push(terminal);
  writePersistedTerminals(projectId, list);
}

/** name 기준 remove. 못 찾으면 no-op. */
export function removePersistedTerminal(projectId: string, name: string): void {
  if (!projectId || !name) return;
  const list = readPersistedTerminals(projectId);
  const next = list.filter((t) => t.name !== name);
  if (next.length === list.length) return;
  writePersistedTerminals(projectId, next);
}

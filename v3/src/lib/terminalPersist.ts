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
 */

const KEY_PREFIX = "marblo:v3:terminals:";

export interface PersistedTerminal {
  name: string;
  cwd?: string;
  command?: string;
  args?: string[];
}

function key(projectId: string): string {
  return `${KEY_PREFIX}${projectId}`;
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
  const arr = safeJSONParse<PersistedTerminal[]>(
    window.localStorage.getItem(key(projectId)),
    []
  );
  return Array.isArray(arr) ? arr : [];
}

function writePersistedTerminals(
  projectId: string,
  list: PersistedTerminal[]
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
  terminal: PersistedTerminal
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

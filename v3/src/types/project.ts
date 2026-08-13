import type { ModelType } from "./agent";
import type {
  ProjectFolderPaths,
  ProjectPathResolution,
} from "../lib/projectPaths";

/**
 * 프로젝트 용도.
 * - `dev` — 개발 워크스페이스(보드 우선). 기본값·하위호환.
 * - `assistant` — 비서 워크스페이스(대화·위키/문서그래프·커넥터 우선).
 *
 * 문서는 optional 로 두어 구버전 클라이언트·기존 Firestore 문서가 kind 없이
 * 와도 깨지지 않게 한다. 읽을 때는 항상 `normalizeProjectKind` 로 정규화.
 */
export type ProjectKind = "dev" | "assistant";

export interface Project {
  id: string;
  name: string;
  ownerId: string;
  members: string[];
  /**
   * 프로젝트 종류. 없으면 `dev`(하위호환). 생성 UI 에서 고른다.
   * 해석·기본 서피스 분기는 `lib/projectKind` 단일 초크포인트.
   */
  kind?: ProjectKind;
  /**
   * ★이 기기에서 쓸 수 있는 경로, 없으면 undefined.
   *
   * Firestore 문서의 원본 필드와 이름은 같지만 **의미가 다르다**: 스토어가
   * 문서를 Project 로 변환할 때 `folderPaths` 를 이 기기 기준으로 해석해
   * 이 칸을 채운다(projectPaths.resolveProjectFolderPath). 다른 기기의 경로만
   * 있으면 여기는 undefined 다 — 남의 경로가 절대 새어나오지 않게 하는
   * 지점이다(티켓 sHyHC9RoutYHDt97UOEm).
   *
   * 문서의 원본 단일 필드는 레거시(최초 등록 기기의 경로)로 보존되며
   * `folderPaths` 가 비어 있을 때만 마이그레이션 후보로 쓰인다.
   */
  folderPath?: string;
  /**
   * 문서의 원본 단일 `folderPath` 값(최초 등록 기기의 경로). 파생값인
   * `folderPath` 와 달리 절대 덮어쓰이지 않으므로, machineId 가 뒤늦게
   * 도착해 다시 해석할 때도 원본이 남아 있어 재해석이 멱등해진다.
   */
  legacyFolderPath?: string;
  /** 기기별 경로 칸(machineKey → 경로). 문서의 원본 맵 그대로. */
  folderPaths?: ProjectFolderPaths;
  /**
   * `folderPath` 가 왜 그 값인지(own / unregistered / foreign-only).
   * 레거시 자가치유와 "이 기기에 미등록" 안내가 이 값을 본다.
   */
  folderPathResolution?: ProjectPathResolution;
  gitRemoteUrl?: string;
  enabledModels?: ModelType[]; // Active models for dispatch (default: ['claude'])
  createdAt: Date;
  updatedAt: Date;
}

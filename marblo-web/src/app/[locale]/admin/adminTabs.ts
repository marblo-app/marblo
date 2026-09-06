/**
 * 어드민 탭 정의 — 순서와 기본 탭.
 *
 * ★기본 탭이 곧 "프로젝터에 띄웠을 때 청중이 보는 화면"이다.
 * 대기자·파운더 현황·인터뷰 후보는 **제3자(가입자)의 이메일을 평문으로**
 * 렌더한다. 그 사람들은 공개 발표 자리에 자기 주소가 뜨는 데 동의한 적이
 * 없다. 그래서 기본 탭은 개인정보를 렌더하지 않는 화면(사업 분석)이어야
 * 하고, 개인정보를 렌더하는 탭은 배열 앞자리를 차지하면 안 된다.
 *
 * 이 파일이 page.tsx 에서 떨어져 나온 이유는 위 규약을 테스트로 고정하기
 * 위해서다(adminTabs.test.ts). page.tsx 는 firebase 를 import 하므로
 * node:test 에서 직접 읽을 수 없다.
 */
import { Users, Award, Video, Bug, BarChart3, FolderGit2 } from "lucide-react";

export type AdminTab =
  | "waitlist"
  | "founders"
  | "candidates"
  | "bugs"
  | "analytics"
  | "projects";

export interface AdminTabDef {
  id: AdminTab;
  label: string;
  icon: typeof Users;
}

/**
 * 가입자 이메일을 평문으로 렌더하는 탭들.
 * page.tsx:1014·1166·1330 의 {entry.email} / {f.email} / {t.email} 근거.
 */
export const PII_ADMIN_TABS: readonly AdminTab[] = [
  "waitlist",
  "founders",
  "candidates",
];

/** 개인정보를 렌더하지 않는, 발표에 띄워도 되는 탭들. */
export const SAFE_ADMIN_TABS: readonly AdminTab[] = [
  "analytics",
  "projects",
  "bugs",
];

/**
 * ★첫 화면. 개인정보가 없는 탭이어야 한다 — adminTabs.test.ts 가 고정한다.
 */
export const DEFAULT_ADMIN_TAB: AdminTab = "analytics";

export const ADMIN_TABS: readonly AdminTabDef[] = [
  { id: "analytics", label: "사업 분석", icon: BarChart3 },
  { id: "projects", label: "프로젝트 감사", icon: FolderGit2 },
  { id: "waitlist", label: "대기자", icon: Users },
  { id: "founders", label: "파운더 현황", icon: Award },
  { id: "candidates", label: "인터뷰 후보", icon: Video },
  { id: "bugs", label: "버그 신고", icon: Bug },
];

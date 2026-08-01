/**
 * 발행/해제 패널 (Phase 4-1).
 *
 * 설계: `docs/MISSION-REPLAY-DESIGN.md` §7.1(발행=문서 생성, 해제=삭제) ·
 * §5.3(L3 는 미션 단위로 매번 재선택) · §5.7 F6 / §8 R7(캐시 잔존).
 *
 * ★이 화면의 문구가 곧 기능이다. "공개는 되돌릴 수 없다"를 기본 전제로 쓴다 —
 * 해제 버튼이 있다는 사실 자체가 "취소할 수 있다"는 잘못된 기대를 만들기 때문에,
 * **발행 전과 해제 전 양쪽에서** 캐시·인덱스·스크린샷 사본이 남는다는 것을
 * 명시한다(§7.1). 경고를 해제 다이얼로그에만 두면 이미 늦다.
 *
 * ★L3 는 상태로 기억하지 않는다. 발행이 끝나거나 등급이 바뀌면 확인 플래그를
 * 즉시 버려서, 다음 발행 때 반드시 다시 확인하게 만든다(§5.3 "프로젝트 기본값
 * 으로 저장 불가").
 *
 * ★검증(`redacted.verified`)이 false 면 발행 버튼은 열리지 않는다 — 2차 검증
 * 실패는 "가리고 올린다"가 아니라 중단이다(§5.2 P4). 서비스도 같은 판정을
 * 다시 하지만(fail-closed 이중 게이트), 화면에서 이유를 읽을 수 있어야 한다.
 */
import { useState } from "react";
import type {
  RedactedReplay,
  ReplayVisibilityLevel,
} from "../../../types/missionReplay";
import type { PublicReplayRef } from "../../../services/publicReplayService";

/** 발행 전·해제 전 양쪽에 같은 문장을 쓴다 — 사용자가 두 번 읽어야 한다. */
export const REPLAY_CACHE_RESIDUAL_WARNING =
  "해제해도 CDN·소셜 카드 캐시·검색 인덱스·다른 사람이 찍은 스크린샷에 남은 사본은 되돌릴 수 없습니다.";

export interface PublishGateInput {
  verified: boolean;
  canPublish: boolean;
  isCompletedMission: boolean;
  level: ReplayVisibilityLevel;
  /** 이번 발행에 한정된 L3 확인. 저장되지 않는다(§5.3). */
  l3Acknowledged: boolean;
}

export interface PublishGateState {
  /** 확인 다이얼로그를 열 수 있는가. */
  canOpen: boolean;
  /** 실제로 발행을 실행할 수 있는가(L3 재확인까지 통과). */
  canConfirm: boolean;
  /** 막힌 이유. 화면이 이유를 말할 수 있어야 사용자가 고칠 수 있다. */
  reason: string | null;
}

/**
 * 발행 게이트 — 순수 함수. 컴포넌트가 이걸 쓰고 테스트도 이걸 핀한다.
 *
 * 순서가 곧 우선순위다: 검증 실패(보안) → 권한(거버넌스) → 미션 상태(정책) →
 * L3 재확인(등급). 앞의 것을 뒤의 것으로 덮을 수 없다.
 */
export function publishGateState(input: PublishGateInput): PublishGateState {
  if (!input.verified) {
    return {
      canOpen: false,
      canConfirm: false,
      reason:
        "독립 2차 검증에 실패했습니다. 룰셋에 구멍이 있다는 신호라 발행이 중단됩니다.",
    };
  }
  if (!input.canPublish) {
    return {
      canOpen: false,
      canConfirm: false,
      reason: "발행 권한은 프로젝트 소유자·관리자에게 있습니다.",
    };
  }
  if (!input.isCompletedMission) {
    return {
      canOpen: false,
      canConfirm: false,
      reason: "완료된 미션만 공개 후보입니다.",
    };
  }
  // ★L3 는 확인이 없으면 다이얼로그까지만 열린다 — 확인 체크는 매 발행마다
  //   새로 받아야 하고(§5.3), 그래서 canOpen 과 canConfirm 을 갈라 둔다.
  if (input.level === "L3" && !input.l3Acknowledged) {
    return {
      canOpen: true,
      canConfirm: false,
      reason: null,
    };
  }
  return { canOpen: true, canConfirm: true, reason: null };
}

export interface ReplayPublishPanelProps {
  redacted: RedactedReplay;
  /** owner/admin 만 발행할 수 있다(Q4). 룰이 최종 게이트, 이건 1차 필터다. */
  canPublish: boolean;
  /** 현재 발행 상태. 없으면 미발행. */
  publication?: PublicReplayRef | null;
  /** 미션이 완료 상태가 아니면 기본 후보가 아니다(Q1). */
  isCompletedMission?: boolean;
  onPublish?: () => void | Promise<void>;
  onUnpublish?: () => void | Promise<void>;
  /** 진행 중 표시(중복 클릭 방지는 호출부와 함께 건다). */
  busy?: boolean;
  /** 발행/해제 실패 사유. payload 원문은 절대 담기지 않는다(F7). */
  errorMessage?: string | null;
}

export function ReplayPublishPanel({
  redacted,
  canPublish,
  publication = null,
  isCompletedMission = true,
  onPublish,
  onUnpublish,
  busy = false,
  errorMessage = null,
}: ReplayPublishPanelProps) {
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  // ★L3 재확인은 발행 1회에 한정된다. 컴포넌트가 살아 있어도 발행이 끝나면 버린다.
  const [l3Acknowledged, setL3Acknowledged] = useState(false);

  const gate = publishGateState({
    verified: redacted.verified,
    canPublish,
    isCompletedMission,
    level: redacted.level,
    l3Acknowledged,
  });
  const needsL3Ack = !gate.canConfirm && gate.canOpen;
  const blockedReason = gate.reason;
  const canOpenPublish = gate.canOpen && !busy;

  const startPublish = () => {
    if (!canOpenPublish) return;
    setConfirmingPublish(true);
  };

  const confirmPublish = async () => {
    if (!gate.canConfirm) return;
    setConfirmingPublish(false);
    setL3Acknowledged(false); // 매 발행마다 다시 확인하게 만든다(§5.3)
    await onPublish?.();
  };

  const confirmUnpublish = async () => {
    setConfirmingUnpublish(false);
    await onUnpublish?.();
  };

  return (
    <section
      aria-labelledby="replay-publish-title"
      className="space-y-4 rounded-xl border border-gray-800 bg-gray-900/50 p-4"
    >
      <div>
        <h3
          id="replay-publish-title"
          className="text-sm font-semibold text-gray-200"
        >
          공개 Replay 발행
        </h3>
        <p className="mt-1 text-xs text-gray-500">
          아래 미리보기의 비식별판 바이트만 업로드됩니다. 등급 {redacted.level}{" "}
          · 제거된 항목 {redacted.removed.length}건.
        </p>
      </div>

      {/* ★발행 전에 이미 보이는 경고. 해제 다이얼로그까지 미루지 않는다. */}
      <p
        data-testid="replay-cache-warning"
        className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-100/90"
      >
        공개는 되돌릴 수 없습니다. {REPLAY_CACHE_RESIDUAL_WARNING}
      </p>

      {blockedReason && (
        <p className="text-xs text-red-300" role="status">
          {blockedReason}
        </p>
      )}
      {errorMessage && (
        <p className="text-xs text-red-300" role="alert">
          {errorMessage}
        </p>
      )}

      {publication ? (
        <div className="space-y-2 border-t border-gray-800 pt-3">
          <p className="text-xs text-gray-300">
            발행됨 · 등급 {publication.level}
          </p>
          <p className="break-all text-[11px] text-gray-500">
            {publication.url}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmingUnpublish(true)}
            className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-200 disabled:opacity-50"
          >
            발행 해제
          </button>
        </div>
      ) : (
        <div className="border-t border-gray-800 pt-3">
          <button
            type="button"
            disabled={!canOpenPublish}
            onClick={startPublish}
            className="rounded bg-emerald-500 px-3 py-1.5 text-xs font-medium text-gray-950 disabled:opacity-40"
          >
            공개 URL 발행
          </button>
        </div>
      )}

      {confirmingPublish && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="replay-publish-confirm-title"
          className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-950/30 p-3"
        >
          <h4
            id="replay-publish-confirm-title"
            className="text-xs font-semibold text-amber-200"
          >
            {redacted.level} 등급으로 공개합니다
          </h4>
          <p className="text-xs text-amber-100/80">
            미리보기에 보이는 바이트가 그대로 공개 URL 에 올라갑니다.{" "}
            {REPLAY_CACHE_RESIDUAL_WARNING}
          </p>
          {redacted.level === "L3" && (
            <label className="flex items-start gap-2 text-xs text-amber-100/90">
              <input
                type="checkbox"
                checked={l3Acknowledged}
                onChange={(event) => setL3Acknowledged(event.target.checked)}
              />
              <span>
                코드·터미널 발췌가 포함될 수 있음을 확인했습니다. 회사
                프로젝트라면 L2 를 권장합니다.
                <span className="mt-1 block text-[11px] text-amber-200/70">
                  L3 는 저장되지 않습니다 — 발행할 때마다 다시 선택해야 합니다.
                </span>
              </span>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300"
              onClick={() => {
                setConfirmingPublish(false);
                setL3Acknowledged(false);
              }}
            >
              취소
            </button>
            <button
              type="button"
              disabled={needsL3Ack || busy}
              className="rounded bg-amber-500 px-2 py-1 text-xs font-medium text-gray-950 disabled:opacity-40"
              onClick={() => void confirmPublish()}
            >
              공개 URL 만들기
            </button>
          </div>
        </div>
      )}

      {confirmingUnpublish && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="replay-unpublish-confirm-title"
          className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-950/30 p-3"
        >
          <h4
            id="replay-unpublish-confirm-title"
            className="text-xs font-semibold text-amber-200"
          >
            발행을 해제합니다
          </h4>
          <p className="text-xs text-amber-100/80">
            공개 문서와 업로드된 카드 이미지는 삭제되고 URL 은 즉시 접근 불가가
            됩니다. 다만 {REPLAY_CACHE_RESIDUAL_WARNING}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300"
              onClick={() => setConfirmingUnpublish(false)}
            >
              취소
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded bg-amber-500 px-2 py-1 text-xs font-medium text-gray-950 disabled:opacity-40"
              onClick={() => void confirmUnpublish()}
            >
              해제
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * 공개 Replay 공유 인텐트 (Phase 4-2 후속).
 *
 * 순수 함수만 담는다 — DOM·clipboard 접근은 컴포넌트 쪽 책임이다. 여기서
 * 만드는 건 "공개 URL + 텍스트"를 플랫폼별 web-intent URL 로 바꾸는 것뿐이고,
 * 그래야 인코딩·포맷을 브라우저 없이(jsdom/canvas 없이) 테스트할 수 있다.
 *
 * ★공유되는 건 공개 URL 뿐이다(OG 카드가 미리보기를 붙여준다, #739) — 원본
 * 카드 바이트나 비식별화 전 payload 는 이 파일이 절대 건드리지 않는다.
 *
 * ★Threads 는 공식 intent 가 텍스트만 받고 URL 파라미터가 없다(2026-08
 * 기준). 그래서 URL 을 텍스트 안에 이어붙인다 — 안 붙이면 링크 없는 포스트가
 * 나간다. 이 약함 때문에 컴포넌트는 "링크복사"를 플랫폼 버튼과 별개로 항상
 * 노출해야 한다(Threads 실패 시 유일한 탈출구).
 */

export type ShareIntentPlatform = "x" | "linkedin" | "threads";

export interface ShareIntent {
  platform: ShareIntentPlatform;
  label: string;
  /** target="_blank" 로 열 web-intent URL. */
  url: string;
}

const PLATFORM_LABELS: Record<ShareIntentPlatform, string> = {
  x: "X",
  linkedin: "LinkedIn",
  threads: "Threads",
};

export function buildTwitterShareUrl(url: string, text: string): string {
  return `https://twitter.com/intent/tweet?url=${encodeURIComponent(
    url
  )}&text=${encodeURIComponent(text)}`;
}

export function buildLinkedInShareUrl(url: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
    url
  )}`;
}

/** URL 파라미터가 없으므로 텍스트에 URL 을 이어붙여 보낸다. */
export function buildThreadsShareUrl(url: string, text: string): string {
  return `https://www.threads.net/intent/post?text=${encodeURIComponent(
    `${text} ${url}`
  )}`;
}

const PLATFORM_BUILDERS: Record<
  ShareIntentPlatform,
  (url: string, text: string) => string
> = {
  x: buildTwitterShareUrl,
  linkedin: (url) => buildLinkedInShareUrl(url),
  threads: buildThreadsShareUrl,
};

/**
 * 공개 URL + 공유 문구 → 플랫폼별 intent 목록. 순서가 곧 버튼 렬 순서다.
 */
export function buildReplayShareIntents(
  publicUrl: string,
  shareText: string
): ShareIntent[] {
  return (Object.keys(PLATFORM_BUILDERS) as ShareIntentPlatform[]).map(
    (platform) => ({
      platform,
      label: PLATFORM_LABELS[platform],
      url: PLATFORM_BUILDERS[platform](publicUrl, shareText),
    })
  );
}

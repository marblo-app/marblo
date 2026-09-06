/**
 * 로그인 폼 — 프레젠테이션 층.
 *
 * ★firebase 도 next-intl 훅도 import 하지 않는다(`org/OrgViews.tsx` 규약).
 *   입력은 값과 콜백뿐이라 jsdom 에 마운트해 **눌러 보고** 검사할 수 있다.
 *   page.tsx 는 firebase 를 모듈 최상단에서 import 하므로 테스트가 그 파일을
 *   가져오는 순간 SDK 초기화에 걸린다 — 그래서 뷰를 갈라 놓는다.
 *
 * 이 화면의 규약(감사 #1495 P1-4):
 *   1. ★제출 중임을 화면이 말한다 — 스피너 + 문구. 발표 단상에서 눌렀는데
 *      아무 일도 안 일어나 보이면 사장님이 한 번 더 누르신다.
 *   2. ★중복 제출을 막는다 — 두 버튼 모두 `disabled`. 화면 가림이 아니라
 *      실제 비활성이다(테스트가 두 번째 클릭이 안 먹는 것을 단언한다).
 *   3. 진행 중에는 에러를 지운다 — 지난 실패 문구가 새 시도 위에 남아 있으면
 *      방금 것이 또 실패한 줄로 읽힌다.
 */

import { Loader2 } from "lucide-react";

/** 이 뷰가 쓰는 문구만. 사전 전체가 아니라 필요한 키만 받는다. */
export type LoginFormCopy = {
  title: string;
  google: string;
  or: string;
  email: string;
  password: string;
  submit: string;
  submitting: string;
  noAccount: string;
  /** null 이면 에러 줄을 그리지 않는다. */
  error: string | null;
};

export function LoginFormView({
  copy,
  email,
  password,
  busy,
  signupSlot,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onGoogle,
}: {
  copy: LoginFormCopy;
  email: string;
  password: string;
  /** 제출이 진행 중인가. true 면 두 버튼 모두 실제로 비활성이다. */
  busy: boolean;
  /** 가입 링크 슬롯 — `next/link` 는 데이터 층이 꽂는다(뷰는 next 런타임을 안 쓴다). */
  signupSlot: React.ReactNode;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onSubmit: () => void;
  onGoogle: () => void;
}) {
  return (
    <div className="py-24 px-4">
      <div className="max-w-md mx-auto bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
        <h1 className="text-2xl font-bold text-center mb-8">{copy.title}</h1>
        <div className="space-y-3 mb-6">
          <button
            type="button"
            onClick={onGoogle}
            disabled={busy}
            className="w-full flex items-center justify-center gap-3 bg-white text-gray-900 py-3 rounded-lg font-medium hover:bg-gray-100 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {copy.google}
          </button>
        </div>
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-700" />
          </div>
          <div className="relative flex justify-center text-sm">
            {/* zinc-500 은 zinc-900 위에서 3.67:1 — AA 미달(감사 P1-2). */}
            <span className="px-2 bg-zinc-900 text-zinc-400">{copy.or}</span>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // ★제출 중 재제출을 여기서도 막는다. `disabled` 는 클릭만 막지
            //   Enter 키 제출까지 막지는 않는다.
            if (busy) return;
            onSubmit();
          }}
          className="space-y-4"
        >
          <input
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder={copy.email}
            disabled={busy}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-400 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            placeholder={copy.password}
            disabled={busy}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-400 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
          />
          {copy.error ? (
            <p className="text-red-400 text-sm" role="alert">
              {copy.error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-lg font-medium transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {copy.submitting}
              </>
            ) : (
              copy.submit
            )}
          </button>
        </form>
        <p className="text-center text-zinc-400 text-sm mt-6">
          {copy.noAccount} {signupSlot}
        </p>
      </div>
    </div>
  );
}

/**
 * 로그인 폼이 **제출 중임을 화면으로 말하고 중복 제출을 막는다**(감사 #1495 P1-4).
 *
 * ★스크린샷으로는 증명되지 않는다 — 눌러 보고 콜백이 몇 번 불렸는지를 세야 한다.
 *   "느려서 아무 일도 안 일어난 것처럼 보인다" 는 회귀는 그림이 아니라 DOM 과
 *   호출 횟수로 잡는다. 발표 단상에서 사장님이 두 번 누르시는 게 이 티켓의 동기다.
 *
 * ★jsdom 은 브라우저 GUI 가 아니라 DOM 구현체다. Playwright·Electron 은 안 띄운다.
 *
 * 세 벌 전부(ko·en·ja)로 문구 존재를 확인하고, 동작은 한 벌로 검사한다 —
 * 동작은 로케일에 의존하지 않는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import "../../../../components/charts/testEnv";
import ko from "../../../../../messages/ko.json";
import en from "../../../../../messages/en.json";
import ja from "../../../../../messages/ja.json";
import type { LoginFormCopy } from "./LoginFormView";

function copy(overrides: Partial<LoginFormCopy> = {}): LoginFormCopy {
  return {
    title: "로그인",
    google: "Google로 로그인",
    or: "또는",
    email: "이메일",
    password: "비밀번호",
    submit: "로그인",
    submitting: "로그인 중…",
    noAccount: "계정이 없으신가요?",
    error: null,
    ...overrides,
  };
}

type Mounted = {
  host: HTMLElement;
  submitBtn: HTMLButtonElement;
  googleBtn: HTMLButtonElement;
  form: HTMLFormElement;
  click: (el: HTMLElement) => Promise<void>;
  submitForm: () => Promise<void>;
};

async function mount(props: {
  busy: boolean;
  onSubmit: () => void;
  onGoogle: () => void;
}): Promise<Mounted> {
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { LoginFormView } = await import("./LoginFormView");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <LoginFormView
        copy={copy()}
        email=""
        password=""
        busy={props.busy}
        signupSlot={<span>회원가입</span>}
        onEmailChange={() => {}}
        onPasswordChange={() => {}}
        onSubmit={props.onSubmit}
        onGoogle={props.onGoogle}
      />,
    );
  });
  const buttons = [...host.querySelectorAll("button")] as HTMLButtonElement[];
  const submitBtn = buttons.find((b) => b.type === "submit")!;
  const googleBtn = buttons.find((b) => b.type === "button")!;
  const form = host.querySelector("form") as HTMLFormElement;
  const click = async (el: HTMLElement) => {
    await act(async () => {
      el.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
  };
  // ★버튼 클릭이 아니라 폼 submit 을 직접 쏜다 — Enter 키 제출 경로다.
  //   `disabled` 는 클릭만 막지 이 경로를 막지 않는다.
  const submitForm = async () => {
    await act(async () => {
      form.dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
    });
  };
  return { host, submitBtn, googleBtn, form, click, submitForm };
}

test("★대기 중이 아니면 제출이 통한다 — 가드가 정상 경로를 막지 않는다", async () => {
  let submits = 0;
  const m = await mount({
    busy: false,
    onSubmit: () => submits++,
    onGoogle: () => {},
  });
  assert.equal(m.submitBtn.disabled, false);
  await m.click(m.submitBtn);
  assert.equal(submits, 1, "평상시 제출이 안 되면 로그인 자체가 막힌다");
});

test("★제출 중에는 두 버튼이 실제로 비활성이다 — 화면 가림이 아니다", async () => {
  const m = await mount({ busy: true, onSubmit: () => {}, onGoogle: () => {} });
  assert.equal(m.submitBtn.disabled, true, "제출 버튼이 안 잠겼다");
  assert.equal(m.googleBtn.disabled, true, "Google 버튼이 안 잠겼다");
  assert.equal(
    m.submitBtn.getAttribute("aria-busy"),
    "true",
    "진행 상태가 접근성 트리에 없다",
  );
  for (const input of m.host.querySelectorAll("input")) {
    assert.equal(input.disabled, true, "입력칸이 안 잠겼다");
  }
});

test("★제출 중에는 클릭이 콜백을 다시 부르지 않는다 — 중복 로그인 방지", async () => {
  let submits = 0;
  let googles = 0;
  const m = await mount({
    busy: true,
    onSubmit: () => submits++,
    onGoogle: () => googles++,
  });
  await m.click(m.submitBtn);
  await m.click(m.submitBtn);
  await m.click(m.googleBtn);
  assert.equal(submits, 0, "제출 중인데 제출이 또 나갔다");
  assert.equal(googles, 0, "제출 중인데 Google 로그인이 또 나갔다");
});

test("★제출 중에는 Enter 키 제출도 막힌다 — disabled 는 이 경로를 안 막는다", async () => {
  let submits = 0;
  const m = await mount({
    busy: true,
    onSubmit: () => submits++,
    onGoogle: () => {},
  });
  await m.submitForm();
  assert.equal(submits, 0, "폼 submit 경로로 중복 제출이 샜다");
});

test("★제출 중이면 진행 문구와 스피너가 보인다 — 아무 일도 안 일어난 것처럼 보이면 안 된다", async () => {
  const m = await mount({ busy: true, onSubmit: () => {}, onGoogle: () => {} });
  assert.match(
    m.submitBtn.textContent ?? "",
    /로그인 중/,
    "제출 중 문구가 없다",
  );
  assert.ok(
    m.submitBtn.querySelector(".animate-spin"),
    "스피너가 없다 — 느린 네트워크에서 화면이 아무 말도 안 한다",
  );
});

test("★대기 중이 아니면 진행 문구가 사라진다", async () => {
  const m = await mount({
    busy: false,
    onSubmit: () => {},
    onGoogle: () => {},
  });
  assert.doesNotMatch(m.submitBtn.textContent ?? "", /로그인 중/);
  assert.equal(m.submitBtn.querySelector(".animate-spin"), null);
});

for (const [locale, dict] of [
  ["ko", ko],
  ["en", en],
  ["ja", ja],
] as const) {
  test(`[${locale}] 진행 문구 키가 사전에 있다 — 키 누락이 화면에 raw 키로 샌다`, () => {
    const v = (dict.auth as Record<string, unknown>).submitting;
    assert.equal(typeof v, "string", "auth.submitting 이 없다");
    assert.notEqual((v as string).trim(), "");
  });
}

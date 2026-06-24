import { defineConfig } from "vitest/config";

// Firestore 보안 규칙 테스트 전용 설정.
//
// 기본 vitest.config.mjs 는 `firebase/firestore` 와 `firebase/app` 을
// tests/mocks 로 alias 하지만, 규칙 테스트는 @firebase/rules-unit-testing 을
// 통해 *실제* Firestore SDK 를 에뮬레이터에 붙여야 하므로 그 alias 를 절대
// 쓰면 안 된다. 그래서 별도 config 로 분리한다.
//
// 실행:
//   firebase emulators:exec --only firestore \
//     "vitest run --config vitest.rules.config.mjs"
//   (= package.json 의 `npm run test:rules`)
export default defineConfig({
  test: {
    include: ["firestore.rules.test.ts"],
    globals: true,
    environment: "node",
    testTimeout: 15000,
    // 규칙 평가가 직렬화되어야 race 가 없다(공유 에뮬레이터 상태).
    fileParallelism: false,
  },
});

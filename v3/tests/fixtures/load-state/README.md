# load-state 타입 계약 픽스처

`tests/unit/load-state-typecheck.test.ts` 가 TypeScript 컴파일러 API 로 이 디렉터리를 컴파일한다.
`bad-*.ts` 는 **컴파일이 실패해야** 통과, `good.ts` 는 **실패하면** 안 된다.
이 폴더는 `tsconfig.json` 의 `include` 밖이라 `npx tsc --noEmit` 에는 안 들어간다 — 일부러다.

# `task_outcomes.outcomeMode` 배포 변경안

`outcomeMode STRING NULLABLE`를 추가한다. 이는 `errorCategory`(실패 귀책)와
직교하는 결과 축이며, 값은 `graph-updater`/`routing-graph`의 `OutcomeMode`
어휘를 그대로 쓴다. 새 매핑 테이블이나 userId 다리는 만들지 않는다.

```sql
ALTER TABLE `marblo-2253d.marblo_telemetry.task_outcomes`
ADD COLUMN IF NOT EXISTS outcomeMode STRING;
```

배포 순서는 (1) 이 DDL, (2) `logTaskOutcome`가 `d.outcomeMode`를 BQ row에
복사하는 함수 배포, (3) 이미 배포 가능한 클라이언트 순서다. 열이 없는 동안
현재 함수는 알 수 없는 callable payload 필드를 무시하므로 기존 삽입은 계속된다.
DDL 및 함수 배포는 별도 승인 작업이며, 이 변경에서는 실행하지 않는다.

`outcomeMode`는 식별자도 조인키도 아니다. `pseudonymizeAnalyticsRow`에는
`taskId`/`projectId`만 기존대로 전달하며, 비용과의 유일한 다리는 `taskId`다.
과거 행은 소급 적재하지 않는다.

`success`는 이미 NULLABLE BOOLEAN이다. `REVIEW`는 `outcomeMode="completed"`과
`success=NULL`로 적는다. 이는 완료 보고가 관측됐지만 PR 유무와 무관하게 아직
성공/실패가 확정되지 않았다는 뜻이다. 성공률 집계는 태스크별 최신 행만 대표로
고르고 `success IS NOT NULL`인 행만 분모로 삼아야 한다. 따라서 BLOCKED→DONE의
회복 이력과 REVIEW 행은 성공률 분모를 부풀리지 않는다.

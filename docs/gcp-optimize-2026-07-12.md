# GCP 비용·저장 최적화 감사 — marblo-2253d

- **프로젝트**: `marblo-2253d` (Firebase/GCP, 프로젝트번호 573192234266)
- **점검일**: 2026-07-12
- **감사자**: DevOps 에이전트 (`john.kim@hypemarc.com`, gcloud 실측)
- **성격**: 감사·제안 전용. **파괴적/비가역 변경(이미지 삭제·lifecycle·보유기간·정책 적용 등)은 일절 실행하지 않음.** 아래 "정리 명령"은 전부 **사용자 승인 후 별도 수행** 대상이다.

---

## TL;DR

**marblo-2253d 는 매우 린(lean)한 Firebase 전용 프로젝트로, 감사한 모든 서비스가 사실상 GCP 무료 티어 범위 안에 있다. 현재 실현 가능한 월 절감액은 ~$0 이다.** Cloud Run 미사용, Artifact Registry 0MB, BigQuery 총 ~107MB(무료 10GB 미만)·쿼리 ~1.5GB/월(무료 1TB 미만), 스토리지 버킷 1개 11MB. 낭비성 리소스(고아 이미지 더미, min-instances 핀, 과대 프로비저닝, 대용량 미파티션 스캔, BQ 로그 드레인 싱크)는 **발견되지 않았다.**

즉시 정리로 돈을 아낄 항목은 없고, 발견사항은 전부 **예방·위생(hygiene) 및 확장 대비** 성격이다. 심각도는 모두 **LOW / INFO**.

> ⚠️ **미실측 항목(공백 명시)**: Cloud Logging 월 수집 GB 절대량, Firestore 저장 용량/일일 읽기·쓰기 절대량은 CLI로 정확 측정하지 못했다(콘솔 Metrics/Usage 확인 필요). 정황상 무료 티어 내로 판단하나 **수치는 날조하지 않고 공백으로 둔다.**

---

## 서비스별 상세

### [1] Artifact Registry / Container Registry — 상태: OK, $0

| 항목          | 실측값                                               |
| ------------- | ---------------------------------------------------- |
| AR 저장소     | `gcf-artifacts` (DOCKER, us-central1) — **0.000 MB** |
| gcr.io 레거시 | 이미지 **없음** (`NAME_UNKNOWN` 404)                 |

- Gen1 Cloud Functions 프로젝트이나 함수 빌드 이미지가 AR/gcr.io에 **누적되지 않음**. 고아 untagged 이미지 더미 없음.
- **낭비 없음. 정리·자동정책 불필요.** (일반적으로 이 항목이 최대 누수원이나 여기선 청정)
- 예상 비용: **$0/월**

### [2] Cloud Run — 상태: N/A

- `run.googleapis.com` **미활성**. 이 프로젝트는 Cloud Run을 쓰지 않는 순수 Firebase(Gen1 Functions) 프로젝트.
- 과대 프로비저닝·min-instances·throttling 이슈 **해당 없음**.
- 예상 비용: **$0/월**

### [3] Cloud Functions (Gen1) — 상태: OK

| 항목          | 실측값                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 함수 수       | **44개** (전부 Gen1, `nodejs20`)                                                                                                                     |
| 메모리        | 표본 전부 **256 MB** (최소 티어)                                                                                                                     |
| min-instances | **미설정(=0)** — 표본 6종(chargeBillingKey, logHeartbeat, logTelemetryBatch, getCostSummary, tossWebhook, scheduledChargeSubscriptions) 모두 핀 없음 |
| max-instances | 기본값(예: scheduledChargeSubscriptions 3000 = Gen1 기본)                                                                                            |

- **min-instances 핀으로 인한 상시 과금 낭비 없음** (Gen1 기본 콜드스타트 허용). 메모리도 최소 티어라 과다 할당 없음.
- 함수 호출 컴퓨트(GB-초)는 무료 티어(2M 호출·400k GB-초·200k GHz-초/월) 내로 추정되나, **호출량 절대값은 미실측**(관찰: 텔레메트리성 함수 [4]의 대상 테이블이 2026-06-22 이후 미갱신 → 저빈도 정황).
- 예상 비용: **$0~소액/월** (무료 티어 내 추정)

### [4] BigQuery — 상태: OK (무료 티어 내), 위생 권고만

**데이터셋 2개** (⚠️ 텔레메트리는 삭제 제안 대상 아님 — 데이터 자산):

**`marblo_telemetry` (US)** — 총 ~107 MB
| 테이블 | 행수 | 크기 | 최종수정 | 파티션 |
|--------|------|------|----------|--------|
| agent_heartbeats | 753,928 | 93.0 MB | 2026-06-22 | **없음** |
| events | 49,551 | 7.68 MB | 2026-06-22 | 없음 |
| cost_logs | 45,691 | 6.74 MB | 2026-06-22 | 없음 |
| task_outcomes | 2 | ~0 | 2026-06-17 | 없음 |
| flow_executions | 0 | 0 | 2026-04-19 | 없음 |

**`analytics_543991508` (asia-northeast3)** — GA4/Firebase BigQuery 익스포트, 총 < 0.5 MB (events*/pseudonymous_users* 일별 테이블 4일치, 20260708~11). 기본 테이블 만료 **미설정**.

- **저장 비용**: 두 데이터셋 합계 ~107MB → 무료 10GB 한참 미만 → **$0**.
- **쿼리 비용**: 최근 30일 billed ~0.03–0.13 GB/일, **월 ~1.5 GB** → 무료 1TB/월 한참 미만 → **$0**.
- **관찰(비용 아님, 참고)**: `marblo_telemetry` 5개 테이블 모두 최종수정이 **2026-06-22**(agent_heartbeats/events/cost_logs) 또는 그 이전 — 약 3주간 신규 적재 정황이 보이지 않음. 텔레메트리 파이프라인이 멈췄는지 여부는 **본 감사 범위 밖**이며 별도 확인 권장(스트리밍 버퍼 특성상 last_modified 미갱신일 수도 있어 단정하지 않음).
- 예상 비용: **$0/월**

### [5] Cloud Logging — 상태: OK (표준 구성)

| 항목      | 실측값                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------- |
| 싱크      | `_Required`, `_Default` **기본 2개뿐** — 커스텀 **BQ 드레인 싱크 없음**(로그 재적재 과금 없음) |
| 버킷 보유 | `_Default` 30일 / `_Required` 400일(감사로그, 고정·**무료**)                                   |

- 커스텀 익스포트/장기보유 버킷 없음. 로그 비용의 대표 누수원(대용량 BQ 싱크·과다 보유)이 **없음**.
- ⚠️ **월 수집 GB 절대량 미실측(공백)** — 44개 저트래픽 함수 특성상 무료 50GB/월 내로 추정하나 수치 확정 못함. 정확값은 콘솔 **Logging → Log Storage** 확인.
- 예상 비용: **$0/월 추정 (수집량 미확정)**

### [6] Cloud Scheduler — 상태: OK, $0

- **3개** ENABLED (firebase-schedule 결제 리컨실 3종: Paddle 04:15 / Toss 04:00 / ChargeSubscriptions 04:30, us-central1). 실패 job 없음.
- 무료 3개 한도 **정확히 일치** → **$0**. (4번째 추가 시부터 $0.10/job/월)

### [7] Cloud Storage — 상태: OK, $0

| 버킷                                   | 위치        | 크기                            |
| -------------------------------------- | ----------- | ------------------------------- |
| `gcf-sources-573192234266-us-central1` | US-CENTRAL1 | **~11 MB** (함수 소스 스테이징) |

- Firebase Storage(appspot/firebasestorage) 버킷 미프로비저닝. 고아 객체·오래된 백업 더미 없음.
- lifecycle 미설정이나 대상 용량이 11MB라 **실익 없음**. 예상 비용: **$0/월**

### [8] 기타 — 상태: OK

- **Secret Manager**: `TOSS_SECRET_KEY` 1개 → 무료 6개 내 → **$0**.
- **Cloud Build**: 함수 배포 빌드가 us-central1에 소수 존재(07-06~07-10 SUCCESS 다수), 무료 120분/일 내 → **$0**.
- **Firestore**: 단일 `(default)` DB, Native, asia-northeast3. ⚠️ **저장 용량·일일 읽기/쓰기 절대량 미실측(공백)** — 베타 규모상 무료 티어(1GB·50k read/20k write일) 내 추정, 수치는 콘솔 Firestore Usage 확인.

---

## 비용 요약

| #   | 서비스                  | 상태      | 예상 비용/월           | 실현 절감/월 |
| --- | ----------------------- | --------- | ---------------------- | ------------ |
| 1   | Artifact Registry       | 청정      | $0                     | $0           |
| 2   | Cloud Run               | 미사용    | $0                     | –            |
| 3   | Cloud Functions         | 무료 티어 | $0~소액                | $0           |
| 4   | BigQuery                | 무료 티어 | $0                     | $0           |
| 5   | Cloud Logging           | 표준      | $0 추정(수집량 미확정) | $0           |
| 6   | Cloud Scheduler         | 무료 3/3  | $0                     | $0           |
| 7   | Cloud Storage           | 11MB      | $0                     | $0           |
| 8   | Secrets/Build/Firestore | 무료 티어 | $0 추정                | $0           |
|     | **합계**                |           | **≈ $0/월**            | **≈ $0/월**  |

**결론: 즉시 정리로 회수할 비용이 없다.** 아래 권고는 전부 예방·확장 대비용이며 심각도 LOW/INFO.

---

## 발견사항 & 권고 (전부 LOW/INFO — 실행은 사용자 승인 후)

### R1 [LOW] `marblo_telemetry.agent_heartbeats` 미파티션 — 확장 대비

- 현재 93MB/753k행, 쿼리 무료 티어 내라 **당장 절감액 없음**. 다만 heartbeat가 재개되어 수백 MB~GB로 커지면 미파티션 풀스캔 비용이 붙는다. 지금 파티셔닝하면 미래 비용을 예방.
- **정리 명령(승인 후, 비파괴적 신규 테이블 생성 방식)**:
  ```bash
  # 실행 전 반드시 사용자 승인. 텔레메트리는 데이터 자산이므로 원본 보존.
  # 타임스탬프 컬럼명은 실제 스키마 확인 후 대입(예: ts / created_at).
  bq query --use_legacy_sql=false --location=US \
  'CREATE TABLE `marblo-2253d.marblo_telemetry.agent_heartbeats_part`
   PARTITION BY DATE(<TS_COL>) CLUSTER BY <AGENT_ID_COL> AS
   SELECT * FROM `marblo-2253d.marblo_telemetry.agent_heartbeats`'
  # 행수 검증 후에만 rename 교체. DROP 은 검증 완료 후 별도.
  ```
- ⚠️ 스키마(타임스탬프/클러스터 컬럼) 미확인 상태 — 실행 전 `bq show` 로 컬럼 확인 필요.

### R2 [INFO] GA4 익스포트 `analytics_543991508` 기본 테이블 만료 미설정

- 일별 events*/pseudonymous_users* 테이블이 무기한 누적 구조. 현재 4일치·<0.5MB라 **비용 무의미**하나, 장기적으로 위생상 만료 설정 권장.
- **정리 명령(승인 후)**: `bq update --default_table_expiration <초> marblo-2253d:analytics_543991508` (예: 63072000 = 730일). GA 원자료 보존정책과 상충 없는지 확인 후.

### R3 [INFO] 텔레메트리 적재 정체 여부 확인(비용 아님)

- `marblo_telemetry` 전 테이블 최종수정 ≤ 2026-06-22. 파이프라인 중단인지 스트리밍 버퍼 특성인지 **별도 조사 권장**(비용이 아니라 데이터 신선도 이슈). 감사 범위 밖이라 단정하지 않음.

### R4 [INFO] Cross-region 데이터셋 배치

- `marblo_telemetry`(US) ↔ `analytics_543991508`(asia-northeast3) ↔ Firestore/Functions(asia-northeast3). 두 BQ 데이터셋을 조인할 일이 있으면 리전 불일치로 불가/전송비 발생. 현재 조인 워크로드 없어 **실비용 없음**, 신규 설계 시만 유의.

### R5 [INFO] 예방적 AR 자동정리 정책(현재 불필요)

- gcf-artifacts가 0MB라 지금은 불필요하나, 향후 Gen2/Cloud Run 전환 시 untagged 누적 대비 cleanup policy를 미리 표준화해두면 좋다. (실행 불요)

---

## 감사 방법론(재현용)

전부 읽기 전용 조회. `--project=marblo-2253d` 명시(기본 프로젝트는 hankang-temu-to-coupang).

```bash
gcloud services list --enabled --project=marblo-2253d
gcloud artifacts repositories list --project=marblo-2253d
gcloud functions list --project=marblo-2253d
gcloud storage du -s gs://gcf-sources-573192234266-us-central1
bq --project_id=marblo-2253d ls; bq query ... __TABLES__ / region-US.INFORMATION_SCHEMA.JOBS
gcloud logging sinks list / buckets list --project=marblo-2253d
gcloud scheduler jobs list / secrets list --project=marblo-2253d
gcloud firestore databases list --project=marblo-2253d
```

**다음 점검 권장: 2026-08-12 (월 1회).** 베타 오픈(6/24)·GA(7/10) 이후 트래픽 증가 시 Logging 수집량·Functions 호출량·Firestore 사용량 절대값을 콘솔 Usage로 재확인할 것.

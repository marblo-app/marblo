/**
 * ★5단 드릴다운 화면 규약을 **렌더된 HTML 바이트로** 확인한다
 * (`OrgUsageView.test.tsx` 규약). 이 화면이 실패하는 방식은 다섯이다:
 *   1. 모르는 것이 `0` · 빈칸 · 대시로 그려진다 → 사람 눈에 전부 0 이다.
 *   2. 하네스족이 실제 모델 자리에 앉는다 → 발표에서 solar·kimi 가 claude 로 뜬다.
 *   3. 권한으로 가려진 프로젝트가 숫자로 샌다 → 뺄셈 누수.
 *   4. 사람 축 성공률이 미배선인데 숫자처럼 보인다 → 없는 계측이 있는 척한다.
 *   5. 사람이 안 붙은 병합이 누군가의 실적이 된다.
 * ko·en·ja 세 벌 전부로 돌린다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import ko from "../../../../messages/ko.json";
import en from "../../../../messages/en.json";
import ja from "../../../../messages/ja.json";
import { buildOrgCopy, type OrgCopy } from "./orgCopy";
import {
  ProjectDrilldownDetail,
  OrgDrilldownSection,
} from "./OrgDrilldownView";
import {
  buildProjectDetail,
  type DrilldownProjectDetail,
} from "./orgDrilldownContract";
import { formatUsd, normalizeTeamUsage } from "../team/teamUsageContract";
import { normalizeTeamAudit } from "../team/teamAuditContract";

const LOCALES: Array<{ locale: string; copy: OrgCopy }> = [
  { locale: "ko", copy: buildOrgCopy(ko.org) },
  { locale: "en", copy: buildOrgCopy(en.org) },
  { locale: "ja", copy: buildOrgCopy(ja.org) },
];

const KEY_A = "tm_aaaaaaaa";
const KEY_B = "tm_bbbbbbbb";

/** 렌더된 HTML 과 대조할 문구는 React 의 이스케이프를 그대로 따라간다. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function renderDetail(
  entry: typeof LOCALES[number],
  detail: DrilldownProjectDetail,
  projectTotalUsd: number | null = null
): string {
  return renderToStaticMarkup(
    <ProjectDrilldownDetail
      copy={entry.copy}
      locale={entry.locale}
      detail={detail}
      projectTotalUsd={projectTotalUsd}
    />
  );
}

function detailFrom(usage: unknown, audit: unknown): DrilldownProjectDetail {
  return buildProjectDetail(
    normalizeTeamUsage(usage),
    normalizeTeamAudit(audit)
  );
}

// ── 1. ★모르는 것을 0 으로 그리지 않는다 ────────────────────────────────────

for (const entry of LOCALES) {
  test(`[${entry.locale}] ★기록 없음이 0 이 아니라 글자로 나온다`, () => {
    const html = renderDetail(
      entry,
      detailFrom(
        {
          teamUsage: { state: "complete" },
          byMember: [
            { memberKey: KEY_A, hasRows: false, costUsd: 0, tokens: 0 },
          ],
        },
        { teamAudit: { state: "complete" }, events: [] }
      )
    );
    assert.ok(
      html.includes(esc(entry.copy.text["drill.cell.noRecords"])),
      "'기록 없음' 글자가 없다"
    );
    // ★그리고 그 자리에 금액이 같이 뜨면 안 된다 — 0 으로 읽힌다.
    assert.ok(
      !html.includes(esc(formatUsd(0, entry.locale))),
      "기록 없음 자리에 0 금액이 그려졌다"
    );
    // ★대시로도 그리지 않는다(사람 눈에 0 으로 읽힌다).
    assert.ok(!html.includes(">—<"), "대시로 그렸다");
  });

  test(`[${entry.locale}] ★'판정 안 함' 과 '기록 없음' 은 다른 글자다`, () => {
    const unknown = renderDetail(
      entry,
      detailFrom(
        {
          teamUsage: { state: "complete" },
          byMember: [
            { memberKey: KEY_A, hasRows: null, costUsd: 5, tokens: 5 },
          ],
        },
        // ★원장 칸에서 나오는 "기록 없음" 과 섞이지 않게 이 사람 사건을 하나
        //   실어 비용 칸만 남긴다 — 두 칸이 같은 글자를 쓰므로 격리해야 한다.
        {
          teamAudit: { state: "complete" },
          events: [
            {
              id: "e1",
              kind: "task_transition",
              action: "claim_task",
              memberKey: KEY_A,
              taskId: "T1",
              success: true,
            },
          ],
        }
      )
    );
    assert.ok(unknown.includes(esc(entry.copy.text["drill.cell.unknown"])));
    assert.ok(
      !unknown.includes(esc(entry.copy.text["drill.cell.noRecords"])),
      "판정 안 함이 기록 없음으로 접혔다"
    );
    // ★잘려서 모르는 사람의 금액을 그리지 않는다.
    assert.ok(
      !unknown.includes(esc(formatUsd(5, entry.locale))),
      "모르는 값의 금액이 샜다"
    );
  });

  test(`[${entry.locale}] ★실측 0 은 0 으로 그리되 '실측' 이라고 밝힌다`, () => {
    const html = renderDetail(
      entry,
      detailFrom(
        {
          teamUsage: { state: "complete" },
          byMember: [
            {
              memberKey: KEY_A,
              hasRows: true,
              costUsd: 0,
              tokens: 0,
              byModel: [{ model: "claude-opus-5", costUsd: 0, tokens: 0 }],
            },
          ],
        },
        { teamAudit: { state: "complete" }, events: [] }
      )
    );
    assert.ok(html.includes(esc(entry.copy.text["drill.cell.realZero"])));
  });

  test(`[${entry.locale}] ★옛 배포의 빈 분해는 '미측정' 이지 '안 씀' 이 아니다`, () => {
    const html = renderDetail(
      entry,
      detailFrom(
        {
          teamUsage: { state: "complete" },
          byMember: [
            { memberKey: KEY_A, hasRows: true, costUsd: 3, tokens: 30 },
          ],
        },
        {
          teamAudit: { state: "complete" },
          events: [
            {
              id: "e1",
              kind: "task_transition",
              action: "claim_task",
              memberKey: KEY_A,
              taskId: "T1",
              success: true,
            },
          ],
        }
      )
    );
    assert.ok(html.includes(esc(entry.copy.text["drill.cell.unwired"])));
    assert.ok(!html.includes(esc(entry.copy.text["drill.cell.noRecords"])));
  });
}

// ── 2. ★하네스족을 실제 모델로 승격시키지 않는다 ────────────────────────────

for (const entry of LOCALES) {
  test(`[${entry.locale}] ★하네스족 모델에는 '실제 모델 모름' 라벨이 붙는다`, () => {
    const html = renderDetail(
      entry,
      detailFrom(
        {
          teamUsage: { state: "complete" },
          byMember: [
            {
              memberKey: KEY_A,
              hasRows: true,
              costUsd: 14,
              tokens: 140,
              byModel: [
                { model: "claude-opus-5", costUsd: 10, tokens: 100 },
                { model: "claude", costUsd: 4, tokens: 40 },
              ],
            },
          ],
        },
        { teamAudit: { state: "complete" }, events: [] }
      )
    );
    assert.ok(
      html.includes(esc(entry.copy.text["drill.model.harnessOnly"])),
      "하네스족에 라벨이 안 붙었다"
    );
    // ★그리고 그 금액을 **문장으로** 밝힌다 — 발표에서 그 막대를 설명할 수 있게.
    //   ★금액만 대조하면 안 된다: 그 숫자는 모델 행에도 이미 떠 있어서, 문장을
    //   통째로 지워도 통과한다(실측으로 확인 — 뮤테이션이 초록으로 지나갔다).
    //   문장 전체를 대조해야 "섞인 축을 조용히 넘기는" 사고가 여기서 막힌다.
    const mixedNote = entry.copy.text["drill.model.harnessNote"].replace(
      "{amount}",
      formatUsd(4, entry.locale)
    );
    assert.ok(
      html.includes(esc(mixedNote)),
      "실행기 이름으로 기록된 금액을 밝히는 문장이 없다"
    );
    // 실제 모델 id 는 그대로 나온다.
    assert.ok(html.includes("claude-opus-5"));
  });

  test(`[${entry.locale}] ★실제 모델만 있으면 '모름' 문장을 만들지 않는다`, () => {
    const html = renderDetail(
      entry,
      detailFrom(
        {
          teamUsage: { state: "complete" },
          byMember: [
            {
              memberKey: KEY_A,
              hasRows: true,
              costUsd: 10,
              tokens: 100,
              byModel: [{ model: "claude-opus-5", costUsd: 10, tokens: 100 }],
            },
          ],
        },
        { teamAudit: { state: "complete" }, events: [] }
      )
    );
    assert.ok(!html.includes(esc(entry.copy.text["drill.model.harnessOnly"])));
  });
}

// ── 3. ★권한으로 가려진 칸 — 숫자가 한 글자도 새지 않는다 ───────────────────

for (const entry of LOCALES) {
  test(`[${entry.locale}] ★프로젝트 역할이 없으면 사람 단이 restricted 로 접힌다`, () => {
    const html = renderDetail(
      entry,
      detailFrom(
        {
          teamUsage: { state: "complete" },
          byMember: [
            { memberKey: KEY_A, hasRows: true, costUsd: 1234.56, tokens: 999 },
          ],
        },
        {
          teamAudit: { state: "disabled", reasonCode: "no_role" },
          events: [],
        }
      ),
      1234.56
    );
    assert.ok(html.includes(esc(entry.copy.text["drill.restricted.title"])));
    // ★숫자가 한 글자도 안 나온다 — 뺄셈으로 되짚을 값 자체를 안 그린다.
    assert.ok(!html.includes("1234"), "가려진 칸에서 금액이 샜다");
    assert.ok(!html.includes("1,234"), "가려진 칸에서 금액이 샜다");
    assert.ok(!html.includes("999"), "가려진 칸에서 토큰이 샜다");
    assert.ok(!html.includes(KEY_A), "가려진 칸에서 사람 가명이 샜다");
  });
}

// ── 4. ★사람 축 성공률은 미배선이고, 화면이 그 경계를 말한다 ────────────────

for (const entry of LOCALES) {
  test(`[${entry.locale}] ★모델별 성공률은 0% 가 아니라 '아직 재지 않는다' 다`, () => {
    const html = renderDetail(
      entry,
      detailFrom(
        {
          teamUsage: { state: "complete" },
          byMember: [
            { memberKey: KEY_A, hasRows: true, costUsd: 3, tokens: 30 },
          ],
        },
        { teamAudit: { state: "complete" }, events: [] }
      )
    );
    assert.ok(html.includes(esc(entry.copy.text["drill.outcome.unwired"])));
    // ★T₀ 이전은 영영 안 붙는다는 경계 문장이 같이 나온다.
    assert.ok(html.includes(esc(entry.copy.text["drill.outcome.boundary"])));
    assert.ok(!html.includes("0%"), "미배선 칸에 퍼센트가 그려졌다");
  });
}

// ── 5. ★사람이 안 붙은 병합을 누구의 실적으로도 만들지 않는다 ───────────────

for (const entry of LOCALES) {
  test(`[${entry.locale}] ★행위자 없는 병합 기록은 그 사실이 문장으로 나온다`, () => {
    const html = renderDetail(
      entry,
      detailFrom(
        {
          teamUsage: { state: "complete" },
          byMember: [
            { memberKey: KEY_A, hasRows: true, costUsd: 3, tokens: 30 },
          ],
        },
        {
          teamAudit: { state: "complete" },
          events: [
            {
              id: "m1",
              kind: "merge",
              action: "merge_history",
              memberKey: null,
              taskId: "T1",
              success: null,
              merge: {
                branch: "b",
                prNumber: 1487,
                filesChanged: 1,
                linesAdded: 1,
                linesDeleted: 0,
              },
            },
          ],
        }
      )
    );
    const note = entry.copy.text["drill.ledger.unattributedMerges"].replace(
      "{n}",
      "1"
    );
    assert.ok(html.includes(esc(note)), "행위자 없는 병합 문장이 없다");
  });
}

// ── 6. 사람 축 경계 문장 · 안 보여주는 것 ───────────────────────────────────

for (const entry of LOCALES) {
  test(`[${entry.locale}] ★비용의 축(실행한 계정 기준)을 상시 말한다`, () => {
    const html = renderDetail(
      entry,
      detailFrom(
        {
          teamUsage: { state: "complete" },
          byMember: [
            { memberKey: KEY_A, hasRows: true, costUsd: 3, tokens: 30 },
          ],
        },
        { teamAudit: { state: "complete" }, events: [] }
      )
    );
    assert.ok(html.includes(esc(entry.copy.text["drill.person.basis"])));
  });

  test(`[${entry.locale}] ★사람이 하나뿐이면 '축이 안 갈렸다' 고 말한다`, () => {
    const one = renderDetail(
      entry,
      detailFrom(
        {
          teamUsage: { state: "complete" },
          byMember: [
            { memberKey: KEY_A, hasRows: true, costUsd: 3, tokens: 30 },
          ],
        },
        { teamAudit: { state: "complete" }, events: [] }
      )
    );
    assert.ok(one.includes(esc(entry.copy.text["drill.person.single"])));

    const two = renderDetail(
      entry,
      detailFrom(
        {
          teamUsage: { state: "complete" },
          byMember: [
            { memberKey: KEY_A, hasRows: true, costUsd: 3, tokens: 30 },
            { memberKey: KEY_B, hasRows: true, costUsd: 1, tokens: 10 },
          ],
        },
        { teamAudit: { state: "complete" }, events: [] }
      )
    );
    assert.ok(!two.includes(esc(entry.copy.text["drill.person.single"])));
  });

  test(`[${entry.locale}] ★사람 합이 프로젝트 합보다 작으면 차이를 밝힌다`, () => {
    const html = renderDetail(
      entry,
      detailFrom(
        {
          teamUsage: { state: "complete" },
          byMember: [
            { memberKey: KEY_A, hasRows: true, costUsd: 3, tokens: 30 },
          ],
        },
        { teamAudit: { state: "complete" }, events: [] }
      ),
      7
    );
    // ★금액 문자열은 로케일이 정한다(ko 는 "US$4.00"). 문자열을 손으로 짓지
    //   않고 화면과 **같은 포맷터**로 만든다 — 안 그러면 ko 에서만 깨진다.
    const note = entry.copy.text["drill.person.gap"].replace(
      "{amount}",
      formatUsd(4, entry.locale)
    );
    assert.ok(html.includes(esc(note)), "합계 차이 문장이 없다");
  });

  test(`[${entry.locale}] ★안 보여주는 것을 접지 않고 **상시** 노출한다`, () => {
    // ★"상시" 가 규약이다 — 데이터가 있든 없든, 펼쳤든 아니든 남아야 한다.
    //   빈 목록 하나로만 재면 "데이터가 없을 때만 뜨는 문장" 이어도 통과한다
    //   (형제 티켓 6X5zmTY5OUKI4Sxwufqo 가 자기 범례에서 같은 구멍을 찾았다 —
    //   그쪽은 그 가드를 지워도 15건 전부 초록이었다).
    const render = (projects: Parameters<typeof OrgDrilldownSection>[0]["projects"]) =>
      renderToStaticMarkup(
        <OrgDrilldownSection
          copy={entry.copy}
          locale={entry.locale}
          projects={projects}
          expandedProjectId={null}
          onToggle={() => {}}
          detail={null}
        />
      );
    const withheld = esc(entry.copy.text["drill.withheld"]);
    assert.ok(render([]).includes(withheld), "빈 목록에서 안 보인다");
    assert.ok(
      render([
        {
          projectId: "p1",
          projectName: "프로젝트 하나",
          costUsd: 12,
          tokens: 120,
          teamId: "t1",
          teamDisplayName: "팀 하나",
        },
      ]).includes(withheld),
      "★프로젝트가 있으면 사라진다 — '상시' 가 아니다"
    );
  });

  test(`[${entry.locale}] ★비용 축 문장도 사람 행이 어떻든 남는다`, () => {
    // 같은 부류: "비용은 실행한 계정 기준" 은 데이터 모양에 따라 사라지면 안 된다.
    const basis = esc(entry.copy.text["drill.person.basis"]);
    // (a) 사람 행이 있는 경우
    assert.ok(
      renderDetail(
        entry,
        detailFrom(
          {
            teamUsage: { state: "complete" },
            byMember: [
              { memberKey: KEY_A, hasRows: true, costUsd: 3, tokens: 30 },
            ],
          },
          { teamAudit: { state: "complete" }, events: [] }
        )
      ).includes(basis),
      "사람 행이 있을 때 안 보인다"
    );
    // (b) 사람 행이 하나도 없는 경우 — 빈 상태에서도 축은 말해야 한다.
    assert.ok(
      renderDetail(
        entry,
        detailFrom(
          { teamUsage: { state: "complete" }, byMember: [] },
          { teamAudit: { state: "complete" }, events: [] }
        )
      ).includes(basis),
      "★사람 행이 없으면 사라진다 — 빈 화면이 축을 안 말한다"
    );
  });

  test(`[${entry.locale}] ★프로젝트를 안 펼치면 상세를 그리지 않는다`, () => {
    const html = renderToStaticMarkup(
      <OrgDrilldownSection
        copy={entry.copy}
        locale={entry.locale}
        projects={[
          {
            projectId: "p1",
            projectName: "프로젝트 하나",
            costUsd: 12,
            tokens: 120,
            teamId: "t1",
            teamDisplayName: "팀 하나",
          },
        ]}
        expandedProjectId={null}
        onToggle={() => {}}
        detail={null}
      />
    );
    assert.ok(
      html.includes(esc(formatUsd(12, entry.locale))),
      "프로젝트 행의 금액이 없다"
    );
    assert.ok(
      !html.includes(esc(entry.copy.text["drill.person.title"])),
      "안 펼쳤는데 사람 표가 그려졌다"
    );
    // 빵부스러기 — 팀 이름이 프로젝트 앞에 붙는다.
    assert.ok(html.includes("팀 하나"));
  });
}

// ── 7. 로딩·오류 — 빈 화면으로 떨어지지 않는다 ──────────────────────────────

for (const entry of LOCALES) {
  test(`[${entry.locale}] 로딩·오류 상태가 문장으로 나온다`, () => {
    assert.ok(
      renderDetail(entry, { kind: "loading" }).includes(
        esc(entry.copy.text["drill.loading"])
      )
    );
    assert.ok(
      renderDetail(entry, { kind: "error" }).includes(
        esc(entry.copy.text["drill.error"])
      )
    );
  });
}

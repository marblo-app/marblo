/**
 * 공개 Replay 저장 계층(`publicReplayService`) + 발행/해제 UI 테스트.
 *
 * 핀하는 계약:
 *   - ★공개 문서에는 **내부 식별자가 하나도 없다** (projectId·missionId·uid).
 *     비식별화이 payload 안의 id 를 지워도 문서 봉투로 새면 의미가 없다.
 *   - ★replayId 는 crypto 난수다. 난수원이 없으면 **던진다** — Math.random
 *     폴백이 생기는 순간 F6(열거로 취소본 접근)이 되살아난다.
 *   - ★2차 검증 실패·크기 초과·미완료 미션은 발행 **중단**이다(가리고 올리기 아님).
 *   - ★업로드되는 바이트 = 검증을 통과한 `serialized` 문자열 그대로.
 *   - ★쓰기 순서: 소유권 문서 → 공개 문서. 공개 문서가 실패하면 소유권을
 *     `unpublished` 로 되돌린다("발행됨"이라고 거짓말하지 않기 위해).
 *   - ★해제는 공개 문서를 **먼저** 지운다. 그게 URL 을 죽이는 유일한 동작이다.
 *   - ★F7: 에러 메시지에 payload 원문이 실리지 않는다.
 *   - ★UI 는 발행 전과 해제 전 **양쪽에서** 캐시 잔존을 경고하고, L3 확인은
 *     저장되지 않는다(매 발행마다 재선택).
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** `lib/firebase` 는 import 만으로 initializeAuth 를 부른다(다른 서비스 테스트와 동일). */
vi.mock("../../src/lib/firebase", () => ({ db: {}, auth: {}, functions: {} }));

const {
  PUBLIC_REPLAYS_COLLECTION,
  PUBLIC_REPLAY_OWNERS_COLLECTION,
  PUBLIC_REPLAY_MAX_PAYLOAD_CHARS,
  PublicReplayError,
  generateReplayId,
  getMissionPublication,
  getPublicReplay,
  listProjectPublications,
  publicReplayUrl,
  publishReplay,
  unpublishReplay,
} = await import("../../src/services/publicReplayService");
type PublicReplayDeps =
  import("../../src/services/publicReplayService").PublicReplayDeps;
type PublicReplayOwnerRecord =
  import("../../src/services/publicReplayService").PublicReplayOwnerRecord;

import {
  ReplayPublishPanel,
  publishGateState,
} from "../../src/components/work-history/replay/ReplayPublishPanel";
import type {
  MissionReplay,
  RedactedReplay,
} from "../../src/types/missionReplay";

const PROJECT_ID = "project-1234567890123456";
const MISSION_ID = "mission-1234567890123456";
const PUBLISHER_UID = "uid-abcdefghijklmnop";
const NOW = new Date("2026-08-01T12:00:00Z");

function makeReplay(overrides: Partial<MissionReplay> = {}): MissionReplay {
  return {
    replayVersion: 1,
    missionId: MISSION_ID,
    projectId: PROJECT_ID,
    goal: "Ship the public replay layer",
    templateId: "feature",
    launchedAt: new Date("2026-08-01T09:00:00Z"),
    completedAt: new Date("2026-08-01T09:12:00Z"),
    stats: {
      tasks: 1,
      tasksDone: 1,
      agents: 1,
      prs: 1,
      filesChanged: 2,
      linesAdded: 10,
      linesDeleted: 1,
      testsPassed: 1,
      riskFlags: 0,
      reportsScanned: 1,
      retries: 0,
      durationMs: 720000,
      costTotal: null,
    },
    cast: [],
    beats: [],
    prUrls: [],
    provenance: {
      sources: {
        "mission.contextLog": "ok",
        task: "ok",
        "task.activity": "ok",
        audit_logs: "empty",
        projectAuditLog: "empty",
        merge_history: "ok",
      },
      generatedAt: new Date("2026-08-01T09:12:00Z"),
    },
    ...overrides,
  };
}

function makeRedacted(overrides: Partial<RedactedReplay> = {}): RedactedReplay {
  const payload = { goal: "Ship the public replay layer", stats: { tasks: 1 } };
  return {
    level: "L2",
    payload,
    serialized: JSON.stringify(payload, null, 2),
    removed: [{ path: "beats[0].detail", rule: "R9", action: "DROP" }],
    verified: true,
    ...overrides,
  };
}

interface Recorder {
  deps: PublicReplayDeps;
  writes: Array<{ collection: string; docId: string; data: object }>;
  updates: Array<{ collection: string; docId: string; data: object }>;
  deletes: Array<{ collection: string; docId: string }>;
}

function recorder(options: { failPublicWrite?: boolean } = {}): Recorder {
  const writes: Recorder["writes"] = [];
  const updates: Recorder["updates"] = [];
  const deletes: Recorder["deletes"] = [];
  // 결정적 바이트 — id 조립이 알파벳을 벗어나지 않는지 보려고 전 범위를 쓴다.
  let seed = 0;
  const deps: PublicReplayDeps = {
    async setDoc(collection, docId, data) {
      if (options.failPublicWrite && collection === PUBLIC_REPLAYS_COLLECTION) {
        throw new Error("permission-denied");
      }
      writes.push({ collection, docId, data });
    },
    async updateDoc(collection, docId, data) {
      updates.push({ collection, docId, data });
    },
    async deleteDoc(collection, docId) {
      deletes.push({ collection, docId });
    },
    async getDoc() {
      return null;
    },
    async queryDocs() {
      return [];
    },
    randomBytes(size) {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i += 1) bytes[i] = (seed += 7) & 0xff;
      return bytes;
    },
    now: () => NOW,
  };
  return { deps, writes, updates, deletes };
}

describe("replayId — 추측불가 id (§5.7 F6)", () => {
  it("crypto 난수에서 접두사 + 26자 base32 를 만든다", () => {
    const id = generateReplayId(() => new Uint8Array(26).fill(0));
    expect(id).toHaveLength(27);
    expect(id).toMatch(/^r[0-9abcdefghjkmnpqrstvwxyz]{26}$/);
  });

  it("모든 바이트 값이 알파벳 안으로 떨어진다(편향·범위 이탈 없음)", () => {
    const bytes = new Uint8Array(26);
    for (let i = 0; i < 26; i += 1) bytes[i] = i * 10;
    expect(generateReplayId(() => bytes)).toMatch(
      /^r[0-9abcdefghjkmnpqrstvwxyz]{26}$/,
    );
  });

  it("★난수원이 없으면 던진다 — Math.random 폴백을 만들지 않는다", () => {
    expect(() =>
      generateReplayId(() => {
        throw new PublicReplayError("no-secure-random", "no crypto");
      }),
    ).toThrow(PublicReplayError);
    // 바이트가 모자라도 조용히 짧은 id 를 내지 않는다.
    expect(() => generateReplayId(() => new Uint8Array(4))).toThrow(
      /난수 바이트/,
    );
  });

  it("서로 다른 난수는 서로 다른 id 가 된다", () => {
    const a = generateReplayId(() => new Uint8Array(26).fill(1));
    const b = generateReplayId(() => new Uint8Array(26).fill(2));
    expect(a).not.toBe(b);
  });

  it("공개 URL 은 로케일 접두사를 갖는다(설계 §7.2)", () => {
    expect(publicReplayUrl("rabc")).toBe("https://marblo.app/ko/replay/rabc");
    expect(publicReplayUrl("rabc", "en")).toBe(
      "https://marblo.app/en/replay/rabc",
    );
  });
});

describe("publishReplay — 저장되는 바이트", () => {
  it("소유권 문서를 먼저 쓰고, 공개 문서에는 serialized 바이트를 그대로 올린다", async () => {
    const rec = recorder();
    const redacted = makeRedacted();
    const ref = await publishReplay(
      { replay: makeReplay(), redacted, publisherUid: PUBLISHER_UID },
      rec.deps,
    );

    expect(rec.writes.map((w) => w.collection)).toEqual([
      PUBLIC_REPLAY_OWNERS_COLLECTION,
      PUBLIC_REPLAYS_COLLECTION,
    ]);
    expect(rec.writes[0].docId).toBe(ref.replayId);
    expect(rec.writes[1].docId).toBe(ref.replayId);

    const publicDoc = rec.writes[1].data as Record<string, unknown>;
    expect(publicDoc.payload).toBe(redacted.serialized);
    expect(publicDoc.status).toBe("published");
    expect(publicDoc.level).toBe("L2");
    expect(ref.url).toContain(ref.replayId);
  });

  it("★공개 문서에 내부 식별자가 하나도 없다 (projectId·missionId·uid)", async () => {
    const rec = recorder();
    await publishReplay(
      {
        replay: makeReplay(),
        redacted: makeRedacted(),
        publisherUid: PUBLISHER_UID,
      },
      rec.deps,
    );
    const serializedDoc = JSON.stringify(rec.writes[1].data);
    expect(serializedDoc).not.toContain(PROJECT_ID);
    expect(serializedDoc).not.toContain(MISSION_ID);
    expect(serializedDoc).not.toContain(PUBLISHER_UID);
    expect(Object.keys(rec.writes[1].data).sort()).toEqual([
      "level",
      "payload",
      "publishedAt",
      "replayVersion",
      "schemaVersion",
      "status",
    ]);
  });

  it("소유권 문서는 프로젝트·미션·발행자를 기록한다(룰의 write 판정 근거)", async () => {
    const rec = recorder();
    await publishReplay(
      {
        replay: makeReplay(),
        redacted: makeRedacted(),
        publisherUid: PUBLISHER_UID,
        includeCost: true,
      },
      rec.deps,
    );
    const owner = rec.writes[0].data as PublicReplayOwnerRecord;
    expect(owner.projectId).toBe(PROJECT_ID);
    expect(owner.missionId).toBe(MISSION_ID);
    expect(owner.publisherUid).toBe(PUBLISHER_UID);
    expect(owner.status).toBe("published");
    expect(owner.includeCost).toBe(true);
    expect(owner.unpublishedAt).toBeNull();
  });
});

describe("publishReplay — 미션 카드 이미지 첨부 (best-effort)", () => {
  const FAKE_PNG_BYTES = new Uint8Array([1, 2, 3, 4]);
  const FAKE_IMAGE_URL =
    "https://firebasestorage.googleapis.com/v0/b/marblo/o/public-replays%2Frzzz%2Fdeadbeef.png?alt=media";

  function cardDeps(rec: Recorder, overrides: Partial<PublicReplayDeps> = {}) {
    const uploadCalls: Array<{
      replayId: string;
      fileName: string;
      bytes: Uint8Array;
    }> = [];
    const deps: PublicReplayDeps = {
      ...rec.deps,
      async renderCardImage() {
        return new Blob([FAKE_PNG_BYTES], { type: "image/png" });
      },
      async hashCardImageBytes() {
        return "deadbeef";
      },
      async uploadCardImage(replayId, fileName, bytes) {
        uploadCalls.push({ replayId, fileName, bytes });
        return FAKE_IMAGE_URL;
      },
      ...overrides,
    };
    return { deps, uploadCalls };
  }

  it("카드 PNG 를 렌더·업로드하고 payload 에 card.imageUrl 을 얹는다", async () => {
    const rec = recorder();
    const { deps, uploadCalls } = cardDeps(rec);
    const redacted = makeRedacted();

    const ref = await publishReplay(
      { replay: makeReplay(), redacted, publisherUid: PUBLISHER_UID },
      deps,
    );

    expect(uploadCalls).toEqual([
      {
        replayId: ref.replayId,
        fileName: "deadbeef.png",
        bytes: FAKE_PNG_BYTES,
      },
    ]);

    const publicDoc = rec.writes[1].data as Record<string, unknown>;
    const payload = JSON.parse(publicDoc.payload as string);
    expect(payload.card).toEqual({ imageUrl: FAKE_IMAGE_URL });
    // 원본 payload 필드는 그대로 보존된다 — 얹기만 하고 덮지 않는다.
    expect(payload.goal).toBe("Ship the public replay layer");

    // 소유권 문서에 해제 시 지울 파일명이 기록된다.
    const cardImageUpdate = rec.updates.find(
      (u) => u.docId === ref.replayId && "cardImagePath" in u.data,
    );
    expect(cardImageUpdate?.data).toMatchObject({
      cardImagePath: "deadbeef.png",
    });
  });

  it("★uploadCardImage 가 없으면(테스트·미배포 환경) 카드 단계를 통째로 건너뛴다 — payload 는 원본 그대로", async () => {
    const rec = recorder();
    const redacted = makeRedacted();
    const ref = await publishReplay(
      { replay: makeReplay(), redacted, publisherUid: PUBLISHER_UID },
      rec.deps,
    );
    const publicDoc = rec.writes[1].data as Record<string, unknown>;
    expect(publicDoc.payload).toBe(redacted.serialized);
    const owner = rec.writes[0].data as PublicReplayOwnerRecord;
    expect(owner.cardImagePath).toBeNull();
    expect(rec.updates.find((u) => u.docId === ref.replayId)).toBeUndefined();
  });

  it("업로드가 실패해도 발행은 계속된다 — 카드 없이 기본 OG 로 발행", async () => {
    const rec = recorder();
    const { deps } = cardDeps(rec, {
      async uploadCardImage() {
        throw new Error("storage/unauthorized");
      },
    });
    const redacted = makeRedacted();
    const ref = await publishReplay(
      { replay: makeReplay(), redacted, publisherUid: PUBLISHER_UID },
      deps,
    );
    expect(ref.replayId).toBeTruthy();
    const publicDoc = rec.writes[1].data as Record<string, unknown>;
    expect(publicDoc.payload).toBe(redacted.serialized);
    const owner = rec.writes[0].data as PublicReplayOwnerRecord;
    expect(owner.cardImagePath).toBeNull();
  });

  it("렌더러가 실패해도 발행은 계속된다", async () => {
    const rec = recorder();
    const { deps } = cardDeps(rec, {
      async renderCardImage() {
        throw new Error("2D canvas context unavailable");
      },
    });
    const redacted = makeRedacted();
    await expect(
      publishReplay(
        { replay: makeReplay(), redacted, publisherUid: PUBLISHER_UID },
        deps,
      ),
    ).resolves.toMatchObject({ level: "L2" });
  });
});

describe("unpublishReplay — 카드 이미지 삭제", () => {
  it("저장된 cardImagePath 로 정확한 오브젝트만 지운다(list 없이)", async () => {
    const rec = recorder();
    const deleteCalls: Array<{ replayId: string; fileName: string }> = [];
    const deps: PublicReplayDeps = {
      ...rec.deps,
      async getDoc() {
        return {
          cardImagePath: "deadbeef.png",
        } as unknown as PublicReplayOwnerRecord;
      },
      async deleteCardImage(replayId, fileName) {
        deleteCalls.push({ replayId, fileName });
      },
    };
    await unpublishReplay("rzzz", deps);
    expect(deleteCalls).toEqual([
      { replayId: "rzzz", fileName: "deadbeef.png" },
    ]);
    expect(rec.deletes).toEqual([
      { collection: PUBLIC_REPLAYS_COLLECTION, docId: "rzzz" },
    ]);
  });

  it("카드 이미지가 없었으면 삭제를 시도하지 않는다", async () => {
    const rec = recorder();
    let deleteCardImageCalled = false;
    const deps: PublicReplayDeps = {
      ...rec.deps,
      async getDoc() {
        return { cardImagePath: null } as unknown as PublicReplayOwnerRecord;
      },
      async deleteCardImage() {
        deleteCardImageCalled = true;
      },
    };
    await unpublishReplay("rzzz", deps);
    expect(deleteCardImageCalled).toBe(false);
  });

  it("이미지 삭제가 실패해도 해제는 계속된다(상태는 unpublished 로 갱신)", async () => {
    const rec = recorder();
    const deps: PublicReplayDeps = {
      ...rec.deps,
      async getDoc() {
        return {
          cardImagePath: "deadbeef.png",
        } as unknown as PublicReplayOwnerRecord;
      },
      async deleteCardImage() {
        throw new Error("storage/object-not-found");
      },
    };
    await unpublishReplay("rzzz", deps);
    expect(rec.updates[0]).toMatchObject({
      collection: PUBLIC_REPLAY_OWNERS_COLLECTION,
      docId: "rzzz",
      data: { status: "unpublished" },
    });
  });

  it("deleteCardImage 가 없으면(테스트·미배포 환경) 카드 조회 자체를 생략한다", async () => {
    const rec = recorder();
    let getDocCalled = false;
    const deps: PublicReplayDeps = {
      ...rec.deps,
      async getDoc() {
        getDocCalled = true;
        return null;
      },
    };
    await unpublishReplay("rzzz", deps);
    expect(getDocCalled).toBe(false);
  });
});

describe("publishReplay — 중단 조건 (fail-closed)", () => {
  it("★2차 검증 실패는 발행 중단이다", async () => {
    const rec = recorder();
    await expect(
      publishReplay(
        {
          replay: makeReplay(),
          redacted: makeRedacted({ verified: false }),
          publisherUid: PUBLISHER_UID,
        },
        rec.deps,
      ),
    ).rejects.toMatchObject({ code: "not-verified" });
    expect(rec.writes).toHaveLength(0);
  });

  it("빈 payload 는 올라가지 않는다", async () => {
    const rec = recorder();
    await expect(
      publishReplay(
        {
          replay: makeReplay(),
          redacted: makeRedacted({ serialized: "" }),
          publisherUid: PUBLISHER_UID,
        },
        rec.deps,
      ),
    ).rejects.toMatchObject({ code: "empty-payload" });
    expect(rec.writes).toHaveLength(0);
  });

  it("★상한 초과 payload 는 중단되고, 에러에 원문이 실리지 않는다(F7)", async () => {
    const rec = recorder();
    const secret = "sk-ant-supersecretvaluethatmustnotleak";
    const huge = secret + "x".repeat(PUBLIC_REPLAY_MAX_PAYLOAD_CHARS);
    let captured: unknown;
    try {
      await publishReplay(
        {
          replay: makeReplay(),
          redacted: makeRedacted({ serialized: huge }),
          publisherUid: PUBLISHER_UID,
        },
        rec.deps,
      );
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(PublicReplayError);
    const failure = captured as InstanceType<typeof PublicReplayError>;
    expect(failure.code).toBe("payload-too-large");
    expect(failure.message).not.toContain(secret);
    expect(rec.writes).toHaveLength(0);
  });

  it("미완료 미션은 기본 후보가 아니다(Q1) — 명시 선택 시에만 통과", async () => {
    const rec = recorder();
    const incomplete = makeReplay({ completedAt: null });
    await expect(
      publishReplay(
        {
          replay: incomplete,
          redacted: makeRedacted(),
          publisherUid: PUBLISHER_UID,
        },
        rec.deps,
      ),
    ).rejects.toMatchObject({ code: "not-completed" });

    await expect(
      publishReplay(
        {
          replay: incomplete,
          redacted: makeRedacted(),
          publisherUid: PUBLISHER_UID,
          includeIncomplete: true,
        },
        rec.deps,
      ),
    ).resolves.toBeTruthy();
  });

  it("발행자 uid 가 없으면 중단한다", async () => {
    const rec = recorder();
    await expect(
      publishReplay(
        { replay: makeReplay(), redacted: makeRedacted(), publisherUid: "" },
        rec.deps,
      ),
    ).rejects.toMatchObject({ code: "missing-publisher" });
    expect(rec.writes).toHaveLength(0);
  });

  it("★공개 문서 write 가 실패하면 소유권을 unpublished 로 되돌린다", async () => {
    const rec = recorder({ failPublicWrite: true });
    await expect(
      publishReplay(
        {
          replay: makeReplay(),
          redacted: makeRedacted(),
          publisherUid: PUBLISHER_UID,
        },
        rec.deps,
      ),
    ).rejects.toThrow();
    expect(rec.updates).toHaveLength(1);
    expect(rec.updates[0].collection).toBe(PUBLIC_REPLAY_OWNERS_COLLECTION);
    expect(rec.updates[0].data).toMatchObject({ status: "unpublished" });
  });
});

describe("unpublishReplay", () => {
  it("★공개 문서를 먼저 지운 뒤 소유권 상태를 갱신한다", async () => {
    const rec = recorder();
    await unpublishReplay("rzzz", rec.deps);
    expect(rec.deletes).toEqual([
      { collection: PUBLIC_REPLAYS_COLLECTION, docId: "rzzz" },
    ]);
    expect(rec.updates[0]).toMatchObject({
      collection: PUBLIC_REPLAY_OWNERS_COLLECTION,
      docId: "rzzz",
      data: { status: "unpublished", unpublishedAt: NOW },
    });
  });
});

describe("조회", () => {
  const rows: PublicReplayOwnerRecord[] = [
    {
      replayId: "r-old",
      projectId: PROJECT_ID,
      missionId: MISSION_ID,
      publisherUid: PUBLISHER_UID,
      level: "L1",
      includeCost: false,
      status: "unpublished",
      publishedAt: new Date("2026-07-01T00:00:00Z"),
      unpublishedAt: new Date("2026-07-02T00:00:00Z"),
    },
    {
      replayId: "r-live",
      projectId: PROJECT_ID,
      missionId: MISSION_ID,
      publisherUid: PUBLISHER_UID,
      level: "L2",
      includeCost: false,
      status: "published",
      publishedAt: new Date("2026-08-01T00:00:00Z"),
      unpublishedAt: null,
    },
  ];

  function readDeps(): PublicReplayDeps {
    const rec = recorder();
    return {
      ...rec.deps,
      async queryDocs<T>() {
        return rows as unknown as T[];
      },
      async getDoc<T>() {
        return {
          schemaVersion: 1,
          replayVersion: 1,
          level: "L2",
          status: "unpublished",
          payload: "{}",
          publishedAt: NOW,
        } as unknown as T;
      },
    };
  }

  it("미션의 현재 발행본만 돌려준다(해제분은 제외)", async () => {
    const found = await getMissionPublication(
      PROJECT_ID,
      MISSION_ID,
      readDeps(),
    );
    expect(found?.replayId).toBe("r-live");
  });

  it("프로젝트 발행 이력은 해제분까지 보여준다(캐시 잔존 사실을 계속 말해야 한다)", async () => {
    const all = await listProjectPublications(PROJECT_ID, readDeps());
    expect(all).toHaveLength(2);
  });

  it("★status 가 published 가 아니면 공개 문서를 못 읽은 것으로 접는다", async () => {
    expect(await getPublicReplay("rzzz", readDeps())).toBeNull();
  });
});

describe("publishGateState — 발행 게이트 (순수)", () => {
  const ok = {
    verified: true,
    canPublish: true,
    isCompletedMission: true,
    level: "L2" as const,
    l3Acknowledged: false,
  };

  it("L2 는 확인 다이얼로그 한 번으로 발행할 수 있다", () => {
    expect(publishGateState(ok)).toEqual({
      canOpen: true,
      canConfirm: true,
      reason: null,
    });
  });

  it("★L3 는 확인 없이는 실행되지 않는다 — 다이얼로그까지만 열린다(§5.3)", () => {
    const pending = publishGateState({ ...ok, level: "L3" });
    expect(pending.canOpen).toBe(true);
    expect(pending.canConfirm).toBe(false);

    const acknowledged = publishGateState({
      ...ok,
      level: "L3",
      l3Acknowledged: true,
    });
    expect(acknowledged.canConfirm).toBe(true);
  });

  it("검증 실패는 권한·등급보다 먼저 막는다(보안이 우선순위 최상단)", () => {
    const blocked = publishGateState({
      ...ok,
      verified: false,
      level: "L3",
      l3Acknowledged: true,
    });
    expect(blocked.canOpen).toBe(false);
    expect(blocked.reason).toContain("2차 검증");
  });

  it("권한 없음·미완료 미션도 각각의 이유로 막는다", () => {
    expect(publishGateState({ ...ok, canPublish: false }).reason).toContain(
      "소유자·관리자",
    );
    expect(
      publishGateState({ ...ok, isCompletedMission: false }).reason,
    ).toContain("완료된 미션");
  });
});

describe("ReplayPublishPanel — 되돌릴 수 없음을 말하는 UI", () => {
  const base = {
    redacted: makeRedacted(),
    canPublish: true,
  };

  it("★발행 전부터 캐시 잔존을 경고한다(해제 다이얼로그까지 미루지 않는다)", () => {
    const markup = renderToStaticMarkup(
      createElement(ReplayPublishPanel, base),
    );
    expect(markup).toContain("공개는 되돌릴 수 없습니다");
    expect(markup).toContain("검색 인덱스");
    expect(markup).toContain("공개 URL 발행");
  });

  it("2차 검증 실패면 발행 버튼이 잠긴다", () => {
    const markup = renderToStaticMarkup(
      createElement(ReplayPublishPanel, {
        ...base,
        redacted: makeRedacted({ verified: false }),
      }),
    );
    expect(markup).toContain("독립 2차 검증에 실패");
    expect(markup).toMatch(/공개 URL 발행<\/button>/);
    expect(markup).toContain("disabled");
  });

  it("owner/admin 이 아니면 발행 버튼이 잠긴다(Q4)", () => {
    const markup = renderToStaticMarkup(
      createElement(ReplayPublishPanel, { ...base, canPublish: false }),
    );
    expect(markup).toContain("소유자·관리자");
    expect(markup).toContain("disabled");
  });

  it("발행된 상태에서는 URL 과 해제 버튼을 보여준다", () => {
    const markup = renderToStaticMarkup(
      createElement(ReplayPublishPanel, {
        ...base,
        publication: {
          replayId: "rabc",
          level: "L2" as const,
          url: "https://marblo.app/ko/replay/rabc",
          publishedAt: NOW,
        },
      }),
    );
    expect(markup).toContain("https://marblo.app/ko/replay/rabc");
    expect(markup).toContain("발행 해제");
  });
});

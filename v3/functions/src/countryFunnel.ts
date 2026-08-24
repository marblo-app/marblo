// 국가·채널 퍼널 — 순수 로직(BQ/Firestore 무의존). node --test 로 단위검증한다
// (adminAnalytics.ts / marketingContacts.ts 와 동일 규약).
//
// 무엇을 계산하나: **유입국가·채널 → 방문 → 다운로드 → 설치 → 모델연결 → 10분
// 첫 multi-agent 성공** 을 한 줄로 잇는다. 조인키는 익명 GA4 client_id 하나이며
// Firebase uid 는 **어디에도 쓰이지 않는다**(티켓 rPVkmOKG + woXp2c70).
//
// ★리전 블로커(#901 §2)를 어떻게 넘겼나:
//   GA4 export 는 `asia-northeast3`, 앱 텔레메트리는 `US` 라 **한 쿼리로는**
//   조인할 수 없다. 그래서 조인을 SQL 이 아니라 **여기(애플리케이션 층)** 에서
//   한다 — 호출부가 두 리전에 각각 쿼리를 던지고 그 결과를 이 모듈이 합친다.
//   데이터셋 복제/전송(Data Transfer)을 세팅하지 않고도 오늘 돌아간다는 게
//   핵심이며, 대신 **규모 상한**이 있다(§webVisitorLimit). 상한을 넘기면
//   #901 §2-3 의 스케줄 쿼리 + Dataset Copy 로 승급한다.
//
// ★비식별: 이 모듈이 다루는 식별자는 GA4 client_id(user_pseudo_id)와 앱 설치
//   ID 둘 다 **익명 수도아이디**다. 이메일·uid·IP 는 입력에도 출력에도 없다.

import {
  classifyBotTraffic,
  suspectedVisitorLookup,
  type BotTrafficVerdict,
  type FingerprintVisitorRow,
} from "./botTraffic";

// ── 입력 행 ──────────────────────────────────────────────────────────────────

/** GA4(서울) 한 방문자(=user_pseudo_id) 요약. */
export interface WebVisitorRow {
  /** GA4 user_pseudo_id == 브라우저 `_ga` 쿠키의 client_id. */
  gaClientId: unknown;
  country: unknown;
  source: unknown;
  medium: unknown;
  campaign: unknown;
  /** 이 방문자의 `download` 이벤트 수. */
  downloads: unknown;
  /**
   * ★봇 지문 3축 — GA4 `device.category` / `device.web_info.browser` /
   * `device.operating_system`. 없으면 그 방문자는 **판정 불능 = 무죄**다
   * (botTraffic.trafficFingerprint). 옵셔널인 이유는 구버전 호출부(이 컬럼을
   * 아직 안 셀렉트하는 쿼리)가 컴파일은 되게 하되 봇 판정만 조용히 비활성화
   * 되도록 하기 위해서다 — 그 상태는 `suspectedTraffic.totals` 가 0 으로 드러난다.
   */
  deviceCategory?: unknown;
  browser?: unknown;
  operatingSystem?: unknown;
}

/** 앱(US) 한 설치 요약 — 어트리뷰션 링크백 + 활성화 마일스톤. */
export interface InstallRow {
  /** 앱의 익명 설치 ID(telemetry events.userId). */
  installId: unknown;
  /** 링크백으로 받은 GA4 client_id. 없을 수 있다(광고차단/링크백 실패). */
  gaClientId: unknown;
  /** 링크백이 실어 온 first-touch utm — 웹 조인이 실패했을 때의 폴백 채널. */
  utmSource: unknown;
  utmMedium: unknown;
  utmCampaign: unknown;
  referrerHost: unknown;
  /** 각 마일스톤 도달 여부(도달했으면 truthy — 시각이든 1이든 상관없다). */
  firstRun: unknown;
  modelConnected: unknown;
  /** 연결 후 10분 창 안에 첫 multi-agent 성공. */
  within10m: unknown;
}

// ── 정규화 ───────────────────────────────────────────────────────────────────

export const UNKNOWN_COUNTRY = "(unknown)";
export const DIRECT_SOURCE = "(direct)";
export const NONE_MEDIUM = "(none)";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * 국가 라벨. GA4 geo.country 가 정본이고(#901 §7-4), 비어 있으면 지어내지 않고
 * `(unknown)` 으로 남긴다 — 앱 로케일/타임존으로 추정해 채우면 재외 한국인이
 * 전부 KR 로 잡히는 그 오류를 데이터에 새겨 넣게 된다.
 */
export function normalizeCountry(raw: unknown): string {
  const v = str(raw);
  return v.length > 0 ? v : UNKNOWN_COUNTRY;
}

/** 채널 키/라벨. GA4 의 `(direct)` / `(none)` 관례를 그대로 쓴다. */
export function normalizeChannel(input: { source: unknown; medium: unknown }): {
  key: string;
  source: string;
  medium: string;
} {
  const source = str(input.source) || DIRECT_SOURCE;
  const medium = str(input.medium) || NONE_MEDIUM;
  return { key: `${source} / ${medium}`, source, medium };
}

/**
 * 링크백 utm 만 있고 GA4 조인이 안 된 설치의 채널. referrer 호스트를 medium
 * `referral` 로 승격시켜 GA4 쪽 표기와 어휘를 맞춘다.
 */
export function channelFromInstall(row: InstallRow): {
  key: string;
  source: string;
  medium: string;
} {
  const utmSource = str(row.utmSource);
  if (utmSource) {
    return normalizeChannel({ source: utmSource, medium: row.utmMedium });
  }
  const ref = str(row.referrerHost);
  if (ref) return normalizeChannel({ source: ref, medium: "referral" });
  return normalizeChannel({ source: "", medium: "" });
}

// ── 출력 행 ──────────────────────────────────────────────────────────────────

export interface FunnelRow {
  key: string;
  label: string;
  /** 채널 행에만 채워진다. */
  source?: string;
  medium?: string;
  /**
   * ★의심을 **뺀** 방문. 뺀 값은 버려지지 않고 `suspectedVisitors` 로 옆에
   * 남는다(botTraffic 머리말 ③). 원본 방문은 `observedVisitors`.
   */
  visitors: number;
  /** 단일지문 집중 유입으로 판정된 방문 — 삭제하지 않고 따로 센다. */
  suspectedVisitors: number;
  /** `visitors + suspectedVisitors`. GA4 원본과 대조할 때 쓰는 값. */
  observedVisitors: number;
  downloads: number;
  installs: number;
  connected: number;
  activated10m: number;
  /** 각 단계 전환율. 분모 0 이면 null(0% 와 구분한다 — "없음"과 "실패"는 다르다). */
  downloadRate: number | null;
  installRate: number | null;
  connectRate: number | null;
  activationRate: number | null;
  /**
   * ★단조성 위반 표시. 설치 수가 다운로드 수보다 많은 버킷 — 조회창 밖에서
   * 다운로드했거나 GA4 조인이 실패한 설치가 섞였다는 뜻이다. 조용히 깎지 않고
   * 드러낸다(깎으면 채널 성과를 체계적으로 왜곡한다).
   */
  anomaly: boolean;
}

export interface CountryFunnelResult {
  /** 표의 기본 분모가 방문이 아니라는 사실을 응답에 실어 둔다. */
  primaryDenominator: typeof FUNNEL_PRIMARY_DENOMINATOR;
  /**
   * ★봇 판정문. **파생**이다 — 원장에 굽지 않고 매 조회마다 다시 계산된다.
   * 규칙 임계값(`rule`)도 같이 실려 화면이 "왜 의심인지"를 말할 수 있다.
   */
  suspectedTraffic: BotTrafficVerdict;
  byCountry: FunnelRow[];
  byChannel: FunnelRow[];
  totals: FunnelRow;
  coverage: {
    /** 조회창 안의 총 설치(링크백 여부 무관 — 앱 events 기준). */
    installs: number;
    /** 링크백으로 GA4 client_id 를 받은 설치. */
    withGaClientId: number;
    /** 그중 실제로 GA4 방문자 행과 매칭된 설치. */
    matchedToWeb: number;
    /** matchedToWeb / installs. 설치 0 이면 null. */
    matchRate: number | null;
  };
  notes: string[];
}

function emptyRow(key: string, label: string): FunnelRow {
  return {
    key,
    label,
    visitors: 0,
    suspectedVisitors: 0,
    observedVisitors: 0,
    downloads: 0,
    installs: 0,
    connected: 0,
    activated10m: 0,
    downloadRate: null,
    installRate: null,
    connectRate: null,
    activationRate: null,
    anomaly: false,
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function finalize(row: FunnelRow): FunnelRow {
  row.observedVisitors = row.visitors + row.suspectedVisitors;
  // 방문 분모는 **의심을 뺀** 방문이다. 의심을 넣으면 다운로드율이 봇 수만큼
  // 희석돼 해외 채널이 실제보다 나쁘게 읽힌다 — 그게 이 티켓의 출발점이었다.
  row.downloadRate = ratio(row.downloads, row.visitors);
  row.installRate = ratio(row.installs, row.downloads);
  row.connectRate = ratio(row.connected, row.installs);
  row.activationRate = ratio(row.activated10m, row.connected);
  row.anomaly = row.installs > row.downloads;
  return row;
}

/**
 * ★정렬(=표의 기본 축)은 **설치 → 다운로드 → 방문** 순이다. 방문을 먼저 두면
 * 봇 코호트가 표 맨 위에 앉아 눈에 가장 먼저 들어온다 — 실측에서 Iran 106명이
 * 전체 2위였다. 라벨 사전순은 마지막 타이브레이커(안정 정렬).
 */
function compareRows(a: FunnelRow, b: FunnelRow): number {
  return (
    b.installs - a.installs ||
    b.downloads - a.downloads ||
    b.visitors - a.visitors ||
    a.key.localeCompare(b.key)
  );
}

/**
 * ★채널·CAC 표의 기본 분모. 방문이 아니라 다운로드다.
 *
 * 봇은 Electron 데스크톱을 내려받아 설치하고 실행하지 않는다. 그래서 이 분모를
 * 쓰는 순간 아래 지문 규칙이 하나도 없어도 봇은 이미 0으로 센다 — 공짜이고
 * 규칙이 필요 없는 가장 강한 필터다(botTraffic 머리말 ①).
 */
export const FUNNEL_PRIMARY_DENOMINATOR = "downloads" as const;

/**
 * 두 리전의 결과를 메모리에서 조인해 국가·채널 퍼널을 만든다.
 *
 * @param webVisitors GA4(서울) 방문자 요약. 비어 있으면 방문/다운로드 칸이 0 이
 *   되고 설치 이후 칸만 채워진다 — 브릿지가 없을 때의 정직한 부분 응답이다.
 * @param installs 앱(US) 설치 요약.
 */
export function buildCountryFunnel(
  webVisitors: readonly WebVisitorRow[],
  installs: readonly InstallRow[]
): CountryFunnelResult {
  // ── 0) 봇 판정 — 집계보다 **먼저** 돌린다. 판정 자체는 파생이고 입력을
  //    변형하지 않는다(botTraffic.ts). 지문 컬럼이 없는 구버전 쿼리에서는
  //    판정풀이 비어 아무도 의심이 되지 않는다 — 조용한 오탐이 아니라 0이다.
  const suspectedTraffic = classifyBotTraffic(
    webVisitors as readonly FingerprintVisitorRow[]
  );
  const isSuspected = suspectedVisitorLookup(suspectedTraffic);

  const byGaId = new Map<string, WebVisitorRow>();
  for (const w of webVisitors) {
    const id = str(w.gaClientId);
    if (id) byGaId.set(id, w);
  }

  const countries = new Map<string, FunnelRow>();
  const channels = new Map<string, FunnelRow>();
  const totals = emptyRow("__total__", "전체");

  const country = (key: string): FunnelRow => {
    let row = countries.get(key);
    if (!row) {
      row = emptyRow(key, key);
      countries.set(key, row);
    }
    return row;
  };
  const channel = (c: {
    key: string;
    source: string;
    medium: string;
  }): FunnelRow => {
    let row = channels.get(c.key);
    if (!row) {
      row = { ...emptyRow(c.key, c.key), source: c.source, medium: c.medium };
      channels.set(c.key, row);
    }
    return row;
  };

  // 1) 웹측 — 방문/다운로드 분모. 조인 없이도 항상 나오는 값이다(#901 §7-1).
  for (const w of webVisitors) {
    const downloads = num(w.downloads);
    const c = country(normalizeCountry(w.country));
    const ch = channel(
      normalizeChannel({ source: w.source, medium: w.medium })
    );
    // ★의심은 **다른 칸으로 옮길 뿐 버리지 않는다**. 다운로드는 어느 쪽이든
    //   그대로 더한다 — 의심 방문자의 다운로드는 정의상 0 이라 값이 변하지
    //   않지만, 만약 0 이 아니게 되면 그건 판정이 틀렸다는 신호여야 한다.
    if (isSuspected(w)) {
      c.suspectedVisitors += 1;
      ch.suspectedVisitors += 1;
      totals.suspectedVisitors += 1;
    } else {
      c.visitors += 1;
      ch.visitors += 1;
      totals.visitors += 1;
    }
    c.downloads += downloads;
    ch.downloads += downloads;
    totals.downloads += downloads;
  }

  // 2) 앱측 — 설치 이후 단계. 버킷은 GA4 조인이 되면 웹 값, 아니면 링크백 utm.
  let withGaClientId = 0;
  let matchedToWeb = 0;
  for (const inst of installs) {
    const gaId = str(inst.gaClientId);
    if (gaId) withGaClientId += 1;
    const web = gaId ? byGaId.get(gaId) : undefined;
    if (web) matchedToWeb += 1;

    const countryKey = web ? normalizeCountry(web.country) : UNKNOWN_COUNTRY;
    const channelKey = web
      ? normalizeChannel({ source: web.source, medium: web.medium })
      : channelFromInstall(inst);

    const c = country(countryKey);
    const ch = channel(channelKey);
    const connected = inst.modelConnected ? 1 : 0;
    const activated = inst.within10m ? 1 : 0;

    c.installs += 1;
    c.connected += connected;
    c.activated10m += activated;
    ch.installs += 1;
    ch.connected += connected;
    ch.activated10m += activated;
    totals.installs += 1;
    totals.connected += connected;
    totals.activated10m += activated;
  }

  const notes: string[] = [...suspectedTraffic.notes];
  if (webVisitors.length === 0) {
    notes.push(
      "GA4(서울) 방문 데이터가 비어 있다 — 방문·다운로드 칸은 0 이고 설치 이후 칸만 유효하다."
    );
  }
  if (installs.length > 0 && matchedToWeb === 0) {
    notes.push(
      "GA4 client_id 로 매칭된 설치가 0 이다 — 링크백(앱 최초 실행 → marblo.app/link)이 아직 도달하지 않았거나 조회창이 어긋났다. 국가는 (unknown) 으로만 집계된다."
    );
  }

  return {
    primaryDenominator: FUNNEL_PRIMARY_DENOMINATOR,
    suspectedTraffic,
    byCountry: Array.from(countries.values()).map(finalize).sort(compareRows),
    byChannel: Array.from(channels.values()).map(finalize).sort(compareRows),
    totals: finalize(totals),
    coverage: {
      installs: installs.length,
      withGaClientId,
      matchedToWeb,
      matchRate: ratio(matchedToWeb, installs.length),
    },
    notes,
  };
}

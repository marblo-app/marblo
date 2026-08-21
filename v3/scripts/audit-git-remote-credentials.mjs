/**
 * Firestore `projects.gitRemoteUrl` / `invitations.gitRemoteUrl` 에 남은
 * **크레덴셜 오염** 조사 + 정화 (티켓 d0d0JkRd1SeGTxVRx4nQ, P0 보안).
 *
 * 왜 필요한가: clone 이 `https://oauth2:<token>@github.com/...` 를 쓰던 시절
 * 그 URL 이 `.git/config` → IPC → Firestore 까지 실려 갔다. `projects` 문서는
 * **팀 전원이 읽으므로** 한 명의 개인 토큰이 팀 전체에 노출된다. 코드를
 * 고쳐도 **이미 들어간 값은 그대로 남는다** — 그걸 세고 지우는 도구다.
 *
 * ★출력 규약 — 크레덴셜 값을 절대 찍지 않는다. 문서 id, 건수, "userinfo 가
 * 있다/없다", 정화 후 호스트+경로만 남긴다. 리포트를 그대로 티켓/PR 에
 * 붙여도 안전해야 한다.
 *
 * 사용법 (v3/ 에서):
 *   조회:  node scripts/audit-git-remote-credentials.mjs
 *   조회(+repo 주소):  node scripts/audit-git-remote-credentials.mjs --show-repo
 *   정화:  node scripts/audit-git-remote-credentials.mjs --apply   ← ★승인 후에만
 *
 * 인증: backfill-project-members.mjs 와 동일 — GOOGLE_OAUTH_ACCESS_TOKEN 또는
 * gcloud ADC/user auth.
 *   gcloud auth application-default login
 */
import { execFileSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
// ★기본 출력에는 repo 주소도 싣지 않는다 — 티켓/PR 에 그대로 붙여도 되게
// 건수·문서 id 만 남긴다. 어느 팀에 재발급을 안내할지 정할 때만 켠다.
const SHOW_REPO = process.argv.includes("--show-repo");
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";
const PAGE_SIZE = 300;
/**
 * 검사 대상 — 컬렉션과 그 안의 remote URL 필드 경로.
 * `missions.targetRepository.repoUrl` 은 connection-store 의 repoUrl(로컬
 * git origin 도출값)이 그대로 실리므로 같은 오염 경로를 탄다.
 */
const TARGETS = [
  { collection: "projects", field: "gitRemoteUrl" },
  { collection: "invitations", field: "gitRemoteUrl" },
  { collection: "missions", field: "targetRepository.repoUrl" },
];

// ─── 크레덴셜 판정 — electron/git-url-safety.ts 와 같은 규칙 ─────────────
// (이 스크립트는 빌드 없이 도는 .mjs 라 TS 모듈을 직접 import 하지 않는다.
//  규칙이 바뀌면 두 곳을 같이 고친다: SCHEMED/SCP_LIKE 와 secret 판정.)
const SCHEMED = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#]*)([\s\S]*)$/;
const SCP_LIKE = /^([^/@\s]+)@([^:/\s]+):([\s\S]+)$/;

function inspect(url) {
  if (typeof url !== "string") return { present: false, secret: false };
  const s = url.trim();
  if (!s) return { present: false, secret: false };

  const schemed = s.match(SCHEMED);
  if (schemed) {
    const at = schemed[2].lastIndexOf("@");
    if (at < 0) return { present: false, secret: false };
    const isSsh = schemed[1].toLowerCase() === "ssh://";
    return {
      present: true,
      secret: isSsh ? schemed[2].slice(0, at).includes(":") : true,
    };
  }
  const scp = s.match(SCP_LIKE);
  if (scp) return { present: true, secret: scp[1].includes(":") };
  return { present: false, secret: false };
}

function strip(url) {
  const s = String(url);
  const schemed = s.match(SCHEMED);
  if (schemed) {
    const [, scheme, authority, rest] = schemed;
    const at = authority.lastIndexOf("@");
    if (at < 0) return s;
    const hostport = authority.slice(at + 1);
    if (scheme.toLowerCase() === "ssh://") {
      const user = authority.slice(0, at).split(":")[0];
      return user
        ? `${scheme}${user}@${hostport}${rest}`
        : `${scheme}${hostport}${rest}`;
    }
    return `${scheme}${hostport}${rest}`;
  }
  const scp = s.match(SCP_LIKE);
  if (scp) {
    const user = scp[1].split(":")[0];
    return user ? `${user}@${scp[2]}:${scp[3]}` : `${scp[2]}:${scp[3]}`;
  }
  return s;
}

/**
 * userinfo 의 "모양"만 분류한다 — ★값은 절대 돌려주지 않는다.
 * 재발급이 필요한 진짜 크레덴셜인지(비밀번호/토큰) 아니면 단순 계정명인지를
 * 값을 보지 않고 판단하기 위한 최소 정보다.
 */
const GITHUB_TOKEN_PREFIXES = [
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "ghr_",
  "github_pat_",
];

function classifyUserinfo(url) {
  const schemed = String(url).trim().match(SCHEMED);
  if (!schemed) return { hasPassword: false, looksLikeToken: false };
  const at = schemed[2].lastIndexOf("@");
  if (at < 0) return { hasPassword: false, looksLikeToken: false };
  const userinfo = schemed[2].slice(0, at);
  const colon = userinfo.indexOf(":");
  const username = colon < 0 ? userinfo : userinfo.slice(0, colon);
  const password = colon < 0 ? "" : userinfo.slice(colon + 1);
  const candidate = password || username;
  const lower = candidate.toLowerCase();
  const prefixMatch = GITHUB_TOKEN_PREFIXES.some((p) => lower.startsWith(p));
  return {
    hasPassword: colon >= 0 && password.length > 0,
    // ★"토큰 접두사가 맞았다" 와 "계정명이라기엔 너무 길다" 를 구분해 남긴다 —
    // 재발급 긴급도가 다르다. 값이 아니라 길이/접두사 여부만 기록한다.
    tokenPrefix: prefixMatch,
    credentialLength: candidate.length,
    looksLikeToken: prefixMatch || candidate.length >= 30,
  };
}

/** 기계가 박은 크레덴셜인가 — 재발급 안내 대상 판별에 쓴다. */
function isAppInjected(url) {
  const schemed = String(url).trim().match(SCHEMED);
  if (!schemed) return false;
  const scheme = schemed[1].toLowerCase();
  if (scheme !== "https://" && scheme !== "http://") return false;
  const at = schemed[2].lastIndexOf("@");
  if (at < 0) return false;
  const username = schemed[2].slice(0, at).split(":")[0].toLowerCase();
  return username === "oauth2" || username === "x-access-token";
}

// ─── Firestore REST ────────────────────────────────────────────────────
function getProjectId() {
  const fromEnv =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT;
  if (fromEnv) return fromEnv;
  try {
    return (
      execFileSync("gcloud", ["config", "get-value", "project"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

function getAccessToken() {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) {
    return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  }
  for (const args of [
    ["auth", "application-default", "print-access-token"],
    ["auth", "print-access-token"],
  ]) {
    try {
      const token = execFileSync("gcloud", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (token) return token;
    } catch {
      // 다음 인증 소스를 시도한다.
    }
  }
  return null;
}

function documentUrl(projectId, documentPath) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId,
  )}/databases/${encodeURIComponent(DATABASE_ID)}/documents/${documentPath}`;
}

async function fetchJson(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firestore REST ${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

async function listDocuments(projectId, token, collection) {
  const docs = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);
    const url = `${documentUrl(projectId, collection)}?${params.toString()}`;
    const json = await fetchJson(url, token);
    docs.push(...(json.documents || []));
    pageToken = json.nextPageToken || "";
  } while (pageToken);
  return docs;
}

/**
 * 오염된 필드 하나만 정화한다. updateMask 로 그 필드만 짚으므로 문서의 다른
 * 값은 건드리지 않는다. 중첩 필드는 부모 map 을 통째로 덮으면 형제 키가
 * 날아가므로 `a.b` 경로 그대로 마스크에 넣고 같은 모양으로 보낸다.
 *
 * ★updatedAt 은 건드리지 않는다 — 정화는 사용자 활동이 아니고, 그 필드로
 * 도는 지표(최근 활동 프로젝트)를 오염시키면 안 된다.
 */
function nestedFieldPayload(fieldPath, cleanUrl) {
  const parts = fieldPath.split(".");
  let value = { stringValue: cleanUrl };
  for (let i = parts.length - 1; i > 0; i -= 1) {
    value = { mapValue: { fields: { [parts[i]]: value } } };
  }
  return { [parts[0]]: value };
}

async function patchRemoteUrl(
  projectId,
  token,
  collection,
  id,
  field,
  cleanUrl,
  updateTime,
) {
  const url = new URL(documentUrl(projectId, `${collection}/${id}`));
  url.searchParams.append("updateMask.fieldPaths", field);
  // ★스캔 시점 이후 문서가 바뀌었으면 서버가 FAILED_PRECONDITION 으로 거절한다.
  // updateTime 을 못 얻은 경우에만 "존재하기만 하면" 으로 물러선다.
  if (updateTime) {
    url.searchParams.set("currentDocument.updateTime", updateTime);
  } else {
    url.searchParams.set("currentDocument.exists", "true");
  }
  await fetchJson(url.toString(), token, {
    method: "PATCH",
    body: JSON.stringify({ fields: nestedFieldPayload(field, cleanUrl) }),
  });
}

function docId(name) {
  return name.split("/").at(-1) || name;
}

/** 중첩 필드 경로(`a.b.c`)에서 stringValue 를 꺼낸다. 없으면 null. */
function readStringField(doc, fieldPath) {
  const parts = fieldPath.split(".");
  let node = doc.fields;
  for (let i = 0; i < parts.length - 1; i += 1) {
    node = node?.[parts[i]]?.mapValue?.fields;
    if (!node) return null;
  }
  const leaf = node?.[parts[parts.length - 1]]?.stringValue;
  return typeof leaf === "string" ? leaf : null;
}

function scan(docs, collection, field) {
  const rows = [];
  let withUrl = 0;
  for (const doc of docs) {
    const raw = readStringField(doc, field);
    if (typeof raw !== "string" || !raw) continue;
    withUrl += 1;
    const info = inspect(raw);
    if (!info.secret) continue;
    const clean = strip(raw);
    rows.push({
      collection,
      field,
      id: docId(doc.name),
      // ★낙관적 락 — 스캔과 PATCH 사이에 누가 이 문서를 바꿨으면 쓰지 않는다.
      // "예상과 다른 값을 덮지 않는다" 를 서버가 보장하게 한다.
      updateTime: doc.updateTime ?? null,
      // ★값이 아니라 "정화 후" 만 남긴다. 호스트/경로는 비밀이 아니고
      // 어느 팀에 알려야 하는지 판단하는 데 필요하다.
      cleanUrl: clean,
      appInjected: isAppInjected(raw),
      ...classifyUserinfo(raw),
      ownerId: doc.fields?.ownerId?.stringValue ?? null,
      memberCount: doc.fields?.members?.arrayValue?.values?.length ?? 0,
    });
  }
  return { total: docs.length, withUrl, rows };
}

async function main() {
  const projectId = getProjectId();
  if (!projectId) {
    throw new Error(
      "Firebase project id 를 못 찾았다. FIREBASE_PROJECT_ID 를 주거나 gcloud project 를 설정하라.",
    );
  }
  const token = getAccessToken();
  if (!token) {
    throw new Error(
      "관리자 OAuth 토큰이 없다. GOOGLE_OAUTH_ACCESS_TOKEN 또는 gcloud auth application-default login.",
    );
  }

  console.log(`Firebase project: ${projectId} (db ${DATABASE_ID})`);
  const findings = [];
  for (const { collection, field } of TARGETS) {
    const docs = await listDocuments(projectId, token, collection);
    const { total, withUrl, rows } = scan(docs, collection, field);
    console.log(
      `\n[${collection}.${field}] scanned=${total} withUrl=${withUrl} contaminated=${rows.length}`,
    );
    for (const row of rows) {
      console.log(
        `  ${row.id}  appInjected=${row.appInjected}` +
          `  hasPassword=${row.hasPassword}  tokenPrefix=${row.tokenPrefix}` +
          `  credLen=${row.credentialLength}` +
          (collection === "projects"
            ? `  owner=${row.ownerId ?? "?"}  members=${row.memberCount}`
            : "") +
          (SHOW_REPO ? `  repo=${row.cleanUrl}` : ""),
      );
    }
    findings.push(...rows);
  }

  console.log(`\nTOTAL contaminated docs: ${findings.length}`);
  if (findings.length === 0) {
    console.log("정화할 문서가 없다.");
    return;
  }

  if (!APPLY) {
    console.log(
      "\nDRY RUN — 아무것도 쓰지 않았다. ★사장님/오케 승인 후에만 --apply 로 실행한다.",
    );
    console.log(
      "노출된 크레덴셜은 정화만으로 끝나지 않는다 — 해당 사용자에게 토큰 폐기·재발급을 안내해야 한다.",
    );
    return;
  }

  for (const row of findings) {
    await patchRemoteUrl(
      projectId,
      token,
      row.collection,
      row.id,
      row.field,
      row.cleanUrl,
      row.updateTime,
    );
    // ★"실행했다" 가 아니라 "없어졌다" 를 확인한다 — 쓰기 직후 재조회.
    const after = await fetchJson(
      documentUrl(projectId, `${row.collection}/${row.id}`),
      token,
    );
    const verdict = inspect(readStringField(after, row.field));
    console.log(
      `  cleaned ${row.collection}/${row.id} (${row.field}) ` +
        `verify: userinfo=${verdict.present} secret=${verdict.secret}`,
    );
    if (verdict.secret) {
      throw new Error(
        `${row.collection}/${row.id}: 정화 후에도 크레덴셜이 남아 있다 — 중단한다`,
      );
    }
  }
  console.log(`\nApplied to ${findings.length} document(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

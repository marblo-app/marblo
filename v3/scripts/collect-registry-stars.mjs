#!/usr/bin/env node
/**
 * 스토어 별점의 **유용성 신호**(업스트림 GitHub 스타)를 빌드 타임에 한 번 수집해
 * `electron/data/registry-stars-snapshot.ts` 로 커밋한다.
 *
 * ── 왜 런타임이 아니라 빌드 타임인가 ────────────────────────────────
 * 레지스트리에는 150+ 개의 서로 다른 업스트림 레포가 있다. 스토어를 열 때마다
 * 그만큼 GitHub API 를 때리면 (1) 비인증 60req/h 레이트리밋에 즉사하고,
 * (2) 사용자 IP 로 나가는 트래픽이 되며, (3) 렌더링이 네트워크에 묶인다.
 * 그래서 수집은 `gh`(인증 5000req/h)로 여기서 한 번 하고, 앱은 그 스냅샷을
 * 코드처럼 번들해 읽기만 한다 — 스토어 렌더 경로에 스타 API 호출은 0 이다.
 *
 * ── 왜 JSON 이 아니라 .ts 모듈인가 ──────────────────────────────────
 * electron 메인은 `tsc -p electron/tsconfig.json` 으로만 dist-electron 에
 * 떨어진다. JSON 을 런타임에 fs 로 읽으면 패키징(asar) 경로 문제를 새로
 * 만든다 — 생성물을 .ts 로 두면 컴파일 산출물에 그냥 같이 실린다.
 *
 * 사용:
 *   node scripts/collect-registry-stars.mjs            # 수집 후 스냅샷 갱신
 *   node scripts/collect-registry-stars.mjs --check    # 갱신 없이 diff 만 보고
 *
 * `gh` 인증이 없으면 **아무것도 쓰지 않고** 종료한다(1) — 반쪽 스냅샷으로
 * 커밋되면 멀쩡한 항목이 "스타 미수집"으로 강등되기 때문이다.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(
  __dirname,
  "..",
  "electron",
  "data",
  "registry-stars-snapshot.ts",
);

const REGISTRY_REPO = "marblo-app/marblo";
const REGISTRY_BRANCH = "main";
/** registry-client 의 INDEXED_DIRS 와 같은 집합 — 여기가 좁으면 그 카테고리가 통째로 스타 0 이 된다. */
const INDEXED_DIRS = new Set([
  "skills",
  "mcp-servers",
  "agents",
  "workflows",
  "knowledge",
]);
const MANIFEST_RE = /^([a-z-]+)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/marblo\.yaml$/;
const CONCURRENCY = 8;

const checkOnly = process.argv.includes("--check");

async function gh(endpoint, jq) {
  const args = ["api", endpoint];
  if (jq) args.push("--jq", jq);
  const { stdout } = await execFileAsync("gh", args, {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** registry-client.parseGitHubSourceRepository 와 같은 호스트 allowlist. */
function parseGitHubRepo(repository) {
  if (typeof repository !== "string" || repository.length > 200) return null;
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/.exec(repository);
  if (!m) return null;
  const owner = m[1];
  let repo = m[2];
  if (repo.endsWith(".git")) repo = repo.slice(0, -4);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?$/.test(owner)) return null;
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo === "." || repo === "..") {
    return null;
  }
  return { owner, repo };
}

async function main() {
  try {
    await execFileAsync("gh", ["auth", "status"]);
  } catch {
    console.error(
      "[stars] gh 인증이 없다. `gh auth login` 후 다시 실행 — 반쪽 스냅샷은 쓰지 않는다.",
    );
    process.exit(1);
  }

  const commit = await gh(
    `repos/${REGISTRY_REPO}/commits/${REGISTRY_BRANCH}`,
    ".sha",
  );
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    console.error("[stars] 레지스트리 HEAD 커밋 해석 실패");
    process.exit(1);
  }
  const treeRaw = await gh(
    `repos/${REGISTRY_REPO}/git/trees/${commit}?recursive=1`,
  );
  const tree = JSON.parse(treeRaw);
  if (tree.truncated) {
    console.error("[stars] 레지스트리 트리가 truncated — 수집 중단");
    process.exit(1);
  }
  const manifestPaths = tree.tree
    .filter((e) => e.type === "blob")
    .map((e) => e.path)
    .filter((p) => {
      const m = MANIFEST_RE.exec(p);
      return m && INDEXED_DIRS.has(m[1]);
    });
  console.log(
    `[stars] manifest ${manifestPaths.length}개 @ ${commit.slice(0, 7)}`,
  );

  // manifest 본문은 raw CDN 에서 받는다(API 쿼터를 아낀다). 여기서 필요한 건
  // source.repository 하나뿐이다 — 스타는 **설치 바이트가 실제로 오는 레포**
  // 에서만 센다. homepage 는 쓰지 않는다: 설치처와 다른 인기 레포를 가리켜
  // 남의 스타를 빌리는 경로가 되기 때문.
  const repoByItem = new Map();
  await mapLimit(manifestPaths, CONCURRENCY, async (p) => {
    try {
      const res = await fetch(
        `https://raw.githubusercontent.com/${REGISTRY_REPO}/${commit}/${p}`,
      );
      if (!res.ok) return;
      const doc = parseYaml(await res.text(), { maxAliasCount: 8 });
      const repository = doc?.source?.repository;
      const parsed = parseGitHubRepo(repository);
      if (parsed) repoByItem.set(p, `${parsed.owner}/${parsed.repo}`);
    } catch (err) {
      console.warn(`[stars] manifest ${p} 읽기 실패(건너뜀):`, err.message);
    }
  });

  const uniqueRepos = [...new Set(repoByItem.values())].sort();
  console.log(
    `[stars] 업스트림 레포 ${uniqueRepos.length}개 (source.repository 없는 항목 ${
      manifestPaths.length - repoByItem.size
    }개는 스타 측정 대상 아님)`,
  );

  const repos = {};
  const failed = [];
  await mapLimit(uniqueRepos, CONCURRENCY, async (full) => {
    try {
      const raw = await gh(
        `repos/${full}`,
        "{stars: .stargazers_count, pushedAt: .pushed_at, archived: .archived, license: .license.spdx_id, defaultBranch: .default_branch}",
      );
      const meta = JSON.parse(raw);
      let headSha = null;
      try {
        headSha = await gh(`repos/${full}/commits?per_page=1`, ".[0].sha");
      } catch {
        /* 빈 레포/권한 — headSha 없이도 나머지 신호는 유효하다 */
      }
      repos[full] = {
        stars: typeof meta.stars === "number" ? meta.stars : 0,
        pushedAt: meta.pushedAt ?? null,
        archived: !!meta.archived,
        license:
          typeof meta.license === "string" && meta.license !== "NOASSERTION"
            ? meta.license
            : null,
        headSha: /^[0-9a-f]{40}$/.test(headSha ?? "") ? headSha : null,
      };
    } catch (err) {
      // 삭제·비공개 전환된 레포. 스냅샷에서 빠지면 앱은 "스타 미수집"으로
      // 낮게 매긴다 — 조용히 0 으로 채워 있는 척하지 않는다.
      failed.push(full);
      console.warn(`[stars] ${full} 조회 실패:`, err.message.split("\n")[0]);
    }
  });

  const collectedAt = new Date().toISOString();
  const sorted = Object.fromEntries(
    Object.entries(repos).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  const body = renderModule({
    collectedAt,
    registryCommit: commit,
    repos: sorted,
  });

  const prev = fs.existsSync(OUT_FILE)
    ? fs.readFileSync(OUT_FILE, "utf-8")
    : "";
  const prevRepos = prev.match(/"([^"]+)": \{ stars: (\d+)/g)?.length ?? 0;
  console.log(
    `[stars] 수집 ${Object.keys(sorted).length}개 (실패 ${failed.length}개, 직전 스냅샷 ${prevRepos}개)`,
  );
  if (checkOnly) {
    console.log(
      prev === body ? "[stars] 스냅샷 최신" : "[stars] 스냅샷 변경 있음",
    );
    return;
  }
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, body, "utf-8");
  console.log(`[stars] 기록: ${path.relative(process.cwd(), OUT_FILE)}`);
}

function renderModule(snapshot) {
  const entries = Object.entries(snapshot.repos)
    .map(
      ([full, r]) =>
        `  ${JSON.stringify(full)}: { stars: ${r.stars}, pushedAt: ${JSON.stringify(
          r.pushedAt,
        )}, archived: ${r.archived}, license: ${JSON.stringify(
          r.license,
        )}, headSha: ${JSON.stringify(r.headSha)} },`,
    )
    .join("\n");
  return `/**
 * ⚠️ 생성 파일 — 직접 고치지 말 것. \`node scripts/collect-registry-stars.mjs\` 로 갱신.
 *
 * 공개 레지스트리(marblo-app/marblo) 항목들의 **업스트림 레포 신호** 스냅샷.
 * 스토어 별점의 유용성·신선도 성분이 이 값만 읽는다 — 런타임에 GitHub API 를
 * 호출하지 않으므로 레이트리밋·사용자 IP 트래픽·렌더 지연이 없다.
 *
 * 값은 수집 시점의 사실이고, 별점의 신선도 성분은 \`collectedAt\` 을 기준
 * 시계로 쓴다(벽시계를 쓰면 같은 데이터가 날마다 다른 별점을 내서 재현이
 * 안 된다). 스냅샷이 오래되면 별점이 아니라 스냅샷을 갱신하는 게 맞다.
 */
export interface UpstreamRepoSignals {
  /** 업스트림 GitHub 스타 수(유용성 프록시). */
  stars: number;
  /** 마지막 push 시각(ISO). null = 조회 불가. */
  pushedAt: string | null;
  /** 아카이브(동결)된 레포. */
  archived: boolean;
  /** GitHub 이 인식한 SPDX 라이선스 id. null = NOASSERTION/미인식. */
  license: string | null;
  /** 수집 시점 기본 브랜치 HEAD — 매니페스트 pin 이 최신인지 대조용. */
  headSha: string | null;
}

export interface RegistryStarsSnapshot {
  /** 수집 시각(ISO) — 신선도 계산의 기준 시계. */
  collectedAt: string;
  /** 수집 당시 레지스트리 HEAD 커밋. */
  registryCommit: string;
  /** "owner/repo" → 신호. 없는 키 = 그 레포를 이 스냅샷이 모른다. */
  repos: Record<string, UpstreamRepoSignals>;
}

export const REGISTRY_STARS_SNAPSHOT: RegistryStarsSnapshot = {
  collectedAt: ${JSON.stringify(snapshot.collectedAt)},
  registryCommit: ${JSON.stringify(snapshot.registryCommit)},
  repos: {
${entries}
  },
};
`;
}

main().catch((err) => {
  console.error("[stars] 수집 실패:", err);
  process.exit(1);
});

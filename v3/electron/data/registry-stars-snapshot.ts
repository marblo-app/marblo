/**
 * ⚠️ 생성 파일 — 직접 고치지 말 것. `node scripts/collect-registry-stars.mjs` 로 갱신.
 *
 * 공개 레지스트리(marblo-app/marblo) 항목들의 **업스트림 레포 신호** 스냅샷.
 * 스토어 별점의 유용성·신선도 성분이 이 값만 읽는다 — 런타임에 GitHub API 를
 * 호출하지 않으므로 레이트리밋·사용자 IP 트래픽·렌더 지연이 없다.
 *
 * 값은 수집 시점의 사실이고, 별점의 신선도 성분은 `collectedAt` 을 기준
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
  collectedAt: "2026-08-10T03:57:31.576Z",
  registryCommit: "d73022d827282fa02f56774f1db02eeb2c47d30d",
  repos: {
  "CircleCI-Public/mcp-server-circleci": { stars: 89, pushedAt: "2026-08-06T17:41:49Z", archived: false, license: null, headSha: "c47ce3fa6f6f490fbf9a116bb450c7a8505cc7e7" },
  "ClickHouse/mcp-clickhouse": { stars: 846, pushedAt: "2026-08-05T04:23:40Z", archived: false, license: "Apache-2.0", headSha: "423ca2e15c47b0f313f06dfdf967bab4561a1a1f" },
  "DaleSeo/korean-skills": { stars: 130, pushedAt: "2026-05-05T02:06:17Z", archived: false, license: "MIT", headSha: "ae12ba27982ebeff03b46dc738365aaa34260d9a" },
  "Doist/todoist-mcp": { stars: 536, pushedAt: "2026-08-10T03:05:57Z", archived: false, license: "MIT", headSha: "c3184f44e3254c3bf47291dd2b473b0b0577e792" },
  "EleutherAI/lm-evaluation-harness": { stars: 13584, pushedAt: "2026-08-09T16:15:58Z", archived: false, license: "MIT", headSha: "671b1550ff9541341a3d2cdff16ee7a224c34298" },
  "GLips/Figma-Context-MCP": { stars: 15622, pushedAt: "2026-08-07T04:58:42Z", archived: false, license: "MIT", headSha: "c083d65c7e002923e7cb98f4e3bdafb105e90f6d" },
  "GoogleCloudPlatform/cloud-run-mcp": { stars: 624, pushedAt: "2026-08-06T11:00:46Z", archived: false, license: "Apache-2.0", headSha: "a6373440ef0c21c48949dca66cfdf08711f8c246" },
  "J-nowcow/awesome-korean-agent-skills": { stars: 31, pushedAt: "2026-08-09T19:59:09Z", archived: false, license: "CC0-1.0", headSha: "7354542db2168bc44f0d2dd5bae0f0598bbd5205" },
  "Koomook/data-go-mcp-servers": { stars: 288, pushedAt: "2025-09-16T22:32:34Z", archived: false, license: "Apache-2.0", headSha: "dd27f99490400b31fa14f96045a138fa217580a4" },
  "MarkusPfundstein/mcp-obsidian": { stars: 4283, pushedAt: "2026-05-15T10:25:32Z", archived: false, license: "MIT", headSha: "32285e9ac07049a8a23ea7d7903603a3e48a1bf7" },
  "NomaDamas/k-skill": { stars: 7060, pushedAt: "2026-08-09T04:55:40Z", archived: false, license: "MIT", headSha: "44fbaca00ddc4703758df82ad7d76e1ad7c468ac" },
  "SaseQ/discord-mcp": { stars: 442, pushedAt: "2026-04-25T13:55:22Z", archived: false, license: "MIT", headSha: "0b35793bf9f86cc65849ae42ebae940718fbf812" },
  "Snowflake-Labs/mcp": { stars: 295, pushedAt: "2026-05-15T16:30:51Z", archived: false, license: "Apache-2.0", headSha: "662cb486395d79ab1ad0b3538f933fe6a686ce7c" },
  "VoltAgent/awesome-ai-agent-papers": { stars: 1668, pushedAt: "2026-08-07T19:22:41Z", archived: false, license: "MIT", headSha: "c8502b6acd3978a84b8b25453eda24be83088d00" },
  "VoltAgent/awesome-claude-code-subagents": { stars: 24163, pushedAt: "2026-07-31T12:34:39Z", archived: false, license: "MIT", headSha: "91810b33c707111e05e0988b12e7385d7b5cfe9d" },
  "airmang/hwpx-plugins": { stars: 19, pushedAt: "2026-08-09T18:16:21Z", archived: false, license: "Apache-2.0", headSha: "afedc074c0509680ab1528688b41befe01461541" },
  "anthropics/claude-cookbooks": { stars: 51187, pushedAt: "2026-08-07T17:13:37Z", archived: false, license: "MIT", headSha: "f65eb122a51e9710d4db3f4893016879c65c77d6" },
  "anthropics/skills": { stars: 167267, pushedAt: "2026-08-07T17:14:15Z", archived: false, license: null, headSha: "f17010c9bb483898c1d9c9f42dde2b3a98889434" },
  "awesome-rag/awesome-rag": { stars: 461, pushedAt: "2025-08-04T03:27:26Z", archived: false, license: "Apache-2.0", headSha: "cca6aa9ad7f62288eafbb99de908ca7917f36347" },
  "awslabs/mcp": { stars: 9576, pushedAt: "2026-08-08T15:47:21Z", archived: false, license: "Apache-2.0", headSha: "7ad53dc06ff7999235ab5addbbbb98042718c33a" },
  "channprj/kmsg": { stars: 249, pushedAt: "2026-08-08T13:58:01Z", archived: false, license: "MIT", headSha: "fee08eb8af255be0aa66d51f15579f59678d3ff2" },
  "chrisryugj/kordoc": { stars: 1679, pushedAt: "2026-08-07T06:01:11Z", archived: false, license: "MIT", headSha: "8c9e805582846ef56be0b73eec41cd2b005da49e" },
  "chrisryugj/korean-law-mcp": { stars: 2426, pushedAt: "2026-08-07T23:36:02Z", archived: false, license: "MIT", headSha: "2887dd11ac67c1aa13cfa6fdc3515cbe0608e878" },
  "chrisryugj/korean-patent-mcp": { stars: 50, pushedAt: "2026-07-03T01:38:30Z", archived: false, license: "MIT", headSha: "9686dd8ff102324aed642fefeda3102caccce93c" },
  "chroma-core/chroma-mcp": { stars: 585, pushedAt: "2025-09-17T20:20:13Z", archived: false, license: "Apache-2.0", headSha: "98ff67589bdcc31b730a5415ff9529433f949077" },
  "cloudflare/mcp-server-cloudflare": { stars: 4048, pushedAt: "2026-08-07T15:28:10Z", archived: false, license: "Apache-2.0", headSha: "70ff690553722f731849ede6ba9ce98958395a23" },
  "containers/kubernetes-mcp-server": { stars: 1931, pushedAt: "2026-08-10T01:06:31Z", archived: false, license: "Apache-2.0", headSha: "c025f7a0f3814f0597f8f4fe65e0ed72715be823" },
  "dahlia/ko-stdict-mcp": { stars: 26, pushedAt: "2026-03-29T08:16:57Z", archived: false, license: "AGPL-3.0", headSha: "168f902bc8b820f4242812ed0af411a5e8918893" },
  "dair-ai/Prompt-Engineering-Guide": { stars: 77376, pushedAt: "2026-03-11T20:09:13Z", archived: false, license: "MIT", headSha: "57673726396dd94acb23bdb1e67f27c78ee85a8e" },
  "deepset-ai/haystack": { stars: 26165, pushedAt: "2026-08-07T18:24:41Z", archived: false, license: "Apache-2.0", headSha: "e97e713ba5bcca254a305e71513ab15a2b0fe4bc" },
  "docker/mcp-gateway": { stars: 1522, pushedAt: "2026-08-06T15:21:20Z", archived: false, license: "MIT", headSha: "b5ff11f9dc3b09822ff07967ce08b9180ca0aedb" },
  "domdomegg/airtable-mcp-server": { stars: 455, pushedAt: "2026-08-05T16:49:15Z", archived: false, license: "MIT", headSha: "956622b839feeabee826be038b757e9c9ed1cfaa" },
  "emceeKim/korea-finance-mcp": { stars: 53, pushedAt: "2026-07-04T06:36:00Z", archived: false, license: null, headSha: "813bbd5d6a4a5464a42341fbd80b9de36982b958" },
  "exa-labs/exa-mcp-server": { stars: 4847, pushedAt: "2026-08-07T18:31:48Z", archived: false, license: "MIT", headSha: "394f9210ed16d3e25d328e1e6db285824caedc04" },
  "firecrawl/firecrawl-mcp-server": { stars: 7197, pushedAt: "2026-08-08T22:45:19Z", archived: false, license: "MIT", headSha: "9625957f39932ebd497f26319c83cdf80b565c1c" },
  "github/github-mcp-server": { stars: 32100, pushedAt: "2026-08-07T17:37:35Z", archived: false, license: "MIT", headSha: "eb4c099e05ef622445e930b18682a0464f22418f" },
  "google-research/bert": { stars: 40053, pushedAt: "2024-07-23T23:39:41Z", archived: true, license: "Apache-2.0", headSha: "eedf5716ce1268e56f0a50264a88cafad334ac61" },
  "googleapis/mcp-toolbox": { stars: 16141, pushedAt: "2026-08-09T14:27:16Z", archived: false, license: "Apache-2.0", headSha: "cf5a0c8fbf52f1e09fc565109682cf52b6ebd553" },
  "grafana/mcp-grafana": { stars: 3330, pushedAt: "2026-08-10T02:52:27Z", archived: false, license: "Apache-2.0", headSha: "4c1b338f3d7a430dcd2183ea3ae8f262eb852c07" },
  "hashicorp/terraform-mcp-server": { stars: 1499, pushedAt: "2026-08-09T21:16:48Z", archived: false, license: "MPL-2.0", headSha: "3762b5c02d4ad1b454e93efc69f95dae0504ab24" },
  "hauptsacheNet/clickup-mcp": { stars: 46, pushedAt: "2026-08-09T18:24:11Z", archived: false, license: "MIT", headSha: "4022c07700d431e68568b3abea7c5c20b1aa7474" },
  "hmmhmmhm/daiso-mcp": { stars: 317, pushedAt: "2026-08-10T02:25:20Z", archived: false, license: "MIT", headSha: "8a48467c68125978a9feb583330b690c15845eef" },
  "hollobit/assembly-api-mcp": { stars: 85, pushedAt: "2026-05-02T05:09:35Z", archived: false, license: "MIT", headSha: "f74c6b452c59d87e2fa7265fd985b90e4057a8ef" },
  "huggingface/llm-course": { stars: 20, pushedAt: "2025-03-24T11:27:47Z", archived: false, license: "Apache-2.0", headSha: "aaee936e5bbc959b5ab06f9b35406729efe74d1e" },
  "huggingface/peft": { stars: 21524, pushedAt: "2026-08-06T12:05:13Z", archived: false, license: "Apache-2.0", headSha: "5f55a6331b6a1620d8200ddb7c7c517dec722908" },
  "huggingface/transformers": { stars: 163508, pushedAt: "2026-08-10T03:32:52Z", archived: false, license: "Apache-2.0", headSha: "fd12552d770f745fdbe41031ff4daa688f5ed57e" },
  "huggingface/trl": { stars: 19031, pushedAt: "2026-08-09T22:39:38Z", archived: false, license: "Apache-2.0", headSha: "2396dfe5d2be7b18c0b615d80957d64ecdeb7cc0" },
  "isnow890/naver-search-mcp": { stars: 81, pushedAt: "2026-07-26T14:28:56Z", archived: false, license: "MIT", headSha: "d7c7c58cab0de2692336b710727f1ee123270e6c" },
  "jjlabsio/korea-stock-mcp": { stars: 170, pushedAt: "2026-08-09T21:25:39Z", archived: false, license: "ISC", headSha: "210595eec73a39cd04e2fb175f6e69b1516f0dd4" },
  "kangdacool/hwpx-editing-skill": { stars: 8, pushedAt: "2026-08-03T08:59:54Z", archived: false, license: "MIT", headSha: "0a04bc1fa91160d50178c4a7b584f24f4e39d515" },
  "karpathy/micrograd": { stars: 17068, pushedAt: "2026-08-03T04:04:05Z", archived: false, license: "MIT", headSha: "7bc720e951fe422b8f8814aa5aa1b64121d26b4c" },
  "karpathy/nanoGPT": { stars: 62011, pushedAt: "2025-11-12T19:52:34Z", archived: false, license: "MIT", headSha: "3adf61e154c3fe3fca428ad6bc3818b27a3b8291" },
  "karpathy/nn-zero-to-hero": { stars: 23921, pushedAt: "2024-08-18T12:16:26Z", archived: false, license: "MIT", headSha: "73c3fcc741f0ec104ca850b1fb0df90e7e8d4cde" },
  "korotovsky/slack-mcp-server": { stars: 1773, pushedAt: "2026-07-16T17:14:22Z", archived: false, license: "MIT", headSha: "b88c0de3f706f4f07337c9eda7133c736d1c9524" },
  "langchain-ai/langchain": { stars: 143832, pushedAt: "2026-08-09T17:31:19Z", archived: false, license: "MIT", headSha: "24e8d2b5960ce52985d99332d29ab503fc4be5f9" },
  "makenotion/notion-mcp-server": { stars: 4584, pushedAt: "2026-07-25T16:20:03Z", archived: false, license: "MIT", headSha: "1d38420769c8a1fe2d583ff1e7d2d108d4eb0b30" },
  "microsoft/ai-agents-for-beginners": { stars: 71754, pushedAt: "2026-07-29T19:47:29Z", archived: false, license: "MIT", headSha: "15ad10ca60577b75199c1ba828887ab7e66bac87" },
  "microsoft/mcp": { stars: 3552, pushedAt: "2026-08-08T01:45:38Z", archived: false, license: "MIT", headSha: "5e821b6de45ea771382a4c28172e59dc33b28245" },
  "microsoft/playwright-mcp": { stars: 35947, pushedAt: "2026-08-09T09:44:48Z", archived: false, license: "Apache-2.0", headSha: "7e0457a7cbf88823bf0146d12c46ae12c6818247" },
  "migusdn/KIS_MCP_Server": { stars: 27, pushedAt: "2026-06-15T12:36:38Z", archived: false, license: "MIT", headSha: "595d5d1cdbbe6ae706f030cd196cfa1c12f15ca7" },
  "mlabonne/llm-course": { stars: 81570, pushedAt: "2026-02-05T13:09:26Z", archived: false, license: "Apache-2.0", headSha: "7abd96e8284bfae232048fdb77b52397a2114847" },
  "modelcontextprotocol/docs": { stars: 433, pushedAt: "2025-04-08T16:42:43Z", archived: true, license: "MIT", headSha: "573dc60c2e7aab2605b29d0bf27194aa7b02e4fb" },
  "modelcontextprotocol/servers": { stars: 89382, pushedAt: "2026-08-10T02:41:59Z", archived: false, license: null, headSha: "76d64c822f5125032f89eb71dbdb94e42b434821" },
  "mongodb-js/mongodb-mcp-server": { stars: 1095, pushedAt: "2026-08-09T08:57:58Z", archived: false, license: "Apache-2.0", headSha: "ea5f2dfcbf40d293c43343e9e3cd9570a015d4a8" },
  "motherduckdb/mcp-server-motherduck": { stars: 504, pushedAt: "2026-07-27T07:43:10Z", archived: false, license: "MIT", headSha: "b43ad1473fc5a3ca29317bf6df2db40a9a80eb90" },
  "neondatabase/mcp-server-neon": { stars: 622, pushedAt: "2026-08-10T02:10:51Z", archived: false, license: "MIT", headSha: "94928121944167d82d9b2b865bcdc5469631557d" },
  "obra/superpowers": { stars: 269797, pushedAt: "2026-08-08T01:45:49Z", archived: false, license: "MIT", headSha: "44c9b2d6e889982ac18c27d05a19fefe335194e1" },
  "openai/openai-cookbook": { stars: 75181, pushedAt: "2026-08-09T20:51:25Z", archived: false, license: "MIT", headSha: "4a85c3018d20ceef48bf7549450c567896501bf9" },
  "openmagi/korean-legal-doc-drafter": { stars: 10, pushedAt: "2026-06-24T11:22:55Z", archived: false, license: "Apache-2.0", headSha: "09addc57285ef53e3f5b78d5a307ec56c64a3708" },
  "oraios/serena": { stars: 27789, pushedAt: "2026-08-09T18:37:45Z", archived: false, license: "MIT", headSha: "946ad9817875cbf46b308423296c33eb65e3e728" },
  "piotr-agier/google-drive-mcp": { stars: 201, pushedAt: "2026-07-29T08:20:51Z", archived: false, license: "MIT", headSha: "4cfc583a5cf3a1bb852305e9e48865885c91148e" },
  "punkpeye/awesome-mcp-servers": { stars: 92018, pushedAt: "2026-08-03T03:09:55Z", archived: false, license: "MIT", headSha: "cbcdf8f7700cfe4c0ef9aeb232f64aeebe8a184c" },
  "qdrant/mcp-server-qdrant": { stars: 1494, pushedAt: "2026-07-31T00:14:00Z", archived: false, license: "Apache-2.0", headSha: "f1a4d04e4f91c4d3e2b7c63d5283f3f4338fd2e5" },
  "redis/mcp-redis": { stars: 560, pushedAt: "2026-08-05T12:04:27Z", archived: false, license: "MIT", headSha: "5945b0b5b098c9a1882075a161a6a58f23de81ed" },
  "roboco-io/plugins": { stars: 20, pushedAt: "2026-07-12T20:48:08Z", archived: false, license: "MIT", headSha: "1e2f83c808c28763aa85744979cc1a87b6675a26" },
  "roychri/mcp-server-asana": { stars: 145, pushedAt: "2026-05-10T14:47:21Z", archived: false, license: "MIT", headSha: "c4508aac54e210d49dbc9d7d8ad1fa98b9090a82" },
  "run-llama/llama_index": { stars: 51516, pushedAt: "2026-08-09T22:20:15Z", archived: false, license: "MIT", headSha: "47b85c8ec229f725aa680ed3d613d2c02359480f" },
  "snflkd/fluent-korean": { stars: 9, pushedAt: "2026-07-16T05:06:20Z", archived: false, license: "MIT", headSha: "f60196a89607b8d3ae6a17c9efa4c1c0b4d24485" },
  "sooperset/mcp-atlassian": { stars: 5711, pushedAt: "2026-08-08T05:05:30Z", archived: false, license: "MIT", headSha: "12fb6fa9e75de20fa70f56ae0d896a79c5a38c4e" },
  "stanford-cs336/assignment1-basics": { stars: 2555, pushedAt: "2026-04-07T20:49:12Z", archived: false, license: "MIT", headSha: "a158843b20107949f1a8d7df1b05cd33b9166712" },
  "stanford-cs336/assignment2-systems": { stars: 295, pushedAt: "2026-05-01T16:36:16Z", archived: false, license: "MIT", headSha: "ca8bc81a59b70516f7ebb2da4808daade877c736" },
  "stripe/ai": { stars: 1730, pushedAt: "2026-08-08T00:26:57Z", archived: false, license: "MIT", headSha: "89ffbee06b3782ed15d77ffd6cbc5620ad26d3bd" },
  "supabase/mcp": { stars: 2856, pushedAt: "2026-08-09T13:44:26Z", archived: false, license: "Apache-2.0", headSha: "5cda0672702c65fe672280ee4cf306593e643fb6" },
  "tacticlaunch/mcp-linear": { stars: 146, pushedAt: "2026-07-28T19:03:59Z", archived: false, license: "MIT", headSha: "e56c7071bf2fd1cca5c9515a5a5004ace6bf9b90" },
  "tae0y/real-estate-mcp": { stars: 366, pushedAt: "2026-07-18T12:21:18Z", archived: false, license: "MIT", headSha: "1119eb1069d1b1bae15f7b38c6c0268fe07995c0" },
  "taylorwilsdon/google_workspace_mcp": { stars: 2992, pushedAt: "2026-08-09T11:41:51Z", archived: false, license: "MIT", headSha: "454cc71748ec4ddf74fc126a52eaa9559cc6a107" },
  "thesun4sky/jobstack": { stars: 36, pushedAt: "2026-07-20T05:35:11Z", archived: false, license: "MIT", headSha: "a5ef5ed8df2840e08bb7f2d2ab7fbab679bb3eff" },
  "upstash/context7": { stars: 60505, pushedAt: "2026-08-09T19:09:20Z", archived: false, license: "MIT", headSha: "6a799754d01aa27f1eee40d712651ebc31ffedce" },
  "wshobson/agents": { stars: 38664, pushedAt: "2026-08-05T07:11:13Z", archived: false, license: "MIT", headSha: "c4b82b0ad771190355eb8e204b1329732a18449a" },
  "zapier/zapier-mcp": { stars: 373, pushedAt: "2026-07-29T21:42:17Z", archived: false, license: "MIT", headSha: "5360f152b96735712e5f925ad728732cb86888df" },
  "zereight/gitlab-mcp": { stars: 1882, pushedAt: "2026-08-10T02:02:14Z", archived: false, license: "MIT", headSha: "926d42c8780cb9ec0cf3b5e187575bc3db205ff0" },
  },
};

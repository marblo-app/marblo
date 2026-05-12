// Plain-Node smoke test for the Updater.isHotfix() decision logic.
// Mirrors the production check in v3/electron/updater.ts. Run:
//   node v3/tests/electron/updater.test.mjs
//
// We test the pure classification without spinning up the real Electron
// autoUpdater (which needs a live GitHub Releases endpoint).

function isHotfix(info, channel) {
  const HOTFIX = /\[HOTFIX\]/i;
  if (info.releaseName && HOTFIX.test(info.releaseName)) return true;
  const notes = info.releaseNotes;
  if (typeof notes === "string" && HOTFIX.test(notes)) return true;
  if (Array.isArray(notes)) {
    for (const n of notes) {
      const text = typeof n === "string" ? n : n?.note ?? "";
      if (HOTFIX.test(text)) return true;
    }
  }
  if (typeof channel === "string" && channel.toLowerCase() === "hotfix")
    return true;
  return false;
}

const cases = [
  // ── releaseName tag ───────────────────────────────────────
  [
    "releaseName [HOTFIX] uppercase",
    () => isHotfix({ releaseName: "v3.0.2 [HOTFIX] auth fix" }) === true,
  ],
  [
    "releaseName [hotfix] lowercase",
    () => isHotfix({ releaseName: "v3.0.2 [hotfix]" }) === true,
  ],
  [
    "releaseName no tag",
    () => isHotfix({ releaseName: "v3.0.2 regular release" }) === false,
  ],

  // ── releaseNotes string ───────────────────────────────────
  [
    "notes string [HOTFIX]",
    () => isHotfix({ releaseNotes: "[HOTFIX] roll back X" }) === true,
  ],
  [
    "notes string no tag",
    () => isHotfix({ releaseNotes: "Misc improvements" }) === false,
  ],

  // ── releaseNotes array of strings ─────────────────────────
  [
    "notes array first has tag",
    () =>
      isHotfix({ releaseNotes: ["[HOTFIX] critical", "and other"] }) === true,
  ],
  [
    "notes array second has tag",
    () => isHotfix({ releaseNotes: ["misc", "[HOTFIX] urgent"] }) === true,
  ],
  [
    "notes array no tag",
    () => isHotfix({ releaseNotes: ["a", "b", "c"] }) === false,
  ],

  // ── releaseNotes array of objects ─────────────────────────
  [
    "notes array of objects with tag",
    () => isHotfix({ releaseNotes: [{ note: "[HOTFIX] data" }] }) === true,
  ],
  [
    "notes array of objects no tag",
    () => isHotfix({ releaseNotes: [{ note: "minor cleanup" }] }) === false,
  ],

  // ── channel ───────────────────────────────────────────────
  ["channel = hotfix", () => isHotfix({}, "hotfix") === true],
  ["channel = HOTFIX uppercase", () => isHotfix({}, "HOTFIX") === true],
  ["channel = latest", () => isHotfix({}, "latest") === false],
  ["channel = beta", () => isHotfix({}, "beta") === false],
  ["channel undefined", () => isHotfix({}, undefined) === false],

  // ── Combined ──────────────────────────────────────────────
  ["all empty → false", () => isHotfix({}) === false],
  [
    "releaseName trumps channel",
    () => isHotfix({ releaseName: "[HOTFIX] x" }, "latest") === true,
  ],
  [
    "channel trumps empty info",
    () => isHotfix({ releaseName: "regular" }, "hotfix") === true,
  ],

  // ── Edge: malformed inputs ────────────────────────────────
  ["null releaseNotes", () => isHotfix({ releaseNotes: null }) === false],
  ["number releaseNotes", () => isHotfix({ releaseNotes: 42 }) === false],
  ["object note missing", () => isHotfix({ releaseNotes: [{}] }) === false],
];

let pass = 0;
let fail = 0;
for (const [name, fn] of cases) {
  try {
    if (fn()) pass++;
    else {
      console.log("FAIL:", name);
      fail++;
    }
  } catch (err) {
    console.log("THROW:", name, err.message);
    fail++;
  }
}
console.log(
  `\nupdater.isHotfix: ${pass}/${cases.length} passed${
    fail ? `, ${fail} failed` : ""
  }`
);
process.exit(fail ? 1 : 0);

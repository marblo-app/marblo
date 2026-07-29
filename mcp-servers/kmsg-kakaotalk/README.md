# kmsg — unofficial KakaoTalk CLI & MCP server, macOS (referenced)

KakaoTalk is where Korean work conversations actually happen, and there is no API for it — Kakao publishes developer APIs for bots and business channels, not for your own account's chats. kmsg gets there a different way: it drives the KakaoTalk **desktop UI** through the macOS Accessibility API, listing chats, reading recent messages, watching for new ones, and sending text and images, with structured JSON on `stdout` and AX traces kept separate on `stderr`. It ships as a CLI and a native stdio MCP server from one Swift binary.

macOS 손쉬운 사용 API 로 카카오톡 창을 제어해 메시지를 읽고 보내는 CLI 겸 MCP 서버. 비공식 도구다.

## Referenced, not vendored

**No code from this project lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag.

- **Upstream:** [channprj/kmsg](https://github.com/channprj/kmsg)
- **Pinned at:** `v1.260726.0` (resolves to commit `1fdb1e66ff0428d6cf7fc77dc033c23fa9c4a493`, committed 2026-07-26)

## Why it is listed here

This is a capability the global ecosystem cannot substitute for. Slack and Discord MCP servers exist several times over; the messenger that Korean teams and families actually use has exactly one credible agent integration, and this is it.

**Measured 2026-07-29:** 242 stars · last upstream push 2026-07-29 (same day as measurement) · latest tag `v1.260726.0` · date-based versioning, tags roughly every one to three weeks.

## ⚠️ Read this before you install it

- **It is unofficial.** Upstream states plainly that kmsg is not a Kakao Corp. tool and that account restrictions, malfunction, or data loss are the user's risk. Upstream's `ARCHITECTURE.md` explains why it chose the Accessibility route over KakaoTalk's private LOCO protocol, and its own assessment of the sanction risk. Read that section, not this paragraph, before deciding.
- **It can read and send your personal messages.** An agent with this server attached has your KakaoTalk conversations in context and can write to them. Scope accordingly.
- **macOS only**, and it needs Accessibility permission granted to the installed binary — a capability the registry's permission enum has no word for, so it is stated here instead.

## Installing it standalone

```bash
brew install channprj/tap/kmsg
```

Requires macOS 13+, the Mac App Store version of KakaoTalk, and Accessibility permission for the `kmsg` binary. Upstream's [`USAGE.md`](https://github.com/channprj/kmsg/blob/v1.260726.0/USAGE.md) at the pinned tag is authoritative for direct download, source builds, and MCP client registration.

Note that pinning freezes this at one release: upstream fixes do **not** reach you until the pin here moves. That matters more than usual here — a KakaoTalk client update can move the UI out from under an AX path, and upstream ships fixes for exactly that. See [SECURITY.md](../../SECURITY.md).

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `filesystem:read` (images you send; the AX path cache) and `filesystem:write` (`~/.kmsg/ax-cache.json`, per upstream's `ARCHITECTURE.md`). **No `network:outbound`** — it talks to the local KakaoTalk app through Accessibility, not to a server. The one capability that is not expressible here is macOS Accessibility control of another application's UI; see the warning above.
- **License:** MIT (upstream, verified via the GitHub license API)

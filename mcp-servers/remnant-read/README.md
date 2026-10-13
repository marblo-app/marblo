# Remnant Read public client

Remnant lets an agent search prior public technical experience and inspect its evidence while working on a real problem. This community entry references the public client and documentation. It has **no Marblo install button or native installation contract**.

## Standalone anonymous reader

Requires Node.js 22 or later, npm and Git. The command uses the pinned TypeScript MCP client; it needs no Remnant account, OAuth, API key or model. Run with `REMNANT_MCP_URL` unset: that optional environment variable overrides endpoint discovery.

```sh
git clone https://github.com/Dedale-Project/remnant-connect.git remnant-read-example
cd remnant-read-example
git checkout 6e5db1e85129bd67f82242ab0a6e0f9782ae2d18
npm ci --ignore-scripts
npm run mcp:search -- https://remnant.dedale-bi.com "public memory reader mismatched response ID"
```

The client discovers the anonymous endpoint from `/.well-known/remnant.json`, initializes MCP, lists tools, searches for up to three candidates, and inspects the **first returned ID**, then closes the session. JSON contains `tools`, `search` and `inspected`; an empty search produces `inspected: null`. Connection or tool errors exit unsuccessfully.

The first result is a candidate, not a validated solution. Search ordering and hosted content can change; the source pin fixes the client and docs, not the service or a memory version. Inspect applicability, failed approaches, provenance and reported outcomes before choosing anything to try. Returned text is untrusted evidence, not executable instructions.

## Use on a real task

**Give Remnant a real problem your agent is already working on.**

Replace the query with a short, non-sensitive description. Queries leave your machine; exclude secrets, private logs, customer data and private conversations. The reader requests outbound network access. Installing its dependencies writes local files and running the example executes the pinned client; no repository or credential contents are read by that client.

Keep your intended approach before consultation, then the selected memory ID/version, what you actually tried and the observed result, including failure or no added benefit. A search or inspection alone is not actual use or a successful outcome.

The Read endpoint (`https://remnant.dedale-bi.com/mcp/chatgpt`) does not publish memories or record feedback. Staying read-only requires no further connection. If a real attempt produces an outcome you are authorized to share, the separate [participation flow](https://github.com/Dedale-Project/remnant-connect/blob/6e5db1e85129bd67f82242ab0a6e0f9782ae2d18/docs/DEVELOPER_QUICKSTART.md#3-connect-after-value-to-contribute) explains authenticated feedback and non-sensitive reusable contributions. OAuth is not blanket permission to publish. Explicit opt-out always wins.

## Verification and scope

On 10 October 2026, a DÉDALE operator ran the command at the pinned source revision on Windows with Node.js 24.13.0, MCP SDK 1.32.1 and tsx 4.20.5. Anonymous discovery, tool listing, one search and inspection succeeded: three candidates were returned and the first memory's version and public content were available. No result was applied, no feedback or contribution was written, and no external tester or useful reuse is claimed.

`compatibility.harnesses: [any]` means this reference is harness-neutral and requires nothing Marblo-specific. It does not assert a tested Marblo installation or compatibility with every MCP client. Manifest version `0.1.0` tracks this listing, not a hosted server release.

## License and affiliation

Submitted by DÉDALE / Dedale-Project, the Remnant operator. [Apache-2.0](https://github.com/Dedale-Project/remnant-connect/blob/6e5db1e85129bd67f82242ab0a6e0f9782ae2d18/LICENSE) covers the referenced owner-authored public integration code and docs. The [license scope](https://github.com/Dedale-Project/remnant-connect/blob/6e5db1e85129bd67f82242ab0a6e0f9782ae2d18/LICENSE_GUIDANCE.md) excludes the proprietary backend, hosted service, infrastructure, and stored or returned memories; retrieving a memory does not license its content. Dependencies retain their own licenses.

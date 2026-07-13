# Team Share Auth Audit

Context: team subscription project sharing, chat `@` mentions, locally spawned
orchestrators/agents, and the #406 fail-closed custom-token migration.

## Custom-token identity

- Renderer calls `issueAgentCustomToken` after Firebase login.
- The callable creates a custom token for `context.auth.uid` and returns that uid.
- `syncAgentFirebaseAuth(user)` rejects the response if the returned uid differs
  from the renderer login user.
- Electron main stores the token in `MARBLO_FIREBASE_CUSTOM_TOKEN` and signs the
  mission app in with it. MCP processes inherit the same env var and refuse
  anonymous fallback.

Result: Firestore access by local orchestrators/agents uses the local logged-in
runner uid, not the remote chat caller uid. A teammate's cross-machine mention is
authorized because the hosting machine's runner is also a project member.

## Project sharing boundary

- `firestore.rules` gates `tasks`, `agents`, `pendingInstructions`, `missions`,
  `flows`, and project chat/comment data through `isProjectMember(projectId)`.
- `isProjectMember` checks `request.auth.uid in projects/{projectId}.members`.
- Team invitation acceptance calls `projectService.addMember`, which uses
  `arrayUnion(userId)`.
- The one-off `backfill-project-members.mjs` only repairs legacy projects whose
  `ownerId` was missing from `members`; it does not need to add invitees because
  acceptance already writes invitees to `members`.

Result: shared projects allow every recorded project member to access shared
tasks/agents. Outsiders and legacy anonymous clients are denied by rules tests.

## Cross-user `@` mention flow

- Local mention to a running orchestrator/agent injects into the local PTY.
- Remote/cross-machine mention writes a `pendingInstructions` document with the
  target agent id (`orch-${projectId}` for orchestrator mentions).
- The hosting machine attaches a `PendingInstructionListener` for local agent ids
  and orchestrator ids. It subscribes to undelivered instructions, flips
  `isDelivered` in a transaction, then writes the message to the PTY.

Result: the architecture supports team member A mentioning team member B's
orchestrator/agent as long as B's local app is signed in and B is in
`project.members`. It is not a "caller impersonates B" model; the queue write is
performed by A, and the delivery/read/update is performed by B's runner uid.

## Gap found and fix

Gap: the MCP `send_instruction` tool accepted a `from_user_id` argument and used
it before the authenticated uid. The rules already reject writes where
`fromUserId != request.auth.uid`, so spoofed input failed closed. However, valid
MCP calls could be made brittle by passing a stale or mismatched `from_user_id`.

Fix: `send_instruction` now keeps the argument only for compatibility, ignores it
for persistence, requires a current Firebase auth uid, and records that uid as
`fromUserId`.

Residual note: `audit_logs`, `cost_logs`, `merge_history`, and telemetry remain
authenticated-only rather than project-member-scoped. That is outside this
team-share task/agent auth path, but should be reviewed separately if those
collections contain tenant-sensitive data.

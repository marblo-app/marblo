/**
 * English — `githubGuide.*` namespace. In-app GitHub connection guidance
 * (ticket kzxsRzC37uVvYftpVZO4). Keys mirror ../ko/githubGuide.ts.
 *
 * Copy discipline — do not oversell: what actually works depends on the
 * granted permission level (read vs write). In the read-only window the
 * copy says "pulling works, pushing doesn't yet" rather than "you're all
 * set". No app slug or install URL appears here — the server builds it.
 */
export const githubGuide = {
  // ── Shared preconditions ───────────────────────────────────────────────
  "githubGuide.loading.title": "Checking GitHub connection",
  "githubGuide.loading.body":
    "Checking this project's GitHub installation status.",
  "githubGuide.loading.next": "One moment.",

  "githubGuide.unsupported.title": "Not available on this screen",
  "githubGuide.unsupported.body":
    "GitHub connection status can only be checked in the Marblo desktop app.",
  "githubGuide.unsupported.next": "Open this project in the desktop app.",

  "githubGuide.error.title": "Couldn't check the status",
  "githubGuide.error.body":
    "We couldn't load the GitHub installation status — the connection dropped or it's a temporary error. We won't show something we couldn't verify as \"connected\".",
  "githubGuide.error.next": "Check your network, then press [Check again].",

  "githubGuide.notConfigured.title": "GitHub connection isn't ready yet",
  "githubGuide.notConfigured.body":
    "The GitHub App connection isn't set up in this build yet. In the meantime, pulling code still works through each person's own GitHub sign-in.",
  "githubGuide.notConfigured.nextOwner":
    "Nothing to do right now. An install button will appear here once it's ready.",
  "githubGuide.notConfigured.nextMember":
    "Nothing to do right now. If you can't get the code, let the project owner know.",

  // ── Owner ──────────────────────────────────────────────────────────────
  "githubGuide.owner.title": "To let your team pull the repository",
  "githubGuide.owner.subtitle":
    "You install once. After that, you just assign roles on the board and your team gets the code.",
  "githubGuide.owner.stepsTitle": "There are two things you do",
  "githubGuide.owner.step1": "Install the Marblo App on GitHub (once).",
  "githubGuide.owner.step2": "Assign roles to teammates on the Marblo board.",
  "githubGuide.owner.stepNote":
    "You do not need to invite teammates as GitHub collaborators.",

  "githubGuide.owner.whyPermission": "Why these permissions",
  "githubGuide.owner.whyPermissionBody":
    "They're used only to pull the repository and push branches. Who can access what is decided by Marblo roles, not by GitHub.",
  "githubGuide.owner.scopeHint":
    "On the install screen pick [Only select repositories] and choose just this project's repository. [All repositories] hands over your whole organization.",

  "githubGuide.owner.statusLabel": "Current status",
  "githubGuide.owner.installCta": "Install the App on GitHub",
  "githubGuide.owner.installOpening": "Opening your browser…",
  "githubGuide.owner.recheckCta": "Check again",
  "githubGuide.owner.checking": "Checking…",
  "githubGuide.owner.returnHint":
    "Finish the install in your browser and come back — this window rechecks automatically.",
  "githubGuide.owner.installFailed": "Couldn't start the install: {error}",
  "githubGuide.owner.installConfirmed":
    "Install confirmed. Your teammates just sign in to this app with GitHub and they'll get the code.",

  "githubGuide.owner.noRepoUrl.title": "Connect a repository first",
  "githubGuide.owner.noRepoUrl.body":
    "This project doesn't have a GitHub repository URL yet. With no repository to attach, installing the App gives your team nothing to pull.",
  "githubGuide.owner.noRepoUrl.next":
    "Use [Connect repository] to link this project's GitHub repository first.",

  "githubGuide.owner.notInstalled.title": "Not installed yet",
  "githubGuide.owner.notInstalled.body":
    "The Marblo App isn't connected to this project. For now, teammates have to pull the code with their own GitHub sign-in.",
  "githubGuide.owner.notInstalled.next":
    "Press [Install the App on GitHub] below and install it on this project's repository.",

  "githubGuide.owner.repoMismatch.title":
    "Installed, but this repository is missing",
  "githubGuide.owner.repoMismatch.body":
    "The Marblo App installation is alive but can't open this project's repository. That happens when the repository wasn't selected during install, or when it was moved to another account or organization.",
  "githubGuide.owner.repoMismatch.next":
    "Open the install screen and add this repository to the selected list. If you moved it to an organization, install the App on that organization instead.",

  "githubGuide.owner.readOnly.title": "Right now only pulling works",
  "githubGuide.owner.readOnly.body":
    "The installation has only approved read access so far. Teammates can pull code today, but pushing branches from the app doesn't work yet.",
  "githubGuide.owner.readOnly.next":
    "Approve the new permissions GitHub is requesting on the install screen. Pulling keeps working until you do.",

  "githubGuide.owner.ready.title": "Installed",
  "githubGuide.owner.ready.body":
    "The Marblo App is connected to this project's repository, and both pulling code and pushing branches work.",
  "githubGuide.owner.ready.next":
    "All that's left is assigning roles to teammates on the board. They have nothing to do on GitHub.",

  // ── Member ─────────────────────────────────────────────────────────────
  "githubGuide.member.title": "There's nothing for you to do on GitHub",
  "githubGuide.member.subtitle":
    "Just sign in to this app with your own GitHub account. That's it.",
  "githubGuide.member.noInviteTitle": "Don't wait for an invitation email",
  "githubGuide.member.noInviteBody":
    "No repository invitation email is coming from GitHub — that's expected. Your access follows the role you were given in Marblo.",
  "githubGuide.member.loginCta":
    "Connect your GitHub account under [Settings → Connections].",

  "githubGuide.member.noRepoUrl.title": "This project has no repository",
  "githubGuide.member.noRepoUrl.body":
    "No GitHub repository URL has been registered for this project yet, so there's no code to pull.",
  "githubGuide.member.noRepoUrl.next":
    "Ask the project owner to connect a repository.",

  "githubGuide.member.notInstalled.title":
    "The owner hasn't installed the GitHub App yet",
  "githubGuide.member.notInstalled.body":
    "The Marblo App isn't connected to this project yet, so the code can't come through automatically. This is fixed on the owner's side, not yours.",
  "githubGuide.member.notInstalled.next":
    "Wait for the project owner to install the GitHub App from the Project tab.",
  "githubGuide.member.notInstalled.also":
    "If the owner has already installed it and you still see this, ask them to check (1) that you've been given a role, and (2) that the plan includes team collaboration.",

  "githubGuide.member.repoMismatch.title":
    "The owner needs to add this repository",
  "githubGuide.member.repoMismatch.body":
    "The Marblo App is installed, but this project's repository isn't included in that installation.",
  "githubGuide.member.repoMismatch.next":
    "Ask the project owner to add this repository to the installation.",

  "githubGuide.member.readOnly.title": "Pulling works — pushing doesn't yet",
  "githubGuide.member.readOnly.body":
    "The installation has only approved read access so far. You can pull the code and work on it, but pushing branches from the app doesn't work yet.",
  "githubGuide.member.readOnly.next":
    "Ask the project owner to approve the new permissions on GitHub. Until then, keep pulling and working locally.",

  "githubGuide.member.viewer.title": "Your role is view-only",
  "githubGuide.member.viewer.body":
    "Your current role is viewer. You can pull and read the code, but you can't push branches from the app.",
  "githubGuide.member.viewer.next":
    "If you need to push, ask the project owner for a member role or higher.",

  "githubGuide.member.ready.title": "You're set",
  "githubGuide.member.ready.body":
    "You can pull this project's code and push branches. There's nothing to do on GitHub.",
  "githubGuide.member.ready.next":
    "Use [Connect repository] on the [Project] tab to download the repository on this computer, then get started.",

  // ── Legacy path (shown only while the App isn't connected) ─────────────
  "githubGuide.legacyCollaborator.notice":
    "This project is linked to a private repository. Until the GitHub App is connected, invited teammates also need to be added as GitHub collaborators to get the code.",
  "githubGuide.legacyCollaborator.link": "Open collaborators page",

  // ── Shared labels ──────────────────────────────────────────────────────
  "githubGuide.nextLabel": "What to do next",
  "githubGuide.roleLabel": "Your role",
  "githubGuide.badge.ok": "Connected",
  "githubGuide.badge.warn": "Partly limited",
  "githubGuide.badge.blocked": "Not connected",
  "githubGuide.badge.neutral": "Checking",
};

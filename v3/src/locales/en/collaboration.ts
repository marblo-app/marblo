/**
 * English — `collab.*` namespace. Team repo-connect (Clone & connect) modal
 * (ticket r8VggohxLGciDVXV2rf6). Keys mirror ../ko/collaboration.ts.
 */
export const collaboration = {
  "collab.firstShared.eyebrow": "Shared project",
  "collab.firstShared.body":
    "You have access to the shared board, completion history, and activity stream. Source code is not copied through Marblo: each teammate keeps code local and syncs changes through git.",
  "collab.firstShared.feature.board": "Board",
  "collab.firstShared.feature.history": "Done history",
  "collab.firstShared.feature.activity": "Activity",
  "collab.firstShared.localCode.title": "Code stays local",
  "collab.firstShared.localCode.body":
    "Use the repository setup below before working with files. You can reopen the same setup from [Project] tab's [Connect repository] button.",
  "collab.firstShared.conflictHint":
    "Avoid conflicts by pulling before edits, keeping task ownership clear on the board, and pushing changes through the shared git remote.",
  "collab.firstShared.repoStatus.noRepo.title":
    "No repository address is registered",
  "collab.firstShared.repoStatus.noRepo.body":
    "Open repository setup to enter the team repository URL or connect an existing clone. If you do not know the URL, ask the project owner to connect the repository.",
  "collab.firstShared.repoStatus.notDownloaded.title":
    "Repository is ready to download",
  "collab.firstShared.repoStatus.notDownloaded.body":
    "This project has a repository address, but the code is not on this computer yet.",
  "collab.firstShared.repoStatus.downloading.title":
    "Repository download is running",
  "collab.firstShared.repoStatus.downloading.body":
    "Keep this window open while Marblo clones the repository and records the local path.",
  "collab.firstShared.repoStatus.downloaded.title":
    "Repository is already on this computer",
  "collab.firstShared.repoStatus.downloaded.body":
    "This machine already has the project folder connected. You can start working from the Code and Worktree tabs.",
  "collab.firstShared.cta.noRepo": "Open repository setup",
  "collab.firstShared.cta.notDownloaded": "Download repository",
  "collab.firstShared.cta.downloading": "Downloading…",
  "collab.firstShared.gotIt": "Got it",

  "collab.repoConnect.title": "Connect repository",
  "collab.repoConnect.description":
    "This project's code isn't on this computer yet. Clone the team repository to use the Code and Worktree tabs.",
  "collab.repoConnect.manualDescription":
    "This project doesn't have a repository URL yet. Paste the team repository URL to clone it, or connect a folder you already cloned.",
  "collab.repoConnect.status.noRepo.title": "Repository address needed",
  "collab.repoConnect.status.noRepo.body":
    "This project does not have a repository URL yet. Enter the team repository URL, or connect an existing clone so Marblo can remember it for this project.",
  "collab.repoConnect.status.readyToDownload.title":
    "Ready to download on this computer",
  "collab.repoConnect.status.readyToDownload.body":
    "Marblo knows this project's repository. Choose a location, then clone and connect it on this machine.",
  "collab.repoConnect.status.downloading.title": "Downloading repository",
  "collab.repoConnect.status.downloading.body":
    "Marblo is cloning the repository and will connect the local folder when it finishes.",
  "collab.repoConnect.status.downloaded.title": "Repository connected",
  "collab.repoConnect.status.downloaded.body":
    "This machine has a local folder for the project. You can use the Code and Worktree tabs.",
  "collab.repoConnect.repoLabel": "Project repository",
  "collab.repoConnect.urlPlaceholder": "https://github.com/org/repo.git",
  "collab.repoConnect.locationLabel": "Clone location",
  "collab.repoConnect.changeLocation": "Change location",
  "collab.repoConnect.cloneAndConnect": "Clone & connect",
  "collab.repoConnect.cloning": "Cloning…",
  "collab.repoConnect.connectExisting": "Connect existing folder",
  "collab.repoConnect.later": "Later",
  "collab.repoConnect.privateHint":
    "Private repositories require GitHub authentication. Run `gh auth login` in a terminal or register an SSH key, then try again.",
  "collab.repoConnect.errorAuth":
    "Repository authentication failed. For a private repo, authenticate with GitHub (gh auth login or an SSH key) and try again.",
  "collab.repoConnect.errorNotFound":
    "Repository not found. Check the URL — and if it's private, ask the project owner to add you as a GitHub collaborator.",
  "collab.repoConnect.errorNetwork":
    "Clone failed due to a network error. Check your connection and try again.",
  "collab.repoConnect.errorExists":
    "The target folder already exists. Use [Connect existing folder] to link it, or pick another location.",
  "collab.repoConnect.errorGeneric": "Clone failed.",
  "collab.repoConnect.errorInvalidUrl":
    "That repository URL isn't valid. Enter an https://… or git@… URL.",
  "collab.repoConnect.errorMismatch":
    "The selected folder's git origin differs from the project repository. Pick the folder where you cloned this repo.",
  "collab.repoConnect.errorNoRemote":
    "No git origin found in the selected folder. Pick the folder where you cloned this repo.",
  "collab.repoConnect.connectFailed":
    "Failed to record the path on the project.",
  // macOS Xcode Command Line Tools (ticket nETj7szjEtT5prbYsg1D). Until the
  // license is accepted git cannot run at all, so clone/connect always fails.
  // It needs sudo, so the app can only hand over the exact command to run.
  "collab.repoConnect.errorXcodeLicense":
    "You must accept the macOS Xcode Command Line Tools license before git can run. Paste the command below into Terminal, then try again. (It needs an administrator password, so Marblo can't run it for you.)",
  "collab.repoConnect.errorXcodeMissing":
    "The macOS Xcode Command Line Tools (which include git) aren't installed. Paste the command below into Terminal, finish the install, then try again.",
  "collab.repoConnect.copyCommand": "Copy command",
  "collab.repoConnect.copied": "Copied",
  "collab.repoConnect.github.connected": "GitHub connected",
  "collab.repoConnect.github.connect": "Connect GitHub",
  "collab.repoConnect.github.enterCode": "Enter this code on GitHub:",
  "collab.repoConnect.github.open": "Open GitHub",
  "collab.repoConnect.github.message.connected":
    "GitHub is connected. You can now clone private repositories.",
  "collab.repoConnect.github.message.denied": "GitHub connection was canceled.",
  "collab.repoConnect.github.message.expired":
    "The GitHub connection code expired. Try again.",
  "collab.repoConnect.github.message.failed": "GitHub connection failed.",
  "collab.repoConnect.github.message.startFailed":
    "Couldn't start GitHub connection.",
  // own-but-empty hardening (ticket r8vg9pMWCRtdnUzR3KyX). Self-diagnosis
  // shown when the registered own folder is empty or points at a different
  // git remote than the project. Helps the user see why the modal re-appeared
  // and pick "Clone & connect" or "Connect existing folder" to fix it.
  "collab.repoConnect.ownIssue.empty":
    "The folder linked to this project on this machine is empty — `{{path}}`. Clone the project repository into it, or connect a different folder where you already cloned it.",
  "collab.repoConnect.ownIssue.mismatch":
    "The folder linked to this project on this machine has a different git repository — `{{path}}`. Connect a folder where this project's repository is cloned.",
};

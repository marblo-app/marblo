/**
 * English — `collab.*` namespace. Team repo-connect (Clone & connect) modal
 * (ticket r8VggohxLGciDVXV2rf6). Keys mirror ../ko/collaboration.ts.
 */
export const collaboration = {
  "collab.repoConnect.title": "Connect repository",
  "collab.repoConnect.description":
    "This project's code isn't on this computer yet. Clone the team repository to use the Code and Worktree tabs.",
  "collab.repoConnect.manualDescription":
    "This project doesn't have a repository URL yet. Paste the team repository URL to clone it, or connect a folder you already cloned.",
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
  // own-but-empty hardening (ticket r8vg9pMWCRtdnUzR3KyX). Self-diagnosis
  // shown when the registered own folder is empty or points at a different
  // git remote than the project. Helps the user see why the modal re-appeared
  // and pick "Clone & connect" or "Connect existing folder" to fix it.
  "collab.repoConnect.ownIssue.empty":
    "The folder linked to this project on this machine is empty — `{{path}}`. Clone the project repository into it, or connect a different folder where you already cloned it.",
  "collab.repoConnect.ownIssue.mismatch":
    "The folder linked to this project on this machine has a different git repository — `{{path}}`. Connect a folder where this project's repository is cloned.",
};

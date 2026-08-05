export interface FirstSharedProjectModalViewProps {
  projectName: string;
  hasRepoRemote: boolean;
  needsRepoConnect: boolean;
  onClose: () => void;
  onConnectRepo: () => void;
}

export function FirstSharedProjectModalView({
  projectName,
  hasRepoRemote,
  needsRepoConnect,
  onClose,
  onConnectRepo,
}: FirstSharedProjectModalViewProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-shared-project-title"
        className="w-full max-w-xl rounded-lg border border-gray-700 bg-gray-800 shadow-2xl"
      >
        <div className="border-b border-gray-700 px-5 py-4">
          <p className="text-xs font-medium uppercase text-blue-300">
            Shared project
          </p>
          <h2
            id="first-shared-project-title"
            className="mt-1 text-lg font-semibold text-gray-100"
          >
            {projectName}
          </h2>
        </div>

        <div className="space-y-4 px-5 py-5">
          <p className="text-sm leading-6 text-gray-300">
            You have access to the shared board, completion history, and
            activity stream. Source code is not copied through Marblo: each
            teammate keeps code local and syncs changes through git.
          </p>

          <div className="grid gap-2 sm:grid-cols-3">
            {["Board", "Done history", "Activity"].map((label) => (
              <div
                key={label}
                className="rounded border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-sm text-blue-100"
              >
                {label}
              </div>
            ))}
          </div>

          <div className="rounded border border-gray-700 bg-gray-900/70 px-3 py-3">
            <p className="text-sm font-medium text-gray-200">
              Code stays local
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-400">
              Connect or clone the repo on this machine before using the Code
              tab. Presence shows who is active, and same-file conflict warnings
              help avoid overwriting a teammate's work.
            </p>
          </div>

          <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs leading-5 text-amber-100">
            Avoid conflicts by pulling before edits, keeping task ownership
            clear on the board, and pushing changes through the shared git
            remote.
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-xs text-gray-500">
              {hasRepoRemote
                ? "Repo remote is available for this project."
                : "Ask the owner for the git remote if it is missing."}
            </span>
            <div className="flex items-center gap-2">
              {needsRepoConnect && (
                <button
                  type="button"
                  onClick={onConnectRepo}
                  className="rounded border border-blue-500/60 px-3 py-2 text-sm font-medium text-blue-200 hover:bg-blue-500/10"
                >
                  Connect repo
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

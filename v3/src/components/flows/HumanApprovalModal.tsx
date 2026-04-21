interface HumanApprovalModalProps {
  pendingNodeId: string;
  nodeLabel: string;
  onApprove: () => void;
  onReject: () => void;
}

export function HumanApprovalModal({
  pendingNodeId,
  nodeLabel,
  onApprove,
  onReject,
}: HumanApprovalModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-800 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-700 px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500/20">
            <svg
              className="h-5 w-5 text-yellow-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-100">Human Approval Required</h3>
            <p className="text-xs text-gray-400">Flow paused - waiting for your decision</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm text-gray-400">Node:</span>
              <span className="text-sm font-medium text-yellow-400">{nodeLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">ID:</span>
              <span className="text-xs text-gray-500 font-mono">{pendingNodeId}</span>
            </div>
          </div>

          <p className="text-sm text-gray-300">
            This node requires human approval before the flow can continue.
            Please review the current state and choose to approve or reject.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-700 px-6 py-4">
          <button
            onClick={onReject}
            className="rounded-lg border border-red-500/50 bg-red-500/10 px-5 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 hover:border-red-500/70"
          >
            Reject
          </button>
          <button
            onClick={onApprove}
            className="rounded-lg border border-green-500/50 bg-green-500/10 px-5 py-2 text-sm font-medium text-green-400 transition-colors hover:bg-green-500/20 hover:border-green-500/70"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

interface NodeResultPanelProps {
  nodeId: string;
  nodeLabel: string;
  result: unknown;
  onClose: () => void;
}

function isErrorResult(value: unknown): value is { __error: true; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__error' in value &&
    (value as Record<string, unknown>).__error === true
  );
}

/** Simple JSON syntax highlighter for dark theme */
function SyntaxHighlightedJSON({ json }: { json: string }) {
  // Tokenize JSON string into colored spans
  const highlighted = json.replace(
    /("(?:\\.|[^"\\])*")\s*:/g, // keys
    '<span class="text-blue-400">$1</span>:',
  ).replace(
    /:\s*("(?:\\.|[^"\\])*")/g, // string values
    ': <span class="text-green-400">$1</span>',
  ).replace(
    /:\s*(\d+(?:\.\d+)?)/g, // number values
    ': <span class="text-yellow-400">$1</span>',
  ).replace(
    /:\s*(true|false)/g, // boolean values
    ': <span class="text-purple-400">$1</span>',
  ).replace(
    /:\s*(null)/g, // null values
    ': <span class="text-gray-500">$1</span>',
  );

  return (
    <pre
      className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-words leading-relaxed"
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
}

export function NodeResultPanel({ nodeId, nodeLabel, result, onClose }: NodeResultPanelProps) {
  const isError = isErrorResult(result);

  const renderContent = () => {
    if (isError) {
      return (
        <div className="rounded bg-red-900/30 border border-red-700/50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span className="text-sm font-medium text-red-400">Error</span>
          </div>
          <pre className="text-xs text-red-300 font-mono whitespace-pre-wrap break-words">
            {(result as { message: string }).message}
          </pre>
        </div>
      );
    }

    if (result === null || result === undefined) {
      return (
        <p className="text-sm text-gray-500 italic">No output</p>
      );
    }

    if (typeof result === 'string') {
      return (
        <div className="rounded bg-gray-900 border border-gray-700 p-3">
          <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-words leading-relaxed">
            {result}
          </pre>
        </div>
      );
    }

    // Object or array -- formatted JSON
    const jsonStr = JSON.stringify(result, null, 2);
    return (
      <div className="rounded bg-gray-900 border border-gray-700 p-3 max-h-[60vh] overflow-auto">
        <SyntaxHighlightedJSON json={jsonStr} />
      </div>
    );
  };

  return (
    <div className="w-80 flex-shrink-0 border-l border-gray-700 bg-gray-800/80 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-gray-800 z-10">
        <div className={`h-1 ${isError ? 'bg-red-500' : 'bg-green-500'}`} />
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base flex-shrink-0">{isError ? '\u26A0' : '\u2705'}</span>
            <div className="min-w-0">
              <span className={`text-sm font-medium block truncate ${isError ? 'text-red-400' : 'text-green-400'}`}>
                {nodeLabel}
              </span>
              <span className="text-[10px] text-gray-500 block">
                Node Result {nodeId}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-[11px] font-medium text-gray-400">Output</label>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            isError
              ? 'bg-red-900/40 text-red-400'
              : 'bg-green-900/40 text-green-400'
          }`}>
            {isError ? 'error' : typeof result === 'object' && result !== null ? 'object' : typeof result}
          </span>
        </div>
        {renderContent()}
      </div>
    </div>
  );
}

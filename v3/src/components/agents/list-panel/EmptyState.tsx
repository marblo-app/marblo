interface RecentAgent {
  id: string;
  vendor: string;
  ageLabel: string;
}

interface Props {
  recent: RecentAgent[];
  onSpawnClick: () => void;
}

export function EmptyState({ recent, onSpawnClick }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center">
      <div className="text-sm font-medium text-[#cdd6f4]">
        No agents running yet
      </div>
      <div className="mt-1 text-xs text-[#6c7086] max-w-md">
        Marblo orchestrates Claude, Codex, and Gemini in parallel on a shared
        mission graph.
      </div>
      <button
        onClick={onSpawnClick}
        className="mt-3 rounded border border-[#585b70] px-3 py-1.5 text-xs text-[#cdd6f4] transition-colors hover:bg-[#313244]"
      >
        + Spawn agent
        <span className="ml-2 text-[10px] text-[#6c7086]">⌘N</span>
      </button>
      {recent.length > 0 && (
        <div className="mt-4 text-[10px] text-[#6c7086]">
          Recent:{" "}
          {recent.slice(0, 3).map((r, i) => (
            <span key={r.id}>
              {i > 0 && "  ·  "}
              {r.vendor} ({r.ageLabel})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

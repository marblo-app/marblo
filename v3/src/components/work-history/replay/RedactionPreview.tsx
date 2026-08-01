import type { RedactedReplay } from "../../../types/missionReplay";

export interface RedactionPreviewProps {
  redacted: RedactedReplay;
}

/** Shows the exact serialized publication bytes, never a rewritten summary. */
export function RedactionPreview({ redacted }: RedactionPreviewProps) {
  return (
    <section aria-labelledby="redaction-preview-title" className="space-y-3 rounded-xl border border-gray-800 bg-gray-950/70 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 id="redaction-preview-title" className="text-sm font-semibold text-gray-200">발행 바이트 미리보기 · {redacted.level}</h3>
          <p className="mt-1 text-xs text-gray-500">아래 내용이 실제 업로드될 JSON/텍스트입니다.</p>
        </div>
        <span className={redacted.verified ? "text-[11px] text-emerald-400" : "text-[11px] text-red-400"}>
          {redacted.verified ? "검증 통과" : "검증 실패 · 발행 중단"}
        </span>
      </div>
      <pre data-testid="redaction-payload" className="max-h-96 overflow-auto rounded-lg border border-gray-800 bg-black/40 p-3 text-[11px] leading-relaxed text-gray-300" aria-label="실제 발행 JSON">{redacted.serialized}</pre>
      <div className="border-t border-gray-800 pt-3">
        <h4 className="text-xs font-semibold text-gray-300">제거된 항목 {redacted.removed.length}건</h4>
        {redacted.removed.length > 0 ? (
          <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[11px] text-gray-500">
            {redacted.removed.map((item, index) => <li key={`${item.path}-${item.rule}-${index}`}><code>{item.path || "(root)"}</code> · {item.rule} · {item.action}</li>)}
          </ul>
        ) : <p className="mt-1 text-[11px] text-gray-500">제거된 항목이 없습니다.</p>}
      </div>
    </section>
  );
}

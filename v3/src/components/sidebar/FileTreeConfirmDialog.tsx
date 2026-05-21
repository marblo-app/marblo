interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function FileTreeConfirmDialog({
  title,
  message,
  confirmLabel = "확인",
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[400px] max-w-[90vw] rounded-lg border border-gray-700 bg-gray-800 p-5 shadow-2xl">
        <h2 className="mb-2 text-base font-medium text-white">{title}</h2>
        <p className="mb-4 whitespace-pre-line text-sm text-gray-300">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-600"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            className={`rounded px-3 py-1.5 text-sm text-white ${
              danger
                ? "bg-red-600 hover:bg-red-500"
                : "bg-blue-600 hover:bg-blue-500"
            }`}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

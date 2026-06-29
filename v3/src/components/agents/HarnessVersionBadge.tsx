import type { ModelType } from "../../types/agent";
import {
  useHarnessVersions,
  harnessVersionForModel,
} from "../../hooks/useHarnessVersions";
import { useTranslation } from "../../lib/i18n";

interface Props {
  model: ModelType;
  className?: string;
}

/**
 * Small badge showing the installed CLI version for an agent's harness
 * (Claude Code / Codex / Antigravity / Gemini). Hidden for models without a
 * detectable managed CLI (local/custom, or a CLI that isn't installed).
 */
export default function HarnessVersionBadge({ model, className }: Props) {
  const { t } = useTranslation();
  const versions = useHarnessVersions();
  const version = harnessVersionForModel(versions, model);
  if (!version) return null;

  return (
    <span
      title={t("harness.installedCliVersion", { version })}
      className={`rounded bg-gray-700/60 px-1 py-0.5 font-mono text-[9px] leading-none text-gray-400 ${
        className ?? ""
      }`}
    >
      v{version}
    </span>
  );
}

import { useState, useEffect, useCallback } from 'react';

interface ProviderConfig {
  id: string;
  name: string;
  description: string;
  placeholder: string;
  color: string;
  icon: React.ReactNode;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models (claude-opus-5, claude-sonnet-5, claude-fable-5)',
    placeholder: 'sk-ant-api03-...',
    color: 'orange',
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
        <path d="M17.304 3.541l-5.04 13.208H9.29L4.25 3.541h3.27l3.45 9.263 3.45-9.263h2.884zm-7.022 13.208L15.322 3.54h2.928l-5.04 13.208h-2.928z" />
      </svg>
    ),
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI models (gpt-5.6-sol, gpt-5.5, etc.)',
    placeholder: 'sk-proj-...',
    color: 'green',
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.602 1.5v3.001l-2.6 1.5-2.6-1.5z" />
      </svg>
    ),
  },
  {
    id: 'google',
    name: 'Google AI',
    description: 'Gemini models (Google AI Studio key)',
    placeholder: 'AIza...',
    color: 'blue',
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
      </svg>
    ),
  },
];

const colorClasses: Record<string, { bg: string; border: string; text: string; ring: string }> = {
  orange: {
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    text: 'text-orange-400',
    ring: 'focus:ring-orange-500/40',
  },
  green: {
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
    text: 'text-green-400',
    ring: 'focus:ring-green-500/40',
  },
  blue: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    ring: 'focus:ring-blue-500/40',
  },
};

export function APIKeysSettings() {
  const [keys, setKeys] = useState<Record<string, string>>({
    anthropic: '',
    openai: '',
    google: '',
  });
  const [isSet, setIsSet] = useState<Record<string, boolean>>({
    anthropic: false,
    openai: false,
    google: false,
  });
  const [inputs, setInputs] = useState<Record<string, string>>({
    anthropic: '',
    openai: '',
    google: '',
  });
  const [showKey, setShowKey] = useState<Record<string, boolean>>({
    anthropic: false,
    openai: false,
    google: false,
  });
  const [saving, setSaving] = useState<Record<string, boolean>>({
    anthropic: false,
    openai: false,
    google: false,
  });
  const [feedback, setFeedback] = useState<Record<string, { type: 'success' | 'error'; message: string } | null>>({
    anthropic: null,
    openai: null,
    google: null,
  });

  const loadKeys = useCallback(async () => {
    try {
      const result = await window.electronAPI.settings.getApiKeys();
      setKeys({
        anthropic: result.anthropic || '',
        openai: result.openai || '',
        google: result.google || '',
      });
      setIsSet({
        anthropic: result._isSet.anthropic,
        openai: result._isSet.openai,
        google: result._isSet.google,
      });
    } catch (err) {
      console.error('Failed to load API keys:', err);
    }
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleSave = async (provider: string) => {
    const key = inputs[provider].trim();
    if (!key) return;

    setSaving((prev) => ({ ...prev, [provider]: true }));
    setFeedback((prev) => ({ ...prev, [provider]: null }));

    try {
      await window.electronAPI.settings.setApiKey(provider, key);
      setInputs((prev) => ({ ...prev, [provider]: '' }));
      setShowKey((prev) => ({ ...prev, [provider]: false }));
      setFeedback((prev) => ({
        ...prev,
        [provider]: { type: 'success', message: 'API key saved successfully' },
      }));
      await loadKeys();
    } catch (err) {
      setFeedback((prev) => ({
        ...prev,
        [provider]: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to save key',
        },
      }));
    } finally {
      setSaving((prev) => ({ ...prev, [provider]: false }));
      setTimeout(() => {
        setFeedback((prev) => ({ ...prev, [provider]: null }));
      }, 3000);
    }
  };

  const handleDelete = async (provider: string) => {
    setSaving((prev) => ({ ...prev, [provider]: true }));
    setFeedback((prev) => ({ ...prev, [provider]: null }));

    try {
      await window.electronAPI.settings.deleteApiKey(provider);
      setInputs((prev) => ({ ...prev, [provider]: '' }));
      setFeedback((prev) => ({
        ...prev,
        [provider]: { type: 'success', message: 'API key removed' },
      }));
      await loadKeys();
    } catch (err) {
      setFeedback((prev) => ({
        ...prev,
        [provider]: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to delete key',
        },
      }));
    } finally {
      setSaving((prev) => ({ ...prev, [provider]: false }));
      setTimeout(() => {
        setFeedback((prev) => ({ ...prev, [provider]: null }));
      }, 3000);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <h3 className="mb-1 text-sm font-medium text-gray-200">LLM API Keys</h3>
        <p className="text-xs text-gray-500">
          Configure API keys for LLM providers used by the Flow engine. Keys are stored locally in{' '}
          <code className="rounded bg-gray-700 px-1 py-0.5 text-gray-400">~/.marblo/api-keys.json</code>.
        </p>
      </div>

      {PROVIDERS.map((provider) => {
        const colors = colorClasses[provider.color];
        const providerIsSet = isSet[provider.id];
        const providerFeedback = feedback[provider.id];
        const isSaving = saving[provider.id];

        return (
          <div
            key={provider.id}
            className="rounded-lg border border-gray-700 bg-gray-800 p-4"
          >
            {/* Header */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colors.bg} ${colors.text}`}>
                  {provider.icon}
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-200">{provider.name}</h4>
                  <p className="text-xs text-gray-500">{provider.description}</p>
                </div>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  providerIsSet
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : 'bg-gray-600/20 text-gray-500 border border-gray-600/30'
                }`}
              >
                {providerIsSet ? 'Configured' : 'Not set'}
              </span>
            </div>

            {/* Current key display */}
            {providerIsSet && (
              <div className="mb-3 flex items-center gap-2 rounded-md border border-gray-600 bg-gray-900 px-3 py-2">
                <svg
                  className="h-4 w-4 shrink-0 text-gray-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25z"
                  />
                </svg>
                <span className="font-mono text-sm text-gray-400">{keys[provider.id]}</span>
              </div>
            )}

            {/* Input field */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey[provider.id] ? 'text' : 'password'}
                  value={inputs[provider.id]}
                  onChange={(e) =>
                    setInputs((prev) => ({ ...prev, [provider.id]: e.target.value }))
                  }
                  placeholder={providerIsSet ? 'Enter new key to update...' : provider.placeholder}
                  className={`w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 pr-10 text-sm text-gray-200 placeholder-gray-600 outline-none transition-colors focus:border-gray-500 focus:ring-1 ${colors.ring}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && inputs[provider.id].trim()) {
                      handleSave(provider.id);
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() =>
                    setShowKey((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))
                  }
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                  title={showKey[provider.id] ? 'Hide' : 'Show'}
                >
                  {showKey[provider.id] ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"
                      />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                      />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                  )}
                </button>
              </div>

              <button
                onClick={() => handleSave(provider.id)}
                disabled={!inputs[provider.id].trim() || isSaving}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  inputs[provider.id].trim()
                    ? `${colors.bg} ${colors.text} border ${colors.border} hover:opacity-80`
                    : 'bg-gray-700 text-gray-500 border border-gray-600'
                }`}
              >
                {isSaving ? (
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  'Save'
                )}
              </button>

              {providerIsSet && (
                <button
                  onClick={() => handleDelete(provider.id)}
                  disabled={isSaving}
                  className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Remove API key"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                    />
                  </svg>
                </button>
              )}
            </div>

            {/* Feedback message */}
            {providerFeedback && (
              <div
                className={`mt-2 rounded-md px-3 py-1.5 text-xs ${
                  providerFeedback.type === 'success'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-red-500/10 text-red-400'
                }`}
              >
                {providerFeedback.message}
              </div>
            )}
          </div>
        );
      })}

      {/* Info notice */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
        <div className="flex gap-2">
          <svg
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
          <div>
            <p className="text-xs font-medium text-amber-400">Security Note</p>
            <p className="mt-0.5 text-xs text-amber-400/70">
              API keys are stored as plaintext in your local filesystem. Do not share the{' '}
              <code className="rounded bg-amber-500/10 px-1">~/.marblo/</code> directory.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

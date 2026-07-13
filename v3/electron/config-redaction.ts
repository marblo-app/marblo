const SENSITIVE_KEY_PATTERN =
  /(?:api[_-]?key|token|secret|password|credential|authorization|bearer|auth[_-]?token)/i;

export function maskSensitiveValue(value: string): string {
  if (value.length === 0) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function shouldMaskKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function maskConfigForLogging(value: unknown, keyHint = ""): unknown {
  const keyIsSensitive = shouldMaskKey(keyHint);

  if (typeof value === "string") {
    return keyIsSensitive ? maskSensitiveValue(value) : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskConfigForLogging(item, keyHint));
  }

  if (value && typeof value === "object") {
    const masked: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      masked[key] = maskConfigForLogging(child, keyIsSensitive ? keyHint : key);
    }
    return masked;
  }

  return value;
}

export function maskEnvForLogging(
  env: Record<string, string>,
): Record<string, string> {
  return maskConfigForLogging(env) as Record<string, string>;
}

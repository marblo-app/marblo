import fs from "fs";
import path from "path";

type FirebaseConfigField =
  | "apiKey"
  | "authDomain"
  | "projectId"
  | "storageBucket"
  | "messagingSenderId"
  | "appId";

type FirebaseConfigKey = {
  field: FirebaseConfigField;
  firebaseEnv: string;
  viteEnv: string;
};

type MutableEnv = Record<string, string | undefined>;

export type MainFirebaseConfigEnvResult =
  | { status: "skipped"; reason: "not-packaged" | "env-present" }
  | {
      status: "loaded";
      configPath: string;
      injectedKeys: string[];
      apiKeyPresent: boolean;
    }
  | { status: "missing"; configPath: string }
  | { status: "invalid"; configPath: string; reason: string };

const FIREBASE_CONFIG_KEYS: readonly FirebaseConfigKey[] = [
  {
    field: "apiKey",
    firebaseEnv: "FIREBASE_API_KEY",
    viteEnv: "VITE_FIREBASE_API_KEY",
  },
  {
    field: "authDomain",
    firebaseEnv: "FIREBASE_AUTH_DOMAIN",
    viteEnv: "VITE_FIREBASE_AUTH_DOMAIN",
  },
  {
    field: "projectId",
    firebaseEnv: "FIREBASE_PROJECT_ID",
    viteEnv: "VITE_FIREBASE_PROJECT_ID",
  },
  {
    field: "storageBucket",
    firebaseEnv: "FIREBASE_STORAGE_BUCKET",
    viteEnv: "VITE_FIREBASE_STORAGE_BUCKET",
  },
  {
    field: "messagingSenderId",
    firebaseEnv: "FIREBASE_MESSAGING_SENDER_ID",
    viteEnv: "VITE_FIREBASE_MESSAGING_SENDER_ID",
  },
  {
    field: "appId",
    firebaseEnv: "FIREBASE_APP_ID",
    viteEnv: "VITE_FIREBASE_APP_ID",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFirebaseConfig(
  raw: string,
): Partial<Record<FirebaseConfigField, string>> | null {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) return null;

  const config: Partial<Record<FirebaseConfigField, string>> = {};
  for (const key of FIREBASE_CONFIG_KEYS) {
    const value = parsed[key.field];
    if (typeof value === "string" && value.length > 0) {
      config[key.field] = value;
    }
  }
  return config;
}

function hasFirebaseApiKey(env: MutableEnv): boolean {
  return Boolean(env.FIREBASE_API_KEY || env.VITE_FIREBASE_API_KEY);
}

export function loadPackagedMainFirebaseConfigEnv(options: {
  isPackaged: boolean;
  resourcesPath: string;
  env?: MutableEnv;
}): MainFirebaseConfigEnvResult {
  const env = options.env ?? process.env;

  if (!options.isPackaged) {
    return { status: "skipped", reason: "not-packaged" };
  }

  if (hasFirebaseApiKey(env)) {
    return { status: "skipped", reason: "env-present" };
  }

  const configPath = path.join(
    options.resourcesPath,
    "dist-mcp",
    "firebase-config.json",
  );

  let rawConfig: string;
  try {
    rawConfig = fs.readFileSync(configPath, "utf-8");
  } catch {
    return { status: "missing", configPath };
  }

  let config: Partial<Record<FirebaseConfigField, string>> | null;
  try {
    config = parseFirebaseConfig(rawConfig);
  } catch {
    return { status: "invalid", configPath, reason: "malformed-json" };
  }

  if (!config) {
    return { status: "invalid", configPath, reason: "not-object" };
  }

  const injectedKeys: string[] = [];
  for (const key of FIREBASE_CONFIG_KEYS) {
    const existing = env[key.firebaseEnv] || env[key.viteEnv];
    const value = existing || config[key.field];
    if (!value) continue;

    if (!env[key.firebaseEnv]) {
      env[key.firebaseEnv] = value;
      injectedKeys.push(key.firebaseEnv);
    }
    if (!env[key.viteEnv]) {
      env[key.viteEnv] = value;
      injectedKeys.push(key.viteEnv);
    }
  }

  return {
    status: "loaded",
    configPath,
    injectedKeys,
    apiKeyPresent: hasFirebaseApiKey(env),
  };
}

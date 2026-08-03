export interface PackagedOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  githubClientId?: string;
}

export function applyPackagedOAuthConfig(
  cfg: PackagedOAuthConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (cfg.clientId && !env.VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID) {
    env.VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID = cfg.clientId;
  }
  if (cfg.clientSecret && !env.GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET) {
    env.GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET = cfg.clientSecret;
  }
  if (cfg.githubClientId && !env.GITHUB_OAUTH_CLIENT_ID) {
    env.GITHUB_OAUTH_CLIENT_ID = cfg.githubClientId;
  }
}

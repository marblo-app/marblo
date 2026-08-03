import { describe, expect, it } from "vitest";
import { applyPackagedOAuthConfig } from "../../electron/oauth-config-env";

describe("packaged OAuth config env injection", () => {
  it("injects GitHub client id without overwriting an existing env value", () => {
    const env: NodeJS.ProcessEnv = { GITHUB_OAUTH_CLIENT_ID: "existing-github-client-id" };

    applyPackagedOAuthConfig({ githubClientId: "packaged-github-client-id" }, env);

    expect(env.GITHUB_OAUTH_CLIENT_ID).toBe("existing-github-client-id");
  });

  it("injects GitHub client id when env is empty", () => {
    const env: NodeJS.ProcessEnv = {};

    applyPackagedOAuthConfig({ githubClientId: "packaged-github-client-id" }, env);

    expect(env.GITHUB_OAUTH_CLIENT_ID).toBe("packaged-github-client-id");
  });
});

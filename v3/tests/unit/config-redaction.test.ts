import { describe, expect, it } from "vitest";
import {
  maskConfigForLogging,
  maskEnvForLogging,
} from "../../electron/config-redaction";

describe("config redaction", () => {
  it("masks service account private keys and tokens", () => {
    const masked = maskConfigForLogging({
      serviceAccount: {
        private_key: "-----BEGIN PRIVATE KEY-----abc123xyz",
        client_email: "svc@example.iam.gserviceaccount.com",
      },
      firebaseConfig: {
        apiKey: "AIzaSyDummYKeyForTesting1234",
        projectId: "marblo-2253d",
      },
      paddleClientToken: "paddle-token-1234567890",
    });

    expect(masked).toEqual({
      serviceAccount: {
        private_key: "----***3xyz",
        client_email: "svc@***.com",
      },
      firebaseConfig: {
        apiKey: "AIza***1234",
        projectId: "marblo-2253d",
      },
      paddleClientToken: "padd***7890",
    });
  });

  it("masks env records without removing non-sensitive config", () => {
    expect(
      maskEnvForLogging({
        FIREBASE_PROJECT_ID: "marblo-2253d",
        TOSS_SECRET_KEY: "test_sk_1234567890",
        GOOGLE_APPLICATION_CREDENTIALS: "/secure/service-account.json",
      }),
    ).toEqual({
      FIREBASE_PROJECT_ID: "marblo-2253d",
      TOSS_SECRET_KEY: "test***7890",
      GOOGLE_APPLICATION_CREDENTIALS: "/sec***json",
    });
  });
});

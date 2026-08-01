/**
 * Shared helpers for the redaction regression suite (§5.6).
 * 미탐 0 증명이 목표: 시크릿의 "한 조각"도 최종 payload 에 남으면 실패한다.
 */
import { expect } from "vitest";

export function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

/** Percent-encode every single character (aggressive URL-encoding evasion). */
export function percentEncodeAll(s: string): string {
  return Array.from(s)
    .map((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code < 256 ? `%${code.toString(16).padStart(2, "0")}` : c;
    })
    .join("");
}

/** Distinctive fragments (start / middle / end) of a planted form. */
export function fragmentsOf(form: string): string[] {
  const clean = form;
  if (clean.length <= 12) return [clean];
  const mid = Math.floor(clean.length / 2) - 6;
  return [clean.slice(0, 12), clean.slice(mid, mid + 12), clean.slice(-12)];
}

/**
 * Assert that no representation of `secret` (raw, URL-encoded, base64)
 * survives anywhere in the serialized payload — not even a fragment.
 */
export function expectNoTrace(payload: unknown, secret: string): void {
  const serialized = JSON.stringify(payload) ?? "";
  const forms = [secret, encodeURIComponent(secret), b64(secret)];
  for (const form of forms) {
    for (const frag of fragmentsOf(form)) {
      expect(serialized).not.toContain(frag);
    }
  }
}

/**
 * 시크릿 코퍼스 — §5.6 test 1. 실제 형태의 가짜 키 (벤더별 접두사·구조·엔트로피).
 * 전부 조작된 값이다(실키 아님).
 */
export const SECRET_CORPUS: ReadonlyArray<{ name: string; value: string }> = [
  {
    name: "anthropic",
    value: "sk-ant-api03-Xk7Qw9Zr2Lm8Pv3Ty6Ub1Nc4Rf5Vh8Jd2Ws6",
  },
  {
    name: "openai-project",
    value: "sk-proj-Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0UvWx",
  },
  { name: "openai-legacy", value: "sk-AbCdEf123456GhIjKl7890MnOpQrStUv" },
  { name: "openrouter", value: "sk-or-v1-9f8e7d6c5b4a3210fedcba9876543210" },
  { name: "stripe-secret", value: "sk_live_4eC39HqLyjWDarjtT1zdp7dcAbCdEf" },
  { name: "stripe-test", value: "sk_test_51H8xyzABCdefGHIjklMNOpqrStUv" },
  { name: "stripe-restricted", value: "rk_live_51H8abcDEFghiJKLmnoPQRstUvWx" },
  {
    name: "stripe-publishable",
    value: "pk_live_51H8pqrSTUvwxYZAbcdEFGhijKlMn",
  },
  { name: "stripe-webhook", value: "whsec_AbCdEfGhIjKlMnOpQrStUvWxYz1234" },
  { name: "google-api", value: "AIzaSyD9tSrke72PouQMnMXa7eZSW0jkFMBWY" },
  {
    name: "google-oauth-access",
    value: "ya29.a0AfH6SMBxKq2AbCdEfGhIjKlMnOpQr",
  },
  { name: "google-oauth-refresh", value: "1//0gAbCdEfGhIjKlMnOpQrStUvWxYz12" },
  { name: "xai", value: "xai-Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56" },
  {
    name: "github-fine-pat",
    value: "github_pat_11ABCDEFG0abcdefghijklmnopqrstuv",
  },
  { name: "github-ghp", value: "ghp_16C7e42F292c6912E7710c838347Ae178B4a" },
  { name: "github-gho", value: "gho_26D8f53G303d7023F8821d949458Bf289C5b" },
  { name: "github-ghs", value: "ghs_36E9g64H414e8134G9932e050569Cg390D6c" },
  { name: "github-ghu", value: "ghu_46F0h75I525f9245H0043f161670Dh401E7d" },
  { name: "gitlab-pat", value: "glpat-xY9zW8vU7tS6rQ5pO4nM3lK2jI" },
  { name: "grafana-cloud", value: "glc_eyJvIjoiMTIzNDU2IiwibiI6InRva2VuIn0=" },
  { name: "slack-bot", value: "xoxb-1234567890-AbCdEfGhIjKlMnOpQrStUv" },
  { name: "slack-user", value: "xoxp-9876543210-ZyXwVuTsRqPoNmLkJiHgFe" },
  {
    name: "slack-webhook",
    value:
      "https://hooks.slack.com/services/T00000000/B00000000/XxYyZz0123456789AbCdEfGh",
  },
  { name: "aws-access-key", value: "AKIAIOSFODNN7EXAMPLE" },
  { name: "aws-sts-key", value: "ASIAIOSFODNN7EXAMPLE" },
  {
    name: "aws-secret-entropy",
    value: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  },
  { name: "huggingface", value: "hf_AbCdEfGhIjKlMnOpQrStUvWxYz123456" },
  { name: "nvidia", value: "nvapi-Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv" },
  { name: "perplexity", value: "pplx-abc123def456ghi789jkl012mno345pq" },
  { name: "replicate", value: "r8_AbCdEf123456GhIjKl7890MnOpQrStUv" },
  {
    name: "digitalocean-pat",
    value: "dop_v1_0123456789abcdef0123456789abcdef",
  },
  {
    name: "digitalocean-oauth",
    value: "doo_v1_fedcba9876543210fedcba9876543210",
  },
  {
    name: "sendgrid",
    value: "SG.AbCdEfGhIjKlMnOpQrSt.UvWxYz0123456789AbCdEfGhIjKlMnOp",
  },
  { name: "mailgun", value: "key-0123456789abcdef0123456789abcdef" },
  { name: "groq", value: "gsk_AbCdEfGhIjKlMnOpQrStUvWxYz123456" },
  { name: "npm", value: "npm_AbCdEfGhIjKlMnOpQrStUvWxYz123456" },
  { name: "pypi", value: "pypi-AgEIcHlwaS5vcmcCJDAwZmY0MDBl" },
  { name: "shopify", value: "shpat_0123456789abcdef0123456789abcdef" },
  { name: "square-access", value: "sq0atp-AbCdEfGhIjKlMnOpQrStUv" },
  { name: "square-secret", value: "sq0csp-ZyXwVuTsRqPoNmLkJiHgFe" },
  { name: "figma", value: "figd_AbCdEfGhIjKlMnOpQrStUvWxYz12" },
  { name: "linear", value: "lin_api_AbCdEfGhIjKlMnOpQrStUvWx" },
  { name: "tavily", value: "tvly-AbCdEfGhIjKlMnOpQrStUvWxYz12" },
  { name: "sentry-org", value: "sntrys_eyJpYXQiOjE2OTk5OTk5OTl9_AbCdEf" },
  { name: "notion-new", value: "ntn_AbCdEfGhIjKlMnOpQrStUvWxYz123456" },
  { name: "notion-legacy", value: "secret_AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
  { name: "meta-graph", value: "EAAGm0PX4ZCpsBAAbCdEfGhIjKl0MnOpQrSt" },
  { name: "age-secret", value: "AGE-SECRET-KEY-1QQPQZRS5PQZRS5PQZRS5QQPQZRS5" },
  { name: "docker-pat", value: "dckr_pat_AbCdEfGhIjKlMnOpQrStUvWx" },
  { name: "flyio", value: "flyv1_AbCdEfGhIjKlMnOpQrStUvWx" },
  { name: "render", value: "rnd_AbCdEfGhIjKlMnOpQrStUvWx12" },
  { name: "vercel", value: "vercel_AbCdEfGhIjKlMnOpQrStUvWx" },
  { name: "contentful", value: "cda_AbCdEfGhIjKlMnOpQrStUvWx12" },
  { name: "hubspot", value: "pat-na1-01234567-89ab-cdef-0123-456789abcdef" },
  {
    name: "jwt",
    value:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c",
  },
  {
    name: "pem",
    value:
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA7bq3xyz0123456789\n-----END RSA PRIVATE KEY-----",
  },
  {
    name: "conn-postgres",
    value: "postgres://admin:supersecretpw9@db.prod.example.com:5432/main",
  },
  {
    name: "conn-mongodb",
    value: "mongodb+srv://root:hunter2pass8@cluster0.example.mongodb.net",
  },
  {
    name: "conn-redis",
    value: "redis://default:redispass1234@cache.example.com:6379",
  },
  {
    name: "conn-mysql",
    value: "mysql://svc:dbpass5678xyz@db.example.com:3306/app",
  },
  { name: "conn-amqp", value: "amqp://guest:rabbitpass77@mq.example.com:5672" },
  {
    name: "url-basic-auth",
    value: "https://deploy:CiPass99secret@git.example.com/repo.git",
  },
  {
    name: "entropy-base64-32",
    value: "K9fQ2xR7mW4jL8nP3vT6yB1cD5gH0aZsE2uI7oXq",
  },
  {
    name: "entropy-hex-64",
    value: "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0",
  },
];

/** BIP39 니모닉 코퍼스 — §5.7 F1. 표준 테스트 벡터(실지갑 아님). */
export const MNEMONIC_CORPUS: ReadonlyArray<{ name: string; value: string }> = [
  {
    name: "mnemonic-12",
    value:
      "legal winner thank year wave sausage worth useful legal winner thank yellow",
  },
  {
    name: "mnemonic-24-repeat",
    value:
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
  },
  {
    name: "mnemonic-12-letter",
    value:
      "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
  },
];

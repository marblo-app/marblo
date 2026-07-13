import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInWithCustomToken } from "firebase/auth";
// env → 값 (FIREBASE_* 우선, 없으면 VITE_FIREBASE_*).
function fromEnv() {
    return {
        apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || "",
        authDomain: process.env.FIREBASE_AUTH_DOMAIN ||
            process.env.VITE_FIREBASE_AUTH_DOMAIN ||
            "",
        projectId: process.env.FIREBASE_PROJECT_ID ||
            process.env.VITE_FIREBASE_PROJECT_ID ||
            "",
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET ||
            process.env.VITE_FIREBASE_STORAGE_BUCKET ||
            "",
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID ||
            process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
            "",
        appId: process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || "",
    };
}
// 패키지 앱에서 이 MCP child 는 별도 node 프로세스라 process.env 에 Firebase
// 설정이 없다(dev 만 .env/vite 로 존재). electron main 이 아니라 이 프로세스가
// 자기완결적으로 붙도록, env 가 비면 자기 옆에 번들된 공개 firebase-config.json
// 을 읽는다. esbuild 번들 후 import.meta.url 은 dist-mcp/index.js 를 가리키므로
// Resources/dist-mcp/firebase-config.json 이 sibling 으로 해석된다(dev 는 파일이
// 없어 catch → env 사용). 이게 없으면 apiKey="" 로 getAuth 가 모듈 로드 중
// auth/invalid-api-key 로 크래시 → -32000. 티켓 MRJKgyJ4C1qPhj2Ui3vJ.
function fromBundledFile() {
    try {
        const p = fileURLToPath(new URL("./firebase-config.json", import.meta.url));
        return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
    catch {
        return {};
    }
}
function resolveFirebaseConfig() {
    const env = fromEnv();
    if (env.apiKey)
        return env;
    // env 부재(패키지 경로): 번들 파일을 베이스로, 개별적으로 세팅된 env 값만 덮어씀.
    const disk = fromBundledFile();
    const merged = { ...disk };
    for (const [k, v] of Object.entries(env)) {
        if (v)
            merged[k] = v;
    }
    return {
        apiKey: merged.apiKey || "",
        authDomain: merged.authDomain || "",
        projectId: merged.projectId || "",
        storageBucket: merged.storageBucket || "",
        messagingSenderId: merged.messagingSenderId || "",
        appId: merged.appId || "",
    };
}
const firebaseConfig = resolveFirebaseConfig();
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);
// MCP 서버는 별도 프로세스로 실행되어 renderer Firebase Auth 컨텍스트가 없음.
// main 이 전달한 custom token 으로만 실제 사용자 uid 로그인을 허용한다.
// 토큰이 없거나 만료/거부되면 fail-closed 로 서버 시작을 중단한다.
const auth = getAuth(app);
export function getCurrentAuthUid() {
    return auth.currentUser?.uid ?? null;
}
function getFirebaseAuthErrorCode(error) {
    if (typeof error === "object" && error !== null && "code" in error) {
        const code = error.code;
        if (typeof code === "string")
            return code;
    }
    return "unknown";
}
async function signInWithRequiredCustomToken() {
    const customToken = process.env.MARBLO_FIREBASE_CUSTOM_TOKEN;
    if (!customToken) {
        throw new Error("Missing MARBLO_FIREBASE_CUSTOM_TOKEN");
    }
    try {
        await signInWithCustomToken(auth, customToken);
    }
    catch (err) {
        throw new Error(`Firebase custom-token auth failed (code=${getFirebaseAuthErrorCode(err)}); refusing anonymous fallback`);
    }
}
// 인증이 네트워크 지연 등으로 영영 settle 되지 않으면 서버를 시작하지 않는다.
// Firestore rules 가 project membership 을 강제하므로, 인증 실패를 anonymous 로
// 완화하면 cross-tenant 하드닝을 우회하는 fail-open 이 된다.
const AUTH_TIMEOUT_MS = 10_000;
// 주의: 반드시 stderr 로만 출력. stdio MCP transport 가 stdout 으로 JSONRPC
// 프레임을 주고받기 때문에 console.log 로 한 줄이라도 흘리면 strict 클라이언트
// (Codex 등) 가 initialize response 를 파싱 못하고 connection 을 끊음.
export const authReady = (async () => {
    let timer;
    try {
        await Promise.race([
            signInWithRequiredCustomToken(),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(`Firebase custom-token auth timed out after ${AUTH_TIMEOUT_MS}ms`));
                }, AUTH_TIMEOUT_MS);
                if (typeof timer.unref === "function")
                    timer.unref();
            }),
        ]);
        console.error(`[MCP] Firebase custom-token auth OK (uid=${auth.currentUser?.uid ?? "unknown"})`);
    }
    catch (err) {
        console.error(`[MCP] Firebase custom-token auth failed; refusing to start (code=${getFirebaseAuthErrorCode(err)})`);
        throw err;
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
})();
//# sourceMappingURL=firebase.js.map
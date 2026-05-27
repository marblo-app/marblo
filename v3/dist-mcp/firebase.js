import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
const firebaseConfig = {
  apiKey:
    process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || "",
  authDomain:
    process.env.FIREBASE_AUTH_DOMAIN ||
    process.env.VITE_FIREBASE_AUTH_DOMAIN ||
    "",
  projectId:
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    "",
  storageBucket:
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET ||
    "",
  messagingSenderId:
    process.env.FIREBASE_MESSAGING_SENDER_ID ||
    process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
    "",
  appId: process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || "",
};
const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);
// MCP 서버는 별도 프로세스로 실행되어 Firebase Auth 컨텍스트가 없음.
// 익명 인증으로 Firestore 보안 규칙의 isAuthenticated() 체크를 통과.
const auth = getAuth(app);
export const authReady = signInAnonymously(auth)
  .then(() => console.error("[MCP] Firebase anonymous auth OK"))
  .catch((err) => console.error("[MCP] Firebase anonymous auth failed:", err));
//# sourceMappingURL=firebase.js.map

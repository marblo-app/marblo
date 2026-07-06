import { initializeApp } from "firebase/app";
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
} from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
// initializeAuth(getAuth 대신): persistence 를 명시적 폴백 배열로 지정한다.
// 패키징 앱은 electron main 의 http.createServer 로 127.0.0.1:랜덤포트 static
// server 에서 로드되는데, 이 origin 에서 Firebase 의 기본 persistence(IndexedDB)
// 초기화가 네트워크 요청 이전 단계에서 조용히 hang → onAuthStateChanged 미발화 →
// 로그인 불가 회귀가 발생했다 (티켓 Oq63rrnxMYv6fdeNeani). 폴백 순서대로 시도:
// IndexedDB → localStorage → in-memory. 랜덤포트라 cross-launch persistence 는
// 어차피 유지되지 않으므로 하위 폴백으로 내려가도 UX 손실은 미미하다.
// ★popupRedirectResolver: initializeAuth 는 getAuth 와 달리 기본 resolver 를
// 자동 포함하지 않는다. 이게 없으면 signInWithPopup(Google) 이
// auth/argument-error 로 실패한다 (티켓 HYvcR2xwBf5uTkHpkKS8). browserPopup
// RedirectResolver 를 명시해 팝업/리다이렉트 로그인을 복구한다.
export const auth = initializeAuth(app, {
  persistence: [
    indexedDBLocalPersistence,
    browserLocalPersistence,
    inMemoryPersistence,
  ],
  popupRedirectResolver: browserPopupRedirectResolver,
});
// ignoreUndefinedProperties: mission engine 등에서 partial patch 시
// optional 필드가 undefined 로 새어 들어가도 addDoc/updateDoc 가 실패하지 않도록.
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
export const functions = getFunctions(app);

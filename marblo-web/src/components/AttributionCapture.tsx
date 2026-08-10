"use client";

import { useEffect } from "react";
import { captureFirstTouch } from "@/lib/attribution";

/**
 * 최초 랜딩의 유입맥락(utm/referrer/랜딩경로)을 브라우저에 **1회** 기록한다.
 * 이미 기록돼 있으면 덮어쓰지 않는다(first-touch 보존, lib/attribution 참조).
 *
 * GA4 로더(`GoogleAnalytics`)와 별개인 이유: 측정ID 가 없거나 GA4 가 광고차단에
 * 막힌 세션에서도 유입 채널만큼은 남겨야 앱 링크백이 채널 폴백을 실을 수 있다.
 *
 * 렌더 결과 없음. 수집 값은 전부 비식별이며 이 컴포넌트는 아무것도 전송하지
 * 않는다 — 전송은 사용자가 앱을 설치하고 `/link` 를 열 때 한 번만 일어난다.
 */
export default function AttributionCapture() {
  useEffect(() => {
    captureFirstTouch();
  }, []);
  return null;
}

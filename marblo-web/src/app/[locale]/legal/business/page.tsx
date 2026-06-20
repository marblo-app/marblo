"use client";

import { useTranslations } from "next-intl";
import LegalPageLayout from "@/components/LegalPageLayout";

const LAST_UPDATED = "2026-05-25";

export default function BusinessInfoPage() {
  const t = useTranslations("footer");

  const rows: Array<[string, string]> = [
    [t("biz_ceo_label"), t("biz_ceo_value")],
    [t("biz_reg_no_label"), t("biz_reg_no_value")],
    [t("biz_tp_no_label"), t("biz_tp_no_value")],
    [t("biz_address_label"), t("biz_address_value")],
    [t("biz_email_label"), t("biz_email_value")],
    [t("biz_phone_label"), t("biz_phone_value")],
  ];

  return (
    <LegalPageLayout
      title={t("business_info")}
      lastUpdated={LAST_UPDATED}
      showDraftNotice={false}
    >
      <p>
        대한민국 「전자상거래 등에서의 소비자보호에 관한 법률」 제13조 및
        시행령에 따라 다음과 같이 사업자 정보를 게시합니다.
      </p>

      <h2>{t("biz_company_name")}</h2>
      <dl className="not-prose grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-6 gap-y-3 bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 my-6">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-sm text-zinc-500">{label}</dt>
            <dd className="text-sm text-zinc-200">{value}</dd>
          </div>
        ))}
      </dl>

      <h2>통신판매업 신고 확인</h2>
      <p>
        본 사업자의 통신판매업 신고 정보는 공정거래위원회 사업자정보공개
        포털에서 확인하실 수 있습니다.
      </p>
      <ul>
        <li>
          공정거래위원회 사업자정보 조회:{" "}
          <a
            href="https://www.ftc.go.kr/bizCommPop.do?wrkr_no=4088802189"
            target="_blank"
            rel="noopener noreferrer"
          >
            바로가기 →
          </a>
        </li>
        <li>사업자등록번호로 직접 조회: 408-88-02189</li>
      </ul>

      <h2>호스팅 서비스 제공자</h2>
      <p>
        본 웹사이트는 Vercel Inc. 와 Cloudflare Inc. 의 글로벌 인프라를 통해
        호스팅되며, 백엔드는 Google Firebase (Firestore, Authentication) 를
        사용합니다.
      </p>

      <h2>분쟁 처리 / 고객 응대</h2>
      <p>
        본 사이트 이용 중 발생하는 모든 문의 사항과 분쟁은 아래 연락처로 접수해
        주시면 영업일 기준 3일 이내에 회신드립니다.
      </p>
      <ul>
        <li>이메일: john.kim@hypemarc.com</li>
        <li>전화: 010-3019-7778 (평일 10:00–18:00, 한국 시간)</li>
      </ul>
    </LegalPageLayout>
  );
}

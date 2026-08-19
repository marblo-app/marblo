"use client";

import { useLocale } from "next-intl";
import Link from "next/link";
import LegalPageLayout from "@/components/LegalPageLayout";
import { lectures } from "@/data/lectures";

const PUBLISHED_AT = "2026-08-19";

const noticeTitle = (locale: string) =>
  locale === "ja" ? "お知らせ" : locale === "en" ? "Notices" : "공지사항";

const publishedLabel = (locale: string) =>
  locale === "ja" ? "掲載日" : locale === "en" ? "Published" : "게시일";

const refundNoticeTitle = (locale: string) =>
  locale === "ja"
    ? "販売者都合による返金のご案内"
    : locale === "en"
      ? "Seller-Fault Refund Notice"
      : "판매자 귀책 환불 안내";

const lectureNoticeTitle = (locale: string) =>
  locale === "ja"
    ? "講座募集のご案内"
    : locale === "en"
      ? "Course Enrollment Notice"
      : "강의 모집 안내";

const courseLabels = (locale: string) => {
  if (locale === "ja") {
    return {
      start: "開講",
      enrollment: "募集",
      access: "受講期間",
      failure: "募集不成立の場合",
    };
  }

  if (locale === "en") {
    return {
      start: "Course start",
      enrollment: "Enrollment",
      access: "Access period",
      failure: "If the course cannot open",
    };
  }

  return {
    start: "개강",
    enrollment: "모집",
    access: "수강기간",
    failure: "모집 실패 시",
  };
};

// This notice covers the sole published course. Use a slug lookup if more
// courses are added.
const courseField = <T extends keyof (typeof lectures)[number]>(field: T) =>
  lectures[0][field];

export default function NoticePage() {
  const locale = useLocale();
  const suffix = locale === "ja" ? "ja" : locale === "en" ? "en" : "ko";

  const enrollmentPeriod = courseField(`enrollmentPeriod_${suffix}`);
  const courseStartDate = courseField(`courseStartDate_${suffix}`);
  const courseAccessPeriod = courseField(`courseAccessPeriod_${suffix}`);
  const enrollmentFailurePolicy = courseField(
    `enrollmentFailurePolicy_${suffix}`,
  );
  const labels = courseLabels(locale);

  return (
    <LegalPageLayout title={noticeTitle(locale)} lastUpdated={PUBLISHED_AT}>
      <article>
        <h2>{refundNoticeTitle(locale)}</h2>
        <p>
          {publishedLabel(locale)}: {PUBLISHED_AT}
        </p>
        <p>
          Marblo의 <strong>시스템 오류, 서비스 또는 콘텐츠의 하자, 약정한
          서비스·콘텐츠의 미제공</strong> 등 판매자 귀책 사유가 발생한 경우,
          강의와 구독(Pro / Team / Team Plus) 모두에 대하여 해당 사유가 발생한
          날부터 <strong>7일 이내</strong> 환불을 신청할 수 있으며, 결제 금액을
          <strong>전액 환불</strong>합니다.
        </p>
        <p>
          이 조항은 이용자의 무과실 청약 철회와 별도의 환불 기준이며,{" "}
          <Link href={`/${locale}/legal/refund`}>환불정책</Link>에 명시된 강의
          청약 철회 및 부분 환불 기준에 우선하여 적용됩니다. 따라서 판매자 귀책
          사유에 따른 환불에는 <strong>강의 진도율, 자료 다운로드 여부, 이용량
          또는 구독 경과 기간</strong>과 관계없이 환불 제한을 적용하지 않습니다.
          예정된 강의의 오픈이 불가능한 경우는 콘텐츠 미제공에 해당하며, 결제
          금액을 전액 환불합니다.
        </p>
      </article>

      <article>
        <h2>{lectureNoticeTitle(locale)}</h2>
        <p>
          {publishedLabel(locale)}: {PUBLISHED_AT}
        </p>
        <ul>
          <li>{labels.start}: {courseStartDate}</li>
          <li>{labels.enrollment}: {enrollmentPeriod}</li>
          <li>{labels.access}: {courseAccessPeriod}</li>
          <li>{labels.failure}: {enrollmentFailurePolicy}</li>
        </ul>
      </article>
    </LegalPageLayout>
  );
}

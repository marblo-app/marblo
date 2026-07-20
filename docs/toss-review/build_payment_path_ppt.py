#!/usr/bin/env python3
"""토스페이먼츠 카드사 심사용 '결제경로' PPT 2종 생성기.

공식 양식(토스페이먼츠_홈페이지 결제경로 제작 가이드.pdf / _정기결제용.pdf)의
p.3 '결제경로 순서 및 도식화' 6단계 구성을 그대로 따른다.

  ① 가맹점 정보 기재(표지)   상호명 / 사업자번호 / 가맹점URL / 테스트 ID·PW
  ② 하단정보 캡처            일반: 상호명·사업자번호·대표자명·사업자주소·상점전화번호·통신판매업신고번호
                             정기결제: 상호명·사업자번호·대표자명·사업자주소
  ③ 환불규정 캡처
  ④ 로그인 / 회원가입 경로 캡처   (비회원 구매가 가능하면 생략 가능)
  ⑤ 상품선택 / 구매과정 캡처      (유형·무형 상품 동일)
  ⑥ 카드 결제경로 캡처            정기결제본은 '정기결제용 카드 입력창'까지 필수

캡처 이미지는 captures/ 에 슬라이드별 파일명으로 두면 자동으로 삽입된다.
파일이 없으면 심사관/사장님이 채울 수 있도록 ⚠ 자리표시 슬라이드가 생성된다.
★자리표시를 임의 이미지나 모크업으로 채우지 말 것 — 심사 제출 서류다.

실행:  python3 docs/toss-review/build_payment_path_ppt.py
"""

import os
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

HERE = Path(__file__).resolve().parent
CAPTURES = HERE / "captures"

# ---------------------------------------------------------------- 가맹점 정보
# 출처: marblo-web/messages/ko.json 의 footer.* (사이트 푸터·/legal/business 와 동일 소스).
# 임의로 지어낸 값이 아니라 실제 서비스가 렌더링하는 값이다.
MERCHANT = {
    "상호명": "주식회사 하이프마크 (HYPEMARC)",
    "사업자번호": "408-88-02189",
    "대표자명": "김동원",
    "사업자주소": "서울특별시 송파구 백제고분로50길 16, 2층",
    "상점 전화번호": "010-3019-7778",
    "통신판매업 신고번호": "2026-서울송파-1496",
    "URL": "https://marblo.app",
}

# 심사관 전달용 테스트 계정 (2026-07-20 발급 완료).
# ★필수다(생략 불가). 실측 결과 /ko/checkout 은 비로그인 시
#   /ko/auth/login?redirect=... 로 리다이렉트된다 → 비회원 구매 불가.
#   계약과정 FAQ 10번: 비회원 접근이 불가하면 '심사관이 확인할 수 있는 테스트 계정'을
#   반드시 전달해야 하고, 없으면 결제창 미확인으로 반려된다.
#
# ★비밀번호는 소스에 하드코딩하지 않는다. 환경변수로 주입한다:
#
#     MARBLO_TOSS_REVIEW_PW='...' python3 docs/toss-review/build_payment_path_ppt.py
#
#   생성된 .pptx 에는 자격증명이 들어간다(토스가 요구하는 제출물이므로 정상).
#   소스에만 남기지 않는 것이 목적이다.
#   미설정 시 표지에 ⚠ 자리표시자가 박히고 콘솔에 경고가 나온다 —
#   자격증명 없는 서류가 조용히 제출되는 것을 막기 위해 일부러 눈에 띄게 실패시킨다.
TEST_ID = os.environ.get("MARBLO_TOSS_REVIEW_ID", "test@hypemarc.com")
TEST_PW = os.environ.get("MARBLO_TOSS_REVIEW_PW")  # 미설정이면 None

# 표지 하단 메모. 심사관이 계정 성격을 오해하지 않도록 명시한다.
COVER_NOTE = "※ 심사 확인용 계정입니다. 마케팅 수신에는 동의하지 않았으며 필수 약관 3개(개인정보 수집·이용 / 국외 이전 / 만 14세 이상)에만 동의되어 있습니다."

# ------------------------------------------------------------------ 스타일
SLIDE_W, SLIDE_H = Inches(13.333), Inches(7.5)
BLUE = RGBColor(0x32, 0x6C, 0xF6)
DARK = RGBColor(0x19, 0x1F, 0x28)
GREY = RGBColor(0x6B, 0x76, 0x84)
WARN_BG = RGBColor(0xFF, 0xF4, 0xE5)
WARN_LINE = RGBColor(0xE8, 0x8C, 0x00)
WARN_TEXT = RGBColor(0x8A, 0x52, 0x00)
FONT = "맑은 고딕"  # 계약담당자 환경(Windows PowerPoint) 기준


def _text(frame, runs, align=PP_ALIGN.LEFT):
    """runs = [(text, size, bold, color), ...] → 문단 채우기."""
    frame.word_wrap = True
    for i, (txt, size, bold, color) in enumerate(runs):
        p = frame.paragraphs[0] if i == 0 else frame.add_paragraph()
        p.alignment = align
        r = p.add_run()
        r.text = txt
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.color.rgb = color
        r.font.name = FONT


def add_slide(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])  # 빈 레이아웃


def step_header(slide, step_label, title, subtitle=None):
    """공식 양식의 '⑤ 상품 선택/구매과정 캡처' 파란 배지 + 설명 헤더."""
    badge = slide.shapes.add_textbox(Inches(4.6), Inches(0.22), Inches(4.13), Inches(0.42))
    badge.fill.solid()
    badge.fill.fore_color.rgb = BLUE
    badge.line.fill.background()
    tf = badge.text_frame
    tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    _text(tf, [(step_label, 14, True, RGBColor(0xFF, 0xFF, 0xFF))], PP_ALIGN.CENTER)

    box = slide.shapes.add_textbox(Inches(0.6), Inches(0.75), Inches(12.1), Inches(0.75))
    runs = [(title, 15, True, DARK)]
    if subtitle:
        runs.append((subtitle, 11, False, GREY))
    _text(box.text_frame, runs, PP_ALIGN.CENTER)


def page_number(slide, n):
    box = slide.shapes.add_textbox(Inches(12.6), Inches(0.2), Inches(0.5), Inches(0.3))
    _text(box.text_frame, [(str(n), 11, False, GREY)], PP_ALIGN.RIGHT)


def image_area(slide, filename, note):
    """캡처가 있으면 삽입, 없으면 ⚠ 자리표시 박스."""
    top, left = Inches(1.62), Inches(0.85)
    width, height = Inches(11.63), Inches(5.5)

    path = CAPTURES / filename if filename else None
    if path and path.exists():
        # 비율을 유지한 채 영역 안에 맞춘다 (letterbox).
        from PIL import Image  # 선택 의존성. 없으면 폭 기준으로 맞춘다.

        try:
            iw, ih = Image.open(path).size
            scale = min(width / iw, height / ih)
            w, h = Emu(int(iw * scale)), Emu(int(ih * scale))
            slide.shapes.add_picture(
                str(path), Emu(int(left + (width - w) / 2)), Emu(int(top + (height - h) / 2)), w, h
            )
        except Exception:
            slide.shapes.add_picture(str(path), left, top, width=width)
        return True

    ph = slide.shapes.add_textbox(left, top, width, height)
    ph.fill.solid()
    ph.fill.fore_color.rgb = WARN_BG
    ph.line.color.rgb = WARN_LINE
    ph.line.width = Pt(1.5)
    tf = ph.text_frame
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.margin_left = tf.margin_right = Inches(0.5)
    _text(
        tf,
        [
            ("⚠ 화면 캡처가 필요합니다", 20, True, WARN_TEXT),
            ("", 10, False, WARN_TEXT),
            (note, 13, False, WARN_TEXT),
            ("", 8, False, WARN_TEXT),
            (
                f"채우는 법: 위 화면을 캡처해 captures/{filename} 로 저장한 뒤 "
                "build_payment_path_ppt.py 를 다시 실행하면 이 자리에 삽입됩니다.",
                10,
                False,
                GREY,
            ),
            ("(임의 이미지·모크업으로 채우지 마세요 — 심사 제출 서류입니다)", 10, True, WARN_TEXT),
        ],
        PP_ALIGN.CENTER,
    )
    return False


def cover_slide(prs, kind, fields):
    slide = add_slide(prs)
    page_number(slide, 1)

    box = slide.shapes.add_textbox(Inches(0.9), Inches(0.55), Inches(11.5), Inches(1.1))
    _text(
        box.text_frame,
        [
            ("결제경로", 30, True, DARK),
            (kind, 15, False, BLUE),
        ],
    )

    top = Inches(2.1)
    for i, (label, value) in enumerate(fields):
        y = Emu(int(top + Inches(0.52) * i))
        lb = slide.shapes.add_textbox(Inches(1.6), y, Inches(2.9), Inches(0.45))
        _text(lb.text_frame, [(label, 16, True, BLUE)])
        vb = slide.shapes.add_textbox(Inches(4.5), y, Inches(7.5), Inches(0.45))
        missing = value is None
        _text(
            vb.text_frame,
            [
                (
                    "⚠ 미설정 — MARBLO_TOSS_REVIEW_PW 환경변수를 주고 재생성하세요"
                    if missing
                    else value,
                    16,
                    missing,
                    WARN_TEXT if missing else DARK,
                )
            ],
        )

    note = slide.shapes.add_textbox(
        Inches(1.6), Emu(int(top + Inches(0.52) * len(fields) + Inches(0.45))), Inches(10.2), Inches(0.7)
    )
    _text(note.text_frame, [(COVER_NOTE, 11, False, GREY)])
    return slide


def content_slide(prs, n, step_label, title, subtitle, filename, note):
    slide = add_slide(prs)
    page_number(slide, n)
    step_header(slide, step_label, title, subtitle)
    return image_area(slide, filename, note)


# ------------------------------------------------------------------ 슬라이드 정의
# (step_label, title, subtitle, capture 파일명, 캡처 대상 안내)
COMMON_HEAD = [
    (
        "② 하단정보 캡처",
        "필수정보가 모두 포함된 하단정보를 캡처해요.",
        None,  # 종류별로 채운다
        "02_footer.png",
        "https://marblo.app/ko 최하단 푸터 (사업자정보). 로그인 없이 보이는 상태로 캡처.",
    ),
    # 공식 양식도 환불규정에 2페이지(p.8·9)를 배정한다. 정책 전문이 길어
    # 통짜 캡처는 슬라이드에서 판독 불가라 뷰포트 단위 3장으로 나눴다.
    (
        "③ 환불규정 캡처",
        "환불규정을 캡처해요.",
        "1/3 — https://marblo.app/ko/legal/refund (청약철회 7일 · 강의 진도율별 기준)",
        "03_refund.png",
        "환불정책 상단.",
    ),
    (
        "③ 환불규정 캡처",
        "환불규정을 캡처해요.",
        "2/3 — 구독 환불 (청약철회 기산점 · ★미제공 기간 일할 환불)",
        "03_refund_2.png",
        "구독 환불 조항. 정기결제 심사에서 가장 중요한 구간.",
    ),
    (
        "③ 환불규정 캡처",
        "환불규정을 캡처해요.",
        "3/3 — 무료 쿠폰 · 환불 절차 · 문의처",
        "03_refund_3.png",
        "환불정책 하단.",
    ),
    (
        "④ 로그인 / 회원가입 캡처",
        "회원가입 경로를 캡처해요.",
        "https://marblo.app/ko/auth/signup — 회원가입 화면",
        "04_signup.png",
        "회원가입 화면. ★생략 불가 — /ko/checkout 이 비로그인 시 로그인으로 리다이렉트되어 "
        "비회원 구매가 불가하기 때문.",
    ),
    (
        "④ 로그인 / 회원가입 캡처",
        "로그인 경로를 캡처해요.",
        "https://marblo.app/ko/auth/login — 로그인 화면",
        "04_login.png",
        "로그인 화면. ★생략 불가 (위와 동일 사유).",
    ),
]

ONETIME_BODY = [
    (
        "⑤ 상품선택 / 구매과정 캡처",
        "상품 구매하는 일련의 과정을 캡처해요.",
        "1/4 — 메인 페이지 https://marblo.app/ko",
        "05_1_main.png",
        "메인 페이지 상단(서비스 성격이 드러나는 영역).",
    ),
    (
        "⑤ 상품선택 / 구매과정 캡처",
        "상품 구매하는 일련의 과정을 캡처해요.",
        "2/4 — 강의 목록 https://marblo.app/ko/lectures",
        "05_2_lecture_list.png",
        "강의 목록(상품 목록). 판매가가 보이는 상태로 캡처.",
    ),
    (
        "⑤ 상품선택 / 구매과정 캡처",
        "상품 구매하는 일련의 과정을 캡처해요.",
        "3/4 — 강의 상세 https://marblo.app/ko/lectures/marblo-v3-masterclass "
        "(판매가 · ★서비스 제공기간 표기 포함)",
        "05_3_lecture_detail.png",
        "강의 상세 페이지. ★수강기간(서비스 제공기간) 문구가 화면에 보이는 상태여야 함 "
        "— 티켓 RlvepuUqVn9L4X9Jbe49 머지 후 캡처할 것. "
        "단 이번 심사는 구독 단독 접수라 이 슬라이드는 당장 필요하지 않음.",
    ),
    (
        "⑤ 상품선택 / 구매과정 캡처",
        "상품 구매하는 일련의 과정을 캡처해요.",
        "4/4 — 주문서 / 결제하기 https://marblo.app/ko/checkout",
        "05_4_checkout.png",
        "주문 요약 + 결제수단(신용카드) + 구매조건 동의 + [결제하기] 버튼이 함께 보이게 캡처.",
    ),
    (
        "⑥ 카드 결제경로 캡처",
        "카드 결제 과정을 캡처해요.",
        "토스페이먼츠 결제창 — 신용카드 선택 + 카드사 목록",
        "06_1_payment_window.png",
        "★현재 이 흐름은 도달 자체가 불가 — 강의 체크아웃이 코드상 차단되어 있음(아래 안내 슬라이드 참고). "
        "강의 판매 재개 후, 그리고 라이브 키 적용 후 캡처할 것.",
    ),
]

BILLING_BODY = [
    (
        "⑤ 상품선택 / 구매과정 캡처",
        "상품 구매하는 일련의 과정을 캡처해요.",
        "1/4 — 메인 페이지 https://marblo.app/ko",
        "05_1_main.png",
        "메인 페이지 상단(서비스 성격이 드러나는 영역).",
    ),
    (
        "⑤ 상품선택 / 구매과정 캡처",
        "상품 구매하는 일련의 과정을 캡처해요.",
        "2/4 — 요금제 https://marblo.app/ko/pricing — ★월간 (서비스 제공기간 고지)",
        "05_2_pricing.png",
        "✅ 캡처 완료. Pro ₩19,000/월 · '월 구독 · 매달 자동결제로 갱신' · "
        "'최대 서비스 제공기간: 결제일로부터 1개월'. 비로그인 상태.",
    ),
    (
        "⑤ 상품선택 / 구매과정 캡처",
        "상품 구매하는 일련의 과정을 캡처해요.",
        "3/4 — 요금제 /pricing — ★연간 (토글 전환 시 제공기간 고지)",
        "05_2_pricing_annual.png",
        "✅ 캡처 완료. Pro ₩190,000/년 · '연 구독 · 매년 자동갱신' · "
        "'서비스 제공기간: 결제일로부터 12개월(1년)'. "
        "★월간·연간 두 상태를 모두 담아 심사관이 어느 쪽으로 보든 제공기간을 확인할 수 있게 했다.",
    ),
    (
        "⑤ 상품선택 / 구매과정 캡처",
        "상품 구매하는 일련의 과정을 캡처해요.",
        "4/4 — 구독 주문서 https://marblo.app/ko/checkout",
        "05_3_checkout.png",
        "✅ 캡처 완료. 주문 요약 ₩19,000/월 + 최대 서비스 제공기간 고지 + "
        "결제대행사(토스페이먼츠) 제3자 제공 동의 + [결제하기] 버튼.",
    ),
    # 공식 양식 p.15 예시는 '카드 정보'와 '본인 정보'를 두 패널로 보여주지만,
    # 현재 토스 빌링 UI(billing/pc)는 카드번호·유효기간·주민등록번호 앞 7자리를
    # ★한 화면에 합쳐서 표시한다. 따라서 아래 한 장이 가이드가 요구하는
    # '정기결제용 카드 입력창'을 온전히 담는다. 빈 자리표시 슬라이드를 제출본에
    # 남기지 않기 위해 별도 2/2 슬라이드는 두지 않았다. (README 4-2 참고)
    (
        "⑥ 카드 결제경로 캡처",
        "빌링결제의 경우 정기결제용 카드 입력창까지 캡처해야해요.",
        "토스페이먼츠 정기결제(빌링) 카드 등록창 — ★정기결제본 필수 항목",
        "06_1_payment_window.png",
        "✅ 캡처 완료. [결제하기] 클릭 시 payment-gateway-sandbox.tosspayments.com/billing/pc 가 "
        "떠서 '등록할 카드를 입력해주세요'(카드번호·유효기간·주민등록번호 앞 7자리) 화면이 나온다. "
        "★정기결제는 결제수단 선택 단계 없이 곧바로 카드 등록창으로 진입한다 — 일반결제의 "
        "'카드사 목록' 화면은 이 흐름에 존재하지 않는다. 카드번호는 입력하지 않아 승인 흐름 미진입.",
    ),
]


def notice_slide(prs, n, heading, lines):
    """제출 전 반드시 읽어야 할 상태 안내(예: 강의 결제 차단)."""
    slide = add_slide(prs)
    page_number(slide, n)
    box = slide.shapes.add_textbox(Inches(0.85), Inches(0.9), Inches(11.63), Inches(5.7))
    box.fill.solid()
    box.fill.fore_color.rgb = WARN_BG
    box.line.color.rgb = WARN_LINE
    box.line.width = Pt(1.5)
    tf = box.text_frame
    tf.vertical_anchor = MSO_ANCHOR.TOP
    tf.margin_left = tf.margin_right = Inches(0.55)
    tf.margin_top = Inches(0.4)
    runs = [(heading, 22, True, WARN_TEXT), ("", 10, False, WARN_TEXT)]
    for ln in lines:
        runs.append((ln, 13, ln.startswith("★"), WARN_TEXT if ln.startswith("★") else DARK))
        runs.append(("", 5, False, DARK))
    _text(tf, runs)
    return slide


def build(kind, footer_sub, body, outfile, notice=None):
    prs = Presentation()
    prs.slide_width, prs.slide_height = SLIDE_W, SLIDE_H

    fields = [
        ("(1) 상호명", MERCHANT["상호명"]),
        ("(2) 사업자번호", MERCHANT["사업자번호"]),
        ("(3) URL", MERCHANT["URL"]),
        ("(4) Test ID", TEST_ID),
        ("(5) Test PW", TEST_PW),
    ]
    cover_slide(prs, kind, fields)

    missing = []
    n = 2
    if notice:
        notice_slide(prs, n, notice[0], notice[1])
        n += 1
    for step, title, sub, fname, note in list(COMMON_HEAD) + list(body):
        if fname == "02_footer.png":
            sub = footer_sub
        ok = content_slide(prs, n, step, title, sub, fname, note)
        if not ok:
            missing.append((n, fname, note))
        n += 1

    prs.save(HERE / outfile)
    return outfile, n - 1, missing


LECTURE_BLOCKED_NOTICE = (
    "⚠ 이 문서는 제출용이 아닙니다 — 이번 카드사 심사 범위 밖입니다",
    [
        "★이번 심사는 '구독(정기결제) 단독 접수'로 결정되었습니다 (사장님 결정).",
        "    강의는 구매자가 없고 콘텐츠도 미준비라 판매를 열지 않습니다.",
        "    → 제출 서류는 '마블로_결제경로_정기결제(구독).pptx' 한 개입니다.",
        "",
        "★설령 포함하려 해도 지금은 캡처가 불가능합니다. 화면이 존재하지 않기 때문입니다.",
        "근거: marblo-web/src/app/[locale]/checkout/page.tsx 의 가드",
        "    「강의 실결제 차단(A안): 강의 콘텐츠 미준비 상태이므로 강의 체크아웃 진입 자체를 막고",
        "      강의 상세로 돌려보낸다. 직접 URL 진입도 차단.」",
        "이 리다이렉트는 type === \"lecture\" 이면 무조건 실행되며 로그인 여부보다 먼저 동작합니다.",
        "따라서 '메인 → 상품 선택 → 결제 → 결제창' 중 결제·결제창 단계가 도달 불가입니다.",
        "★재개 조건: 나중에 강의 판매를 열 때 위 가드를 제거하면,",
        "    이 문서의 뼈대 그대로 캡처만 채워 완성할 수 있습니다. 그때 재개합니다.",
    ],
)


def main():
    results = []
    # 정기결제본이 지금 제출 가능한 유일한 문서라 먼저 만든다.
    results.append(
        build(
            "정기결제 (빌링) — Pro 구독",
            "상호명 / 사업자번호 / 대표자명 / 사업자주소",
            BILLING_BODY,
            "마블로_결제경로_정기결제(구독).pptx",
        )
    )
    # 강의본은 뼈대까지만. 강의 체크아웃이 코드상 차단되어 캡처가 불가능하다.
    results.append(
        build(
            "일반 (홈페이지) — 강의 · 일회성 결제  [보류: 결제 흐름 차단 상태]",
            "상호명 / 사업자번호 / 대표자명 / 사업자주소 / 상점 전화번호 / 통신판매업 신고번호",
            ONETIME_BODY,
            "마블로_결제경로_일반(강의)_뼈대.pptx",
            notice=LECTURE_BLOCKED_NOTICE,
        )
    )

    for name, total, missing in results:
        print(f"\n{name}  — 슬라이드 {total}장, 캡처 미삽입 {len(missing)}장")
        for n, fname, _ in missing:
            print(f"  ⚠ p.{n}  captures/{fname}")

    if not TEST_PW:
        bar = "=" * 72
        print(
            f"\n{bar}\n"
            "⚠ 경고: 심사관용 테스트 계정 비밀번호가 비어 있습니다.\n"
            "   표지 (5) Test PW 에 자리표시자가 박혔습니다 — 이대로 제출하면\n"
            "   심사관이 로그인하지 못해 반려됩니다.\n\n"
            "   재생성:  MARBLO_TOSS_REVIEW_PW='...' python3 "
            f"docs/toss-review/build_payment_path_ppt.py\n{bar}"
        )


if __name__ == "__main__":
    main()

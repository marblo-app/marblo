# Marblo 베타 디스코드 서버 구조 설계 (국내+해외, 한/영)

> 목표: 국내·해외 유저가 한 서버에서 자연스럽게 섞이되, 언어 장벽 없이 각자 편한 채널을 쓰게.
> 원칙: **공용 채널은 이중언어, 대화 채널은 언어별 분리.** 봇 없이도 굴러가되, 커지면 자동화.

---

## 1. 전체 채널 트리 (MVP)

```
📢 INFO (모두 읽기 전용, 이중언어)
├─ #start-here          ← 온보딩 가이드 핀 고정 (한/영)
├─ #rules               ← 규칙 + ✅ 반응으로 Founder Beta 역할
├─ #roles               ← 🇰🇷/🇬🇧 반응 → 언어 채널 언락
├─ #announcements       ← 릴리스/공지 (한·영 병기)
└─ #changelog           ← 버전 업데이트 로그 (자동/수동)

💬 GENERAL (공용)
├─ #general-🌐          ← 공용 잡담, 이중언어 OK
├─ #showcase           ← "Marblo로 만든 것" 자랑 (스크린샷/영상)
└─ #introductions      ← 자기소개

🇰🇷 한국어
├─ #일반-잡담
├─ #help-ko            ← 사용법 질문
└─ #feedback-ko        ← 피드백/제안

🇬🇧 ENGLISH
├─ #general-en
├─ #help-en
└─ #feedback-en

🐞 FEEDBACK & BUGS (공용, 이중언어)
├─ #bugs               ← 버그 신고 (템플릿 핀)
├─ #feature-requests   ← 기능 제안 (👍 투표)
└─ #feedback-form      ← 6문항 피드백 폼 링크 + Pro 혜택 안내

🔒 STAFF (비공개)
├─ #team
├─ #triage             ← 버그→Marblo 티켓 연동 논의
└─ #mod-log
```

> 언어 채널(🇰🇷/🇬🇧)은 `#roles`에서 해당 반응을 눌러야 보이게 (권한으로 숨김). 나머지는 Founder Beta 전체 공개.

---

## 2. 역할(Role) 설계

| 역할                | 부여 방식                                | 권한                        |
| ------------------- | ---------------------------------------- | --------------------------- |
| **Founder Beta**    | `#rules` ✅ 반응                         | 서버 기본 접근              |
| **Lang: KO** 🇰🇷     | `#roles` 🇰🇷 반응                         | 🇰🇷 카테고리 열림            |
| **Lang: EN** 🇬🇧     | `#roles` 🇬🇧 반응                         | ENGLISH 카테고리 열림       |
| **Verified Tester** | 앱 로그인/피드백 제출 확인 후 수동 or 봇 | `#showcase` 게시, 우선 지원 |
| **Pro Member**      | 피드백→Pro 지급자                        | 인지용 뱃지 (선택)          |
| **Staff / Mod**     | 팀                                       | STAFF 카테고리, 관리        |

> 언어 역할은 **복수 선택 가능** (한/영 둘 다 볼 사람도 있음). 카테고리는 role 기반으로 열고 닫음.

---

## 3. 온보딩 자동화 (권장, 없어도 운영 가능)

**MVP(봇 없이):**

- `#rules`·`#roles`를 Discord 기본 **Reaction Roles**로 (Carl-bot / MEE6 무료 티어면 충분)
- 신규 입장 시 `#start-here`로 안내 (서버 설정 → Welcome Screen 활용, 봇 불필요)

**커지면(봇 도입):**

- Carl-bot/MEE6: 규칙 동의 → 역할 자동, 언어 역할 자동
- (선택) Marblo 앱 로그인 이메일 ↔ 디스코드 연동해 **Verified Tester** 자동 부여
- (선택) `#bugs` 새 글 → 스레드 자동 + 내부 `#triage`에서 Marblo 티켓으로 승격

---

## 4. 이중언어 운영 팁

- **공지(#announcements)**: 항상 한국어 + English 블록 둘 다. 짧게.
- **공용 채널**: "아무 언어나 환영 / any language welcome" 핀 고정.
- **자동번역**: 무리하지 말 것. 필요 시 Discord 자체 기능/간단 봇으로 on-demand만.
- 이모지 국기 반응으로 언어대응 시각화 → 해외 유저 소외감 최소화.

---

## 5. 서버 세팅 체크리스트

- [ ] 서버 생성 + 커뮤니티 기능 켜기 (Welcome Screen, 규칙 스크리닝)
- [ ] 위 카테고리/채널 생성
- [ ] `#start-here`에 온보딩 가이드(DISCORD-ONBOARDING.md) 핀
- [ ] `#rules` 규칙 작성 + ✅ Reaction Role → Founder Beta
- [ ] `#roles` 🇰🇷/🇬🇧 Reaction Role → 언어 카테고리 권한
- [ ] `#bugs` 신고 템플릿 핀
- [ ] `#feedback-form`에 6문항 폼 링크 + Pro 3개월 혜택 안내
- [ ] 언어 카테고리 권한: 해당 role만 보이게
- [ ] 초대 링크 생성(무기한/무제한 or 캠페인별) → 유튜브 설명란·랜딩·이메일에 삽입
- [ ] (선택) Carl-bot 등 무료 봇으로 Reaction Role 안정화

---

## 6. 초대 링크 배치처

- 유튜브 영상 설명란 + 고정 댓글
- marblo.app/founders 신청 완료 화면 & 승인 이메일(Resend)
- `#announcements` 웹 크로스포스트

> 국가 제한 없이 하나의 서버 + 언어 채널 분리 = 국내/해외 커뮤니티가 한 곳에서 성장. 초기엔 이 구성이 가장 관리 쉽고 확장 여지 큼.

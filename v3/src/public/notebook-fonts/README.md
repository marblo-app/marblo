# notebook-fonts — 노트북 커널용 한글 폰트

Code 탭 노트북 커널(Pyodide)의 matplotlib 은 DejaVu Sans 하나만 갖고 있다.
DejaVu 에는 한글 글리프가 없어서, 차트 제목·축·범례에 한글을 쓰면 전부
두부(□)로 렌더되고 `Glyph 51333 (HANGUL SYLLABLE JONG) missing from font(s) DejaVu Sans` 경고가 뜬다. 마크다운 셀과 DataFrame 표는 브라우저 폰트를 쓰므로
멀쩡하다 — **matplotlib 이 PNG 로 굽는 차트 내부 글자만** 이 폰트를 쓴다.

커널 부팅 시 `kernel.worker.ts` 가 이 폰트를 Pyodide 파일시스템에 써넣고,
`runner.py` 의 `__marblo_apply_font()` 가 matplotlib 폰트매니저에 등록한다.

## Pretendard-Regular.otf

|          |                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| 출처     | https://github.com/orioncactus/pretendard (`packages/pretendard/dist/public/static/Pretendard-Regular.otf`, `main`) |
| 버전     | 1.309                                                                                                               |
| 라이선스 | SIL Open Font License 1.1 — 전문은 같은 디렉터리의 `OFL.txt`                                                        |
| 저작권   | © 2021 Kil Hyung-jin, Reserved Font Name 'Pretendard'                                                               |
| 크기     | 1,574,352 B (1.5 MB)                                                                                                |
| sha256   | `3ffbacde6ab8411f1d2db54bb9b1f0b3ee2a738932033722cf0388c06aed1c93`                                                  |

### 왜 Pretendard 인가

후보를 실측 비교했다 (`fontTools` 로 cmap 커버리지 확인):

|                            | 크기       | 한글 음절       | U+2212 MINUS | 라이선스 |
| -------------------------- | ---------- | --------------- | ------------ | -------- |
| **Pretendard-Regular.otf** | **1.5 MB** | 11,172 / 11,172 | **있음**     | OFL 1.1  |
| NanumGothic-Regular.ttf    | 2.0 MB     | 11,172 / 11,172 | **없음**     | OFL 1.1  |
| NotoSansKR[wght].ttf       | 10.4 MB    | 11,172 / 11,172 | 있음         | OFL 1.1  |

Pretendard 가 가장 작으면서 한글 11,172 음절을 전부 덮고, 라틴 문자도 자체
커버해서 한·영 혼용 라벨이 한 폰트로 붙는다. NanumGothic 은 U+2212 MINUS SIGN
이 없어 음수 눈금이 다시 □ 로 깨지는 후속 버그를 만든다(그래서 `runner.py` 는
`axes.unicode_minus` 를 False 로 둔다 — 사용자가 다른 한글 폰트로 갈아타도
음수가 안전하다).

서브셋(KS X 1001 2,350 음절)은 1.5 MB 를 0.5 MB 로 줄이지만, 흔치 않은 음절이
그대로 □ 가 되고 빌드에 fonttools 의존이 붙는다. Pyodide 자산이 이미 수십 MB
인 마당에 1 MB 를 아끼자고 "가끔 깨지는 한글"을 만들 이유가 없다.

### 왜 레포에 직접 커밋하나

`scripts/fetch-pyodide-assets.mjs` 가 받는 wheel 과 달리 폰트는 런타임 ABI 에
묶여 있지 않고 버전도 사실상 고정이다. 레포에 두면 빌드가 네트워크에 의존하지
않고, 클론만 하면 항상 존재한다 — "폰트가 없어도 커널은 뜬다"는 폴백이 실제로
발동할 일이 거의 없다는 뜻이다. Vite 의 publicDir 이 `dist/notebook-fonts/` 로
그대로 복사하고 electron-builder 의 `files: dist/**/*` 가 이를 패키지에 담으므로
빌드 스크립트 변경도 필요 없다.

## 교체할 때

폰트 파일명을 바꾸면 `src/lib/notebookKernel/protocol.ts` 의
`NOTEBOOK_FONT_URL` 도 같이 고쳐야 한다. 라이선스 전문(`OFL.txt`)과 이 문서의
출처·sha256 도 함께 갱신할 것 — OFL 은 폰트 재배포 시 라이선스 동봉을 요구한다.

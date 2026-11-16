# 스토어 등재 문안

Chrome 웹 스토어 **개발자 대시보드**에 사람이 손으로 넣는 필드들이다.
API 경로에 없으므로(`publish-store.yml` 은 zip 만 올린다) 여기 적어 두고 복사해 붙인다.

> 대시보드의 상세 설명은 **일반 텍스트**다. 마크다운이 먹지 않으므로 `**` 나 `-` 를 쓰지 않고
> 줄바꿈과 중점(·)으로만 구성했다. 아래 코드 블록 안의 글자가 그대로 들어갈 내용이다.

## 1. 기본 정보

| 필드 | 값 | 비고 |
| --- | --- | --- |
| 이름 | 화면부수기 (Crash Screen) | `manifest.json` 의 `appName` 에서 자동 |
| 짧은 설명 | (자동) | `manifest.json` 의 `appDesc` — ko 94자 · en 129자, 상한 132 |
| 카테고리 | **Games** | 경쟁 확장들이 Games / Just for Fun 에 있다 |
| 언어 | 한국어 (기본), English | `_locales/` 와 같다 |

## 2. 상세 설명 — 한국어

```
보고 있는 웹페이지의 요소를 직접 부수는 확장 프로그램입니다.

화면을 사진으로 찍어서 부수는 것이 아닙니다. 버튼, 이미지, 문단, 카드 하나하나가
실제로 반응합니다. 그래서 큰 요소는 단단하고 작은 글자는 망치 한 방에 흩어집니다.
자국과 균열은 맞은 요소에만 남고 요소 경계에서 잘립니다. 조각은 문서에 붙어서
떨어진 자리에 쌓입니다.

끄면 아무 흔적도 남지 않습니다. 새로고침도 필요 없습니다.


■ 무기 23종

실전 14종 · 특수 5종 · 예능 4종. 그리고 옵션 페이지에서 직접 만드는 사용자 정의
무기를 10개까지.

망치, 권총, 소총, 샷건, 미니건, 저격총, 레이저 커터부터 밀고 당기고 얼리고
빨아들이는 특수 무기까지 있습니다. 무기마다 못 하는 일이 있습니다. 저격총은
낱말 하나에 쓰기엔 낭비이고, 카타나는 큰 카드에 약합니다.


■ 크기가 곧 체력입니다

요소가 클수록 단단합니다. 글자 요소는 체력이 최대 60이라 한 방에 흩어지고,
상위 요소의 체력에는 자식 요소 체력의 60%가 들어갑니다. 그래서 속을 먼저
파먹고 껍데기를 무너뜨리는 쪽이 빠릅니다.

모서리를 치면 모서리만 떨어집니다. 무기마다 쐐기, 띠, 반쪽, 파편, 재처럼
다르게 쪼개집니다. 글이 많은 요소는 단어와 글자 단위로 흩어집니다.


■ 모드 3종

램페이지 — 적이 없습니다. 그냥 부숩니다.
아케이드 — 커서가 캐릭터가 되고, 큰 요소들이 반격합니다.
서바이벌 — WASD 로 드론을 몹니다.

요소의 종류가 공격 방식을 정합니다. 이미지는 포격하고, 버튼은 3연사를 하고,
링크는 달려들고, 푸터는 아군을 고칩니다. 적 아키타입 10종과 투사체 4종.


■ 그 밖에

탄창과 재장전, 길게 눌러 모으는 보조 공격, 오른쪽 버튼으로 2배 확대되는 조준경,
열 칸 로드아웃, 챌린지 3종과 보스전, 무기 해금, 누적 통계.

불은 번지고, 젖으면 불이 꺼지고 빙결이 강해지고, 밀린 요소끼리 부딪히면
피해가 납니다.

인스펙터(I) — 아무것도 부수지 않고 요소의 선택자와 대비비, 접근성 이름을
보여 줍니다. 웹 개발자용입니다.

소리는 Web Audio 로 그때그때 합성합니다. 오디오 파일이 하나도 없습니다.


■ 데이터

바깥으로 나가는 네트워크 요청이 없습니다. 설정과 기록은 기기 안의 크롬 저장소에만 있고
아무 데도 전송되지 않습니다. 서버가 없습니다.

권한은 셋뿐입니다. activeTab, scripting, storage.
방문하는 모든 사이트에 대한 권한(host_permissions)을 요구하지 않습니다.
툴바 아이콘을 누른 그 탭에서만, 그 순간부터 동작합니다.

처리방침: https://raw.githubusercontent.com/chungchung234/crash-tab/main/PRIVACY.md


■ 접근성

모션 축소, 고대비 표식, 키보드 조준, 성능 모드를 지원합니다.
운영체제의 "동작 줄이기" 설정을 따릅니다.


■ 조작

툴바 아이콘으로 켜고 끕니다. Esc 로도 끕니다.
F1 또는 ? 를 누르면 전체 단축키가 나옵니다.

오픈소스입니다: https://github.com/chungchung234/crash-tab
```

## 3. 상세 설명 — English

```
Break the elements of the web page you are looking at.

This is not a screenshot being smashed. Every button, image, paragraph and card
reacts for itself, so large elements are tough and small text scatters from a
single hammer blow. Dents and cracks stay on the element that was hit and are
clipped at its bounds. Debris attaches to the document and piles up where it fell.

Turn it off and nothing is left behind. No reload needed.


= 23 weapons

14 practical, 5 special, 4 for fun, plus up to 10 you build yourself in the
options page.

Hammer, pistol, rifle, shotgun, minigun, sniper, laser cutter, and special
weapons that push, pull, freeze and vacuum. Every weapon is bad at something:
a sniper round is wasted on a single word, and the katana struggles with a
large card.


= Size is health

The bigger the element, the tougher it is. Text elements cap at 60 HP and burst
in one hit, while a container's health includes 60% of its children's. Hollowing
out the inside before collapsing the shell is the faster way through.

Hit a corner and only the corner comes off. Each weapon fragments differently:
wedges, strips, halves, shards, ash. Text-heavy elements scatter by word and
by letter.


= Three modes

Rampage - no enemies. Just break things.
Arcade - your cursor becomes a character and large elements fight back.
Survival - fly a drone with WASD.

The kind of element decides how it attacks. Images shell you, buttons fire
three-round bursts, links charge, footers heal their allies. 10 enemy
archetypes, 4 projectile types.


= And

Magazines and reloading, charged secondary attacks, a 2x scope on right click,
a ten-slot loadout, 3 challenges, boss fights, weapon unlocks, lifetime stats.

Fire spreads. Wet elements resist fire and freeze harder. Displaced elements
that collide take damage.

Inspector (I) - breaks nothing, and shows an element's selector, contrast ratio
and accessible name. For web developers.

All sound is synthesised with Web Audio at runtime. There is not one audio file
in the package.


= Data

No outbound network requests. Settings and records live only in your browser's local
storage and are never transmitted. There is no server.

Three permissions: activeTab, scripting, storage.
It does not ask for access to every site you visit. It works on the tab whose
toolbar icon you clicked, from the moment you click it.

Privacy policy:
https://raw.githubusercontent.com/chungchung234/crash-tab/main/PRIVACY.en.md


= Accessibility

Reduced motion, high-contrast markers, keyboard aiming and a performance mode.
It follows your operating system's "reduce motion" setting.


= Controls

The toolbar icon toggles it. Esc also turns it off.
Press F1 or ? for the full key list.

Open source: https://github.com/chungchung234/crash-tab
```

## 4. 단일 목적 서술 (Single purpose) — 필수

대시보드 **개인정보** 탭. 하나의 목적이어야 한다.

```
사용자가 보고 있는 웹페이지의 DOM 요소를 그 자리에서 시각적으로 부수고 되돌리는,
페이지 위에서 도는 놀이를 제공합니다.

모든 기능이 이 하나에 붙어 있습니다. 무기와 모드는 요소를 부수는 방식이고,
인스펙터는 부수기 전에 그 요소가 무엇인지 보여 주는 같은 대상의 다른 보기이며,
통계와 리플레이는 그 놀이의 결과입니다. 확장은 페이지의 내용을 바꾸지 않으며,
모든 변경은 되돌릴 수 있고 비활성화하면 흔적이 남지 않습니다.
```

> 영어로도 요구받을 수 있다:
> "Provides an in-page game in which the user visually breaks and restores the DOM
> elements of the web page they are viewing. Every feature serves that one purpose:
> weapons and modes are ways of breaking elements, the inspector is another view of
> the same elements before breaking them, and stats and replays are the results of
> that play. The extension does not alter page content; every change is reversible
> and nothing is left behind when it is disabled."

## 5. 권한 사유 (Permission justification) — 필수, 권한마다 하나씩

```
activeTab
  사용자가 툴바 아이콘을 누른 바로 그 탭에서만 동작하기 위해서입니다.
  이 확장은 방문하는 모든 사이트에 대한 권한(host_permissions)을 요구하지 않습니다.
  사용자가 명시적으로 켠 탭 외에는 어떤 페이지에도 접근하지 않습니다.
  결과 공유(P)의 화면 캡처도 이 권한으로만 이루어집니다.
```

```
scripting
  놀이를 실행하는 코드를 활성화된 탭에 주입하기 위해서입니다.
  툴바 아이콘을 누를 때만 주입되며, 끄면 주입된 것이 스스로를 모두 제거합니다.
  원격 코드를 내려받아 실행하지 않습니다. 패키지에 들어 있는 코드만 실행합니다.
```

```
storage
  사용자의 설정(무기, 모드, 로드아웃, 접근성 옵션)과 누적 통계를 기기 안에 저장하기
  위해서입니다. 모든 값은 chrome.storage.local 과 chrome.storage.session 에만 있고
  어디로도 전송되지 않습니다. 결과 공유의 화면 캡처는 브라우저를 닫으면 사라지는
  session 저장소에 잠깐 들어갔다가 확장 자신의 페이지에서 쓰이고 버려집니다.
```

**원격 코드 사용**: 아니요 (No). `eval` · `new Function` · 외부 스크립트 로드가 없다 —
`tools/validate.js` 가 이 금지를 정적으로 검사한다.

## 6. 데이터 사용 공개 (Data usage) — 필수

대시보드 **개인정보** 탭의 체크 항목. 코드 근거와 함께 적는다.

| 항목 | 체크 | 근거 |
| --- | --- | --- |
| 개인 식별 정보 | ☐ 아니요 | 이름·이메일·주소·나이를 묻는 곳이 없다 |
| 건강 정보 | ☐ 아니요 | — |
| 금융 및 결제 정보 | ☐ 아니요 | — |
| 인증 정보 | ☐ 아니요 | 로그인이 없다 |
| 개인 통신 내용 | ☐ 아니요 | — |
| 위치 | ☐ 아니요 | — |
| **웹 기록** | ☑ **예** | `crsStats.perOrigin` 이 부순 사이트의 origin 과 마지막 시각을 최대 200개 남긴다(설정 `collectOriginStats`, **기본 꺼짐**). 공유 캡션에도 페이지 제목과 host 가 들어간다 |
| **사용자 활동** | ☑ **예** | 리플레이가 클릭·슬래시 좌표를 `{t, op, args}` 로 2000개까지 기록한다(`recordReplay`). 메모리에 있다가 사용자가 저장할 때만 `crsReplays`(최대 10)로 간다 |
| **웹사이트 콘텐츠** | ☑ **예** | 결과 공유(`P`)가 `chrome.tabs.captureVisibleTab` 으로 보이는 화면을 PNG 로 찍는다. `chrome.storage.session` 에 들어갔다가 확장 자신의 페이지에서 합성에 쓰인다 |

세 가지 인증 항목은 **전부 해당한다** (모두 체크):

- 승인된 사용 사례와 무관하게 제3자에게 **판매하지 않습니다** — 전송 자체가 없다
- 항목의 단일 목적과 무관한 용도로 **사용하거나 전송하지 않습니다** — 전송 자체가 없다
- 신용도 판단이나 대출 목적으로 **사용하거나 전송하지 않습니다**

> **제출 전에 화면에서 한 번 더 본다.** 이 세 항목의 정의 원문은 공식 문서 페이지가 아니라
> 대시보드 개인정보 탭 안에만 있다. 위 판정은 "기기 안에만 남아도 수집은 수집"이라는
> 보수적인 해석이다. 전송이 0이라서 인증 세 항목은 어느 해석으로도 안전하다.

## 7. 제출 전 체크리스트

| 항목 | 상태 |
| --- | --- |
| 아이콘 16·32·48·128 | 패키지 안에 있음 (`validate.js` 가 검사) |
| 스크린샷 1280×800 | `store/screenshots/` 5장 |
| 프로모 타일 440×280 | `store/promo/small-440x280.png` (`node tools/promo.js`) |
| 마키 프로모 1400×560 | `store/promo/marquee-1400x560.png` (같은 명령) |
| 처리방침 URL | https://raw.githubusercontent.com/chungchung234/crash-tab/main/PRIVACY.md (200) |
| 짧은 설명 ≤132 코드 포인트 | ko 94 · en 129 (`validate.js` R21) |
| 상세 설명 | 이 문서 §2 · §3 |
| 단일 목적 | 이 문서 §4 |
| 권한 사유 3개 | 이 문서 §5 |
| 데이터 사용 공개 | 이 문서 §6 |
| 2단계 인증 | **사용자 계정 쪽** — 켜져 있어야 게시된다 |

## 8. 심사에서 걸릴 만한 곳

미리 알고 있자는 것이지, 고쳐야 한다는 뜻은 아니다.

- **무기 묘사.** 총기 이름과 사격 연출이 있다. 대상이 사람이 아니라 웹페이지 요소라는 점이
  설명 첫 문단에서 바로 드러나게 썼다. 스크린샷 5장도 전부 페이지 요소가 부서지는 장면이다.
- **단일 목적과 인스펙터.** 인스펙터는 개발자 도구처럼 보일 수 있다. §4 가 "부수기 전에 그
  요소가 무엇인지 보여 주는 같은 대상의 다른 보기"로 묶어 두었다.
- **화면 캡처.** `captureVisibleTab` 은 민감하게 보이는 API 다. 새 권한 없이 `activeTab`
  으로만 돌고, 결과가 기기를 떠나지 않는다는 점을 §5 와 §6 양쪽에 적었다.
- **설명과 코드의 일치.** 심사가 설명을 코드와 대조한다. "네트워크 요청을 하지 않습니다"는
  사실이지만, 코드에 `fetch` 가 **한 군데 있다** — `options/options.js:1111` 의 `readJson()` 이
  `chrome.runtime.getURL(rel)` 로 만든 `chrome-extension://` 주소를 읽는다. 패키지 안의 파일이고
  바깥으로 나가지 않는다. 심사가 이걸 짚으면 그대로 답하면 된다.
  `XMLHttpRequest` · `WebSocket` · `sendBeacon` · 외부 URL 로드는 0건이다.

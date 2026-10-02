# 아키텍처

화면부수기(crash-tab)가 실제로 어떻게 동작하는지 설명합니다. 이 문서는 현재 코드
(`manifest.json`, `background.js`, `content.js` v1.2.0, `content.css`)를 읽고 쓴 것이며,
언급한 함수 이름은 모두 코드에 실제로 있는 것입니다.

목차

1. [전체 그림](#1-전체-그림)
2. [주입 모델](#2-주입-모델)
3. [오버레이 레이어 스택](#3-오버레이-레이어-스택)
4. [타겟 선택과 체력](#4-타겟-선택과-체력)
5. [부수기: 복제·분할·숨김](#5-부수기-복제분할숨김)
6. [조각 물리와 하나의 RAF 틱](#6-조각-물리와-하나의-raf-틱)
7. [전투 스케줄러](#7-전투-스케줄러)
8. [조준경](#8-조준경)
9. [복구·종료의 "흔적 0" 보장](#9-복구종료의-흔적-0-보장)
10. [모듈 맵 (`src/` 분리 계획)](#10-모듈-맵-src-분리-계획)

---

## 1. 전체 그림

움직이는 부품은 세 개뿐입니다.

| 파일 | 실행 위치 | 역할 |
| --- | --- | --- |
| `background.js` | MV3 서비스 워커 | 토글, `content.css`/`content.js` 주입, 툴바 배지 |
| `content.js` | 페이지의 메인 월드 | 나머지 전부 — 입력, 타겟 선택, 체력, 무기, 조각 물리, 균열 캔버스, 소리, HUD, 전투 |
| `content.css` | 페이지 문서, USER origin | 우리가 만든 노드의 스타일. 전부 `crs-` 접두사 |

설계 전제는 하나입니다. **페이지는 적대적일 수 있다.**

- 페이지의 CSP와 Trusted Types를 우회하지 않습니다. DOM은 `createElement` / `textContent` / `append`로만 만들고,
  스타일은 CSSOM으로만 씁니다. `innerHTML`, `eval`, 인라인 `style` 속성을 쓰지 않습니다.
- 모든 `chrome.*` 호출은 `safe()` / `safeThen()`으로 감쌉니다.
- 우리가 만든 노드는 전부 `data-crs="1"`과 `crs-` 클래스를 답니다 (`mk(tag, cls)`가 둘 다 붙입니다).
- 네트워크 요청과 외부 리소스가 전혀 없습니다. 효과음도 Web Audio로 합성합니다.

---

## 2. 주입 모델

### 토글 한 번의 흐름

`background.js`의 `toggleOnTab(tab)`이 전부입니다.

```
사용자가 툴바 아이콘 클릭 (또는 Ctrl/Cmd+Shift+X)
  └ chrome.action.onClicked
      └ toggleOnTab(tab)
          1. isInjectable(tab.url) — chrome://, chrome-extension://, about:, devtools://,
             view-source:, 웹스토어 호스트를 걸러냄. activeTab에서는 url이 undefined일 수 있는데,
             그때는 그냥 주입을 시도하고 실패 메시지를 looksBlocked(err)로 분류함
          2. chrome.scripting.insertCSS({ files: ['content.css'], origin: 'USER' })
          3. chrome.scripting.executeScript({ files: ['content.js'], injectImmediately: true })
          4. 결과값이 'off' 면 removeCSS 까지 해서 스타일도 걷어냄
```

### IIFE 완료값 계약

`content.js`는 통째로 하나의 IIFE이고, **그 완료값이 토글의 결과**입니다. 이 계약이 모든 것의 중심입니다.

```js
(() => {
  'use strict';
  if (window.__crashScreen) { return window.__crashScreen.toggle(); }   // 두 번째 주입 = 토글
  …
  window.__crashScreen = api;
  try { activate(); return 'on'; }
  catch (e) { deactivate(true); delete window.__crashScreen; return 'off'; }
})();
```

- **첫 주입**: `window.__crashScreen`이 없으므로 끝까지 실행되고 `activate()` 후 `'on'`을 반환합니다.
- **두 번째 주입**: 첫 줄에서 `toggle()`을 호출합니다. 켜져 있으면 `deactivate()` 후 `'off'`,
  꺼져 있으면 `activate()` 후 `'on'`.
- `chrome.scripting.executeScript`는 `results[0].result`로 이 값을 받습니다.
  테스트 하네스(스위트 A/B)는 같은 값을 `Runtime.evaluate`로 받습니다.
- 실패하면 반드시 `'off'`를 돌려주고 `window.__crashScreen`도 지웁니다. 반쯤 켜진 상태를 남기지 않습니다.

### 배지 동기화

양방향입니다.

- 콘텐츠 → 백그라운드: `sendState(active)`가 `{ type: 'crash:state', active }`를 보내고,
  백그라운드의 `onMessage`가 `setBadge(tabId, active ? 'ON' : '')`를 호출합니다.
  `activate()`, `deactivate()`, `pagehide`, `pageshow`, `visibilitychange`에서 보냅니다.
- 백그라운드 → 콘텐츠: `chrome.tabs.onUpdated`에서 `queryActive(tabId)`가
  `{ type: 'crash:query' }`를 보내고 콘텐츠가 `{ active }`로 답합니다.
  해시 변경이나 `pushState`도 `status: 'loading'`을 내기 때문에, 문서가 정말 사라졌는지 물어보고 나서야
  배지를 지웁니다. 응답이 없으면(= 수신자 없음) 꺼진 것으로 봅니다.
- 주입이 거부되면 `flashBlocked(tabId)`가 `✕` 배지를 1.5초 보여줍니다.
  그 사이에 성공한 `ON`이 들어오면 `✕`는 자기 자신인지 확인하고 지우므로 `ON`을 덮지 않습니다.

### 고아 인스턴스 처리

확장 프로그램을 새로 고치면 이전 콘텐츠 스크립트가 페이지에 살아남은 채로 새 스크립트가 주입될 수 있습니다.
`activate()`의 첫 줄이 이 경우를 처리합니다.

```js
doc.dispatchEvent(new CustomEvent('crs:teardown'));   // 살아 있는 옛 인스턴스가 스스로 내려감
sweepLeftovers();                                     // 그래도 남은 [data-crs] 노드와 [data-crs-broken] 복구
```

`crs:teardown` 리스너와 `pagehide` 리스너는 `deactivate()`로 지워지지 않습니다.
**페이지 수명 내내 등록되어 있어야** 고아 인스턴스를 잡을 수 있기 때문입니다.

---

## 3. 오버레이 레이어 스택

`mountHosts()`가 `documentElement`에 **호스트 세 개**를 붙입니다. 순서와 역할이 다릅니다.

```
docEl.append(shield, root, hud)

┌─ hud      <crs-hud class="crs-hud-host">   z-index 2147483647   shadow root
│                HUD 패널 · 탄약 HUD · 플레이어 HUD · 토스트. 포인터를 받습니다.
├─ root     <div class="crs-root">           z-index 2147483644   유리층
│                position: fixed, pointer-events: none. 우리가 그리는 모든 것이 여기 들어갑니다.
└─ shield   <div class="crs-shield">         z-index 2147483642   이벤트 차단막
                 페이지로 가는 포인터 이벤트를 삼킵니다.
```

### 최상위 레이어 (top layer)

z-index만으로는 페이지의 modal `<dialog>`나 popover를 이길 수 없습니다. 그래서 세 호스트를 모두
**팝오버 최상위 레이어**에 올립니다.

```js
function raise(host) {
  try { host.popover = 'manual'; host.showPopover(); }
  catch (e) { host.removeAttribute('popover'); }   // 지원하지 않는 브라우저는 z-index로 폴백
}
```

- `reraiseAll()`은 세 호스트를 `hidePopover()` → `showPopover()` 해서 최상위 레이어의 **맨 위**로 다시 올립니다.
  페이지가 자기 `<dialog>`를 연 직후(`onToggleEvt`)와 공격 직전(`action()`)에 호출합니다.
- `ensureMounted()`는 페이지가 우리 호스트를 떼어 냈을 때 다시 붙입니다.
- `applyZoom()`은 `html { zoom }`을 쓰는 페이지에서 호스트에 `zoom: 1/z`를 걸어 좌표계를 1:1로 되돌립니다.

### `root` 안의 레이어 순서 (`content.css`)

```
z-index 1   .crs-target (호버 박스)   .crs-hostile (적 아우라)   .crs-hit (붉은 물듦)
z-index 2   .crs-piece  .crs-word     ← 떨어지는 조각
z-index 3   .crs-canvas               ← 균열 캔버스 (조각 위에 그려집니다)
z-index 4   .crs-fx-flash  .crs-fx-ring  .crs-fire  .crs-rocket  .crs-slash-*
            .crs-tracer  .crs-orb  .crs-warn  .crs-beam
z-index 5   .crs-dmg                  ← 피해 숫자
z-index 6   .crs-vignette             ← 피격 비네트
z-index 7   .crs-scope                ← 조준경 (화면 전체를 덮습니다)
```

균열 캔버스가 조각보다 **위**에 있는 것이 핵심입니다. 유리가 깨진 자국은 떨어지는 파편보다 앞에 있어야
"유리판" 느낌이 납니다.

### 이벤트 차단막

`bindEvents()`가 `SWALLOW` 목록
(`pointerdown`, `pointerup`, `mousedown`, `mouseup`, `click`, `dblclick`, `auxclick`, `contextmenu`,
`selectstart`, `dragstart`)을 **window의 캡처 단계**와 shield 양쪽에 겁니다. `onSwallow(e)`는

1. HUD에서 난 이벤트면 그냥 통과시키고 (`isHudEvent`),
2. 이미 처리한 이벤트면 무시하고 (`handledEvents` WeakSet — 같은 이벤트가 두 리스너에 걸리므로),
3. `preventDefault()` + `stopImmediatePropagation()`으로 페이지에 닿지 않게 한 뒤,
4. 주 버튼 `pointerdown`이면 무기에 따라 `startHold()` / `startSlash()` / `smashAt()`을 부릅니다.

휠은 삼키지 않습니다. `onWheel`이 포인터 아래 스크롤 가능한 조상을 찾아 그쪽으로 스크롤을 넘깁니다.

### HUD의 격리

`buildHud()`는 `<crs-hud>` 커스텀 태그 호스트에 shadow root를 열고,
`new CSSStyleSheet()` + `adoptedStyleSheets`로 `HUD_CSS`를 넣습니다.
페이지 CSS가 HUD에 닿지 못하고, HUD CSS가 페이지로 새지도 않습니다.
`hudFallbackCheck()`는 구성된 스타일시트가 먹지 않은 경우(패널 배경색이 비어 있는 경우)를 감지해
핵심 노드에만 최소한의 인라인 스타일을 직접 넣습니다.

---

## 4. 타겟 선택과 체력

### `pickTarget(x, y, cache)`

1. `document.elementsFromPoint(x, y)`로 후보 목록을 얻습니다.
2. `pickFromList()`가 목록을 훑으며 `isOurs()`(우리 노드), 보이지 않는 요소(`visibleCandidate`,
   `effectiveOpacity`로 조상까지 누적 투명도 확인), 화면을 덮기만 하는 투명 오버레이(`isOverlay`)를 건너뜁니다.
   열린 shadow root가 있으면 그 안으로 재귀합니다.
3. 찾은 요소에서 **위로 올라가며** 적당한 크기의 블록 조상을 고릅니다. 글자 하나가 아니라
   "부술 만한 덩어리"를 고르기 위해서입니다. 이때 쓰는 면적 임계값은 `scopeMag()`의 제곱으로 보정합니다.
   조준경으로 2배 확대 중이면 화면상 rect도 2배이기 때문입니다.

### 체력 — `hpMax(el)` / `hpOf(el)`

```js
const m    = scopeMag();                               // 확대 중이면 2
const area = (rect.width / m) * (rect.height / m);     // 항상 페이지 좌표 기준
const base = 20 + 0.35 * Math.sqrt(area);

미디어 (img, picture, svg, video, canvas)        → base × 1.2
컨트롤 (button, input, select, textarea, …)      → base × 1.0
글자 요소 (p, span, li, h1~h6, a, code, …)       → base × 0.6, 최대 60
그 외 컨테이너                                     → base × 1.0

maxHp = clamp(round(…), 10, 400)
```

- `scopeMag()`로 나누기 때문에 **조준경을 켜도 체력이 바뀌지 않습니다.**
- 계산 결과는 `state.hp` (`WeakMap<Element, {hp, max, lastFxAt, side}>`)에 캐시됩니다.
  첫 호버나 첫 타격 때 정해지고 복구할 때까지 유지됩니다. `WeakMap`이라 페이지가 요소를 버리면 같이 사라집니다.
- `applyHit(el, dmg, kind, ix, iy, opts)`가 유일한 피해 경로입니다.
  `rec.hp -= dmg` → `hp <= 0`이면 `breakElement()`, 아니면 `reactDamage()`(흔들림·눌림) +
  `showTint()`(붉은 물듦) + 호버 라벨 갱신. 꾹 누르는 무기는 `HOLD_WINDOW`(150 ms)마다 한 번만
  이펙트를 갱신하고 피해 숫자는 `holdWindow()`가 합산합니다.

### 너비 우선 탐색 — `walkCandidates(x, y, opts)`

`document.body`의 자식부터 큐에 넣고 너비 우선으로 훑습니다. `limit`보다 작은 요소를 수집하고,
크면 자식으로 내려갑니다. 최대 60개, 방문 2000개에서 멈추고, 클릭 지점에서 가까운 순으로 정렬합니다.
**두 곳이 같은 함수를 씁니다.**

- `collapseCandidates()` — 붕괴 무기 (`limit` = 뷰포트의 25 %)
- `selectTick()` — 전투 모드의 적 후보 (`limit` = 뷰포트의 70 %, `minArea` 40 000,
  `descendCollected: true`로 수집한 요소 안쪽도 계속 탐색)

---

## 5. 부수기: 복제·분할·숨김

`breakElement(el, ix, iy, opts)`가 입구입니다.

```
breakElement
 ├ textDominant(el) 이면 ─ 글자 흩뿌리기
 │    ├ boxVisible(el) 이면  spawnGeometric(…, 1, { textTransparent: true })   ← 배경/테두리 상자 한 조각
 │    └ spawnWordPieces(el, …)                                                 ← 단어/글자 조각
 ├ 아니면 ─ spawnGeometric(el, …, pieceCount(el, mode, rect, descendants))
 │           └ input/textarea 면 spawnFieldSpill()                             ← 입력값도 쏟아냄
 ├ hideOriginal(el)                                                            ← 같은 동기 태스크에서
 └ 전투 중이면 hostileKilled() 또는 점수 가산
```

### 복제 — `buildStyledClone(el, rootW, rootH, cap, …)`

조각은 **원본의 복제본**입니다. 그래서 글꼴·배경·테두리가 그대로 떨어집니다.

- `cloneTree(src, st, depth, inShadow)`가 재귀 복제합니다. 깊이 상한 6, 노드 수 상한(`cap`).
  - `iframe` / `object` / `embed` / `audio`는 `substitute()`가 만든 평범한 `div`로 바꿉니다.
    (iframe 내부는 복제할 수 없고, `audio` 복제본은 또 재생을 시작해 버립니다.)
  - `canvas` / `video`는 `canvasOf()`로 현재 프레임을 새 캔버스에 그려서 씁니다.
  - 생성자가 실행되면 안 되는 커스텀 엘리먼트(`-`가 든 태그)도 `substitute()`로 바꿉니다.
  - `copyAttrs()`가 `STRIP_ATTRS`(id, name, style, tabindex, popover, …)와 `on*` 핸들러를 제거합니다.
    복제본이 접근성 트리나 폼에 끼어들면 안 되기 때문입니다.
  - `copyFormState()`가 `input` / `textarea` / `select`의 현재 값·체크 상태·선택 항목을 복사합니다.
- `diffStyles(st)` → `replayPlan(st, plan)`: 원본과 복제본의 **계산된 스타일을 비교**해서
  다른 속성만 복제본에 적어 넣습니다. 깊이 2 이하는 전체 목록(`STYLE_FULL`), 그보다 깊으면
  축약 목록(`STYLE_STAR`)을 씁니다. 전부 복사하지 않고 차이만 쓰는 것이 성능의 핵심입니다.
- `normalizeRoot(clone)`이 루트 복제본의 `position` / `inset` / `margin` / `transform`을
  중립값으로 되돌립니다. 조각은 우리 좌표계에 놓여야 하니까요.

### 분할 — `splitRect(w, h, n, ix, iy, splitLine)`

- `pieSplit()` — 타격 지점에서 뻗어 나가는 들쭉날쭉한 방사형 분할 (유리 느낌).
  도끼와 검은 `splitLine`을 넘겨서 **정확히 두 조각**으로, 검은 베인 선을 따라 쪼갭니다.
- `gridSplit()` — 격자 분할.
- 결과는 `polyToClip()`으로 `clip-path: polygon(...)` 문자열이 되어 각 조각 래퍼에 들어갑니다.

조각 개수는 `pieceCount()`가 면적·자손 수·무기 종류로 정합니다
(망치 4, 폭탄 6~8, 총기류 2, 큰 요소는 2 이하, 직전 분할이 25 ms를 넘었으면 1).

### 글자 흩뿌리기 — `spawnWordPieces()`

`Range.getClientRects()`로 **각 단어(또는 글자)의 실제 화면 위치**를 잽니다.
`tokenize()`가 `h1`~`h3`이거나 24자 이하면 글자 단위로, 아니면 단어 단위로 쪼갭니다
(`graphemes()`가 이모지를 쪼개지 않게 막고, 띄어쓰기 없는 한글/한자 덩어리는 2~4자씩 나눕니다).
`clipRectFor()`로 보이는 영역을 잘라 내고, 보이는 면적이 50 % 미만인 글자는 만들지 않습니다.
충돌 지점에 가까운 단어일수록 `launchAt`이 빨라 먼저 출발합니다.

### 원본 숨기기 — `hideOriginal(el)`

**레이아웃을 건드리지 않는 것**이 목표입니다. 그래서 `display: none`이 아니라 `visibility: hidden`입니다.

```js
for (const p of ['visibility', 'opacity', 'pointer-events']) {
  saved.push({ node, prop: p, value: node.style.getPropertyValue(p),
               priority: node.style.getPropertyPriority(p) });   // 우선순위까지 저장
}
imp(node, 'visibility', 'hidden'); imp(node, 'opacity', '0'); imp(node, 'pointer-events', 'none');
el.setAttribute('data-crs-broken', '1');
```

- 저장 대상은 요소 자신과 **`visibility: visible`을 직접 가진 자식들**입니다.
  자식이 명시적으로 `visible`이면 부모를 숨겨도 그대로 보이기 때문입니다.
- 값과 **우선순위를 함께** 저장합니다. 복구 때 `!important` 여부까지 정확히 되돌리기 위해서입니다.
- `MutationObserver`가 `style`/`class` 변화를 보고 있다가, SPA가 인라인 스타일을 다시 그려서
  원본이 되살아나면 다시 숨깁니다. **최대 5번**까지만 — 그 이상은 페이지와 싸우지 않습니다.
- 기록 `{ el, saved, mo, reapplied, wasPlaying }`은 `state.broken` 배열에 쌓이고, 복구가 이것을 되감습니다.

---

## 6. 조각 물리와 하나의 RAF 틱

### 조각 하나의 구조

`addPiece(node, p)`가 `state.pieces`에 레코드를 넣습니다. 주요 필드는
`node`, `ox`/`oy`(화면상 원점), `x`/`y`(원점 기준 변위), `vx`/`vy`/`vr`(속도·회전 속도),
`rot`, `tilt`, `bb`(클립 다각형의 바운딩 박스), `bornAt`, `launchAt`, `resting`, `grounded`.
`applyTransform(p)`가 `translate(...) rotate(...)` 하나로 적용합니다.

초기 속도는 `velocityFor(mode, ix, iy, cx, cy, opts)`가 정합니다.
범위 무기는 폭심에서 바깥으로 밀려나는 방향, 근접 무기는 타격 지점 반대 방향입니다.

### 상한과 퇴출

| 상수 | 값 | 뜻 |
| --- | --- | --- |
| `CAP` | 160 | 살아 있는 조각 수 상한 |
| `MIN_EVICT_AGE` | 800 ms | 이보다 어린 조각은 퇴출하지 않음 (붕괴 연쇄 중 첫 조각 보호) |
| `GPU_BUDGET` | 64 000 000 | 살아 있는 조각들의 `w × h × dpr²` 합 상한 |

`enforceCap(incoming, incomingGpu)`가 새 조각을 받기 전에 자리를 만듭니다.
`evictPieces()`가 오래된(멈춘) 조각부터 페이드아웃시키고, 그 위에 얹혀 있던 조각은 `wakePiece()`로 다시 떨어뜨립니다.

### 하나의 RAF 틱 — `kick()` → `tick(t)` → `tickFrame(t)`

**RAF 루프는 하나뿐입니다.** 물리, 균열 이펙트 큐, 전투 구체, 레이저, 조준경이 전부 같은 프레임에서 돕니다.

```js
function tickFrame(t) {
  const dt = clamp((t - state.lastT) / 1000, 0, 0.05);   // 탭 복귀 시 점프 방지 (최대 50 ms)
  …
  // 1) 조각 물리
  //    - 중력 GRAVITY(2400 px/s²), 공기 저항 vx *= 0.6^dt
  //    - 쌓기: 먼저 멈춘(resting) 조각들을 모아 두고, 가로로 40 % 이상 겹치면서
  //      이번 프레임에 윗면을 통과한 조각의 윗면을 바닥(support)으로 삼습니다
  //    - 착지: vy > 30 이면 튕김(vy = -vy * 0.32), 아니면 안착 → 회전을 가까운 180° 배수 + tilt 로 정렬
  //    - 좌우 벽에서 vx = -vx * 0.5
  //    - |vx| < 6 이고 |vr| < 8 이면 restPiece(), 6초가 지나고 거의 멈췄으면 강제로 restPiece()
  if (state.fxQueue.length) runFx();            // 2) 균열을 여러 프레임에 나눠 그리기
  if (state.orbs.length)   orbStep(t, dt);      // 3) 전투: 탄환 구체
  if (state.beams.length)  beamStep();          // 4) 전투: 레이저
  if (state.scoped)        scopeStep(t);        // 5) 조준경 원·스웨이·반동
  if (busy && …)           regenStep();         // 6) 플레이어 체력 회복
  return busy;                                  // busy 가 false 가 되면 루프가 스스로 멈춥니다
}
```

- `kick()`은 **멱등**입니다. 이미 돌고 있으면(`state.animating`) 아무것도 하지 않습니다.
  무언가 생길 때마다 아무 데서나 불러도 안전합니다.
- `tick()`은 `tickFrame()`을 `try`로 감쌉니다. 한 프레임이 예외를 던져도 루프가 죽지 않습니다.
  예외는 `state.lastError`에 남고 `state.tickErrors`를 올리며, 살아 있는 것이 남아 있고
  오류가 120번 미만이면 다음 프레임을 다시 겁니다.
- `busy`가 `false`가 되면 루프를 멈춥니다. 가만히 있는 페이지에서 RAF가 계속 돌지 않습니다.

### 그 밖의 비동기 수단

- **`setInterval`은 한 번도 쓰지 않습니다.** 반복은 전부 `later()` 체인입니다
  (`clockTick`, `regenChain`, `holdStep`, `selectTick`). `later(fn, ms)`가 만든 id는
  `state.timers`에 등록되고 실행 후 자동으로 빠집니다.
- 일회성 RAF가 몇 개 있지만 전부 핸들을 상태에 보관합니다 —
  `state.moveRaf`(`onMove`), `state.resizeRaf`(`onResize`), `state.hudRaf`(`scheduleHud`),
  `state.auraRaf`(`scheduleAura`). `deactivate()`가 전부 `cancelAnimationFrame` 합니다.
- Web Animations API로 만든 애니메이션은 `trackAnim(a)`이 `state.anims`에 넣고 끝나면 뺍니다.

---

## 7. 전투 스케줄러

플레이어는 **포인터**입니다 (`state.player`, `trackPlayer(e)`가 좌표를 갱신).

### 무장과 선택

```
activate() / restore()
  └ armCombat()
      ├ state.graceUntil = now() + GRACE_MS(5000)
      ├ combatTimer = later(selectTick, 5000)     ← 5초 유예 후 첫 선택
      └ clockTimer  = later(clockTick, 1000)      ← 생존 시간 표시용 1초 체인
```

`selectTick()`은 1.5초마다 스스로를 다시 겁니다. 다음 중 하나라도 해당하면 **선택만 거릅니다**
(체인은 유지): KO 상태, 플레이어 사망, `debug.noAttacks`, 조준 중, 포인터가 창 밖,
문서가 숨김 상태, 이미 `maxHostiles()`만큼 적이 있음.

선택은 `walkCandidates()`가 모은 후보 중에서 **√면적 가중 랜덤**입니다.
큰 요소가 더 자주 뽑히되 작은 요소도 기회가 있습니다.

| 함수 | 규칙 |
| --- | --- |
| `maxHostiles()` | 3, 전투 시작 60초 뒤부터 5 |
| `tierFor(area)` | 400 000 px² 초과 `laser`, 150 000 이상 `charger`, 40 000 이상 `shooter`, 그 아래는 적이 되지 않음 |
| `attackInterval(rec)` | `TIER_BASE[tier] × max(0.5, 1 − 경과/120000)` — 2분에 걸쳐 주기가 절반까지 |
| `TIER_BASE` | `{ shooter: 1800, charger: 3000, laser: 4500 }` (ms) |

### 적 하나의 수명

```
markHostile(el, area)
  ├ .crs-hostile 아우라 + '👿 TAG' 라벨을 root 에 붙임
  ├ hpOf(el) 을 지금 계산해 캐시          ← 확대 중에 다시 재지 않기 위해
  ├ setAuraPulse(rec, 900)                ← WAAPI 무한 alternate 애니메이션
  └ scheduleAttack(rec, attackInterval(rec))
        └ later(() => hostileAttack(rec, false), ms)
              ├ attackShooter → spawnOrb (250 ms 충전) → launchOrb → orbStep 이 날림
              ├ attackCharger → 700 ms 경고 링 → chargerSlam (요소 영역 + 60 px 판정)
              └ attackLaser   → placeBeam (550 ms 추적) → fireBeam (250 ms 고정 + 400 ms 발사)
                                 → checkBeamHit (선에서 16 px 이내)
```

- `clearPhase(rec)`가 그 적의 경고/빔/텔레그래프 노드를 거두고 아우라를 평상시 맥박으로 되돌립니다.
- `scheduleAura()`는 **일회성 RAF**입니다. 스크롤·리사이즈·조준경 전환에서 호출되어 아우라를
  요소 rect에 다시 맞춥니다. 2초 넘게 화면 밖에 있던 적은 `releaseHostile()`로 풀어 줍니다
  (처치가 아니라 해제 — 점수가 오르지 않습니다).
- 적을 부수면 `breakElement()` 안의 단 하나의 훅이 `hostileKilled(el, max)`를 부릅니다.
  공격 준비 중이던 적을 부수면 점수 ×1.5. 전투 중에 일반 요소를 부수면 `round(max / 4)`점입니다.

### 탄환 구체 요격

구체는 쏠 수 있습니다. 무기 종류별로 세 가지 경로가 있습니다.

| 함수 | 쓰는 곳 |
| --- | --- |
| `interceptOrb(x, y)` | 단일 지점 무기 — 구체 중심 18 px 이내 |
| `interceptOrbsWithin(x, y, R)` | 폭탄·로켓 — 폭발 반경 안의 구체 전부 |
| `interceptOrbsAlong(x1, y1, x2, y2, R)` | 검 — 베는 선에서 18 px 이내 |

요격하면 `popOrb(o)`가 터뜨리고 +5점, **그리고 그 공격은 페이지에 닿지 않습니다.**
폭탄과 로켓만 예외로 구체를 터뜨리면서 페이지도 때립니다.

### 피해와 일시정지

- `damagePlayer(n)` → 비네트, 플레이어 HUD 흔들림, 소리, 포인터 옆 `-N`.
- `regenStep()`은 마지막 피격 후 3초가 지나면 초당 3씩 회복합니다.
  루프가 돌고 있으면 `tickFrame()`에서, 멈춰 있으면 `regenChain()`(500 ms `later` 체인)에서 돕니다.
- `pauseCombat()` / `resumeCombat()`이 창 blur·탭 숨김에서 전투를 멈추고 1초 뒤 재개합니다.
  날아가던 구체와 레이저는 사라집니다. 일시정지 시간은 `player.pausedTotal`로 생존 시간에서 빼 줍니다.
- 체력이 0이면 `showKo()`가 KO 오버레이를 띄우고 모든 공격과 사격을 막습니다.
  `restartFromKo()`는 `restore()` + 플레이어 초기화 + 5초 유예 재시작입니다.

---

## 8. 조준경

저격총을 든 채 마우스 오른쪽 버튼이나 `Shift`(120 ms 이상)를 누르면 `syncScope()`가
`scopeOn()` / `scopeOff()`를 호출합니다. 코드 묶음(chord) 모델이라
`Shift+숫자` 같은 조합키는 조준경을 켜지 않습니다.

`scopeOn()`이 하는 일 중 **페이지를 건드리는 유일한 부분**이 2배 확대입니다.

```js
if (body && bs.transform === 'none' && z === 1 && !reducedMotion()) {
  sc.saved = ['transform', 'transform-origin'].map((p) => ({
    prop: p, value: body.style.getPropertyValue(p), priority: body.style.getPropertyPriority(p)
  }));
  imp(body, 'transform', 'scale(2)');
  imp(body, 'transform-origin', px(x - bb.left) + ' ' + px(y - bb.top));
  sc.magnified = true;
}
```

- **건너뛰는 조건**: `body`에 이미 `transform`이 있거나, `html { zoom }`을 쓰거나,
  시스템이 "움직임 줄이기"를 켠 경우. 이때는 조준경 화면만 뜨고 확대는 하지 않습니다 (`sc.magnified = false`).
- `transform-origin`을 **포인터 위치에서 body rect를 뺀 값**으로 잡습니다.
  그래야 포인터 아래에 있던 요소가 제자리에 남습니다(페이지가 흘러가지 않습니다).
- 값과 우선순위를 `sc.saved`에 저장해 두고 `scopeOff()`가 그대로 되돌립니다.
  빈 값이었으면 `removeProperty()`로 속성 자체를 지웁니다.
- 확대 중에는 모든 rect가 2배가 되므로 `scopeMag()`를 쓰는 곳이 전부 보정합니다 —
  `hpMax()`, `pickTarget()`의 임계값, `isOverlay()`.
  `scopeOn()`/`scopeOff()` 양쪽에서 `scheduleAura()`를 불러 적 아우라도 새 rect에 맞춥니다.
- 유리층(`root`)과 HUD는 `documentElement`에 붙어 있으므로 **확대되지 않습니다.**
  균열과 조각은 1배 좌표계에 그대로 있습니다.

`scopeStep(t)`가 매 프레임 조준경 원의 중심을 포인터로 옮기고 ±3 px 흔들림(`reducedMotion`이면 0),
발사 반동(250 ms 동안 40 px에서 되돌아옴)을 적용합니다.
어두운 바깥은 `radial-gradient`를 `background`에 다시 쓰는 방식입니다.

---

## 9. 복구·종료의 "흔적 0" 보장

이 확장 프로그램의 약속은 **"새로고침 없이 전부 되돌린다"** 입니다.
그래서 모든 부작용에 소유자가 있습니다.

| 만든 것 | 등록처 | 정리하는 곳 |
| --- | --- | --- |
| 타이머 | `later()` → `state.timers` | `clearTimers()` |
| WAAPI 애니메이션 | `trackAnim()` → `state.anims` | `cancelAnims()` |
| 이벤트 리스너 | `listen()` → `state.listeners` | `unbindEvents()` |
| RAF 핸들 | `state.rafId` / `moveRaf` / `resizeRaf` / `hudRaf` / `auraRaf` | `deactivate()` |
| 조각 노드 | `state.pieces` | `restore()` |
| 숨긴 원본 | `state.broken`의 `saved` 배열 | `restore()` |
| `body`의 transform | `state.scope.saved` | `scopeOff()` |
| AudioContext | `audio.ctx` | `deactivate()`의 `c.close()` |

### `restore()` — 부수기 모드는 유지한 채 되돌리기

1. 진행 중인 것부터 끕니다: `stopHold(true)`, `cancelSlash()`, `cancelCollapse()`, `resetChord()`,
   `scopeOff()`, `stopReload()`, `clearTimers()`, RAF 취소.
2. `clearCombatNodes()` — 적 아우라·구체·레이저·경고 링 (처치 수와 점수는 건드리지 않습니다).
3. `cancelAnims()` 후 모든 조각 노드를 제거하고, 혹시 놓친 것이 있으면
   `root.querySelectorAll('.crs-piece, .crs-word, .crs-dmg, …')`로 한 번 더 쓸어 냅니다.
4. **원본 되돌리기** — `state.broken`의 각 기록에 대해
   `MutationObserver`를 `disconnect()` 하고, 저장해 둔 `{node, prop, value, priority}`를 그대로 복원합니다.
   원래 값이 비어 있었으면 `removeProperty()`로 **속성 자체를 지웁니다.**
   페이지에서 떨어져 나간(detached) 원본도 복원합니다. 페이지가 노드를 뗐다가 다시 붙이는 경우
   숨겨진 채로 돌아오면 안 되니까요. 마지막에 `data-crs-broken` 속성을 지웁니다.
5. 상태 초기화: `state.hp` / `tints` / `dmgAgg`를 **새 WeakMap으로 교체**, 카운터·탄창(`initAmmo()`)·
   플레이어(`resetPlayer()`) 초기화, KO와 토스트 숨김, `clearCanvas()`.
6. `armCombat()`으로 5초 유예를 다시 시작합니다.

### `deactivate(silent)` — 완전히 내려가기

1. 모든 RAF 핸들을 취소합니다.
2. `restore()`를 부릅니다.
3. `scopeOff()`를 **한 번 더** 부릅니다. `body`의 transform이 절대 살아남으면 안 되기 때문입니다.
4. `clearTimers()`를 **다시** 부릅니다. ← 중요한 디테일입니다.
   `restore()`의 마지막 줄 `armCombat()`이 아직 `active`인 상태에서 타이머를 새로 걸기 때문에,
   그걸 거두지 않으면 종료 후에도 타이머가 남습니다.
5. `unbindEvents()`로 리스너를 전부 뗍니다.
6. 호스트 세 개를 `lower()`(팝오버 닫기) 후 제거하고, 모든 DOM 참조를 `null`로 만듭니다.
7. `documentElement`에서 `crs-active`, `crs-swing`, `crs-scoped` 클래스를 지웁니다.
8. `stopLoop()` 후 AudioContext를 닫습니다.
9. `sendState(false)`로 배지를 끕니다.

### 페이지 수명 내내 남는 것

`deactivate()`가 지우지 **않는** 리스너가 다섯 개 있습니다. 의도된 것입니다.

```js
doc.addEventListener('crs:teardown', …)       // 새 인스턴스가 옛 인스턴스를 내릴 때
win.addEventListener('pagehide', …)           // 탭을 떠날 때 (bfcache 포함) 자동 종료
win.addEventListener('pageshow', …)           // bfcache 복귀 시 배지 동기화
chrome.runtime.onMessage(crash:query)         // 백그라운드의 상태 질의에 응답
doc.addEventListener('visibilitychange', …)   // 탭 복귀 시 배지 동기화
```

이것들은 DOM 노드를 만들지도, 페이지를 바꾸지도 않습니다.
검증 기준은 **`document.querySelectorAll('[data-crs]').length === 0`** 이고 e2e가 이를 확인합니다.

---

## 10. 모듈 맵 (`src/` 분리 계획)

현재 `content.js`는 번호가 붙은 16개 구역(`/* 0. … */` ~ `/* 15. … */`)으로 나뉜 하나의 파일입니다.
계획된 `src/` 분리는 **이 경계를 그대로 파일로 옮기는 순수 이동**입니다.
런타임은 여전히 하나로 합쳐진 `content.js`이고, 조각들은 하나의 공유 클로저 안에서 순서대로 실행됩니다.

| 계획된 파일 | 현재 구역 | 들어갈 것 |
| --- | --- | --- |
| `src/00-prelude.js` | 0 | `VERSION`, 싱글턴 가드, 캡처한 전역(`win`/`doc`/`raf`/`setT`/…), `safe()`, `safeThen()`, `later()` / `track()` / `untrack()`, `trackAnim()` |
| `src/10-util.js` | 0, 2 | `rand`/`clamp`/`px`, `alphaOf()`, `mk()`, `imp()`, `countDescendants()`, `rectOf`/`gcs`/`tagOf`/`parentOf`/`viewW`/`viewH`/`isOurs`, `KO` 사전과 `msg()` |
| `src/20-state.js` | 1, 15(일부) | `state` 객체, `handledEvents`/`handledKeys`, DOM 참조 변수, `loadPrefs()`, `setWeapon`/`setPower`/`setMuted` 같은 설정 반영 |
| `src/30-canvas.js` | 2, 3, 4 | `raise`/`lower`/`reraiseAll`/`ensureMounted`/`applyZoom`/`mountHosts`, `setupCanvas`/`clearCanvas`, `CRACK` 프로필과 `makeRay`/`pointAt`/`drawCrack`/`runFx`, `drawSlash`, `scorchDab`, `flash`/`ring`/`shake`/`swingCursor` |
| `src/40-audio.js` | 5 | `audio`, `ensureAudio`, `env`/`noiseBurst`/`noiseSweep`/`tone`, `startLoop`/`stopLoop`, `sfx` |
| `src/50-target.js` | 7 | `effectiveOpacity`/`visibleCandidate`/`isOverlay`/`pickFromList`/`pickTarget`, `hpMax`/`hpOf`/`hpOfPublic`, `showTarget`/`refreshHover`/`scheduleHover`/`pulseTarget`/`critFlashFill`, `walkCandidates` |
| `src/60-break.js` | 8, 9, 11 | `polyInfo`/`rayExit`/`pieSplit`/`gridSplit`/`splitRect`/`polyToClip`, `substitute`/`canvasOf`/`copyAttrs`/`copyInlineStyle`/`copyFormState`/`cloneTree`/`diffStyles`/`replayPlan`/`normalizeRoot`/`buildStyledClone`, `hideOriginal`, `textDominant`/`boxVisible`/`pieceCount`/`spawnGeometric`/`graphemes`/`tokenize`/`spawnWordPieces`/`spawnFieldSpill`/`breakElement`/`reactDamage` |
| `src/70-physics.js` | 10, 13 | `velocityFor`, `addPiece`/`applyTransform`/`restPiece`/`wakePiece`/`evictPieces`/`batchGpu`/`enforceCap`/`makeWrapper`/`debrisCount`, `kick`/`tick`/`tickFrame`/`onResize` |
| `src/80-weapons.js` | 12(앞부분) | `rollCrit`/`rollSniperCrit`/`rollDamage`, `applyHit`/`spawnDmg`/`showTint` 계열, `onCooldown`/`startCooldown`, `aoeCandidates`/`aoeHit`, `fireHammer`/`firePistol`/`fireSmg`/`fireSniper`/`fireAxe`/`fireStab`/`doSlash`/`fireBomb`/`fireRocket`/`fireFlame`/`doCollapse`, `action`/`smashAt`/`slashSegment`/`startHold`/`holdStep`/`stopHold`/`startSlash`/`resolveSlash`, 탄약(`initAmmo`/`spend`/`startReload`/`stopReload`/`ammoInfo`), 조준경(`scopeOn`/`scopeOff`/`syncScope`/`scopeStep`/`scopeRadius`/`scopeMag`/`tracerFx`) |
| `src/85-loadout.js` | 12(일부) | `slotKey`/`slotOf`, `isPermutation`/`setLoadout`/`applyPreset`/`moveToSlot`/`stepSlot` |
| `src/90-combat.js` | 12(뒷부분) | `armCombat`/`clockTick`/`selectTick`/`markHostile`/`releaseHostile`/`hostileKilled`/`scheduleAttack`/`hostileAttack`/`clearPhase`/`placeAura`/`setAuraPulse`/`scheduleAura`, 구체(`spawnOrb`/`launchOrb`/`orbStep`/`popOrb`/`intercept*`), 빔(`placeBeam`/`fireBeam`/`beamStep`/`checkBeamHit`), 플레이어(`damagePlayer`/`regenStep`/`showKo`/`hideKo`/`restartFromKo`/`pauseCombat`/`resumeCombat`/`setCombat`) |
| `src/95-hud.js` | 6, 12(일부) | `HUD_CSS`, `hudButton`/`buildHud`/`hudFallbackCheck`, `updateHud`/`scheduleHud`/`reorderHud`/`pulseBadge`/`hudLastHit`/`bumpCombo`, `updateAmmoHud`, `updatePlayerHud`, `toast`/`hideToast` |
| `src/99-api.js` | 14, 15 | `SWALLOW`와 모든 이벤트 핸들러(`onSwallow`/`onHoldEnd`/`onMove`/`onKey`/`onKeyUp`/`onWheel`/`onToggleEvt`/`onWindowBlur`/`onWindowFocus`/`onVisibility`/`onScroll`/`onPointerEnter`/`onPointerLeave`), `listen`/`bindEvents`/`unbindEvents`, `clearTimers`/`cancelAnims`/`sweepLeftovers`, `restore`/`activate`/`deactivate`/`toggle`, `stats`/`weaponList`, 수명 주기 리스너, `api` 객체와 부트스트랩 반환값 |

### 분리 규칙

- `src/modules.json`이 순서를 정합니다. 목록에 없는 `.js`가 `src/`에 있거나, 목록의 파일이 없으면
  `tools/build.js`가 실패합니다.
- `tools/build.js`가 조각들을 `// ── <파일명> ──` 배너와 함께 이어 붙이고,
  v1의 IIFE 껍데기(완료값이 `'on'`/`'off'`인 그 IIFE)로 감싼 뒤,
  `DO NOT EDIT — generated from src/ by tools/build.js` 헤더를 붙여 `content.js`를 씁니다.
- 조각 사이에 `import`/`export`도, 네임스페이스 객체도 없습니다. 함수 선언은 호이스팅되므로
  뒤쪽 파일의 함수를 앞쪽 파일에서 불러도 됩니다. 다만 **`const` 초기화 순서는 실행 순서를 따릅니다** —
  모듈 최상위에서 다른 모듈의 `const`를 즉시 읽으면 안 됩니다.
- 이 전환은 **동작을 바꾸지 않습니다.** 분리 직후 e2e가 단언 개수까지 그대로 통과해야 합니다.

---

## 부록: 상태 들여다보기

페이지 콘솔에서 `window.__crashScreen`으로 전부 확인할 수 있습니다.

```js
__crashScreen.stats()      // 카운터, 탄창, 조준 여부, 전투 상태, pieces 배열, lastError
__crashScreen.weapons()    // 현재 로드아웃 순서와 슬롯 키
__crashScreen.player()     // 체력·점수·처치·생존 시간
__crashScreen.hpOf(el)     // 그 요소의 { hp, max }
__crashScreen.debug        // { noCrit, forceCrit, noCooldown, noSpread, noAttacks, fastReload, infiniteAmmo }
```

예외는 삼키지만 사라지지는 않습니다. `safe()`와 `later()`, `tick()`이 잡은 예외는 전부
`state.lastError`에 문자열로 남고 `stats().lastError`로 읽을 수 있습니다.
버그를 제보할 때 이 값을 함께 보내 주세요.

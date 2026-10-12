# 설정 체계 · 성능 가드 · 접근성

로드맵 2단계. 뒤의 단계 대부분이 설정 키를 추가하므로 받침을 먼저 만든다.

---

## 1. 설정 체계

### 1.1 단일 소스

`settings-schema.json` 을 저장소 루트에 둔다. 항목 하나는 이렇게 생겼다.

```json
{ "key": "debrisAnchor", "type": "enum", "default": "document",
  "options": ["document", "viewport"], "labelKey": "setDebrisAnchor", "group": "general" }
```

- 그룹: `general`, `combat`, `accessibility`, `advanced`.
- `tools/build.js` 가 `/*@SETTINGS_SCHEMA@*/` 마커 자리에 동결 리터럴로 끼워 넣는다
  (빌드 스크립트에 이미 그 경로가 있다).
- 옵션 페이지(10단계)는 `chrome.runtime.getURL` 로 같은 파일을 읽는다. 두 곳이 한 파일을 본다.
- `tools/validate.js` 규칙 R10 이 이미 이 파일을 기다리고 있다. 항목마다 `key`·`type`·`default`·
  `labelKey` 가 있고 `enum` 에는 `options` 가 있으며 기본값이 타입에 맞는지 검사한다.

### 1.2 지금까지 흩어진 키를 모은다

이미 쓰고 있는 저장 키를 스키마로 끌어온다:
`crsWeapon`, `crsPower`(제거됨), `crsMuted`, `crsLoadout`, `crsLoadoutPreset`, `crsCombat`→`mode`,
`crsDebrisLifeMs`, `crsDebrisAnchor`, `crsWeaponArt`, `crsViewmodel`, `crsSeenCombatHelp`.

| key | type | 기본 | 그룹 |
|---|---|---|---|
| `mode` | enum(rampage,arcade,survival) | `rampage` | general |
| `defaultWeapon` | enum(무기 id) | `hammer` | general |
| `loadoutPreset` | enum | `default` | general |
| `debrisAnchor` | enum(document,viewport) | `document` | general |
| `debrisLifeMs` | enum(3000,6000,12000,0) | `6000` | general |
| `debrisCap` | int 20–300 | `160` | advanced |
| `soundVolume` | int 0–100 | `28` | general |
| `muted` | bool | `false` | general |
| `weaponArt` | enum(auto,svg,emoji) | `auto` | general |
| `viewmodel` | bool | `true` | general |
| `combatDifficulty` | enum(easy,normal,hard) | `normal` | combat |
| `reduceMotion` | enum(auto,on,off) | `auto` | accessibility |
| `highContrastMarkers` | bool | `false` | accessibility |
| `keyboardAim` | bool | `false` | accessibility |
| `perfMode` | enum(auto,quality,performance) | `auto` | advanced |

뒤 단계가 추가할 키(조준점, 보조 공격, 통계 등)는 그 단계에서 같은 형식으로 더한다.

### 1.3 저장과 구독

- `chrome.storage.sync` 에 저장한다. 크기가 큰 것(통계·리플레이·사용자 정의 무기)만 `local`.
- 활성화 시 한 번 읽고, `chrome.storage.onChanged` 를 구독해 **옵션 탭에서 바꾸면 열려 있는
  페이지가 즉시 반영**된다. 재활성화가 필요 없다.
- `api.settings()` 는 해석된 설정을, `api.setSetting(key, value)` 는 스키마로 검증 후 저장한다.
  잘못된 값은 무시하고 `stats().lastError` 에 남긴다.
- 구 키 마이그레이션은 한 번만 돌고 구 키를 지운다.

---

## 2. 성능 가드

### 2.1 측정과 전환

- 활성화 시와 이후 10초마다 `document.getElementsByTagName('*').length` 와
  최근 30프레임의 평균 `tick()` 비용을 잰다.
- `auto` 는 요소 수 8000 초과 또는 평균 틱 8ms 초과면 `performance` 를, 아니면 `quality` 를 고른다.
  `quality`/`performance` 는 강제값이다.

### 2.2 `performance` 모드에서 내리는 것

| 대상 | 기본 | 성능 모드 |
|---|---|---|
| 조각 상한 | 설정값(160) | `min(설정값, 80)` |
| 데칼 상한 | 40 | 12 |
| 텍스트 분해 | 자손 ≤ 200, 토큰 ≤ 80 | 자손 ≤ 120, 토큰 ≤ 40 |
| 복제 스타일 비교 | 자손 400개 | 150개 |
| 적 선정 간격 | 900ms | 2500ms |
| 동시 적 수 | 5 | 2 |
| 입자 | 상한 60 | 30 |
| 균열 선 수 | 1.0배 | 0.7배 |
| 캔버스 DPR | 최대 2 | 최대 1.5 |

### 2.3 후보 탐색 캐시

`walkCandidates` 결과를 300ms 메모이즈한다. 키는 뷰포트 크기 + `round(scrollY/100)`.
`document.body` 에 `MutationObserver`(childList+subtree, 카운터만) 를 걸어 변경 시 무효화하고
`deactivate()` 에서 끊는다.

`stats().perf` → `{ mode, elements, avgTickMs, cap }`. 강제로 내려간 동안 HUD 에 작은 배지를 띄운다.

### 2.4 테스트

- 9000개 노드를 생성한 픽스처에서 활성화·30회 타격·종료에 페이지 오류가 없고
  `stats().perf.mode === 'performance'` 이며 스위트 총 실행 시간이 8초 이상 늘지 않는다.
- `perfMode: 'quality'` 강제 시 요소 수와 무관하게 상한이 내려가지 않는다.
- 캐시: 같은 프레임에서 `walkCandidates` 를 10번 불러도 실제 순회는 1회다.

---

## 3. 접근성

### 3.1 모션 축소

`reduceMotion: auto` 는 `prefers-reduced-motion` 을 따른다. 축소 시:

- 화면 흔들림 진폭 0, 히트스톱 없음
- 적대 오라 맥동이 정적 표시로
- 피해 숫자가 이동 없이 페이드만
- KO 오버레이가 확대 없이 페이드
- 로켓 비행 40ms 로 단축, 불꽃 입자 절반
- 조준경 흔들림 없음
- 뷰모델 대기·걷기 흔들림 없음(반동과 재장전은 절반 진폭으로 유지 — 정보 전달이므로)
- 락온 괄호가 애니메이션 대신 3단계 스냅(정보는 유지)

### 3.2 색에 의존하지 않기

`highContrastMarkers`:
- 적대 오라에 45도 줄무늬 패턴과 `⚠` 글리프를 더한다. 붉은색만으로 구분하지 않는다.
- 체력 바에 숫자를 상시 표시한다.
- 호버 표식과 적대 표식을 실선으로 올린다(시각 정돈 단계의 약한 신호가 안 보이는 경우를 위해).

### 3.3 키보드 조작

`keyboardAim`:
- 가상 커서 `div.crs-kbcursor[data-crs]` 를 방향키로 움직인다. 20px, `Shift` 5px, `Alt` 60px.
- `Space` 로 현재 무기를 그 지점에 쏜다. `Enter` 로 조준경 토글.
- `Tab`/`Shift+Tab` 으로 조준 가능한 후보를 문서 순서로 순회하며 커서를 중심에 스냅한다.
- 전투 모드에서는 이 가상 커서가 플레이어 위치가 되어 회피가 성립한다.
- 켜면 조작법을 토스트로 알린다. 서바이벌의 WASD 와 충돌하므로 그때는 방향키를 조준에만 쓴다.

### 3.4 스크린 리더

- HUD 섀도 루트 안에 시각적으로 숨긴 `aria-live="polite"` 영역을 둔다.
- 알리는 것: 무기 변경, 재장전 시작과 완료, 모드 변경, 챌린지 시작과 종료, KO, 복구.
- KO 오버레이는 `role="dialog"`, `aria-modal="true"`, 두 버튼 사이로 포커스를 가두고
  닫을 때 원래 포커스를 되돌린다.
- 모든 HUD 버튼에 3:1 대비를 만족하는 포커스 링을 보인다.

### 3.5 테스트

- `reduceMotion: 'on'` 강제 시 흔들림 진폭 0, 히트스톱 없음, 뷰모델 대기 애니메이션 0개.
- `highContrastMarkers: true` 에서 오라에 패턴이 있고 체력 숫자가 상시 보인다.
- `keyboardAim: true` 에서 방향키로 가상 커서가 움직이고 `Space` 로 요소가 부서진다.
  서바이벌에서는 방향키가 조준, WASD 가 이동으로 갈린다.
- live 영역이 무기 변경과 재장전을 텍스트로 알린다.
- KO 오버레이에서 `Tab` 이 두 버튼 사이를 돈다.

---

## 4. 완료 기준

`tools/validate.js` R10 통과, 전체 스위트 통과, 설정 왕복(저장→재활성화→유지) 확인,
`docs/ROADMAP.md` 2단계 완료 표시, 한 번에 커밋 후 푸시.

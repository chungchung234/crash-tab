# 변경 이력 (Changelog)

이 파일의 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르며,
버전 번호는 [유의적 버전(Semantic Versioning)](https://semver.org/lang/ko/)을 따릅니다.

버전은 세 곳에 같은 값으로 적혀 있어야 합니다 — `manifest.json`의 `version`,
`package.json`의 `version`, 그리고 콘텐츠 스크립트의 `VERSION` 상수
(현재는 `content.js`, `src/`로 분리된 뒤에는 `src/00-prelude.js`).
`node tools/validate.js`가 이 세 값을 대조합니다.

## [Unreleased]

### 추가

- **전투 가독성 (SPEC-readability §2–§3).** 실제로 플레이해 본 피드백 — "장탄 수와 체력은 잘 안 보이고,
  적의 공격은 좋은데 **그게 나한테 일어나는 일로 안 읽힌다**" — 에 답한 묶음입니다. 공격 패턴·주기·피해량·등급·
  점수·KO 조건은 하나도 바꾸지 않았습니다. 읽히게만 만들었습니다.
  - **플레이어 링** (`.crs-selfbox` / `.crs-self`): 전투 중 커서에 붙는 지름 44px 링이 곧 체력 게이지입니다.
    12시부터 시계방향으로 `hp/max` 만큼 칠해지고(`conic-gradient`, CSSOM만 — SVG 없음) 가운데에 6px 점이 있습니다.
    피격 시 64px로 부풀었다 200ms에 걸쳐 돌아오며 붉게 번쩍이고, **피해가 날아온 방향**으로 60° 쐐기가 350ms 뜹니다.
    체력 30% 미만이면 1.2초 주기로 맥동하고, 조준경 중에는 20% 불투명도로 내려갑니다.
  - **조준 당함** (`.crs-aimline`): 적이 공격 준비에 들어가면 그 적의 가장 가까운 테두리에서 플레이어 링까지 붉은
    파선이 그어지고, 오라가 1.6배 밝아지고 라벨 앞에 `🎯` 가 붙고 220Hz 경고음이 한 번 납니다. 발사와 함께 사라집니다.
  - **날아오는 것**: 탄환 14px → 22px, 잔상 6샘플, 비행 중 줄어들어 충돌 시점에 탄환 크기가 되는 **충돌 예상 링**
    (`.crs-orb-ring`), 그리고 현재 위치 기준으로 맞을 궤적이면 밝게 / 빗나갈 궤적이면 흐리게. T2 돌진의 경고 링은
    실제 타격 경계까지 줄어들며 멈추고, T3 레이저는 고정되는 순간 추적을 멈추고 주황 실선 + 양 끝에서 모이는 표식이 됩니다.
  - **아슬아슬**: 탄환이 피격 반경과 +45px 사이를 스쳐가면 바람 소리, 스쳐간 쪽의 흰 호, `회피!` 표시 (2초에 3회까지).
  - **맞았을 때**: 70ms 히트스톱(물리 `dt` = 0), 맞은 방향에 몰린 붉은 비네트 450ms, 흔들림 8px, 낮고 큰 타격음,
    24px 피해 숫자, 체력 바·링 동시 번쩍임. `prefers-reduced-motion` 이면 히트스톱과 흔들림만 빠집니다.
- **탄약·체력 HUD 확대 (SPEC-readability §2).** 두 패널 모두 어두운 반투명 판(`rgba(12,12,16,.72)` + blur) 위로
  올라가 밝은 페이지에서 묻히지 않습니다. 탄약은 48px 숫자(기존 28px) + 무기 이모지 + 흐린 `/ ∞` + **탄창 핍**
  (남은 탄 수만큼 7×4px 막대, 최대 30개, 그 이상은 10발 묶음)이고 폭을 196px로 고정해 `교체 중` 이 떠도 패널이
  튀지 않습니다. 체력은 220×16px(기존 160×10px) 10칸 눈금 바 + `체력 72 / 100` 숫자이며, 피격 시 흰색 번쩍임 →
  250ms 드레인 → 패널 6px 흔들림으로 줄어드는 게 보입니다.
- `stats()` 에 `selfRing` / `aimlines` / `nearMisses` / `hitstop`, `player()` 에 `lastHitFrom`,
  테스트 플래그에 `debug.hitstop`.
- 저장소 부트스트랩: `.gitignore`, `.editorconfig`, Apache-2.0 `LICENSE`.
- `package.json` — CI 전용 메타데이터와 스크립트(`build` / `check` / `test` / `package` / `icons` / `bump`).
  배포되는 확장 프로그램 자체에는 여전히 의존성이 하나도 없습니다.
- `tools/validate.js` — 의존성 없는 정적 검사기. 매니페스트 파싱과 참조 파일 존재 여부, 버전 삼중 일치,
  권한 allowlist, 두 로케일의 키 집합 일치와 `__MSG_*__` / `msg()` 참조 검사, 금지 API 검사
  (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`,
  `setAttribute('style'`, `setInterval(`), PNG IHDR 기반 아이콘 크기 검사, CHANGELOG 섹션 존재 여부,
  BOM/CRLF 검사를 수행합니다.
- `tools/package.js` — 순수 Node ZIP 작성기(`zlib.deflateRawSync` + 직접 쓴 중앙 디렉터리).
  배포 대상 파일만 모아 `dist/crash-tab-<version>.zip`을 만들고, 10 MB를 넘거나 검증에 실패하면 중단합니다.
  같은 입력에 대해 바이트 단위로 동일한 아카이브를 만듭니다(재현 가능한 빌드).
- `tools/version.js` — 버전 올리기와 CHANGELOG 섹션 추출.
- GitHub Actions 워크플로 세 개: `ci.yml`(검증 + 아이콘 결정성 + e2e), `release.yml`(`v*` 태그 →
  zip 첨부 릴리스), `publish-store.yml`(수동 실행 전용 Chrome 웹 스토어 업로드/배포).
- 문서: `CHANGELOG.md`, `CONTRIBUTING.md`, `docs/RELEASING.md`, `docs/ARCHITECTURE.md`.
- 이슈·PR 템플릿(`.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`).

### 제거

- **공격력 배율.** `state.power`, `api.setPower` / `api.power`, `stats().power`, 저장 키 `crsPower`,
  HUD의 `공격력 ×1` 행과 `−`/`+` 버튼, 단축키 `-`/`_`/`[`/`=`/`+`/`]`, 로케일 키 `labelPower` 를 모두 없앴습니다.
  피해 계산은 `max(1, round(무기 피해 × (치명타 ? 2 : 1)))` 로 단순해집니다. 이미 저장된 `crsPower` 는
  읽지 않고 발견 즉시 삭제합니다.

### 알려진 문제

- 저장소에 `package-lock.json`이 없습니다. 이 때문에 CI는 `npm ci`가 아니라
  `npm install --no-audit --no-fund --prefer-offline`을 사용합니다. 자세한 사정은
  `docs/RELEASING.md`의 "의존성 설치" 절을 참고하세요.

## [1.2.0] - 2026-10-02

FPS 레이어: 저격총과 조준경, 탄창과 재장전, 로드아웃, 그리고 반격하는 컴포넌트.

### 추가

- **저격총(🎯)과 조준경.** 피해 200, 볼트액션 쿨다운 600 ms, 탄창 5발.
  마우스 오른쪽 버튼이나 `Shift`(120 ms 이상)로 조준경이 켜지고 `document.body`에
  `transform: scale(2)`가 적용돼 페이지가 2배로 확대됩니다. 포인터를 따라오는 원형 조준경,
  십자선·밀도트·링, ±3 px 흔들림, 발사 시 40 px 반동, 화면 오른쪽 아래에서 그어지는 예광탄.
  무배율 사격은 x·y 각각 ±25 px 퍼지고 조준 사격은 정확합니다. 헤드샷(치명타 ×2) 확률은
  조준 시 25 %, 무배율 10 %. 조준경은 무기 교체·재장전·복구·종료·`Esc`·포커스 이탈·KO에서 자동으로 꺼지며,
  원래 인라인 스타일을 그대로 되돌립니다.
- **탄창과 재장전.** 총기·폭발 무기에 탄창이 생기고 예비 탄약은 무한입니다.
  마지막 탄을 쏘면 자동 재장전, `R`로 수동 재장전. 재장전 중 발사는 무시되고, 무기를 바꾸면 재장전이 취소됩니다.
  무기 교체 딜레이 250 ms. 오른쪽 아래에 탄약 HUD(이모지, 숫자, 재장전 진행 바, `R 재장전` 깜빡임)가 생겼습니다.
- **로드아웃.** 10개 무기 전체의 순서를 `1`~`9`, `0` 키에 매핑합니다. 프리셋 5종
  (기본 / 돌격 / 저격 / 폭발 / 근접), `Shift+숫자`와 HUD 그리드 드래그로 슬롯 교환,
  `Q`/`E`로 이전·다음 슬롯. `crsLoadout`, `crsLoadoutPreset`에 저장됩니다.
- **전투 모드.** 켜진 뒤 5초 유예가 지나면 1.5초마다 화면에 보이는 큰 요소 하나를 √면적 가중 랜덤으로 골라
  적으로 만듭니다(동시 3개, 60초 뒤 5개). 면적에 따라 세 등급:
  T1 사수(탄환 구체), T2 돌진(슬램), T3 레이저. 공격 주기는 2분에 걸쳐 최대 절반까지 짧아집니다.
  플레이어는 포인터이며 체력 100, 3초간 피격이 없으면 초당 3씩 회복합니다.
  탄환 구체는 어떤 무기로든 요격할 수 있습니다(+5점). 적을 부수면 처치로 집계되고,
  체력이 0이 되면 KO 화면(`다시 시작` / `종료`)이 뜹니다. 왼쪽 아래 플레이어 HUD에
  체력 바·점수·처치·생존 시간·적 수가 표시됩니다. `H` 또는 HUD 버튼으로 끄고 켜며 `crsCombat`에 저장됩니다.
- **토스트 알림**(화면 위 가운데): 전투 모드 전환, 프리셋 적용, 슬롯 이동, 수동 재장전, KO.
- 창 포커스 이탈·탭 숨김 시 전투 일시정지, 복귀 1초 뒤 재개. 포인터가 창 밖이면 공격하지 않습니다.
  화면 밖으로 2초 넘게 나간 적은 풀려납니다.
- `api.ammo()`, `api.reload()`, `api.loadout()`, `api.setLoadout()`, `api.applyPreset()`,
  `api.scope()`, `api.player()`, `api.setCombat()` 공개. `api.stats()`에
  `mag`, `reloading`, `swapping`, `scoped`, `magnified`, `lastShot`, `combat`, `hostiles`,
  `orbs`, `beams`, `playerHp`, `score`, `kills`, `paused`, `ko`, `loadout`, `preset`이 추가되었습니다.
- 테스트용 디버그 플래그 `noAttacks`, `fastReload`, `infiniteAmmo`, `noSpread`와
  훅 `debug.setPlayerHp()`, `debug.setPlayerPos()`, `debug.forceAttack()`.

### 변경

- 무기 피해 재조정: 망치 60 → 65, 권총 20 → 25, 기관총 7 → 22/발, 검 45 → 60/요소,
  도끼 100 → 130, 폭탄 150 → 190, 화염방사기 6 → 15/틱.
- 무기 단축키가 더 이상 무기 테이블에 고정되어 있지 않고 로드아웃 순서에서 나옵니다.
- HUD 무기 영역이 한 줄에서 2×5 그리드로 바뀌고 슬롯 키 배지가 붙었습니다.
- 물리·구체·레이저·조준경 애니메이션이 모두 하나의 `requestAnimationFrame` 틱으로 합쳐졌습니다.
  별도의 RAF 루프나 `setInterval`은 없습니다.
- 체력(HP)이 조준경 확대 중에도 페이지 좌표 기준으로 계산됩니다(2배 확대가 체력을 바꾸지 않습니다).

## [1.1.0] - 2026-10-01

크기 기반 체력과 무기고.

### 추가

- **크기 기반 HP.** 하트를 대체합니다. `base = 20 + 0.35 × √면적`에 종류 배수
  (미디어 ×1.2 / 컨트롤·컨테이너 ×1.0 / 글자 요소 ×0.6, 상한 60)를 곱하고 10~400으로 제한합니다.
  호버 라벨이 `IMG 67/127` 형식으로 바뀌고 그 아래 46×3 px 체력 바(초록/노랑/빨강)가 생겼습니다.
- **아홉 가지 무기**: 망치, 권총, 기관총, 도끼, 검, 폭탄, 로켓, 화염방사기, 붕괴.
  기관총과 화염방사기는 꾹 누르기, 검은 드래그 베기(12 px 미만이면 찌르기), 폭탄과 로켓은 범위 공격입니다.
  범위 피해는 `round(중심 피해 × (1 − 0.73 × t))`로 감쇠합니다.
- **공격력 배율** ×0.5 / ×1 / ×2 / ×4 (`-`·`=` 키, HUD 버튼, `crsPower`에 저장)와
  10 % 확률 **치명타**(피해 ×2).
- **피해 숫자**가 타격 지점에서 떠오르고, 맞은 영역이 타격 지점을 중심으로 붉게 물들었다가 180 ms 안에 사라집니다.
- **피해 반응**: 체력이 남은 요소는 맞은 방향으로 흔들리고(스프링), 폼 컨트롤은 눌리듯 찌그러집니다.
  페이지가 이미 적용한 `transform` 위에 `composite: 'add'`로 겹쳐 레이아웃을 건드리지 않습니다.
- **콤보** 카운터와 콤보에 따라 올라가는 타격음 피치.
- 쿨다운 중 클릭에 대한 피드백(짧은 "딸깍" 소리 + HUD 버튼 테두리 깜빡임).
- 로켓의 150 ms 비행 연출, 화염방사기의 불꽃 입자·그을림 누적·탄 색 조각(`brightness(.55) sepia(.6)`),
  도끼와 검으로 부순 요소의 두 조각 분할(검은 베인 선을 따라).
- 텍스트 입력 필드가 부서질 때 안에 든 글자가 단어 조각으로 쏟아집니다(최대 40개).
- `api.weapons()`, `api.setWeapon()`, `api.slash()`, `api.hpOf()`와
  `stats()`의 `shots`, `damageDealt`, `crits`, `scorch`, `holding`, `combo` 카운터.
- 디버그 플래그 `noCrit`, `forceCrit`, `noCooldown`.

### 변경

- `setMode('gun')`은 `pistol`을 고르는 호환 별칭으로 남았습니다. 저장된 `crsMode` 값도 같은 규칙으로 변환됩니다.
- HUD에 피해·점수 카운터와 마지막 타격 줄(`IMG -65 (62/127)`)이 추가되었습니다.

## [1.0.0] - 2026-10-01

첫 릴리스.

### 추가

- 툴바 아이콘 또는 `Ctrl+Shift+X` / `Cmd+Shift+X`로 현재 탭을 "부수기 모드"로 전환.
  배지에 `ON`이 표시되고, 스크립트를 넣을 수 없는 페이지에서는 `✕`가 잠깐 깜빡입니다.
- 네 가지 모드: 망치, 폭탄, 총, 붕괴.
- **절차적 유리 균열**을 그리는 영구 캔버스. DPR을 따르고, 창 크기가 바뀌어도 그려진 균열을 보존하며,
  균열이 쌓일수록 잉크 농도가 낮아집니다.
- **DOM 요소 조각내기**: 계산된 스타일을 복사한 복제본을 만들고 `clip-path` 다각형으로 잘라냅니다.
  원본은 인라인 스타일을 저장한 뒤 `visibility: hidden`으로 숨기므로 레이아웃은 그대로입니다.
- **조각 물리**: 중력 2400 px/s², 바닥·벽 반사, 먼저 멈춘 조각 위에 쌓이기, 살아 있는 조각 160개 상한과
  오래된 조각부터의 퇴출.
- **텍스트 흩뿌리기**: `Range.getClientRects()`로 단어(또는 글자)의 실제 위치를 재서 하나하나 따로 떨어뜨립니다.
- 섬광·충격파 링·화면 흔들림, Web Audio로 합성한 효과음(오디오 파일 없음), 음소거(`M`, `crsMuted`에 저장).
- **HUD**: shadow DOM + constructed stylesheet로 격리되고 제목 줄을 끌어 옮길 수 있습니다.
  조각·균열 카운터와 상황별 힌트 줄을 표시합니다.
- **복구(`Z`)**: 조각·균열·효과를 모두 지우고 숨겼던 원본의 인라인 스타일을 그대로 되돌립니다.
  **종료(`Esc`)**: 복구한 뒤 오버레이·HUD·리스너·타이머를 전부 제거해 페이지에 `[data-crs]` 노드를
  하나도 남기지 않습니다.
- 세 겹 오버레이(이벤트 차단막 / 유리층 / HUD)를 팝오버 최상위 레이어에 올려 페이지의 `<dialog>`나
  popover 위에도 그려집니다.
- 한국어 우선(`_locales/ko`), 영어 대체(`_locales/en`).
- Pillow 없이 순수 파이썬으로 아이콘을 생성하는 `tools/make-icons.py`.
- puppeteer 기반 e2e 스위트 3종: (A) 콘텐츠 스크립트 하네스, (B) 엄격한 CSP + Trusted Types 페이지,
  (C) 실제 확장 프로그램 로딩(서비스 워커 토글, 배지, 포인터 이벤트).

[Unreleased]: https://github.com/chungchung234/crash-tab/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/chungchung234/crash-tab/releases/tag/v1.2.0
[1.1.0]: https://github.com/chungchung234/crash-tab/releases/tag/v1.1.0
[1.0.0]: https://github.com/chungchung234/crash-tab/releases/tag/v1.0.0

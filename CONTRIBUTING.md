# 기여 가이드

화면부수기(crash-tab)에 기여해 주셔서 고맙습니다. 이 문서는 저장소 구조, 로컬에서 테스트를 돌리는 방법,
코드 규칙, 커밋·PR 규칙을 설명합니다.

- 아키텍처 설명: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- 릴리스 절차: [`docs/RELEASING.md`](docs/RELEASING.md)

---

## 1. 필요한 것

| 도구 | 버전 | 용도 |
| --- | --- | --- |
| Node.js | 20 이상 (CI는 22) | 검증·패키징 도구와 e2e 실행 |
| Python 3 | 3.9 이상 | 아이콘 생성 (`tools/make-icons.py`, Pillow 불필요) |
| Chrome | 120 이상 | 수동 테스트 |
| puppeteer | 25 이상 | e2e (설치 방법은 아래 3절 참고) |

**배포되는 확장 프로그램 자체에는 의존성이 하나도 없습니다.** `package.json`은 CI와 개발 도구용이며,
`node_modules/`는 git에서 제외됩니다. 확장 프로그램을 실행하는 데는 빌드도 설치도 필요 없습니다.

---

## 2. 저장소 구조

```
manifest.json              MV3 매니페스트 (activeTab, scripting, storage — host_permissions 없음)
background.js              서비스 워커: 토글, CSS/JS 주입, 배지
content.js                 주입되는 콘텐츠 스크립트 (단일 IIFE)
content.css                문서 레벨 스타일 (USER origin으로 주입, crs- 접두사만 사용)
icons/                     icon16/32/48/128.png — tools/make-icons.py가 생성
_locales/ko, _locales/en   UI 문자열 (ko가 기본 로케일)
tools/make-icons.py        아이콘 생성기 (순수 파이썬)
tools/validate.js          정적 검증 게이트
tools/package.js           dist/crash-tab-<version>.zip 생성
tools/version.js           버전 올리기 / CHANGELOG 섹션 추출
test/e2e.js                puppeteer e2e (스위트 A / B / C)
test/fixture.html|css|js   e2e용 데모 페이지
test/out/                  e2e 산출물 (스크린샷·임시 확장 프로그램 복사본) — git에서 제외
docs/                      아키텍처·릴리스 문서
.github/workflows/         CI, 릴리스, 스토어 배포
```

### 앞으로의 구조: `src/` + `tools/build.js`

`content.js`는 약 4 000줄짜리 단일 파일입니다. 유지보수를 위해 **소스를 `src/`의 조각 파일들로 나누고
`tools/build.js`가 다시 한 파일로 이어 붙이는** 모델로 옮겨 갈 예정입니다.

- 런타임은 지금과 똑같이 **하나로 합쳐진 `content.js`** 입니다. 주입 방식은 전혀 바뀌지 않습니다.
- `src/`의 조각들은 **하나의 공유 클로저 안에서** 순서대로 실행됩니다. 네임스페이스 객체도, 전역 변수도,
  모듈 시스템도 없습니다. 조각끼리는 서로의 `const` / `function` 선언을 그대로 봅니다.
- 순서는 `src/modules.json`이 정합니다. 목록에 있는 파일이 없거나, `src/`에 목록에 없는 `.js`가 있으면
  빌드가 실패합니다.
- 조각 파일 이름과 담당 범위는 `docs/ARCHITECTURE.md`의 모듈 맵을 참고하세요.

이 전환이 끝나기 전까지는 **`content.js`를 직접 편집합니다.** 전환 이후에는 다음 규칙이 적용됩니다.

- `content.js`는 생성물입니다. 맨 위에 `DO NOT EDIT — generated from src/ by tools/build.js` 헤더가 붙고,
  `tools/validate.js`가 그 헤더를 검사합니다. 직접 고치지 마세요.
- 소스를 고친 뒤에는 `npm run build`(= `node tools/build.js`)로 다시 생성하고,
  **생성된 `content.js`도 함께 커밋합니다.**
- CI는 `node tools/build.js --check`로 디스크의 `content.js`가 `src/`와 일치하는지 확인합니다.

---

## 3. 테스트를 로컬에서 돌리기 (`npm install` 없이)

`test/e2e.js`는 puppeteer를 **이 순서로** 찾습니다.

1. 환경변수 `PUPPETEER_PATH`가 가리키는 경로
2. npx 캐시 — `~/.npm/_npx/<해시>/node_modules/puppeteer`
3. 평범한 `require('puppeteer')`

그래서 이 저장소에서 `npm install`을 실행할 필요가 없습니다. 이미 어딘가에 puppeteer가 있다면
경로만 알려 주면 됩니다.

```bash
# 가장 단순한 방법 — 이미 설치된 puppeteer를 가리키기
PUPPETEER_PATH=/path/to/node_modules/puppeteer node test/e2e.js

# npx 캐시에 받아 두고 쓰기 (한 번만)
npx --yes puppeteer@25 --version    # 캐시에 내려받습니다
node test/e2e.js                    # 캐시에서 자동으로 찾습니다

# 저장소에 설치해도 됩니다 (node_modules/는 git에서 제외됩니다)
npm install --no-audit --no-fund
npm test
```

puppeteer를 찾지 못하면 e2e는 다음 메시지를 내고 실패합니다.

```
FAIL puppeteer not found. Set PUPPETEER_PATH=/path/to/node_modules/puppeteer
(or have it in ~/.npm/_npx/*/node_modules/puppeteer).
```

### e2e가 검사하는 것

| 스위트 | 내용 |
| --- | --- |
| A | 콘텐츠 스크립트 하네스 — `test/fixture.html`에 `content.css` / `content.js`를 직접 넣고 API와 동작을 검사 |
| B | 엄격한 CSP + Trusted Types 페이지에서 같은 스크립트가 동작하는지 |
| C | 실제 확장 프로그램 로딩 — `test/out/ext`에 복사본을 만들어 Chrome에 올리고, 서비스 워커 토글·배지·포인터 이벤트를 검사 |

스위트 C는 puppeteer 25 이상의 `enableExtensions: true`를 사용하므로 그보다 낮은 버전으로는 돌지 않습니다.

### 유용한 환경변수

```bash
CRS_SEED=1234 node test/e2e.js   # 스트레스 테스트의 클릭 좌표 시드. 실패한 실행을 로그의 시드로 재현합니다
```

실패하면 `test/out/`에 스크린샷이 남습니다. CI에서도 실패 시 `test/out/`을 아티팩트로 올립니다.

### 그 밖의 검사

```bash
node tools/validate.js        # 정적 검증 게이트 (아래 5절)
node tools/validate.js --strict   # 경고도 실패로 취급 (릴리스 워크플로가 사용)
node tools/package.js --dry-run   # 패키징할 파일 목록과 크기만 출력

python3 tools/make-icons.py   # icons/*.png 재생성 — 결정적이므로 재생성해도 바이트가 같아야 합니다

# 문법 검사 — node --check 는 첫 번째 파일만 보므로 파일마다 따로 실행합니다
node --check background.js
node --check content.js
node --check test/e2e.js
python3 -m json.tool manifest.json > /dev/null
```

---

## 4. 수동 테스트

1. 크롬에서 `chrome://extensions`를 엽니다.
2. **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누르고 이 저장소 폴더를 선택합니다.
4. 아무 페이지에서 툴바 아이콘이나 `Cmd+Shift+X` / `Ctrl+Shift+X`를 누릅니다.

자동화가 사용자 제스처를 흉내 낼 수 없는 항목(툴바 클릭, 단축키, 터치, 소리, 조준경 확대 등)은
`README.md`의 **수동 QA 체크리스트**를 따라 확인해 주세요.

---

## 5. 코드 규칙

이 확장 프로그램은 **적대적인 페이지 위에서** 실행됩니다. 페이지의 CSP(Trusted Types 포함)를 우회하지 않고,
페이지가 우리 노드를 보고 깨지지 않게 하는 것이 전제입니다. `tools/validate.js`가 아래 규칙 중
기계적으로 검사 가능한 것들을 강제합니다.

### 페이지에 주입되는 코드(`content.js`, `src/`, `background.js`)에서 금지

- `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`
- `eval(`, `new Function`
- `setAttribute('style', ...)` — 인라인 스타일 **속성**을 쓰지 마세요
- `setInterval(` — 반복 작업은 `later()` 체인이나 단일 RAF 틱으로 합니다

### 지켜야 할 것

- DOM은 `createElement` / `textContent` / `append`로만 만듭니다.
- 스타일은 CSSOM으로만 바꿉니다 (`node.style.setProperty(...)`, `imp()` 헬퍼).
- 우리가 만든 노드에는 **반드시** `data-crs="1"` 속성과 `crs-` 접두사 클래스를 붙입니다 (`mk()` 헬퍼가 처리).
- 모든 `chrome.*` 호출은 `safe()` / `safeThen()`으로 감쌉니다. 리스너는 절대 throw 하지 않습니다.
- 타이머는 `later()`로 만들어 `state.timers`에 등록하고, 애니메이션은 `trackAnim()`으로 등록합니다.
  그래야 `deactivate()`에서 하나도 남지 않고 정리됩니다.
- **종료 후 흔적 0**: `deactivate()` 뒤에 페이지에는 `[data-crs]` 노드도, 타이머도, 애니메이션도,
  RAF 루프도 남아 있으면 안 됩니다. `body`의 `transform`도 원래대로 돌아가야 합니다.
- 새 권한을 추가하지 마세요. 매니페스트의 `permissions`는 `activeTab`, `scripting`, `storage`뿐이고
  `host_permissions`는 아예 없어야 합니다.
- 네트워크 요청, 외부 리소스, 원격 코드, 텔레메트리는 어떤 형태로도 추가하지 않습니다.

### 확장 프로그램 페이지 (`options/`, `share/` — 앞으로 추가될 예정)

확장 프로그램 출처의 문서이므로 보통의 DOM API를 써도 됩니다. 다만 `eval(`과 `new Function`은 여전히 금지입니다.

### 다국어

사용자에게 보이는 문자열은 전부 `_locales/ko`와 `_locales/en` 양쪽에 키가 있어야 하고,
`msg('키')`로 읽습니다. 한쪽에만 있는 키는 검증에서 실패합니다.

### 스타일

`.editorconfig`를 따릅니다 — UTF-8, LF, 공백 2칸, 파일 끝 개행, 줄 끝 공백 제거.
BOM과 CRLF는 검증에서 실패합니다.

---

## 6. 커밋 규칙

[Conventional Commits](https://www.conventionalcommits.org/ko/v1.0.0/)를 사용합니다.

```
<type>: <무엇을 했는지 한 줄>

<필요하면 본문>

Co-Authored-By: ...
```

쓰는 타입: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `perf`, `build`.

예시:

```
feat: 저격총 조준경에 밀도트 눈금 추가
fix: 재장전 중 무기를 바꾸면 탄 수가 초기화되던 문제
ci: e2e 실패 시 test/out 아티팩트 업로드
docs: 릴리스 롤백 절차 추가
```

- `main`에 **force-push 하지 않습니다.** 기존 커밋 이력을 다시 쓰지 않습니다.
- 한 커밋은 한 가지 일만 합니다. 리팩터링과 기능 변경을 섞지 마세요.
- 순수 이동(pure move) 리팩터링은 **동작이 바뀌지 않아야** 하고, e2e의 단언 개수가 그대로여야 합니다.

---

## 7. PR 체크리스트

PR을 열기 전에 확인해 주세요.

- [ ] `node tools/validate.js`가 통과합니다 (실패가 하나도 없음).
- [ ] `src/`가 생긴 뒤라면 `node tools/build.js --check`가 통과하고, 생성된 `content.js`를 함께 커밋했습니다.
- [ ] `node test/e2e.js`가 통과합니다 (실패 0). 동작을 바꿨다면 e2e 단언을 추가했습니다.
- [ ] 사용자에게 보이는 문자열을 추가했다면 `_locales/ko`와 `_locales/en` **양쪽**에 넣었습니다.
- [ ] 금지 API(`innerHTML`, `eval(`, `setInterval(` 등)를 쓰지 않았습니다.
- [ ] 새로 만든 노드에 `data-crs`와 `crs-` 클래스가 있고, 종료 후 `[data-crs]` 노드가 0개입니다.
- [ ] 타이머·애니메이션·RAF를 새로 만들었다면 `deactivate()`에서 정리됩니다.
- [ ] 권한을 추가하지 않았습니다.
- [ ] 사용자에게 보이는 변화라면 `CHANGELOG.md`의 `[Unreleased]`에 한 줄 적었습니다.
- [ ] 동작이 바뀌었다면 `README.md`도 함께 고쳤습니다.
- [ ] 커밋 메시지가 Conventional Commits 형식입니다.

버전 번호를 PR에서 올리지 마세요. 버전 올리기는 릴리스 담당자가 `docs/RELEASING.md`의 절차로 합니다.

---

## 8. 버그 제보

`.github/ISSUE_TEMPLATE/bug_report.yml` 양식을 써 주세요. 특히 다음 정보가 중요합니다.

- 크롬 버전, 운영체제
- 문제가 난 페이지 주소(공개 페이지라면)
- 페이지 콘솔에서 `window.__crashScreen.stats()`를 실행한 결과 — 특히 `lastError`
- 재현 단계와 기대한 동작

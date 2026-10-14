# crash-tab — 작업 규칙

화면부수기(crash-tab). 웹 페이지의 **요소**를 부수는 Manifest V3 크롬 확장이다.
화면 이미지가 아니라 DOM 요소와 직접 반응하는 것이 이 제품의 정체성이다.

## 먼저 읽을 것

- `docs/ROADMAP.md` — 무엇을·왜·어떤 순서로
- `docs/specs/` — 단계별 상세 명세. **구현 전에 해당 명세를 끝까지 읽는다.**
- `docs/specs/running-tests.md` — 이 머신에서 테스트 돌리는 법

명세에 없는 동작을 지어내지 않는다. 명세가 모호하면 그 사실을 적고 고른 해석을
코드 주석과 보고에 남긴다.

## 빌드 — `content.js` 는 생성물이다

`content.js` 를 직접 고치지 않는다. `src/*.js` 를 고치고 빌드한다.

```bash
node tools/build.js       # src/modules.json 순서대로 content.js 로 합친다
node tools/build.js --check   # 소스와 생성물이 어긋나면 실패
node tools/validate.js    # 16개 규칙 (버전 일치, i18n, 아이콘, 텍스트 위생 등)
```

모듈은 **하나의 클로저로 이어 붙인다.** 서로 다른 모듈의 최상위 이름이 겹치면 뒤 모듈이
이긴다. 조용히 깨지므로 새 최상위 이름은 먼저 `grep` 한다.

새 모듈을 추가하면 `src/modules.json` 에 **정렬된 자리로** 끼워 넣는다.

## 적대적 페이지에서 돌아간다 — 금지 목록

임의의 웹페이지에 주입되고 CSP·Trusted Types 가 걸려 있을 수 있다. 다음을 쓰지 않는다.

- `innerHTML` · `outerHTML` · `insertAdjacentHTML` · `document.write`
- `eval` · `new Function`
- `setAttribute('style', …)` — 스타일은 CSSOM(`el.style.setProperty`)으로만

SVG 는 `createElementNS` + `setAttribute` 로 만든다. 이건 허용된다.
스위트 B 가 엄격 CSP + Trusted Types 아래에서 이걸 검증한다.

## USER 오리진 CSS 함정

`content.css` 는 **USER 오리진**으로 주입된다. 그래서 거기 붙은 `!important` 는 인라인
스타일과 Web Animations 까지 이긴다.

**JS 가 쓰거나 애니메이션하는 속성은 `content.css` 에서 `!important` 없이 선언한다.**
이걸 어기면 애니메이션이 조용히 아무 일도 안 한다. 실제로 여러 번 당했다.

CSS 를 병합할 때는 규칙 본문 안에서 충돌이 나면 중괄호가 깨질 수 있다.
병합 후 `{` 와 `}` 개수가 같은지 반드시 확인한다. 한 번 이것 때문에 규칙 18개가
조용히 죽었다.

## 흔적을 남기지 않는다

`Escape` 또는 토글 해제 후:
- `[data-crs]` 노드 0개
- 모든 페이지 요소의 인라인 스타일이 원래 값으로 (빈 문자열이 아니라 **원래 값**)
- 살아있는 타이머·인터벌·RAF 0개 (타이머 원장이 센다)
- 실행 중인 애니메이션 0개

페이지 요소의 인라인 스타일을 바꾸기 전에 원래 값과 우선순위를 저장한다.

## 테스트

```bash
node test/e2e.js                      # 전체, 59초, 797 단언
CRS_BLOCKS=rules node test/e2e.js     # 57초 — 모드·적만 피해·적만 포커싱·아키타입·투사체
CRS_BLOCKS=core node test/e2e.js      # 56초 — 픽스처·주입·HP·무기 아트·재질·조준점·뷰모델
CRS_BLOCKS=ammo node test/e2e.js      # 42초 — 탄창·저격경·로드아웃·가독성
CRS_BLOCKS=combat node test/e2e.js    # 34초 — 드론·락온·복구
CRS_BLOCKS=debris node test/e2e.js    # 30초 — 파편 수명
CRS_BLOCKS=depth node test/e2e.js     # 28초 — 깊이·관통·변위
CRS_BLOCKS=settings node test/e2e.js  # 6초  — 스키마·성능 가드·접근성
```

- 반복 중에는 건드린 블록만 돌린다. **완료 판정은 항상 전체 실행이다.**
- 블록은 자기 브라우저와 자기 페이지를 열고 **자기 전제를 스스로 만든다.**
  새 단언을 추가할 때 앞 단언이 남긴 상태에 기대지 않는다.
- **단언을 지우지 않는다.** 느리다고 검증을 버리는 건 거래가 아니다.
  명세가 바뀌어 단언이 틀렸다면 고쳐 쓰되, 무엇을 왜 바꿨는지 적는다.
- `debug.timeScale` (기본 1, 범위 `[0.05, 1]`)로 결과만 보는 단언을 빠르게 돌린다.
  **그 시간 자체가 요점인 단언은 배율 1 로 남긴다.**
- 부하가 높을 때 `Target closed` · 물리 안정화 단언 · 총 실행 시간 단언이 간헐적으로
  진다. 한가할 때 재현되어야 진짜 결함이다. `CRS_LANES=1` 로 직렬화할 수 있다.

## 병렬 작업 (git worktree)

여러 기능을 동시에 진행할 때는 worktree 로 나누고 **파일 소유를 겹치지 않게** 자른다.
공유 파일은 추가만 한다:

| 파일 | 규칙 |
|---|---|
| `src/modules.json` | 정렬된 자리에 끼워 넣기 |
| `_locales/*/messages.json` | 끝에 추가 |
| `content.css` | 배너 주석으로 구분된 블록을 끝에 추가 |
| `test/e2e.js` | 해당 블록 함수의 끝에 추가 |
| `content.js` | 생성물. 병합하지 말고 **다시 빌드**한다 |

## 커밋

- 한국어로 쓴다. 제목은 무엇을 했는지, 본문은 왜 그렇게 했는지.
- `node tools/build.js --check` 와 `node tools/validate.js` 와 전체 테스트가
  통과한 상태에서만 커밋한다.
- GitHub Actions 가 푸시마다 돈다. **푸시를 몰아서 한 번만 한다** — rate limit 이 있다.

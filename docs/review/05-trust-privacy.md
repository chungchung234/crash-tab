# 축 6 — 신뢰 (권한 · 프라이버시 · 스토어 심사)

## 요약 (3줄)
1. **출시 블로커 1건**: 개인정보 처리방침이 저장소 어디에도 없다. 스토어 FAQ는 "로컬에만 저장하거나 `storage.sync` 만 써도 처리방침을 게시해야 한다"고 적는다. 이 확장은 방문 출처 목록을 기본값 ON 으로 기기에 쌓는다.
2. 공개 문구가 코드와 어긋난다. `crsStats.perOrigin` 이 방문 사이트 출처·시각을 최대 200개 남기는데(기본 ON), README 권한 표는 이 키를 적지 않고 옵션 페이지는 "아무것도 수집하지 않는다"고 말한다. 스토어 데이터 사용 항목은 **웹 기록**과 **사용자 활동** 체크 쪽이 안전하다.
3. 권한 셋 주장은 코드와 일치한다(호출 전수 대조, 초과 없음). 외부 네트워크 호출도 없다. 다만 `crsShare` 화면 캡처가 세션 종료까지 지워지지 않는다.

## 저장 키 전수표
| 키 | 저장소 | 담는 것 | 기기를 떠나는가 | 공개 문서에 적혀 있는가 |
|---|---|---|---|---|
| crsWeapon, crsMuted, crsLoadout, crsLoadoutPreset, crsCombat | sync | 무기·음소거·로드아웃·전투 여부 | 예(구글 계정 동기화, 브라우저가 수행) | README 권한 표에 있음 |
| `crs.<설정키>` (schema 26개 설정), crs.migrated | sync | 설정값 | 예 | **없음** (README는 위 5개만 적음) |
| crsMode, crsPower(삭제됨), crsDebrisAnchor, crsDebrisLife, crsDebrisLifeMs, crsWeaponArt, crsViewmodel | sync | 모드·파편·무기 그림 옵션 | 예 | **없음** (crsMode 만 괄호 언급) |
| crsStats | local | 총계 + `perOrigin{origin: bestScore, broken, plays, lastPlayed}` ≤200, `days` 30개 | 아니오 | **없음**. spec/product.md §2 에만 있음 |
| crsReplays | local | 최대 10개, 각 `{t, op, args}` ≤2000 (좌표·무기 id·뷰포트 크기·시작 시각) | 아니오(내보내기는 사용자가 파일로) | 옵션 페이지에 언급, README 없음 |
| crsCustomWeapons, crsProgress, crsSeenCombatHelp | local | 사용자 무기 ≤10, 누적 피해·해금, 도움말 확인 플래그 | 아니오 | **없음** |
| crsShare | session | 화면 캡처 PNG(dataUrl) + 제목·host·점수 | 아니오 | **없음** |
| crsa | 저장 키 아님 | src/44-weapon-art.js:96 의 SVG id 접두사(`'crsa'+seq`)일 뿐 storage 호출 없음 | — | — |

## 출시 블로커
**B1. 개인정보 처리방침 URL 이 없다.** `PRIVACY*`·처리방침 문서·README 절 모두 없음(`grep -ri privacy|개인정보|처리방침 --include=*.md` 가 옵션 문구 외 0건). 스토어 대시보드 개인정보 탭은 처리방침 링크를 요구하고, 데이터 사용 공개는 그와 일치해야 한다.

## 발견 (심각도 순)

### 1. 개인정보 처리방침 부재 — 심각도 상 · 비용 소
**증거**: User Data FAQ(developer.chrome.com/docs/webstore/program-policies/user-data-faq) — "로컬에만 저장하거나 Chrome Storage Sync API 만 써도 처리방침 필요"(FAQ 14, WebFetch 로 확인). Program Policy: "handles any user data → accurate privacy policy". 저장소 grep 결과 없음. 대시보드 안내(cws-dashboard-privacy)도 처리방침 링크 추가를 단계로 둠.
**무엇이 문제인가**: 방문 출처 기록(crsStats)과 화면 캡처 처리가 있는데 정책 문서가 없다. 스토어 제출 단계에서 막히거나 심사에서 반려된다.
**재미 또는 출시 중 무엇을 해치는가**: 출시.
**제안**: 한 페이지짜리 처리방침(저장 키 전수표 기반)을 저장소에 두고 GitHub Pages/raw 로 공개 URL 을 만든다. 담을 것: 네트워크 전송 없음, local/sync/session 각각의 내용, 방문 출처 기록과 끄는 법·지우는 법, 캡처는 공유 버튼을 눌렀을 때만, 리플레이 내용.
**반대 심문**: 심사가 "수집 없음" 으로 보고 통과시킬 수도 있다. 그러나 FAQ 가 로컬 저장도 명시하므로 이 가능성에 기대면 안 된다.

### 2. 데이터 사용 공개 항목 판정: 웹 기록 + 사용자 활동 — 심각도 상 · 비용 소
**증거**: src/96.2-stats.js:49-51(`LIFE_ORIGIN_CAP=200`), `lifeOrigin()`=`location.origin`, settings-schema.json:28 `collectLocalStats` 기본 true, 옵션 UI `optStatTopOrigins` 로 출처 표 노출(options/options.js:687-710).
**무엇이 문제인가**: 사용자가 이 확장으로 부순 사이트의 origin(예: https://mail.example.com)과 마지막 시각이 기기에 남는다. 이건 "방문한 페이지 + 메타데이터" 에 해당한다고 보는 게 안전하다. 또한 `recordReplay` 기본 true 로 클릭·슬래시 좌표를 기록한다(메모리, `api.replay.save` 때만 local 저장). 항목 정의 원문은 이번에 공식 페이지에서 확인하지 못했다(**확인 필요**: 대시보드 개인정보 탭의 정의 문구). 기억상 "웹 기록 = 사용자가 방문한 페이지와 그 메타데이터(URL, 제목)", "사용자 활동 = 클릭·마우스 위치·스크롤".
**재미 또는 출시 중 무엇을 해치는가**: 출시(공개와 동작 불일치는 반려·삭제 사유).
**제안**: 두 가지 길 중 택일. (a) 웹 기록·사용자 활동 체크 + 처리방침에 "기기 안에만 저장, 전송·판매 없음" 명시. (b) perOrigin 을 아예 없애거나 기본 OFF(옵트인)로 바꾸고 "수집 안 함" 을 사실로 만든다. 재미 축에는 perOrigin 이 거의 기여하지 않으므로 (b)가 공개 부담이 작다.
**반대 심문**: "기기 밖으로 나가지 않으면 collect 가 아니다" 는 해석이 가능하다. 그러나 FAQ 3 은 기기 로컬 처리·저장도 공개 대상으로 읽히고, 체크를 과하게 하는 쪽이 반려 위험이 낮다. 해당 해석은 확인 필요.

### 3. "아무것도 수집하지 않는다 / 브라우저 안에만 있다" 문구와 동작 불일치 — 심각도 중 · 비용 소
**증거**: _locales/ko/messages.json:1163 `optAboutPrivacy`("아무것도 수집하지 않고 … 설정·통계·리플레이·사용자 정의 무기는 전부 이 브라우저 안에만 있습니다"), README.md:391-399, docs/specs/product.md:18.
**무엇이 문제인가**: (a) 통계는 실제로 쌓이므로 "수집하지 않는다" 는 부정확하다(기기 안이라도). (b) 설정·로드아웃·음소거 등 sync 키 21곳은 구글 계정으로 기기 간 동기화되므로 "이 브라우저 안에만" 은 설정에 대해 틀리다. 확장 자체는 네트워크 요청을 하지 않는다(`fetch|XMLHttpRequest|sendBeacon|WebSocket` 및 외부 URL grep: 코드에는 GitHub 저장소 링크 문자열뿐) — 이 부분의 "네트워크 통신 없음" 은 사실이다. 충돌은 "수집 없음"·"브라우저 안에만" 두 문장에 한정된다.
**재미 또는 출시 중 무엇을 해치는가**: 출시(신뢰, 심사 일관성).
**제안**: 문구를 "확장은 어떤 서버로도 데이터를 보내지 않는다. 설정은 크롬 동기화를 켜면 브라우저가 구글 계정으로 동기화하고, 통계·리플레이는 이 기기에만 있다"로 고친다. README 권한 표의 storage 행에 전수 키를 반영한다.
**반대 심문**: 크롬이 수행하는 동기화는 확장의 전송이 아니므로 기존 문구도 옳다는 반론이 가능. 그러나 사용자가 읽는 의미에서는 "브라우저 안에만"이 거짓이다.

### 4. 화면 캡처(crsShare)가 지워지지 않는다 — 심각도 중 · 비용 소
**증거**: background.js:111 `chrome.storage.session.set({crsShare:{dataUrl,…}})`; `session.remove|clear` 호출 전수 grep 0건. share/share.js:127 은 읽기만 한다. 공유 탭을 닫아도 남고, 같은 URL 을 다시 열면 이전 캡처가 다시 그려진다.
**무엇이 문제인가**: 남의 사이트(메일, 은행 화면 등)가 담긴 전체 PNG 가 브라우저 종료 전까지 메모리/세션에 상주한다. 기본 접근 레벨은 신뢰 컨텍스트 한정이라 웹페이지가 읽지는 못한다(background.js 주석). 캡처는 사용자가 공유 버튼을 눌러야 발생하고 외부 전송은 없으며, 저장·복사는 사용자 행동이다.
**재미 또는 출시 중 무엇을 해치는가**: 출시(처리방침 서술·심사 질문 방어), 소소하게 신뢰.
**제안**: share.js 가 렌더 후 `storage.session.remove('crsShare')` 하고, 처리방침에 "캡처는 공유 탭을 여는 동안만 메모리에 둔다"를 적는다. 캡션에 들어가는 제목·host 는 canvas `fillText` 로만 쓰여 주입 위험은 없다.
**반대 심문**: session 저장소는 브라우저 종료 시 사라지고 외부 접근도 막혀 있어 위험이 낮다. 맞다 — 그래서 중, 코드 두 줄 수준 개선이다. 새로고침 복원 동작을 유지하고 싶다면 제거 대신 시간 제한(`at` 기준)을 둔다.

### 5. README 권한 표가 저장 키의 절반만 적었다 — 심각도 중 · 비용 소
**증거**: README.md:391 은 crsWeapon·crsMuted·crsLoadout·crsLoadoutPreset·crsCombat 만. 실제로는 위 전수표의 19개 키 + `crs.<설정>` 26개. local 21곳·sync 21곳·session 2곳.
**무엇이 문제인가**: storage 권한 정당화(스토어 "권한 사유" 입력란)와 처리방침이 이 표에서 파생되므로 불일치가 그대로 전파된다.
**제안**: 키 전수표를 README 와 처리방침에 한 번 생성해 두고(tools/validate.js 에 `chrome.storage` 키 vs 문서 대조 규칙 추가 가능) 스토어 사유 문구에 활용.
**반대 심문**: 권한 설명은 "무엇을 위해" 가 요점이라 키 열거까지는 불필요. 그러나 perOrigin 만큼은 누락하면 안 된다.

### 6. 리플레이 내보내기는 좌표와 시각만 샌다 — 심각도 하 · 비용 소
**증거**: src/98-inspect.js:355-368(`replayRecord` 인자는 숫자/문자열만), `replayValidate`(op 화이트리스트 smash/slash/weapon/restore/reload, 문자열 40자, 무기 id 검증), 내보내기 `{v, startedAt, viewport, ops}`. 선택자·페이지 내용·URL 없음.
**무엇이 문제인가**: 파일을 남에게 주면 뷰포트 크기, 기록 시작 시각, 클릭 좌표가 간다. 사이트 정보는 가지 않는다. `crsReplays` 자체는 자동 저장되지 않고 `api.replay.save`(옵션 UI/콘솔)로만 쓰인다(자동 호출 grep 0건).
**제안**: 처리방침에 "좌표·무기·뷰포트·시각만, 사이트 정보 없음" 한 줄. 코드는 건드릴 필요 없음.
**반대 심문**: 반대로 내용이 위험하다는 증거는 못 찾았으므로 하 로 둔다. 시작 시각이 개인 활동 시각을 노출한다는 점만 유의.

### 7. 권한 주장은 사실이지만 1.19MB 주입과 스토어 입력란은 준비가 필요하다 — 심각도 하 · 비용 소
**증거**: manifest.json:22 `activeTab, scripting, storage`. chrome.* 전수 호출: tabs.captureVisibleTab(activeTab 으로 가능, 클릭한 탭의 사용자 제스처 후), tabs.create·sendMessage·onUpdated(url 필드 안 읽음, 권한 불필요), scripting.*, action.*, runtime.* — 초과 호출 없음. `host_permissions` 없음. content.js 는 1,222,297바이트, `executeScript` 로 클릭한 탭에만 주입(background.js:63-66).
**무엇이 문제인가**: 상시 content_scripts 가 아니라 사용자 클릭 주입이라 성능·심사 위험은 낮다. 우려점은 (a) 비난독화 단일 연결 파일이라 읽기는 쉬우나 리뷰어가 크기에 놀랄 수 있음, (b) 클릭 때마다 1.2MB 파싱 시간(성능 수치는 확인 필요). `captureVisibleTab` 은 클릭 후 탭이 같을 때 동작; 내비게이션 뒤 activeTab 이 만료되면 실패해 토스트로 안내(background.js 129-). 
**제안**: 스토어 "권한 사유"에 주입이 클릭 시점뿐이고 상시 접근 없음을 서술. 심사 메모에 content.js 가 src/ 의 연결 생성물이며 `tools/build.js --check` 로 검증됨을 적는다.
**반대 심문**: 심사 지적 사례는 이 확장에 해당하는 것을 찾지 못했다(`<all_urls>` 상시 주입이 아님). 확인 필요 항목으로만 둔다.

## 확인 못 한 것
- 대시보드 "개인정보 사용" 체크 항목의 정의 원문(공식 페이지 두 곳에 정의 없음, 대시보드에서만 확인 가능). 웹 기록/사용자 활동 판정은 기억 기반이므로 제출 전 화면에서 재확인.
- local 만 저장하는 데이터가 "수집" 인지에 대한 공식 해석(FAQ 3 은 로컬 저장도 공개 대상으로 읽힘, 명시 문구는 못 봄).
- `crsa` 는 저장 키가 아니라 SVG id 접두사로 판명(확인 완료).
- 1.2MB 주입의 실측 지연, 스토어 심사에서 실제 지적되는지.
- `storage.session` 쿼터(약 10MB)를 큰 화면 PNG 가 넘기면 캡처가 `storage` 사유로 실패할 수 있으나 재현은 하지 않음.

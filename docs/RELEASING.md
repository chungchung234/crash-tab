# 릴리스 가이드

화면부수기(crash-tab)를 배포하는 전 과정입니다. 모든 단계는 **직접 제어할 수 있도록** 설계되어 있습니다.
자동으로 푸시되거나 자동으로 스토어에 올라가는 일은 없습니다. 태그를 밀기 전까지는 아무 일도 일어나지 않고,
스토어 배포는 수동 실행(`workflow_dispatch`) 전용입니다.

- 저장소: <https://github.com/chungchung234/crash-tab> (기본 브랜치 `main`)
- 산출물: `dist/crash-tab-<version>.zip` — GitHub 릴리스에 첨부됩니다.

---

## 0. 한눈에 보기

```
버전 올리기 → CHANGELOG 정리 → 커밋 → 태그 → 푸시
      ↓                                        ↓
  로컬 검증                             ci.yml (검증 + e2e)
                                               ↓
                                     release.yml (zip 빌드 + 릴리스 생성)
                                               ↓
                              (선택) publish-store.yml — 수동 실행만
```

| 단계 | 누가 실행 | 되돌릴 수 있나 |
| --- | --- | --- |
| 1~4 버전·커밋·태그 | 사람 (로컬) | 예 — 푸시 전이면 자유롭게 |
| 5 푸시 | 사람 | 태그는 삭제 가능, `main` 커밋은 되돌리는 커밋으로 |
| 6 CI | 자동 (`push` / `pull_request`) | 해당 없음 (읽기 전용) |
| 7 릴리스 | 자동 (`v*` 태그 푸시) | 예 — 릴리스·태그 삭제 |
| 8 스토어 배포 | 사람 (수동 실행) | 아니요 — 공개된 버전은 내릴 수만 있고 덮어쓸 수 없습니다 |

---

## 1. 버전 올리기

버전은 **세 곳**에 같은 값으로 적혀 있어야 합니다.

| 위치 | 필드 |
| --- | --- |
| `manifest.json` | `"version"` |
| `package.json` | `"version"` |
| `content.js` (또는 분리 후 `src/00-prelude.js`) | `const VERSION = '…'` |

`tools/version.js`가 세 곳을 한 번에 바꾸고, `src/`가 생긴 뒤에는 `content.js`도 다시 생성합니다.

```bash
node tools/version.js patch     # 1.2.0 → 1.2.1
node tools/version.js minor     # 1.2.0 → 1.3.0
node tools/version.js major     # 1.2.0 → 2.0.0
node tools/version.js 2.0.0     # 정확한 값 지정
```

이 도구는 `CHANGELOG.md` 맨 위에 새 섹션도 끼워 넣습니다. **git 명령은 실행하지 않고**,
다음에 입력할 명령을 출력만 합니다.

> **지금 트리의 주의사항**
> 현재 `manifest.json`은 `1.0.0`, `content.js`의 `VERSION`은 `1.2.0`, `package.json`은 `1.2.0`입니다.
> 첫 릴리스 전에 `manifest.json`을 `1.2.0`으로 맞춰야 합니다. 맞추지 않으면
> `node tools/validate.js`의 버전 삼중 검사가 `manifest.json`을 지목하며 실패하고, CI도 빨간불이 됩니다.

### 어떤 자리를 올릴지

- **patch** — 버그 수정, 문구 수정, 내부 정리. 사용자가 보는 기능 변화 없음.
- **minor** — 기능 추가, 밸런스 조정, 새 무기·새 모드.
- **major** — 호환되지 않는 변화. 저장된 설정 키의 의미가 바뀌거나, 권한이 늘어나거나, 조작법이 깨질 때.

---

## 2. CHANGELOG 정리

`CHANGELOG.md`의 새 섹션을 사람이 읽을 수 있게 다듬습니다. 이 섹션이 **그대로 GitHub 릴리스 노트가 되고**,
패키징할 때 아카이브 타임스탬프의 근거가 됩니다.

- 제목 형식은 `## [1.2.1] - 2026-10-05`입니다. 날짜는 `YYYY-MM-DD`.
- `[Unreleased]`에 쌓아 둔 항목을 새 섹션으로 옮기고, `[Unreleased]`는 빈 상태로 남깁니다.
- 맨 아래 비교 링크(`[Unreleased]`, `[1.2.1]`)는 `tools/version.js`가 자동으로 갱신합니다. 값만 확인하세요.

`node tools/validate.js`(규칙 R14)는 현재 `manifest.json` 버전에 해당하는 섹션이 없으면 실패합니다.
버전 삼중 검사(R3)가 `manifest.json` / `package.json` / `VERSION` 상수를 이미 맞춰 두므로 결과는 같습니다.

---

## 3. 로컬 검증

푸시하기 전에 여기서 걸러야 CI를 기다리는 시간이 줄어듭니다.

```bash
npm run check     # tools/build.js --check (src/가 있을 때) + tools/validate.js
npm test          # node test/e2e.js
npm run package   # dist/crash-tab-<version>.zip
```

`npm run package`는 다음을 출력합니다.

- 아카이브에 들어간 파일 목록과 각 파일의 원본/저장 크기, 압축 방식
- 전체 크기와 아카이브의 SHA-256
- 10 MB를 넘거나 `tools/validate.js`가 실패하면 **중단**

같은 입력이면 **바이트 단위로 같은 zip**이 나옵니다(재현 가능한 빌드).
타임스탬프는 `SOURCE_DATE_EPOCH`가 있으면 그 값을, 없으면 CHANGELOG의 해당 버전 날짜를 씁니다.

아이콘이 결정적인지도 확인할 수 있습니다.

```bash
python3 tools/make-icons.py
git diff --exit-code -- icons/      # 변화가 없어야 정상
git checkout -- icons               # 혹시 바뀌었다면 되돌리기
```

---

## 4. 커밋과 태그

```bash
git add -A
git commit -m "chore: release v1.2.1"
git tag v1.2.1
```

- 태그 이름은 **반드시** `v` + 버전입니다 (`v1.2.1`). 릴리스 워크플로가 `v`를 떼어 버전으로 씁니다.
- 태그와 세 곳의 버전이 어긋나면 릴리스 워크플로가 첫 단계에서 막습니다
  (`node tools/validate.js --expect-version 1.2.1`).

---

## 5. 푸시

```bash
git push origin main        # ci.yml 이 돕니다
git push origin v1.2.1      # release.yml 이 돕니다
```

커밋만 먼저 밀고 CI가 초록불인 것을 확인한 뒤 태그를 미는 쪽을 권합니다. 그러면 릴리스를 만들기 전에
멈출 기회가 한 번 더 생깁니다.

> `main`에 **force-push 하지 마세요.** 기존 이력을 다시 쓰지 않습니다.

---

## 6. CI 게이트 — `.github/workflows/ci.yml`

`main` 푸시, 모든 PR, 그리고 수동 실행에서 돕니다. `ubuntu-latest` / Node 22, 제한 시간 20분.

1. 체크아웃
2. Node 22 설치
3. `~/.npm`과 `~/.cache/puppeteer` 캐시 복원
4. 의존성 설치
5. `node tools/build.js --check` (`tools/build.js`가 생긴 뒤부터)
6. `node tools/validate.js`
7. 아이콘 결정성 검사 — `python3 tools/make-icons.py` 후 `icons/`에 변화가 없어야 합니다.
   바이트가 달라졌을 때는 `node tools/validate.js --compare-icons`로 **픽셀**을 비교해서,
   픽셀이 같으면 경고만 내고 통과시킵니다(zlib 빌드 차이로 인한 오탐 방지). 픽셀이 다르면 실패합니다.
8. `node test/e2e.js`
9. 실패 시 `test/out/`을 아티팩트로 업로드 (7일 보관)

### 의존성 설치 — `npm ci`를 쓰지 않는 이유

이 저장소에는 `package-lock.json`이 **없습니다.** 락파일이 없으면 `npm ci`는 네트워크에 닿기도 전에
`EUSAGE`로 종료하고, `actions/setup-node`의 `cache: npm`도 "Dependencies lock file is not found"로
스텝을 실패시킵니다. 그래서 CI는 다음을 씁니다.

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.npm
      ~/.cache/puppeteer
    key: ${{ runner.os }}-npm-${{ hashFiles('package.json') }}
    restore-keys: ${{ runner.os }}-npm-
- run: npm install --no-audit --no-fund --prefer-offline
```

`~/.cache/puppeteer` 캐시가 핵심입니다. 여기에 150 MB쯤 되는 Chrome for Testing이 들어 있고,
이 캐시가 더운 상태면 설치가 1분 30초에서 10초로 줄어듭니다.

**앞으로 할 일:** 네트워크가 되는 환경에서 한 번
`npm install --package-lock-only`를 돌려 `package-lock.json`을 커밋하면,
두 워크플로의 설치 한 줄씩을 `npm ci`로 바꿀 수 있습니다.

---

## 7. 릴리스 워크플로 — `.github/workflows/release.yml`

`v*` 태그 푸시, 또는 `tag`를 입력받는 수동 실행으로 돕니다. 권한은 `contents: write`.

1. 태그를 체크아웃하고 `VERSION=${TAG#v}`를 뽑습니다.
2. `node tools/validate.js --expect-version "$VERSION"` — 태그와 세 곳의 버전이 모두 같아야 통과합니다.
3. 의존성 설치 → `npm run check` → `npm test` → `npm run package`
4. `node tools/version.js --changelog-section "$VERSION"`으로 릴리스 본문을 뽑습니다.
5. `gh release create "$TAG" dist/crash-tab-$VERSION.zip --title "$TAG" --notes-file …`

끝나면 <https://github.com/chungchung234/crash-tab/releases> 에 zip이 붙은 릴리스가 생깁니다.

---

## 8. zip 받아서 설치해 보기

릴리스가 만들어졌으면 **실제로 설치되는지 직접 확인하세요.**

```bash
gh release download v1.2.1 --pattern 'crash-tab-*.zip'
unzip crash-tab-1.2.1.zip -d crash-tab-1.2.1
```

1. 크롬에서 `chrome://extensions`를 엽니다.
2. **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누르고 방금 **압축을 푼 폴더**를 고릅니다.
   (크롬은 zip 파일을 그대로 받지 않습니다. 반드시 풀어서 넣으세요.)
4. 아무 페이지를 열고 툴바 아이콘을 눌러 켜지는지, `Esc`로 종료했을 때 페이지가 깨끗한지 확인합니다.
5. `chrome://extensions`의 **오류** 버튼에 아무것도 없어야 합니다.

확인이 끝나면 `chrome://extensions`에서 이 임시 확장 프로그램을 제거하세요.

---

## 9. (선택) Chrome 웹 스토어 배포 — `.github/workflows/publish-store.yml`

**수동 실행 전용**입니다. 태그를 밀었다고 저절로 스토어에 올라가지 않습니다.

입력값:

| 입력 | 기본값 | 뜻 |
| --- | --- | --- |
| `tag` | (필수) | 배포할 태그 (`v1.2.1`) |
| `dry_run` | `true` | `true`면 업로드만 하고 **배포하지 않습니다**(스토어의 초안 상태로 남습니다) |

> **중요**: 시크릿이 하나라도 없으면 이 잡은 설정 안내를 출력하고 **성공(exit 0)으로 끝납니다.**
> 즉 **초록불이 배포 성공을 뜻하지 않습니다.** 반드시 로그를 열어 실제로 업로드/배포가 일어났는지 확인하세요.
> 이렇게 만든 이유는, 시크릿이 없는 포크에서 워크플로가 빨간불로 남지 않게 하기 위해서입니다.

### 필요한 저장소 시크릿 (4개)

| 이름 | 내용 |
| --- | --- |
| `CWS_EXTENSION_ID` | 스토어 개발자 대시보드의 항목 ID (32자 소문자) |
| `CWS_CLIENT_ID` | Google OAuth 클라이언트 ID |
| `CWS_CLIENT_SECRET` | Google OAuth 클라이언트 보안 비밀 |
| `CWS_REFRESH_TOKEN` | `chromewebstore` 범위의 리프레시 토큰 |

`Settings → Secrets and variables → Actions → New repository secret`에서 넣습니다.
**어떤 값도 저장소에 커밋하지 마세요.** 워크플로는 `::add-mask::`로 네 값을 모두 가리고,
토큰이 섞일 수 있는 응답 본문은 출력하지 않습니다.

### 토큰 받는 법

처음 한 번만 하면 됩니다. 전부 Google 쪽 작업이라 화면 문구는 바뀔 수 있습니다.

1. **스토어에 항목을 먼저 만듭니다.**
   [Chrome 웹 스토어 개발자 대시보드](https://chrome.google.com/webstore/devconsole)에서
   `dist/crash-tab-<version>.zip`을 **수동으로 한 번** 업로드해 초안을 만듭니다.
   (API는 기존 항목을 갱신할 수만 있고, 새 항목을 만들지는 못합니다.)
   개발자 등록비 5 USD가 한 번 듭니다. 주소창의 ID가 `CWS_EXTENSION_ID`입니다.
2. **Google Cloud 프로젝트를 만들고 API를 켭니다.**
   [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 만들고,
   `API 및 서비스 → 라이브러리`에서 **Chrome Web Store API**를 사용 설정합니다.
3. **OAuth 동의 화면**을 설정합니다. 사용자 유형은 **외부**, 게시 상태는 **테스트** 그대로 두고,
   테스트 사용자에 **스토어 항목을 소유한 구글 계정**을 추가합니다.
4. **OAuth 클라이언트 ID**를 만듭니다. `API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 →
   OAuth 클라이언트 ID`, 애플리케이션 유형 **데스크톱 앱**.
   여기서 나오는 값이 `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`입니다.
5. **인증 코드**를 받습니다. 아래 주소를 브라우저에 넣고(위 3단계의 계정으로 로그인),
   동의한 뒤 돌아온 주소의 `code=` 값을 복사합니다.

   ```
   https://accounts.google.com/o/oauth2/auth
     ?response_type=code
     &access_type=offline
     &prompt=consent
     &scope=https://www.googleapis.com/auth/chromewebstore
     &client_id=<CWS_CLIENT_ID>
     &redirect_uri=http://localhost:8818
   ```

   `localhost:8818`에는 아무것도 떠 있지 않아도 됩니다. 브라우저가 연결에 실패해도
   주소창에는 `code=`가 들어 있습니다.
6. **리프레시 토큰으로 바꿉니다.**

   ```bash
   curl -s https://oauth2.googleapis.com/token \
     -d client_id=<CWS_CLIENT_ID> \
     -d client_secret=<CWS_CLIENT_SECRET> \
     -d code=<5단계의 code> \
     -d grant_type=authorization_code \
     -d redirect_uri=http://localhost:8818
   ```

   응답의 `refresh_token`이 `CWS_REFRESH_TOKEN`입니다. `access_token`은 한 시간짜리라 저장할 필요 없습니다.
   `refresh_token`이 응답에 없으면 `prompt=consent`와 `access_type=offline`을 빠뜨린 것입니다.

리프레시 토큰은 동의 화면이 **테스트** 상태일 때 7일 뒤 만료될 수 있습니다.
배포가 `invalid_grant`로 실패하면 5~6단계를 다시 하거나, 동의 화면을 **프로덕션**으로 게시하세요.

### 워크플로가 하는 일

1. 시크릿 네 개 확인 — 하나라도 비면 안내 출력 후 종료(성공)
2. `::add-mask::`로 값 가리기
3. `POST https://oauth2.googleapis.com/token` (`grant_type=refresh_token`) → 액세스 토큰
4. `PUT https://www.googleapis.com/upload/chromewebstore/v1.1/items/<ID>?uploadType=media` ← zip 업로드
5. `dry_run: false`일 때만 `POST https://www.googleapis.com/chromewebstore/v1.1/items/<ID>/publish`

업로드까지만 해도 스토어 대시보드에서 초안을 눈으로 확인하고 수동으로 **검토 제출**을 누를 수 있습니다.
심사는 보통 며칠 걸리고, 그동안은 이전 버전이 계속 서비스됩니다.

### 권장 순서

1. `dry_run: true`로 한 번 돌립니다.
2. 스토어 대시보드에서 초안의 버전·설명·스크린샷을 확인합니다.
3. 문제없으면 `dry_run: false`로 다시 돌리거나, 대시보드에서 직접 제출합니다.

---

## 10. 잘못된 릴리스 되돌리기

### 아직 스토어에 올리지 않았다면 (쉬움)

```bash
gh release delete v1.2.1 --yes        # 릴리스와 첨부 zip 삭제
git push --delete origin v1.2.1       # 원격 태그 삭제
git tag -d v1.2.1                     # 로컬 태그 삭제
```

그다음 코드를 고칩니다.

- **아직 아무도 받지 않았다면** 고친 뒤 같은 버전으로 다시 태그해도 됩니다.
  단, 삭제했던 것과 같은 이름의 태그를 다시 미는 것이므로 받아 간 사람이 있는지 확인하세요.
- **안전한 쪽은 롤포워드입니다.** 되돌리는 커밋을 올리고 `1.2.2`로 새로 릴리스하세요.

직전 버전을 다시 쓰고 싶으면 이전 릴리스의 zip을 그대로 내려받아 쓰면 됩니다
(아카이브는 재현 가능하므로 다시 빌드해도 같은 바이트가 나옵니다).

```bash
gh release download v1.2.0 --pattern 'crash-tab-*.zip'
```

### `main`에 잘못 들어간 커밋

```bash
git revert <커밋 해시>
git push origin main
```

**`main`을 force-push 하거나 이력을 다시 쓰지 마세요.**

### 이미 스토어에 배포했다면

Chrome 웹 스토어는 **이전 버전으로 되돌릴 수 없습니다.** 선택지는 두 가지입니다.

1. **롤포워드** — 수정한 패치 버전(`1.2.2`)을 만들어 업로드·배포합니다. 일반적인 해결책입니다.
2. **게시 중단** — 심각한 문제라면 개발자 대시보드에서 항목을 **게시 중단(unpublish)** 합니다.
   새 설치는 막히지만 이미 설치한 사용자에게서 자동으로 지워지지는 않습니다.

어느 쪽이든 `CHANGELOG.md`에 무슨 일이 있었는지 적어 두세요.

---

## 11. 릴리스 체크리스트

```
[ ] main이 최신이고 CI가 초록불
[ ] node tools/version.js <단계>  로 세 곳의 버전을 올림
[ ] manifest / package.json / VERSION 세 값이 모두 같음
[ ] CHANGELOG.md 의 새 섹션을 사람이 읽을 수 있게 정리하고 날짜 확인
[ ] npm run check   통과
[ ] npm test        통과
[ ] npm run package 성공, 크기와 파일 목록 확인
[ ] python3 tools/make-icons.py 후 icons/ 에 변화 없음
[ ] git commit / git tag v<버전>
[ ] git push origin main  → CI 초록불 확인
[ ] git push origin v<버전>
[ ] release.yml 성공, 릴리스에 zip 첨부 확인
[ ] zip 을 받아 압축 해제 후 unpacked 로 로드, 켜고/끄고 흔적 0 확인
[ ] (선택) publish-store.yml 을 dry_run: true 로 실행, 로그에서 실제 업로드 여부 확인
[ ] (선택) 스토어 대시보드에서 초안 확인 후 dry_run: false 또는 수동 제출
```

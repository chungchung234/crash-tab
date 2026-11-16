# 스토어 제출 — 순서대로

처음 한 번, 사람이 대시보드 앞에 앉아서 하는 일이다. 화면에 뜨는 순서대로 적었다.

문서 셋의 역할이 다르다. 헷갈리면 여기로 돌아온다.

| 문서 | 담당 |
| --- | --- |
| **이 문서** | 순서. 무엇을 먼저 하고 어디서 막히는지 |
| `docs/store-listing.md` | 칸에 **넣을 글자**. 복사해서 붙인다 |
| `docs/RELEASING.md` §9 | 두 번째 버전부터의 **자동 배포**(API·시크릿) |

> 구글 화면 문구는 자주 바뀐다. 아래 인용은 2026-11-16 기준 공식 문서의 표현이고,
> 화면과 다르면 **화면을 믿고** 이 문서를 고친다.

---

## 0. 올릴 것은 이미 준비돼 있다

`node tools/validate.js` 의 **R26** 이 매번 검사한다. 지금 상태:

| 자산 | 상태 |
| --- | --- |
| 패키지 | `dist/crash-tab-2.1.1.zip` · 477 KB (상한 2 GB) |
| ↳ sha256 | `92306bf2da321fe29cb6e99d52d169b72788ee86cb04f3ccdf2ff5f69c647ece` |
| 스크린샷 | 1280×800 **5장** (최소 1, 최대 5) |
| 작은 타일 | 440×280 |
| 마키 타일 | 1400×560 |
| 아이콘 | 16·32·48·128 (패키지 안) |
| 처리방침 URL | ko·en 둘 다 200 |

zip 은 `.gitignore` 에 있으므로 **지금 만든다.** 재현 가능해서 몇 번을 돌려도 같은 파일이 나온다.

```bash
npm run package && shasum -a 256 dist/crash-tab-2.1.1.zip
```

sha 가 위 표와 다르면 멈춘다. 같으면 그 zip 이 GitHub 릴리스 v2.1.1 자산과 **바이트 단위로 같은 것**이다.

---

## 1. 개발자 계정 — 한 번만

<https://chrome.google.com/webstore/devconsole>

- **등록비.** 공식 문서는 금액을 안 적고 "a one-time registration fee" 라고만 한다. 실제로는 미화 5달러다.
  순서가 정해져 있다 — "First agree to the developer agreement and policies then pay the registration fee."
- **개발자 이메일.** "You must provide a developer email when you create your developer account."
  인증까지 요구한다는 말은 문서에 없다.
- **국가.** 등록을 받는 국가 목록이 있다. 목록에 없으면 "the Chrome Web Store can't accept
  registrations or submissions from your location."
  등록 페이지의 알파벳 목록에 **South Korea** 가 있다 (South Africa 와 South Sudan 사이).

> **2단계 인증은 여기서 필요 없다.** 게시 문서 어디에도 안 나온다.
> 7단계(API 자동 배포)의 전제일 뿐이다. 헷갈려서 먼저 켤 필요는 없지만, 어차피 7단계에서 켠다.

> 새 게시자는 **게시 가능한 확장이 최대 2개**다 — "you will be limited to a maximum of two
> published extensions." 우리는 하나라 걸리지 않는다.

---

## 2. 항목 만들기 — 여기서 ID 가 나온다

`새 항목` → zip 업로드. 이름과 짧은 설명은 `manifest.json` 과 `_locales/` 에서 자동으로 올라온다.

업로드가 끝나면 주소창이 이렇게 된다:

```
https://chrome.google.com/webstore/devconsole/.../<32자 소문자>/edit
```

그 **32자가 `CWS_EXTENSION_ID`** 다. 7단계에서 쓴다. 지금 적어 둔다.

---

## 3. 스토어 등록정보 탭

`docs/store-listing.md` 를 열어 놓고 복사해 붙인다.

| 칸 | 어디서 |
| --- | --- |
| 카테고리 | §1 — **Games** |
| 언어 | §1 — 한국어(기본) · English |
| 상세 설명 (ko) | §2 코드 블록 **통째로** |
| 상세 설명 (en) | §3 코드 블록 통째로 |
| 스크린샷 | `store/screenshots/` 5장 |
| 작은 프로모 타일 | `store/promo/small-440x280.png` |
| 마키 프로모 타일 | `store/promo/marquee-1400x560.png` |

> 상세 설명 칸은 **일반 텍스트**다. 마크다운이 안 먹는다. §2·§3 은 그걸 전제로 썼으니
> 손대지 말고 그대로 붙인다.

타일 둘은 **선택**이다 — "Only the store icon and at least one screenshot are required."
그래도 넣는다. 작은 타일이 없으면 검색 결과에서 있는 확장 **뒤로 밀리고**, 마키가 없으면
"can't be featured in marquee" 라 피처링 후보에서 빠진다.

---

## 4. 개인정보 보호 관행 탭

여기가 가장 많이 막히는 곳이다.

| 칸 | 넣을 것 |
| --- | --- |
| 단일 목적 | `store-listing.md` §4 |
| 권한 사유 × 3 | §5 — `activeTab` · `scripting` · `storage` 각각 |
| 원격 코드 | **"아니요, 원격 코드를 사용하지 않습니다"** |
| 데이터 사용 공개 | §6 표 — 체크 3개 |
| 인증 체크박스 | §6 — 3개 모두 |
| 처리방침 URL | `https://raw.githubusercontent.com/chungchung234/crash-tab/main/PRIVACY.md` |

권한 사유는 매니페스트에 선언한 권한마다 칸이 하나씩 뜬다 — "a field for you to state the
justification for each permission." 우리는 셋이다.

> **원격 코드는 거절 사유로 명시돼 있다.** "Extensions that call remote code and do not declare
> and justify it using the field shown above will be rejected."
> 우리는 MV3 이고 원격 파일을 불러오지 않으므로 **아니요**가 맞다.
> 코드에 `fetch` 가 한 군데 있지만(`options/options.js:1111`) `chrome.runtime.getURL()` 로 만든
> 패키지 **안**의 주소를 읽는 것이다. 심사가 물으면 `store-listing.md` §8 에 답이 적혀 있다.

> 구글 문서는 이 탭의 칸들을 "필수"라고 **적지 않는다.** 그래도 전부 채운다 —
> 심사자가 읽는 칸이고, 비워 두면 질문이 돌아온다.

---

## 5. 배포 탭

무료 항목, 공개 범위, 배포 국가를 정한다. 공식 문서는 이 탭을 "lets declare if your extension
is a paid item, which countries will list your item and the set of users that will see it" 라고만
설명하고 선택지 이름은 적지 않았다. **화면을 보고 고른다.**

---

## 6. 제출

`검토를 위해 제출`.

- **"검토 후 바로 게시" 체크를 풀 수 있다.** 풀면 "your item will not be published immediately
  after its review is complete. Instead, you'll be able to manually publish it at a time of your
  choosing." 첫 출시라면 풀어 두는 쪽이 낫다 — 통과한 걸 보고 직접 누른다.
- **미뤘다면 30일 안에 눌러야 한다.** "you will have up to 30 days to publish. After that period
  expires, the staged submission will revert to a draft which will have to be submitted again."
- **심사 기간은 문서에 없다.** "The time for this review depends on the nature of your item."
- 제출 뒤 버그를 찾으면 `검토 취소`(cancel review)로 내리고 새 패키지를 올리는 길이 있다.

여기까지가 **한 번만** 하는 일이다. 아래는 다음 버전부터를 편하게 만드는 작업이다.

---

## 7. 다음 버전부터 자동으로 — API 경로

`.github/workflows/publish-store.yml` 이 zip 을 올려 준다. 시크릿 4개가 필요하다.

절차 전체는 `docs/RELEASING.md` §9 에 있다. 요약하면:

1. 구글 계정에 **2단계 인증**을 켠다 ← 여기서 필요하다
2. Google Cloud 프로젝트 → **Chrome Web Store API** 사용 설정
3. **대상**(Audience): 외부 · 테스트 · 테스트 사용자에 본인 계정 추가
4. **클라이언트**(Clients): OAuth 클라이언트 ID, 유형 **데스크톱 앱**
5. 토큰 발급 — 이 한 줄이 나머지를 다 한다:

   ```bash
   node tools/cws-token.js --gh
   ```

   클라이언트 ID·보안 비밀을 묻고, 브라우저에서 동의받고, 리프레시 토큰으로 바꿔
   `gh secret set` 으로 셋을 **화면에 찍지 않고** 넣는다. 보안 비밀은 입력 중에도 안 보인다.

6. 남은 하나는 2단계에서 적어 둔 ID:

   ```bash
   gh secret set CWS_EXTENSION_ID
   ```

7. 시험 삼아 한 번:

   ```bash
   gh workflow run publish-store.yml -f tag=v2.1.1 -f dry_run=true
   ```

> **초록불이 배포 성공을 뜻하지 않는다.** 시크릿이 하나라도 없으면 이 워크플로는 안내를 찍고
> **성공으로 끝난다.** 반드시 로그를 열어 업로드가 실제로 일어났는지 본다.

> **테스트 상태의 리프레시 토큰은 7일 만에 죽는다.** 배포가 `invalid_grant` 로 실패하면
> `node tools/cws-token.js --gh` 를 다시 돌리거나, 대상을 프로덕션으로 게시한다.
> 자세한 건 `RELEASING.md` §9 의 "리프레시 토큰이 7일 뒤 죽는 문제".

---

## 8. 나눠 가진 일

| 일 | 누가 |
| --- | --- |
| 패키지 만들기 · 해시 확인 | **나** — `npm run package` |
| 등록정보 문안 (ko·en) | **나** — `store-listing.md` 에 다 있다 |
| 스크린샷 · 프로모 타일 | **나** — `tools/promo.js`, R26 이 크기를 지킨다 |
| 자산 규격 검사 | **나** — `node tools/validate.js` |
| 토큰 발급 도구 | **나** — `tools/cws-token.js` |
| 등록비 결제 | 당신 |
| 2단계 인증 | 당신 |
| 대시보드에 붙여넣기 | 당신 |
| 구글 동의 화면 클릭 | 당신 |
| 제출 버튼 | 당신 |

구글 계정 안에서 일어나는 일만 당신 몫이다. 나머지는 명령 한 줄로 다시 만들 수 있다.

**심사가 무언가를 지적하면 그 문장을 그대로 가져온다.** 문안을 고치는 것도, 코드가 문제면
고치는 것도 이쪽에서 한다.

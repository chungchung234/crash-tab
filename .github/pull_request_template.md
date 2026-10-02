<!--
한국어 또는 영어 어느 쪽이든 괜찮습니다. / Korean or English is fine.
제목은 Conventional Commits 형식으로 적어주세요: feat: / fix: / chore: / docs: / refactor: / test: / ci:
Title the PR using Conventional Commits: feat: / fix: / chore: / docs: / refactor: / test: / ci:
-->

## 무엇을 바꿨나요 / What changed

<!-- 한두 문단. 관련 이슈가 있으면 `Closes #123` 으로 연결해 주세요. -->
<!-- A paragraph or two. Link the issue with `Closes #123` if there is one. -->

## 왜 / Why

<!-- 동작이 바뀐다면 바뀌기 전과 후를 적어주세요. -->
<!-- If behaviour changes, describe it before and after. -->

## 확인한 것 / How it was verified

<!-- 수동으로 테스트한 페이지, 무기, 단축키. 화면이 바뀌었다면 스크린샷이나 녹화. -->
<!-- Pages, weapons and hotkeys tested by hand. Screenshots or a recording for visual changes. -->

## 체크리스트 / Checklist

- [ ] `src/` 를 수정했고 `content.js` 를 직접 손대지 않았습니다 (생성 파일입니다). / I edited `src/` and did not hand-edit the generated `content.js`.
- [ ] `npm run check` 통과 (`tools/build.js --check` + `tools/validate.js`). / `npm run check` passes.
- [ ] `npm test` 통과 (`node test/e2e.js`). / `npm test` passes.
- [ ] 주입되는 코드에 `innerHTML` / `outerHTML` / `insertAdjacentHTML` / `document.write` / `eval` / `new Function` / `setAttribute('style')` / `setInterval` 을 쓰지 않았습니다. / No forbidden APIs in injected code.
- [ ] 주입한 모든 노드에 `data-crs` 와 `crs-` 클래스를 붙였고, 비활성화 후 `[data-crs]` 노드·타이머·RAF 가 남지 않습니다. / Every injected node carries `data-crs` and a `crs-` class, and deactivate leaves nothing behind.
- [ ] 새 문자열을 `_locales/ko` 와 `_locales/en` 양쪽에 추가했습니다. / New strings were added to both `_locales/ko` and `_locales/en`.
- [ ] 새 권한이나 `host_permissions` 를 추가하지 않았습니다. / No new permissions and no `host_permissions`.
- [ ] 사용자에게 보이는 변경이라면 `CHANGELOG.md` 의 Unreleased 섹션에 적었습니다. / User-visible changes are noted under Unreleased in `CHANGELOG.md`.

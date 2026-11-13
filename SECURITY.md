# 보안 정책 / Security policy

화면부수기는 사용자가 켠 임의의 웹페이지에 주입된다. 그래서 페이지가 확장을 속이거나,
확장이 페이지·사용자 데이터를 건드리는 경로는 보안 문제로 다룬다.

## 신고

**공개 이슈로 올리지 마라.** GitHub 의 비공개 보안 권고로 신고한다:
<https://github.com/chungchung234/crash-tab/security/advisories/new>

적어 줄 것: 영향받는 버전, 재현 절차(어느 페이지에서 무엇을 했는지), 무엇이 새거나 깨지는지.
한국어·영어 모두 괜찮다.

## 범위

- 페이지가 확장의 메시지·저장소·캡처에 접근하거나 확장을 조종하는 경우
- 확장이 `innerHTML`·`eval` 같은 금지 API 로 페이지 내용을 주입하는 경우
- 사용자 데이터가 기기 밖으로 나가는 경우(이 확장은 네트워크를 쓰지 않는다 — 나간다면 결함이다)
- 토글을 꺼도 `[data-crs]` 노드나 인라인 스타일이 남아 페이지를 바꾸는 경우는 보안이 아니라 일반 버그다

## 지원 버전

최신 릴리스만 고친다. 확인하면 가능한 한 빨리 답하고, 고친 릴리스를 낼 때 신고자를 밝히거나(원하면 익명으로) 감사를 적는다.

---

Do not file public issues for vulnerabilities. Use GitHub private security advisories at the link above.
Include the affected version, steps to reproduce (which page, what you did) and what leaks or breaks.
Only the latest release is supported. Reporters are credited in the fix release unless they prefer to stay anonymous.

'use strict';
/*
 * tools/cws-token.js — get a Chrome Web Store refresh token, with zero dependencies.
 *
 * Usage:
 *   node tools/cws-token.js                       # 묻고, 토큰을 화면에 찍는다
 *   node tools/cws-token.js --gh                  # 묻고, gh secret set 으로 바로 넣는다 (화면에 안 찍힌다)
 *   node tools/cws-token.js --port 8899           # 8818 이 이미 쓰이고 있을 때
 *   CWS_CLIENT_ID=... CWS_CLIENT_SECRET=... node tools/cws-token.js   # 묻지 않는다
 *
 * docs/RELEASING.md §9 의 5~6단계를 대신한다. 손으로 하면 네 군데서 틀린다:
 *
 *   1. 인증 URL 을 여러 줄로 적어 두면 붙여넣을 때 줄바꿈이 섞여 깨진다. 여기선 한 줄로 찍는다.
 *   2. 리다이렉트 주소창의 `code` 는 **URL 인코딩되어 있다** (`4/0AX...` 가 `4%2F0AX...` 로 온다).
 *      그대로 curl 에 넘기면 구글이 `invalid_grant` 를 돌려준다. 여기선 서버가 디코드된 값을 직접 받는다.
 *   3. `access_type=offline` 과 `prompt=consent` 중 하나라도 빠지면 응답에 refresh_token 이 없다.
 *   4. 인증 코드는 수십 초 안에 만료된다. 복사·붙여넣기 왕복이 없으면 만료될 틈이 없다.
 *
 * 비밀은 argv 로 받지 않는다. `ps` 로 같은 머신의 다른 사용자에게 보인다. 환경변수나 물음으로만 받는다.
 * 토큰을 파일에 쓰지 않는다. `--gh` 는 stdin 으로 넘겨서 argv 에도 남기지 않는다.
 */
const http = require('http');
const https = require('https');
const readline = require('readline');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const WAIT_MS = 5 * 60 * 1000;

const argv = process.argv.slice(2);
const has = (f) => argv.indexOf(f) !== -1;
const val = (f, d) => { const i = argv.indexOf(f); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };

if (has('--help') || has('-h')) {
  process.stdout.write(require('fs').readFileSync(__filename, 'utf8').split('*/')[0].replace(/^'use strict';\n\/\*\n/, '').replace(/^ \* ?/gm, '') + '\n');
  process.exit(0);
}

const PORT = Number(val('--port', '8818'));
const USE_GH = has('--gh');
const REDIRECT = 'http://localhost:' + PORT;

function die(msg) { process.stderr.write('\ncws-token: ' + msg + '\n'); process.exit(1); }

/* 물음은 **줄 큐**로 받는다. 순진하게 질문마다 readline 을 새로 만들거나 rl.question 을 이어서
 * 부르면 파이프에서 멈춘다: readline 은 첫 readable 에서 버퍼에 있는 줄을 **한꺼번에** 흘리고 close
 * 까지 내보내는데, 그때 두 번째 질문은 await 뒤라 아직 등록되지 않았다. 둘째 줄이 갈 곳이 없어
 * 사라지고 프로그램이 영영 기다린다. TTY 에서는 입력이 한 줄씩 늦게 오니 드러나지 않는다 —
 * `printf 'a\\nb\\n' | node tools/cws-token.js` 에서만 멈춘다. 실제로 두 번 그렇게 멈췄다.
 * 그래서 받은 줄은 큐에 쌓아 두고, 질문은 큐에서 꺼내거나 대기자로 줄을 선다.
 * terminal 은 TTY 일 때만 켠다. 파이프에서 켜면 커서 제어 문자가 로그에 섞인다. */
function makeAsker() {
  const tty = !!process.stdin.isTTY;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
  const lines = [], waiters = [];
  let closed = false, masked = false;
  /* 가리기는 readline 의 **에코 자체를 막아서** 한다. 처음엔 'data' 를 듣고 매 글자마다 줄을 지우고
   * 별표로 다시 그렸는데, readline 이 먼저 글자를 찍고 우리가 나중에 덮는 순서라 원문이 한 번은
   * 단말에 나갔다. 화면에는 안 남지만 pty 로그·스크롤백·화면 녹화에는 그대로 남는다 — 실제로
   * expect 로그에 보안 비밀이 평문으로 찍혔다. 그래서 sudo 처럼 **아무것도 echo 하지 않는다.**
   * _writeToOutput 은 비공개 API 다. 없으면 가릴 방법이 없으므로 묻기를 거절한다(새지 않는 쪽으로 실패). */
  const canMask = typeof rl._writeToOutput === 'function';
  if (canMask) {
    const orig = rl._writeToOutput.bind(rl);
    rl._writeToOutput = function (s) { if (!masked) orig(s); };
  }
  rl.on('line', (l) => { const w = waiters.shift(); if (w) w(l); else lines.push(l); });
  rl.on('close', () => { closed = true; while (waiters.length) waiters.shift()(null); });
  return {
    ask(prompt, hidden) {
      const hide = !!hidden && tty;
      if (hide && !canMask) {
        die('이 Node 에서는 입력을 가릴 수 없습니다. 보안 비밀을 환경변수로 주세요:\n'
          + '  CWS_CLIENT_SECRET=... node tools/cws-token.js');
      }
      process.stdout.write(prompt);
      masked = hide;
      return new Promise((resolve) => {
        const done = (l) => {
          if (hide) { masked = false; process.stdout.write('\n'); }
          resolve(l == null ? '' : String(l).trim());
        };
        if (lines.length) done(lines.shift());
        else if (closed) done(null);
        else waiters.push(done);
      });
    },
    close() { try { masked = false; rl.close(); } catch (e) { /* ignore */ } }
  };
}

function postForm(url, form) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(form).toString();
    const req = https.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch (e) { /* ignore */ } resolve({ status: res.statusCode, json: j, raw: buf }); });
    });
    req.on('error', reject);
    req.end(body);
  });
}

/* 브라우저가 돌아오는 그 한 번을 받는다. state 를 확인해서 떠돌던 요청을 코드로 착각하지 않는다. */
function waitForCode(state) {
  return new Promise((resolve, reject) => {
    const reply = (res, text) => { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end(text); };
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
      const err = u.searchParams.get('error');
      const code = u.searchParams.get('code');
      if (err) { reply(res, '거절되었습니다: ' + err + '\n터미널로 돌아가세요.'); server.close(); reject(new Error('authorization denied: ' + err)); return; }
      if (!code) { res.writeHead(400); res.end(); return; }
      if (u.searchParams.get('state') !== state) { reply(res, 'state 가 맞지 않습니다. 무시했습니다.'); return; }
      reply(res, '받았습니다. 이 탭을 닫고 터미널로 돌아가세요.\n');
      server.close();
      resolve(code);
    });
    server.on('error', (e) => reject(new Error(e.code === 'EADDRINUSE'
      ? PORT + ' 포트가 이미 쓰이고 있습니다. --port 로 다른 포트를 주세요 (구글 데스크톱 앱 클라이언트는 포트를 가리지 않습니다).'
      : String(e.message))));
    server.listen(PORT, '127.0.0.1', () => { /* ready */ });
    setTimeout(() => { try { server.close(); } catch (e) { /* ignore */ } reject(new Error('5분 동안 리다이렉트가 오지 않았습니다.')); }, WAIT_MS).unref();
  });
}

function ghSecretSet(name, value) {
  return new Promise((resolve, reject) => {
    /* --body-file - 로 stdin 에서 읽는다. --body 로 주면 argv 에 남는다. */
    const p = spawn('gh', ['secret', 'set', name, '--body-file', '-'], { stdio: ['pipe', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('gh secret set ' + name + ' exited ' + c))));
    p.stdin.end(value);
  });
}

(async () => {
  let id = process.env.CWS_CLIENT_ID || '';
  let secret = process.env.CWS_CLIENT_SECRET || '';
  if (!id || !secret) {
    const asker = makeAsker();
    try {
      if (!id) id = await asker.ask('OAuth 클라이언트 ID: ', false);
      if (!secret) secret = await asker.ask('OAuth 클라이언트 보안 비밀: ', true);
    } finally { asker.close(); }
  }
  if (!id || !secret) die('클라이언트 ID 와 보안 비밀이 모두 필요합니다.');

  const state = crypto.randomBytes(16).toString('hex');
  const url = AUTH_URL + '?' + new URLSearchParams({
    client_id: id,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',   /* 이게 없으면 refresh_token 이 아예 안 온다 */
    prompt: 'consent',        /* 이게 없으면 두 번째부터 refresh_token 이 빠진다 */
    state
  }).toString();

  process.stdout.write('\n아래 주소를 브라우저에 붙여넣고, 스토어 항목을 소유한 계정으로 동의하세요.\n'
    + '(동의 화면이 "테스트" 상태라면 그 계정이 테스트 사용자에 들어 있어야 합니다.)\n\n' + url + '\n\n'
    + REDIRECT + ' 에서 기다립니다... (5분)\n');

  let code;
  try { code = await waitForCode(state); } catch (e) { die(e.message); }
  process.stdout.write('인증 코드를 받았습니다. 리프레시 토큰으로 바꿉니다...\n');

  const r = await postForm(TOKEN_URL, {
    client_id: id, client_secret: secret, code, grant_type: 'authorization_code', redirect_uri: REDIRECT
  });
  if (r.status !== 200 || !r.json) {
    const code2 = r.json && r.json.error ? r.json.error : 'HTTP ' + r.status;
    die('토큰 교환이 실패했습니다: ' + code2 + '\n'
      + (code2 === 'invalid_client' ? '  → 클라이언트 ID 나 보안 비밀이 틀렸거나, 클라이언트 유형이 "데스크톱 앱"이 아닙니다.\n' : '')
      + (code2 === 'redirect_uri_mismatch' ? '  → 웹 애플리케이션 클라이언트라면 ' + REDIRECT + ' 를 승인된 리디렉션 URI 에 넣어야 합니다.\n' : '')
      + (code2 === 'invalid_grant' ? '  → 코드가 만료됐습니다. 다시 실행하세요.\n' : ''));
  }
  const token = r.json.refresh_token;
  if (!token) die('응답에 refresh_token 이 없습니다. 이 계정이 이 클라이언트에 이미 동의한 상태라면\n'
    + '  https://myaccount.google.com/permissions 에서 접근 권한을 지우고 다시 실행하세요.');

  if (USE_GH) {
    process.stdout.write('\ngh secret set 으로 넣습니다 (값은 화면에 찍지 않습니다)...\n');
    await ghSecretSet('CWS_CLIENT_ID', id);
    await ghSecretSet('CWS_CLIENT_SECRET', secret);
    await ghSecretSet('CWS_REFRESH_TOKEN', token);
    process.stdout.write('\nCWS_CLIENT_ID · CWS_CLIENT_SECRET · CWS_REFRESH_TOKEN 세 개를 넣었습니다.\n'
      + 'CWS_EXTENSION_ID 는 스토어 대시보드 주소의 32자 ID 입니다:\n\n  gh secret set CWS_EXTENSION_ID\n\n');
  } else {
    process.stdout.write('\nCWS_REFRESH_TOKEN:\n\n  ' + token + '\n\n'
      + '이 값은 비밀입니다. 저장소에 커밋하지 마세요. 넣는 법:\n\n'
      + '  gh secret set CWS_REFRESH_TOKEN      # 붙여넣고 엔터 — 셸 기록에 안 남습니다\n\n'
      + '아예 화면에 안 찍히게 하려면 --gh 로 다시 실행하세요.\n\n');
  }
})().catch((e) => die(String((e && e.message) || e)));

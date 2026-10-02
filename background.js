/* 화면부수기 (Crash Screen) — MV3 service worker (plain script).
 * Toggles smash mode on the active tab by injecting content.css (USER origin)
 * and content.js. Re-executing content.js toggles; its completion value is
 * 'on' | 'off'. Every chrome.* call is guarded; listeners never throw.
 */
'use strict';

const BLOCKED_PREFIXES = [
  'chrome://', 'chrome-extension://', 'chrome-untrusted://', 'edge://', 'about:',
  'devtools://', 'view-source:', 'chrome-search://', 'chrome-error://'
];
const BLOCKED_HOSTS = ['chromewebstore.google.com'];
const BADGE_COLOR = '#e5484d';

function isInjectable(url) {
  if (typeof url !== 'string' || url.length === 0) return false;
  const lower = url.toLowerCase();
  for (const p of BLOCKED_PREFIXES) if (lower.startsWith(p)) return false;
  try {
    const u = new URL(url);
    if (BLOCKED_HOSTS.includes(u.hostname)) return false;
    if (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore')) return false;
    // No protocol allowlist (spec §4 step 2): blob:/data:/file: tabs get the injection attempt and a
    // genuine refusal is mapped to 'blocked' by looksBlocked() in toggleOnTab.
  } catch (e) {
    return false;
  }
  return true;
}

function looksBlocked(err) {
  const m = String((err && err.message) || err || '');
  return /Cannot access|extensions gallery|The extensions gallery|chrome:\/\//i.test(m);
}

async function setBadge(tabId, text, bg) {
  try { await chrome.action.setBadgeText({ tabId, text }); } catch (e) { /* tab gone */ }
  if (text) {
    try { await chrome.action.setBadgeBackgroundColor({ tabId, color: bg || BADGE_COLOR }); } catch (e) { /* ignore */ }
    try { if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' }); } catch (e) { /* ignore */ }
  }
}

function flashBlocked(tabId) {
  if (tabId == null) return;
  setBadge(tabId, '✕', '#c62828');
  try {
    setTimeout(async () => {
      try {
        const t = await chrome.action.getBadgeText({ tabId });
        if (t === '✕') await setBadge(tabId, '', BADGE_COLOR);   // a successful ON within 1.5 s must survive
      } catch (e) { /* tab gone */ }
    }, 1500);
  } catch (e) { /* ignore */ }
}

async function toggleOnTab(tab) {
  if (!tab || tab.id == null) return 'error';
  const tabId = tab.id;
  // With activeTab, tab.url may be undefined until the action is clicked; when
  // it is known and not injectable, short-circuit. When unknown, try anyway and
  // map the injection error to 'blocked'.
  if (tab.url !== undefined && !isInjectable(tab.url)) {
    flashBlocked(tabId);
    return 'blocked';
  }
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'], origin: 'USER' });
    const results = await chrome.scripting.executeScript({
      target: { tabId }, files: ['content.js'], injectImmediately: true
    });
    const res = Array.isArray(results) ? results[0] : null;
    if (res && res.result === 'off') {
      try {
        await chrome.scripting.removeCSS({ target: { tabId }, files: ['content.css'], origin: 'USER' });
      } catch (e) { /* already gone */ }
      return 'off';
    }
    return 'on';
  } catch (err) {
    try { console.warn('[crash-screen] toggle failed:', err && err.message ? err.message : err); } catch (e) { /* ignore */ }
    flashBlocked(tabId);
    return looksBlocked(err) ? 'blocked' : 'error';
  }
}

/* ---- listeners: registered synchronously at top level ---- */
try {
  chrome.action.onClicked.addListener((tab) => {
    try { toggleOnTab(tab).catch(() => {}); } catch (e) { /* ignore */ }
  });
} catch (e) { /* ignore */ }

try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || typeof msg !== 'object') return false;
      if (msg.type === 'crash:ping') {
        sendResponse({ ok: true });
        return false;
      }
      if (msg.type === 'crash:state') {
        const tabId = sender && sender.tab && sender.tab.id;
        if (tabId != null) setBadge(tabId, msg.active ? 'ON' : '', BADGE_COLOR);
        return false;
      }
    } catch (e) { /* ignore */ }
    return false;
  });
} catch (e) { /* ignore */ }

/* Ask the tab's content script whether smash mode is still on. false when there is no receiver
 * (document unloaded, nothing injected, or a script orphaned by an extension reload). */
async function queryActive(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'crash:query' });
    return !!(r && r.active);
  } catch (e) { return false; }
}

try {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    try {
      const st = changeInfo && changeInfo.status;
      if (st !== 'loading' && st !== 'complete') return;
      // 'loading' also fires for hash changes / pushState while the content script stays active, so
      // confirm the document is really gone before clearing. Real cross-document unloads are covered
      // by the content script's pagehide → crash:state as well; 'complete' re-checks in case that was lost.
      queryActive(tabId).then((active) => { if (!active) setBadge(tabId, '', BADGE_COLOR); }).catch(() => {});
    } catch (e) { /* ignore */ }
  });
} catch (e) { /* ignore */ }

/* exposed for tests */
self.__crashScreenToggle = toggleOnTab;
self.__crashScreenIsInjectable = isInjectable;

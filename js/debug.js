// Status bar diagnostics: a bottom sheet with a live readout of what decides the colour of the strip
// under the iPhone status bar, and switches that each try one fix without a reload. Opened from the
// account menu; loaded only then.

const KEY = 'relay-sbdebug-log';
let host = null;
let timer = null;
let observer = null;
const log = [];
const on = {};
let cacheVer = '';

const EXPERIMENTS = [
  { id: 'tc', label: 'theme-color tag, kept in step with the theme' },
  { id: 'cs', label: 'color-scheme follows the theme (undo .ios-app)' },
  { id: 'solid', label: 'Solid header, no blur' },
  { id: 'strip', label: 'Solid strip under the status bar (as BLOC)' },
  { id: 'htmlbg', label: 'Background on &lt;html&gt; as well as &lt;body&gt;' },
  { id: 'repaint', label: 'Force a repaint after each theme change' },
  { id: 'sbtag', label: 'Re-insert the status-bar-style tag after each change' },
];

const ground = () => getComputedStyle(document.documentElement).getPropertyValue('--ground').trim();
const mq = (q) => matchMedia(q).matches;

function insetTop() {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
  document.body.appendChild(p);
  const h = p.getBoundingClientRect().height;
  p.remove();
  return h;
}

// The element at a point, and the nearest one (it or an ancestor) that paints a background or a blur there.
function describe(el) {
  if (!el) return 'none';
  let paint = el;
  while (paint && paint !== document.documentElement) {
    const cs = getComputedStyle(paint);
    const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || bf !== 'none') break;
    paint = paint.parentElement;
  }
  return paint && paint !== el ? `${one(el)} → painted by ${one(paint)}` : one(el);
}
function one(el) {
  if (!el) return 'none';
  const cs = getComputedStyle(el);
  const name = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
  return `${name} · bg ${cs.backgroundColor}${bf !== 'none' ? ' · blur ' + bf : ''}`;
}

function snapshot() {
  const root = document.documentElement;
  const inset = insetTop();
  const x = Math.round(innerWidth / 2);
  const hide = host?.style.visibility;
  if (host) host.style.visibility = 'hidden';
  const at1 = document.elementFromPoint(x, 1);
  const atIn = document.elementFromPoint(x, Math.max(1, Math.round(inset) + 2));
  if (host) host.style.visibility = hide || '';
  const sw = document.getElementById('sidever')?.textContent?.trim() || cacheVer || '?';
  return [
    ['Version', sw],
    ['Installed app (navigator.standalone)', String(navigator.standalone)],
    ['display-mode: standalone', String(mq('(display-mode: standalone)'))],
    ['Phone in dark (prefers-color-scheme)', String(mq('(prefers-color-scheme: dark)'))],
    ['data-theme on <html>', root.dataset.theme || '(none: System)'],
    ['<html> classes', root.className || '(none)'],
    ['Computed color-scheme', getComputedStyle(root).colorScheme],
    ['--ground', ground()],
    ['<html> background', getComputedStyle(root).backgroundColor],
    ['<body> background', getComputedStyle(document.body).backgroundColor],
    ['theme-color tags', [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => `${m.content}${m.media ? ' (' + m.media + ')' : ''}`).join(', ') || '(none)'],
    ['status-bar-style tag', document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content || '(none)'],
    ['Safe area top', inset + 'px'],
    ['Top pixel row is', describe(at1)],
    ['Just below the safe area is', describe(atIn)],
    ['Scrolled (window.scrollY)', String(Math.round(scrollY))],
    ['Experiments on', Object.keys(on).filter((k) => on[k]).join(', ') || '(none)'],
    ['iOS', (navigator.userAgent.match(/OS (\d+[_\d]*)/) || [, '?'])[1].replace(/_/g, '.')],
  ];
}

function report() {
  const rows = snapshot().map(([k, v]) => `${k}: ${v}`).join('\n');
  return `Relay status bar diagnostics, ${new Date().toISOString()}\n${rows}\n\nLog:\n${log.join('\n') || '(empty)'}`;
}

/* ---------- experiments ---------- */

function styleTag(id, css) {
  let s = document.getElementById('dbg-' + id);
  if (css == null) { s?.remove(); return; }
  if (!s) { s = document.createElement('style'); s.id = 'dbg-' + id; document.head.appendChild(s); }
  s.textContent = css;
}

function syncTc() {
  let m = document.getElementById('dbg-tc');
  if (!on.tc) { m?.remove(); return; }
  if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; m.id = 'dbg-tc'; document.head.appendChild(m); }
  m.content = ground();
}

function apply(id, value) {
  on[id] = value;
  const root = document.documentElement;
  if (id === 'tc') syncTc();
  if (id === 'cs') {
    if (value) { root.dataset.dbgIos = root.classList.contains('ios-app') ? '1' : ''; root.classList.remove('ios-app'); }
    else if (root.dataset.dbgIos === '1') root.classList.add('ios-app');
  }
  if (id === 'solid') styleTag('solid', value ? '.phead{background:var(--ground)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}' : null);
  if (id === 'strip') {
    let d = document.getElementById('dbg-strip');
    if (value && !d) { d = document.createElement('div'); d.id = 'dbg-strip'; d.style.cssText = 'position:fixed;left:0;right:0;top:0;height:env(safe-area-inset-top,0px);background:var(--ground);z-index:9998;pointer-events:none'; document.body.appendChild(d); }
    if (!value) d?.remove();
  }
  if (id === 'htmlbg') styleTag('htmlbg', value ? 'html{background:var(--ground)!important}' : null);
  note(`${value ? 'ON ' : 'OFF'} ${id}`);
}

function afterThemeChange() {
  if (on.tc) syncTc();
  if (on.repaint) {
    const b = document.body;
    b.style.display = 'none';
    void b.offsetHeight;
    b.style.display = '';
    scrollBy(0, 1); scrollBy(0, -1);
  }
  if (on.sbtag) {
    const old = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    const m = document.createElement('meta');
    m.name = 'apple-mobile-web-app-status-bar-style';
    m.content = old?.content || 'black-translucent';
    old?.remove();
    document.head.appendChild(m);
  }
}

/* ---------- panel ---------- */

function note(text) {
  const t = new Date().toTimeString().slice(0, 8);
  log.push(`${t} ${text}`);
  if (log.length > 60) log.shift();
  try { sessionStorage.setItem(KEY, JSON.stringify(log)); } catch (e) { /* storage blocked */ }
}

const CSS = `
#dbg{position:fixed;left:0;right:0;bottom:0;max-height:62vh;z-index:9999;background:#fff;color:#111;border-radius:16px 16px 0 0;
  box-shadow:0 -10px 30px rgba(0,0,0,.35);display:flex;flex-direction:column;font:13px/1.35 -apple-system,system-ui,sans-serif;
  padding-bottom:env(safe-area-inset-bottom,0px);color-scheme:light}
#dbg header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #e5e5e5}
#dbg header b{flex:1;font-size:15px}
#dbg button{font:inherit;border:1px solid #ccc;background:#f4f4f4;color:#111;border-radius:9px;padding:9px 12px;min-height:40px}
#dbg button.on{background:#2A5BD7;border-color:#2A5BD7;color:#fff}
#dbg .body{overflow:auto;padding:10px 14px 14px;-webkit-overflow-scrolling:touch}
#dbg .themes{display:flex;gap:6px;margin-bottom:10px}
#dbg .themes button{flex:1}
#dbg h4{margin:12px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#666}
#dbg table{width:100%;border-collapse:collapse}
#dbg td{padding:4px 0;vertical-align:top;border-bottom:1px solid #f0f0f0}
#dbg td:first-child{color:#666;padding-right:10px;width:44%}
#dbg td:last-child{font-family:ui-monospace,Menlo,monospace;font-size:12px;word-break:break-all}
#dbg label{display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid #f0f0f0}
#dbg input[type=checkbox]{width:22px;height:22px;flex:none}
#dbg pre{white-space:pre-wrap;font:11px/1.4 ui-monospace,Menlo,monospace;background:#f6f6f6;border-radius:8px;padding:8px;margin:0}
`;

function render(setTheme, getTheme) {
  const rows = snapshot().map(([k, v]) => `<tr><td>${k.replace(/</g, '&lt;')}</td><td>${String(v).replace(/</g, '&lt;')}</td></tr>`).join('');
  const theme = getTheme();
  host.querySelector('.themes').innerHTML = ['light', 'dark', 'system'].map((v) => `<button data-t="${v}" class="${theme === v ? 'on' : ''}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('');
  host.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => {
    note(`theme → ${b.dataset.t}`);
    setTheme(b.dataset.t);
    afterThemeChange();
    render(setTheme, getTheme);
  }));
  host.querySelector('table').innerHTML = rows;
  host.querySelector('pre').textContent = log.slice(-12).join('\n') || '(empty)';
}

export function openDebug({ setTheme, getTheme }) {
  if (host) return;
  try { log.push(...JSON.parse(sessionStorage.getItem(KEY) || '[]')); } catch (e) { /* storage blocked */ }
  styleTag('panel', CSS);
  host = document.createElement('div');
  host.id = 'dbg';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-label', 'Status bar diagnostics');
  host.innerHTML = `<header><b>Status bar diagnostics</b><button id="dbg-copy">Copy report</button><button id="dbg-x">Close</button></header>
    <div class="body">
      <div class="themes"></div>
      <h4>Try a fix (live, nothing is saved)</h4>
      ${EXPERIMENTS.map((e) => `<label><input type="checkbox" data-x="${e.id}" ${on[e.id] ? 'checked' : ''}><span>${e.label}</span></label>`).join('')}
      <h4>What iOS can see</h4>
      <table></table>
      <h4>Log</h4>
      <pre></pre>
    </div>`;
  document.body.appendChild(host);
  host.querySelectorAll('[data-x]').forEach((c) => (c.onchange = () => { apply(c.dataset.x, c.checked); render(setTheme, getTheme); }));
  host.querySelector('#dbg-x').onclick = closeDebug;
  host.querySelector('#dbg-copy').onclick = async () => {
    const b = host.querySelector('#dbg-copy');
    try { await navigator.clipboard.writeText(report()); b.textContent = 'Copied'; } catch (e) { b.textContent = 'Copy failed'; }
    setTimeout(() => { if (host) b.textContent = 'Copy report'; }, 1500);
  };
  observer = new MutationObserver(() => note(`<html> data-theme=${document.documentElement.dataset.theme || '(none)'} class=${document.documentElement.className || '(none)'}`));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  caches?.keys().then((k) => { cacheVer = k.filter((n) => n.startsWith('relay-shell-')).sort().pop()?.replace('relay-shell-', '') || ''; }).catch(() => {});
  note('panel opened');
  render(setTheme, getTheme);
  timer = setInterval(() => render(setTheme, getTheme), 1000);
}

export function closeDebug() {
  clearInterval(timer);
  observer?.disconnect();
  host?.remove();
  host = null;
  styleTag('panel', null);
}

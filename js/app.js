// SATU! — app: screens, host loop, client flow, dealing & card animations.
import { Game, COLORS, COLOR_NAME, MIN_PLAYERS, MAX_PLAYERS, TARGETS, HAND_SIZES, canPlay, cardName } from './engine.js?v=1';
import * as net from './net.js?v=1';
import { sfx, vibrate } from './sfx.js?v=1';

// ======================================================================
// utils
// ======================================================================
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const DEV = params.has('dev');
const SLOT = params.get('slot') ? '_' + params.get('slot') : '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
const CODE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => CODE_ALPHA[b % CODE_ALPHA.length]).join('');
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('satu_' + k + SLOT); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('satu_' + k + SLOT, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem('satu_' + k + SLOT); } catch (_) {} },
};
const EMOJIS = ['😎', '🤠', '🦊', '🐼', '🐯', '🐸', '🦄', '🐙', '👻', '🤖', '👽', '🐵', '🦁', '🐧', '🍉', '🌶️', '🔥', '⭐'];
const COLOR_HEX = { r: '#ef3b36', y: '#ffc21a', g: '#1fb35b', b: '#1e7bff' };
const COLOR_ORDER = { r: 0, y: 1, g: 2, b: 3, w: 4 };
const VAL_ORDER = (v) => (/^\d$/.test(v) ? Number(v) : { s: 10, r: 11, d2: 12, w: 13, w4: 14 }[v]);

let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}
function netBanner(msg) {
  const n = $('#net');
  if (!msg) { n.classList.add('hidden'); return; }
  n.textContent = msg; n.classList.remove('hidden');
}

const App = {
  mode: null, code: null, me: null, bus: null,
  game: null, hostKeys: null, pubs: {}, keyP: {}, chain: {}, seen: {}, lastSent: {},
  ident: null, hostKey: null, hostPub: null,
  view: null, lastViewAt: 0,
  profile: store.get('profile', { name: '', emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)] }),
  screen: 'home', screenData: {},
  ui: { sel: null },
  hidden: new Set(), pileHide: null,
  modalKind: null,
};
const P = (id) => App.view && App.view.players.find((p) => p.id === id);
const nameOf = (id) => (id === App.me ? 'You' : P(id)?.name || '?');

// ======================================================================
// wake lock + audio unlock
// ======================================================================
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (_) {}
}
for (const ev of ['touchend', 'click', 'keydown']) {
  document.addEventListener(ev, () => { if (!sfx.ready || (sfx.mediaEl && sfx.mediaEl.paused)) sfx.unlock(); keepAwake(); }, true);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    keepAwake(); sfx.unlock();
    if (App.mode === 'client' && App.bus) sendHost({ type: 'sync' });
  }
});
function testSound() {
  sfx.unlock();
  if (sfx.muted) sfx.setMuted(false);
  setTimeout(() => { sfx.play('trrr'); sfx.play('win', { delay: 0.35 }); }, 60);
  vibrate([120, 60, 120]);
  setTimeout(() => toast(sfx.ready ? '🔊 Sound is ON. Hear nothing? Raise the media volume and turn Silent mode off.' : '⚠️ Sound is blocked. Tap again.', 5000), 700);
}

// ======================================================================
// HOST
// ======================================================================
async function hostCreate() {
  App.mode = 'host';
  App.code = genCode();
  App.me = 'h_' + rid(8);
  App.hostKeys = await net.genKeys();
  App.game = Game.create(App.code, { id: App.me, name: App.profile.name, emoji: App.profile.emoji }, { minPlayers: MIN_PLAYERS });
  App.bus = new net.Bus(App.code);
  await App.bus.connectAny(0);
  await hostWire();
}
async function hostResume(saved) {
  App.mode = 'host';
  App.code = saved.code; App.me = saved.me; App.hostKeys = saved.hostKeys; App.pubs = saved.pubs || {};
  App.game = new Game(saved.state);
  App.bus = new net.Bus(App.code);
  try { await App.bus.connectTo(saved.broker ?? 0); } catch (_) { await App.bus.connectAny(0); }
  await hostWire();
}
async function hostWire() {
  const bus = App.bus;
  bus.onStatus = (s) => netBanner(s === 'online' ? null : 'Connection lost. Reconnecting…');
  await bus.subscribe('up', onHostUp);
  publishMeta(true);
  App.screen = 'game';
  store.set('last', { code: App.code, host: true, at: Date.now() });
  clearInterval(App.loop); clearInterval(App.beat);
  App.loop = setInterval(hostTick, 120);
  App.beat = setInterval(() => broadcast(true), 4000);
  afterChange();
}
function publishMeta(force = false) {
  const open = App.game.s.phase === 'lobby';
  if (!force && App._metaOpen === open && Date.now() - (App._metaAt || 0) < 60000) return;
  App._metaOpen = open; App._metaAt = Date.now();
  App.bus.publish('meta', { v: 1, pub: App.hostKeys.pub, open, at: Date.now() }, { retain: true });
}
function keyFor(pid) {
  if (!App.keyP[pid] && App.pubs[pid]) App.keyP[pid] = net.deriveKey(App.hostKeys.priv, App.pubs[pid]);
  return App.keyP[pid] || null;
}
async function onHostUp(data) {
  if (!data || typeof data.pid !== 'string' || data.pid.length > 40) return;
  const pid = data.pid;
  const g = App.game;
  if (data.t === 'hello') {
    if (!data.pub || !data.pub.x) return;
    const known = App.pubs[pid];
    if (known && (known.x !== data.pub.x || known.y !== data.pub.y)) { App.bus.publish('dn/' + pid, { t: 'reject', reason: 'This identity is already in use.' }); return; }
    if (!g.p(pid) && g.s.phase !== 'lobby') { App.bus.publish('dn/' + pid, { t: 'reject', reason: 'This game has already started. Ask the host to go back to the lobby.' }); return; }
    if (!g.p(pid) && g.s.players.length >= MAX_PLAYERS) { App.bus.publish('dn/' + pid, { t: 'reject', reason: 'The table is full.' }); return; }
    if (!known) { App.pubs[pid] = data.pub; saveHost(); }
    keyFor(pid);
    return;
  }
  if (data.t !== 'm') return;
  const kp = keyFor(pid);
  if (!kp) { App.bus.publish('dn/' + pid, { t: 'who' }); return; }
  let msg;
  try { msg = await net.unseal(await kp, data); } catch (_) { return; }
  App.seen[pid] = Date.now();
  switch (msg.type) {
    case 'join': {
      const res = g.addPlayer({ id: pid, name: msg.name, emoji: msg.emoji });
      if (!res.ok) { sendTo(pid, { type: 'error', error: res.error, fatal: true }); return; }
      if (!res.rejoin) sfx.play('join');
      afterChange(); sendView(pid, true);
      break;
    }
    case 'sync': sendView(pid, true); break;
    case 'ping': if (!App.lastSent[pid]) sendView(pid, true); break;
    case 'act': {
      if (!g.p(pid)) return;
      const res = g.handle(pid, msg.a || {}, Date.now());
      if (!res.ok && res.error) sendTo(pid, { type: 'error', error: res.error });
      afterChange();
      break;
    }
  }
}
// messages to one phone are sealed and sent strictly in order (animations before the new view)
function sendTo(pid, obj) {
  const kp = keyFor(pid);
  if (!kp) return Promise.resolve();
  const prev = App.chain[pid] || Promise.resolve();
  const p = prev.then(async () => {
    const sealed = await net.seal(await kp, obj);
    App.bus && App.bus.publish('dn/' + pid, { t: 'm', ...sealed });
  }).catch(() => {});
  App.chain[pid] = p;
  return p;
}
function decorate(v) {
  const now = Date.now();
  v.players.forEach((p) => { p.online = p.id === App.game.s.hostId || !!p.bot || (App.seen[p.id] && now - App.seen[p.id] < 16000); });
  return v;
}
function sendView(pid, force = false) {
  const v = App.game.viewFor(pid);
  if (!v) return;
  decorate(v);
  const key = JSON.stringify(v);
  if (!force && App.lastSent[pid] === key) return;
  App.lastSent[pid] = key;
  sendTo(pid, { type: 'view', v });
}
function broadcast(force = false) {
  if (!App.game) return;
  for (const p of App.game.s.players) if (!p.bot && p.id !== App.me) sendView(p.id, force);
  if (force) publishMeta();
}
let saveTimer = null;
function saveHost() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!App.game) return;
    store.set('host', { code: App.code, me: App.me, hostKeys: App.hostKeys, pubs: App.pubs, state: App.game.s, broker: App.bus ? App.bus.brokerIdx : 0, savedAt: Date.now() });
  }, 300);
}
// engine events → animations on every phone. Card faces only go to the phone that owns them.
function personal(e, pid) {
  if (e.type === 'deal' && e.to !== pid) { const { card, ...r } = e; return r; }
  if (e.type === 'draw' && e.by !== pid) { const { cards, ...r } = e; return r; }
  return e;
}
// Public animations go out ONCE on the shared "fx" topic (cheap, so fast dealing doesn't flood the
// relay). Card faces travel encrypted, only to the phone that receives them.
function deliverEvents() {
  const g = App.game;
  const evs = g.drainEvents();
  if (!evs.length) return;
  for (const e of evs) {
    App.bus.publish('fx', personal(e, null), { qos: 0 });
    const owner = e.type === 'deal' ? e.to : e.type === 'draw' ? e.by : null;
    const op = owner && g.p(owner);
    if (op && !op.bot && owner !== App.me) sendTo(owner, { type: 'fx', e });
    onFx(personal(e, App.me));
  }
}
function afterChange() {
  const g = App.game;
  if (!g) return;
  deliverEvents();
  saveHost();
  publishMeta();
  // while dealing, phones update their own counts from the deal animations; full views every 1.5 s
  if (g.s.phase === 'dealing') {
    if (!App.bTimer) App.bTimer = setTimeout(() => { App.bTimer = null; broadcast(); }, 1500);
  } else {
    clearTimeout(App.bTimer); App.bTimer = null;
    broadcast();
  }
  applyView(decorate(g.viewFor(App.me)));
}
function hostTick() {
  const g = App.game;
  if (!g) return;
  const now = Date.now();
  if (g.tick(now)) afterChange();
  if (DEV) runBots(now);
}

// ---- dev bots (?dev=1) ----
function addBot() {
  const names = ['Ali', 'Badrul', 'Chloe', 'Dina', 'Eiman', 'Farah', 'Ganesh', 'Hana', 'Irfan'];
  const used = new Set(App.game.s.players.map((p) => p.name));
  const name = names.find((n) => !used.has(n)) || 'Bot ' + rid(3);
  App.game.addPlayer({ id: 'b_' + rid(6), name, emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)], bot: true });
  afterChange();
}
function runBots(now) {
  const g = App.game, s = g.s;
  if (s.phase !== 'play') return;
  let changed = false;
  for (const b of s.players) if (b.bot && b.hand.length <= 2 && !b.called && Math.random() < 0.03) { g.handle(b.id, { type: 'shout' }, now); changed = true; }
  if (s.vulnerable && Math.random() < 0.008) {
    const b = s.players.find((p) => p.bot && p.id !== s.vulnerable);
    if (b) { g.handle(b.id, { type: 'catch' }, now); changed = true; }
  }
  const pd = s.pending;
  const actor = pd && (pd.type === 'color' || pd.type === 'challenge') ? g.p(pd.pid) : g.cur();
  if (!actor || !actor.bot) { App.botKey = null; if (changed) afterChange(); return; }
  const key = `${s.turn}:${s.log.length}:${pd ? pd.type : ''}`;
  if (App.botKey !== key) { App.botKey = key; App.botAt = now + 1000 + Math.random() * 1000; if (changed) afterChange(); return; }
  if (now < App.botAt) { if (changed) afterChange(); return; }
  App.botKey = null;
  const cnt = { r: 0, y: 0, g: 0, b: 0 };
  actor.hand.forEach((c) => { if (c.c !== 'w') cnt[c.c]++; });
  const col = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
  if (pd && pd.type === 'color') g.handle(actor.id, { type: 'color', color: col }, now);
  else if (pd && pd.type === 'challenge') g.handle(actor.id, { type: 'challenge', yes: Math.random() < 0.3 }, now);
  else if (pd && pd.type === 'drawn') g.handle(actor.id, { type: 'play', card: pd.card, color: col }, now);
  else {
    const card = actor.hand.find((c) => c.c !== 'w' && canPlay(c, g.top, s.color)) || actor.hand.find((c) => canPlay(c, g.top, s.color));
    if (card) g.handle(actor.id, { type: 'play', card: card.id, color: col }, now);
    else g.handle(actor.id, { type: 'draw' }, now);
  }
  afterChange();
}

async function closeTable() {
  if (App.mode !== 'host') return;
  for (const p of App.game.s.players) if (!p.bot && p.id !== App.me) sendTo(p.id, { type: 'error', error: 'The host closed the table.', fatal: true });
  App.bus.publish('meta', null, { retain: true });
  store.del('host'); store.del('last');
  await sleep(900);
  teardown();
}

// ======================================================================
// CLIENT
// ======================================================================
async function clientJoin(code, preferredBroker = null) {
  App.mode = 'client';
  App.code = code;
  setScreen('connecting', { msg: `Looking for table ${code}…` });
  const found = await net.findLobby(code, preferredBroker);
  if (!found) { App.mode = null; setScreen('home', { code }); toast('Table not found. Check the code.'); return; }
  App.bus = found.bus;
  let ident = store.get('id_' + code);
  if (!ident) { ident = { pid: 'p_' + rid(10), keys: await net.genKeys() }; store.set('id_' + code, ident); }
  App.ident = ident; App.me = ident.pid;
  App.hostPub = found.meta.pub;
  App.hostKey = await net.deriveKey(ident.keys.priv, found.meta.pub);
  const bus = App.bus;
  bus.onStatus = (s) => { if (s === 'online') { netBanner(null); clientHello(); } else netBanner('Connection lost. Reconnecting…'); };
  await bus.subscribe('dn/' + App.me, onClientDn);
  await bus.subscribe('fx', (e) => {
    if (!e || typeof e.type !== 'string' || !App.view) return;
    if ((e.type === 'deal' && e.to === App.me) || (e.type === 'draw' && e.by === App.me)) return; // my private copy brings the card
    onFx(e);
  });
  await bus.subscribe('meta', async (m) => {
    if (!m) { if (App.view && App.mode === 'client') { toast('The host closed the table.', 3500); store.del('last'); teardown(); } return; }
    if (m.pub && m.pub.x !== App.hostPub.x) { App.hostPub = m.pub; App.hostKey = await net.deriveKey(ident.keys.priv, m.pub); clientHello(); }
  });
  store.set('last', { code, broker: bus.brokerIdx, at: Date.now() });
  await clientHello();
  setScreen('connecting', { msg: 'Pulling up a chair…' });
  clearInterval(App.beat);
  App.beat = setInterval(() => {
    sendHost({ type: 'ping' });
    if (App.view && Date.now() - App.lastViewAt > 13000) { netBanner('Waiting for the host…'); sendHost({ type: 'sync' }); }
  }, 5000);
  setTimeout(() => { if (!App.view && App.mode === 'client') { netBanner('The host is not answering…'); clientHello(); } }, 6000);
}
async function clientHello() {
  if (!App.bus || !App.ident) return;
  App.bus.publish('up', { t: 'hello', pid: App.me, pub: App.ident.keys.pub });
  await sleep(250);
  await sendHost({ type: 'join', name: App.profile.name, emoji: App.profile.emoji });
}
async function sendHost(obj) {
  if (!App.hostKey || !App.bus) return;
  const sealed = await net.seal(App.hostKey, obj);
  App.bus.publish('up', { t: 'm', pid: App.me, ...sealed });
}
let dnChain = Promise.resolve();
function onClientDn(data) {
  // decrypt strictly in arrival order so animations land before the matching view
  dnChain = dnChain.then(() => handleDn(data)).catch(() => {});
}
async function handleDn(data) {
  if (!data) return;
  if (data.t === 'reject') { toast(data.reason, 4000); store.del('last'); teardown(); return; }
  if (data.t === 'who') { clientHello(); return; }
  if (data.t !== 'm') return;
  let msg;
  try { msg = await net.unseal(App.hostKey, data); } catch (_) { return; }
  if (msg.type === 'fx') { if (App.view) onFx(msg.e); return; }
  if (msg.type === 'view') { App.lastViewAt = Date.now(); netBanner(null); App.screen = 'game'; applyView(msg.v); }
  else if (msg.type === 'error') {
    toast(msg.error, 3500);
    sfx.play('error');
    if (msg.fatal) { store.del('last'); teardown(); }
  }
}

function teardown() {
  clearInterval(App.loop); clearInterval(App.beat); clearTimeout(App.bTimer);
  if (App.bus) App.bus.close();
  Object.assign(App, { mode: null, code: null, me: null, bus: null, game: null, view: null, pubs: {}, keyP: {}, chain: {}, seen: {}, lastSent: {}, ident: null, hostKey: null, bTimer: null });
  App.hidden.clear();
  closeModal();
  netBanner(null);
  setScreen('home');
}

function act(a) {
  if (App.mode === 'host') {
    const res = App.game.handle(App.me, a, Date.now());
    if (!res.ok && res.error) { toast(res.error); sfx.play('error'); }
    afterChange();
  } else if (App.mode === 'client') sendHost({ type: 'act', a });
}

// ======================================================================
// view + reactions
// ======================================================================
function applyView(v) {
  const prev = App.view;
  App.view = v;
  if (App.screen !== 'game') App.screen = 'game';
  const myTurnNow = v.phase === 'play' && v.turn === App.me && !(v.pending && v.pending.type === 'challenge' && v.pending.pid !== App.me);
  const myTurnBefore = prev && prev.phase === 'play' && prev.turn === App.me;
  if (myTurnNow && !myTurnBefore) { sfx.play('turn', { delay: 0.35 }); vibrate([50, 40, 50]); App.ui.sel = null; }
  if (!myTurnNow) App.ui.sel = null;
  if (prev && prev.phase !== v.phase && v.phase === 'lobby') App.hidden.clear();
  // the hand never shows a card that is still flying in, but forget stale ids
  const ids = new Set(v.me.hand.map((c) => c.id));
  for (const id of App.hidden) if (!ids.has(id)) App.hidden.delete(id);
  render();
  syncModal(v);
}

// decisions that need a sheet: first colour, +4 challenge
function syncModal(v) {
  const pd = v.pending;
  const want = pd && pd.pid === App.me && (pd.type === 'color' || pd.type === 'challenge') ? pd.type : null;
  if (want === App.modalKind) return;
  if (App.modalKind === 'color' || App.modalKind === 'challenge') closeModal();
  if (want === 'color') colorSheet(null, true);
  if (want === 'challenge') challengeSheet(v);
}

// ---------- geometry ----------
const centerOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; };
function seatPt(pid) {
  const el = document.querySelector(`[data-seat="${CSS.escape(pid)}"] .av`);
  return el ? centerOf(el) : { x: innerWidth / 2, y: innerHeight * 0.2, w: 40 };
}
const deckPt = () => { const el = $('#deck .card:last-of-type'); return el ? centerOf(el) : { x: innerWidth / 2, y: innerHeight * 0.3, w: 64 }; };
const pilePt = () => { const el = $('#pile'); return el ? centerOf(el) : { x: innerWidth / 2, y: innerHeight * 0.3, w: 64 }; };
function handEndPt() {
  const hand = $('#hand');
  if (!hand) return { x: innerWidth / 2, y: innerHeight - 90, w: 74 };
  const hr = hand.getBoundingClientRect();
  const cards = [...hand.querySelectorAll('.card:not(.hid)')];
  const last = cards[cards.length - 1];
  const cw = parseFloat(getComputedStyle(hand).getPropertyValue('--cw')) || 74;
  const y = hr.top + 30 + cw * 0.75;
  if (!last) return { x: hr.left + hr.width / 2, y, w: cw };
  const lr = last.getBoundingClientRect();
  return { x: Math.min(lr.right + cw * 0.15, hr.right - cw / 2), y, w: cw };
}

// ---------- animation primitives ----------
function cardEl(card) { const d = document.createElement('div'); d.innerHTML = cardHTML(card); return d.firstElementChild; }
// fly a card along points [{x,y,r,s}] ; flipTo = show this face part-way
function fly({ card = null, pts, w = 64, dur = 450, flipTo = null, flipAt = 0.45, label = null, delay = 0, ease = 'cubic-bezier(.25,.8,.3,1)', onEnd = null, offsets = null }) {
  const layer = $('#fx');
  const el = document.createElement('div');
  el.className = 'flyer';
  el.style.width = w + 'px';
  el.style.setProperty('--cw', w + 'px');
  const inner = document.createElement('div');
  inner.appendChild(cardEl(card));
  el.appendChild(inner);
  if (label) el.insertAdjacentHTML('beforeend', `<div class="flabel">${esc(label)}</div>`);
  const H = w * 1.5;
  const tf = (p) => `translate(${p.x - w / 2}px, ${p.y - H / 2}px) rotate(${p.r || 0}deg) scale(${p.s ?? 1})`;
  const kf = pts.map((p, i) => ({ transform: tf(p), opacity: p.o ?? 1, offset: offsets ? offsets[i] : i / (pts.length - 1) }));
  el.style.transform = tf(pts[0]);
  if (delay) el.style.opacity = '0';
  layer.appendChild(el);
  const anim = el.animate(kf, { duration: dur, delay, easing: ease, fill: 'both' });
  if (delay) setTimeout(() => { el.style.opacity = ''; }, delay);
  if (flipTo !== null) {
    setTimeout(() => {
      inner.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: 100, fill: 'forwards' }).onfinish = () => {
        inner.innerHTML = ''; inner.appendChild(cardEl(flipTo));
        inner.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 120, fill: 'forwards' });
      };
    }, delay + dur * flipAt - 100);
  }
  anim.onfinish = () => { el.remove(); if (onEnd) onEnd(); };
  return anim;
}
function burst(pt, text, cls = '', dur = 1100) {
  const el = document.createElement('div');
  el.className = 'burst ' + cls;
  el.textContent = text;
  el.style.left = pt.x + 'px'; el.style.top = pt.y + 'px';
  $('#fx').appendChild(el);
  el.animate([
    { transform: 'translate(-50%,-50%) scale(.3) rotate(-10deg)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1.15) rotate(-6deg)', opacity: 1, offset: 0.2 },
    { transform: 'translate(-50%,-60%) scale(1) rotate(-6deg)', opacity: 1, offset: 0.75 },
    { transform: 'translate(-50%,-90%) scale(.9) rotate(-6deg)', opacity: 0 },
  ], { duration: dur, easing: 'ease-out' }).onfinish = () => el.remove();
}
function stamp(pt, text) {
  const el = document.createElement('div');
  el.className = 'stamp'; el.textContent = text;
  el.style.left = pt.x + 'px'; el.style.top = pt.y + 'px';
  $('#fx').appendChild(el);
  el.animate([{ transform: 'translate(-50%,-50%) scale(2.4)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 900 }).onfinish = () => el.remove();
}
function popSeat(pid) {
  const el = document.querySelector(`[data-seat="${CSS.escape(pid)}"]`);
  if (!el) return;
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}
function colorFlash(c) {
  const el = document.createElement('div');
  el.className = 'colorflash';
  el.style.background = `radial-gradient(circle at 50% 35%, ${COLOR_HEX[c]}88, transparent 60%)`;
  $('#fx').appendChild(el);
  el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: 900 }).onfinish = () => el.remove();
}
function confetti() {
  const cols = Object.values(COLOR_HEX).concat(['#fff', '#ffd84d']);
  for (let i = 0; i < 90; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    el.style.left = Math.random() * 100 + 'vw';
    el.style.background = cols[i % cols.length];
    $('#fx').appendChild(el);
    const dx = (Math.random() - 0.5) * 200;
    el.animate([{ transform: 'translate(0,0) rotate(0)' }, { transform: `translate(${dx}px, ${innerHeight + 60}px) rotate(${Math.random() * 900}deg)` }],
      { duration: 1800 + Math.random() * 1800, delay: Math.random() * 600, easing: 'cubic-bezier(.3,.6,.6,1)', fill: 'both' }).onfinish = () => el.remove();
  }
}
function shuffleAnim(small) {
  const d = deckPt();
  const n = small ? 4 : 10;
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    fly({ pts: [{ x: d.x + side * 46, y: d.y - 6, r: side * 18 }, { x: d.x + side * 12, y: d.y - 18, r: side * 6 }, { x: d.x, y: d.y, r: 0 }], w: d.w, dur: 260, delay: i * 115, ease: 'ease-in-out' });
  }
}

// ---------- engine events → animation + sound on this phone ----------
function onFx(e) {
  const v = App.view;
  if (!v) return;
  const me = App.me;
  const isDealer = App.mode === 'host';
  switch (e.type) {
    case 'shuffle':
      sfx.play('shuffle', { small: e.small });
      setTimeout(() => shuffleAnim(e.small), 30);
      if (!e.small) toast(`${isDealer ? 'You shuffle' : 'The host shuffles'} the deck…`, 1600);
      break;
    case 'deal': {
      // keep this phone's table in step without waiting for the next full view
      const p = P(e.to);
      if (p && e.n != null) p.count = e.n;
      if (e.deck != null) v.deckCount = e.deck;
      if (v.dealing) { v.dealing.left = e.left; const i = v.players.findIndex((x) => x.id === e.to); v.dealing.to = v.players[(i + 1) % v.players.length].id; }
      if (e.to === me && e.card && !v.me.hand.some((c) => c.id === e.card.id)) { v.me.hand.push(e.card); App.hidden.add(e.card.id); }
      render();
      animDeal(e, isDealer);
      break;
    }
    case 'flip': {
      sfx.play('play', { delay: 0.25 });
      const d = deckPt(), pl = pilePt();
      App.pileHide = e.card.id;
      fly({ pts: [{ x: d.x, y: d.y }, { x: (d.x + pl.x) / 2, y: d.y - 40, s: 1.4 }, { x: pl.x, y: pl.y, r: 4 }], w: pl.w, dur: 650, flipTo: e.card, flipAt: 0.5, onEnd: () => { App.pileHide = null; paintPile(); } });
      break;
    }
    case 'play': animPlay(e); break;
    case 'draw': {
      const p = P(e.by);
      if (p && e.count != null) p.count = e.count;
      if (e.deck != null) v.deckCount = e.deck;
      if (e.by === App.me && e.cards) for (const c of e.cards) if (!v.me.hand.some((x) => x.id === c.id)) v.me.hand.push(c);
      animDraw(e);
      render();
      break;
    }
    case 'skip':
      if (!e.quiet) sfx.play('skip', { delay: 0.3 });
      setTimeout(() => stamp(seatPt(e.target), '⊘'), 300);
      break;
    case 'reverse': {
      sfx.play('reverse', { delay: 0.3 });
      const ring = $('.dirring svg');
      if (ring) ring.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.15) rotate(180deg)' }, { transform: 'scale(1)' }], { duration: 700 });
      setTimeout(() => burst(pilePt(), '⇄ REVERSE'), 300);
      break;
    }
    case 'color':
      sfx.play('color'); colorFlash(e.color);
      burst(pilePt(), COLOR_NAME[e.color].toUpperCase());
      break;
    case 'shout':
      sfx.play('satu');
      burst(seatPt(e.by), 'SATU!', 'satu', 1500);
      vibrate(80);
      if (e.by === me) speak('Satu!');
      break;
    case 'catch':
      sfx.play('catch');
      burst(seatPt(e.target), 'CAUGHT! +2', 'bad', 1500);
      if (e.target === me) vibrate([200, 80, 200]);
      break;
    case 'challenge':
      sfx.play(e.guilty ? 'catch' : 'error');
      burst(seatPt(e.guilty ? e.target : e.by), e.guilty ? 'BUSTED! +4' : 'CLEAN! +6', 'bad', 1600);
      break;
    case 'round':
      setTimeout(() => { sfx.play('win'); confetti(); if (e.winner === me) vibrate([100, 50, 100, 50, 300]); }, 500);
      break;
  }
}

// THE DEAL. Host phone: the card is flicked off the deck and slides away off the top of the
// screen ("to" the player across the table) with a trrr. Player's phone: the card slides in
// from the top edge, flips over big in the middle, then drops into the hand.
function animDeal(e, isDealer) {
  const me = App.me;
  const d = deckPt();
  if (e.to === me) {
    if (isDealer) sfx.play('trrr');
    sfx.play('receive', { delay: isDealer ? 0.12 : 0 });
    vibrate(25);
    const end = handEndPt();
    const W = innerWidth, startX = W / 2 + (Math.random() - 0.5) * 30;
    const pts = isDealer
      ? [{ x: d.x, y: d.y, s: d.w / end.w }, { x: W / 2, y: innerHeight * 0.5, s: 1.5, r: -4 }, { x: end.x, y: end.y, s: 1 }]
      : [{ x: startX, y: -end.w * 1.2, r: -14, s: 1.4 }, { x: W / 2, y: innerHeight * 0.45, s: 1.7, r: 3 }, { x: W / 2, y: innerHeight * 0.45, s: 1.7, r: 0 }, { x: end.x, y: end.y, s: 1 }];
    fly({ card: null, pts, w: end.w, dur: isDealer ? 620 : 900, flipTo: e.card || null, flipAt: isDealer ? 0.45 : 0.42, offsets: isDealer ? null : [0, 0.35, 0.62, 1],
      onEnd: () => { if (e.card) App.hidden.delete(e.card.id); paintHand(); } });
    return;
  }
  if (isDealer) {
    // flick it forward: off the top of the host's phone, leaning towards the player's seat
    sfx.play('trrr');
    vibrate(12);
    const s = seatPt(e.to);
    const lean = (s.x - d.x) / innerWidth;
    fly({ pts: [{ x: d.x, y: d.y, r: 0 }, { x: d.x + lean * 60, y: d.y - 70, r: lean * 30, s: 1.25 }, { x: d.x + lean * 260, y: -140, r: lean * 60 + (Math.random() - 0.5) * 20, s: 1.35, o: 0.9 }],
      w: d.w, dur: 430, label: '→ ' + nameOf(e.to), ease: 'cubic-bezier(.4,.1,.6,1)' });
    popSeat(e.to);
    return;
  }
  // everyone else: a small card glides from the deck to that player's seat
  const s = seatPt(e.to);
  fly({ pts: [{ x: d.x, y: d.y }, { x: s.x, y: s.y, s: 0.5, r: 20 }], w: d.w, dur: 380, onEnd: () => popSeat(e.to) });
}

function animPlay(e) {
  const me = App.me;
  const pl = pilePt();
  const rot = ((e.card.id * 37) % 24) - 12;
  App.pileHide = e.card.id;
  const land = () => {
    App.pileHide = null; paintPile();
    sfx.play('play');
    if (e.card.v === 'd2' || e.card.v === 'w4') sfx.play('plus', { delay: 0.05 });
    else if (e.card.v === 'w') sfx.play('wild', { delay: 0.05 });
    if (e.card.c === 'w') colorFlash(e.color);
  };
  if (e.by === me) {
    const src = document.querySelector(`#hand [data-cid="${e.card.id}"]`);
    const from = src ? centerOf(src) : handEndPt();
    if (src) src.classList.add('hid');
    fly({ card: e.card, pts: [{ x: from.x, y: from.y, s: from.w / pl.w }, { x: (from.x + pl.x) / 2, y: (from.y + pl.y) / 2 - 30, s: 1.25, r: rot / 2 }, { x: pl.x, y: pl.y, r: rot }], w: pl.w, dur: 380, onEnd: land });
  } else {
    const s = seatPt(e.by);
    fly({ card: null, pts: [{ x: s.x, y: s.y, s: 0.5 }, { x: (s.x + pl.x) / 2, y: (s.y + pl.y) / 2, s: 1.3, r: rot / 2 }, { x: pl.x, y: pl.y, r: rot }], w: pl.w, dur: 480, flipTo: e.card, flipAt: 0.4, onEnd: land });
  }
}

function animDraw(e) {
  const me = App.me;
  const d = deckPt();
  const n = e.n || 0;
  const penalty = e.reason && e.reason !== 'challenge' ? true : !!e.reason;
  if (penalty && n) setTimeout(() => burst(seatPt(e.by), '+' + n, 'bad'), 250);
  if (e.by === me) {
    if (penalty) vibrate([120, 60, 120]);
    (e.cards || []).forEach((c, i) => {
      App.hidden.add(c.id);
      setTimeout(() => sfx.play('draw'), 300 + i * 160);
      const end = handEndPt();
      fly({ pts: [{ x: d.x, y: d.y, s: d.w / end.w }, { x: innerWidth / 2, y: innerHeight * 0.5, s: 1.35 }, { x: end.x, y: end.y, s: 1 }], w: end.w, dur: 560, delay: 250 + i * 160, flipTo: c, flipAt: 0.45,
        onEnd: () => { App.hidden.delete(c.id); paintHand(); } });
    });
    paintHand();
  } else {
    const s = seatPt(e.by);
    for (let i = 0; i < n; i++) {
      if (i < 4) setTimeout(() => sfx.play('draw'), 250 + i * 120);
      fly({ pts: [{ x: d.x, y: d.y }, { x: s.x, y: s.y, s: 0.5, r: 25 }], w: d.w, dur: 380, delay: 250 + i * 120, onEnd: () => popSeat(e.by) });
    }
  }
}

function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ms-MY'; u.rate = 1.1; u.pitch = 1.3; u.volume = 1;
    speechSynthesis.speak(u);
  } catch (_) {}
}

// ======================================================================
// RENDER
// ======================================================================
function setScreen(name, data = {}) { App.screen = name; App.screenData = data; render(); }

const GLYPH = { s: '⊘', r: '⇄', d2: '+2', w: '', w4: '+4' };
function cardHTML(c, cls = '') {
  if (!c) return `<div class="card back ${cls}"><div class="in"></div><span class="logo">SATU!</span></div>`;
  const g = GLYPH[c.v] ?? c.v;
  const ul = c.v === '6' || c.v === '9' ? 'ul' : '';
  const corner = c.v === 'w' ? '★' : g;
  return `<div class="card c-${c.c} ${cls}" data-cid="${c.id}"><div class="in"></div>`
    + `<span class="corner tl ${ul}">${corner}</span><span class="mid ${/^\d$/.test(c.v) ? '' : 'sym'} ${ul}">${g}</span><span class="corner br ${ul}">${corner}</span></div>`;
}
const sortHand = (h) => h.slice().sort((a, b) => COLOR_ORDER[a.c] - COLOR_ORDER[b.c] || VAL_ORDER(a.v) - VAL_ORDER(b.v) || a.id - b.id);

function render() {
  const el = $('#screen');
  const handScroll = $('#hand')?.scrollLeft;
  let html = '';
  if (App.screen === 'connecting') html = rConnecting();
  else if (App.screen === 'game' && App.view) html = rGame(App.view);
  else html = rHome();
  el.innerHTML = html;
  if (handScroll != null && $('#hand')) $('#hand').scrollLeft = handScroll;
  if ($('#qr')) drawQR();
}

function rHome() {
  const pr = App.profile;
  const code = App.screenData.code || '';
  const saved = store.get('host');
  const last = store.get('last');
  const canResume = saved && Date.now() - saved.savedAt < 6 * 3600e3 && saved.state && saved.state.phase !== 'lobby';
  const canRejoin = last && !last.host && Date.now() - last.at < 6 * 3600e3 && store.get('id_' + last.code);
  const fan = [{ c: 'r', v: '7' }, { c: 'y', v: 's' }, { c: 'w', v: 'w4' }, { c: 'g', v: 'r' }, { c: 'b', v: 'd2' }];
  return `<div class="home scroll">
    <div class="logo-wrap">
      <div class="logo-fan">${fan.map((c, i) => cardHTML({ id: 900 + i, ...c }).replace('class="card', `style="transform:translateX(-50%) rotate(${(i - 2) * 16}deg);animation-delay:${i * 70}ms" class="card`)).join('')}</div>
      <div class="logo-title">SATU!</div>
      <div class="tagline">Every phone is a hand. The host deals. Shout SATU! on your last card.</div>
    </div>
    ${canResume ? `<button class="btn primary block big" data-act="resumeHost">▶ Resume hosting ${esc(saved.code)}</button>` : ''}
    ${canRejoin && !code ? `<button class="btn blue block" data-act="rejoin">↩ Rejoin table ${esc(last.code)}</button>` : ''}
    <div class="panel">
      <h3>You</h3>
      <input id="nameIn" class="field" maxlength="16" placeholder="Your name" value="${esc(pr.name)}" autocomplete="off">
      <div class="emojis">${EMOJIS.map((e) => `<button data-act="emoji" data-e="${e}" class="${e === pr.emoji ? 'on' : ''}">${e}</button>`).join('')}</div>
    </div>
    ${code ? `
    <div class="panel">
      <h3>Join table</h3>
      <input id="codeIn" class="field code-field" maxlength="5" value="${esc(code)}" autocomplete="off" inputmode="latin" spellcheck="false">
      <button class="btn primary block big" data-act="doJoin">🃏 Join table</button>
      <button class="btn ghost block" data-act="hostInstead">Host a new table instead</button>
    </div>` : `
    <button class="btn primary block big" data-act="doCreate" style="margin-top:16px">👑 Host a table</button>
    <div class="panel">
      <h3>Join a table</h3>
      <div class="row"><input id="codeIn" class="field code-field" maxlength="5" placeholder="CODE" autocomplete="off" spellcheck="false"><button class="btn blue" style="flex:0 0 auto" data-act="doJoin">Join</button></div>
      <div class="small" style="margin-top:8px">Or scan the QR code on the host's phone.</div>
    </div>`}
    <div class="row" style="margin-top:12px"><button class="btn ghost" data-act="rules">📖 Rules</button><button class="btn ghost" data-act="testSound">🔊 Test sound</button></div>
    <div class="made">Made by mnm <span class="beta">BETA</span></div>
  </div>`;
}

function rConnecting() {
  return `<div class="connecting"><div class="spinner"></div><div class="brand" style="font-size:20px">${esc(App.screenData.msg || 'Connecting…')}</div>
    <button class="btn ghost" style="margin-top:22px" data-act="cancel">Cancel</button></div>`;
}

function topbar(v, sub) {
  return `<div class="topbar"><div class="t"><b class="brand">SATU!</b> <span class="small">· ${esc(v.code)}</span><div class="small">${sub}</div></div>
    <button class="iconbtn" data-act="mute">${sfx.muted ? '🔇' : '🔊'}</button><button class="iconbtn" data-act="menu">☰</button></div>`;
}

function rGame(v) {
  if (v.phase === 'lobby') return rLobby(v);
  if (v.phase === 'roundover' || v.phase === 'over') return rResults(v);
  return rTable(v);
}

function rLobby(v) {
  const host = App.mode === 'host';
  const s = v.settings;
  const enough = v.players.length >= v.minPlayers;
  return `<div class="game">${topbar(v, `${v.players.length}/${MAX_PLAYERS} at the table`)}
  <div class="scroll">
    <div class="panel codebox">
      <div class="lbl">TABLE CODE</div>
      <div class="code">${esc(v.code)}</div>
      <div id="qr"></div>
      <div class="row"><button class="btn blue" data-act="share">📤 Share link</button><button class="btn ghost" data-act="copy">📋 Copy</button></div>
    </div>
    <div class="panel"><h3>Players</h3><div class="plist">
      ${v.players.map((p) => `<div class="prow"><span class="dot ${p.online ? '' : 'off'}"></span><div class="em">${esc(p.emoji)}</div><div class="nm">${esc(p.name)}${p.id === App.me ? ' (you)' : ''}</div>
        ${p.id === v.hostId ? '<span class="tag">HOST · DEALER</span>' : ''}${host && p.id !== v.hostId ? `<button class="x" data-act="kick" data-id="${esc(p.id)}">✕</button>` : ''}</div>`).join('')}
    </div>${DEV && host ? '<button class="btn ghost block sm" data-act="addBot">+ Add bot</button>' : ''}</div>
    <div class="panel"><h3>Settings</h3>
      <div class="setrow"><span class="k">Play to</span><div class="chips">${TARGETS.map((t) => `<span class="chip ${s.target === t ? 'on' : ''} ${host ? '' : 'disabled'}" data-act="target" data-v="${t}">${t ? t + ' pts' : '1 round'}</span>`).join('')}</div></div>
      <div class="setrow"><span class="k">Cards each</span><div class="chips">${HAND_SIZES.map((n) => `<span class="chip ${s.handSize === n ? 'on' : ''} ${host ? '' : 'disabled'}" data-act="handSize" data-v="${n}">${n}</span>`).join('')}</div></div>
    </div>
  </div>
  <div class="sticky-bottom">${host
    ? `<button class="btn primary block big" data-act="start" ${enough ? '' : 'disabled'}>🃏 Shuffle & deal</button>${enough ? '' : `<div class="small center-t" style="margin-top:6px">Waiting for at least ${v.minPlayers} players…</div>`}`
    : '<div class="center-t small" style="padding:12px">Waiting for the host to deal… 🃏</div>'}</div>
  </div>`;
}

function dirSVG() {
  return `<svg viewBox="0 0 100 100"><defs><marker id="ah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#fff"/></marker></defs>
    <path d="M50 4 A46 46 0 0 0 4 50" fill="none" stroke="#fff" stroke-width="2.5" marker-end="url(#ah)"/>
    <path d="M50 96 A46 46 0 0 0 96 50" fill="none" stroke="#fff" stroke-width="2.5" marker-end="url(#ah)"/></svg>`;
}

function seatsHTML(v) {
  const n = v.players.length;
  const mi = Math.max(0, v.players.findIndex((p) => p.id === App.me));
  const dealTo = v.dealing ? v.dealing.to : null;
  const turnId = v.pending && v.pending.type === 'challenge' ? v.pending.pid : v.turn;
  return v.players.map((p, k) => {
    const j = (k - mi + n) % n;
    const ang = Math.PI / 2 + (j * 2 * Math.PI) / n; // me at the bottom, play order runs clockwise
    const x = 50 + 43 * Math.cos(ang), y = 50 + 41 * Math.sin(ang);
    const cls = [p.id === turnId ? 'turn' : '', p.id === dealTo ? 'dealto' : '', p.online === false ? 'off' : '', v.vulnerable === p.id ? 'vuln' : ''].join(' ');
    return `<div class="seat ${cls}" data-seat="${esc(p.id)}" style="left:${x}%;top:${y}%">
      <div class="av">${esc(p.emoji)}</div><div class="nm">${esc(p.id === App.me ? 'You' : p.name)}</div><div class="cc">${p.count}</div>
      ${p.called && p.count <= 2 && p.count > 0 ? '<div class="satu-b">SATU!</div>' : ''}${p.id === v.dealer ? '<div class="dealer">D</div>' : ''}</div>`;
  }).join('');
}

function pileHTML(v) {
  if (!v.top) return '<div class="card" style="opacity:.15"></div>';
  const under = v.discardCount > 1 ? '<div class="card back under" style="filter:brightness(.6)"><div class="in"></div></div>' : '';
  const rot = ((v.top.id * 37) % 24) - 12;
  const cc = v.color ? COLOR_HEX[v.color] : 'transparent';
  return `${under}${cardHTML(v.top, App.pileHide === v.top.id ? 'invisible' : '').replace('class="card', `style="--rot:${rot}deg" class="card`)}<div class="colorring" style="--cc:${cc}"></div>`;
}

function rTable(v) {
  const host = App.mode === 'host';
  const dealing = v.phase === 'dealing';
  const canDeal = dealing && host;
  const sub = dealing ? `Round ${v.round} · dealing` : `Round ${v.round} · ${v.settings.target ? 'to ' + v.settings.target : 'single round'}`;
  return `<div class="game">${topbar(v, sub)}
    <div id="table" class="table">
      <div class="felt"></div>
      <div class="dirring ${v.dir < 0 ? 'ccw' : ''}">${dirSVG()}</div>
      ${seatsHTML(v)}
      <div class="center">
        <div id="deck" class="deck ${canDeal ? 'can' : ''}" ${canDeal ? 'data-act="deal"' : ''}>
          ${v.deckCount > 2 ? cardHTML(null) : ''}${v.deckCount > 1 ? cardHTML(null) : ''}${v.deckCount > 0 ? cardHTML(null) : '<div class="card" style="opacity:.1"></div>'}
          <span class="cnt">${v.deckCount}</span>${canDeal ? '<div class="dealhint">TAP TO DEAL</div>' : ''}
        </div>
        ${dealing ? '' : `<div id="pile" class="pile">${pileHTML(v)}</div>`}
      </div>
    </div>
    ${statusHTML(v)}
    <div class="actions">${actionsHTML(v)}</div>
    <div class="hint">${hintText(v)}</div>
    <div id="hand" class="hand">${handInner(v)}</div>
  </div>`;
}

function statusHTML(v) {
  const pd = v.pending;
  const last = v.log.length ? v.log[v.log.length - 1].text : '';
  let main = '', me = false;
  if (v.phase === 'dealing') {
    const d = v.dealing;
    main = App.mode === 'host' ? `Deal to <b>${esc(nameOf(d.to))}</b> · ${d.left} left` : `🃏 Dealing… ${d ? d.left : ''} cards left`;
  } else if (pd && pd.type === 'challenge') {
    me = pd.pid === App.me;
    main = me ? 'Challenge the +4?' : `${esc(nameOf(pd.pid))} is deciding: challenge the +4?`;
  } else if (pd && pd.type === 'color') {
    me = pd.pid === App.me;
    main = me ? 'Pick the first colour' : `${esc(nameOf(pd.pid))} is picking the first colour`;
  } else if (v.turn === App.me) {
    me = true;
    main = pd && pd.type === 'drawn' ? 'Play the card you drew, or keep it' : 'Your turn!';
  } else if (v.turn) {
    main = `${esc(P(v.turn)?.emoji || '')} ${esc(nameOf(v.turn))}'s turn`;
  }
  return `<div class="status"><div class="main ${me ? 'me' : ''}">${main}</div><div class="last">${esc(last)}</div></div>`;
}

function actionsHTML(v) {
  const host = App.mode === 'host';
  const out = [];
  if (v.phase === 'dealing') {
    if (host) {
      const d = v.dealing;
      out.push(d.auto ? '<button class="btn" data-act="autoOff">⏸ Stop</button>' : '<button class="btn blue" data-act="autoOn">▶ Auto deal</button>');
      out.push(`<div class="chips">${[[700, 'Slow'], [420, 'Normal'], [220, 'Fast']].map(([sp, l]) => `<span class="chip ${d.speed === sp ? 'on' : ''}" data-act="speed" data-v="${sp}">${l}</span>`).join('')}</div>`);
    }
    return out.join('');
  }
  if (v.phase !== 'play') return '';
  const pd = v.pending;
  const myTurn = v.turn === App.me;
  const meP = P(App.me);
  if (myTurn && !pd) out.push('<button class="btn blue" data-act="draw">🂠 Draw</button>');
  if (myTurn && pd && pd.type === 'drawn' && pd.pid === App.me) out.push('<button class="btn" data-act="pass">✋ Keep it</button>');
  if (meP && v.me.hand.length <= 2 && v.me.hand.length > 0 && !meP.called) out.push(`<button class="btn satu ${v.me.hand.length === 2 && myTurn ? 'pulse' : ''}" data-act="shout">SATU!</button>`);
  if (v.vulnerable && v.vulnerable !== App.me) out.push(`<button class="btn catch pulse" data-act="catch">🚨 Catch ${esc(nameOf(v.vulnerable))}!</button>`);
  if (pd && pd.type === 'challenge' && pd.pid === App.me && App.modalKind !== 'challenge') out.push('<button class="btn primary" data-act="openChallenge">Decide on +4</button>');
  if (pd && pd.type === 'color' && pd.pid === App.me && App.modalKind !== 'color') out.push('<button class="btn primary" data-act="openColor">Pick colour</button>');
  return out.join('');
}

function hintText(v) {
  if (v.phase !== 'play' || v.turn !== App.me || v.pending) return v.phase === 'play' && v.color ? `Colour in play: ${COLOR_NAME[v.color]}` : '';
  if (App.ui.sel != null) return 'Tap the card again to play it';
  const any = v.me.hand.some((c) => canPlay(c, v.top, v.color));
  return any ? `Match ${COLOR_NAME[v.color] || ''} or ${GLYPH[v.top.v] ? cardName(v.top).replace(/^\w+ /, '') : v.top.v} · tap a card` : 'No match. Draw a card';
}

function handInner(v) {
  const myTurn = v.phase === 'play' && v.turn === App.me && !v.pending;
  const pd = v.pending;
  const drawnOnly = pd && pd.type === 'drawn' && pd.pid === App.me ? pd.card : null;
  const hand = sortHand(v.me.hand);
  if (!hand.length) return `<div class="empty">${v.phase === 'dealing' ? 'Your cards will fly in here…' : 'No cards'}</div>`;
  return hand.map((c) => {
    const ok = drawnOnly != null ? c.id === drawnOnly : myTurn && canPlay(c, v.top, v.color);
    const cls = [ok ? 'ok' : '', App.ui.sel === c.id ? 'sel' : '', App.hidden.has(c.id) ? 'hid' : ''].join(' ');
    return cardHTML(c, cls).replace('class="card', `data-act="card" data-id="${c.id}" class="card`);
  }).join('');
}
function paintHand() {
  const h = $('#hand');
  const v = App.view;
  if (!h || !v) return;
  const sc = h.scrollLeft;
  h.innerHTML = handInner(v);
  const myTurn = v.phase === 'play' && v.turn === App.me && (!v.pending || (v.pending.type === 'drawn' && v.pending.pid === App.me));
  h.classList.toggle('myturn', !!myTurn);
  h.classList.toggle('many', v.me.hand.length > 12);
  h.scrollLeft = sc;
  const hint = $('.hint');
  if (hint) hint.textContent = hintText(v);
}
function paintPile() {
  const p = $('#pile');
  if (p && App.view) p.innerHTML = pileHTML(App.view);
}

function rResults(v) {
  const host = App.mode === 'host';
  const over = v.phase === 'over';
  const lr = v.lastRound;
  const winId = over ? v.champion : v.winner;
  const w = P(winId);
  const target = v.settings.target;
  const ranked = [...v.players].sort((a, b) => b.score - a.score);
  const handOf = (id) => (lr ? lr.hands.find((h) => h.id === id) : null);
  return `<div class="game">${topbar(v, over ? 'Game over' : `Round ${v.round} finished`)}
    <div class="scroll">
      <div class="winner"><div class="big">${esc(w?.emoji || '🏆')}</div>
        <h2>${esc(winId === App.me ? 'You win' : (w?.name || '') + ' wins')}${over ? ' the game!' : ' the round!'}</h2>
        <div class="small">${lr && !over ? `+${lr.pts} points from everyone's leftover cards` : over && target ? `First to ${target} points` : lr ? `+${lr.pts} points` : ''}</div></div>
      ${ranked.map((p) => {
        const h = handOf(p.id);
        return `<div class="res ${p.id === winId ? 'win' : ''}"><div class="em">${esc(p.emoji)}</div><div class="info"><b>${esc(p.id === App.me ? 'You' : p.name)}</b>
          ${h && h.cards.length ? `<div class="cards">${sortHand(h.cards).map((c) => cardHTML(c, 'tiny')).join('')}</div><div class="small">${h.pts} pts in hand</div>` : h ? '<div class="small">Out of cards 🎉</div>' : ''}
          ${target ? `<div class="bar"><i style="width:${Math.min(100, (p.score / target) * 100)}%"></i></div>` : ''}</div>
          <div class="sc">${p.score}<small>points</small></div></div>`;
      }).join('')}
    </div>
    <div class="sticky-bottom">${host
      ? (over ? '<button class="btn primary block big" data-act="start">🔁 Play again</button><button class="btn ghost block" data-act="toLobby">Back to lobby (let people join)</button>'
        : '<button class="btn primary block big" data-act="start">🃏 Next round: shuffle & deal</button>')
      : `<div class="center-t small" style="padding:12px">${over ? 'Waiting for the host…' : 'Waiting for the host to deal the next round…'}</div>`}</div>
  </div>`;
}

// ---------- sheets ----------
function openModal(html, kind = 'info') {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet">${html}</div>`;
  m.classList.add('on');
  App.modalKind = kind;
}
function closeModal() {
  const m = $('#modal');
  m.classList.remove('on'); m.innerHTML = '';
  App.modalKind = null;
}
function colorSheet(cardId, first = false) {
  const v = App.view;
  const cnt = { r: 0, y: 0, g: 0, b: 0 };
  v.me.hand.forEach((c) => { if (c.c !== 'w' && c.id !== cardId) cnt[c.c]++; });
  const best = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
  openModal(`<div class="title">${first ? 'Pick the first colour' : 'Pick a colour'}</div><div class="sub">${first ? 'The first card is a Wild. You choose the colour, then you play.' : '★ = the colour you hold most of'}</div>
    <div class="colors">${COLORS.map((c) => `<button style="background:${COLOR_HEX[c]}" class="${c === best && cnt[c] ? 'mine' : ''}" data-act="${first ? 'firstColor' : 'playWild'}" data-c="${c}" data-id="${cardId ?? ''}">${COLOR_NAME[c]}</button>`).join('')}</div>
    ${first ? '' : '<button class="btn ghost block" data-act="closeModal">Cancel</button>'}`, first ? 'color' : 'wild');
}
function challengeSheet(v) {
  const by = v.pending.by;
  openModal(`<div class="title">${esc(nameOf(by))} played Wild +4 on you!</div>
    <div class="sub">A Wild +4 is only allowed when the player has no card of the colour that was in play.<br>
    <b>Accept</b>: draw 4 and miss your turn.<br><b>Challenge</b>: if they cheated, they draw 4 instead. If they didn't, you draw 6 and miss your turn.</div>
    <button class="btn primary block big" data-act="accept4">😩 Accept, draw 4</button>
    <button class="btn block big" style="background:#e0115f" data-act="challenge4">⚖️ Challenge!</button>`, 'challenge');
}
function rulesHTML() {
  return `<div class="title">How to play SATU!</div><div class="rules">
    <h4>Setup</h4><ul><li>One phone hosts and deals. Everyone else scans the QR code or types the code.</li><li>The host taps the deck to deal one card at a time around the table (or uses Auto deal). Everyone gets 7 cards.</li><li>The top card of the deck starts the pile.</li></ul>
    <h4>Your turn</h4><ul><li>Play a card that matches the pile by <b>colour</b>, <b>number</b> or <b>symbol</b>, or play a <b>Wild</b>.</li><li>Can't (or don't want to) play? <b>Draw</b> one card. If it matches you may play it right away, otherwise your turn ends.</li></ul>
    <h4>Action cards</h4><ul><li><b>⊘ Skip</b>: the next player misses a turn.</li><li><b>⇄ Reverse</b>: the direction flips. With 2 players it works like Skip.</li><li><b>+2</b>: the next player draws 2 and misses a turn.</li><li><b>Wild</b>: choose the colour.</li><li><b>Wild +4</b>: choose the colour, the next player draws 4 and misses a turn. Only allowed if you have no card of the current colour. The next player may <b>challenge</b>: if you cheated you draw 4, if not they draw 6.</li></ul>
    <h4>SATU!</h4><ul><li>When you're down to your last card, tap <b>SATU!</b> (before or right after playing your second-last card).</li><li>Forget, and anyone can tap <b>Catch</b> before the next player moves: you draw 2.</li></ul>
    <h4>Scoring</h4><ul><li>First player out of cards wins the round and scores everyone's leftover cards: numbers = face value, Skip / Reverse / +2 = 20, Wilds = 50.</li><li>First to the target (200 or 500) wins, or play a single round.</li></ul>
    <h4>First card</h4><ul><li>Skip: the first player is skipped. Reverse: the dealer starts and play goes the other way. +2: the first player draws 2 and is skipped. Wild: the first player chooses the colour. A Wild +4 is put back.</li></ul>
    </div><button class="btn primary block" data-act="closeModal">Got it</button>`;
}
function menuSheet() {
  const v = App.view;
  const host = App.mode === 'host';
  const inGame = v && (v.phase === 'play' || v.phase === 'dealing');
  const cur = v && v.phase === 'play' ? (v.pending && (v.pending.type === 'challenge' || v.pending.type === 'color') ? v.pending.pid : v.turn) : null;
  openModal(`<div class="title">Menu</div><div class="menu-list">
    <button class="btn block" data-act="rules">📖 Rules</button>
    <button class="btn block" data-act="testSound">🔊 Test sound</button>
    ${host && v && v.phase !== 'lobby' ? `<button class="btn block" data-act="share">📤 Invite link</button>` : ''}
    ${host && cur && cur !== App.me ? `<button class="btn block" data-act="skipTurn">⏭ Skip ${esc(nameOf(cur))}'s turn (draws 1)</button>` : ''}
    ${host && inGame ? '<button class="btn block" data-act="endGame">🏁 End game now</button>' : ''}
    ${host ? '<button class="btn block" style="color:#ff8a8a" data-act="closeTable">✖ Close table for everyone</button>' : '<button class="btn block" style="color:#ff8a8a" data-act="leave">🚪 Leave table</button>'}
    <button class="btn ghost block" data-act="closeModal">Close</button></div>`);
}

function drawQR() {
  const el = $('#qr');
  if (!el || !window.qrcode) return;
  try {
    const q = window.qrcode(0, 'M');
    q.addData(inviteLink());
    q.make();
    el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch (_) { el.remove(); }
}
function inviteLink() {
  const b = App.bus ? App.bus.brokerIdx : 0;
  return `${location.origin}${location.pathname}?join=${App.code}${b ? '&b=' + b : ''}`;
}

function readProfile() {
  const n = ($('#nameIn')?.value || '').trim().slice(0, 16);
  if (n) App.profile.name = n;
  store.set('profile', App.profile);
  return n;
}

// ======================================================================
// input
// ======================================================================
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const a = t.dataset.act;
  const v = App.view;
  if (!['card', 'deal', 'closeModal'].includes(a)) sfx.play('click');
  switch (a) {
    case 'emoji': App.profile.emoji = t.dataset.e; readProfile(); document.querySelectorAll('.emojis button').forEach((b) => b.classList.toggle('on', b.dataset.e === t.dataset.e)); break;
    case 'hostInstead': readProfile(); setScreen('home', {}); break;
    case 'doCreate':
    case 'doJoin': {
      sfx.unlock(); keepAwake();
      const name = readProfile();
      if (!name) { toast('Enter your name first.'); $('#nameIn')?.focus(); return; }
      if (a === 'doJoin') {
        const code = ($('#codeIn')?.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (code.length !== 5) { toast('Table codes have 5 characters.'); $('#codeIn')?.focus(); return; }
        try { await clientJoin(code, params.get('b') != null && params.get('join') === code ? Number(params.get('b')) : null); }
        catch (err) { console.error(err); toast('Could not connect. Check your internet and try again.'); teardown(); }
      } else {
        setScreen('connecting', { msg: 'Setting up the table…' });
        try { await hostCreate(); } catch (err) { console.error(err); toast('Could not connect. Check your internet and try again.'); teardown(); }
      }
      break;
    }
    case 'resumeHost': {
      sfx.unlock();
      const saved = store.get('host');
      setScreen('connecting', { msg: 'Reopening your table…' });
      try { await hostResume(saved); } catch (err) { console.error(err); toast('Could not reconnect.'); teardown(); }
      break;
    }
    case 'rejoin': {
      sfx.unlock();
      const last = store.get('last');
      readProfile();
      try { await clientJoin(last.code, last.broker ?? null); } catch (_) { toast('Could not connect.'); teardown(); }
      break;
    }
    case 'cancel': teardown(); break;
    case 'rules': closeModal(); openModal(rulesHTML()); break;
    case 'closeModal': closeModal(); if (v) render(); break;
    case 'mute': sfx.setMuted(!sfx.muted); render(); break;
    case 'testSound': testSound(); break;
    case 'menu': menuSheet(); break;
    case 'share': {
      const link = inviteLink();
      if (navigator.share) { try { await navigator.share({ title: 'SATU!', text: `Join my SATU! table, code ${App.code}`, url: link }); } catch (_) {} }
      else { navigator.clipboard?.writeText(link); toast('Invite link copied.'); }
      break;
    }
    case 'copy': navigator.clipboard?.writeText(inviteLink()).then(() => toast('Invite link copied.'), () => toast(inviteLink())); break;
    case 'kick': act({ type: 'kick', target: t.dataset.id }); break;
    case 'addBot': addBot(); break;
    case 'target': act({ type: 'settings', patch: { target: Number(t.dataset.v) } }); break;
    case 'handSize': act({ type: 'settings', patch: { handSize: Number(t.dataset.v) } }); break;
    case 'start': act({ type: 'start' }); break;
    case 'toLobby': act({ type: 'lobby' }); break;
    case 'deal': act({ type: 'deal' }); break;
    case 'autoOn': act({ type: 'auto', on: true, speed: v.dealing?.speed }); break;
    case 'autoOff': act({ type: 'auto', on: false }); break;
    case 'speed': act({ type: 'auto', on: !!v.dealing?.auto, speed: Number(t.dataset.v) }); break;
    case 'card': {
      if (!v || v.phase !== 'play') return;
      const id = Number(t.dataset.id);
      const card = v.me.hand.find((c) => c.id === id);
      if (!card) return;
      const pd = v.pending;
      if (v.turn !== App.me || (pd && !(pd.type === 'drawn' && pd.pid === App.me))) { toast('Wait for your turn.', 1400); return; }
      if (pd && pd.type === 'drawn' && id !== pd.card) { toast('You can only play the card you just drew, or keep it.'); return; }
      if (!canPlay(card, v.top, v.color)) {
        sfx.play('error');
        t.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 220 });
        return;
      }
      if (App.ui.sel !== id) { App.ui.sel = id; sfx.play('click'); paintHand(); return; }
      App.ui.sel = null;
      if (card.c === 'w') colorSheet(card.id);
      else act({ type: 'play', card: id });
      break;
    }
    case 'playWild': closeModal(); act({ type: 'play', card: Number(t.dataset.id), color: t.dataset.c }); break;
    case 'firstColor': closeModal(); act({ type: 'color', color: t.dataset.c }); break;
    case 'openColor': colorSheet(null, true); break;
    case 'openChallenge': challengeSheet(v); break;
    case 'accept4': closeModal(); act({ type: 'challenge', yes: false }); break;
    case 'challenge4': closeModal(); act({ type: 'challenge', yes: true }); break;
    case 'draw': App.ui.sel = null; act({ type: 'draw' }); break;
    case 'pass': act({ type: 'pass' }); break;
    case 'shout': act({ type: 'shout' }); break;
    case 'catch': act({ type: 'catch' }); break;
    case 'skipTurn': closeModal(); act({ type: 'skipTurn' }); break;
    case 'endGame': if (confirm('End the game now?')) { closeModal(); act({ type: 'end' }); } break;
    case 'closeTable': if (confirm('Close this table for everyone?')) { closeModal(); closeTable(); } break;
    case 'leave':
      closeModal();
      if (v && v.phase === 'lobby') act({ type: 'leave' });
      store.del('last');
      setTimeout(teardown, 300);
      break;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.target.id === 'codeIn' || e.target.id === 'nameIn')) $('[data-act="doJoin"]')?.click() || (App.screenData.code ? null : null);
  if (e.key === 'Escape' && App.modalKind !== 'color' && App.modalKind !== 'challenge') closeModal();
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'codeIn') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (e.target.id === 'nameIn') { App.profile.name = e.target.value.trim().slice(0, 16); store.set('profile', App.profile); }
});
// the hand keeps its "my turn" look after every full render
new MutationObserver(() => {
  const h = $('#hand'), v = App.view;
  if (!h || !v) return;
  const myTurn = v.phase === 'play' && v.turn === App.me && (!v.pending || (v.pending.type === 'drawn' && v.pending.pid === App.me));
  h.classList.toggle('myturn', !!myTurn);
  h.classList.toggle('many', v.me.hand.length > 12);
}).observe($('#screen'), { childList: true });

// ======================================================================
// start
// ======================================================================
function route() {
  const join = (params.get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (join.length === 5) {
    const last = store.get('last');
    if (last && last.code === join && !last.host && store.get('id_' + join) && App.profile.name) {
      clientJoin(join, params.get('b') != null ? Number(params.get('b')) : last.broker ?? null).catch(() => teardown());
      return;
    }
    setScreen('home', { code: join });
    return;
  }
  setScreen('home');
}
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => reg.update()).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    if (!App.mode || (App.view && ['lobby', 'over'].includes(App.view.phase))) { reloaded = true; location.reload(); }
  });
}
route();

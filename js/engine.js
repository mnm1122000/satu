// SATU! — game engine. Pure rules, runs only on the host phone.
// Classic shedding-card rules: 108 cards, match colour / number / symbol,
// Skip, Reverse, Draw Two, Wild, Wild Draw Four (with challenge), call "SATU!"
// on your last card, first to 500 points wins (or a single round).

export const COLORS = ['r', 'y', 'g', 'b'];
export const COLOR_NAME = { r: 'Red', y: 'Yellow', g: 'Green', b: 'Blue', w: 'Wild' };
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const TARGETS = [0, 200, 500];
export const HAND_SIZES = [5, 7, 10];
export const CATCH_GRACE = 4000; // ms a player gets to say SATU! before they can be caught

export function buildDeck() {
  const d = [];
  let id = 0;
  for (const c of COLORS) {
    d.push({ id: id++, c, v: '0' });
    for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 's', 'r', 'd2']) {
      d.push({ id: id++, c, v });
      d.push({ id: id++, c, v });
    }
  }
  for (let i = 0; i < 4; i++) d.push({ id: id++, c: 'w', v: 'w' });
  for (let i = 0; i < 4; i++) d.push({ id: id++, c: 'w', v: 'w4' });
  return d;
}

function rand(n) {
  if (globalThis.crypto && crypto.getRandomValues) {
    const u = new Uint32Array(1);
    crypto.getRandomValues(u);
    return u[0] % n;
  }
  return Math.floor(Math.random() * n);
}
export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const points = (c) => (c.c === 'w' ? 50 : /^\d$/.test(c.v) ? Number(c.v) : 20);
export const canPlay = (card, top, color) => card.c === 'w' || card.c === color || (!!top && card.v === top.v);
const VAL_NAME = { s: 'Skip', r: 'Reverse', d2: '+2', w: 'Wild', w4: 'Wild +4' };
export function cardName(c) {
  if (!c) return '';
  if (c.c === 'w') return VAL_NAME[c.v];
  return `${COLOR_NAME[c.c]} ${VAL_NAME[c.v] || c.v}`;
}
const clean = (s) => String(s || '').replace(/[<>]/g, '').trim().slice(0, 16);

export class Game {
  constructor(s) { this.s = s; this.events = []; }

  static create(code, host, opts = {}) {
    const s = {
      v: 1, code, hostId: host.id, phase: 'lobby', round: 0,
      settings: { target: 500, handSize: 7 },
      minPlayers: opts.minPlayers ?? MIN_PLAYERS,
      players: [], deck: [], discard: [], color: null, dir: 1, turn: 0, dealer: -1,
      deal: null, pending: null, vulnerable: null, log: [], winner: null, champion: null, lastRound: null,
    };
    const g = new Game(s);
    g.addPlayer(host);
    return g;
  }

  // ---------- helpers ----------
  p(id) { return this.s.players.find((p) => p.id === id); }
  idx(id) { return this.s.players.findIndex((p) => p.id === id); }
  get top() { return this.s.discard[this.s.discard.length - 1] || null; }
  cur() { return this.s.players[this.s.turn]; }
  next(k = 1, from = this.s.turn) {
    const n = this.s.players.length;
    return (((from + this.s.dir * k) % n) + n) % n;
  }
  emit(e) { this.events.push(e); }
  drainEvents() { const e = this.events; this.events = []; return e; }
  log(text) {
    this.s.log.push({ t: Date.now(), text });
    if (this.s.log.length > 30) this.s.log.shift();
  }

  addPlayer({ id, name, emoji, bot }) {
    const s = this.s;
    const ex = this.p(id);
    if (ex) {
      if (clean(name)) ex.name = clean(name);
      if (emoji) ex.emoji = String(emoji).slice(0, 8);
      return { ok: true, rejoin: true };
    }
    if (s.phase !== 'lobby') return { ok: false, error: 'This game has already started. Wait for the next one.' };
    if (s.players.length >= MAX_PLAYERS) return { ok: false, error: `The table is full (${MAX_PLAYERS} players).` };
    let nm = clean(name) || 'Player';
    const base = nm;
    for (let i = 2; s.players.some((p) => p.name.toLowerCase() === nm.toLowerCase()); i++) nm = `${base} ${i}`;
    s.players.push({ id, name: nm, emoji: String(emoji || '🙂').slice(0, 8), bot: !!bot, hand: [], score: 0, called: false });
    if (s.players.length > 1) this.log(`${nm} joined the table`);
    return { ok: true };
  }

  removePlayer(id) {
    const s = this.s;
    if (s.phase !== 'lobby' || id === s.hostId) return false;
    const i = this.idx(id);
    if (i < 0) return false;
    s.players.splice(i, 1);
    return true;
  }

  drawCards(p, n) {
    const s = this.s;
    const got = [];
    for (let i = 0; i < n; i++) {
      if (!s.deck.length) this.recycle();
      if (!s.deck.length) break;
      const c = s.deck.pop();
      p.hand.push(c);
      got.push(c);
    }
    if (p.hand.length > 1) p.called = false;
    if (s.vulnerable === p.id) s.vulnerable = null;
    return got;
  }

  recycle() {
    const s = this.s;
    if (s.discard.length < 2) return;
    const top = s.discard.pop();
    s.deck = shuffle(s.discard);
    s.discard = [top];
    this.emit({ type: 'shuffle', small: true });
    this.log('Discard pile reshuffled into a new draw pile');
  }

  // ---------- round flow ----------
  startRound() {
    const s = this.s;
    const n = s.players.length;
    s.round++;
    s.dealer = (s.dealer + 1) % n;
    s.deck = shuffle(buildDeck());
    s.discard = []; s.color = null; s.dir = 1; s.turn = (s.dealer + 1) % n;
    s.pending = null; s.vulnerable = null; s.winner = null; s.lastRound = null;
    for (const p of s.players) { p.hand = []; p.called = false; }
    s.phase = 'dealing';
    s.deal = { left: s.settings.handSize * n, total: s.settings.handSize * n, pos: (s.dealer + 1) % n, at: 0, auto: false, speed: 420, mode: s.dealMode || 'round' };
    this.emit({ type: 'shuffle' });
    this.log(`Round ${s.round}: ${s.players[s.dealer].name} shuffles the deck`);
  }

  // next player (from index i, inclusive) who still needs cards
  needy(i) {
    const s = this.s, n = s.players.length;
    for (let k = 0; k < n; k++) {
      const j = (i + k) % n;
      if (s.players[j].hand.length < s.settings.handSize) return j;
    }
    return -1;
  }

  // mode 'round': one card each, round the table. mode 'phone': keep dealing to the chosen
  // player (phones head to head) until their hand is full, then move to the next one.
  dealOne(now) {
    const s = this.s;
    if (s.phase !== 'dealing' || !s.deal) return false;
    if (now - s.deal.at < 120) return false;
    const pi = this.needy(s.deal.pos);
    if (pi < 0) { this.flipStart(); return true; }
    const p = s.players[pi];
    const card = s.deck.pop();
    p.hand.push(card);
    s.deal.left--;
    s.deal.at = now;
    this.emit({ type: 'deal', to: p.id, card, left: s.deal.left, n: p.hand.length, deck: s.deck.length });
    if (s.deal.left <= 0) { this.flipStart(); return true; }
    s.deal.pos = this.needy(s.deal.mode === 'phone' ? pi : (pi + 1) % s.players.length);
    return true;
  }

  // skip the animation: everyone gets the rest of their cards at once
  dealAll() {
    const s = this.s;
    if (s.phase !== 'dealing' || !s.deal) return false;
    for (const p of s.players) {
      while (p.hand.length < s.settings.handSize && s.deck.length) { p.hand.push(s.deck.pop()); s.deal.left--; }
    }
    this.emit({ type: 'dealAll', counts: s.players.map((p) => p.hand.length), deck: s.deck.length });
    this.log('The host dealt everyone in one go');
    this.flipStart();
    return true;
  }

  flipStart() {
    const s = this.s;
    const n = s.players.length;
    let c;
    for (;;) {
      c = s.deck.pop();
      if (c.v !== 'w4') break;
      s.deck.splice(rand(s.deck.length + 1), 0, c); // a Wild +4 can't start the pile
    }
    s.discard = [c];
    s.color = c.c === 'w' ? null : c.c;
    s.phase = 'play';
    s.deal = null;
    const first = (s.dealer + 1) % n;
    s.turn = first;
    this.emit({ type: 'flip', card: c });
    this.log(`First card: ${cardName(c)}`);
    const fp = s.players[first];
    switch (c.v) {
      case 's':
        this.emit({ type: 'skip', target: fp.id });
        this.log(`${fp.name} is skipped`);
        s.turn = this.next(1, first);
        break;
      case 'r':
        s.dir = -1;
        this.emit({ type: 'reverse', dir: -1 });
        s.turn = s.dealer; // dealer plays first, direction reversed
        this.log(`Reverse! ${s.players[s.dealer].name} goes first`);
        break;
      case 'd2': {
        const got = this.drawCards(fp, 2);
        this.emit({ type: 'draw', by: fp.id, cards: got, n: got.length, count: this.p(fp.id).hand.length, deck: s.deck.length, reason: 'd2' });
        this.log(`${fp.name} draws 2 and is skipped`);
        s.turn = this.next(1, first);
        break;
      }
      case 'w':
        s.pending = { type: 'color', pid: fp.id };
        this.log(`${fp.name} chooses the first colour`);
        break;
      default:
    }
  }

  clearVuln(actor) {
    if (this.s.vulnerable && this.s.vulnerable !== actor) this.s.vulnerable = null;
  }

  endRound(pid) {
    const s = this.s;
    const w = this.p(pid);
    let pts = 0;
    for (const p of s.players) if (p.id !== pid) pts += p.hand.reduce((a, c) => a + points(c), 0);
    w.score += pts;
    s.winner = pid;
    s.vulnerable = null;
    s.pending = null;
    s.lastRound = { winner: pid, pts, hands: s.players.map((p) => ({ id: p.id, cards: p.hand.slice(), pts: p.hand.reduce((a, c) => a + points(c), 0) })) };
    this.emit({ type: 'round', winner: pid, pts });
    this.log(`${w.name} wins round ${s.round} (+${pts} points)`);
    const target = s.settings.target;
    if (!target || w.score >= target) {
      s.phase = 'over';
      s.champion = target ? [...s.players].sort((a, b) => b.score - a.score)[0].id : pid;
    } else {
      s.phase = 'roundover';
    }
  }

  // ---------- actions ----------
  handle(pid, a, now = Date.now()) {
    const s = this.s;
    const p = this.p(pid);
    if (!p || !a || typeof a.type !== 'string') return { ok: false };
    const host = pid === s.hostId;
    const err = (error) => ({ ok: false, error });
    const myTurn = s.phase === 'play' && this.cur() && this.cur().id === pid;

    switch (a.type) {
      case 'settings': {
        if (!host || s.phase !== 'lobby') return err('Only the host can change settings.');
        const pt = a.patch || {};
        if (TARGETS.includes(pt.target)) s.settings.target = pt.target;
        if (HAND_SIZES.includes(pt.handSize)) s.settings.handSize = pt.handSize;
        return { ok: true };
      }
      case 'profile':
        if (clean(a.name)) p.name = clean(a.name);
        if (a.emoji) p.emoji = String(a.emoji).slice(0, 8);
        return { ok: true };
      case 'kick':
        if (!host) return err('Only the host can remove players.');
        return { ok: this.removePlayer(a.target) };
      case 'leave':
        return { ok: this.removePlayer(pid) };
      case 'start': {
        if (!host) return err('Only the host can start.');
        if (s.phase === 'lobby' || s.phase === 'over') {
          if (s.players.length < s.minPlayers) return err(`Need at least ${s.minPlayers} players.`);
          if (s.phase === 'over') { for (const pl of s.players) pl.score = 0; s.round = 0; s.dealer = -1; s.champion = null; }
          this.startRound();
          return { ok: true };
        }
        if (s.phase === 'roundover') { this.startRound(); return { ok: true }; }
        return err('A round is already running.');
      }
      case 'lobby': {
        if (!host || s.phase !== 'over') return err('Not now.');
        s.phase = 'lobby';
        for (const pl of s.players) { pl.score = 0; pl.hand = []; pl.called = false; }
        s.round = 0; s.dealer = -1; s.champion = null; s.winner = null; s.lastRound = null; s.discard = []; s.deck = [];
        return { ok: true };
      }
      case 'deal':
        if (!host) return err('Only the host deals.');
        return { ok: this.dealOne(now) };
      case 'dealAll':
        if (!host) return err('Only the host deals.');
        return { ok: this.dealAll() };
      case 'dealTo': { // host picks who gets the next cards
        if (!host || s.phase !== 'dealing') return err('Not dealing.');
        const i = this.idx(a.target);
        if (i < 0) return err('Unknown player.');
        if (s.players[i].hand.length >= s.settings.handSize) return err(`${s.players[i].name} already has ${s.settings.handSize} cards.`);
        s.deal.pos = i;
        return { ok: true };
      }
      case 'dealMode':
        if (!host || s.phase !== 'dealing' || !['round', 'phone'].includes(a.mode)) return err('Not dealing.');
        s.deal.mode = s.dealMode = a.mode;
        if (a.mode === 'phone') s.deal.auto = false;
        return { ok: true };
      case 'auto':
        if (!host || s.phase !== 'dealing') return err('Not dealing.');
        s.deal.auto = !!a.on;
        if (a.on) s.deal.mode = s.dealMode = 'round';
        if ([220, 420, 700].includes(a.speed)) s.deal.speed = a.speed;
        return { ok: true };

      case 'color': {
        const pd = s.pending;
        if (!pd || pd.type !== 'color' || pd.pid !== pid) return err('Not your choice.');
        if (!COLORS.includes(a.color)) return err('Pick a colour.');
        s.color = a.color;
        s.pending = null;
        this.emit({ type: 'color', by: pid, color: a.color });
        this.log(`${p.name} chose ${COLOR_NAME[a.color]}`);
        return { ok: true };
      }

      case 'play': {
        if (!myTurn) return err('Not your turn.');
        const pd = s.pending;
        if (pd && !(pd.type === 'drawn' && pd.pid === pid)) return err('Waiting for a decision first.');
        const card = p.hand.find((c) => c.id === a.card);
        if (!card) return err('You don\'t have that card.');
        if (pd && card.id !== pd.card) return err('You can only play the card you just drew.');
        if (!canPlay(card, this.top, s.color)) return err('That card doesn\'t match.');
        if (card.c === 'w' && !COLORS.includes(a.color)) return err('Pick a colour.');
        this.clearVuln(pid);
        const prevColor = s.color;
        const illegal = card.v === 'w4' && p.hand.some((c) => c.id !== card.id && c.c === prevColor);
        p.hand.splice(p.hand.indexOf(card), 1);
        s.discard.push(card);
        s.pending = null;
        s.color = card.c === 'w' ? a.color : card.c;
        this.emit({ type: 'play', by: pid, card, color: s.color, left: p.hand.length });
        this.log(`${p.name} played ${cardName(card)}${card.c === 'w' ? ` → ${COLOR_NAME[s.color]}` : ''}`);
        if (p.hand.length === 1 && !p.called) { s.vulnerable = pid; s.vulnAt = now; }

        const n = s.players.length;
        if (p.hand.length === 0) {
          if (card.v === 'd2' || card.v === 'w4') { // the next player still draws before the round is scored
            const victim = s.players[this.next(1)];
            const k = card.v === 'd2' ? 2 : 4;
            const got = this.drawCards(victim, k);
            this.emit({ type: 'draw', by: victim.id, cards: got, n: got.length, count: this.p(victim.id).hand.length, deck: s.deck.length, reason: card.v });
          }
          this.endRound(pid);
          return { ok: true };
        }
        switch (card.v) {
          case 's': {
            const sk = s.players[this.next(1)];
            this.emit({ type: 'skip', target: sk.id });
            s.turn = this.next(2);
            break;
          }
          case 'r':
            s.dir *= -1;
            this.emit({ type: 'reverse', dir: s.dir });
            if (n === 2) { // with two players Reverse works like Skip: you go again
              this.emit({ type: 'skip', target: s.players[this.next(1)].id });
            } else s.turn = this.next(1);
            break;
          case 'd2': {
            const vi = this.next(1);
            const victim = s.players[vi];
            const got = this.drawCards(victim, 2);
            this.emit({ type: 'draw', by: victim.id, cards: got, n: got.length, count: this.p(victim.id).hand.length, deck: s.deck.length, reason: 'd2' });
            this.emit({ type: 'skip', target: victim.id, quiet: true });
            this.log(`${victim.name} draws 2 and is skipped`);
            s.turn = this.next(2);
            break;
          }
          case 'w4': {
            const vi = this.next(1);
            s.pending = { type: 'challenge', pid: s.players[vi].id, by: pid, illegal, prevColor };
            s.turn = vi;
            break;
          }
          default:
            s.turn = this.next(1);
        }
        return { ok: true };
      }

      case 'draw': {
        if (!myTurn) return err('Not your turn.');
        if (s.pending) return err(s.pending.type === 'drawn' ? 'Play the card you drew, or keep it.' : 'Waiting for a decision first.');
        this.clearVuln(pid);
        const got = this.drawCards(p, 1);
        this.emit({ type: 'draw', by: pid, cards: got, n: got.length, count: this.p(pid).hand.length, deck: s.deck.length });
        if (got.length && canPlay(got[0], this.top, s.color)) {
          s.pending = { type: 'drawn', pid, card: got[0].id };
          this.log(`${p.name} drew a card`);
        } else {
          this.log(`${p.name} drew a card and passed`);
          s.turn = this.next(1);
        }
        return { ok: true };
      }

      case 'pass': {
        const pd = s.pending;
        if (!myTurn || !pd || pd.type !== 'drawn' || pd.pid !== pid) return err('Draw a card first.');
        s.pending = null;
        this.log(`${p.name} kept the card`);
        s.turn = this.next(1);
        return { ok: true };
      }

      case 'challenge': {
        const pd = s.pending;
        if (!pd || pd.type !== 'challenge' || pd.pid !== pid) return err('Nothing to challenge.');
        const by = this.p(pd.by);
        s.pending = null;
        this.clearVuln(pid);
        if (!a.yes) {
          const got = this.drawCards(p, 4);
          this.emit({ type: 'draw', by: pid, cards: got, n: got.length, count: this.p(pid).hand.length, deck: s.deck.length, reason: 'w4' });
          this.emit({ type: 'skip', target: pid, quiet: true });
          this.log(`${p.name} draws 4 and is skipped`);
          s.turn = this.next(1);
        } else if (pd.illegal) {
          const got = this.drawCards(by, 4);
          this.emit({ type: 'challenge', by: pid, target: by.id, guilty: true });
          this.emit({ type: 'draw', by: by.id, cards: got, n: got.length, count: this.p(by.id).hand.length, deck: s.deck.length, reason: 'challenge' });
          this.log(`Challenge won! ${by.name} had a ${COLOR_NAME[pd.prevColor]} card and draws 4`);
          // the challenger takes their turn normally
        } else {
          const got = this.drawCards(p, 6);
          this.emit({ type: 'challenge', by: pid, target: by.id, guilty: false });
          this.emit({ type: 'draw', by: pid, cards: got, n: got.length, count: this.p(pid).hand.length, deck: s.deck.length, reason: 'challenge' });
          this.log(`Challenge failed! ${p.name} draws 6 and is skipped`);
          s.turn = this.next(1);
        }
        return { ok: true };
      }

      case 'shout': {
        if (s.phase !== 'play') return err('Not now.');
        if (p.hand.length > 2) return err('Only shout SATU! when you are down to your last cards.');
        if (p.called) return { ok: true };
        p.called = true;
        if (s.vulnerable === pid) s.vulnerable = null;
        this.emit({ type: 'shout', by: pid });
        this.log(`${p.name}: SATU!`);
        return { ok: true };
      }

      case 'catch': {
        const t = s.vulnerable && this.p(s.vulnerable);
        if (s.phase !== 'play' || !t || t.id === pid) return err('Too late!');
        if (now - (s.vulnAt || 0) < CATCH_GRACE) return err(`Give ${t.name} a second to say SATU!`);
        s.vulnerable = null;
        const got = this.drawCards(t, 2);
        this.emit({ type: 'catch', by: pid, target: t.id });
        this.emit({ type: 'draw', by: t.id, cards: got, n: got.length, count: this.p(t.id).hand.length, deck: s.deck.length, reason: 'catch' });
        this.log(`${p.name} caught ${t.name} without SATU! (+2)`);
        return { ok: true };
      }

      case 'skipTurn': { // host: move a stuck / disconnected player along
        if (!host || s.phase !== 'play') return err('Not now.');
        const c = this.cur();
        const pd = s.pending;
        if (pd && pd.type === 'color') return this.handle(pd.pid, { type: 'color', color: COLORS[rand(4)] }, now);
        if (pd && pd.type === 'challenge') return this.handle(pd.pid, { type: 'challenge', yes: false }, now);
        if (pd && pd.type === 'drawn') return this.handle(c.id, { type: 'pass' }, now);
        const got = this.drawCards(c, 1);
        this.emit({ type: 'draw', by: c.id, cards: got, n: got.length, count: this.p(c.id).hand.length, deck: s.deck.length });
        this.log(`Host skipped ${c.name}'s turn (drew 1)`);
        s.turn = this.next(1);
        return { ok: true };
      }

      case 'end':
        if (!host) return err('Only the host can end the game.');
        if (s.phase === 'lobby') return err('Not started.');
        s.phase = 'over';
        s.deal = null; s.pending = null; s.vulnerable = null;
        s.champion = [...s.players].sort((x, y) => y.score - x.score)[0].id;
        this.log('The host ended the game');
        return { ok: true };
      default:
        return err('Unknown action.');
    }
  }

  // auto-dealing runs on the host's clock
  tick(now) {
    const s = this.s;
    if (s.phase === 'dealing' && s.deal && s.deal.auto && now - s.deal.at >= s.deal.speed) return this.dealOne(now);
    return false;
  }

  viewFor(pid) {
    const s = this.s;
    const me = this.p(pid);
    if (!me) return null;
    const pd = s.pending;
    const showHands = s.phase === 'roundover' || s.phase === 'over';
    return {
      code: s.code, phase: s.phase, round: s.round, hostId: s.hostId, settings: s.settings, minPlayers: s.minPlayers,
      players: s.players.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, count: p.hand.length, score: p.score, called: p.called, bot: p.bot })),
      me: { id: pid, hand: me.hand },
      turn: s.phase === 'play' && s.players[s.turn] ? s.players[s.turn].id : null,
      dealer: s.players[s.dealer] ? s.players[s.dealer].id : null,
      dir: s.dir, color: s.color, top: this.top, deckCount: s.deck.length, discardCount: s.discard.length,
      dealing: s.deal ? { to: s.players[s.deal.pos] ? s.players[s.deal.pos].id : null, left: s.deal.left, total: s.deal.total, auto: s.deal.auto, speed: s.deal.speed, mode: s.deal.mode, need: s.players.map((p) => s.settings.handSize - p.hand.length) } : null,
      vulnAt: s.vulnAt || 0,
      pending: pd ? { type: pd.type, pid: pd.pid, by: pd.by, card: pd.pid === pid ? pd.card : undefined } : null,
      vulnerable: s.vulnerable,
      log: s.log.slice(-8),
      winner: s.winner, champion: s.champion,
      lastRound: showHands ? s.lastRound : null,
    };
  }
}

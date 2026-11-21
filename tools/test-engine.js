// node tools/test-engine.js — rule tests + random full-game simulations
import { Game, buildDeck, canPlay, COLORS } from '../js/engine.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };
const C = (c, v, id = Math.floor(Math.random() * 1e9)) => ({ id, c, v });

function setup(n = 3) {
  const g = Game.create('TEST1', { id: 'p0', name: 'Host' });
  for (let i = 1; i < n; i++) g.addPlayer({ id: 'p' + i, name: 'P' + i });
  g.handle('p0', { type: 'start' });
  let t = 0;
  while (g.s.phase === 'dealing') g.handle('p0', { type: 'deal' }, (t += 1000));
  g.drainEvents();
  return g;
}
// force a known position
function rig(g, { hands, top, color, turn = 0, dir = 1 }) {
  g.s.players.forEach((p, i) => { p.hand = hands[i] || []; p.called = false; });
  g.s.discard = [top]; g.s.color = color || top.c; g.s.turn = turn; g.s.dir = dir; g.s.pending = null; g.s.vulnerable = null;
}
const total = (g) => g.s.deck.length + g.s.discard.length + g.s.players.reduce((a, p) => a + p.hand.length, 0);

ok(buildDeck().length === 108, 'deck has 108 cards');
{
  const g = setup(4);
  ok(g.s.phase === 'play', 'dealing ends in play');
  ok(total(g) === 108, 'cards conserved after deal');
  ok(g.s.players.every((p) => p.hand.length >= 7), 'everyone has 7+');
}
ok(canPlay(C('r', '5'), C('b', '5'), 'b'), 'match number');
ok(canPlay(C('b', '1'), C('b', '5'), 'b'), 'match colour');
ok(!canPlay(C('r', '1'), C('b', '5'), 'b'), 'no match');
ok(canPlay(C('w', 'w4'), C('b', '5'), 'b'), 'wild always');
ok(canPlay(C('g', 's'), C('w', 'w'), 'g'), 'chosen colour after wild');

// skip
{
  const g = setup(3);
  rig(g, { hands: [[C('r', 's'), C('r', '1')], [C('b', '1')], [C('b', '2')]], top: C('r', '5') });
  g.handle('p0', { type: 'play', card: g.s.players[0].hand[0].id });
  ok(g.s.turn === 2, 'skip jumps a player');
}
// reverse 3p
{
  const g = setup(3);
  rig(g, { hands: [[C('r', 'r'), C('r', '1')], [C('b', '1')], [C('b', '2')]], top: C('r', '5') });
  g.handle('p0', { type: 'play', card: g.s.players[0].hand[0].id });
  ok(g.s.dir === -1 && g.s.turn === 2, 'reverse flips direction');
}
// reverse 2p = skip
{
  const g = setup(2);
  rig(g, { hands: [[C('r', 'r'), C('r', '1')], [C('b', '1')]], top: C('r', '5') });
  g.handle('p0', { type: 'play', card: g.s.players[0].hand[0].id });
  ok(g.s.turn === 0, 'reverse with 2 players = play again');
}
// draw two
{
  const g = setup(3);
  rig(g, { hands: [[C('r', 'd2'), C('r', '1')], [C('b', '1')], [C('b', '2')]], top: C('r', '5') });
  g.handle('p0', { type: 'play', card: g.s.players[0].hand[0].id });
  ok(g.s.players[1].hand.length === 3 && g.s.turn === 2, '+2 draws and skips');
}
// wild needs colour
{
  const g = setup(3);
  rig(g, { hands: [[C('w', 'w'), C('r', '1')], [C('b', '1')], [C('b', '2')]], top: C('r', '5') });
  ok(!g.handle('p0', { type: 'play', card: g.s.players[0].hand[0].id }).ok, 'wild without colour refused');
  g.handle('p0', { type: 'play', card: g.s.players[0].hand[0].id, color: 'g' });
  ok(g.s.color === 'g' && g.s.turn === 1, 'wild sets colour');
}
// +4 accept / challenge guilty / challenge innocent
for (const [mode, illegal] of [['accept', false], ['guilty', true], ['innocent', false]]) {
  const g = setup(3);
  const h0 = [C('w', 'w4'), illegal ? C('r', '9') : C('b', '9'), C('y', '1')];
  rig(g, { hands: [h0, [C('b', '1'), C('b', '3')], [C('b', '2')]], top: C('r', '5') });
  g.handle('p0', { type: 'play', card: h0[0].id, color: 'y' });
  ok(g.s.pending && g.s.pending.type === 'challenge' && g.s.turn === 1, '+4 waits for challenge');
  ok(!g.handle('p1', { type: 'draw' }).ok, 'cannot draw during challenge');
  g.handle('p1', { type: 'challenge', yes: mode !== 'accept' });
  if (mode === 'accept') ok(g.s.players[1].hand.length === 6 && g.s.turn === 2, '+4 accepted: draw 4, skip');
  if (mode === 'guilty') ok(g.s.players[0].hand.length === 6 && g.s.turn === 1 && g.s.players[1].hand.length === 2, 'guilty: offender draws 4, challenger plays');
  if (mode === 'innocent') ok(g.s.players[1].hand.length === 8 && g.s.turn === 2, 'innocent: challenger draws 6, skip');
}
// draw then play the drawn card / keep
{
  const g = setup(3);
  rig(g, { hands: [[C('b', '1')], [C('b', '1')], [C('b', '2')]], top: C('r', '5') });
  g.s.deck.push(C('r', '7', 999));
  g.handle('p0', { type: 'draw' });
  ok(g.s.pending && g.s.pending.type === 'drawn' && g.s.turn === 0, 'playable draw waits');
  ok(!g.handle('p0', { type: 'play', card: g.s.players[0].hand[0].id }).ok, 'only the drawn card may be played');
  g.handle('p0', { type: 'pass' });
  ok(g.s.turn === 1 && !g.s.pending, 'keep passes the turn');
}
{
  const g = setup(3);
  rig(g, { hands: [[C('b', '1')], [C('b', '1')], [C('b', '2')]], top: C('r', '5') });
  g.s.deck.push(C('g', '7', 998));
  g.handle('p0', { type: 'draw' });
  ok(g.s.turn === 1, 'unplayable draw passes automatically');
}
// SATU! and catching
{
  const g = setup(3);
  rig(g, { hands: [[C('r', '1'), C('r', '2')], [C('b', '1'), C('b', '4')], [C('b', '2')]], top: C('r', '5') });
  g.handle('p0', { type: 'play', card: g.s.players[0].hand[0].id });
  ok(g.s.vulnerable === 'p0', 'forgot SATU = vulnerable');
  ok(!g.handle('p2', { type: 'catch' }).ok, 'catch blocked during grace');
  g.s.vulnAt = 0;
  g.handle('p2', { type: 'catch' });
  ok(g.s.players[0].hand.length === 3 && !g.s.vulnerable, 'caught: +2');
}
{
  const g = setup(3);
  rig(g, { hands: [[C('r', '1'), C('r', '2')], [C('b', '1'), C('b', '4')], [C('b', '2')]], top: C('r', '5') });
  g.handle('p0', { type: 'shout' });
  g.handle('p0', { type: 'play', card: g.s.players[0].hand[0].id });
  ok(!g.s.vulnerable && !g.handle('p2', { type: 'catch' }).ok, 'called SATU = safe');
}
{
  const g = setup(3);
  rig(g, { hands: [[C('r', '1'), C('r', '2')], [C('r', '3'), C('b', '4')], [C('b', '2')]], top: C('r', '5') });
  g.handle('p0', { type: 'play', card: g.s.players[0].hand[0].id });
  g.handle('p1', { type: 'play', card: g.s.players[1].hand[0].id });
  ok(g.s.vulnerable !== 'p0', 'catch window closes when next player acts');
}
// winning & scoring
{
  const g = setup(3);
  g.s.settings.target = 500;
  rig(g, { hands: [[C('r', '1')], [C('b', '9'), C('w', 'w')], [C('b', 's')]], top: C('r', '5') });
  g.handle('p0', { type: 'play', card: g.s.players[0].hand[0].id });
  ok(g.s.phase === 'roundover' && g.s.players[0].score === 79, 'round scored 9+50+20');
}
{
  const g = setup(3);
  g.s.settings.target = 0;
  rig(g, { hands: [[C('r', 'd2')], [C('b', '9')], [C('b', 's')]], top: C('r', '5') });
  g.handle('p0', { type: 'play', card: g.s.players[0].hand[0].id });
  ok(g.s.phase === 'over' && g.s.players[1].hand.length === 3, 'last card +2 still makes next draw; single round ends game');
}

// phone-to-phone dealing and deal-all
{
  const g = Game.create('T', { id: 'p0', name: 'H' });
  for (let i = 1; i < 4; i++) g.addPlayer({ id: 'p' + i, name: 'P' + i });
  g.handle('p0', { type: 'start' });
  g.handle('p0', { type: 'dealMode', mode: 'phone' });
  g.handle('p0', { type: 'dealTo', target: 'p2' });
  let t = 0;
  for (let i = 0; i < 9; i++) g.handle('p0', { type: 'deal' }, (t += 1000));
  ok(g.s.players[2].hand.length === 7 && g.s.players[3].hand.length === 2, 'phone mode fills one player then moves on');
  ok(!g.handle('p0', { type: 'dealTo', target: 'p2' }).ok, 'cannot deal to a full hand');
  g.handle('p0', { type: 'dealAll' });
  ok(g.s.phase === 'play' && g.s.players.every((p) => p.hand.length >= 7) && total(g) === 108, 'deal all finishes the deal');
}

// random full games
function bot(g) {
  const s = g.s, c = s.players[s.turn];
  for (const p of s.players) if (p.hand.length <= 2 && !p.called && Math.random() < 0.5) g.handle(p.id, { type: 'shout' });
  if (s.vulnerable && Math.random() < 0.3) g.handle(s.players.find((p) => p.id !== s.vulnerable).id, { type: 'catch' });
  if (s.phase !== 'play') return;
  const pd = s.pending;
  if (pd && pd.type === 'color') return g.handle(pd.pid, { type: 'color', color: 'r' });
  if (pd && pd.type === 'challenge') return g.handle(pd.pid, { type: 'challenge', yes: Math.random() < 0.4 });
  const col = COLORS[Math.floor(Math.random() * 4)];
  if (pd && pd.type === 'drawn') return Math.random() < 0.7 ? g.handle(c.id, { type: 'play', card: pd.card, color: col }) : g.handle(c.id, { type: 'pass' });
  const card = c.hand.find((x) => canPlay(x, g.top, s.color));
  if (card) return g.handle(c.id, { type: 'play', card: card.id, color: col });
  return g.handle(c.id, { type: 'draw' });
}
let games = 0, broken = 0;
for (let n = 2; n <= 10; n++) {
  for (let k = 0; k < 40; k++) {
    const g = setup(n);
    g.s.settings.target = 200;
    let steps = 0;
    while (g.s.phase !== 'over' && steps < 20000) {
      if (g.s.phase === 'roundover') { g.handle('p0', { type: 'start' }); let t = 1e6 + steps * 1000; while (g.s.phase === 'dealing') g.handle('p0', { type: 'deal' }, (t += 1000)); }
      const r = bot(g);
      if (r && !r.ok && r.error) { broken++; console.log('bot error', r.error); break; }
      if (total(g) !== 108) { broken++; console.log('card count', total(g)); break; }
      g.drainEvents();
      steps++;
    }
    if (g.s.phase === 'over') games++;
  }
}
ok(broken === 0, 'random games never break');
ok(games === 9 * 40, `all ${games} random games finished`);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

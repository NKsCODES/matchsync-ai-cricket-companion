// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../web/engine.js');
const V = require('../web/voices.js');
const G = require('../web/guard.js');
const match = require('../web/data.js');
const cases = require('./guard_cases.json');

const tl = E.buildTimeline(match);
const S = tl.states;
const at = (inn, overs) => E.indexAt(tl, inn, overs * 6);

test('scorecard adds up', () => {
  const end1 = S[tl.breakIndex];
  const end2 = S[S.length - 1];
  assert.equal(end1.score, '181/6');
  assert.equal(end2.score, '184/6');
  assert.equal(end2.result.text, 'Kings won by 4 wickets');
  for (const s of [end1, end2]) {
    const bat = Object.values(s.batters).reduce((n, b) => n + b.runs, 0);
    const extras = match.balls.filter((b) => b.inn === s.inn).reduce((n, b) => n + b.extras, 0);
    assert.equal(bat + extras, s.runs, 'batter runs plus extras equals the total');
    const conceded = Object.values(s.bowlers).reduce((n, b) => n + b.runs, 0);
    assert.equal(conceded, s.runs, 'bowler figures equal the total');
    for (const b of Object.values(s.bowlers)) assert.ok(b.balls <= 24, 'no bowler goes past 4 overs');
  }
});

test('win chance model behaves sensibly', () => {
  assert.ok(E.wpChase(30, 12, 5) < E.wpChase(20, 12, 5), 'needing more runs is worse');
  assert.ok(E.wpChase(50, 30, 3) < E.wpChase(50, 30, 7), 'fewer wickets in hand is worse');
  assert.ok(E.wpChase(50, 18, 6) < E.wpChase(50, 30, 6), 'fewer balls left is worse');
  assert.equal(E.wpChase(0, 5, 3), 1);
  assert.equal(E.wpChase(4, 0, 3), 0);
  for (const s of S) assert.ok(s.wp2 >= 0 && s.wp2 <= 1);
  assert.ok(Math.abs(S[0].wp2 - 0.5) < 0.05, 'the match starts close to even');
});

test('a fact sheet never uses balls bowled after "now"', () => {
  for (const [a, b] of [[at(2, 7), at(2, 14)], [at(1, 10), at(1, 18)], [at(1, 16), at(2, 3)]]) {
    const full = E.buildFacts(tl, a, b, 'KON', 'x');
    const cut = E.buildTimeline({ ...match, balls: match.balls.slice(0, b) });
    assert.deepEqual(E.buildFacts(cut, a, b, 'KON', 'x'), full);
  }
});

test('the opening scenario finds the collapse and the fightback', () => {
  const f = E.buildFacts(tl, at(2, 7), at(2, 14), 'KON', 'since you looked away');
  assert.equal(f.then.score, '62/0');
  assert.equal(f.now.score, '103/4');
  assert.equal(f.swing.verdict, 'turned_against');
  assert.deepEqual(f.moments.map((m) => m.type), ['collapse', 'surge']);
  assert.match(f.moments[0].title, /4 wickets for 13 runs/);
  assert.equal(f.moments[0].goodForTeam, false);
  const other = E.buildFacts(tl, at(2, 7), at(2, 14), 'SAH', 'x');
  assert.equal(other.swing.verdict, 'turned_for');
  assert.equal(other.moments[0].winPctChange, -f.moments[0].winPctChange);
});

test('the dropped catch is found and keeps counting its cost', () => {
  const a = E.buildFacts(tl, at(2, 14), at(2, 16), 'KON', 'x').moments.find((m) => m.type === 'drop');
  const b = E.buildFacts(tl, at(2, 14), at(2, 17), 'KON', 'x').moments.find((m) => m.type === 'drop');
  assert.ok(a && b);
  assert.equal(a.data.runs, 29);
  assert.ok(b.data.added > a.data.added);
});

test('every window, side and voice produces a clean recap', () => {
  let count = 0;
  for (let to = 0; to < S.length; to += 5) {
    for (const back of [0, 12, 30, 400]) {
      const from = back === 0 ? to : back === 400 ? 0 : E.indexBallsBack(tl, to, back);
      for (const side of ['KON', 'SAH', 'neutral']) {
        const facts = E.buildFacts(tl, from, to, side, 'x');
        assert.ok(facts.moments.length <= 3);
        const allowed = G.allowedNumbers(facts);
        for (const voice of ['simple', 'hinglish', 'analyst']) {
          const r = V.instantRecap(facts, voice);
          const lines = [r.headline, r.story, r.watch, ...r.moments.map((m) => m.line)];
          assert.equal(r.moments.length, facts.moments.length);
          for (const line of lines) {
            assert.ok(typeof line === 'string' && line.length > 0, `${voice} line at ${to}`);
            assert.doesNotMatch(line, /undefined|NaN|null|\[object/, `${voice} at ${to}: ${line}`);
            assert.deepEqual(G.check(line, allowed).bad, [], `ungrounded number in "${line}"`);
          }
          count++;
        }
      }
    }
  }
  assert.ok(count > 1000);
});

test('number guard cases', () => {
  const allowed = G.allowedNumbers(cases.facts);
  for (const c of cases.cases) {
    const r = G.check(c.text, allowed);
    assert.equal(r.ok, c.ok, c.text);
    assert.deepEqual(r.bad, c.bad, c.text);
  }
});

test('a bad AI line is replaced, a good one is kept', () => {
  const facts = E.factsForModel(E.buildFacts(tl, at(2, 7), at(2, 14), 'KON', 'x'));
  const fallback = V.instantRecap(E.buildFacts(tl, at(2, 7), at(2, 14), 'KON', 'x'), 'simple');
  const ai = {
    headline: 'Kings have crashed from 62/0 to 103/4.',
    story: 'They lost 9 wickets in a hurry.',
    moments: [{ id: 'm1', line: 'The middle order fell apart against spin.' }],
    watch: 'Need 79 off 36.',
  };
  const m = G.mergeRecap(ai, fallback, facts);
  assert.equal(m.text.headline, ai.headline);
  assert.equal(m.text.story, fallback.story, 'the invented 9 wickets line is dropped');
  assert.equal(m.text.moments[0].line, ai.moments[0].line);
  assert.equal(m.text.moments[1].line, fallback.moments[1].line, 'a missing moment line falls back');
  assert.equal(m.replaced, 2);
  assert.deepEqual(m.bad, ['9']);
  assert.equal(G.mergeRecap('garbage', fallback, facts).replaced, 5);
});

test('scorecard answers work without AI', () => {
  const ctx = E.buildAskContext(tl, at(2, 14), 'KON');
  assert.match(V.quickAnswer(ctx, 'What do they need now?'), /need 79 runs from 36 balls/);
  assert.match(V.quickAnswer(ctx, 'Who has overs left to bowl?'), /Hartley 2/);
  assert.match(V.quickAnswer(ctx, 'how is Rane doing'), /Rane \(Kings\): 18 off 11/);
  assert.match(V.quickAnswer(ctx, 'Kya hua? What changed the match?'), /Collapse/);
  for (let to = 0; to < S.length; to += 7) {
    const c = E.buildAskContext(tl, to, 'neutral');
    for (const q of ['need', 'who is winning', 'bowlers', 'wickets', 'who is batting', 'partnership', 'xyz']) {
      assert.doesNotMatch(V.quickAnswer(c, q), /undefined|NaN/);
    }
  }
});

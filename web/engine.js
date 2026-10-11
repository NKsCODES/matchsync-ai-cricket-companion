// MatchSync facts engine.
// Turns a ball-by-ball feed into: match state after every ball, a win chance estimate,
// the moments that mattered inside a time window, and a fact sheet for the narrator.
// No AI in this file. Everything here is deterministic and unit tested.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MSEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PAR = 178; // score at which the side batting first is a 50/50 bet in this model

  // ---------- win chance model (a simple, explainable heuristic) ----------

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  // Normal CDF, Abramowitz and Stegun approximation.
  function phi(z) {
    var t = 1 / (1 + 0.2316419 * Math.abs(z));
    var d = 0.3989423 * Math.exp((-z * z) / 2);
    var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  // Runs a side can expect from here. Wickets in hand cap how many balls can be
  // batted at full tilt, and spare wickets let batters score a little faster.
  function expectedRuns(balls, wkts) {
    if (balls <= 0 || wkts <= 0) return 0;
    var usable = Math.min(balls, wkts * 13);
    var rate = 1.42 + 0.4 * clamp((wkts * 13 - balls) / 60, 0, 1);
    return usable * rate;
  }

  function wpChase(need, balls, wkts) {
    if (need <= 0) return 1;
    if (balls <= 0 || wkts <= 0) return 0;
    var sd = 2.1 * Math.sqrt(balls) + 1.5;
    return clamp(phi((expectedRuns(balls, wkts) - need) / sd), 0.01, 0.99);
  }

  function projectedScore(runs, balls, wkts) {
    return Math.round(runs + expectedRuns(balls, wkts));
  }

  function wpFirst(runs, balls, wkts) {
    return clamp(phi((runs + expectedRuns(balls, wkts) - PAR) / 22), 0.02, 0.98);
  }

  // ---------- timeline: match state after every ball ----------

  function overText(legal) { return Math.floor(legal / 6) + '.' + (legal % 6); }
  function round1(x) { return Math.round(x * 10) / 10; }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function buildTimeline(match) {
    var maxBalls = match.format.overs * 6;
    var quota = match.format.maxOversPerBowler * 6;
    var t1 = match.innings[0].batting;
    var t2 = match.innings[1].batting;
    var balls = match.balls;
    var states = [];
    var overs = [];
    var first = null;
    var breakIndex = null;
    var cur;

    function short(code) { return match.teams[code].short; }

    function fresh(no) {
      var inn = match.innings[no - 1];
      return {
        inn: no, batting: inn.batting, bowling: inn.bowling, runs: 0, wkts: 0, legal: 0,
        batters: {}, order: [], bowlers: {}, bowlOrder: [], pship: { runs: 0, balls: 0 },
        fow: [], overRuns: [], tokens: [], lastOver: null,
      };
    }
    function batter(name) {
      if (!cur.batters[name]) {
        cur.batters[name] = { name: name, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, how: null };
        cur.order.push(name);
      }
      return cur.batters[name];
    }
    function bowlerOf(name) {
      if (!cur.bowlers[name]) {
        cur.bowlers[name] = { name: name, balls: 0, runs: 0, wkts: 0, dots: 0 };
        cur.bowlOrder.push(name);
      }
      return cur.bowlers[name];
    }
    function cloneMap(m) {
      var out = {};
      Object.keys(m).forEach(function (k) { out[k] = Object.assign({}, m[k]); });
      return out;
    }

    function snap(i, ball) {
      var legal = cur.legal;
      var ballsLeft = maxBalls - legal;
      var allOut = cur.wkts >= 10;
      var target = cur.inn === 2 ? first.runs + 1 : null;
      var need = cur.inn === 2 ? Math.max(0, target - cur.runs) : null;
      var phase = 'live';
      var result = null;
      var wp2;
      if (cur.inn === 1) {
        if (legal >= maxBalls || allOut) {
          phase = 'break';
          wp2 = wpChase(cur.runs + 1, maxBalls, 10);
        } else {
          wp2 = 1 - wpFirst(cur.runs, ballsLeft, 10 - cur.wkts);
        }
      } else if (need <= 0) {
        phase = 'finished'; wp2 = 1;
        result = { winner: t2, text: short(t2) + ' won by ' + plural(10 - cur.wkts, 'wicket') };
      } else if (legal >= maxBalls || allOut) {
        phase = 'finished';
        if (need === 1) { wp2 = 0.5; result = { winner: null, text: 'Match tied' }; }
        else { wp2 = 0; result = { winner: t1, text: short(t1) + ' won by ' + plural(need - 1, 'run') }; }
      } else {
        wp2 = wpChase(need, ballsLeft, 10 - cur.wkts);
      }

      // Who is at the crease, worked out from this ball alone (no peeking at the next one).
      var crease;
      if (!ball) {
        crease = [balls[0].striker, balls[0].nonStriker];
      } else {
        var swap = ball.bat % 2 === 1;
        if (ball.legal && legal % 6 === 0) swap = !swap;
        crease = (swap ? [ball.nonStriker, ball.striker] : [ball.striker, ball.nonStriker])
          .filter(function (n) { return !cur.batters[n].out; });
      }

      return {
        i: i, inn: cur.inn, batting: cur.batting, bowling: cur.bowling,
        runs: cur.runs, wkts: cur.wkts, legal: legal, score: cur.runs + '/' + cur.wkts,
        overText: overText(legal), gl: (cur.inn === 2 ? first.legal : 0) + legal,
        target: target, need: need, ballsLeft: ballsLeft,
        crr: legal ? round1((cur.runs / legal) * 6) : 0,
        rrr: cur.inn === 2 && ballsLeft > 0 && need > 0 ? round1((need / ballsLeft) * 6) : null,
        projected: cur.inn === 1 ? projectedScore(cur.runs, ballsLeft, 10 - cur.wkts) : null,
        wp2: wp2, phase: phase, result: result,
        batters: cloneMap(cur.batters), order: cur.order.slice(), crease: crease,
        bowlers: cloneMap(cur.bowlers), bowlOrder: cur.bowlOrder.slice(),
        pship: { runs: cur.pship.runs, balls: cur.pship.balls },
        fow: cur.fow.slice(), overRuns: cur.overRuns.slice(), recent: cur.tokens.slice(-12),
        lastOver: cur.lastOver, first: first, quota: quota,
      };
    }

    cur = fresh(1);
    states.push(snap(0, null));

    var overAcc = null;
    balls.forEach(function (b, j) {
      if (b.inn !== cur.inn) {
        first = {
          team: cur.batting, runs: cur.runs, wkts: cur.wkts, legal: cur.legal,
          score: cur.runs + '/' + cur.wkts, overs: overText(cur.legal),
        };
        cur = fresh(b.inn);
        overAcc = null;
      }
      if (!overAcc || overAcc.over !== b.over || overAcc.inn !== b.inn) {
        overAcc = { inn: b.inn, over: b.over, a: j, b: j, legal: 0, runs: 0, bowler: b.bowler, tokens: [], complete: false };
        overs.push(overAcc);
      }
      var st = batter(b.striker);
      batter(b.nonStriker);
      var bw = bowlerOf(b.bowler);
      var total = b.bat + b.extras;
      cur.runs += total;
      st.runs += b.bat;
      if (b.extraType !== 'wd') st.balls += 1;
      if (b.bat === 4) st.fours += 1;
      if (b.bat === 6) st.sixes += 1;
      bw.runs += b.bat + (b.extraType === 'wd' || b.extraType === 'nb' ? b.extras : 0);
      if (b.legal) { bw.balls += 1; cur.legal += 1; cur.pship.balls += 1; if (total === 0) bw.dots += 1; }
      cur.pship.runs += total;
      var token = b.wicket ? 'W' : b.extraType ? b.extraType : b.bat === 0 ? '.' : String(b.bat);
      cur.tokens.push(token);
      overAcc.tokens.push(token);
      overAcc.runs += total;
      overAcc.b = j + 1;
      if (b.legal) overAcc.legal += 1;
      if (b.wicket) {
        cur.wkts += 1;
        var outB = cur.batters[b.wicket.player];
        outB.out = true;
        outB.how = b.wicket.kind;
        if (b.wicket.kind !== 'run out') bw.wkts += 1;
        cur.fow.push({ wkt: cur.wkts, runs: cur.runs, over: b.over + '.' + b.n, player: b.wicket.player });
        cur.pship = { runs: 0, balls: 0 };
      }
      if (overAcc.legal === 6 && !overAcc.complete) {
        overAcc.complete = true;
        cur.overRuns.push(overAcc.runs);
        cur.lastOver = { no: b.over + 1, bowler: b.bowler, runs: overAcc.runs, balls: overAcc.tokens.join(' ') };
      }
      var s = snap(j + 1, b);
      if (s.phase === 'break') breakIndex = j + 1;
      states.push(s);
    });

    return { match: match, states: states, balls: balls, overs: overs, t1: t1, t2: t2, breakIndex: breakIndex, short: short };
  }

  // ---------- moments: what actually moved the match inside a window ----------

  var FAMILY = {
    wicket: 'wickets', collapse: 'wickets',
    big_over: 'scoring', surge: 'scoring', squeeze: 'scoring', boundary: 'scoring',
    drop: 'other', milestone: 'other', innings_end: 'other',
  };
  var KIND_TEXT = { bowled: 'bowled by', caught: 'caught off', lbw: 'lbw to', stumped: 'stumped off', 'run out': 'run out, bowler' };

  function findMoments(tl, from, to) {
    var S = tl.states;
    var out = [];
    function pts(a, b) { return (S[b].wp2 - S[a].wp2) * 100; }
    function add(m) { m.family = FAMILY[m.type]; if (m.w === undefined) m.w = Math.abs(m.d); out.push(m); }

    var wicketIdx = [];
    for (var k = from + 1; k <= to; k++) {
      var ball = tl.balls[k - 1];
      var before = S[k - 1];
      var after = S[k];
      var at = ball.over + '.' + ball.n;
      var bat = tl.short(ball.inn === 1 ? tl.t1 : tl.t2);

      if (ball.wicket) {
        wicketIdx.push(k);
        var ob = after.batters[ball.wicket.player];
        add({
          type: 'wicket', a: k - 1, b: k, inn: ball.inn, label: at, d: pts(k - 1, k),
          title: ob.name + ' out for ' + ob.runs + ' (' + ob.balls + ')',
          detail: ob.name + ' ' + KIND_TEXT[ball.wicket.kind] + ' ' + ball.bowler + '. ' + bat + ' ' + after.score + '.',
          data: { batter: ob.name, runs: ob.runs, balls: ob.balls, bowler: ball.bowler, kind: ball.wicket.kind, score: after.score, team: bat },
        });
      }

      if (ball.dropped) {
        var wktsLeft = 10 - before.wkts - 1;
        var cf = ball.inn === 2
          ? wpChase(before.need, before.ballsLeft - 1, wktsLeft)
          : 1 - wpFirst(before.runs, before.ballsLeft - 1, wktsLeft);
        var atDrop = before.batters[ball.striker].runs;
        var nowB = S[to].batters[ball.striker];
        var added = (S[to].inn === ball.inn && nowB ? nowB.runs : after.batters[ball.striker].runs) - atDrop;
        add({
          type: 'drop', a: k - 1, b: k, inn: ball.inn, label: at, d: (after.wp2 - cf) * 100,
          title: ball.striker + ' dropped on ' + atDrop,
          detail: ball.dropped.fielder + ' put down ' + ball.striker + ' at ' + ball.dropped.position + ' off ' + ball.bowler + '. He has added ' + added + ' since.',
          data: { batter: ball.striker, runs: atDrop, fielder: ball.dropped.fielder, bowler: ball.bowler, position: ball.dropped.position, added: added, team: bat },
        });
      }

      if (!ball.wicket && !ball.dropped && ball.bat >= 4 && Math.abs(pts(k - 1, k)) >= 10 && ball.inn === 2 && before.ballsLeft <= 30) {
        add({
          type: 'boundary', a: k - 1, b: k, inn: ball.inn, label: at, d: pts(k - 1, k),
          title: ball.striker + ' hits a ' + (ball.bat === 6 ? 'six' : 'four') + ' off ' + ball.bowler,
          detail: 'It was ' + before.need + ' needed off ' + before.ballsLeft + ' before the ball, ' + after.need + ' off ' + after.ballsLeft + ' after it.',
          data: { batter: ball.striker, bowler: ball.bowler, hit: ball.bat === 6 ? 'six' : 'four', needBefore: before.need, ballsBefore: before.ballsLeft, needAfter: after.need, ballsAfter: after.ballsLeft, team: bat },
        });
      }

      var sb = after.batters[ball.striker];
      var prev = before.inn === ball.inn && before.batters[ball.striker] ? before.batters[ball.striker].runs : 0;
      if (sb && prev < 50 && sb.runs >= 50) {
        add({
          type: 'milestone', a: k - 1, b: k, inn: ball.inn, label: at, d: pts(k - 1, k), w: 6,
          title: sb.name + ' reaches fifty off ' + sb.balls + ' balls',
          detail: sb.name + ' has ' + sb.runs + ' off ' + sb.balls + ' with ' + plural(sb.fours, 'four') + ' and ' + (sb.sixes === 1 ? '1 six' : sb.sixes + ' sixes') + '.',
          data: { batter: sb.name, runs: sb.runs, balls: sb.balls, team: bat },
        });
      }

      if (after.phase === 'break') {
        var chasing = tl.short(tl.t2);
        add({
          type: 'innings_end', a: k - 1, b: k, inn: 1, label: 'innings break', d: 0, w: 10,
          title: bat + ' finish on ' + after.score,
          detail: chasing + ' need ' + (after.runs + 1) + ' to win at ' + round1((after.runs + 1) / tl.match.format.overs) + ' an over.',
          data: { team: bat, score: after.score, chasing: chasing, target: after.runs + 1, rate: round1((after.runs + 1) / tl.match.format.overs) },
        });
      }
    }

    // Collapse: three or more wickets with no more than 15 balls between neighbours.
    var group = [];
    function flush() {
      if (group.length >= 3) {
        var a = group[0] - 1;
        var b = group[group.length - 1];
        var names = group.map(function (g) {
          var n = tl.balls[g - 1].wicket.player;
          return n + ' ' + S[g].batters[n].runs;
        });
        var team = tl.short(S[b].batting);
        add({
          type: 'collapse', a: a, b: b, inn: S[b].inn, d: pts(a, b),
          label: S[a + 1].overText + ' to ' + S[b].overText,
          title: 'Collapse: ' + group.length + ' wickets for ' + (S[b].runs - S[a].runs) + ' runs',
          detail: team + ' went from ' + S[a].score + ' to ' + S[b].score + ' in ' + (S[b].gl - S[a].gl) + ' balls. Out: ' + names.join(', ') + '.',
          data: { wickets: group.length, runs: S[b].runs - S[a].runs, balls: S[b].gl - S[a].gl, fromScore: S[a].score, toScore: S[b].score, names: names, team: team },
        });
      }
      group = [];
    }
    wicketIdx.forEach(function (k) {
      if (group.length) {
        var last = group[group.length - 1];
        if (S[k].inn !== S[last].inn || S[k].gl - S[last].gl > 15) flush();
      }
      group.push(k);
    });
    flush();

    // Over level patterns, using only overs that sit fully inside the window.
    var inside = tl.overs.filter(function (o) { return o.complete && o.a >= from && o.b <= to; });
    inside.forEach(function (o) {
      if (o.runs >= 15) {
        var team = tl.short(o.inn === 1 ? tl.t1 : tl.t2);
        add({
          type: 'big_over', a: o.a, b: o.b, inn: o.inn, label: 'over ' + (o.over + 1), d: pts(o.a, o.b),
          title: o.runs + ' runs off over ' + (o.over + 1),
          detail: team + ' took ' + o.runs + ' off ' + o.bowler + ' (' + o.tokens.join(' ') + ').',
          data: { runs: o.runs, over: o.over + 1, bowler: o.bowler, balls: o.tokens.join(' '), team: team },
        });
      }
    });
    function streaks(type, test, title) {
      var run = [];
      function end() {
        if (run.length >= 2) {
          var a = run[0].a;
          var b = run[run.length - 1].b;
          var runs = S[b].runs - S[a].runs;
          var team = tl.short(run[0].inn === 1 ? tl.t1 : tl.t2);
          var bowlers = run.map(function (o) { return o.bowler; }).filter(function (n, i, xs) { return xs.indexOf(n) === i; });
          var rate = round1(runs / run.length);
          add({
            type: type, a: a, b: b, inn: run[0].inn, d: pts(a, b),
            label: 'overs ' + (run[0].over + 1) + ' to ' + (run[run.length - 1].over + 1),
            title: title + ': ' + runs + ' runs in ' + run.length + ' overs',
            detail: team + ' scored ' + runs + ' in overs ' + (run[0].over + 1) + ' to ' + (run[run.length - 1].over + 1) + ' at ' + rate + ' an over. Bowlers: ' + bowlers.join(', ') + '.',
            data: { runs: runs, overs: run.length, fromOver: run[0].over + 1, toOver: run[run.length - 1].over + 1, rate: rate, bowlers: bowlers, team: team },
          });
        }
        run = [];
      }
      inside.forEach(function (o) {
        var prev = run[run.length - 1];
        if (prev && (prev.inn !== o.inn || prev.over + 1 !== o.over)) end();
        if (test(o)) run.push(o); else end();
      });
      end();
    }
    streaks('squeeze', function (o) { return o.runs <= 5; }, 'Squeeze');
    streaks('surge', function (o) { return o.runs >= 12; }, 'Run surge');

    return out;
  }

  function selectMoments(cands, limit) {
    var chosen = [];
    cands.slice().sort(function (x, y) { return y.w - x.w; }).forEach(function (c) {
      if (chosen.length >= limit) return;
      var clash = chosen.some(function (x) {
        if (x.family === 'other' || c.family === 'other') return false;
        var overlap = Math.max(0, Math.min(c.b, x.b) - Math.max(c.a, x.a));
        return overlap / Math.max(1, c.b - c.a) > 0.6 || overlap / Math.max(1, x.b - x.a) > 0.6;
      });
      if (!clash) chosen.push(c);
    });
    chosen.sort(function (x, y) { return x.a - y.a || x.b - y.b; });
    return chosen;
  }

  // ---------- fact sheet: the only thing the narrator is allowed to use ----------

  function perspective(tl, side) { return side === 'neutral' ? tl.t2 : side; }

  function winPct(tl, s, team) { return Math.round((team === tl.t2 ? s.wp2 : 1 - s.wp2) * 100); }

  function view(tl, s, team) {
    var o = { innings: s.inn, batting: tl.short(s.batting), score: s.score, overs: s.overText, winPct: winPct(tl, s, team) };
    if (s.phase === 'break') o.status = 'innings break';
    if (s.inn === 2) { o.target = s.target; o.need = s.need; o.ballsLeft = s.ballsLeft; }
    return o;
  }

  function oversLeftFor(s, name) { return Math.floor((s.quota - s.bowlers[name].balls) / 6); }

  function watchNext(tl, s) {
    if (s.phase === 'finished') return null;
    if (s.phase === 'break') {
      return { code: 'break', chasing: tl.short(tl.t2), target: s.runs + 1, rate: round1((s.runs + 1) / tl.match.format.overs) };
    }
    if (s.inn === 1) {
      return { code: 'projection', team: tl.short(s.batting), projected: s.projected, par: PAR };
    }
    var keyBowler = null;
    s.bowlOrder.forEach(function (n) {
      var b = s.bowlers[n];
      var left = oversLeftFor(s, n);
      if (b.balls < 12 || left < 1) return;
      var econ = round1((b.runs / b.balls) * 6);
      if (!keyBowler || econ < keyBowler.economy) keyBowler = { name: n, oversLeft: left, economy: econ, runs: b.runs, wickets: b.wkts };
    });
    var setBatter = null;
    s.crease.forEach(function (n) {
      var b = s.batters[n];
      if (b && b.runs >= 25 && (!setBatter || b.runs > setBatter.runs)) {
        setBatter = { name: n, runs: b.runs, balls: b.balls, strikeRate: Math.round((b.runs / b.balls) * 100) };
      }
    });
    var base = { team: tl.short(s.batting), need: s.need, ballsLeft: s.ballsLeft, requiredRate: s.rrr };
    if (keyBowler) base.keyBowler = keyBowler;
    if (setBatter) base.setBatter = setBatter;
    if (s.ballsLeft <= 12) base.code = 'equation';
    else if (setBatter && s.rrr >= 10) base.code = 'set_batter';
    else if (keyBowler) base.code = 'key_bowler';
    else base.code = 'equation';
    return base;
  }

  function buildFacts(tl, from, to, side, label) {
    var S = tl.states;
    var team = perspective(tl, side);
    var then = S[from];
    var now = S[to];
    var missed = { runs: 0, wickets: 0, fours: 0, sixes: 0, dotBalls: 0, balls: 0 };
    for (var k = from; k < to; k++) {
      var b = tl.balls[k];
      missed.runs += b.bat + b.extras;
      if (b.wicket) missed.wickets += 1;
      if (b.bat === 4) missed.fours += 1;
      if (b.bat === 6) missed.sixes += 1;
      if (b.legal) { missed.balls += 1; if (b.bat + b.extras === 0) missed.dotBalls += 1; }
    }
    missed.overs = overText(missed.balls);
    missed.runRate = missed.balls ? round1((missed.runs / missed.balls) * 6) : 0;

    var nowView = view(tl, now, team);
    nowView.currentRate = now.crr;
    if (now.rrr !== null) nowView.requiredRate = now.rrr;
    if (now.inn === 1 && now.phase === 'live') nowView.projected = now.projected;
    nowView.status = now.phase === 'live' ? 'live' : now.phase === 'break' ? 'innings break' : 'finished';
    if (now.result) { nowView.result = now.result.text; nowView.finalBall = tl.balls[to - 1].text; }
    if (now.phase === 'live') {
      nowView.batters = now.crease.map(function (n) { var x = now.batters[n]; return { name: n, runs: x ? x.runs : 0, balls: x ? x.balls : 0 }; });
      nowView.partnership = { runs: now.pship.runs, balls: now.pship.balls };
    }
    if (now.first) nowView.firstInnings = { team: tl.short(now.first.team), score: now.first.score };
    var other = team === tl.t2 ? tl.t1 : tl.t2;
    nowView.winPctByTeam = {};
    nowView.winPctByTeam[tl.short(team)] = winPct(tl, now, team);
    nowView.winPctByTeam[tl.short(other)] = 100 - winPct(tl, now, team);

    var change = winPct(tl, now, team) - winPct(tl, then, team);
    var verdict;
    if (now.phase === 'finished') verdict = !now.result.winner ? 'tied' : now.result.winner === team ? 'won' : 'lost';
    else if (change >= 20) verdict = 'turned_for';
    else if (change <= -20) verdict = 'turned_against';
    else if (nowView.winPct >= 70) verdict = 'on_top';
    else if (nowView.winPct <= 30) verdict = 'in_trouble';
    else verdict = 'in_balance';

    var sign = team === tl.t2 ? 1 : -1;
    var moments = selectMoments(findMoments(tl, from, to), 3).map(function (m, i) {
      var c = Math.round(m.d * sign) || 0;
      return {
        id: 'm' + (i + 1), type: m.type, over: m.label, innings: m.inn, title: m.title, detail: m.detail,
        winPctChange: c, goodForTeam: c >= 0, data: m.data, a: m.a, b: m.b,
      };
    });

    return {
      format: tl.match.format.name + ', ' + tl.match.format.overs + ' overs a side',
      fan: side === 'neutral' ? 'neutral' : 'supports ' + tl.short(team),
      team: tl.short(team), opponent: tl.short(other), isFan: side !== 'neutral',
      window: { label: label, from: then.overText + ' overs, innings ' + then.inn, to: now.overText + ' overs, innings ' + now.inn, oversMissed: missed.overs, crossedInnings: then.inn !== now.inn },
      then: view(tl, then, team),
      now: nowView,
      missed: { runs: missed.runs, wickets: missed.wickets, fours: missed.fours, sixes: missed.sixes, dotBalls: missed.dotBalls, runRate: missed.runRate },
      swing: { winPctChange: change, verdict: verdict },
      moments: moments,
      watch: watchNext(tl, now),
    };
  }

  // Strip internal fields before the fact sheet is shown to a model.
  function factsForModel(facts) {
    var copy = JSON.parse(JSON.stringify(facts));
    copy.moments.forEach(function (m) { delete m.a; delete m.b; delete m.data; });
    delete copy.isFan;
    return copy;
  }

  // ---------- context for free form questions ----------

  function card(tl, s) {
    return {
      team: tl.short(s.batting), score: s.score, overs: s.overText,
      batters: s.order.map(function (n) {
        var x = s.batters[n];
        return { name: n, runs: x.runs, balls: x.balls, fours: x.fours, sixes: x.sixes, status: x.out ? x.how : 'not out' };
      }),
      bowlers: s.bowlOrder.map(function (n) {
        var x = s.bowlers[n];
        return { name: n, overs: overText(x.balls), runs: x.runs, wickets: x.wkts, oversLeft: oversLeftFor(s, n) };
      }),
      fallOfWickets: s.fow.map(function (f) { return f.runs + '/' + f.wkt + ' (' + f.player + ', ' + f.over + ')'; }),
      runsPerOver: s.overRuns,
    };
  }

  function buildAskContext(tl, to, side) {
    var s = tl.states[to];
    var facts = buildFacts(tl, 0, to, side, 'whole match');
    var ctx = {
      match: tl.match.title, format: facts.format, fan: facts.fan,
      status: facts.now.status, now: facts.now, watch: facts.watch,
      players: {},
    };
    [tl.t1, tl.t2].forEach(function (code) {
      ctx.players[tl.short(code)] = tl.match.teams[code].players.map(function (p) { return p.name; });
    });
    if (s.inn === 1) ctx.firstInnings = card(tl, s);
    else { ctx.firstInnings = card(tl, tl.states[tl.breakIndex]); ctx.secondInnings = card(tl, s); }
    var sign = 1;
    ctx.turningPoints = selectMoments(findMoments(tl, 0, to), 5).map(function (m) {
      var p = Math.round(m.d * sign);
      return { over: m.label, innings: m.inn, what: m.title, detail: m.detail, winPctMove: Math.abs(p) + ' points toward ' + tl.short(p >= 0 ? tl.t2 : tl.t1) };
    });
    ctx.lastBalls = tl.balls.slice(Math.max(0, to - 6), to).map(function (b) { return b.over + '.' + b.n + ' ' + b.text; });
    return ctx;
  }

  // First state index that is at most `balls` legal deliveries behind `to`.
  function indexBallsBack(tl, to, balls) {
    var S = tl.states;
    var k = to;
    while (k > 0 && S[to].gl - S[k - 1].gl <= balls) k--;
    return k;
  }
  function inningsStart(tl, to) {
    return tl.states[to].inn === 2 && tl.breakIndex !== null ? tl.breakIndex : 0;
  }
  function indexAt(tl, inn, legal) {
    var S = tl.states;
    if (inn === 2 && legal === 0 && tl.breakIndex !== null) return tl.breakIndex;
    for (var k = 0; k < S.length; k++) if (S[k].inn === inn && S[k].legal === legal) return k;
    return S.length - 1;
  }

  return {
    PAR: PAR, phi: phi, expectedRuns: expectedRuns, wpChase: wpChase, wpFirst: wpFirst,
    buildTimeline: buildTimeline, findMoments: findMoments, selectMoments: selectMoments,
    buildFacts: buildFacts, factsForModel: factsForModel, buildAskContext: buildAskContext,
    indexBallsBack: indexBallsBack, inningsStart: inningsStart, indexAt: indexAt,
    winPct: winPct, perspective: perspective, oversLeftFor: oversLeftFor, overText: overText,
  };
});

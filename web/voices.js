// Instant narrator. Turns a fact sheet into a recap with fixed templates, in three voices.
// It is the zero latency path, the offline path, and the safety net when an AI line fails the number check.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MSVoices = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function overs(text) { return String(text).replace(/\.0$/, ''); }
  function leader(f) {
    var v = f.swing.verdict;
    if (v === 'turned_for' || v === 'on_top') return f.team;
    if (v === 'turned_against' || v === 'in_trouble') return f.opponent;
    return null;
  }
  function changeWords(c) { return c === 0 ? 'unchanged' : (c > 0 ? 'up ' : 'down ') + Math.abs(c) + ' points'; }

  var OUT_SIMPLE = { bowled: 'bowled by', caught: 'caught off the bowling of', lbw: 'out leg before to', stumped: 'stumped off', 'run out': 'run out off' };
  var OUT_HING = { bowled: 'bowled kar diya', caught: 'catch karwa diya', lbw: 'LBW kar diya', stumped: 'stump karwa diya', 'run out': 'run out karwa diya' };

  var VOICES = {
    simple: {
      headline: function (f) {
        var v = f.swing.verdict;
        var T = f.team;
        if (v === 'tied') return 'It finished as a tie.';
        if (!f.isFan) {
          if (v === 'won' || v === 'lost') return f.now.result + '.';
          if (v === 'in_balance') return "Still anyone's game.";
          return (v === 'turned_for' || v === 'turned_against' ? 'The game has swung toward ' + leader(f) : leader(f) + ' are in control') + '.';
        }
        return {
          won: T + ' won! ' + f.now.result + '.',
          lost: T + ' lost. ' + f.now.result + '.',
          turned_for: 'Good news. The game has swung toward ' + T + '.',
          turned_against: 'Bad news. The game has swung away from ' + T + '.',
          on_top: T + ' are still in control.',
          in_trouble: T + ' are still in trouble.',
          in_balance: "Still anyone's game.",
        }[v];
      },
      story: function (f) {
        var p = [];
        if (f.window.crossedInnings) p.push(f.now.firstInnings.team + ' finished their innings on ' + f.now.firstInnings.score + '.');
        p.push('You missed ' + plural(overs(f.window.oversMissed), 'over').replace(/^1 overs/, '1 over') + ': ' + plural(f.missed.runs, 'run') + ' and ' + plural(f.missed.wickets, 'wicket') + '.');
        if (f.now.status === 'finished') p.push('The final ball: ' + f.now.finalBall + '.');
        else {
          p.push(f.team + "'s win chance went from " + f.then.winPct + '% to ' + f.now.winPct + '%.');
          if (f.now.status === 'live' && f.now.need !== undefined) p.push(f.now.batting + ' need ' + plural(f.now.need, 'run') + ' from ' + plural(f.now.ballsLeft, 'ball') + '.');
        }
        return p.join(' ');
      },
      moment: function (m) {
        var d = m.data;
        return {
          wicket: function () { return d.batter + ' is out for ' + d.runs + ', ' + OUT_SIMPLE[d.kind] + ' ' + d.bowler + '.'; },
          collapse: function () { return d.wickets + ' wickets fell for only ' + plural(d.runs, 'run') + '. ' + d.team + ' went from ' + d.fromScore + ' to ' + d.toScore + '.'; },
          big_over: function () { return d.runs + ' runs came from a single over by ' + d.bowler + '. That is about double a normal over.'; },
          squeeze: function () { return 'Only ' + plural(d.runs, 'run') + ' in ' + d.overs + ' overs. The bowlers shut the scoring down.'; },
          surge: function () { return d.runs + ' runs in ' + d.overs + ' overs. That is very fast scoring.'; },
          drop: function () { return d.fielder + ' dropped a catch from ' + d.batter + ' when he had ' + d.runs + '. He has made ' + d.added + ' more since.'; },
          boundary: function () { return d.batter + ' hit a ' + d.hit + ' when ' + d.team + ' needed ' + d.needBefore + ' from ' + plural(d.ballsBefore, 'ball') + '.'; },
          milestone: function () { return d.batter + ' reached fifty in ' + d.balls + ' balls.'; },
          innings_end: function () { return d.team + ' finished on ' + d.score + '. ' + d.chasing + ' need ' + d.target + ' to win.'; },
        }[m.type]();
      },
      watch: function (w) {
        if (!w) return 'That is the match.';
        var kb = w.keyBowler;
        var sb = w.setBatter;
        return {
          equation: function () { return 'Watch the maths: ' + plural(w.need, 'run') + ' from ' + plural(w.ballsLeft, 'ball') + '.' + (kb ? ' ' + kb.name + ' still has ' + plural(kb.oversLeft, 'over') + ' to bowl.' : ''); },
          set_batter: function () { return 'Watch ' + sb.name + '. He has ' + sb.runs + ' from ' + sb.balls + ' balls and ' + w.team + ' need him to stay in.'; },
          key_bowler: function () { return 'Watch ' + kb.name + '. He has ' + plural(kb.oversLeft, 'over') + ' left and has been the hardest bowler to score off.'; },
          projection: function () { return w.team + ' are heading for about ' + w.projected + '. Around ' + w.par + ' is a normal score here.'; },
          break: function () { return 'The chase is about to start. ' + w.chasing + ' need ' + w.target + '.'; },
        }[w.code]();
      },
    },

    hinglish: {
      headline: function (f) {
        var v = f.swing.verdict;
        var T = f.team;
        if (v === 'tied') return 'Match tie ho gaya.';
        if (v === 'in_balance') return 'Match phasa hua hai. Kuch bhi ho sakta hai.';
        if (!f.isFan) {
          if (v === 'won' || v === 'lost') return f.now.result + '. Kya match tha.';
          return v === 'turned_for' || v === 'turned_against' ? 'Game ' + leader(f) + ' ki taraf ghoom gaya.' : leader(f) + ' ka palda bhaari hai.';
        }
        return {
          won: 'Jeet gaye! ' + f.now.result + '.',
          lost: 'Haar gaye yaar. ' + f.now.result + '.',
          turned_for: 'Mast khabar. Game ' + T + ' ki taraf ghoom gaya.',
          turned_against: 'Bhai, game palat gaya. ' + T + ' mushkil mein hai.',
          on_top: 'Tension mat le. ' + T + ' abhi bhi aage hai.',
          in_trouble: 'Halat abhi bhi kharab hai. ' + T + ' peeche hai.',
        }[v];
      },
      story: function (f) {
        var p = [];
        if (f.window.crossedInnings) p.push(f.now.firstInnings.team + ' ki innings ' + f.now.firstInnings.score + ' pe khatam hui.');
        p.push('Tere jaane ke baad ' + overs(f.window.oversMissed) + ' over mein ' + f.missed.runs + ' run bane aur ' + (f.missed.wickets ? f.missed.wickets + ' wicket gire.' : 'koi wicket nahi gira.'));
        if (f.now.status === 'finished') p.push('Aakhri ball: ' + f.now.finalBall + '.');
        else {
          p.push(f.team + ' ka jeetne ka chance ' + f.then.winPct + '% se ' + f.now.winPct + '% ho gaya.');
          if (f.now.status === 'live' && f.now.need !== undefined) p.push('Ab ' + f.now.batting + ' ko ' + f.now.need + ' run chahiye ' + f.now.ballsLeft + ' ball mein.');
        }
        return p.join(' ');
      },
      moment: function (m) {
        var d = m.data;
        return {
          wicket: function () { return d.batter + ' ' + d.runs + ' pe out, ' + d.bowler + ' ne ' + OUT_HING[d.kind] + '.'; },
          collapse: function () { return d.wickets + ' wicket sirf ' + d.runs + ' run mein gir gaye. ' + d.fromScore + ' se seedha ' + d.toScore + '.'; },
          big_over: function () { return d.bowler + ' ke ek over mein ' + d.runs + ' run thok diye.'; },
          squeeze: function () { return d.overs + ' over mein sirf ' + d.runs + ' run. Run bilkul sukh gaye.'; },
          surge: function () { return d.overs + ' over mein ' + d.runs + ' run. Full dhulai hui.'; },
          drop: function () { return d.fielder + ' ne ' + d.batter + ' ka catch chhod diya ' + d.runs + ' pe. Uske baad usne ' + d.added + ' aur bana liye.'; },
          boundary: function () { return d.batter + ' ne ' + d.bowler + ' ko ' + (d.hit === 'six' ? 'chhakka' : 'chauka') + ' maara, jab ' + d.needBefore + ' chahiye the ' + d.ballsBefore + ' ball mein.'; },
          milestone: function () { return d.batter + ' ki fifty, sirf ' + d.balls + ' ball mein.'; },
          innings_end: function () { return d.team + ' ne ' + d.score + ' banaye. ' + d.chasing + ' ko jeetne ke liye ' + d.target + ' chahiye.'; },
        }[m.type]();
      },
      watch: function (w) {
        if (!w) return 'Bas, match khatam.';
        var kb = w.keyBowler;
        var sb = w.setBatter;
        return {
          equation: function () { return 'Ab seedha hisaab: ' + w.need + ' run, ' + w.ballsLeft + ' ball.' + (kb ? ' ' + kb.name + ' ka ' + kb.oversLeft + ' over abhi baaki hai.' : ''); },
          set_batter: function () { return sb.name + ' pe nazar rakh. ' + sb.runs + ' bana chuka hai ' + sb.balls + ' ball mein. Woh tika toh match zinda hai.'; },
          key_bowler: function () { return kb.name + ' ka ' + kb.oversLeft + ' over baaki hai aur usko maarna sabse mushkil raha hai.'; },
          projection: function () { return w.team + ' ' + w.projected + ' ke aas paas ja rahe hai. Yahan ' + w.par + ' normal score hai.'; },
          break: function () { return 'Chase shuru hone wala hai. ' + w.chasing + ' ko ' + w.target + ' chahiye.'; },
        }[w.code]();
      },
    },

    analyst: {
      headline: function (f) {
        var v = f.swing.verdict;
        if (v === 'won' || v === 'lost' || v === 'tied') return f.now.result + '.';
        if (v === 'turned_for' || v === 'turned_against') {
          return f.team + ' win chance ' + changeWords(f.swing.winPctChange) + ', ' + f.then.winPct + '% to ' + f.now.winPct + '%.';
        }
        return f.team + ' win chance ' + f.now.winPct + '%, ' + changeWords(f.swing.winPctChange) + ' in this window.';
      },
      story: function (f) {
        var p = [];
        if (f.window.crossedInnings) p.push(f.now.firstInnings.team + ' closed on ' + f.now.firstInnings.score + '.');
        p.push('Window of ' + overs(f.window.oversMissed) + ' overs: ' + plural(f.missed.runs, 'run') + ', ' + plural(f.missed.wickets, 'wicket') + ', run rate ' + f.missed.runRate + ', ' + plural(f.missed.dotBalls, 'dot ball') + '.');
        if (f.now.status === 'finished') p.push('Final ball: ' + f.now.finalBall + '.');
        else if (f.now.requiredRate !== undefined) p.push('Required rate ' + f.now.requiredRate + ' against a current rate of ' + f.now.currentRate + '.');
        else if (f.now.projected !== undefined) p.push('Projected total ' + f.now.projected + '.');
        return p.join(' ');
      },
      moment: function (m) { return m.detail; },
      watch: function (w) {
        if (!w) return 'Match complete.';
        var kb = w.keyBowler;
        var sb = w.setBatter;
        var kbText = kb ? ' ' + kb.name + ': ' + plural(kb.oversLeft, 'over') + ' left, economy ' + kb.economy + '.' : '';
        return {
          equation: function () { return w.need + ' off ' + w.ballsLeft + ', required rate ' + w.requiredRate + '.' + kbText; },
          set_batter: function () { return sb.name + ' ' + sb.runs + ' (' + sb.balls + '), strike rate ' + sb.strikeRate + '. Required rate ' + w.requiredRate + '.' + kbText; },
          key_bowler: function () { return kb.name + ' has ' + plural(kb.oversLeft, 'over') + ' left at economy ' + kb.economy + ', the best of the attack.'; },
          projection: function () { return 'Projected ' + w.projected + ' against a par of ' + w.par + '.'; },
          break: function () { return 'Target ' + w.target + ' at ' + w.rate + ' an over.'; },
        }[w.code]();
      },
    },
  };

  function instantRecap(facts, voice) {
    var v = VOICES[voice] || VOICES.simple;
    return {
      headline: v.headline(facts),
      story: v.story(facts),
      moments: facts.moments.map(function (m) { return { id: m.id, line: v.moment(m) }; }),
      watch: v.watch(facts.watch),
    };
  }

  // Scorecard answers for when no AI is available. Keyword routing, plain English.
  function quickAnswer(ctx, question) {
    var q = String(question).toLowerCase();
    var now = ctx.now;
    var cards = [ctx.secondInnings, ctx.firstInnings].filter(Boolean);
    var live = cards[0];

    for (var c = 0; c < cards.length; c++) {
      var card = cards[c];
      for (var i = 0; i < card.batters.length; i++) {
        var b = card.batters[i];
        if (q.indexOf(b.name.toLowerCase()) !== -1) {
          return b.name + ' (' + card.team + '): ' + b.runs + ' off ' + b.balls + ' with ' + plural(b.fours, 'four') + ' and ' + (b.sixes === 1 ? '1 six' : b.sixes + ' sixes') + ', ' + b.status + '.';
        }
      }
      for (var j = 0; j < card.bowlers.length; j++) {
        var w = card.bowlers[j];
        if (q.indexOf(w.name.toLowerCase()) !== -1) {
          return w.name + ': ' + w.overs + ' overs, ' + plural(w.runs, 'run') + ', ' + plural(w.wickets, 'wicket') + ', ' + plural(w.oversLeft, 'over') + ' left.';
        }
      }
    }
    if (/bowl|overs left|spell|baaki/.test(q)) {
      var left = live.bowlers.filter(function (x) { return x.oversLeft > 0; });
      if (now.status !== 'live') return 'No overs left to bowl in this innings.';
      return left.length
        ? 'Overs left: ' + left.map(function (x) { return x.name + ' ' + x.oversLeft + ' (' + x.runs + ' runs, ' + plural(x.wickets, 'wicket') + ' so far)'; }).join(', ') + '.'
        : 'Nobody who has bowled so far has overs left.';
    }
    if (/need|requir|target|equation|chahiye|kitna|rate/.test(q)) {
      if (now.status === 'finished') return now.result + '.';
      if (now.need !== undefined) return now.batting + ' need ' + plural(now.need, 'run') + ' from ' + plural(now.ballsLeft, 'ball') + '. Required rate ' + now.requiredRate + ', current rate ' + now.currentRate + '.';
      return now.batting + ' are ' + now.score + ' after ' + now.overs + ' overs' + (now.projected ? ', heading for about ' + now.projected : '') + '.';
    }
    if (/win|chance|jeet|ahead|favou?rite/.test(q)) {
      if (now.status === 'finished') return now.result + '.';
      var parts = Object.keys(now.winPctByTeam).map(function (t) { return t + ' ' + now.winPctByTeam[t] + '%'; });
      var tp = ctx.turningPoints.slice().sort(function (x, y) { return parseInt(y.winPctMove, 10) - parseInt(x.winPctMove, 10); })[0];
      return 'Win chance on the model: ' + parts.join(', ') + '.' + (tp ? ' Biggest swing so far: ' + tp.what + ' (' + tp.over + ').' : '');
    }
    if (/turn|happen|kya hua|why|chang|swing|moment/.test(q)) {
      if (!ctx.turningPoints.length) return 'Nothing has swung the match yet.';
      return ctx.turningPoints.map(function (t) { return t.what + ' (' + t.over + ', ' + t.winPctMove + ')'; }).join('. ') + '.';
    }
    if (/partnership|stand/.test(q) && now.partnership) return 'Current partnership: ' + now.partnership.runs + ' off ' + now.partnership.balls + ' balls.';
    if (/wicket|out|dismiss|gir/.test(q)) {
      return live.fallOfWickets.length ? 'Fall of wickets for ' + live.team + ': ' + live.fallOfWickets.join(', ') + '.' : live.team + ' have not lost a wicket yet.';
    }
    if (/bat|crease|strike|playing|khel/.test(q) && now.batters) {
      return 'At the crease: ' + now.batters.map(function (x) { return x.name + ' ' + x.runs + ' (' + x.balls + ')'; }).join(' and ') + '.';
    }
    return 'Without AI I can answer from the scorecard: what a team needs, who has overs left, the turning points, the win chance, or any player by name.';
  }

  return { instantRecap: instantRecap, quickAnswer: quickAnswer };
});

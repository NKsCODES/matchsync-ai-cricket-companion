// MatchSync app shell. Runs the replay clock, tracks when the fan last looked,
// asks the engine for a fact sheet, and renders the recap (instant first, AI on request).
(function () {
  'use strict';
  var E = window.MSEngine;
  var V = window.MSVoices;
  var G = window.MSGuard;
  var AI = window.MSAI;
  var tl = E.buildTimeline(window.MSMatch);
  var S = tl.states;
  var N = S.length - 1;
  var SVG = 'http://www.w3.org/2000/svg';

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function svg(tag, attrs, text) {
    var n = document.createElementNS(SVG, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function oversBetween(a, b) {
    var t = E.overText(S[b].gl - S[a].gl).replace(/\.0$/, '');
    return t + (t === '1' ? ' over has' : ' overs have');
  }
  function load(key, fallback, allowed) {
    try { var v = localStorage.getItem('ms.' + key); return allowed.indexOf(v) !== -1 ? v : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) { try { localStorage.setItem('ms.' + key, value); } catch (e) { /* storage is optional */ } }

  var START_NOW = E.indexAt(tl, 2, 84);  // 14.0 overs into the chase
  var START_SEEN = E.indexAt(tl, 2, 42); // the fan last looked at 7.0 overs

  var st = {
    now: START_NOW, seen: START_SEEN,
    side: load('side', 'KON', ['KON', 'SAH', 'neutral']),
    voice: load('voice', 'hinglish', ['hinglish', 'simple', 'analyst']),
    win: 'away', playing: true, speed: 10000, lastTick: Date.now(),
    recap: null, aiOn: false, req: 0, welcome: false,
  };

  function team() { return E.perspective(tl, st.side); }

  // ---------- which stretch of the match to catch up on ----------
  function range() {
    var to = st.now;
    var win = st.win === 'away' && st.seen >= st.now ? '2' : st.win;
    if (win === 'away') return { from: st.seen, to: to, win: win, label: 'Since you looked away' };
    if (win === '2') return { from: E.indexBallsBack(tl, to, 12), to: to, win: win, label: 'Last 2 overs' };
    if (win === '5') return { from: E.indexBallsBack(tl, to, 30), to: to, win: win, label: 'Last 5 overs' };
    if (win === 'inn') return { from: E.inningsStart(tl, to), to: to, win: win, label: 'This innings' };
    return { from: 0, to: to, win: win, label: 'Whole match' };
  }

  function takeRecap(useAI) {
    var r = range();
    var facts = E.buildFacts(tl, r.from, r.to, st.side, r.label.toLowerCase());
    var instant = V.instantRecap(facts, st.voice);
    var id = ++st.req;
    st.recap = { facts: facts, text: instant, source: 'instant', from: r.from, to: r.to, win: r.win, label: r.label, note: '', busy: false };
    if (useAI) {
      var forModel = E.factsForModel(facts);
      st.recap.busy = true;
      AI.recap(forModel, st.voice).then(function (res) {
        if (id !== st.req) return;
        st.recap.busy = false;
        if (res.ok) {
          var m = G.mergeRecap(res.recap, instant, forModel);
          st.recap.text = m.text;
          if (m.replaced === m.total) {
            st.recap.note = 'The AI draft failed the number check on every line, so this is the instant recap.';
          } else {
            st.recap.source = 'ai';
            st.aiOn = true;
            st.recap.note = m.replaced
              ? plural(m.replaced, 'line') + ' failed the number check and came from the match engine instead.'
              : 'Words by AI. Every number checked against the scorecard.';
          }
        } else {
          st.recap.note = res.message;
          if (AI.mode().kind === 'none') st.aiOn = false;
        }
        renderAll();
      });
    }
    renderAll();
  }

  // ---------- scoreboard ----------
  var TOKEN_CLASS = { '.': 't-dot', '4': 't-four', '6': 't-six', W: 't-wicket', wd: 't-extra', nb: 't-extra' };

  function renderBoard() {
    var s = S[st.now];
    var chasing = tl.short(tl.t2);
    var live = s.phase === 'live';
    $('live-tag').className = 'live ' + (live && st.playing ? 'on' : 'off');
    $('status-text').textContent = s.phase === 'finished' ? 'Full time' : s.phase === 'break' ? 'Innings break' : st.playing ? 'Live' : 'Paused';
    $('innings-text').textContent = s.inn === 1 ? '1st innings' : '2nd innings';
    $('bat-team').textContent = tl.short(s.batting);
    $('bat-score').textContent = s.score;
    $('bat-overs').textContent = s.overText + ' ov';
    $('other-line').textContent = s.inn === 2 ? tl.short(s.first.team) + ' ' + s.first.score + ' (' + s.first.overs + ' ov)' : chasing + ' yet to bat';
    $('equation').textContent = s.phase === 'finished' ? s.result.text
      : s.phase === 'break' ? chasing + ' need ' + (s.runs + 1) + ' to win'
        : s.inn === 2 ? 'Need ' + plural(s.need, 'run') + ' from ' + plural(s.ballsLeft, 'ball')
          : 'On course for about ' + s.projected;
    $('rrr').textContent = s.rrr === null ? '-' : s.rrr.toFixed(1);
    $('crr').textContent = s.crr.toFixed(1);
    $('crease').textContent = s.crease.map(function (n) {
      var b = s.batters[n];
      return n + ' ' + (b ? b.runs : 0) + ' (' + (b ? b.balls : 0) + ')';
    }).join(', ') || '-';

    var list = $('recent');
    list.textContent = '';
    s.recent.forEach(function (t) {
      var li = el('li', TOKEN_CLASS[t] || 't-run', t === '.' ? '•' : t);
      list.appendChild(li);
    });
    if (!s.recent.length) list.appendChild(el('li', 't-dot', '-'));

    var T = team();
    var other = T === tl.t2 ? tl.t1 : tl.t2;
    var p = E.winPct(tl, s, T);
    $('wp-left').textContent = tl.short(T) + ' ' + p + '%';
    $('wp-right').textContent = (100 - p) + '% ' + tl.short(other);
    $('wp-fill').style.width = p + '%';

    $('scrub').value = st.now;
    $('scrub-out').textContent = 'Innings ' + (s.phase === 'break' ? '1, done' : s.inn + ', ' + s.overText + ' ov');
    $('play').textContent = st.playing ? 'Pause' : st.now >= N ? 'Finished' : 'Play';
    $('play').disabled = st.now >= N;
    if (AI.mode().kind !== 'checking') $('ai-status').textContent = AI.mode().label;
  }

  // ---------- away band ----------
  function renderAway() {
    var line;
    if (st.seen < st.now) {
      var a = S[st.seen];
      var where = a.overText + ' overs' + (a.inn !== S[st.now].inn ? ' of the first innings' : '');
      line = (st.welcome ? 'Welcome back. ' : '') + 'You looked away at ' + where + ', ' + tl.short(a.batting) + ' ' + a.score + '. ' + oversBetween(st.seen, st.now) + ' gone since.';
    } else {
      line = 'You are up to date. Look away, and a catch up will be waiting when you come back.';
    }
    $('away-line').textContent = line;
    var active = range().win;
    Array.prototype.forEach.call($('window-chips').children, function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.win === active));
      if (b.dataset.win === 'away') b.disabled = st.seen >= st.now;
    });
    $('catchup').disabled = !!(st.recap && st.recap.busy);
    $('catchup').textContent = st.recap && st.recap.busy ? 'Writing your catch up' : 'Catch me up';
    $('caught').hidden = st.seen >= st.now;
  }

  // ---------- recap card ----------
  function renderRecap() {
    var rc = st.recap;
    var f = rc.facts;
    var tag = $('recap-source');
    tag.className = 'tag' + (rc.busy ? ' busy' : rc.source === 'ai' ? ' ai' : '');
    tag.textContent = rc.busy ? 'AI is writing' : rc.source === 'ai' ? 'AI recap' : 'Instant recap';
    var a = S[rc.from];
    var b = S[rc.to];
    var cross = a.inn !== b.inn;
    $('recap-window').textContent = rc.label + ', ' + (cross ? 'innings 1 at ' : '') + a.overText + ' to ' + (cross ? 'innings 2 at ' : '') + b.overText + ' overs';
    $('recap-headline').textContent = rc.text.headline;
    $('tn-then-label').textContent = rc.win === 'away' ? 'When you left' : 'Before';
    $('tn-then-score').textContent = f.then.batting + ' ' + f.then.score;
    $('tn-then-sub').textContent = f.then.overs + ' ov, ' + f.team + ' win chance ' + f.then.winPct + '%';
    $('tn-now-score').textContent = f.now.batting + ' ' + f.now.score;
    $('tn-now-sub').textContent = f.now.overs + ' ov, ' + f.team + ' win chance ' + f.now.winPct + '%';
    $('recap-story').textContent = rc.text.story;

    var list = $('recap-moments');
    list.textContent = '';
    f.moments.forEach(function (m, i) {
      var tone = m.goodForTeam ? 'good' : 'bad';
      var li = el('li');
      li.appendChild(el('span', 'm-n ' + tone, String(i + 1)));
      var body = el('div', 'm-body');
      body.appendChild(el('span', 'm-title', m.title));
      var line = rc.text.moments[i] ? rc.text.moments[i].line : '';
      if (line && line !== m.title) body.appendChild(el('span', 'm-line', line));
      body.appendChild(el('span', 'm-over', (m.type === 'innings_end' ? 'End of innings ' + m.innings : 'Innings ' + m.innings + ', ' + m.over)));
      li.appendChild(body);
      if (m.winPctChange !== 0) {
        var sw = el('span', 'm-swing ' + tone, (m.winPctChange > 0 ? '+' : '−') + Math.abs(m.winPctChange) + ' ');
        sw.appendChild(el('small', '', 'pts'));
        sw.title = f.team + ' win chance moved ' + m.winPctChange + ' points';
        li.appendChild(sw);
      }
      list.appendChild(li);
    });
    $('moments-empty').hidden = f.moments.length > 0;
    $('recap-watch').textContent = rc.text.watch;

    var note = $('recap-note');
    note.textContent = '';
    if (rc.note) note.appendChild(el('span', '', rc.note));
    if (rc.to !== st.now && !rc.busy) {
      var gone = Math.abs(st.now - rc.to);
      note.appendChild(el('span', '', (st.now > rc.to ? plural(gone, 'ball') + ' bowled since this recap.' : 'This recap is from later in the match.')));
      var up = el('button', '', 'Update');
      up.type = 'button';
      up.id = 'recap-update';
      up.addEventListener('click', function () { takeRecap(st.aiOn); });
      note.appendChild(up);
    }
    renderWorm();
  }

  // ---------- win chance worm ----------
  function renderWorm() {
    var rc = st.recap;
    var T = team();
    var g = $('worm');
    g.textContent = '';
    // Drawn at the real pixel width so axis text stays readable on a phone.
    var W = Math.max(280, Math.round(g.parentNode.clientWidth) || 640);
    g.setAttribute('viewBox', '0 0 ' + W + ' 196');
    var x0 = 34, x1 = W - 14, y0 = 16, y1 = 150;
    function pos(s) { return (s.phase === 'break' ? 120 : (s.inn - 1) * 120 + s.legal); }
    function X(s) { return x0 + (pos(s) / 240) * (x1 - x0); }
    function Y(p) { return y1 - (p / 100) * (y1 - y0); }
    function P(s) { return (T === tl.t2 ? s.wp2 : 1 - s.wp2) * 100; }
    $('worm-title').textContent = tl.short(T) + ' win chance, ball by ball';

    var a = S[rc.from], b = S[rc.to];
    if (rc.to > rc.from) {
      g.appendChild(svg('rect', { class: 'missed', x: X(a), y: y0, width: Math.max(2, X(b) - X(a)), height: y1 - y0 }));
      g.appendChild(svg('line', { class: 'missed-edge', x1: X(a), y1: y0, x2: X(a), y2: y1 }));
    }
    [0, 100].forEach(function (p) { g.appendChild(svg('line', { class: 'grid', x1: x0, y1: Y(p), x2: x1, y2: Y(p) })); });
    g.appendChild(svg('line', { class: 'mid', x1: x0, y1: Y(50), x2: x1, y2: Y(50) }));
    [[0, '0'], [50, '50'], [100, '100%']].forEach(function (t) {
      g.appendChild(svg('text', { x: x0 - 5, y: Y(t[0]) + 4, 'text-anchor': 'end' }, t[1]));
    });
    var mid = x0 + (x1 - x0) / 2;
    g.appendChild(svg('line', { class: 'split', x1: mid, y1: y0, x2: mid, y2: y1 + 6 }));
    [5, 10, 15, 20].forEach(function (o) {
      [0, 1].forEach(function (inn) {
        var x = x0 + ((inn * 120 + o * 6) / 240) * (x1 - x0);
        g.appendChild(svg('text', { x: x, y: y1 + 16, 'text-anchor': o === 20 ? 'end' : 'middle' }, String(o)));
      });
    });
    g.appendChild(svg('text', { x: x0 + (x1 - x0) / 4, y: y1 + 36, 'text-anchor': 'middle' }, tl.short(tl.t1) + ' innings, overs'));
    g.appendChild(svg('text', { x: x0 + ((x1 - x0) * 3) / 4, y: y1 + 36, 'text-anchor': 'middle' }, tl.short(tl.t2) + ' innings, overs'));

    var d = '';
    for (var k = 0; k <= rc.to; k++) d += (k ? 'L' : 'M') + X(S[k]).toFixed(1) + ' ' + Y(P(S[k])).toFixed(1);
    if (rc.to > 0) {
      g.appendChild(svg('path', { class: 'area', d: d + 'L' + X(b).toFixed(1) + ' ' + y1 + 'L' + x0 + ' ' + y1 + 'Z' }));
      g.appendChild(svg('path', { class: 'line', d: d }));
    }

    var taken = [];
    rc.facts.moments.forEach(function (m, i) {
      var s = S[m.b];
      var px = X(s);
      var py = Y(P(s));
      taken.forEach(function (t) { if (Math.abs(t.x - px) < 20 && Math.abs(t.y - py) < 20) py = t.y + (t.y > 80 ? -21 : 21); });
      py = Math.max(y0 + 2, Math.min(y1 - 2, py));
      taken.push({ x: px, y: py });
      g.appendChild(svg('circle', { class: 'pin ' + (m.goodForTeam ? 'good' : 'bad'), cx: px, cy: py, r: 9 }));
      g.appendChild(svg('text', { class: 'pin-n', x: px, y: py + 4, 'text-anchor': 'middle' }, String(i + 1)));
    });

    var ex = X(b), ey = Y(P(b));
    var clash = taken.some(function (t) { return Math.abs(t.x - ex) < 12 && Math.abs(t.y - ey) < 12; });
    if (!clash) g.appendChild(svg('circle', { class: 'end', cx: ex, cy: ey, r: 4.5 }));
    var right = ex < x1 - 50;
    g.appendChild(svg('text', {
      class: 'end-label', x: right ? ex + 12 : ex - 12, y: Math.max(y0 + 12, Math.min(y1 - 4, ey + (ey < 40 ? 20 : -8))),
      'text-anchor': right ? 'start' : 'end',
    }, Math.round(P(b)) + '%'));
  }

  function renderPrefs() {
    Array.prototype.forEach.call($('side-seg').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.side === st.side)); });
    Array.prototype.forEach.call($('voice-seg').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.voice === st.voice)); });
  }
  function renderAll() { renderPrefs(); renderBoard(); renderAway(); renderRecap(); }
  function renderLive() { renderBoard(); renderAway(); renderRecap(); }

  // ---------- replay clock (wall clock based, so a hidden tab still moves on) ----------
  function tick() {
    var t = Date.now();
    if (!st.playing || st.now >= N) { st.lastTick = t; return; }
    var steps = Math.floor((t - st.lastTick) / st.speed);
    if (steps <= 0) return;
    st.lastTick += steps * st.speed;
    st.now = Math.min(N, st.now + steps);
    if (st.now >= N) st.playing = false;
    renderLive();
  }

  function jump(to, seen) {
    st.now = Math.max(0, Math.min(N, to));
    if (seen !== undefined) st.seen = seen;
    if (st.seen > st.now) st.seen = st.now;
    st.lastTick = Date.now();
    st.welcome = false;
  }

  function lookAway() {
    var k = st.now;
    while (k < N && S[k].gl - S[st.now].gl < 18) k++;
    if (k === st.now) return;
    jump(k, st.now);
    st.win = 'away';
    st.welcome = true;
    takeRecap(st.aiOn);
    $('away').scrollIntoView({ block: 'nearest' });
  }

  // ---------- ask ----------
  function ask(q) {
    q = String(q || '').trim();
    if (!q) return;
    var ctx = E.buildAskContext(tl, st.now, st.side);
    var at = S[st.now].overText + ' overs';
    var item = el('div', 'qa');
    var ans = el('p', 'qa-a', '');
    var meta = el('p', 'qa-meta', '');
    item.appendChild(el('p', 'qa-q', q));
    item.appendChild(ans);
    item.appendChild(meta);
    $('ask-thread').prepend(item);

    var kind = AI.mode().kind;
    if (kind !== 'artifact' && kind !== 'server') {
      ans.textContent = V.quickAnswer(ctx, q);
      meta.textContent = 'Scorecard answer at ' + at + '. The AI narrator is off in this view.';
      return;
    }
    ans.textContent = 'Thinking...';
    $('ask-send').disabled = true;
    AI.ask(ctx, st.voice, q, function (text) { ans.textContent = text; }).then(function (res) {
      $('ask-send').disabled = false;
      if (!res.ok) {
        ans.textContent = V.quickAnswer(ctx, q);
        meta.textContent = res.message + ' Scorecard answer at ' + at + '.';
        return;
      }
      ans.textContent = res.answer.trim();
      var c = G.check(res.answer, G.allowedNumbers(ctx));
      if (c.ok) meta.textContent = 'AI answer at ' + at + '. Every number in it appears on the scorecard.';
      else {
        meta.className = 'qa-meta warn';
        meta.textContent = 'AI answer at ' + at + '. Not found on the scorecard: ' + c.bad.join(', ') + '. Treat those with care.';
      }
    });
  }

  // ---------- wiring ----------
  function on(id, ev, fn) { $(id).addEventListener(ev, fn); }

  on('side-seg', 'click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    st.side = b.dataset.side; save('side', st.side); takeRecap(st.aiOn);
  });
  on('voice-seg', 'click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    st.voice = b.dataset.voice; save('voice', st.voice); takeRecap(st.aiOn);
  });
  on('window-chips', 'click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.disabled) return;
    st.win = b.dataset.win; takeRecap(st.aiOn);
  });
  on('catchup', 'click', function () { st.welcome = false; takeRecap(true); });
  on('caught', 'click', function () { st.seen = st.now; st.welcome = false; takeRecap(false); });
  on('lookaway', 'click', lookAway);
  on('lookaway-inline', 'click', lookAway);
  on('play', 'click', function () { st.playing = !st.playing; st.lastTick = Date.now(); renderBoard(); });
  on('speed', 'change', function (e) { st.speed = Number(e.target.value); st.lastTick = Date.now(); });
  on('scrub', 'input', function (e) { jump(Number(e.target.value)); takeRecap(false); });
  on('jump-start', 'click', function () { jump(START_NOW, START_SEEN); st.win = 'away'; st.playing = true; takeRecap(st.aiOn); });
  on('jump-last', 'click', function () { jump(E.indexAt(tl, 2, 114)); st.playing = true; takeRecap(st.aiOn); });
  on('ask-form', 'submit', function (e) {
    e.preventDefault();
    ask($('ask-input').value);
    $('ask-input').value = '';
  });

  ['Kya hua? What changed the match?', 'What do they need now?', 'Who has overs left to bowl?', 'Who is winning and why?'].forEach(function (q, i) {
    var b = el('button', '', q);
    b.type = 'button';
    b.id = 'ask-chip-' + i;
    b.addEventListener('click', function () { ask(q); });
    $('ask-chips').appendChild(b);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      st.seen = st.now; // they were watching until this ball
      return;
    }
    tick();
    if (S[st.now].gl - S[st.seen].gl >= 6) {
      st.win = 'away';
      st.welcome = true;
      takeRecap(st.aiOn);
    }
  });

  var resizeQueued = false;
  window.addEventListener('resize', function () {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(function () { resizeQueued = false; if (st.recap) renderWorm(); });
  });

  $('scrub').max = N;
  $('speed').value = String(st.speed);
  takeRecap(false);
  setInterval(tick, 250);
  AI.detect().then(function (m) { $('ai-status').textContent = m.label; });
})();

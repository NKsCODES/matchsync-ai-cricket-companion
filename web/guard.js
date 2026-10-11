// Number grounding guard. The AI may choose words, never numbers.
// Every number in AI text must already exist in the fact sheet it was given.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MSGuard = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var NUM = /\d+(?:\.\d+)?/g;

  function tokens(text) { return String(text == null ? '' : text).match(NUM) || []; }
  function norm(t) { return String(parseFloat(t)); }

  // Moment ids (m1, m2) are labels, not facts, so they are removed before collecting numbers.
  function allowedNumbers(facts) {
    var set = {};
    var source = JSON.stringify(facts).replace(/"id":"m\d+"/g, '');
    tokens(source).forEach(function (t) { set[t] = true; set[norm(t)] = true; });
    return set;
  }

  function check(text, allowed) {
    var bad = [];
    tokens(text).forEach(function (t) {
      if (!allowed[t] && !allowed[norm(t)] && bad.indexOf(t) === -1) bad.push(t);
    });
    return { ok: bad.length === 0, bad: bad };
  }

  function usable(s) { return typeof s === 'string' && s.trim().length > 0 && s.length <= 400; }

  // Keep each AI line only if it passes. A failed line falls back to the engine's own line.
  function mergeRecap(ai, fallback, facts) {
    var allowed = allowedNumbers(facts);
    var replaced = 0;
    var bad = [];
    function pickLine(candidate, safe) {
      if (usable(candidate)) {
        var r = check(candidate, allowed);
        if (r.ok) return candidate.trim();
        bad = bad.concat(r.bad);
      }
      replaced += 1;
      return safe;
    }
    ai = ai && typeof ai === 'object' ? ai : {};
    var byId = {};
    (Array.isArray(ai.moments) ? ai.moments : []).forEach(function (m) { if (m && m.id) byId[m.id] = m.line; });
    return {
      text: {
        headline: pickLine(ai.headline, fallback.headline),
        story: pickLine(ai.story, fallback.story),
        moments: fallback.moments.map(function (m) { return { id: m.id, line: pickLine(byId[m.id], m.line) }; }),
        watch: pickLine(ai.watch, fallback.watch),
      },
      replaced: replaced,
      total: 3 + fallback.moments.length,
      bad: bad,
    };
  }

  return { tokens: tokens, allowedNumbers: allowedNumbers, check: check, mergeRecap: mergeRecap };
});

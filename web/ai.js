// AI narrator. Three ways to reach a model, tried in this order:
//   1. Claude inside the published demo page (runs on the viewer's own Claude account)
//   2. The local FastAPI server in /server (your own API key, any provider)
//   3. None. The app still works on the instant narrator.
// The model only ever sees the fact sheet, and its numbers are checked by guard.js.
(function (root) {
  'use strict';
  var P = root.MSPrompts;
  var mode = { kind: 'checking', label: 'Checking for an AI narrator' };
  var sample = null;

  function fill(lines, vars) {
    return lines.join('\n').replace(/\{(\w+)\}/g, function (all, k) { return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : all; });
  }
  function recapPrompt(facts, voice) {
    return fill(P.recap, { voice: P.voices[voice], fan: facts.fan, facts: JSON.stringify(facts) });
  }
  function askPrompt(ctx, voice, question) {
    return fill(P.ask, { voice: P.voices[voice], fan: ctx.fan, context: JSON.stringify(ctx), question: String(question).slice(0, 300) });
  }

  async function detect() {
    if (root.claude && typeof root.claude.use === 'function') {
      try {
        var s = await root.claude.use('sample');
        if (s) {
          sample = s;
          mode = { kind: 'artifact', label: 'Claude, on your own account. It asks permission the first time.' };
          return mode;
        }
      } catch (e) { /* fall through */ }
    }
    try {
      var r = await fetch('api/health');
      if (r.ok) {
        var j = await r.json();
        mode = j.ai
          ? { kind: 'server', label: j.provider + ' ' + j.model + ', through the local server' }
          : { kind: 'none', label: 'Off. The server has no API key, see .env.example' };
        return mode;
      }
    } catch (e) { /* no server */ }
    mode = { kind: 'none', label: 'Off in this view. Recaps come from the match engine.' };
    return mode;
  }

  var COPY = {
    not_granted: 'Claude was not allowed on this page, so this is the instant recap.',
    sampling_disabled: 'Claude is not available on this account, so this is the instant recap.',
    rate_limited: 'The AI narrator is busy or at its usage limit, so this comes from the match engine. Try again in a bit.',
    session_expired: 'Your Claude session expired. Sign in again to use the AI narrator.',
    refused: 'The AI declined that one.',
    invalid_json: 'The AI reply was not usable, so this is the instant recap.',
    no_ai: 'The AI narrator is off in this view, so this comes straight from the match engine.',
  };
  function fail(e) {
    var code = (e && e.code) || 'upstream_error';
    if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled') {
      mode = { kind: 'none', label: 'Off. Claude was not allowed on this page.' };
    }
    return { ok: false, code: code, message: COPY[code] || 'The AI call failed, so this comes straight from the match engine.' };
  }

  async function post(path, body) {
    var r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var j = await r.json().catch(function () { return null; });
    if (!r.ok || !j || !j.ok) throw { code: (j && j.code) || 'upstream_error' };
    return j;
  }

  // Returns { ok, recap } where recap is the raw model JSON. The caller runs the number check.
  async function recap(facts, voice) {
    if (mode.kind === 'artifact') {
      try { return { ok: true, recap: await sample.json(recapPrompt(facts, voice), { modelTier: 'quick' }) }; }
      catch (e) { return fail(e); }
    }
    if (mode.kind === 'server') {
      try { var j = await post('api/recap', { facts: facts, voice: voice }); return { ok: true, recap: j.recap }; }
      catch (e) { return fail(e); }
    }
    return { ok: false, code: 'no_ai', message: COPY.no_ai };
  }

  // Returns { ok, answer }. onText streams partial text where the transport supports it.
  async function ask(ctx, voice, question, onText) {
    if (mode.kind === 'artifact') {
      try {
        var res = await sample(askPrompt(ctx, voice, question), { modelTier: 'quick', onText: function (u) { onText(u.text); } });
        return { ok: true, answer: res.text };
      } catch (e) { return fail(e); }
    }
    if (mode.kind === 'server') {
      try { var j = await post('api/ask', { context: ctx, voice: voice, question: question }); return { ok: true, answer: j.answer }; }
      catch (e) { return fail(e); }
    }
    return { ok: false, code: 'no_ai', message: COPY.no_ai };
  }

  root.MSAI = {
    detect: detect, recap: recap, ask: ask,
    mode: function () { return mode; },
    recapPrompt: recapPrompt, askPrompt: askPrompt,
  };
})(typeof self !== 'undefined' ? self : this);

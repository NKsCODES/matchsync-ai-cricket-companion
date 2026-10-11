// Expands a hand-written over-by-over script into a ball-by-ball feed.
// Output: web/data.js (the same shape a real ball-by-ball provider would be mapped to).
// Run: node scripts/make_match.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const TEAMS = {
  SAH: {
    code: 'SAH', name: 'Sahyadri Strikers', short: 'Strikers',
    players: [
      ['Deshmukh', 'Aarav Deshmukh'], ['Kulkarni', 'Tanmay Kulkarni'], ['Clarke', 'Reuben Clarke'],
      ['Bhosale', 'Ishaan Bhosale'], ['Rathod', 'Dev Rathod'], ['Shaikh', 'Kabir Shaikh'],
      ['Venter', 'Marcus Venter'], ['Jadhav', 'Omkar Jadhav'], ['Gaikwad', 'Yash Gaikwad'],
      ['Hartley', 'Liam Hartley'], ['Pathan', 'Sameer Pathan'],
    ],
  },
  KON: {
    code: 'KON', name: 'Konkan Kings', short: 'Kings',
    players: [
      ['Naik', 'Rohan Naik'], ['Sawant', 'Vihaan Sawant'], ['Morrison', 'Jake Morrison'],
      ['Parab', 'Arjun Parab'], ['Rane', 'Nikhil Rane'], ['Fernandes', 'Daniel Fernandes'],
      ['Gawde', 'Siddharth Gawde'], ['Kamat', 'Tejas Kamat'], ['Salgaonkar', 'Pratik Salgaonkar'],
      ['Jansen', 'Kyle Jansen'], ['Pednekar', 'Aditya Pednekar'],
    ],
  },
};

// Tokens: . dot | 1 2 3 4 6 runs off the bat | W wicket | wd wide | D1 dropped catch, 1 run taken
const SCRIPT = [
  {
    batting: 'SAH', bowling: 'KON',
    overs: [
      ['Jansen', '. 1 . 4 . 1'], ['Pednekar', '4 . 1 1 . 6'], ['Jansen', '. W . 1 4 .'],
      ['Pednekar', '1 4 . 4 1 .'], ['Gawde', '6 1 . 4 1 1'], ['Jansen', '1 . 4 . 1 2'],
      ['Salgaonkar', '1 . 1 W . 1'], ['Kamat', '1 1 . 1 4 1'], ['Salgaonkar', '. 1 1 . 1 1'],
      ['Kamat', '1 6 . 1 1 .'], ['Salgaonkar', '1 . W 1 . 1'], ['Gawde', '4 1 1 6 . 1'],
      ['Kamat', '1 1 . 4 1 1'], ['Salgaonkar', '1 . 6 1 . 1'], ['Pednekar', '1 4 . W 1 1'],
      ['Kamat', '6 1 1 . 4 1'], ['Jansen', '1 . 1 W 4 1'], ['Gawde', '4 6 1 . wd 1 4'],
      ['Pednekar', '1 6 . 1 4 W'], ['Gawde', '1 4 . 6 1 2'],
    ],
    wickets: {
      '3.2': ['caught', 'Parab', 'edged to slip'], '7.4': ['stumped', 'Fernandes', 'beaten in flight'],
      '11.3': ['lbw', null, 'trapped on the back foot'], '15.4': ['caught', 'Rane', 'holed out to deep midwicket'],
      '17.4': ['bowled', null, 'yorker through the gate'], '19.6': ['caught', 'Naik', 'skied to long-off'],
    },
    drops: {},
  },
  {
    batting: 'KON', bowling: 'SAH',
    overs: [
      ['Hartley', '. 4 . 1 4 .'], ['Pathan', '1 4 6 . 1 .'], ['Hartley', '4 . 1 . 4 1'],
      ['Venter', '1 6 . 4 . 1'], ['Pathan', '. 1 4 1 . 1'], ['Venter', '4 . 1 . 2 1'],
      ['Gaikwad', '1 . 1 1 . 1'], ['Jadhav', '1 W . . 1 .'], ['Gaikwad', '. 1 W . 1 .'],
      ['Jadhav', '1 . . 1 1 .'], ['Gaikwad', '1 . 4 W . 1'], ['Jadhav', '. 1 . W 1 .'],
      ['Venter', '1 4 1 . 6 1'], ['Gaikwad', '1 6 1 1 4 .'], ['Pathan', '1 4 . 1 6 1'],
      ['Jadhav', '1 . 6 D1 1 4'], ['Venter', '4 6 1 . 6 2'], ['Hartley', '1 . W 1 . 2'],
      ['Pathan', '6 1 4 . wd 1 6'], ['Hartley', '1 W . 6 2 4'],
    ],
    wickets: {
      '8.2': ['caught', 'Rathod', 'picked out long-on'], '9.3': ['bowled', null, 'googly through the gate'],
      '11.4': ['lbw', null, 'missed a sweep'], '12.4': ['stumped', 'Kulkarni', 'dragged out of the crease'],
      '18.3': ['bowled', null, 'yorker hits the base of middle'], '20.2': ['caught', 'Bhosale', 'sliced to deep cover'],
    },
    drops: { '16.4': ['Shaikh', 'deep midwicket'] },
  },
];

// Small seeded RNG so commentary lines are stable between runs.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(11);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const LINES = {
  0: ['good length, defended', 'beaten outside off', 'straight to the fielder, no run', 'slower ball, no run'],
  1: ['pushed to long-on for one', 'worked off the pads for a single', 'dabbed to third man, one run', 'driven to the sweeper, one'],
  2: ['placed into the gap, they come back for two', 'chipped over the infield, two runs'],
  3: ['driven wide of long-off, they run three'],
  4: ['driven through cover, FOUR', 'pulled hard, FOUR', 'swept fine, FOUR', 'cut past point, FOUR'],
  6: ['launched over long-on, SIX', 'picked up over midwicket, SIX', 'straight back over the bowler, SIX'],
};

const balls = [];
SCRIPT.forEach((inn, innIdx) => {
  const order = TEAMS[inn.batting].players.map((p) => p[0]);
  let next = 2;
  let striker = order[0];
  let non = order[1];
  inn.overs.forEach(([bowler, line], overIdx) => {
    let legalInOver = 0;
    for (const tok of line.split(/\s+/)) {
      const key = `${overIdx + 1}.${legalInOver + 1}`;
      const ball = {
        inn: innIdx + 1, over: overIdx, n: legalInOver + 1, legal: true,
        striker, nonStriker: non, bowler, bat: 0, extras: 0, extraType: null,
        wicket: null, dropped: null, text: '',
      };
      if (tok === 'wd') {
        ball.legal = false; ball.extras = 1; ball.extraType = 'wd';
        ball.text = `${bowler} to ${striker}, wide down the leg side`;
      } else if (tok === 'W') {
        const w = inn.wickets[key];
        if (!w) throw new Error(`No wicket detail for innings ${innIdx + 1} ball ${key}`);
        ball.wicket = { kind: w[0], player: striker, fielder: w[1] };
        ball.text = `${bowler} to ${striker}, OUT, ${w[2]}`;
      } else if (tok.startsWith('D')) {
        const d = inn.drops[key];
        if (!d) throw new Error(`No drop detail for innings ${innIdx + 1} ball ${key}`);
        ball.bat = Number(tok.slice(1) || 0);
        ball.dropped = { fielder: d[0], position: d[1] };
        ball.text = `${bowler} to ${striker}, DROPPED by ${d[0]} at ${d[1]}, they take ${ball.bat}`;
      } else {
        ball.bat = tok === '.' ? 0 : Number(tok);
        ball.text = `${bowler} to ${striker}, ${pick(LINES[ball.bat])}`;
      }
      balls.push(ball);
      if (ball.wicket) {
        striker = order[next++];
      } else if (ball.bat % 2 === 1) {
        [striker, non] = [non, striker];
      }
      if (ball.legal) legalInOver++;
    }
    if (legalInOver !== 6) throw new Error(`Innings ${innIdx + 1} over ${overIdx + 1} has ${legalInOver} legal balls`);
    [striker, non] = [non, striker];
  });
});

const match = {
  id: 'sim-sah-kon-01',
  title: 'Sahyadri Strikers v Konkan Kings',
  venue: 'Riverside Stadium (fictional)',
  format: { name: 'T20', overs: 20, maxOversPerBowler: 4 },
  note: 'Simulated match. Teams and players are fictional.',
  teams: Object.fromEntries(Object.values(TEAMS).map((t) => [t.code, {
    code: t.code, name: t.name, short: t.short,
    players: t.players.map(([id, name]) => ({ id, name })),
  }])),
  innings: SCRIPT.map((s, i) => ({ no: i + 1, batting: s.batting, bowling: s.bowling })),
  balls,
};

const body = `// Generated by scripts/make_match.mjs. Do not edit by hand.
(function (root, factory) {
  var data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.MSMatch = data;
})(typeof self !== 'undefined' ? self : this, function () {
  return ${JSON.stringify(match)};
});
`;
writeFileSync(join(here, '..', 'web', 'data.js'), body);
console.log(`Wrote ${balls.length} balls`);

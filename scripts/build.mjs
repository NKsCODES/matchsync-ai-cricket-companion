// Build step. Two outputs:
//   web/prompts.js       the browser copy of prompts.json (prompts.json is the single source)
//   dist/matchsync.html    everything inlined into one file, the form the hosted demo is published in
// Run: node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const prompts = JSON.parse(read('prompts.json'));
writeFileSync(
  join(root, 'web', 'prompts.js'),
  `// Generated from prompts.json by scripts/build.mjs. Edit prompts.json, not this file.\n(typeof self !== 'undefined' ? self : this).MSPrompts = ${JSON.stringify(prompts, null, 2)};\n`,
);

const html = read('web/index.html');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const app = html.split('<!-- app:start -->')[1].split('<!-- app:end -->')[0].trim();
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const js = scripts.map((f) => `<script>\n${read('web/' + f).replace(/<\/script/gi, '<\\/script')}\n</script>`).join('\n');

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'matchsync.html'), `${title}\n${fonts}\n<style>\n${read('web/styles.css')}</style>\n${app}\n${js}\n`);
console.log('Built web/prompts.js and dist/matchsync.html from', scripts.join(', '));

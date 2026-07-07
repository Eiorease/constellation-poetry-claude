/**
 * Build public/poems.json — real poems (title + lines) for every poet in the
 * graph, pulled from the chinese-poetry corpus. Capped per author to keep the
 * file a reasonable size; loaded at runtime by the detail panel.
 *
 * Run AFTER generate-data.mjs (needs public/graph.json for the poet list):
 *   node scripts/fetch-poems.mjs
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as OpenCC from 'opencc-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master';
const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });
const CAP = 50; // max poems stored per poet

const graph = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'graph.json'), 'utf8'));
const wanted = new Set(graph.nodes.map((n) => n.name));
const poems = new Map(); // name -> [{title, lines}]

function addPoem(rawAuthor, title, lines, convert) {
  if (!rawAuthor || !lines || !lines.length) return;
  const author = (convert ? t2s(rawAuthor) : rawAuthor).trim();
  if (!wanted.has(author)) return;
  const list = poems.get(author) ?? [];
  if (list.length >= CAP) return;
  const t = (convert ? t2s(title || '') : title || '').trim() || '无题';
  if (list.some((p) => p.title === t)) return; // dedup by title
  list.push({ title: t, lines: (convert ? lines.map((l) => t2s(l)) : lines).map((l) => l.trim()) });
  poems.set(author, list);
}

async function getJson(url) {
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (a === 2) { console.warn(`  skip ${url}: ${e.message}`); return null; }
    }
  }
}

async function ingestShards(prefix, convert, maxIndex, step = 1000) {
  for (let i = 0; i <= maxIndex; i += step) {
    const arr = await getJson(`${BASE}/${prefix}.${i}.json`);
    if (!arr) break;
    for (const p of arr) addPoem(p.author, p.title || p.rhythmic, p.paragraphs || p.content, convert);
    if (i % 10000 === 0) process.stdout.write(`  ${prefix}.${i}\r`);
  }
  console.log(`  ${prefix}: done`);
}
async function ingestFile(path, convert) {
  const arr = await getJson(`${BASE}/${path}`);
  if (!arr) return;
  for (const p of arr) addPoem(p.author, p.title || p.rhythmic, p.paragraphs || p.content, convert);
  console.log(`  ${path}: done`);
}

console.log('Collecting poems for', wanted.size, 'poets …');
await ingestShards('全唐诗/poet.tang', true, 60000);
await ingestShards('宋词/ci.song', false, 30000);
await ingestFile('元曲/yuanqu.json', false);
await ingestFile('楚辞/chuci.json', false);

const out = Object.fromEntries(poems);
const outPath = join(__dirname, '..', 'public', 'poems.json');
writeFileSync(outPath, JSON.stringify(out));
const totalPoems = [...poems.values()].reduce((s, l) => s + l.length, 0);
const sizeMB = (Buffer.byteLength(JSON.stringify(out)) / 1e6).toFixed(1);
console.log(`\nWrote ${outPath}: ${poems.size} poets, ${totalPoems} poems, ${sizeMB} MB`);

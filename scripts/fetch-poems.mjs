/**
 * Build public/poems/<nodeId>.json — the COMPLETE works of every poet in the
 * graph, pulled from the chinese-poetry corpus. One file per poet, fetched on
 * demand by the detail panel, so a poet like 李白 gets all ~1200 poems without
 * bloating a single download.
 *
 * Run AFTER generate-data.mjs (needs public/graph.json):
 *   node scripts/fetch-poems.mjs
 */
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as OpenCC from 'opencc-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master';
const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });
const CAP = 3000; // safety bound per poet

const graph = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'graph.json'), 'utf8'));
const idByName = new Map(graph.nodes.map((n) => [n.name, n.id]));

const byId = new Map(); // id -> [{title, lines}]
const seen = new Map(); // id -> Set("title|firstline")

function addPoem(rawAuthor, title, lines, convert) {
  if (!rawAuthor || !lines || !lines.length) return;
  const author = (convert ? t2s(rawAuthor) : rawAuthor).trim();
  const id = idByName.get(author);
  if (!id) return;
  const list = byId.get(id) ?? (byId.set(id, []), byId.get(id));
  if (list.length >= CAP) return;
  const clean = (convert ? lines.map((l) => t2s(l)) : lines).map((l) => l.trim());
  const t = ((convert ? t2s(title || '') : title) || '').trim() || '无题';
  const key = `${t}|${clean[0] ?? ''}`;
  const s = seen.get(id) ?? (seen.set(id, new Set()), seen.get(id));
  if (s.has(key)) return;
  s.add(key);
  list.push({ title: t, lines: clean });
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

console.log('Collecting complete works for', idByName.size, 'poets …');
await ingestShards('全唐诗/poet.tang', true, 60000);
await ingestShards('宋词/ci.song', false, 30000);
await ingestFile('元曲/yuanqu.json', false);
await ingestFile('楚辞/chuci.json', false);

const outDir = join(__dirname, '..', 'public', 'poems');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
let totalPoems = 0;
for (const [id, list] of byId) {
  writeFileSync(join(outDir, `${id}.json`), JSON.stringify(list));
  totalPoems += list.length;
}
// remove the old monolithic file if present
rmSync(join(__dirname, '..', 'public', 'poems.json'), { force: true });
console.log(`\nWrote ${byId.size} poet files to public/poems/, ${totalPoems} poems total`);
console.log('李白:', byId.get(idByName.get('李白'))?.length, '| 杜甫:', byId.get(idByName.get('杜甫'))?.length);

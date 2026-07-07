/**
 * One-time ingestion: pull REAL poets (name, dynasty, real poem count) from the
 * open chinese-poetry dataset and write scripts/real-poets.json.
 *
 * Sources (raw GitHub):
 *   全唐诗  poet.tang.{0..}.json      → dynasty 唐   (traditional → simplified)
 *   宋词    ci.song.{0..}.json        → dynasty 宋   (already simplified)
 *   宋诗    poet.song.{0..}.json      → dynasty 宋   (sampled, traditional)
 *
 * Names are aggregated to poem counts; traditional is converted to simplified.
 * Run: node scripts/fetch-poets.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as OpenCC from 'opencc-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/master';
const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 2) {
        console.warn(`  skip ${url}: ${e.message}`);
        return null;
      }
    }
  }
}

// counts: name(simplified) -> { count, dynasty }
const counts = new Map();
const ANON = new Set(['无名氏', '不详', '佚名', '无名', '阙名', '失名']);
function add(rawName, dynasty, convert) {
  if (!rawName) return;
  let name = convert ? t2s(rawName) : rawName;
  name = name.trim();
  // drop honorific/temple-style or overly long entries, keep plausible names
  if (!name || name.length < 2 || name.length > 5) return;
  if (/[^一-鿿]/.test(name)) return; // Chinese chars only
  if (ANON.has(name)) return; // drop anonymous / unknown authors
  const cur = counts.get(name);
  if (cur) cur.count++;
  else counts.set(name, { count: 1, dynasty });
}

async function ingestFile(path, dynasty, convert) {
  const arr = await getJson(`${BASE}/${path}`);
  if (!arr) return;
  for (const p of arr) add(p.author, dynasty, convert);
  console.log(`  ${path}: ${arr.length} poems`);
}

async function ingestShards(prefix, dynasty, convert, maxIndex, step = 1000) {
  let got = 0;
  for (let i = 0; i <= maxIndex; i += step) {
    const arr = await getJson(`${BASE}/${prefix}.${i}.json`);
    if (!arr) break;
    for (const p of arr) add(p.author, dynasty, convert);
    got += arr.length;
    if (i % 10000 === 0) process.stdout.write(`  ${prefix}.${i} (${got})\r`);
  }
  console.log(`  ${prefix}: ${got} poems`);
}

console.log('Fetching 全唐诗 …');
await ingestShards('全唐诗/poet.tang', '唐', true, 60000);
console.log('Fetching 宋词 …');
await ingestShards('宋词/ci.song', '宋', false, 30000);
console.log('Fetching 元曲 …');
await ingestFile('元曲/yuanqu.json', '元', false);
console.log('Fetching 楚辞 …');
await ingestFile('楚辞/chuci.json', '先秦', false);

const poets = [...counts.entries()]
  .map(([name, v]) => ({ name, dynasty: v.dynasty, poemCount: v.count }))
  .filter((p) => p.poemCount >= 2)
  .sort((a, b) => b.poemCount - a.poemCount);

const outPath = join(__dirname, 'real-poets.json');
writeFileSync(outPath, JSON.stringify(poets));
console.log(`\nWrote ${outPath}: ${poets.length} real poets`);
console.log('Top 10:', poets.slice(0, 10).map((p) => `${p.name}(${p.poemCount})`).join(' '));

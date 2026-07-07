import { useEffect, useState } from 'react';

export interface Poem {
  title: string;
  lines: string[];
}
type PoemMap = Record<string, Poem[]>;

let cache: PoemMap | null = null;
let inflight: Promise<PoemMap> | null = null;

/** Load the real-poems map (public/poems.json) once, lazily and cached. */
function loadPoems(): Promise<PoemMap> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch('poems.json')
      .then((r) => (r.ok ? r.json() : {}))
      .then((m: PoemMap) => {
        cache = m;
        return m;
      })
      .catch(() => ({}) as PoemMap);
  }
  return inflight;
}

/** Poems for one poet by name; loads the corpus on first use. */
export function usePoetPoems(name: string): Poem[] {
  const [poems, setPoems] = useState<Poem[]>(() => cache?.[name] ?? []);
  useEffect(() => {
    let cancelled = false;
    loadPoems().then((m) => {
      if (!cancelled) setPoems(m[name] ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);
  return poems;
}

import { useEffect, useState } from 'react';

export interface Poem {
  title: string;
  lines: string[];
}

// per-poet cache keyed by node id
const cache = new Map<string, Poem[]>();
const inflight = new Map<string, Promise<Poem[]>>();

function loadPoems(id: string): Promise<Poem[]> {
  const cached = cache.get(id);
  if (cached) return Promise.resolve(cached);
  let p = inflight.get(id);
  if (!p) {
    p = fetch(`poems/${id}.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Poem[]) => {
        cache.set(id, list);
        return list;
      })
      .catch(() => [] as Poem[]);
    inflight.set(id, p);
  }
  return p;
}

/** Complete works for one poet (by node id); fetched on demand and cached. */
export function usePoetPoems(id: string): { poems: Poem[]; loading: boolean } {
  const [poems, setPoems] = useState<Poem[]>(() => cache.get(id) ?? []);
  const [loading, setLoading] = useState(!cache.has(id));
  useEffect(() => {
    let cancelled = false;
    if (cache.has(id)) {
      setPoems(cache.get(id)!);
      setLoading(false);
      return;
    }
    setLoading(true);
    loadPoems(id).then((list) => {
      if (!cancelled) {
        setPoems(list);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return { poems, loading };
}

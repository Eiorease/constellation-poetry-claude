import { useEffect, useState } from 'react';
import type { GraphData } from '../types';

interface State {
  data: GraphData | null;
  error: string | null;
  loading: boolean;
}

async function loadGraphData(): Promise<GraphData> {
  try {
    // Relative URL so it also works when hosted under a sub-path.
    const res = await fetch('graph.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as GraphData;
  } catch {
    // fetch() is unavailable over file:// (opening dist/index.html directly);
    // fall back to the copy bundled into the build.
    const mod = await import('../data/graph.json');
    return mod.default as unknown as GraphData;
  }
}

export function useGraphData(): State {
  const [state, setState] = useState<State>({ data: null, error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    loadGraphData()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ data: null, error: err.message, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

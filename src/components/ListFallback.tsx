import { useMemo, useRef, useState } from 'react';
import {
  endpointId,
  RELATION_COLORS,
  type GraphData,
  type PoetNode,
} from '../types';

interface Props {
  data: GraphData;
  /** shown when WebGL is available and the user switched manually */
  onBackTo3D?: () => void;
}

/**
 * Accessible 2D fallback: a searchable, dynasty-grouped list of poets and
 * their relationships, for devices without WebGL or for screen-reader use.
 */
export function ListFallback({ data, onBackTo3D }: Props) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showTop, setShowTop] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const nodeById = useMemo(
    () => new Map(data.nodes.map((n) => [n.id, n])),
    [data.nodes],
  );

  const linksByNode = useMemo(() => {
    const m = new Map<string, typeof data.links>();
    for (const l of data.links) {
      for (const id of [endpointId(l.source), endpointId(l.target)]) {
        if (!m.has(id)) m.set(id, []);
        m.get(id)!.push(l);
      }
    }
    return m;
  }, [data.links]);

  const byDynasty = useMemo(() => {
    const q = query.trim();
    const filtered = data.nodes.filter(
      (n) => !q || n.name.includes(q) || (n.courtesyName && n.courtesyName.includes(q)),
    );
    const m = new Map<string, PoetNode[]>();
    for (const n of filtered) {
      if (!m.has(n.dynasty)) m.set(n.dynasty, []);
      m.get(n.dynasty)!.push(n);
    }
    for (const list of m.values()) list.sort((a, b) => b.poemCount - a.poemCount);
    return m;
  }, [data.nodes, query]);

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setShowTop(e.currentTarget.scrollTop > 400)}
      className="thin-scroll relative h-full overflow-y-auto bg-ink-950"
    >
      {/* sticky top bar: title + back button always visible (#6) */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-ink-200/10 bg-ink-950/90 px-4 py-3 backdrop-blur sm:px-8">
        <h1 className="text-lg tracking-[0.35em] text-moon sm:text-xl">诗人星图</h1>
        {onBackTo3D && (
          <button
            type="button"
            onClick={onBackTo3D}
            className="shrink-0 rounded-full border border-gold/40 px-4 py-1.5 text-xs tracking-widest text-gold hover:bg-gold/10"
          >
            返回三维星图
          </button>
        )}
      </div>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
        <p className="mb-6 text-center text-sm text-ink-400">
          中国古典诗人交游列表(2D 无障碍模式)
        </p>

        <input
          type="search"
          aria-label="搜索诗人"
          placeholder="搜索诗人 · 姓名或字"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="panel mb-8 w-full rounded-full px-5 py-2.5 text-sm text-ink-100 placeholder-ink-400 outline-none"
        />

        {[...byDynasty.entries()].map(([dynasty, poets]) => (
          <section key={dynasty} className="mb-8">
            <h2 className="mb-3 border-b border-ink-200/10 pb-2 text-lg tracking-[0.3em] text-gold/90">
              {dynasty}
              <span className="ml-3 text-xs text-ink-400">{poets.length} 人</span>
            </h2>
            <ul className="space-y-1">
              {poets.map((n) => {
                const links = linksByNode.get(n.id) ?? [];
                const isOpen = expanded === n.id;
                return (
                  <li key={n.id} className="rounded-lg bg-ink-900/60">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : n.id)}
                      className="flex w-full items-baseline justify-between px-4 py-2.5 text-left"
                    >
                      <span className="tracking-[0.2em] text-ink-100">{n.name}</span>
                      <span className="text-xs text-ink-400">
                        {n.courtesyName && `字${n.courtesyName} · `}存诗{' '}
                        {n.poemCount.toLocaleString()} · 交游 {links.length}
                      </span>
                    </button>
                    {isOpen && links.length > 0 && (
                      <ul className="space-y-2 px-4 pb-3">
                        {links.slice(0, 20).map((l, i) => {
                          const otherId =
                            endpointId(l.source) === n.id
                              ? endpointId(l.target)
                              : endpointId(l.source);
                          const other = nodeById.get(otherId);
                          return (
                            <li key={i} className="text-sm text-ink-200">
                              <span
                                className="mr-2 rounded-full px-1.5 py-px text-[10px]"
                                style={{
                                  color: RELATION_COLORS[l.type],
                                  border: `1px solid ${RELATION_COLORS[l.type]}44`,
                                }}
                              >
                                {l.type}
                              </span>
                              {other?.name}
                              {l.evidence[0] && (
                                <span className="ml-2 text-xs text-ink-400">
                                  《{l.evidence[0].title}》
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {/* quick scroll-to-top (bottom-right) */}
      {showTop && (
        <button
          type="button"
          onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="返回顶部"
          className="panel fixed bottom-6 right-6 z-20 rounded-full px-4 py-2.5 text-sm tracking-widest text-ink-200 hover:text-gold"
        >
          ↑ 顶部
        </button>
      )}
    </div>
  );
}

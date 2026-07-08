import { useEffect, useMemo, useRef, useState } from 'react';
import { DetailPanel } from './DetailPanel';
import { endpointId, type GraphData, type PoemLink, type PoetNode } from '../types';

interface Props {
  data: GraphData;
  /** shown when WebGL is available and the user switched manually */
  onBackTo3D?: () => void;
}

const PAGE_SIZES = [30, 50, 80, 100];

/**
 * Accessible 2D fallback: a searchable, paginated poet list. Clicking a poet
 * opens the same detail card used in the 3D view.
 */
export function ListFallback({ data, onBackTo3D }: Props) {
  const [query, setQuery] = useState('');
  const [pageSize, setPageSize] = useState(30);
  const [page, setPage] = useState(0);
  const [pageInput, setPageInput] = useState('');
  const [showTop, setShowTop] = useState(false);
  const [selected, setSelected] = useState<PoetNode | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const nodeById = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);

  const filtered = useMemo(() => {
    const q = query.trim();
    const list = data.nodes.filter(
      (n) => !q || n.name.includes(q) || (n.courtesyName && n.courtesyName.includes(q)),
    );
    // most prolific first, then by dynasty for a stable order
    return [...list].sort(
      (a, b) => b.poemCount - a.poemCount || a.dynasty.localeCompare(b.dynasty),
    );
  }, [data.nodes, query]);

  const linkCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of data.links) {
      m.set(endpointId(l.source), (m.get(endpointId(l.source)) ?? 0) + 1);
      m.set(endpointId(l.target), (m.get(endpointId(l.target)) ?? 0) + 1);
    }
    return m;
  }, [data.links]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => setPage(0), [query, pageSize]);
  const goPage = (p: number) => {
    setPage(Math.min(pageCount - 1, Math.max(0, p)));
    scrollRef.current?.scrollTo({ top: 0 });
  };
  const shown = filtered.slice(page * pageSize, page * pageSize + pageSize);

  const btn =
    'rounded-full border border-ink-200/15 px-3 py-1 text-xs tracking-wider text-ink-200 hover:text-gold disabled:opacity-30';

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setShowTop(e.currentTarget.scrollTop > 400)}
      className="thin-scroll relative h-full overflow-y-auto bg-ink-950"
    >
      {/* sticky top bar: title + back button always visible */}
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

      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
        <input
          type="search"
          aria-label="搜索诗人"
          placeholder="搜索诗人 · 姓名或字"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="panel mb-4 w-full rounded-full px-5 py-2.5 text-sm text-ink-100 placeholder-ink-400 outline-none"
        />

        {/* pagination controls (#1) */}
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs tracking-wider text-ink-400">
            共 {filtered.length.toLocaleString()} 位
          </span>
          <label className="flex items-center gap-1 text-xs text-ink-400">
            每页
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded-md bg-ink-800/70 px-2 py-1 text-ink-100 outline-none"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            条
          </label>
          {pageCount > 10 && (
            <button type="button" disabled={page === 0} onClick={() => goPage(0)} className={btn}>
              首页
            </button>
          )}
          <button type="button" disabled={page === 0} onClick={() => goPage(page - 1)} className={btn}>
            上一页
          </button>
          <span className="text-xs tracking-wider text-ink-300">
            第 {page + 1} / {pageCount} 页
          </span>
          <button
            type="button"
            disabled={page >= pageCount - 1}
            onClick={() => goPage(page + 1)}
            className={btn}
          >
            下一页
          </button>
          {pageCount > 10 && (
            <button
              type="button"
              disabled={page >= pageCount - 1}
              onClick={() => goPage(pageCount - 1)}
              className={btn}
            >
              尾页
            </button>
          )}
          <form
            className="ml-auto flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const p = parseInt(pageInput, 10);
              if (!Number.isNaN(p)) goPage(p - 1);
              setPageInput('');
            }}
          >
            <input
              type="number"
              min={1}
              max={pageCount}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              placeholder="页"
              aria-label="跳转到页"
              className="w-14 rounded-md bg-ink-800/70 px-2 py-1 text-center text-xs text-ink-100 outline-none placeholder-ink-400"
            />
            <button
              type="submit"
              className="rounded-md border border-gold/30 px-2.5 py-1 text-xs tracking-wider text-gold/90 hover:bg-gold/10"
            >
              跳转
            </button>
          </form>
        </div>

        <ul className="space-y-1">
          {shown.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => setSelected(n)}
                className="flex w-full items-baseline justify-between rounded-lg bg-ink-900/60 px-4 py-2.5 text-left hover:bg-ink-800/70"
              >
                <span className="tracking-[0.2em] text-ink-100">
                  {n.name}
                  <span className="ml-2 text-xs tracking-normal text-ink-400">{n.dynasty}</span>
                </span>
                <span className="text-xs text-ink-400">
                  {n.courtesyName && `字${n.courtesyName} · `}存诗{' '}
                  {n.poemCount.toLocaleString()} · 交游 {linkCount.get(n.id) ?? 0}
                </span>
              </button>
            </li>
          ))}
        </ul>
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

      {/* detail card overlay — same component as the 3D view (#2) */}
      {selected && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-ink-950/60 p-0 backdrop-blur-sm md:items-center md:p-6">
          <DetailPanel
            node={selected}
            links={data.links}
            nodeById={nodeById}
            groups={data.groups}
            onSelectNode={(node) => setSelected(node)}
            onSelectLink={(_l: PoemLink) => {}}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
    </div>
  );
}

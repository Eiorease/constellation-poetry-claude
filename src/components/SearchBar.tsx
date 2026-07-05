import { useEffect, useMemo, useRef, useState } from 'react';
import type { PoetNode } from '../types';

interface Props {
  nodes: PoetNode[];
  onSelect: (node: PoetNode) => void;
  /** called on any typing/focus, e.g. to pause the nebula rotation */
  onActivity?: () => void;
}

export function SearchBar({ nodes, onSelect, onActivity }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return nodes
      .filter((n) => n.name.includes(q) || (n.courtesyName && n.courtesyName.includes(q)))
      .sort((a, b) => b.poemCount - a.poemCount)
      .slice(0, 8);
  }, [query, nodes]);

  useEffect(() => setActive(0), [results]);

  // close on outside click
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  const choose = (n: PoetNode) => {
    onSelect(n);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative w-56 sm:w-64">
      <input
        type="search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-label="搜索诗人姓名或表字"
        value={query}
        placeholder="搜索诗人 · 姓名或字"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onActivity?.();
        }}
        onFocus={() => {
          setOpen(true);
          onActivity?.();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && results[active]) {
            choose(results[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="panel w-full rounded-full px-4 py-2 text-sm tracking-wider text-ink-100 placeholder-ink-400 outline-none focus:border-gold/40"
      />
      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="panel thin-scroll absolute top-full z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-xl py-1"
        >
          {results.map((n, i) => (
            <li key={n.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(n)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-baseline justify-between px-4 py-2 text-left text-sm ${
                  i === active ? 'bg-ink-700/70 text-moon' : 'text-ink-200'
                }`}
              >
                <span className="tracking-widest">{n.name}</span>
                <span className="text-xs text-ink-400">
                  {n.courtesyName ? `字${n.courtesyName} · ` : ''}
                  {n.dynasty}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

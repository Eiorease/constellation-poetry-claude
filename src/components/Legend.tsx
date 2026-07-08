import { useEffect, useState } from 'react';
import { RELATION_COLORS, RELATION_LABELS, type RelationType } from '../types';

const TYPES = Object.keys(RELATION_COLORS) as RelationType[];

export function Legend({ collapseSignal }: { collapseSignal?: number }) {
  const [open, setOpen] = useState(false); // collapsed by default
  useEffect(() => {
    if (collapseSignal !== undefined) setOpen(false);
  }, [collapseSignal]);

  return (
    <div className="panel pointer-events-auto rounded-2xl px-4 py-3">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-6 text-left text-xs tracking-[0.3em] text-ink-400"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        图例
        <span aria-hidden>{open ? '—' : '☰'}</span>
      </button>
      {open && (
        <ul className="mt-2.5 space-y-1.5">
          {TYPES.map((t) => (
            <li key={t} className="flex items-center gap-2.5 text-xs text-ink-200">
              <span
                aria-hidden
                className="inline-block h-px w-6"
                style={{ background: RELATION_COLORS[t], boxShadow: `0 0 6px ${RELATION_COLORS[t]}` }}
              />
              {RELATION_LABELS[t]}
            </li>
          ))}
          <li className="flex items-center gap-2.5 pt-1 text-xs text-ink-400">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-moon shadow-[0_0_8px_#e8e4d8]" />
            星球大小 ≈ 存诗数量
          </li>
          <li className="flex items-center gap-2.5 text-xs text-ink-400">
            <span aria-hidden className="inline-block h-px w-6 bg-ink-400" />
            诗派悬臂按朝代绕河心展开
          </li>
        </ul>
      )}
    </div>
  );
}

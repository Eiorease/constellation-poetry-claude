import { useMemo } from 'react';
import type { Filters } from './FilterBar';

/** Era buttons map to the dynasty strings that actually occur in the data. */
const ERAS: { label: string; match: string[] }[] = [
  { label: '先秦', match: ['先秦', '楚辞'] },
  { label: '汉魏', match: ['汉', '汉魏', '魏晋', '东晋'] },
  { label: '南北朝', match: ['南朝', '南北朝'] },
  { label: '唐', match: ['唐'] },
  { label: '宋', match: ['宋', '北宋', '南宋', '两宋之际'] },
  { label: '元', match: ['元'] },
  { label: '明', match: ['明'] },
  { label: '清', match: ['清', '近现代'] },
];

interface Props {
  allDynasties: string[];
  filters: Filters;
  onChange: (f: Filters) => void;
}

export function DynastyBar({ allDynasties, filters, onChange }: Props) {
  const eras = useMemo(() => {
    const present = new Set(allDynasties);
    return ERAS.map((e) => ({ ...e, match: e.match.filter((m) => present.has(m)) })).filter(
      (e) => e.match.length > 0,
    );
  }, [allDynasties]);

  const toggle = (match: string[]) => {
    const next = new Set(filters.dynasties);
    const active = match.some((m) => next.has(m));
    for (const m of match) {
      if (active) next.delete(m);
      else next.add(m);
    }
    onChange({ ...filters, dynasties: next });
  };

  return (
    <div className="panel thin-scroll pointer-events-auto flex max-w-[calc(100vw-1.5rem)] items-center gap-1 overflow-x-auto rounded-full px-2 py-1.5">
      {eras.map((e) => {
        const active = e.match.some((m) => filters.dynasties.has(m));
        return (
          <button
            key={e.label}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(e.match)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs tracking-widest transition-colors ${
              active
                ? 'bg-gold/85 text-ink-950'
                : 'text-ink-200 hover:bg-ink-700/70 hover:text-moon'
            }`}
          >
            {e.label}
          </button>
        );
      })}
    </div>
  );
}

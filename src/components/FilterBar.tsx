import { useState } from 'react';
import {
  RELATION_COLORS,
  type GroupInfo,
  type RelationType,
} from '../types';

export interface Filters {
  dynasties: Set<string>;
  types: Set<RelationType>;
  groups: Set<number>;
}

interface Props {
  allDynasties: string[];
  allTypes: RelationType[];
  groups: GroupInfo[];
  filters: Filters;
  onChange: (f: Filters) => void;
}

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

function Chip({
  active,
  label,
  color,
  onClick,
}: {
  active: boolean;
  label: string;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs tracking-wide transition-colors ${
        active
          ? 'border-ink-200/40 bg-ink-700/80 text-moon'
          : 'border-ink-200/10 bg-transparent text-ink-400 hover:text-ink-200'
      }`}
    >
      {color && (
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: color, opacity: active ? 1 : 0.45 }}
        />
      )}
      {label}
    </button>
  );
}

export function FilterBar({ allDynasties, allTypes, groups, filters, onChange }: Props) {
  const [collapsed, setCollapsed] = useState(
    typeof window !== 'undefined' && window.innerWidth < 768,
  );

  const activeCount = filters.dynasties.size + filters.types.size + filters.groups.size;

  return (
    <div className="panel pointer-events-auto max-w-[calc(100vw-2rem)] rounded-2xl px-4 py-3 sm:max-w-xs">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left text-sm tracking-[0.2em] text-ink-200"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span>
          筛选{activeCount > 0 && <span className="ml-2 text-xs text-gold">{activeCount}</span>}
        </span>
        <span className="text-ink-400">{collapsed ? '☰' : '—'}</span>
      </button>

      {!collapsed && (
        <div className="thin-scroll mt-3 max-h-[46vh] space-y-4 overflow-y-auto pr-1">
          <section>
            <h3 className="mb-2 text-xs tracking-[0.25em] text-ink-400">朝代</h3>
            <div className="flex flex-wrap gap-1.5">
              {allDynasties.map((d) => (
                <Chip
                  key={d}
                  label={d}
                  active={filters.dynasties.has(d)}
                  onClick={() =>
                    onChange({ ...filters, dynasties: toggle(filters.dynasties, d) })
                  }
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs tracking-[0.25em] text-ink-400">关系</h3>
            <div className="flex flex-wrap gap-1.5">
              {allTypes.map((t) => (
                <Chip
                  key={t}
                  label={t}
                  color={RELATION_COLORS[t]}
                  active={filters.types.has(t)}
                  onClick={() => onChange({ ...filters, types: toggle(filters.types, t) })}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs tracking-[0.25em] text-ink-400">星群</h3>
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => (
                <Chip
                  key={g.id}
                  label={g.name}
                  color={g.color}
                  active={filters.groups.has(g.id)}
                  onClick={() => onChange({ ...filters, groups: toggle(filters.groups, g.id) })}
                />
              ))}
            </div>
          </section>

          {activeCount > 0 && (
            <button
              type="button"
              className="text-xs tracking-widest text-gold/80 hover:text-gold"
              onClick={() =>
                onChange({ dynasties: new Set(), types: new Set(), groups: new Set() })
              }
            >
              清除全部筛选
            </button>
          )}
        </div>
      )}
    </div>
  );
}

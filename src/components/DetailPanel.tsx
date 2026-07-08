import { useEffect, useMemo, useState } from 'react';
import { usePoetPoems, type Poem } from '../hooks/usePoems';
import {
  endpointId,
  RELATION_COLORS,
  type GroupInfo,
  type PoemLink,
  type PoetNode,
} from '../types';

interface Props {
  node: PoetNode;
  links: PoemLink[];
  nodeById: Map<string, PoetNode>;
  groups: GroupInfo[];
  onSelectNode: (node: PoetNode) => void;
  onSelectLink: (link: PoemLink) => void;
  onClose: () => void;
}

export function DetailPanel({
  node,
  links,
  nodeById,
  groups,
  onSelectNode,
  onSelectLink,
  onClose,
}: Props) {
  const group = groups.find((g) => g.id === node.group);

  const connections = useMemo(() => {
    const rows: { other: PoetNode; link: PoemLink }[] = [];
    for (const l of links) {
      const s = endpointId(l.source);
      const t = endpointId(l.target);
      if (s !== node.id && t !== node.id) continue;
      const other = nodeById.get(s === node.id ? t : s);
      if (other) rows.push({ other, link: l });
    }
    rows.sort((a, b) => b.link.weight - a.link.weight);
    return rows;
  }, [links, node.id, nodeById]);

  // real works pulled from the chinese-poetry corpus (public/poems/<id>.json)
  const { poems, loading: poemsLoading } = usePoetPoems(node.id);
  const [showAll, setShowAll] = useState(false);
  const [openPoem, setOpenPoem] = useState<Poem | null>(null);
  useEffect(() => {
    setShowAll(false);
    setOpenPoem(null);
  }, [node.id]);
  const shownPoems = showAll ? poems : poems.slice(0, 5);

  return (
    <aside
      aria-label={`${node.name} 详情`}
      className="panel animate-panel-in pointer-events-auto flex max-h-[70vh] w-full flex-col rounded-t-2xl md:max-h-[calc(100vh-7rem)] md:w-96 md:rounded-2xl"
    >
      <header className="flex items-start justify-between px-5 pt-5">
        <div>
          <h2 className="text-2xl tracking-[0.3em] text-moon">{node.name}</h2>
          {node.code && (
            <p className="mt-1 font-mono text-[11px] tracking-[0.2em] text-gold/70">
              编号 {node.code}
            </p>
          )}
          {node.coord && (
            <p className="mt-0.5 font-mono text-[10px] tracking-wider text-ink-400">
              坐标 ({node.coord.x}, {node.coord.y}, {node.coord.z})
            </p>
          )}
          <p className="mt-1.5 text-xs tracking-wider text-ink-400">
            {node.courtesyName && <span>字{node.courtesyName} · </span>}
            {node.dynasty}
            {group && (
              <>
                {' · '}
                <span style={{ color: group.color }}>{group.name}</span>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭详情"
          className="-mr-1 -mt-1 rounded-full px-2 py-0.5 text-lg text-ink-400 hover:text-moon"
        >
          ✕
        </button>
      </header>

      <div className="thin-scroll mt-4 flex-1 space-y-5 overflow-y-auto px-5 pb-5">
        <dl className="flex gap-8 border-y border-ink-200/10 py-3">
          <div>
            <dt className="text-[11px] tracking-[0.25em] text-ink-400">存诗</dt>
            <dd className="mt-0.5 text-lg text-gold">{node.poemCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-[0.25em] text-ink-400">交游</dt>
            <dd className="mt-0.5 text-lg text-gold">{connections.length}</dd>
          </div>
          {node.generated && (
            <div className="self-end pb-1 text-[10px] tracking-wider text-ink-400">
              示例生成数据
            </div>
          )}
        </dl>

        {poemsLoading && poems.length === 0 && (
          <p className="text-xs tracking-widest text-ink-400">作品载入中 …</p>
        )}

        {poems.length > 0 && (
          <section>
            <h3 className="mb-2 flex items-baseline justify-between text-xs tracking-[0.3em] text-ink-400">
              <span>{showAll ? '作品全集' : '代表诗作'}</span>
              <span className="text-[10px] text-ink-400/70">共 {poems.length} 首</span>
            </h3>
            <ul className="space-y-1">
              {shownPoems.map((p, i) => {
                const isOpen = openPoem?.title === p.title;
                return (
                  <li key={`${p.title}-${i}`} className="rounded-lg bg-ink-800/40">
                    <button
                      type="button"
                      onClick={() => setOpenPoem(isOpen ? null : p)}
                      className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left"
                    >
                      <span className="text-sm tracking-wider text-moon">《{p.title}》</span>
                      <span className="shrink-0 text-[11px] text-ink-400">
                        {isOpen ? '收起' : '展开'}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="border-l-2 border-gold/30 px-3 pb-3 pl-3">
                        {p.lines.map((line, li) => (
                          <p key={li} className="text-[13px] leading-7 text-ink-100">
                            {line}
                          </p>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {poems.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAll((s) => !s)}
                className="mt-2.5 w-full rounded-full border border-gold/30 py-1.5 text-xs tracking-widest text-gold/90 hover:bg-gold/10"
              >
                {showAll ? '收起全集' : `查看全部 ${poems.length} 首作品 →`}
              </button>
            )}
          </section>
        )}

        <section>
          <h3 className="mb-2 text-xs tracking-[0.3em] text-ink-400">
            交游诗友 · {connections.length}
          </h3>
          <ul className="space-y-1">
            {connections.slice(0, 30).map(({ other, link }) => (
              <li key={`${other.id}-${link.type}`} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelectNode(other)}
                  className="shrink-0 text-sm tracking-widest text-ink-100 hover:text-gold"
                >
                  {other.name}
                </button>
                <button
                  type="button"
                  onClick={() => onSelectLink(link)}
                  title="查看关系详情"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className="rounded-full px-1.5 py-px text-[10px]"
                    style={{
                      color: RELATION_COLORS[link.type],
                      border: `1px solid ${RELATION_COLORS[link.type]}44`,
                    }}
                  >
                    {link.type}
                  </span>
                  <span
                    aria-hidden
                    className="h-px flex-1"
                    style={{
                      background: RELATION_COLORS[link.type],
                      opacity: 0.15 + link.weight * 0.08,
                    }}
                  />
                  <span className="text-[10px] text-ink-400">{link.weight}</span>
                </button>
              </li>
            ))}
            {connections.length > 30 && (
              <li className="pt-1 text-xs text-ink-400">…共 {connections.length} 位诗友</li>
            )}
          </ul>
        </section>
      </div>
    </aside>
  );
}

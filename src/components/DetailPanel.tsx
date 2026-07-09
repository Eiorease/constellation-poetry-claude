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
  /** if provided, tapping a poem opens it externally (a side card) instead of
   *  expanding inline; the active poem is highlighted */
  onOpenPoem?: (poem: Poem) => void;
  activePoemTitle?: string;
}

export function DetailPanel({
  node,
  links,
  nodeById,
  groups,
  onSelectNode,
  onSelectLink,
  onClose,
  onOpenPoem,
  activePoemTitle,
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
  const [page, setPage] = useState(0);
  const [pageInput, setPageInput] = useState('');
  const PAGE_SIZE = 20;
  const pageCount = Math.max(1, Math.ceil(poems.length / PAGE_SIZE));
  useEffect(() => {
    setShowAll(false);
    setOpenPoem(null);
    setPage(0);
  }, [node.id]);
  const goPage = (p: number) => {
    const clamped = Math.min(pageCount - 1, Math.max(0, p));
    setPage(clamped);
    setOpenPoem(null);
  };
  // collapsed: first 5 representative works; expanded: 20-per-page全集 (#4)
  const shownPoems = showAll
    ? poems.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
    : poems.slice(0, 5);

  return (
    <aside
      aria-label={`${node.name} 详情`}
      className="panel animate-panel-in pointer-events-auto relative flex max-h-[78vh] w-full flex-col rounded-t-2xl md:max-h-[calc(100vh-7rem)] md:w-96 md:rounded-2xl"
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

            {/* pagination controls (full-works view, 20 per page) — #4 */}
            {showAll && pageCount > 1 && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-300">
                {pageCount > 10 && (
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => goPage(0)}
                    className="rounded-full border border-ink-200/15 px-2.5 py-1 tracking-wider hover:text-gold disabled:opacity-30"
                  >
                    首页
                  </button>
                )}
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => goPage(page - 1)}
                  className="rounded-full border border-ink-200/15 px-2.5 py-1 tracking-wider hover:text-gold disabled:opacity-30"
                >
                  上一页
                </button>
                <span className="tracking-wider text-ink-400">
                  第 {page + 1} / {pageCount} 页
                </span>
                <button
                  type="button"
                  disabled={page >= pageCount - 1}
                  onClick={() => goPage(page + 1)}
                  className="rounded-full border border-ink-200/15 px-2.5 py-1 tracking-wider hover:text-gold disabled:opacity-30"
                >
                  下一页
                </button>
                {pageCount > 10 && (
                  <button
                    type="button"
                    disabled={page >= pageCount - 1}
                    onClick={() => goPage(pageCount - 1)}
                    className="rounded-full border border-ink-200/15 px-2.5 py-1 tracking-wider hover:text-gold disabled:opacity-30"
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
                    className="w-12 rounded-md bg-ink-800/70 px-2 py-1 text-center text-ink-100 outline-none placeholder-ink-400"
                  />
                  <button
                    type="submit"
                    className="rounded-md border border-gold/30 px-2 py-1 tracking-wider text-gold/90 hover:bg-gold/10"
                  >
                    跳转
                  </button>
                </form>
              </div>
            )}

            <ul className="space-y-1">
              {shownPoems.map((p, i) => {
                const external = Boolean(onOpenPoem);
                const isOpen = external
                  ? activePoemTitle === p.title
                  : openPoem?.title === p.title;
                return (
                  <li
                    key={`${p.title}-${i}`}
                    className={`rounded-lg ${isOpen ? 'bg-gold/10' : 'bg-ink-800/40'}`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        external ? onOpenPoem!(p) : setOpenPoem(isOpen ? null : p)
                      }
                      className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left"
                    >
                      <span className="text-sm tracking-wider text-moon">《{p.title}》</span>
                      <span className="shrink-0 text-[11px] text-ink-400">
                        {external ? '查看' : isOpen ? '收起' : '展开'}
                      </span>
                    </button>
                    {!external && isOpen && (
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
            {!showAll && poems.length > 5 && (
              <button
                type="button"
                onClick={() => {
                  setShowAll(true);
                  setPage(0);
                }}
                className="mt-2.5 w-full rounded-full border border-gold/30 py-1.5 text-xs tracking-widest text-gold/90 hover:bg-gold/10"
              >
                查看全部 {poems.length} 首作品 →
              </button>
            )}
            {/* extra bottom padding so content isn't hidden behind the floating
                collapse button */}
            {showAll && <div className="h-12" />}
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

      {/* floating "collapse全集" button pinned near the card bottom (#3) */}
      {showAll && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="panel absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-gold/40 px-5 py-2 text-xs tracking-widest text-gold/90 shadow-lg hover:bg-gold/10"
        >
          收起全集
        </button>
      )}
    </aside>
  );
}

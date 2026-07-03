import {
  endpointId,
  RELATION_COLORS,
  RELATION_LABELS,
  type PoemLink,
  type PoetNode,
} from '../types';

interface Props {
  link: PoemLink;
  nodeById: Map<string, PoetNode>;
  onSelectNode: (node: PoetNode) => void;
  onClose: () => void;
}

export function LinkPanel({ link, nodeById, onSelectNode, onClose }: Props) {
  const source = nodeById.get(endpointId(link.source));
  const target = nodeById.get(endpointId(link.target));
  const color = RELATION_COLORS[link.type];

  return (
    <aside
      aria-label="关系详情"
      className="panel animate-panel-in pointer-events-auto flex max-h-[70vh] w-full flex-col rounded-t-2xl md:max-h-[calc(100vh-7rem)] md:w-96 md:rounded-2xl"
    >
      <header className="flex items-start justify-between px-5 pt-5">
        <div>
          <h2 className="flex items-center gap-3 text-lg tracking-[0.2em] text-moon">
            {source && (
              <button
                type="button"
                className="hover:text-gold"
                onClick={() => onSelectNode(source)}
              >
                {source.name}
              </button>
            )}
            <span aria-hidden className="text-sm" style={{ color }}>
              ─◈─
            </span>
            {target && (
              <button
                type="button"
                className="hover:text-gold"
                onClick={() => onSelectNode(target)}
              >
                {target.name}
              </button>
            )}
          </h2>
          <p className="mt-2 text-xs tracking-wider text-ink-400">
            <span style={{ color }}>{RELATION_LABELS[link.type]}</span>
            {' · 情谊强度 '}
            <span className="text-gold">{link.weight}</span>/10
            {link.generated && ' · 示例生成数据'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭关系详情"
          className="-mr-1 -mt-1 rounded-full px-2 py-0.5 text-lg text-ink-400 hover:text-moon"
        >
          ✕
        </button>
      </header>

      <div className="thin-scroll mt-4 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
        <h3 className="text-xs tracking-[0.3em] text-ink-400">诗证 · {link.evidence.length}</h3>
        {link.evidence.map((ev, i) => (
          <article
            key={i}
            className="rounded-xl border border-ink-200/10 bg-ink-800/50 px-4 py-3.5"
          >
            <h4 className="text-sm tracking-wider text-moon">《{ev.title}》</h4>
            <p className="mt-0.5 text-[11px] tracking-widest text-ink-400">{ev.author} 作</p>
            {ev.content && (
              <p className="mt-2.5 border-l-2 pl-3 text-[13px] leading-7 text-ink-100" style={{ borderColor: `${color}66` }}>
                {ev.content}
              </p>
            )}
            {ev.relation && (
              <p className="mt-2 text-xs leading-5 text-ink-400">{ev.relation}</p>
            )}
          </article>
        ))}
      </div>
    </aside>
  );
}

import type { Poem } from '../hooks/usePoems';

interface Props {
  poem: Poem;
  author: string;
  onClose: () => void;
}

/** Floating card showing one poem's full text (used beside the list detail). */
export function PoemCard({ poem, author, onClose }: Props) {
  return (
    <aside
      aria-label={`${poem.title} 全文`}
      className="panel animate-panel-in pointer-events-auto flex max-h-[70vh] w-full flex-col rounded-t-2xl md:max-h-[calc(100vh-7rem)] md:w-80 md:rounded-2xl"
    >
      <header className="flex items-start justify-between px-5 pt-5">
        <div>
          <h3 className="text-lg tracking-[0.2em] text-moon">《{poem.title}》</h3>
          <p className="mt-1 text-[11px] tracking-widest text-ink-400">{author} 作</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭作品"
          className="-mr-1 -mt-1 rounded-full px-2 py-0.5 text-lg text-ink-400 hover:text-moon"
        >
          ✕
        </button>
      </header>
      <div className="thin-scroll mt-4 flex-1 overflow-y-auto px-5 pb-5">
        {poem.lines.map((line, i) => (
          <p key={i} className="text-[15px] leading-9 tracking-wide text-ink-100">
            {line}
          </p>
        ))}
      </div>
    </aside>
  );
}

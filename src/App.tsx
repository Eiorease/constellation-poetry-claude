import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DetailPanel } from './components/DetailPanel';
import { FilterBar, type Filters } from './components/FilterBar';
import { Legend } from './components/Legend';
import { LinkPanel } from './components/LinkPanel';
import { ListFallback } from './components/ListFallback';
import { SearchBar } from './components/SearchBar';
import { linkKey, StarMap, type StarMapApi } from './components/StarMap';
import { useGraphData } from './hooks/useGraphData';
import { useWebGLSupport } from './hooks/useWebGLSupport';
import { endpointId, type PoemLink, type PoetNode, type RelationType } from './types';

const EMPTY_SET: ReadonlySet<string> = new Set();

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

export default function App() {
  const { data, error, loading } = useGraphData();
  const webglOk = useWebGLSupport();
  const [listMode, setListMode] = useState(false);
  const { w, h } = useWindowSize();

  const [filters, setFilters] = useState<Filters>({
    dynasties: new Set(),
    types: new Set(),
    groups: new Set(),
  });
  const [selectedNode, setSelectedNode] = useState<PoetNode | null>(null);
  const [selectedLink, setSelectedLink] = useState<PoemLink | null>(null);
  const apiRef = useRef<StarMapApi | null>(null);

  const nodeById = useMemo(
    () => new Map((data?.nodes ?? []).map((n) => [n.id, n])),
    [data],
  );

  const allDynasties = useMemo(() => {
    const seen: string[] = [];
    for (const n of data?.nodes ?? []) if (!seen.includes(n.dynasty)) seen.push(n.dynasty);
    return seen;
  }, [data]);

  // honest breakdown: only a curated core are documented real poets; the rest
  // are procedurally generated demo stars
  const counts = useMemo(() => {
    const nodes = data?.nodes ?? [];
    const links = data?.links ?? [];
    const realPoets = nodes.filter((n) => !n.generated).length;
    const realLinks = links.filter((l) => !l.generated).length;
    return { realPoets, total: nodes.length, realLinks, totalLinks: links.length };
  }, [data]);

  const allTypes = useMemo(() => {
    const seen: RelationType[] = [];
    for (const l of data?.links ?? []) if (!seen.includes(l.type)) seen.push(l.type);
    return seen;
  }, [data]);

  // --- filter → highlight sets (nodes are never removed from the graph:
  // matching content is highlighted, the rest is dimmed by 60%) -------------
  const filterNodeIds = useMemo<ReadonlySet<string> | null>(() => {
    if (!data) return null;
    const { dynasties, groups } = filters;
    if (dynasties.size === 0 && groups.size === 0) return null;
    const ids = new Set<string>();
    for (const n of data.nodes) {
      if (
        (dynasties.size === 0 || dynasties.has(n.dynasty)) &&
        (groups.size === 0 || groups.has(n.group))
      ) {
        ids.add(n.id);
      }
    }
    return ids;
  }, [data, filters]);

  const filterTypes = useMemo<ReadonlySet<RelationType> | null>(
    () => (filters.types.size > 0 ? filters.types : null),
    [filters],
  );

  // --- highlight sets --------------------------------------------------------
  const { highlightNodeIds, highlightLinkKeys } = useMemo(() => {
    if (selectedNode) {
      const nodeIds = new Set<string>([selectedNode.id]);
      const linkKeys = new Set<string>();
      for (const l of data?.links ?? []) {
        const s = endpointId(l.source);
        const t = endpointId(l.target);
        if (s === selectedNode.id || t === selectedNode.id) {
          nodeIds.add(s);
          nodeIds.add(t);
          linkKeys.add(linkKey(l));
        }
      }
      return { highlightNodeIds: nodeIds as ReadonlySet<string>, highlightLinkKeys: linkKeys as ReadonlySet<string> };
    }
    if (selectedLink) {
      return {
        highlightNodeIds: new Set([
          endpointId(selectedLink.source),
          endpointId(selectedLink.target),
        ]) as ReadonlySet<string>,
        highlightLinkKeys: new Set([linkKey(selectedLink)]) as ReadonlySet<string>,
      };
    }
    return { highlightNodeIds: EMPTY_SET, highlightLinkKeys: EMPTY_SET };
  }, [selectedNode, selectedLink, data]);

  // --- interaction handlers --------------------------------------------------
  const handleNodeClick = useCallback((node: PoetNode) => {
    setSelectedLink(null);
    setSelectedNode(node);
    apiRef.current?.focusNode(node);
  }, []);

  const handleLinkClick = useCallback((link: PoemLink) => {
    setSelectedNode(null);
    setSelectedLink(link);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedNode(null);
    setSelectedLink(null);
    // returning from a selection restores the initial framing (req 2)
    apiRef.current?.resetCamera();
  }, []);

  const handleSearchSelect = useCallback(
    (node: PoetNode) => {
      handleNodeClick(node);
    },
    [handleNodeClick],
  );

  // --- render ---------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="animate-pulse text-sm tracking-[0.5em] text-ink-400">观 星 中 …</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div>
          <p className="text-lg tracking-widest text-moon">星图数据加载失败</p>
          <p className="mt-2 text-sm text-ink-400">{error ?? '未知错误'}</p>
          <p className="mt-1 text-xs text-ink-400">请确认 public/graph.json 存在(npm run generate-data)</p>
        </div>
      </div>
    );
  }

  if (!webglOk || listMode) {
    return (
      <ListFallback data={data} onBackTo3D={webglOk ? () => setListMode(false) : undefined} />
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* 3D star map */}
      <StarMap
        nodes={data.nodes}
        links={data.links}
        groups={data.groups}
        selectedNodeId={selectedNode?.id ?? null}
        selectedLink={selectedLink}
        highlightNodeIds={highlightNodeIds}
        highlightLinkKeys={highlightLinkKeys}
        filterNodeIds={filterNodeIds}
        filterTypes={filterTypes}
        onNodeClick={handleNodeClick}
        onLinkClick={handleLinkClick}
        onBackgroundClick={clearSelection}
        apiRef={apiRef}
        width={w}
        height={h}
      />

      {/* Header */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-3 px-4 pt-5 sm:flex-row sm:justify-between sm:px-6">
        <div className="animate-fade-in text-center sm:text-left">
          <h1 className="text-xl tracking-[0.5em] text-moon drop-shadow-[0_0_12px_rgba(232,194,104,0.25)] sm:text-2xl">
            诗人星图
          </h1>
          <p className="mt-1 hidden text-[11px] tracking-[0.3em] text-ink-400 sm:block">
            千年唱和 · 星汉灿烂 — {counts.realPoets.toLocaleString()} 位真实诗人
          </p>
          <p className="mt-0.5 hidden text-[10px] tracking-[0.2em] text-ink-400/70 sm:block">
            {counts.realLinks} 段文献实证交游 · 余为示意关系
          </p>
        </div>
        <div className="pointer-events-auto">
          <SearchBar
            nodes={data.nodes}
            onSelect={handleSearchSelect}
            onActivity={() => apiRef.current?.notifyInteraction()}
          />
        </div>
      </header>

      {/* Filters (top-left, below header on mobile) */}
      <div className="pointer-events-none absolute left-4 top-32 z-10 sm:left-6 sm:top-24">
        <FilterBar
          allDynasties={allDynasties}
          allTypes={allTypes}
          groups={data.groups}
          filters={filters}
          onChange={setFilters}
        />
      </div>

      {/* Legend (bottom-left) */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 sm:bottom-6 sm:left-6">
        <Legend />
      </div>

      {/* Camera / mode controls (bottom-right) */}
      <div className="pointer-events-auto absolute bottom-4 right-4 z-10 flex flex-col items-end gap-2 sm:bottom-6 sm:right-6">
        <button
          type="button"
          onClick={() => {
            clearSelection();
            apiRef.current?.resetCamera();
          }}
          className="panel rounded-full px-4 py-2 text-xs tracking-[0.25em] text-ink-200 hover:text-gold"
          title="重置视角"
        >
          ◎ 重置视角
        </button>
        <button
          type="button"
          onClick={() => setListMode(true)}
          className="panel rounded-full px-4 py-2 text-xs tracking-[0.25em] text-ink-400 hover:text-ink-100"
          title="切换到无障碍列表模式"
        >
          ☰ 列表模式
        </button>
      </div>

      {/* Right-side detail panels (bottom sheet on mobile) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-0 md:inset-x-auto md:right-6 md:top-24 md:bottom-auto md:px-0">
        {selectedNode && (
          <DetailPanel
            node={selectedNode}
            links={data.links}
            nodeById={nodeById}
            groups={data.groups}
            onSelectNode={handleNodeClick}
            onSelectLink={handleLinkClick}
            onClose={clearSelection}
          />
        )}
        {selectedLink && (
          <LinkPanel
            link={selectedLink}
            nodeById={nodeById}
            onSelectNode={handleNodeClick}
            onClose={clearSelection}
          />
        )}
      </div>
    </div>
  );
}

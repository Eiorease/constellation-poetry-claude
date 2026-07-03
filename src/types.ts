export type RelationType = '赠诗' | '唱和' | '送别' | '悼亡' | '提及';

export interface Evidence {
  title: string;
  author: string;
  content: string;
  relation: string;
}

export interface PoetNode {
  id: string;
  name: string;
  courtesyName: string;
  dynasty: string;
  poemCount: number;
  group: number;
  generated?: boolean;
  x: number;
  y: number;
  z: number;
  // populated by force-graph at runtime
  fx?: number;
  fy?: number;
  fz?: number;
}

export interface PoemLink {
  source: string | PoetNode;
  target: string | PoetNode;
  weight: number;
  type: RelationType;
  evidence: Evidence[];
  generated?: boolean;
}

export interface GroupInfo {
  id: number;
  name: string;
  color: string;
}

export interface GraphData {
  meta: {
    title: string;
    description: string;
    nodeCount: number;
    linkCount: number;
  };
  groups: GroupInfo[];
  nodes: PoetNode[];
  links: PoemLink[];
}

/** Resolve a link endpoint to its node id (force-graph swaps ids for object refs). */
export function endpointId(end: string | PoetNode): string {
  return typeof end === 'string' ? end : end.id;
}

export const RELATION_COLORS: Record<RelationType, string> = {
  赠诗: '#e8c268',
  唱和: '#6fd3c7',
  送别: '#7da7d9',
  悼亡: '#b8a9e0',
  提及: '#8a8fa3',
};

export const RELATION_LABELS: Record<RelationType, string> = {
  赠诗: '赠诗 · Gifted poem',
  唱和: '唱和 · Poetic reply',
  送别: '送别 · Farewell',
  悼亡: '悼亡 · Memorial',
  提及: '提及 · Mention',
};

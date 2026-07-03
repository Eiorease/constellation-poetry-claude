import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import SpriteText from 'three-spritetext';
import {
  endpointId,
  RELATION_COLORS,
  type GroupInfo,
  type PoemLink,
  type PoetNode,
} from '../types';

export interface StarMapApi {
  focusNode: (node: PoetNode) => void;
  resetCamera: () => void;
}

interface Props {
  nodes: PoetNode[];
  links: PoemLink[];
  groups: GroupInfo[];
  selectedNodeId: string | null;
  selectedLink: PoemLink | null;
  /** node ids highlighted (selected node + first-degree neighbours) */
  highlightNodeIds: ReadonlySet<string>;
  /** link keys "src|tgt" highlighted */
  highlightLinkKeys: ReadonlySet<string>;
  onNodeClick: (node: PoetNode) => void;
  onLinkClick: (link: PoemLink) => void;
  onBackgroundClick: () => void;
  apiRef: React.MutableRefObject<StarMapApi | null>;
  width: number;
  height: number;
}

export function linkKey(l: PoemLink): string {
  const a = endpointId(l.source);
  const b = endpointId(l.target);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const WHITE = new THREE.Color('#ffffff');
const DEFAULT_CAMERA_DISTANCE = 620;

function nodeRadius(n: PoetNode): number {
  return Math.min(1.7 + Math.cbrt(n.poemCount) * 0.34, 6.4);
}

/** Soft radial glow texture shared by every halo sprite. */
function makeHaloTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.28)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface NodeVisual {
  node: PoetNode;
  sphereMat: THREE.MeshBasicMaterial;
  haloMat: THREE.SpriteMaterial;
  label: SpriteText;
  baseColor: THREE.Color;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function StarMapInner({
  nodes,
  links,
  groups,
  selectedNodeId,
  selectedLink,
  highlightNodeIds,
  highlightLinkKeys,
  onNodeClick,
  onLinkClick,
  onBackgroundClick,
  apiRef,
  width,
  height,
}: Props) {
  const fgRef = useRef<ForceGraphMethods<PoetNode, PoemLink> | undefined>(undefined);
  const visualsRef = useRef<Map<string, NodeVisual>>(new Map());
  const haloTexture = useMemo(makeHaloTexture, []);
  const groupColor = useMemo(() => {
    const m = new Map<number, string>();
    groups.forEach((g) => m.set(g.id, g.color));
    return m;
  }, [groups]);

  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  // --- one-time scene setup: bloom, starfield, fog, camera intro -----------
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__fg = fg;

    const bloom = new UnrealBloomPass(new THREE.Vector2(1024, 1024), 0.75, 0.35, 0.12);
    fg.postProcessingComposer().addPass(bloom);

    const scene = fg.scene();
    scene.fog = new THREE.FogExp2(0x04050c, 0.00012);

    // Distant starfield particles.
    const starCount = 1600;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 1200 + Math.random() * 1800;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0x9aa3c7,
      size: 1.6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // Start far out; we glide in with zoomToFit once the layout settles.
    fg.cameraPosition({ x: 0, y: 0, z: DEFAULT_CAMERA_DISTANCE * 2.4 });

    // The initial requestAnimationFrame can be dropped if the tab is hidden
    // or still loading when the graph mounts, leaving a stale handle that
    // resumeAnimation() alone won't fix. Kick the loop by cycling pause/resume.
    const kick = () => {
      fg.pauseAnimation();
      fg.resumeAnimation();
    };
    const kickTimer = setTimeout(kick, 50);
    const onVisible = () => {
      if (!document.hidden) kick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearTimeout(kickTimer);
      document.removeEventListener('visibilitychange', onVisible);
      fg.postProcessingComposer().removePass(bloom);
      scene.remove(stars);
      starGeo.dispose();
      starMat.dispose();
    };
  }, []);

  // --- link force: stronger relationship => shorter link -------------------
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const linkForce = fg.d3Force('link') as
      | { distance: (fn: (l: PoemLink) => number) => void }
      | undefined;
    linkForce?.distance((l: PoemLink) => 95 - l.weight * 7.5);
    fg.d3ReheatSimulation();
  }, [graphData]);

  // --- node objects: glowing planet + halo + label --------------------------
  const nodeThreeObject = useCallback(
    (node: PoetNode) => {
      const color = new THREE.Color(groupColor.get(node.group) ?? '#8ecae6');
      const r = nodeRadius(node);
      const g = new THREE.Group();

      const sphereMat = new THREE.MeshBasicMaterial({ color: color.clone(), transparent: true });
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 16), sphereMat);
      g.add(sphere);

      const haloMat = new THREE.SpriteMaterial({
        map: haloTexture,
        color: color.clone(),
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(r * 7, r * 7, 1);
      g.add(halo);

      const label = new SpriteText(node.name, 3.6, '#dde0ee');
      label.fontFace = '"Noto Serif SC", "Songti SC", serif';
      label.fontWeight = '500';
      label.position.set(0, -(r + 4.5), 0);
      label.material.depthWrite = false;
      label.visible = !node.generated;
      g.add(label);

      visualsRef.current.set(node.id, {
        node,
        sphereMat,
        haloMat,
        label,
        baseColor: color,
      });
      return g;
    },
    [groupColor, haloTexture],
  );

  // --- imperative highlight styling (no object rebuild) ---------------------
  useEffect(() => {
    const hasSelection = highlightNodeIds.size > 0;
    for (const [id, v] of visualsRef.current) {
      const isLit = highlightNodeIds.has(id);
      const isSelected = id === selectedNodeId;
      if (!hasSelection) {
        v.sphereMat.color.copy(v.baseColor);
        v.sphereMat.opacity = 1;
        v.haloMat.color.copy(v.baseColor);
        v.haloMat.opacity = 0.35;
        v.label.visible = !v.node.generated;
        v.label.color = '#dde0ee';
      } else if (isSelected) {
        v.sphereMat.color.copy(v.baseColor).lerp(WHITE, 0.55);
        v.sphereMat.opacity = 1;
        v.haloMat.color.copy(v.baseColor).lerp(WHITE, 0.3);
        v.haloMat.opacity = 0.8;
        v.label.visible = true;
        v.label.color = '#ffffff';
      } else if (isLit) {
        v.sphereMat.color.copy(v.baseColor).lerp(WHITE, 0.15);
        v.sphereMat.opacity = 1;
        v.haloMat.color.copy(v.baseColor);
        v.haloMat.opacity = 0.5;
        v.label.visible = true;
        v.label.color = '#dde0ee';
      } else {
        v.sphereMat.color.copy(v.baseColor).multiplyScalar(0.22);
        v.sphereMat.opacity = 0.35;
        v.haloMat.opacity = 0.04;
        v.label.visible = false;
      }
    }
  }, [highlightNodeIds, selectedNodeId, graphData]);

  // Drop stale visual registry entries when the node set changes.
  useEffect(() => {
    const ids = new Set(nodes.map((n) => n.id));
    for (const id of visualsRef.current.keys()) {
      if (!ids.has(id)) visualsRef.current.delete(id);
    }
  }, [nodes]);

  // --- link styling ----------------------------------------------------------
  const selectionActive = highlightNodeIds.size > 0 || selectedLink !== null;

  const linkColor = useCallback(
    (l: PoemLink) => {
      const base = RELATION_COLORS[l.type] ?? '#8a8fa3';
      if (l === selectedLink) return hexToRgba(base, 1);
      if (selectionActive) {
        return highlightLinkKeys.has(linkKey(l))
          ? hexToRgba(base, 0.9)
          : hexToRgba(base, 0.03);
      }
      // brighter with weight
      return hexToRgba(base, 0.05 + (l.weight / 10) * 0.28);
    },
    [selectionActive, highlightLinkKeys, selectedLink],
  );

  const linkWidth = useCallback(
    (l: PoemLink) =>
      l === selectedLink || (selectionActive && highlightLinkKeys.has(linkKey(l))) ? 1.1 : 0,
    [selectionActive, highlightLinkKeys, selectedLink],
  );

  const linkParticles = useCallback(
    (l: PoemLink) =>
      l === selectedLink || (selectionActive && highlightLinkKeys.has(linkKey(l))) ? 2 : 0,
    [selectionActive, highlightLinkKeys, selectedLink],
  );

  // --- camera API ------------------------------------------------------------
  // Frame the whole graph: aim at the bbox centre (zoomToFit always aims at the
  // origin, which mis-frames offset subgraphs after filtering).
  const fitCameraToGraph = useCallback((duration: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    const bbox = fg.getGraphBbox();
    if (!bbox) return;
    const cx = (bbox.x[0] + bbox.x[1]) / 2;
    const cy = (bbox.y[0] + bbox.y[1]) / 2;
    const cz = (bbox.z[0] + bbox.z[1]) / 2;
    const radius =
      Math.max(bbox.x[1] - bbox.x[0], bbox.y[1] - bbox.y[0], bbox.z[1] - bbox.z[0]) / 2 || 120;
    const camera = fg.camera() as THREE.PerspectiveCamera;
    const fitDist =
      (radius / Math.tan(((camera.fov / 2) * Math.PI) / 180) / Math.min(1, camera.aspect || 1)) *
      1.18;
    fg.cameraPosition(
      { x: cx, y: cy + fitDist * 0.08, z: cz + fitDist },
      { x: cx, y: cy, z: cz },
      duration,
    );
  }, []);

  useEffect(() => {
    apiRef.current = {
      focusNode: (node: PoetNode) => {
        const fg = fgRef.current;
        if (!fg) return;
        const { x = 0, y = 0, z = 0 } = node;
        const dist = Math.hypot(x, y, z) || 1;
        const ratio = 1 + 170 / dist;
        fg.cameraPosition({ x: x * ratio, y: y * ratio, z: z * ratio }, { x, y, z }, 1100);
      },
      resetCamera: () => fitCameraToGraph(1100),
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, fitCameraToGraph]);

  // Glide the camera to frame the whole constellation after the first layout.
  const didIntroRef = useRef(false);
  const handleEngineStop = useCallback(() => {
    if (didIntroRef.current) return;
    didIntroRef.current = true;
    fitCameraToGraph(2000);
  }, [fitCameraToGraph]);

  const nodeLabel = useCallback((n: PoetNode) => {
    const cy = n.courtesyName ? `字${n.courtesyName} · ` : '';
    return `${n.name} 〔${cy}${n.dynasty}〕`;
  }, []);

  return (
    <ForceGraph3D
      ref={fgRef}
      width={width}
      height={height}
      graphData={graphData}
      backgroundColor="#04050c"
      showNavInfo={false}
      warmupTicks={70}
      cooldownTicks={180}
      onEngineStop={handleEngineStop}
      d3VelocityDecay={0.35}
      nodeThreeObject={nodeThreeObject}
      nodeLabel={nodeLabel}
      onNodeClick={onNodeClick}
      linkColor={linkColor}
      linkWidth={linkWidth}
      linkOpacity={1}
      linkDirectionalParticles={linkParticles}
      linkDirectionalParticleWidth={1.4}
      linkDirectionalParticleSpeed={0.006}
      onLinkClick={onLinkClick}
      onBackgroundClick={onBackgroundClick}
      enableNodeDrag={false}
    />
  );
}

export const StarMap = memo(StarMapInner);

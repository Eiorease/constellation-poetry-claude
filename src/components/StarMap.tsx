import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
  /** signal user activity (e.g. typing in search) to pause the nebula rotation */
  notifyInteraction: () => void;
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
  return Math.min(1.1 + Math.cbrt(n.poemCount) * 0.2, 3.2);
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

/**
 * Deep-space dark-field backdrop: near-black, with a few very faint realistic
 * nebula patches painted in (~80% dimmer than the foreground), so the poets'
 * aggregated star points form the main nebula body themselves.
 */
function makeSpaceBackgroundTexture(): THREE.Texture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size * 0.5, size * 0.42, 0, size * 0.5, size * 0.42, size * 0.8);
  g.addColorStop(0, '#070c1e');
  g.addColorStop(0.5, '#03060f');
  g.addColorStop(1, '#010207');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // faint realistic nebula patches: layered soft blobs, heavily dimmed
  const patches = [
    { hue: '58,63,102', x: 0.22, y: 0.3, r: 0.34, a: 0.07 }, // violet-blue
    { hue: '44,74,82', x: 0.78, y: 0.62, r: 0.3, a: 0.055 }, // teal
    { hue: '74,59,40', x: 0.6, y: 0.16, r: 0.24, a: 0.05 }, // amber
    { hue: '70,48,72', x: 0.16, y: 0.78, r: 0.26, a: 0.045 }, // dim magenta
  ];
  for (const p of patches) {
    for (let i = 0; i < 7; i++) {
      const bx = (p.x + (Math.random() - 0.5) * p.r * 0.9) * size;
      const by = (p.y + (Math.random() - 0.5) * p.r * 0.9) * size;
      const br = p.r * size * (0.25 + Math.random() * 0.45);
      const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      bg.addColorStop(0, `rgba(${p.hue},${p.a * (0.5 + Math.random() * 0.5)})`);
      bg.addColorStop(1, `rgba(${p.hue},0)`);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Wispy cloud texture for nebula sprites: layered soft blobs inside a radial mask. */
function makeNebulaTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const blobs = 16;
  for (let i = 0; i < blobs; i++) {
    // gaussian-ish placement around the centre
    const cx = size / 2 + (Math.random() + Math.random() - 1) * size * 0.28;
    const cy = size / 2 + (Math.random() + Math.random() - 1) * size * 0.28;
    const r = size * (0.1 + Math.random() * 0.24);
    const a = 0.05 + Math.random() * 0.12;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // fade everything out toward the edges so sprites never show a hard border
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  mask.addColorStop(0, 'rgba(255,255,255,1)');
  mask.addColorStop(0.65, 'rgba(255,255,255,0.55)');
  mask.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 4-point diffraction-spike star, like bright foreground stars in astrophotos. */
function makeSpikeStarTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighter';
  const drawArm = (rot: number, len: number, thin: number) => {
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(rot);
    ctx.scale(1, thin);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, len);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, len, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  drawArm(0, size * 0.48, 0.035);
  drawArm(Math.PI / 2, size * 0.48, 0.035);
  // soft core glow
  const core = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.12);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const STAR_TINTS = ['#dfe6ff', '#aebfff', '#fff2d0', '#ffd9a0', '#9aa3c7'];
// star-dust tints: golden-orange particle sea as the main body, with cool
// group-tinted regions, sparse pink accents and bright platinum grains
const DUST_AMBER = new THREE.Color('#f5b45e');
const DUST_COOL = new THREE.Color('#c8d6f2');
const DUST_PINK = new THREE.Color('#e79ac4');
const DUST_BRIGHT = new THREE.Color('#fff3dd');
// energy-tide stream tints (ice blue → teal → lake blue toward the core)
const TIDE_ICE = new THREE.Color('#c6ecff');
const TIDE_TEAL = new THREE.Color('#6fd3c7');
const TIDE_LAKE = new THREE.Color('#7db8e8');

/** Random star positions on a shell, with per-vertex warm/cool tints. */
function makeStarField(
  count: number,
  rMin: number,
  rMax: number,
): { positions: Float32Array; colors: Float32Array } {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const r = rMin + Math.random() * (rMax - rMin);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    c.set(STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)]);
    // vary brightness so the field doesn't look uniform
    c.multiplyScalar(0.45 + Math.random() * 0.55);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  return { positions, colors };
}

interface NodeVisual {
  node: PoetNode;
  obj: THREE.Group;
  sphereMat: THREE.MeshBasicMaterial;
  haloMat: THREE.SpriteMaterial;
  label: SpriteText;
  baseColor: THREE.Color;
}

/**
 * Differential-rotation state, galaxy style: the disc is split into radial
 * rings ("分层"); each ring rotates rigidly around the galactic core, inner
 * rings faster (~13 min/rev) and outer rings slower (~24 min/rev), so the
 * spiral arms shear very slowly like a real galaxy.
 */
interface RotationState {
  center: THREE.Vector3;
  rings: Map<number, { omega: number; theta: number; pivot: THREE.Group | null }>;
  orbits: Map<string, { base: THREE.Vector3; ring: number }>;
  /** smoothed speed factor 0..1: drops to 0 instantly, ramps back gradually */
  speed: number;
  lastInteract: number;
  linksDirty: boolean;
}

const RING_COUNT = 6;

/** center-weighted random in ~[-1.5, 1.5] */
const gauss3 = () => Math.random() + Math.random() + Math.random() - 1.5;

const ROTATION_IDLE_DELAY = 2000; // ms of stillness before resuming
const ROTATION_RAMP_SECONDS = 2.5; // gradual spin-up time

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
  const nebulaGroupRef = useRef<THREE.Group | null>(null);
  const rotationRef = useRef<RotationState>({
    center: new THREE.Vector3(),
    rings: new Map(),
    orbits: new Map(),
    speed: 0,
    lastInteract: 0,
    linksDirty: false,
  });
  const selectionActiveRef = useRef(false);
  const prefersReducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const bloomRef = useRef<UnrealBloomPass | null>(null);
  const haloTexture = useMemo(makeHaloTexture, []);
  const nebulaTexture = useMemo(makeNebulaTexture, []);
  const spikeTexture = useMemo(makeSpikeStarTexture, []);

  const notifyInteraction = useCallback(() => {
    rotationRef.current.lastInteract = performance.now();
    rotationRef.current.speed = 0; // pause immediately
  }, []);
  const groupColor = useMemo(() => {
    const m = new Map<number, string>();
    groups.forEach((g) => m.set(g.id, g.color));
    return m;
  }, [groups]);
  const groupName = useMemo(() => {
    const m = new Map<number, string>();
    groups.forEach((g) => m.set(g.id, g.name));
    return m;
  }, [groups]);

  const graphData = useMemo(() => {
    // Pin every node at its spiral-arm position: the galaxy layout comes from
    // the data, not the force simulation (rotation still moves x/z visually).
    for (const n of nodes) {
      n.fx = n.x;
      n.fy = n.y;
      n.fz = n.z;
    }
    return { nodes, links };
  }, [nodes, links]);

  // --- one-time scene setup: bloom, starfield, fog, camera intro -----------
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__fg = fg;

    // Soft, luminous astrophoto glow; strength is adapted to camera distance
    // every frame (see effect below) so close-ups don't blow out white.
    const bloom = new UnrealBloomPass(new THREE.Vector2(1024, 1024), 0.85, 0.55, 0.22);
    fg.postProcessingComposer().addPass(bloom);
    bloomRef.current = bloom;

    const scene = fg.scene();
    const backdrop = makeSpaceBackgroundTexture();
    scene.background = backdrop;
    scene.fog = new THREE.FogExp2(0x020308, 0.0001);

    const disposables: { dispose: () => void }[] = [backdrop];
    const sceneObjects: THREE.Object3D[] = [];

    // Background kept to the faintest texture: the people-stars ARE the
    // nebula, so the sky behind is near-black with sparse dim pinpricks.
    const far = makeStarField(1800, 1500, 3400);
    const farGeo = new THREE.BufferGeometry();
    farGeo.setAttribute('position', new THREE.BufferAttribute(far.positions, 3));
    farGeo.setAttribute('color', new THREE.BufferAttribute(far.colors, 3));
    const farMat = new THREE.PointsMaterial({
      size: 1.1,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const farStars = new THREE.Points(farGeo, farMat);

    const near = makeStarField(180, 900, 2200);
    const nearGeo = new THREE.BufferGeometry();
    nearGeo.setAttribute('position', new THREE.BufferAttribute(near.positions, 3));
    nearGeo.setAttribute('color', new THREE.BufferAttribute(near.colors, 3));
    const nearMat = new THREE.PointsMaterial({
      size: 5,
      map: haloTexture,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const nearStars = new THREE.Points(nearGeo, nearMat);

    sceneObjects.push(farStars, nearStars);
    disposables.push(farGeo, farMat, nearGeo, nearMat);
    scene.add(farStars, nearStars);

    // A few faint foreground stars with diffraction spikes.
    const spikeTexture = makeSpikeStarTexture();
    disposables.push(spikeTexture);
    const spikeTints = ['#ffffff', '#dfe8ff', '#cfd9ff', '#fff0d8'];
    for (let i = 0; i < 8; i++) {
      const r = 750 + Math.random() * 1300;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const mat = new THREE.SpriteMaterial({
        map: spikeTexture,
        color: spikeTints[Math.floor(Math.random() * spikeTints.length)],
        transparent: true,
        opacity: 0.3 + Math.random() * 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const s = new THREE.Sprite(mat);
      const scale = 30 + Math.random() * 45;
      s.scale.set(scale, scale, 1);
      s.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      );
      scene.add(s);
      sceneObjects.push(s);
      disposables.push(mat);
    }

    // Container for per-community nebula clouds (rebuilt on engine stop).
    const nebulaGroup = new THREE.Group();
    nebulaGroup.renderOrder = -2;
    scene.add(nebulaGroup);
    sceneObjects.push(nebulaGroup);
    nebulaGroupRef.current = nebulaGroup;

    // The nebula itself rotates (differentially); the camera stays put.
    // Any drag/zoom pauses the rotation immediately.
    const controls = fg.controls() as OrbitControls;
    controls.autoRotate = false;
    const onControlsActivity = () => notifyInteraction();
    controls.addEventListener('start', onControlsActivity);
    controls.addEventListener('change', onControlsActivity);

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
      controls.removeEventListener('start', onControlsActivity);
      controls.removeEventListener('change', onControlsActivity);
      bloomRef.current = null;
      fg.postProcessingComposer().removePass(bloom);
      scene.background = null;
      nebulaGroupRef.current = null;
      for (const obj of sceneObjects) scene.remove(obj);
      for (const d of disposables) d.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- link force: stronger relationship => shorter link -------------------
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    // Nodes are pinned (fx/fy/fz) at their spiral-arm positions, so the
    // simulation only needs a brief run to (re)build objects and settle.
    // Invalidate rotation orbits meanwhile; handleEngineStop rebuilds them.
    rotationRef.current.rings.clear();
    rotationRef.current.orbits.clear();
    fg.d3ReheatSimulation();
  }, [graphData]);

  // --- node objects: glowing planet + halo + label --------------------------
  const nodeThreeObject = useCallback(
    (node: PoetNode) => {
      const color = new THREE.Color(groupColor.get(node.group) ?? '#8ecae6');
      // famous poets shine as bright platinum-gold stars among the dust;
      // overall brightness capped so close-ups stay crisp, not blown out
      if (!node.generated) color.lerp(new THREE.Color('#fff2d8'), 0.45);
      color.multiplyScalar(0.85);
      const r = nodeRadius(node);
      const g = new THREE.Group();

      const sphereMat = new THREE.MeshBasicMaterial({ color: color.clone(), transparent: true });
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 16), sphereMat);
      g.add(sphere);

      const haloMat = new THREE.SpriteMaterial({
        map: haloTexture,
        color: color.clone(),
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(r * 4.5, r * 4.5, 1);
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
        obj: g,
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
    const wasActive = selectionActiveRef.current;
    selectionActiveRef.current = hasSelection;
    if (hasSelection) {
      // links become visible now: make sure their geometry matches the
      // rotated node positions (rotation is paused while selected)
      syncLinkGeometries();
    } else if (wasActive) {
      // closing the detail panel: restart the 2s idle countdown
      rotationRef.current.lastInteract = performance.now();
    }
    // fade the galaxy dressing away while a selection is active
    if (nebulaGroupRef.current) nebulaGroupRef.current.visible = !hasSelection;
    for (const [id, v] of visualsRef.current) {
      const isLit = highlightNodeIds.has(id);
      const isSelected = id === selectedNodeId;
      if (!hasSelection) {
        v.sphereMat.color.copy(v.baseColor);
        v.sphereMat.opacity = 1;
        v.haloMat.color.copy(v.baseColor);
        v.haloMat.opacity = 0.05;
        v.label.visible = !v.node.generated;
        v.label.color = '#dde0ee';
      } else if (isSelected) {
        v.sphereMat.color.copy(v.baseColor).lerp(WHITE, 0.55);
        v.sphereMat.opacity = 1;
        v.haloMat.color.copy(v.baseColor).lerp(WHITE, 0.3);
        v.haloMat.opacity = 0.3;
        v.label.visible = true;
        v.label.color = '#ffffff';
      } else if (isLit) {
        v.sphereMat.color.copy(v.baseColor).lerp(WHITE, 0.15);
        v.sphereMat.opacity = 1;
        v.haloMat.color.copy(v.baseColor);
        v.haloMat.opacity = 0.12;
        v.label.visible = true;
        v.label.color = '#dde0ee';
      } else {
        v.sphereMat.color.copy(v.baseColor).multiplyScalar(0.22);
        v.sphereMat.opacity = 0.35;
        v.haloMat.opacity = 0.01;
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
      // brighter with weight; kept faint so clusters read as glowing gas,
      // not a wireframe mesh
      return hexToRgba(base, 0.03 + (l.weight / 10) * 0.2);
    },
    [selectionActive, highlightLinkKeys, selectedLink],
  );

  // Hide almost all links by default so the point cloud never becomes a
  // hairball: only the strongest documented bonds stay as faint hints.
  // A selection lights up that poet's first-degree links (+ particles).
  const linkVisibility = useCallback(
    (l: PoemLink) => {
      if (selectionActive) return l === selectedLink || highlightLinkKeys.has(linkKey(l));
      return !l.generated && l.weight >= 9;
    },
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
    // gentle overhead tilt (~32°): wide, horizontally spreading composition
    fg.cameraPosition(
      { x: cx, y: cy + fitDist * 0.53, z: cz + fitDist * 0.85 },
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
        const ratio = 1 + 120 / dist;
        fg.cameraPosition({ x: x * ratio, y: y * ratio, z: z * ratio }, { x, y, z }, 1100);
      },
      resetCamera: () => fitCameraToGraph(1100),
      notifyInteraction,
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, fitCameraToGraph, notifyInteraction]);

  // Rebuild the galaxy dressing around the settled node positions:
  // per-community star-dust particle clouds + gauze wisps, and a warm
  // "galactic core" glow at the overall centroid — the granular, milky look
  // of a real spiral-galaxy astrophoto.
  const rebuildNebulae = useCallback(() => {
    const group = nebulaGroupRef.current;
    if (!group) return;
    // clear previous clouds (pivot groups holding sprites + dust point clouds)
    group.traverse((child) => {
      const mat = (child as THREE.Sprite | THREE.Points).material;
      if (mat && !Array.isArray(mat)) mat.dispose();
      (child as THREE.Points).geometry?.dispose?.();
    });
    group.clear();

    // gather per-community positions
    const byGroup = new Map<number, PoetNode[]>();
    for (const v of visualsRef.current.values()) {
      if (!byGroup.has(v.node.group)) byGroup.set(v.node.group, []);
      byGroup.get(v.node.group)!.push(v.node);
    }

    // overall centroid = rotation axis anchor + galactic core position
    let gx = 0, gy = 0, gz = 0, gn = 0;
    for (const members of byGroup.values()) {
      for (const n of members) {
        gx += n.x ?? 0;
        gy += n.y ?? 0;
        gz += n.z ?? 0;
        gn++;
      }
    }
    if (gn === 0) return;
    gx /= gn; gy /= gn; gz /= gn;

    const rot = rotationRef.current;
    rot.center.set(gx, gy, gz);
    rot.rings.clear();
    rot.orbits.clear();

    const tmp = new THREE.Color();

    // --- radial rings: rigid layers of the differential rotation ------------
    let maxR = 1;
    for (const members of byGroup.values()) {
      for (const n of members) {
        maxR = Math.max(maxR, Math.hypot((n.x ?? 0) - gx, (n.z ?? 0) - gz));
      }
    }
    const ringWidth = maxR / RING_COUNT;
    const ringOf = (x: number, z: number) =>
      Math.min(RING_COUNT - 1, Math.floor(Math.hypot(x - gx, z - gz) / ringWidth));
    for (let i = 0; i < RING_COUNT; i++) {
      const rMid = (i + 0.5) * ringWidth;
      // 50% faster: inner ring ≈ 9 min/rev, outer ring ≈ 15 min/rev
      const omega = ((Math.PI * 2) / 493) * (1 / (1 + rMid / 620));
      const pivot = new THREE.Group();
      pivot.position.set(gx, gy, gz);
      group.add(pivot);
      rot.rings.set(i, { omega, theta: 0, pivot });
    }

    // per-ring, per-layer dust accumulators: three depth layers so the sea of
    // particles reads crisp and dense up close, finer and sparser far out
    // sizes are in screen pixels (sizeAttenuation off): grains stay crisp
    // points at any zoom instead of ballooning into blobs up close
    const DUST_LAYERS = [
      { grains: 16, sigma: 20, size: 2.8, opacity: 0.65, bright: 1 },
      { grains: 30, sigma: 52, size: 1.9, opacity: 0.5, bright: 0.7 },
      { grains: 44, sigma: 105, size: 1.2, opacity: 0.35, bright: 0.5 },
    ];
    const dustPos: number[][][] = DUST_LAYERS.map(() =>
      Array.from({ length: RING_COUNT }, () => []),
    );
    const dustCol: number[][][] = DUST_LAYERS.map(() =>
      Array.from({ length: RING_COUNT }, () => []),
    );

    for (const [gid, members] of byGroup) {
      const color = new THREE.Color(groupColor.get(gid) ?? '#b8c8ea');

      // register member orbits on their radial ring
      for (const n of members) {
        rot.orbits.set(n.id, {
          base: new THREE.Vector3((n.x ?? 0) - gx, (n.y ?? 0) - gy, (n.z ?? 0) - gz),
          ring: ringOf(n.x ?? 0, n.z ?? 0),
        });
      }

      // --- star dust: golden-orange particle sea layered around the members
      for (let li = 0; li < DUST_LAYERS.length; li++) {
        const layer = DUST_LAYERS[li];
        for (const seed of members) {
          for (let i = 0; i < layer.grains; i++) {
            const g1 = () =>
              (Math.random() + Math.random() + Math.random() - 1.5) * layer.sigma;
            const px = (seed.x ?? 0) + g1();
            const py = (seed.y ?? 0) + g1() * 0.3; // keep the disc thin
            const pz = (seed.z ?? 0) + g1();
            const roll = Math.random();
            if (roll < 0.62) tmp.copy(DUST_AMBER).lerp(color, 0.18);
            else if (roll < 0.86) tmp.copy(DUST_COOL).lerp(color, 0.4);
            else if (roll < 0.92) tmp.copy(DUST_PINK);
            else tmp.copy(DUST_BRIGHT);
            tmp.multiplyScalar((0.35 + Math.random() * 0.65) * layer.bright);
            const ring = ringOf(px, pz);
            dustPos[li][ring].push(px - gx, py - gy, pz - gz);
            dustCol[li][ring].push(tmp.r, tmp.g, tmp.b);
          }
        }
      }

      // --- floating dynasty/community label, like a data annotation adrift
      const name = groupName.get(gid);
      if (name && members.length > 3) {
        const mid = members[Math.floor(members.length * 0.55)];
        const label = new SpriteText(name, 11, '#9aa3bd');
        label.fontFace = '"Noto Serif SC", "Songti SC", serif';
        label.fontWeight = '400';
        label.material.transparent = true;
        label.material.opacity = 0.5;
        label.material.depthWrite = false;
        label.position.set(
          (mid.x ?? 0) - gx,
          (mid.y ?? 0) - gy + 30,
          (mid.z ?? 0) - gz,
        );
        rot.rings.get(ringOf(mid.x ?? 0, mid.z ?? 0))!.pivot!.add(label);
      }

      // --- gauze wisps sampled along the arm, attached to their ring pivot
      const wispColor = color.clone().lerp(new THREE.Color('#aebfe8'), 0.55);
      const samples = Math.min(4, members.length);
      for (let i = 0; i < samples; i++) {
        const seed = members[Math.floor(((i + 0.5) / samples) * members.length)];
        const mat = new THREE.SpriteMaterial({
          map: nebulaTexture,
          color: wispColor,
          transparent: true,
          // dimmed ~80%: the aggregated star points carry the nebula body
          opacity: 0.01 + Math.random() * 0.006,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          rotation: Math.random() * Math.PI * 2,
        });
        const sprite = new THREE.Sprite(mat);
        const scale = 80 + Math.random() * 50;
        sprite.position.set(
          (seed.x ?? 0) - gx + gauss3() * 20,
          (seed.y ?? 0) - gy,
          (seed.z ?? 0) - gz + gauss3() * 20,
        );
        sprite.scale.set(scale, scale, 1);
        sprite.renderOrder = -2;
        rot.rings.get(ringOf(seed.x ?? 0, seed.z ?? 0))!.pivot!.add(sprite);
      }
    }

    // upload per-layer, per-ring dust point clouds
    for (let li = 0; li < DUST_LAYERS.length; li++) {
      const layer = DUST_LAYERS[li];
      for (let i = 0; i < RING_COUNT; i++) {
        if (dustPos[li][i].length === 0) continue;
        const dustGeo = new THREE.BufferGeometry();
        dustGeo.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(dustPos[li][i]), 3),
        );
        dustGeo.setAttribute(
          'color',
          new THREE.BufferAttribute(new Float32Array(dustCol[li][i]), 3),
        );
        const dustMat = new THREE.PointsMaterial({
          size: layer.size,
          map: haloTexture,
          vertexColors: true,
          sizeAttenuation: false,
          transparent: true,
          opacity: layer.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const dust = new THREE.Points(dustGeo, dustMat);
        dust.renderOrder = -1;
        rot.rings.get(i)!.pivot!.add(dust);
      }
    }

    // --- energy tide: cyan/ice-blue particle stream flowing from the upper
    // left toward the galactic core (static, independent of the rotation)
    {
      const streamCount = 9000;
      const sPos = new Float32Array(streamCount * 3);
      const sCol = new Float32Array(streamCount * 3);
      const P0 = new THREE.Vector3(-640, 170, -400);
      const P1 = new THREE.Vector3(-270, 80, -150);
      const P2 = new THREE.Vector3(0, 6, 0);
      const bez = new THREE.QuadraticBezierCurve3(P0, P1, P2);
      const pt = new THREE.Vector3();
      for (let i = 0; i < streamCount; i++) {
        const t = Math.pow(Math.random(), 0.8); // denser toward the core
        bez.getPoint(t, pt);
        const spreadT = 42 * (1 - t * 0.55);
        sPos[i * 3] = pt.x + gauss3() * spreadT;
        sPos[i * 3 + 1] = pt.y + gauss3() * spreadT * 0.5;
        sPos[i * 3 + 2] = pt.z + gauss3() * spreadT;
        if (t < 0.45) tmp.copy(TIDE_ICE).lerp(TIDE_TEAL, t / 0.45);
        else tmp.copy(TIDE_TEAL).lerp(TIDE_LAKE, (t - 0.45) / 0.55);
        tmp.multiplyScalar((0.3 + Math.random() * 0.7) * (0.55 + t * 0.45));
        sCol[i * 3] = tmp.r;
        sCol[i * 3 + 1] = tmp.g;
        sCol[i * 3 + 2] = tmp.b;
      }
      const streamGeo = new THREE.BufferGeometry();
      streamGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
      streamGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
      const streamMat = new THREE.PointsMaterial({
        size: 1.8,
        map: haloTexture,
        vertexColors: true,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const stream = new THREE.Points(streamGeo, streamMat);
      stream.position.set(gx, gy, gz);
      stream.renderOrder = -1;
      group.add(stream);
    }

    // --- central bulge: a dense knot of warm stars filling the core --------
    {
      const bulgeCount = 500;
      const bPos = new Float32Array(bulgeCount * 3);
      const bCol = new Float32Array(bulgeCount * 3);
      for (let i = 0; i < bulgeCount; i++) {
        const rr = Math.abs(gauss3()) * 38;
        const ang = Math.random() * Math.PI * 2;
        bPos[i * 3] = rr * Math.cos(ang);
        bPos[i * 3 + 1] = gauss3() * (13 - rr * 0.12);
        bPos[i * 3 + 2] = rr * Math.sin(ang);
        tmp.copy(Math.random() < 0.75 ? DUST_BRIGHT : DUST_AMBER);
        tmp.multiplyScalar(0.5 + Math.random() * 0.5);
        bCol[i * 3] = tmp.r;
        bCol[i * 3 + 1] = tmp.g;
        bCol[i * 3 + 2] = tmp.b;
      }
      const bulgeGeo = new THREE.BufferGeometry();
      bulgeGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
      bulgeGeo.setAttribute('color', new THREE.BufferAttribute(bCol, 3));
      const bulgeMat = new THREE.PointsMaterial({
        size: 2.6,
        map: haloTexture,
        vertexColors: true,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const bulge = new THREE.Points(bulgeGeo, bulgeMat);
      bulge.renderOrder = -1;
      rot.rings.get(0)!.pivot!.add(bulge);
    }

    // --- blazing white-blue star core: volumetric glow layers + a small
    // intensely bright kernel (bloom flares it) + radiating diffraction rays
    const coreSpecs = [
      { map: nebulaTexture, color: '#26406e', scale: 440, opacity: 0.14 }, // volumetric haze
      { map: haloTexture, color: '#9fc4ff', scale: 150, opacity: 0.28 },
      { map: haloTexture, color: '#dfeaff', scale: 80, opacity: 0.45 },
      { map: haloTexture, color: '#ffffff', scale: 30, opacity: 0.95 }, // kernel
      { map: spikeTexture, color: '#cfe2ff', scale: 300, opacity: 0.2 }, // rays
    ];
    for (const spec of coreSpecs) {
      const mat = new THREE.SpriteMaterial({
        map: spec.map,
        color: spec.color,
        transparent: true,
        opacity: spec.opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(gx, gy, gz);
      sprite.scale.set(spec.scale, spec.scale, 1);
      sprite.renderOrder = 0;
      group.add(sprite);
    }
  }, [groupColor, nebulaTexture, haloTexture]);

  // Re-sync link line geometries from (rotated) node coordinates. Needed
  // because three-forcegraph only updates link positions while the physics
  // engine runs; called lazily when links become visible (selection).
  const syncLinkGeometries = useCallback(() => {
    const fg = fgRef.current;
    const rot = rotationRef.current;
    if (!fg || !rot.linksDirty) return;
    rot.linksDirty = false;
    fg.scene().traverse((o) => {
      if ((o as THREE.Line).type !== 'Line') return;
      const data = (o as unknown as { __data?: PoemLink }).__data;
      if (!data) return;
      const s = data.source;
      const t = data.target;
      if (typeof s === 'string' || typeof t === 'string') return;
      const geom = (o as THREE.Line).geometry;
      const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!posAttr || posAttr.count < 2) return;
      posAttr.setXYZ(0, s.x ?? 0, s.y ?? 0, s.z ?? 0);
      posAttr.setXYZ(1, t.x ?? 0, t.y ?? 0, t.z ?? 0);
      posAttr.needsUpdate = true;
      geom.computeBoundingSphere();
    });
  }, []);

  // --- distance-adaptive bloom: prevents white-out when zoomed in -----------
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const fg = fgRef.current;
      const bloom = bloomRef.current;
      if (!fg || !bloom) return;
      const d = fg.camera().position.distanceTo(rotationRef.current.center);
      const t = Math.min(1, Math.max(0, (d - 140) / 760)); // 140 → 900
      bloom.strength = 0.1 + t * 0.5;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // --- differential rotation driver -----------------------------------------
  useEffect(() => {
    if (prefersReducedMotion) return; // 减少动态效果: no auto rotation at all
    let raf = 0;
    let last = performance.now();

    // advance every community by its own angular velocity
    const step = (dt: number, now: number) => {
      const rot = rotationRef.current;
      if (rot.rings.size === 0) return;
      const paused =
        selectionActiveRef.current || now - rot.lastInteract < ROTATION_IDLE_DELAY;
      if (paused) {
        rot.speed = 0; // immediate stop
        return;
      }
      // progressive resume after the idle delay
      rot.speed = Math.min(1, rot.speed + dt / ROTATION_RAMP_SECONDS);
      const eased = rot.speed * rot.speed; // ease-in ramp
      if (eased <= 0.0001) return;

      for (const g of rot.rings.values()) {
        g.theta += g.omega * eased * dt;
        if (g.pivot) g.pivot.rotation.y = g.theta;
      }
      const c = rot.center;
      for (const v of visualsRef.current.values()) {
        const orbit = rot.orbits.get(v.node.id);
        if (!orbit) continue;
        const g = rot.rings.get(orbit.ring);
        if (!g) continue;
        const cosT = Math.cos(g.theta);
        const sinT = Math.sin(g.theta);
        const x = orbit.base.x * cosT + orbit.base.z * sinT;
        const z = -orbit.base.x * sinT + orbit.base.z * cosT;
        const nx = c.x + x;
        const ny = c.y + orbit.base.y;
        const nz = c.z + z;
        v.obj.position.set(nx, ny, nz);
        // keep data in sync: camera focus, tooltips, particles and link
        // geometry (synced on demand) all read node.x/y/z
        v.node.x = nx;
        v.node.y = ny;
        v.node.z = nz;
      }
      rot.linksDirty = true;
    };

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__stepRotation = step;
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      step(dt, now);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [prefersReducedMotion]);

  // Glide the camera to frame the whole constellation after the first layout,
  // and (re)paint the nebula clouds every time the layout settles.
  const didIntroRef = useRef(false);
  const handleEngineStop = useCallback(() => {
    rebuildNebulae();
    // let the scene rest a moment before the rotation ramps up
    rotationRef.current.lastInteract = performance.now();
    if (didIntroRef.current) return;
    didIntroRef.current = true;
    fitCameraToGraph(2000);
  }, [fitCameraToGraph, rebuildNebulae]);

  const nodeLabel = useCallback((n: PoetNode) => {
    const cy = n.courtesyName ? `字${n.courtesyName} · ` : '';
    return `${n.name} 〔${cy}${n.dynasty}〕`;
  }, []);

  // Hovering a star pauses the rotation too.
  const handleNodeHover = useCallback(
    (n: PoetNode | null) => {
      if (n) notifyInteraction();
    },
    [notifyInteraction],
  );

  return (
    <ForceGraph3D
      ref={fgRef}
      width={width}
      height={height}
      graphData={graphData}
      backgroundColor="#04050c"
      controlType="orbit"
      showNavInfo={false}
      warmupTicks={70}
      cooldownTicks={180}
      onEngineStop={handleEngineStop}
      d3VelocityDecay={0.35}
      nodeThreeObject={nodeThreeObject}
      nodeLabel={nodeLabel}
      onNodeClick={onNodeClick}
      onNodeHover={handleNodeHover}
      linkColor={linkColor}
      linkWidth={0}
      linkVisibility={linkVisibility}
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

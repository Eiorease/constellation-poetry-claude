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

/** Deep-space backdrop: a subtle radial gradient rendered as scene.background. */
function makeSpaceBackgroundTexture(): THREE.Texture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size * 0.5, size * 0.42, 0, size * 0.5, size * 0.42, size * 0.75);
  g.addColorStop(0, '#0b1026');
  g.addColorStop(0.4, '#060a1a');
  g.addColorStop(0.75, '#030510');
  g.addColorStop(1, '#010208');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
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
// star-dust tints: milky silver-blue body + occasional pink HII / warm gold
const DUST_BASE = new THREE.Color('#cdd8f4');
const DUST_PINK = new THREE.Color('#e79ac4');
const DUST_WARM = new THREE.Color('#f2ddb0');

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
  const nebulaGroupRef = useRef<THREE.Group | null>(null);
  const haloTexture = useMemo(makeHaloTexture, []);
  const nebulaTexture = useMemo(makeNebulaTexture, []);
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

    // Soft, luminous astrophoto glow.
    const bloom = new UnrealBloomPass(new THREE.Vector2(1024, 1024), 0.9, 0.65, 0.15);
    fg.postProcessingComposer().addPass(bloom);

    const scene = fg.scene();
    const backdrop = makeSpaceBackgroundTexture();
    scene.background = backdrop;
    scene.fog = new THREE.FogExp2(0x030510, 0.00012);

    const disposables: { dispose: () => void }[] = [backdrop];
    const sceneObjects: THREE.Object3D[] = [];

    // Two starfield layers: countless faint pinpricks + a sparse layer of
    // soft glowing stars, both tinted warm/cool so the sky feels alive.
    const far = makeStarField(4200, 1500, 3400);
    const farGeo = new THREE.BufferGeometry();
    farGeo.setAttribute('position', new THREE.BufferAttribute(far.positions, 3));
    farGeo.setAttribute('color', new THREE.BufferAttribute(far.colors, 3));
    const farMat = new THREE.PointsMaterial({
      size: 1.3,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const farStars = new THREE.Points(farGeo, farMat);

    const near = makeStarField(500, 900, 2200);
    const nearGeo = new THREE.BufferGeometry();
    nearGeo.setAttribute('position', new THREE.BufferAttribute(near.positions, 3));
    nearGeo.setAttribute('color', new THREE.BufferAttribute(near.colors, 3));
    const nearMat = new THREE.PointsMaterial({
      size: 7,
      map: haloTexture,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const nearStars = new THREE.Points(nearGeo, nearMat);

    sceneObjects.push(farStars, nearStars);
    disposables.push(farGeo, farMat, nearGeo, nearMat);
    scene.add(farStars, nearStars);

    // A handful of bright foreground stars with diffraction spikes.
    const spikeTexture = makeSpikeStarTexture();
    disposables.push(spikeTexture);
    const spikeTints = ['#ffffff', '#dfe8ff', '#cfd9ff', '#fff0d8'];
    for (let i = 0; i < 14; i++) {
      const r = 750 + Math.random() * 1300;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const mat = new THREE.SpriteMaterial({
        map: spikeTexture,
        color: spikeTints[Math.floor(Math.random() * spikeTints.length)],
        transparent: true,
        opacity: 0.55 + Math.random() * 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const s = new THREE.Sprite(mat);
      const scale = 40 + Math.random() * 65;
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

    // Cinematic slow drift: auto-rotate until the user takes the controls.
    const controls = fg.controls() as OrbitControls;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    const stopAutoRotate = () => {
      controls.autoRotate = false;
    };
    controls.addEventListener('start', stopAutoRotate);

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
      controls.removeEventListener('start', stopAutoRotate);
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
      halo.scale.set(r * 8.5, r * 8.5, 1);
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
    // fade the galaxy dressing away while a selection is active
    if (nebulaGroupRef.current) nebulaGroupRef.current.visible = !hasSelection;
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
      // brighter with weight; kept faint so clusters read as glowing gas,
      // not a wireframe mesh
      return hexToRgba(base, 0.03 + (l.weight / 10) * 0.2);
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

  // Rebuild the galaxy dressing around the settled node positions:
  // per-community star-dust particle clouds + gauze wisps, and a warm
  // "galactic core" glow at the overall centroid — the granular, milky look
  // of a real spiral-galaxy astrophoto.
  const rebuildNebulae = useCallback(() => {
    const group = nebulaGroupRef.current;
    if (!group) return;
    // clear previous clouds (sprites + dust point clouds)
    for (const child of [...group.children]) {
      group.remove(child);
      const mat = (child as THREE.Sprite | THREE.Points).material;
      if (mat && !Array.isArray(mat)) mat.dispose();
      (child as THREE.Points).geometry?.dispose?.();
    }
    // gather per-community positions
    const byGroup = new Map<number, PoetNode[]>();
    for (const v of visualsRef.current.values()) {
      if (!byGroup.has(v.node.group)) byGroup.set(v.node.group, []);
      byGroup.get(v.node.group)!.push(v.node);
    }

    let gx = 0, gy = 0, gz = 0, gn = 0;
    const tmp = new THREE.Color();

    for (const [gid, members] of byGroup) {
      if (members.length < 4) continue;
      let mx = 0, my = 0, mz = 0;
      for (const n of members) {
        mx += n.x ?? 0;
        my += n.y ?? 0;
        mz += n.z ?? 0;
      }
      mx /= members.length;
      my /= members.length;
      mz /= members.length;
      gx += mx; gy += my; gz += mz; gn++;
      let vSum = 0;
      for (const n of members) {
        vSum += (n.x! - mx) ** 2 + (n.y! - my) ** 2 + (n.z! - mz) ** 2;
      }
      const spread = Math.sqrt(vSum / members.length) || 60;
      const color = new THREE.Color(groupColor.get(gid) ?? '#b8c8ea');

      // --- star dust: hundreds of tiny grains scattered around the members,
      // so the "gas" is actually made of stars, like a real galaxy arm.
      const dustCount = Math.min(1500, members.length * 13);
      const dPos = new Float32Array(dustCount * 3);
      const dCol = new Float32Array(dustCount * 3);
      const sigma = spread * 0.5;
      for (let i = 0; i < dustCount; i++) {
        const seed = members[Math.floor(Math.random() * members.length)];
        const g1 = () => (Math.random() + Math.random() + Math.random() - 1.5) * sigma;
        dPos[i * 3] = (seed.x ?? 0) + g1();
        dPos[i * 3 + 1] = (seed.y ?? 0) + g1();
        dPos[i * 3 + 2] = (seed.z ?? 0) + g1();
        const roll = Math.random();
        if (roll < 0.06) tmp.copy(DUST_PINK);
        else if (roll < 0.12) tmp.copy(DUST_WARM);
        else tmp.copy(DUST_BASE).lerp(color, 0.4);
        tmp.multiplyScalar(0.35 + Math.random() * 0.65);
        dCol[i * 3] = tmp.r;
        dCol[i * 3 + 1] = tmp.g;
        dCol[i * 3 + 2] = tmp.b;
      }
      const dustGeo = new THREE.BufferGeometry();
      dustGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
      dustGeo.setAttribute('color', new THREE.BufferAttribute(dCol, 3));
      const dustMat = new THREE.PointsMaterial({
        size: 2.6,
        map: haloTexture,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const dust = new THREE.Points(dustGeo, dustMat);
      dust.renderOrder = -1;
      group.add(dust);

      // --- gauze wisps: silvery-blue regardless of community, faint
      const wispColor = color.clone().lerp(new THREE.Color('#aebfe8'), 0.55);
      const cloudSpecs = [
        { scale: spread * 3.2 + 90, opacity: 0.09, off: 0 },
        { scale: spread * 2.1 + 60, opacity: 0.06, off: spread * 0.75 },
        { scale: spread * 1.7 + 50, opacity: 0.05, off: spread * 0.75 },
      ];
      for (const spec of cloudSpecs) {
        const mat = new THREE.SpriteMaterial({
          map: nebulaTexture,
          color: wispColor,
          transparent: true,
          opacity: spec.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          rotation: Math.random() * Math.PI * 2,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(
          mx + (Math.random() - 0.5) * 2 * spec.off,
          my + (Math.random() - 0.5) * 2 * spec.off,
          mz + (Math.random() - 0.5) * 2 * spec.off,
        );
        sprite.scale.set(spec.scale, spec.scale, 1);
        sprite.renderOrder = -2;
        group.add(sprite);
      }
    }

    // --- warm galactic-core glow at the centroid of everything
    if (gn > 0) {
      gx /= gn; gy /= gn; gz /= gn;
      const coreSpecs = [
        { color: '#fff3dc', scale: 620, opacity: 0.14 },
        { color: '#ffffff', scale: 330, opacity: 0.1 },
      ];
      for (const spec of coreSpecs) {
        const mat = new THREE.SpriteMaterial({
          map: nebulaTexture,
          color: spec.color,
          transparent: true,
          opacity: spec.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          rotation: Math.random() * Math.PI,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(gx, gy, gz);
        sprite.scale.set(spec.scale, spec.scale, 1);
        sprite.renderOrder = -2;
        group.add(sprite);
      }
    }
  }, [groupColor, nebulaTexture, haloTexture]);

  // Glide the camera to frame the whole constellation after the first layout,
  // and (re)paint the nebula clouds every time the layout settles.
  const didIntroRef = useRef(false);
  const handleEngineStop = useCallback(() => {
    rebuildNebulae();
    if (didIntroRef.current) return;
    didIntroRef.current = true;
    fitCameraToGraph(2000);
  }, [fitCameraToGraph, rebuildNebulae]);

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
      controlType="orbit"
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

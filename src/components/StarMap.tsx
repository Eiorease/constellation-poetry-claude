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
  type RelationType,
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
  /** filter: matching nodes stay bright, the rest dims 60%; null = no filter */
  filterNodeIds: ReadonlySet<string> | null;
  /** filter: links of these relation types light up; null = no type filter */
  filterTypes: ReadonlySet<RelationType> | null;
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

/**
 * Fame tier for the selection burst, 0 (most famous) → 4:
 * curated poets rank by surviving poem count; generated demo poets are tier 4.
 * Colors run gold → purple → blue → cyan → white, with descending burst
 * size and brightness.
 */
function fameTier(n: PoetNode): number {
  if (n.generated) return 4;
  if (n.poemCount >= 1000) return 0;
  if (n.poemCount >= 400) return 1;
  if (n.poemCount >= 100) return 2;
  return 3;
}
const FAME_COLORS = ['#ffd257', '#b57bee', '#6b9fff', '#62d9ce', '#ffffff'];
const FAME_BURST_SCALE = [100, 76, 58, 44, 34];
const FAME_BURST_OPACITY = [0.95, 0.8, 0.68, 0.58, 0.48];
// radial light-beam length per tier (world units)
const FAME_BEAM_LEN = [260, 195, 150, 110, 82];
// star-size multiplier centre per fame tier (famous = larger). A random ±
// jitter is added so the final factor lands within 0.8–1.5.
const FAME_SIZE_CENTER = [1.42, 1.24, 1.06, 0.94, 0.86];
function fameSizeMul(node: PoetNode): number {
  const c = FAME_SIZE_CENTER[fameTier(node)];
  return Math.max(0.8, Math.min(1.5, c + (Math.random() - 0.5) * 0.14));
}

/** Soft radial glow texture shared by every halo sprite. */
function makeHaloTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // gentle falloff with a long soft tail so glows melt into the background
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.34)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.04)');
  g.addColorStop(0.9, 'rgba(255,255,255,0.012)');
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

/**
 * Soft-edged star body texture: a crisp bright core fading through a gradient
 * to transparent, so a star's boundary melts into the background naturally.
 */
function makeStarBodyTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.16, 'rgba(255,255,255,0.92)');
  g.addColorStop(0.34, 'rgba(255,255,255,0.4)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.1)');
  g.addColorStop(0.82, 'rgba(255,255,255,0.02)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Animated GPU particle material used across every point cloud. Points scale
 * with perspective (near-big / far-small) but are pixel-clamped so they never
 * grow past a star; a procedural sharp-core→soft-edge mask keeps each grain
 * crisp at any zoom while blending softly into the background. Per-particle
 * seeds drive a bounded random drift and a 0.5–1.5 s "breathing" flicker.
 */
function makeParticleMaterial(opts: {
  baseOpacity: number;
  sizeMul?: number;
  minPx?: number;
  maxPx?: number;
  motion?: number;
  breath?: number;
}): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 500 },
      uSizeMul: { value: opts.sizeMul ?? 1 },
      uMinPx: { value: opts.minPx ?? 0.7 },
      uMaxPx: { value: opts.maxPx ?? 5 },
      uOpacity: { value: opts.baseOpacity },
      uMotion: { value: opts.motion ?? 0 },
      uBreath: { value: opts.breath ?? 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec3 aColor;
      attribute float aSize;
      attribute vec3 aSeed;
      uniform float uTime, uScale, uSizeMul, uMinPx, uMaxPx, uMotion, uBreath;
      varying vec3 vColor;
      varying float vFade;
      void main() {
        vColor = aColor;
        vec3 p = position;
        if (uMotion > 0.0) {
          // ~6x slower drift than before, so the sea barely stirs
          p.x += sin(uTime * (0.058 + aSeed.x * 0.10) + aSeed.y * 6.2831) * uMotion;
          p.y += sin(uTime * (0.047 + aSeed.y * 0.08) + aSeed.z * 6.2831) * uMotion * 0.7;
          p.z += cos(uTime * (0.053 + aSeed.z * 0.10) + aSeed.x * 6.2831) * uMotion;
        }
        float period = 0.5 + aSeed.x;           // 0.5–1.5 s
        float br = 0.5 + 0.5 * sin(uTime * 6.2831853 / period + aSeed.y * 6.2831);
        vFade = mix(1.0, 0.35 + 0.65 * br, uBreath);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float px = aSize * uSizeMul * uScale / max(0.001, -mv.z);
        gl_PointSize = clamp(px, uMinPx, uMaxPx);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision mediump float;
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vFade;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        float core = smoothstep(0.5, 0.09, d);   // crisp bright centre
        float halo = smoothstep(0.5, 0.0, d);     // soft edge into background
        float a = max(core, halo * 0.42);
        gl_FragColor = vec4(vColor * vFade, a * uOpacity);
      }`,
  });
  mat.userData.baseOpacity = opts.baseOpacity;
  return mat;
}

/** Build a Points geometry with color / size / seed attributes for the shader. */
function makeParticleGeometry(
  positions: Float32Array,
  colors: Float32Array,
  baseSize: number,
): THREE.BufferGeometry {
  const n = positions.length / 3;
  const size = new Float32Array(n);
  const seed = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // per-particle size spread of 10%–50% (each grain is 50%–90% of base),
    // pixel-clamped in the shader so it never grows past a star
    size[i] = baseSize * (0.5 + Math.random() * 0.4);
    seed[i * 3] = Math.random();
    seed[i * 3 + 1] = Math.random();
    seed[i * 3 + 2] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  return geo;
}

interface NodeVisual {
  node: PoetNode;
  obj: THREE.Group;
  bodyMat: THREE.SpriteMaterial;
  haloMat: THREE.SpriteMaterial | null; // named poets only
  label: SpriteText;
  baseColor: THREE.Color;
  /** breathing phase & angular speed (period 1–2 s) */
  phase: number;
  bspeed: number;
  /** per-star ambient drift: bounded offset within the arm */
  drift: THREE.Vector3;
  driftSpeed: number;
  driftPhase: number;
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

/** reused scratch vector for comet interpolation (avoids per-frame allocation) */
const comet_tmp = new THREE.Vector3();

interface DeviceTier {
  particleMul: number; // scales all particle counts (perf + clarity)
  maxPxMul: number; // scales the point-size pixel clamp
  bloomMul: number; // scales bloom strength
  viewScale: number; // scales the default camera distance
}
/** Per-device visual tuning by screen width — phones get far fewer, smaller
 *  particles and gentler bloom so stars stay crisp instead of blooming into
 *  big light blobs (req 14). */
function computeDevice(w: number): DeviceTier {
  if (w < 600) return { particleMul: 0.26, maxPxMul: 0.55, bloomMul: 0.5, viewScale: 1.08 };
  if (w < 1024) return { particleMul: 0.55, maxPxMul: 0.78, bloomMul: 0.8, viewScale: 1.02 };
  return { particleMul: 1, maxPxMul: 1, bloomMul: 1, viewScale: 1 };
}

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
  filterNodeIds,
  filterTypes,
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
  const filterActiveRef = useRef(false);
  const filterTypesRef = useRef<ReadonlySet<RelationType> | null>(null);
  // high-contrast HTML overlay label for the selected poet (always readable,
  // always facing the camera, regardless of view angle)
  const labelBoxRef = useRef<HTMLDivElement>(null);
  const labelNameRef = useRef<HTMLSpanElement>(null);
  const labelSubRef = useRef<HTMLSpanElement>(null);
  const selectedNodeRef = useRef<PoetNode | null>(null);
  const prefersReducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const bloomRef = useRef<UnrealBloomPass | null>(null);
  const haloTexture = useMemo(makeHaloTexture, []);
  const nebulaTexture = useMemo(makeNebulaTexture, []);
  const spikeTexture = useMemo(makeSpikeStarTexture, []);
  const starBodyTexture = useMemo(makeStarBodyTexture, []);
  // animated particle materials, split into persistent (starfields, selection
  // field) and rebuilt-per-layout (dust, tide, bulge, ambient) so uTime/uScale
  // can be advanced every frame without leaking stale materials on rebuild.
  const sceneMatsRef = useRef<THREE.ShaderMaterial[]>([]);
  const dustMatsRef = useRef<THREE.ShaderMaterial[]>([]);
  // volumetric particle field revealed only while a poet is selected
  const selectionFieldRef = useRef<THREE.Points | null>(null);
  const burstStartRef = useRef(0);
  const deviceRef = useRef<DeviceTier>(computeDevice(width));
  const burstBaseRef = useRef({ h: 0, glow: 0 });
  // custom comet photons (a small head + a fading trail) travelling along the
  // highlighted relationship lines — one per link (req 3)
  const cometGroupRef = useRef<THREE.Group | null>(null);
  const cometsRef = useRef<
    Array<{
      a: THREE.Vector3;
      b: THREE.Vector3;
      t: number;
      speed: number;
      geo: THREE.BufferGeometry;
      posAttr: THREE.BufferAttribute;
      head: THREE.Sprite;
    }>
  >([]);
  // current highlight set, read by the per-frame breathing loop
  const highlightIdsRef = useRef<ReadonlySet<string>>(new Set());

  const notifyInteraction = useCallback(() => {
    rotationRef.current.lastInteract = performance.now();
    rotationRef.current.speed = 0; // pause immediately
  }, []);

  // Shared "burst" attached to the selected star: diffraction rays + a soft
  // glow, tinted and sized by the poet's fame tier.
  const burstRef = useRef<{
    group: THREE.Group;
    glow: THREE.SpriteMaterial;
    glowSprite: THREE.Sprite;
    beamMatH: THREE.ShaderMaterial;
    beamsH: THREE.LineSegments;
    beamMatV: THREE.ShaderMaterial;
    beamsV: THREE.LineSegments;
  } | null>(null);
  const getBurst = useCallback(() => {
    if (burstRef.current) return burstRef.current;
    const group = new THREE.Group();
    const glow = new THREE.SpriteMaterial({
      map: haloTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glowSprite = new THREE.Sprite(glow);

    // Beams as a shader so each line can appear on its own schedule (aAppear,
    // ms) and carry its own opacity boost (aBoost) — driven by uElapsed.
    const beamMaterial = () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uElapsed: { value: 0 },
          uColor: { value: new THREE.Color('#ffffff') },
          uOpacity: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `
          attribute float aFade;    // 1 at bright end → 0 at faint tip
          attribute float aAppear;  // ms after selection this beam appears
          attribute float aBoost;   // per-beam opacity multiplier (1.15–1.30)
          uniform float uElapsed;
          varying float vA;
          void main() {
            float show = smoothstep(aAppear, aAppear + 260.0, uElapsed);
            vA = aFade * aBoost * show;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          precision mediump float;
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vA;
          void main() { gl_FragColor = vec4(uColor, vA * uOpacity); }`,
      });

    const mkBeams = (
      count: number,
      appearMin: number,
      appearMax: number,
      place: (i: number) => { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number },
    ) => {
      const pos = new Float32Array(count * 2 * 3);
      const fade = new Float32Array(count * 2);
      const appear = new Float32Array(count * 2);
      const boost = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        const p = place(i);
        pos.set([p.x0, p.y0, p.z0, p.x1, p.y1, p.z1], i * 6);
        fade[i * 2] = 1; // bright root
        fade[i * 2 + 1] = 0; // faint tip
        const ap = appearMin + Math.random() * (appearMax - appearMin);
        appear[i * 2] = appear[i * 2 + 1] = ap;
        const b = 1.15 + Math.random() * 0.15; // +15–30% (#13)
        boost[i * 2] = boost[i * 2 + 1] = b;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aFade', new THREE.BufferAttribute(fade, 1));
      geo.setAttribute('aAppear', new THREE.BufferAttribute(appear, 1));
      geo.setAttribute('aBoost', new THREE.BufferAttribute(boost, 1));
      const mat = beamMaterial();
      return { mat, seg: new THREE.LineSegments(geo, mat) };
    };

    // Horizontal rays radiate flat from the star body, each tilted a random
    // ±10° off the galactic plane (#12); they appear over 1–3 s (#13).
    const H_COUNT = 294; // 420 −30% (#5)
    const V_COUNT = 224; // 320 −30% (#5)
    const dirs: { a: number; len: number }[] = [];
    for (let i = 0; i < H_COUNT; i++) {
      dirs.push({ a: Math.random() * Math.PI * 2, len: 0.5 + Math.random() * 0.5 });
    }
    const h = mkBeams(H_COUNT, 0, 2200, (i) => {
      const { a, len } = dirs[i];
      const tilt = ((Math.random() * 2 - 1) * 7 * Math.PI) / 180; // ±7° (−30%)
      return {
        x0: 0, y0: 0, z0: 0,
        x1: Math.cos(a) * len,
        y1: len * Math.tan(tilt),
        z1: Math.sin(a) * len,
      };
    });
    // Vertical hairs sprout from random points ALONG the horizontal rays and
    // rise perpendicular; they appear 1–3 s after the horizontals (#7, #13).
    const v = mkBeams(V_COUNT, 2500, 5000, () => {
      const ray = dirs[Math.floor(Math.random() * dirs.length)];
      const at = 0.2 + Math.random() * 0.7;
      const bx = Math.cos(ray.a) * ray.len * at;
      const bz = Math.sin(ray.a) * ray.len * at;
      const vlen = (0.12 + Math.random() * 0.28) * (Math.random() < 0.5 ? -1 : 1);
      return {
        x0: bx, y0: 0, z0: bz,
        x1: bx + (Math.random() - 0.5) * 0.03,
        y1: vlen,
        z1: bz + (Math.random() - 0.5) * 0.03,
      };
    });

    group.add(h.seg, v.seg, glowSprite);
    burstRef.current = {
      group,
      glow,
      glowSprite,
      beamMatH: h.mat,
      beamsH: h.seg,
      beamMatV: v.mat,
      beamsV: v.seg,
    };
    return burstRef.current;
  }, [haloTexture]);
  const groupColor = useMemo(() => {
    const m = new Map<number, string>();
    groups.forEach((g) => m.set(g.id, g.color));
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
    sceneMatsRef.current = [];
    const D = deviceRef.current;

    // Background kept faint: the people-stars ARE the nebula, so the sky
    // behind is near-black with sparse dim, twinkling pinpricks (breathing on,
    // no drift). Crisp at any zoom via the shared particle shader.
    const far = makeStarField(Math.round(10800 * D.particleMul), 1500, 3400);
    const farMat = makeParticleMaterial({ baseOpacity: 0.42, sizeMul: 3, minPx: 0.7, maxPx: 2.4 * D.maxPxMul, breath: 1 });
    const farStars = new THREE.Points(makeParticleGeometry(far.positions, far.colors, 1), farMat);
    farStars.frustumCulled = false;

    const near = makeStarField(Math.round(1080 * D.particleMul), 900, 2200);
    const nearMat = makeParticleMaterial({ baseOpacity: 0.5, sizeMul: 8, minPx: 1, maxPx: 5 * D.maxPxMul, breath: 1 });
    const nearStars = new THREE.Points(makeParticleGeometry(near.positions, near.colors, 1), nearMat);
    nearStars.frustumCulled = false;

    sceneMatsRef.current.push(farMat, nearMat);
    sceneObjects.push(farStars, nearStars);
    disposables.push(farStars.geometry, farMat, nearStars.geometry, nearMat);
    scene.add(farStars, nearStars);

    // Volumetric selection field: a big cloud of drifting, near-big/far-small
    // particles that fills the space only while a poet is selected.
    {
      const n = Math.round(9000 * D.particleMul);
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        pos[i * 3] = gauss3() * 460;
        pos[i * 3 + 1] = gauss3() * 320;
        pos[i * 3 + 2] = gauss3() * 460;
        const roll = Math.random();
        if (roll < 0.5) c.copy(DUST_AMBER);
        else if (roll < 0.85) c.copy(DUST_COOL);
        else c.copy(DUST_BRIGHT);
        c.multiplyScalar(0.35 + Math.random() * 0.5);
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
      const selMat = makeParticleMaterial({
        baseOpacity: 0.6, sizeMul: 6, minPx: 1, maxPx: 6 * D.maxPxMul, motion: 9, breath: 1,
      });
      const selField = new THREE.Points(makeParticleGeometry(pos, col, 1.4), selMat);
      selField.frustumCulled = false;
      selField.visible = false;
      selectionFieldRef.current = selField;
      sceneMatsRef.current.push(selMat);
      sceneObjects.push(selField);
      disposables.push(selField.geometry, selMat);
      scene.add(selField);
    }

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

    // Soft palette-tinted glow patches drifting far behind the galaxy.
    const glowTints = ['#f0bf85', '#7db8e8', '#c6ecff', '#454f86', '#e79ac4', '#f0bf85'];
    for (let i = 0; i < 16; i++) {
      const r = 850 + Math.random() * 950;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const mat = new THREE.SpriteMaterial({
        map: nebulaTexture,
        color: glowTints[i % glowTints.length],
        transparent: true,
        opacity: 0.03 + Math.random() * 0.035,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        rotation: Math.random() * Math.PI * 2,
      });
      const glow = new THREE.Sprite(mat);
      const scale = 550 + Math.random() * 750;
      glow.scale.set(scale, scale, 1);
      glow.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta) * 0.6,
        r * Math.cos(phi),
      );
      glow.renderOrder = -3;
      scene.add(glow);
      sceneObjects.push(glow);
      disposables.push(mat);
    }

    // Container for the moving comet photons on highlighted links.
    const cometGroup = new THREE.Group();
    scene.add(cometGroup);
    sceneObjects.push(cometGroup);
    cometGroupRef.current = cometGroup;

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
    // Pause the nebula rotation only on *real user input* (drag / wheel),
    // NOT on programmatic camera moves. Listening to OrbitControls 'change'
    // also fired during intro/focus tweens, which paused the rotation every
    // time the view moved — so we bind pointer/wheel on the canvas instead.
    const onControlsActivity = () => notifyInteraction();
    controls.addEventListener('start', onControlsActivity);
    const dom = fg.renderer().domElement;
    dom.addEventListener('pointerdown', onControlsActivity);
    dom.addEventListener('wheel', onControlsActivity, { passive: true });

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
      dom.removeEventListener('pointerdown', onControlsActivity);
      dom.removeEventListener('wheel', onControlsActivity);
      bloomRef.current = null;
      fg.postProcessingComposer().removePass(bloom);
      scene.background = null;
      nebulaGroupRef.current = null;
      cometGroupRef.current = null;
      cometsRef.current = [];
      selectionFieldRef.current = null;
      sceneMatsRef.current = [];
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
      // Star colour derives from the community palette, adjusted by fame:
      // more famous → deeper/darker & more saturated, less famous → paler,
      // plus a 1–10% random per-star variation (req 8).
      const tier = fameTier(node);
      const color = new THREE.Color(groupColor.get(node.group) ?? '#8ecae6');
      color.lerp(WHITE, (tier / 4) * 0.5); // minor stars fade paler
      color.multiplyScalar(0.85 - (4 - tier) * 0.03); // famous stars deeper
      const jitter = (0.01 + Math.random() * 0.09) * (Math.random() < 0.5 ? -1 : 1);
      color.multiplyScalar(1 + jitter);
      // fame-based random size: famous stars larger, minor stars smaller,
      // final factor within 80%–150% of the base radius (req 3)
      const r = nodeRadius(node) * fameSizeMul(node);
      const g = new THREE.Group();

      // Soft-edged body sprite = the whole star (crisp bright core + gradient
      // edge) and the click target. World-space sprite → scales with
      // perspective at any view (req 5). Minor stars use ONLY this one sprite
      // (a single draw call) so a large catalogue still rotates smoothly (#15);
      // named poets add an outer halo.
      const bodyMat = new THREE.SpriteMaterial({
        map: starBodyTexture,
        color: color.clone(),
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const body = new THREE.Sprite(bodyMat);
      body.scale.set(r * 3.4, r * 3.4, 1);
      g.add(body);

      let haloMat: THREE.SpriteMaterial | null = null;
      if (!node.generated) {
        haloMat = new THREE.SpriteMaterial({
          map: haloTexture,
          color: color.clone(),
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const halo = new THREE.Sprite(haloMat);
        halo.scale.set(r * 7, r * 7, 1);
        g.add(halo);
      }

      const label = new SpriteText(node.name, 3.6, '#dde0ee');
      label.fontFace = '"Noto Serif SC", "Songti SC", serif';
      label.fontWeight = '500';
      label.position.set(0, -(r + 4.5), 0);
      label.material.depthWrite = false;
      label.visible = false; // no labels by default; shown only on selection (#1)
      g.add(label);

      // per-star ambient drift: a random unit direction and a speed jittered
      // ±5–10% around a base, small amplitude so the star stays in its arm
      const dphi = Math.random() * Math.PI * 2;
      const dcos = Math.random() * 2 - 1;
      const dsin = Math.sqrt(1 - dcos * dcos);
      const drift = new THREE.Vector3(dsin * Math.cos(dphi), dcos * 0.5, dsin * Math.sin(dphi));
      const sign = Math.random() < 0.5 ? -1 : 1;

      visualsRef.current.set(node.id, {
        node,
        obj: g,
        bodyMat,
        haloMat,
        label,
        baseColor: color,
        phase: Math.random() * Math.PI * 2,
        bspeed: (Math.PI * 2) / (1 + Math.random()), // period 1–2 s
        drift,
        driftSpeed: 0.16 * (1 + sign * (0.05 + Math.random() * 0.05)), // ±5–10%
        driftPhase: Math.random() * Math.PI * 2,
      });
      return g;
    },
    [groupColor, haloTexture, starBodyTexture],
  );

  // --- imperative highlight styling (no object rebuild) ---------------------
  // dim/restore the galaxy dressing (dust, wisps, glows) by a factor
  const applyDressingDim = useCallback((factor: number) => {
    nebulaGroupRef.current?.traverse((o) => {
      const mat = (o as THREE.Sprite | THREE.Points).material as
        | (THREE.Material & {
            opacity: number;
            userData: { baseOpacity?: number };
            uniforms?: { uOpacity?: { value: number } };
          })
        | undefined;
      if (!mat || Array.isArray(mat) || mat.userData?.baseOpacity === undefined) return;
      const target = mat.userData.baseOpacity * factor;
      if (mat.uniforms?.uOpacity) mat.uniforms.uOpacity.value = target;
      else mat.opacity = target;
    });
  }, []);

  useEffect(() => {
    const hasSelection = highlightNodeIds.size > 0;
    const filterActive = filterNodeIds !== null || filterTypes !== null;
    const wasActive = selectionActiveRef.current;
    selectionActiveRef.current = hasSelection;
    filterActiveRef.current = filterActive;
    highlightIdsRef.current = highlightNodeIds;
    if (hasSelection) {
      // links become visible now: make sure their geometry matches the
      // rotated node positions (rotation is paused while selected)
      syncLinkGeometries();
    } else if (wasActive) {
      // closing the detail panel: restart the 2s idle countdown
      rotationRef.current.lastInteract = performance.now();
    }
    // fade the galaxy dressing away while a selection is active,
    // dim it while a filter highlights part of the sky
    if (nebulaGroupRef.current) nebulaGroupRef.current.visible = !hasSelection;
    applyDressingDim(filterActive ? 0.35 : 1);
    // the volumetric selection particle field shows only while selected
    if (selectionFieldRef.current) selectionFieldRef.current.visible = hasSelection;
    // detach the fame burst; re-attached below if a star is selected
    const burst = getBurst();
    burst.group.removeFromParent();
    for (const [id, v] of visualsRef.current) {
      const isLit = highlightNodeIds.has(id);
      const isSelected = id === selectedNodeId;
      if (!hasSelection) {
        const matches = !filterNodeIds || filterNodeIds.has(id);
        if (matches) {
          v.bodyMat.color.copy(v.baseColor);
          v.bodyMat.opacity = 0.92;
          if (v.haloMat) {
            v.haloMat.color.copy(v.baseColor);
            v.haloMat.opacity = filterNodeIds ? 0.18 : 0.1;
          }
          v.label.visible = false; // idle: no floating text (#1)
          v.label.color = '#dde0ee';
        } else {
          // not matching the filter: 60% dimmer, restored when cleared
          v.bodyMat.color.copy(v.baseColor).multiplyScalar(0.4);
          v.bodyMat.opacity = 0.5;
          if (v.haloMat) {
            v.haloMat.color.copy(v.baseColor);
            v.haloMat.opacity = 0.02;
          }
          v.label.visible = false;
        }
      } else if (isSelected) {
        // dazzling burst, tinted and sized by the poet's fame tier:
        // gold → purple → blue → cyan → white, big/bright → small/dim
        const st = fameTier(v.node);
        const tierColor = new THREE.Color(FAME_COLORS[st]);
        const scale = FAME_BURST_SCALE[st];
        const op = FAME_BURST_OPACITY[st];
        const beamLen = FAME_BEAM_LEN[st];
        burst.group.visible = true;
        burst.glow.color.copy(tierColor);
        burst.glow.opacity = op * 0.5;
        burst.glowSprite.scale.set(scale * 0.55, scale * 0.55, 1);
        // beams appear gradually (uElapsed driven by the tick); per-beam
        // appear-time + opacity boost live in the shader attributes (#12/#13)
        const beamOp = Math.min(1, op * 0.95 * 1.4); // opacity +40% (#5)
        for (const bm of [burst.beamMatH, burst.beamMatV]) {
          bm.uniforms.uColor.value.copy(tierColor);
          bm.uniforms.uOpacity.value = beamOp;
          bm.uniforms.uElapsed.value = 0;
        }
        burst.beamsH.scale.setScalar(beamLen);
        burst.beamsV.scale.setScalar(beamLen);
        burstBaseRef.current = { h: beamOp, glow: op * 0.5 };
        burstStartRef.current = performance.now();
        v.obj.add(burst.group);
        v.bodyMat.color.copy(tierColor).lerp(WHITE, 0.3);
        v.bodyMat.opacity = 1;
        if (v.haloMat) {
          v.haloMat.color.copy(tierColor);
          v.haloMat.opacity = 0.55;
        }
        // the selected star's own 3D label is hidden — the high-contrast
        // HTML overlay label (always facing the camera) takes over
        v.label.visible = false;
      } else if (isLit) {
        v.bodyMat.color.copy(v.baseColor).lerp(WHITE, 0.1);
        v.bodyMat.opacity = 0.95;
        if (v.haloMat) {
          v.haloMat.color.copy(v.baseColor);
          v.haloMat.opacity = 0.12;
        }
        v.label.visible = true;
        v.label.color = '#dde0ee';
      } else {
        v.bodyMat.color.copy(v.baseColor).multiplyScalar(0.22);
        v.bodyMat.opacity = 0.35;
        if (v.haloMat) v.haloMat.opacity = 0.01;
        v.label.visible = false;
      }
    }
  }, [highlightNodeIds, selectedNodeId, graphData, filterNodeIds, filterTypes, applyDressingDim, getBurst]);

  // Update the HTML overlay label's text/color when the selection changes.
  // (Position is tracked every frame in the bloom tick loop below.)
  useEffect(() => {
    const node = selectedNodeId
      ? visualsRef.current.get(selectedNodeId)?.node ?? null
      : null;
    selectedNodeRef.current = node;
    const box = labelBoxRef.current;
    if (!box) return;
    if (node) {
      const tier = fameTier(node);
      if (labelNameRef.current) labelNameRef.current.textContent = node.name;
      if (labelSubRef.current) {
        labelSubRef.current.textContent =
          (node.courtesyName ? `字${node.courtesyName} · ` : '') + node.dynasty;
      }
      box.style.setProperty('--tier', FAME_COLORS[tier]);
    } else {
      box.style.display = 'none';
    }
  }, [selectedNodeId, graphData]);

  // (Re)build the comet photons for the currently highlighted links (req 3):
  // a small head sprite + a tapered 6-point trail, one comet per link.
  useEffect(() => {
    const grp = cometGroupRef.current;
    if (!grp) return;
    for (const c of cometsRef.current) {
      grp.remove(c.head);
      const trail = c.head.userData.trail as THREE.Line;
      grp.remove(trail);
      c.geo.dispose();
      (trail.material as THREE.Material).dispose();
      (c.head.material as THREE.Material).dispose();
    }
    cometsRef.current = [];
    if (!selectedNodeId) return;
    const tierColor = new THREE.Color(
      FAME_COLORS[fameTier(visualsRef.current.get(selectedNodeId)?.node ?? ({} as PoetNode))],
    );
    const TRAIL = 6;
    for (const key of highlightLinkKeys) {
      const [i1, i2] = key.split('|');
      const n1 = visualsRef.current.get(i1)?.node;
      const n2 = visualsRef.current.get(i2)?.node;
      if (!n1 || !n2) continue;
      // head travels outward from the selected star
      const from = i1 === selectedNodeId ? n1 : n2;
      const to = i1 === selectedNodeId ? n2 : n1;
      const a = new THREE.Vector3(from.x ?? 0, from.y ?? 0, from.z ?? 0);
      const b = new THREE.Vector3(to.x ?? 0, to.y ?? 0, to.z ?? 0);
      const pos = new Float32Array(TRAIL * 3);
      const col = new Float32Array(TRAIL * 3);
      for (let k = 0; k < TRAIL; k++) {
        const f = 1 - k / (TRAIL - 1);
        col[k * 3] = tierColor.r * f;
        col[k * 3 + 1] = tierColor.g * f;
        col[k * 3 + 2] = tierColor.b * f;
      }
      const geo = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(pos, 3);
      geo.setAttribute('position', posAttr);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const trailMat = new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const trail = new THREE.Line(geo, trailMat);
      trail.frustumCulled = false;
      const headMat = new THREE.SpriteMaterial({
        map: haloTexture, color: tierColor, transparent: true, opacity: 0.9,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const head = new THREE.Sprite(headMat);
      head.scale.set(3, 3, 1); // small ball (~70% smaller than before)
      head.userData.trail = trail;
      grp.add(trail, head);
      cometsRef.current.push({
        a, b, t: Math.random(), speed: 0.006 * (0.8 + Math.random() * 0.4), geo, posAttr, head,
      });
    }
  }, [highlightLinkKeys, selectedNodeId, graphData, haloTexture]);

  // Filter changes pause the rotation briefly and re-align link geometry
  // (type-filtered links become visible at the current rotated positions).
  useEffect(() => {
    filterTypesRef.current = filterTypes;
    notifyInteraction();
    syncLinkGeometries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterTypes, filterNodeIds]);

  // Drop stale visual registry entries when the node set changes.
  useEffect(() => {
    const ids = new Set(nodes.map((n) => n.id));
    for (const id of visualsRef.current.keys()) {
      if (!ids.has(id)) visualsRef.current.delete(id);
    }
  }, [nodes]);

  // --- link styling ----------------------------------------------------------
  const selectionActive = highlightNodeIds.size > 0 || selectedLink !== null;

  // does a link match the active filters (type + both endpoints)?
  const linkMatchesFilter = useCallback(
    (l: PoemLink) => {
      if (!filterTypes || !filterTypes.has(l.type)) return false;
      if (!filterNodeIds) return true;
      return (
        filterNodeIds.has(endpointId(l.source)) && filterNodeIds.has(endpointId(l.target))
      );
    },
    [filterTypes, filterNodeIds],
  );

  const linkColor = useCallback(
    (l: PoemLink) => {
      const base = RELATION_COLORS[l.type] ?? '#8a8fa3';
      if (l === selectedLink) return hexToRgba(base, 1);
      if (selectionActive) {
        return highlightLinkKeys.has(linkKey(l))
          ? hexToRgba(base, 0.9)
          : hexToRgba(base, 0.03);
      }
      if (filterTypes) return hexToRgba(base, 0.1 + (l.weight / 10) * 0.3);
      // brighter with weight; kept faint so clusters read as glowing gas,
      // not a wireframe mesh
      return hexToRgba(base, 0.03 + (l.weight / 10) * 0.2);
    },
    [selectionActive, highlightLinkKeys, selectedLink, filterTypes],
  );

  // Hide almost all links by default so the point cloud never becomes a
  // hairball: only the strongest documented bonds stay as faint hints.
  // A selection lights up that poet's first-degree links (+ particles);
  // a relation-type filter lights up all matching links.
  const linkVisibility = useCallback(
    (l: PoemLink) => {
      if (selectionActive) return l === selectedLink || highlightLinkKeys.has(linkKey(l));
      if (filterTypes) return linkMatchesFilter(l);
      return !l.generated && l.weight >= 9;
    },
    [selectionActive, highlightLinkKeys, selectedLink, filterTypes, linkMatchesFilter],
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
      // 1.18 framing, pulled 15% closer so the nebula reads ~15% larger (#6)
      (1.18 / 1.15) *
      deviceRef.current.viewScale;
    // 20° tilt above the disc plane — a low, cinematic angle rather than a
    // top-down view (#4). The look-at point is nudged up a little so the disc
    // sits vertically centred on screen instead of low (#3).
    const el = (20 * Math.PI) / 180;
    fg.cameraPosition(
      { x: cx, y: cy + fitDist * Math.sin(el), z: cz + fitDist * Math.cos(el) },
      { x: cx, y: cy + radius * 0.18, z: cz },
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
    dustMatsRef.current = [];

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
      // inner ring ≈ 6 min/rev, outer ring ≈ 10 min/rev
      const omega = ((Math.PI * 2) / 329) * (1 / (1 + rMid / 620));
      const pivot = new THREE.Group();
      pivot.position.set(gx, gy, gz);
      group.add(pivot);
      rot.rings.set(i, { omega, theta: 0, pivot });
    }

    // per-ring, per-layer dust accumulators: three depth layers so the sea of
    // particles reads crisp and dense up close, finer and sparser far out
    // sizes are in screen pixels (sizeAttenuation off): grains stay crisp
    // points at any zoom instead of ballooning into blobs up close
    // sigmas kept inside the (narrow) arm band so arms stay clean lanes
    // sizeMul feeds perspective scaling (near-big/far-small); maxPx clamps so
    // grains never grow past a star. motion drifts each grain locally within
    // its arm; breath makes them flicker like breathing lamps.
    const D = deviceRef.current;
    const DUST_LAYERS = [
      { grains: 48, sigma: 12, sizeMul: 6, maxPx: 4, opacity: 0.6, bright: 1, motion: 5 },
      { grains: 90, sigma: 26, sizeMul: 4.5, maxPx: 3, opacity: 0.46, bright: 0.7, motion: 6 },
      { grains: 132, sigma: 42, sizeMul: 3.2, maxPx: 2.2, opacity: 0.28, bright: 0.5, motion: 7 },
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

      // --- star dust: a particle sea sharing the community's star colour,
      // each grain jittered 1–10% (req 7). Vertical spread tapers with radius
      // so the disc is ~5× thicker at the core than the rim (req 11).
      for (let li = 0; li < DUST_LAYERS.length; li++) {
        const layer = DUST_LAYERS[li];
        const grains = Math.max(1, Math.round(layer.grains * D.particleMul));
        for (const seed of members) {
          const rSeed = Math.hypot((seed.x ?? 0) - gx, (seed.z ?? 0) - gz);
          const taper = 0.067 + 0.933 * Math.exp(-rSeed / 150); // ~15× core:rim
          for (let i = 0; i < grains; i++) {
            const g1 = () =>
              (Math.random() + Math.random() + Math.random() - 1.5) * layer.sigma;
            const px = (seed.x ?? 0) + g1();
            const py = (seed.y ?? 0) + g1() * 0.5 * taper;
            const pz = (seed.z ?? 0) + g1();
            // base on the community colour; rare bright/pale accents for life
            const roll = Math.random();
            if (roll < 0.9) tmp.copy(color);
            else if (roll < 0.96) tmp.copy(DUST_BRIGHT);
            else tmp.copy(DUST_PINK).lerp(color, 0.4);
            const jit = 1 + (Math.random() * 2 - 1) * 0.1; // ±1–10%
            tmp.multiplyScalar((0.4 + Math.random() * 0.6) * layer.bright * jit);
            const ring = ringOf(px, pz);
            dustPos[li][ring].push(px - gx, py - gy, pz - gz);
            dustCol[li][ring].push(tmp.r, tmp.g, tmp.b);
          }
        }
      }

      // (floating dynasty labels removed — the nebula carries no text by
      // default; the dynasty is shown on the detail card when selected, #1)

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
        mat.userData.baseOpacity = mat.opacity;
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
        const dustGeo = makeParticleGeometry(
          new Float32Array(dustPos[li][i]),
          new Float32Array(dustCol[li][i]),
          1,
        );
        const dustMat = makeParticleMaterial({
          baseOpacity: layer.opacity,
          sizeMul: layer.sizeMul,
          maxPx: layer.maxPx * D.maxPxMul,
          motion: layer.motion,
          breath: 1,
        });
        dustMatsRef.current.push(dustMat);
        const dust = new THREE.Points(dustGeo, dustMat);
        dust.frustumCulled = false;
        dust.renderOrder = -1;
        rot.rings.get(i)!.pivot!.add(dust);
      }
    }

    // --- energy tide: cyan/ice-blue particle stream flowing from the upper
    // left toward the galactic core (static, independent of the rotation)
    {
      const streamCount = Math.round(54000 * D.particleMul);
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
      const streamGeo = makeParticleGeometry(sPos, sCol, 1);
      const streamMat = makeParticleMaterial({
        baseOpacity: 0.55, sizeMul: 4, maxPx: 3 * D.maxPxMul, motion: 5, breath: 1,
      });
      dustMatsRef.current.push(streamMat);
      const stream = new THREE.Points(streamGeo, streamMat);
      stream.frustumCulled = false;
      stream.position.set(gx, gy, gz);
      stream.renderOrder = -1;
      group.add(stream);
    }

    // --- ambient particles: a soft halo hugging the nebula's rim plus dim
    // same-palette motes filling the whole volume, so zoomed-in views float
    // inside a sea of particles instead of empty black space
    {
      const haloCount = Math.round(15600 * D.particleMul);
      const ambientCount = Math.round(31200 * D.particleMul);
      const total = haloCount + ambientCount;
      const aPos = new Float32Array(total * 3);
      const aCol = new Float32Array(total * 3);
      for (let i = 0; i < total; i++) {
        if (i < haloCount) {
          // shell around the disc rim (slightly flattened)
          const rr = 320 + Math.abs(gauss3()) * 170;
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          aPos[i * 3] = rr * Math.sin(phi) * Math.cos(theta);
          aPos[i * 3 + 1] = rr * Math.sin(phi) * Math.sin(theta) * 0.55;
          aPos[i * 3 + 2] = rr * Math.cos(phi);
        } else {
          // gaussian ball covering the interior volume too
          aPos[i * 3] = gauss3() * 300;
          aPos[i * 3 + 1] = gauss3() * 190;
          aPos[i * 3 + 2] = gauss3() * 300;
        }
        const roll = Math.random();
        if (roll < 0.5) tmp.copy(DUST_AMBER);
        else if (roll < 0.85) tmp.copy(DUST_COOL);
        else tmp.copy(DUST_BRIGHT);
        tmp.multiplyScalar(0.22 + Math.random() * 0.5);
        aCol[i * 3] = tmp.r;
        aCol[i * 3 + 1] = tmp.g;
        aCol[i * 3 + 2] = tmp.b;
      }
      const ambGeo = makeParticleGeometry(aPos, aCol, 1);
      const ambMat = makeParticleMaterial({
        baseOpacity: 0.38, sizeMul: 3.4, maxPx: 3 * D.maxPxMul, motion: 6, breath: 1,
      });
      dustMatsRef.current.push(ambMat);
      const ambient = new THREE.Points(ambGeo, ambMat);
      ambient.frustumCulled = false;
      ambient.position.set(gx, gy, gz);
      ambient.renderOrder = -1;
      group.add(ambient);
    }

    // --- central bulge: a dense knot of warm stars filling the core --------
    {
      const bulgeCount = Math.round(3000 * D.particleMul);
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
      const bulgeGeo = makeParticleGeometry(bPos, bCol, 1);
      const bulgeMat = makeParticleMaterial({
        baseOpacity: 0.5, sizeMul: 5, maxPx: 4 * D.maxPxMul, motion: 3, breath: 1,
      });
      dustMatsRef.current.push(bulgeMat);
      const bulge = new THREE.Points(bulgeGeo, bulgeMat);
      bulge.frustumCulled = false;
      bulge.renderOrder = -1;
      rot.rings.get(0)!.pivot!.add(bulge);
    }

    // --- blazing white-blue star core: volumetric glow layers + a small
    // intensely bright kernel (bloom flares it) + radiating diffraction rays
    const coreSpecs = [
      { map: nebulaTexture, color: '#26406e', scale: 420, opacity: 0.1 }, // volumetric haze
      { map: haloTexture, color: '#9fc4ff', scale: 130, opacity: 0.16 },
      { map: haloTexture, color: '#dfeaff', scale: 70, opacity: 0.24 },
      { map: haloTexture, color: '#ffffff', scale: 26, opacity: 0.5 }, // kernel
      { map: spikeTexture, color: '#cfe2ff', scale: 260, opacity: 0.14 }, // rays
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
      mat.userData.baseOpacity = spec.opacity;
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

  // --- per-frame animation: bloom, particle time/scale, node breathing,
  // burst reveal, and the selected-poet HTML label position ------------------
  useEffect(() => {
    deviceRef.current = computeDevice(width);
    let raf = 0;
    const camera = () => fgRef.current!.camera() as THREE.PerspectiveCamera;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const fg = fgRef.current;
      const bloom = bloomRef.current;
      if (!fg || !bloom) return;
      const now = performance.now();
      const time = now / 1000;
      const d = fg.camera().position.distanceTo(rotationRef.current.center);
      const t = Math.min(1, Math.max(0, (d - 140) / 760)); // 140 → 900
      bloom.strength = (0.1 + t * 0.5) * deviceRef.current.bloomMul;

      // perspective point-size scale: matches three's sizeAttenuation formula
      const cam = camera();
      const uScale =
        (height * Math.min(2, window.devicePixelRatio)) /
        (2 * Math.tan((cam.fov * Math.PI) / 360));
      for (const m of sceneMatsRef.current) {
        m.uniforms.uTime.value = time;
        m.uniforms.uScale.value = uScale;
      }
      for (const m of dustMatsRef.current) {
        m.uniforms.uTime.value = time;
        m.uniforms.uScale.value = uScale;
      }

      // star breathing (period 1–2 s), modulating the visible body brightness:
      //  · idle  → all named stars pulse with strong 60–80% contrast (req 9)
      //  · select→ every non-highlighted star pulses with 40–60% contrast so
      //            the rest of the sky keeps breathing behind the burst (req 10)
      const sel = selectionActiveRef.current;
      const filt = filterActiveRef.current;
      if (!filt) {
        const lit = highlightIdsRef.current;
        for (const v of visualsRef.current.values()) {
          if (sel && lit.has(v.node.id)) continue; // highlighted: stay steady
          if (!sel && v.node.generated) continue; // idle: only named stars
          const b = 0.5 + 0.5 * Math.sin(time * v.bspeed + v.phase); // 0..1
          // idle: 0.30→1.00 (70% swing); selection-others: 0.18→0.40 (~55%)
          const m = sel ? 0.18 + 0.22 * b : 0.3 + 0.7 * b;
          v.bodyMat.color.copy(v.baseColor).multiplyScalar(m);
          v.bodyMat.opacity = sel ? 0.45 * (0.5 + b) : 0.92;
          if (v.haloMat) v.haloMat.opacity = (sel ? 0.05 : 0.12) * (0.5 + b);
        }
      }

      // selection burst timeline: beams appear on their own schedules inside
      // the shader (uElapsed); the whole set fades out 10 s after appearing.
      const burst = burstRef.current;
      if (burst && burst.group.parent && burst.group.visible) {
        const elapsed = now - burstStartRef.current;
        const base = burstBaseRef.current;
        const fade =
          elapsed <= 10000 ? 1 : Math.max(0, 1 - (elapsed - 10000) / 1500);
        burst.beamMatH.uniforms.uElapsed.value = elapsed;
        burst.beamMatV.uniforms.uElapsed.value = elapsed;
        burst.beamMatH.uniforms.uOpacity.value = base.h * fade;
        burst.beamMatV.uniforms.uOpacity.value = base.h * fade;
        burst.glow.opacity = base.glow * fade;
        if (fade <= 0) burst.group.visible = false;
      }

      // animate comet photons along the highlighted links (head + trail)
      const comets = cometsRef.current;
      if (comets.length) {
        const TRAIL = 6;
        const step = 0.05;
        const tmpv = comet_tmp;
        for (const c of comets) {
          c.t += c.speed;
          if (c.t > 1) c.t -= 1;
          const arr = c.posAttr.array as Float32Array;
          for (let k = 0; k < TRAIL; k++) {
            const tk = Math.max(0, c.t - k * step);
            tmpv.lerpVectors(c.a, c.b, tk);
            arr[k * 3] = tmpv.x;
            arr[k * 3 + 1] = tmpv.y;
            arr[k * 3 + 2] = tmpv.z;
            if (k === 0) c.head.position.copy(tmpv);
          }
          c.posAttr.needsUpdate = true;
        }
      }

      // track the selected poet's HTML label to its on-screen position
      const box = labelBoxRef.current;
      const node = selectedNodeRef.current;
      if (box) {
        if (node) {
          const s = fg.graph2ScreenCoords(node.x ?? 0, node.y ?? 0, node.z ?? 0);
          const onScreen =
            s.x >= -200 && s.x <= width + 200 && s.y >= -100 && s.y <= height + 100;
          box.style.display = onScreen ? 'block' : 'none';
          box.style.transform = `translate(-50%, -100%) translate(${s.x}px, ${s.y - 16}px)`;
        } else {
          box.style.display = 'none';
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

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
      const time = now / 1000;
      const DRIFT_AMP = 6; // small — each star wanders but stays in its arm
      for (const v of visualsRef.current.values()) {
        const orbit = rot.orbits.get(v.node.id);
        if (!orbit) continue;
        const g = rot.rings.get(orbit.ring);
        if (!g) continue;
        const cosT = Math.cos(g.theta);
        const sinT = Math.sin(g.theta);
        const x = orbit.base.x * cosT + orbit.base.z * sinT;
        const z = -orbit.base.x * sinT + orbit.base.z * cosT;
        // per-star ambient drift with its own direction & speed (±5–10%)
        const dw = Math.sin(time * v.driftSpeed + v.driftPhase) * DRIFT_AMP;
        const nx = c.x + x + v.drift.x * dw;
        const ny = c.y + orbit.base.y + v.drift.y * dw;
        const nz = c.z + z + v.drift.z * dw;
        v.obj.position.set(nx, ny, nz);
        // keep data in sync: camera focus, tooltips, particles and link
        // geometry (synced on demand) all read node.x/y/z
        v.node.x = nx;
        v.node.y = ny;
        v.node.z = nz;
      }
      rot.linksDirty = true;
      // type-filtered links stay visible while rotating: keep them attached
      if (filterTypesRef.current) syncLinkGeometries();
    };

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__stepRotation = step;
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      // clamp dt tighter so a dropped frame can't cause a visible jump; this
      // keeps the differential rotation gliding smoothly (#15)
      const dt = Math.min(0.05, (now - last) / 1000);
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
    <div style={{ position: 'relative', width, height }}>
      <ForceGraph3D
        ref={fgRef}
        width={width}
        height={height}
        graphData={graphData}
        backgroundColor="#04050c"
        controlType="orbit"
        showNavInfo={false}
        warmupTicks={0}
        cooldownTicks={30}
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
        linkDirectionalParticles={0}
        onLinkClick={onLinkClick}
        onBackgroundClick={onBackgroundClick}
        enableNodeDrag={false}
      />
      <div ref={labelBoxRef} className="sm-selected-label" style={{ display: 'none' }}>
        <span ref={labelNameRef} className="sm-name" />
        <span ref={labelSubRef} className="sm-sub" />
      </div>
    </div>
  );
}

export const StarMap = memo(StarMapInner);

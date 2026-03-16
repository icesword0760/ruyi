const PALETTE = [
  [99, 102, 241],   // indigo
  [139, 92, 246],   // violet
  [6, 182, 212],    // cyan
  [168, 85, 247],   // purple
  [59, 130, 246],   // blue
  [236, 72, 153],   // pink
  [16, 185, 129],   // emerald
  [245, 158, 11],   // amber
  [244, 63, 94],    // rose
  [34, 211, 238],   // sky
  [163, 230, 53],   // lime
  [251, 146, 60],   // orange
];

interface Band {
  yCenter: number;
  heightRatio: number;
  freq: number;
  speed: number;
  phase: number;
  colorSpeed: number;
  colorPhase: number;
  opacity: number;
  wobbleFreq: number;
  wobbleSpeed: number;
}

const BANDS: Band[] = [];

function seedBands() {
  const count = 12;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    BANDS.push({
      yCenter: 0.06 + t * 0.90,
      heightRatio: 0.18 + Math.sin(i * 1.7) * 0.06,
      freq: 0.5 + (i % 5) * 0.25,
      speed: 2.6 + Math.sin(i * 2.3) * 1.4,
      phase: i * 1.37,
      colorSpeed: 0.25 + (i % 4) * 0.08,
      colorPhase: i * 1.1,
      opacity: 0.28 + Math.sin(i * 0.9) * 0.06,
      wobbleFreq: 0.3 + (i % 3) * 0.15,
      wobbleSpeed: 0.4 + Math.sin(i * 3.1) * 0.25,
    });
  }
}
seedBands();

let ctx: CanvasRenderingContext2D | null = null;
let canvas: HTMLCanvasElement | null = null;
let rafId = 0;
let observer: ResizeObserver | null = null;
let w = 0;
let h = 0;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function resize() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  w = rect.width * dpr;
  h = rect.height * dpr;
  canvas.width = w;
  canvas.height = h;
}

function getColor(sec: number, colorSpeed: number, colorPhase: number): [number, number, number] {
  const len = PALETTE.length;
  const idx = ((sec * colorSpeed + colorPhase) % len + len) % len;
  const i = Math.floor(idx);
  const frac = idx - i;
  const a = PALETTE[i];
  const b = PALETTE[(i + 1) % len];
  return [lerp(a[0], b[0], frac), lerp(a[1], b[1], frac), lerp(a[2], b[2], frac)];
}

function drawBand(c: CanvasRenderingContext2D, band: Band, sec: number) {
  const wobble = Math.sin(sec * band.wobbleSpeed + band.phase * 0.7) * h * 0.03;
  const cy = h * band.yCenter + wobble;
  const bandH = h * band.heightRatio;
  const steps = Math.ceil(w / 2);
  const dx = w / steps;

  const waveY = (x: number) => {
    const nx = x / w;
    const w1 = Math.sin(nx * Math.PI * 2 * band.freq + sec * band.speed + band.phase);
    const w2 = Math.sin(nx * Math.PI * 4.1 * band.freq + sec * band.speed * 0.7 + band.phase + 2.1);
    const w3 = Math.sin(nx * Math.PI * 1.3 + sec * band.speed * 0.4 + band.phase * 1.5);
    const drift = Math.sin(sec * band.wobbleFreq + band.phase) * bandH * 0.2;
    return cy + (w1 * 0.45 + w2 * 0.30 + w3 * 0.25) * bandH * 0.45 + drift;
  };

  const [cr, cg, cb] = getColor(sec, band.colorSpeed, band.colorPhase);
  const breathe = 0.55 + 0.45 * Math.sin(sec * 0.6 + band.phase * 1.3);
  const alpha = band.opacity * breathe;

  c.beginPath();
  c.moveTo(0, waveY(0) + bandH * 0.5);
  for (let i = 0; i <= steps; i++) {
    c.lineTo(i * dx, waveY(i * dx) + bandH * 0.5);
  }
  for (let i = steps; i >= 0; i--) {
    c.lineTo(i * dx, waveY(i * dx) - bandH * 0.5);
  }
  c.closePath();

  const grad = c.createLinearGradient(0, cy - bandH, 0, cy + bandH);
  grad.addColorStop(0, `rgba(${cr | 0},${cg | 0},${cb | 0},0)`);
  grad.addColorStop(0.25, `rgba(${cr | 0},${cg | 0},${cb | 0},${alpha * 0.5})`);
  grad.addColorStop(0.5, `rgba(${cr | 0},${cg | 0},${cb | 0},${alpha})`);
  grad.addColorStop(0.75, `rgba(${cr | 0},${cg | 0},${cb | 0},${alpha * 0.5})`);
  grad.addColorStop(1, `rgba(${cr | 0},${cg | 0},${cb | 0},0)`);

  c.fillStyle = grad;
  c.fill();
}

function frame(t: number) {
  if (!ctx || !canvas) return;
  const sec = t / 1000;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.filter = "blur(6px)";

  for (const band of BANDS) {
    drawBand(ctx, band, sec);
  }

  ctx.restore();
  rafId = requestAnimationFrame(frame);
}

export function initAurora(el: HTMLCanvasElement | null) {
  if (!el) return;
  canvas = el;
  ctx = canvas.getContext("2d");
  if (!ctx) return;

  resize();
  observer = new ResizeObserver(resize);
  observer.observe(canvas);
  rafId = requestAnimationFrame(frame);
}

export function destroyAurora() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (observer) { observer.disconnect(); observer = null; }
  ctx = null;
  canvas = null;
}

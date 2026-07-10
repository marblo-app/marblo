"use client";

import { useEffect, useRef } from "react";

/**
 * HeroConstellation — subtle background animation for the landing hero.
 *
 * A central orchestrator "hub" (indigo glow) connected to drifting agent
 * nodes coloured after the three fleets Marblo runs — Claude (orange),
 * Codex (green), Antigravity (violet). Data-flow pulses travel the
 * hub↔agent links. Deliberately understated (dark bg, low opacity) so it
 * never competes with the hero copy — Toss developer-site energy: "살짝".
 *
 * Vanilla Canvas 2D only (no WebGL / 3D libs). rAF-driven, DPR-capped,
 * paused off-screen via IntersectionObserver, and fully static under
 * prefers-reduced-motion. Purely decorative: pointer-events none, aria-hidden.
 *
 * This is a draft — colour, density and speed are intentionally easy to
 * tune via the CONFIG block below.
 */

// Agent fleet accent colours (RGB tuples so we can vary alpha per-draw).
const AGENT_COLORS: Array<[number, number, number]> = [
  [232, 89, 12], // Claude   #e8590c (orange)
  [47, 158, 68], // Codex    #2f9e44 (green)
  [112, 72, 232], // Antigravity #7048e8 (violet)
];
const HUB_COLOR: [number, number, number] = [99, 102, 241]; // indigo-500

// Tuning knobs: colour/density/speed live here + in buildNodes() constants
// (node count, ax/ay spread, radius, size) — adjust those two spots to retune.
const CONFIG = {
  dprCap: 2, // cap devicePixelRatio to protect fill-rate
  driftSpeed: 0.12, // px/frame ceiling for node drift (very slow)
  pulseSpeed: 0.0022, // fraction of a link traversed per ms
  linkAlpha: 0.14, // base opacity of connection lines
  nodeAlpha: 0.55, // base opacity of agent node cores
};

interface Node {
  // Anchor position as a fraction of canvas size (keeps layout responsive).
  ax: number;
  ay: number;
  // Live position (CSS px), eased toward a slowly moving orbit target.
  x: number;
  y: number;
  // Orbit params for gentle drift around the anchor.
  radius: number;
  angle: number;
  angularSpeed: number;
  size: number;
  color: [number, number, number];
  // Pulse phase [0,1) travelling hub -> node, offset so links desync.
  pulse: number;
  pulseOffset: number;
}

function rgba([r, g, b]: [number, number, number], a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export default function HeroConstellation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas: HTMLCanvasElement | null = canvasRef.current;
    if (!canvas) return;
    const el: HTMLCanvasElement = canvas;
    const rawCtx = el.getContext("2d");
    if (!rawCtx) return;
    // Non-nullable declared type so nested closures need no re-narrowing
    // (this project's tsconfig does not preserve control-flow narrowing
    // of outer consts inside closures).
    const ctx: CanvasRenderingContext2D = rawCtx;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let nodes: Node[] = [];
    let hub = { x: 0, y: 0 };
    let rafId = 0;
    let running = false;
    let lastTs = 0;

    // Deterministic pseudo-random so successive renders stay stable within a
    // session but nodes are still visually scattered. (No Math.random reliance
    // on exact values — purely cosmetic.)
    let seed = 20260710;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    function buildNodes() {
      const isMobile = width < 640;
      // Fewer nodes on small screens; each agent colour repeated a couple times.
      const count = isMobile ? 9 : 16;
      nodes = [];
      for (let i = 0; i < count; i++) {
        // Bias nodes toward the left/right edges so the centre column — where
        // the headline (centred, max-w-4xl) sits — stays clear. Both sides
        // reach equally far out (symmetric framing) rather than clumping
        // behind the copy. Left band ~[0.02,0.42], right band ~[0.58,0.98].
        const rx = rand();
        const ax = rx < 0.5 ? 0.02 + rx * 0.8 : 0.98 - (1 - rx) * 0.8;
        const ay = 0.02 + rand() * 0.94;
        nodes.push({
          ax,
          ay,
          x: ax * width,
          y: ay * height,
          radius: (isMobile ? 8 : 14) + rand() * (isMobile ? 10 : 22),
          angle: rand() * Math.PI * 2,
          angularSpeed: (0.06 + rand() * 0.12) * (rand() > 0.5 ? 1 : -1),
          size: (isMobile ? 1.4 : 1.8) + rand() * 1.4,
          color: AGENT_COLORS[i % AGENT_COLORS.length],
          pulse: rand(),
          pulseOffset: rand(),
        });
      }
      // Colour by horizontal order so neither side clumps into a single hue
      // (fixes the "right side all green" seed artefact).
      nodes
        .slice()
        .sort((a, b) => a.ax - b.ax)
        .forEach((n, idx) => {
          n.color = AGENT_COLORS[idx % AGENT_COLORS.length];
        });
    }

    function resize() {
      const rect = el.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      if (width === 0 || height === 0) return;
      dpr = Math.min(window.devicePixelRatio || 1, CONFIG.dprCap);
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Hub sits slightly above centre so it lives behind the headline.
      hub = { x: width * 0.5, y: height * 0.42 };
      if (nodes.length === 0) buildNodes();
      else {
        // Re-project anchors onto the new size (keeps relative layout).
        for (const n of nodes) {
          n.x = n.ax * width;
          n.y = n.ay * height;
        }
      }
    }

    function draw(dtMs: number) {
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";

      // --- Links + travelling pulses (drawn first, behind nodes) ---
      for (const n of nodes) {
        const grad = ctx.createLinearGradient(hub.x, hub.y, n.x, n.y);
        grad.addColorStop(0, rgba(HUB_COLOR, CONFIG.linkAlpha));
        grad.addColorStop(1, rgba(n.color, CONFIG.linkAlpha * 0.7));
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hub.x, hub.y);
        ctx.lineTo(n.x, n.y);
        ctx.stroke();

        // Data-flow pulse: a small dot easing hub -> node.
        if (!reduceMotion) {
          n.pulse = (n.pulse + CONFIG.pulseSpeed * dtMs) % 1;
        }
        const p = (n.pulse + n.pulseOffset) % 1;
        const px = hub.x + (n.x - hub.x) * p;
        const py = hub.y + (n.y - hub.y) * p;
        // Fade the pulse in at the hub and out at the node.
        const pulseAlpha = Math.sin(p * Math.PI) * 0.6;
        ctx.beginPath();
        ctx.fillStyle = rgba(n.color, pulseAlpha);
        ctx.arc(px, py, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- Agent nodes (soft glow + core) ---
      for (const n of nodes) {
        const glow = ctx.createRadialGradient(
          n.x,
          n.y,
          0,
          n.x,
          n.y,
          n.size * 6
        );
        glow.addColorStop(0, rgba(n.color, CONFIG.nodeAlpha * 0.5));
        glow.addColorStop(1, rgba(n.color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.size * 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = rgba(n.color, CONFIG.nodeAlpha);
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- Orchestrator hub (brightest element, still subtle) ---
      const hubGlow = ctx.createRadialGradient(
        hub.x,
        hub.y,
        0,
        hub.x,
        hub.y,
        34
      );
      hubGlow.addColorStop(0, rgba(HUB_COLOR, 0.32));
      hubGlow.addColorStop(1, rgba(HUB_COLOR, 0));
      ctx.fillStyle = hubGlow;
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, 34, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = rgba(HUB_COLOR, 0.85);
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, 2.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = "source-over";
    }

    function step(ts: number) {
      if (!running) return;
      const dtMs = lastTs ? Math.min(ts - lastTs, 48) : 16;
      lastTs = ts;

      // Drift each node gently around its anchor.
      for (const n of nodes) {
        n.angle += n.angularSpeed * (dtMs / 1000);
        const targetX = n.ax * width + Math.cos(n.angle) * n.radius;
        const targetY = n.ay * height + Math.sin(n.angle) * n.radius;
        // Ease toward the orbit target, clamped so it never darts.
        const dx = targetX - n.x;
        const dy = targetY - n.y;
        const maxStep = CONFIG.driftSpeed * (dtMs / 16);
        n.x += Math.max(-maxStep, Math.min(maxStep, dx * 0.02));
        n.y += Math.max(-maxStep, Math.min(maxStep, dy * 0.02));
      }

      draw(dtMs);
      rafId = requestAnimationFrame(step);
    }

    function start() {
      if (running || reduceMotion) return;
      running = true;
      lastTs = 0;
      rafId = requestAnimationFrame(step);
    }

    function stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    }

    resize();

    // Static, single-frame render for reduced-motion users (no animation).
    if (reduceMotion) {
      draw(16);
    }

    // Pause when the hero scrolls off-screen (saves battery / main thread).
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting;
        if (visible) start();
        else stop();
      },
      { threshold: 0.01 }
    );
    io.observe(el);

    const ro = new ResizeObserver(() => {
      resize();
      if (reduceMotion) draw(16);
    });
    ro.observe(el);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}

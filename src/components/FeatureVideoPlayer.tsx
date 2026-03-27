/**
 * FeatureVideoPlayer.tsx
 * ---------------------------------------------------------------------------
 * StudioLuxe Voice — AI Voice Generation Platform
 * Feature showcase slideshow component.
 *
 * Drop-in replacement for a 16:9 video player section.
 * No external libraries — pure React + Tailwind CSS (CDN).
 *
 * Usage in a React + Tailwind CDN page:
 *   import FeatureVideoPlayer from "./FeatureVideoPlayer";
 *   <FeatureVideoPlayer />
 *
 * Or inline the JSX directly into your landing page component tree.
 * ---------------------------------------------------------------------------
 */

import React, { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Slide {
  /** Material Symbols codepoint name (ligature text content) */
  icon: string;
  /** Feature title */
  title: string;
  /** Short supporting tagline, ≤ 15 words */
  tagline: string;
  /** Optional metric / stat badge text */
  stat?: string;
  /** Optional stat badge label shown below the value */
  statLabel?: string;
  /** Subtle accent hue override for the icon glow (CSS colour string) */
  accentColor?: string;
}

// ---------------------------------------------------------------------------
// Slide data — 6 curated features
// ---------------------------------------------------------------------------

const SLIDES: Slide[] = [
  {
    icon: "graphic_eq",
    title: "Voice Generation",
    tagline: "Studio-grade audio rendered in seconds, every single take.",
    stat: "1.1s",
    statLabel: "avg. render",
    accentColor: "rgba(127,19,236,0.75)",
  },
  {
    icon: "language",
    title: "29+ Languages",
    tagline: "Global reach. One engine. Zero re-recording ever needed.",
    stat: "29+",
    statLabel: "languages",
    accentColor: "rgba(99,102,241,0.75)",
  },
  {
    icon: "layers",
    title: "Batch Processing",
    tagline: "Thousands of variants generated in minutes, not days.",
    stat: "10K+",
    statLabel: "variants / run",
    accentColor: "rgba(139,92,246,0.75)",
  },
  {
    icon: "record_voice_over",
    title: "Voice Cloning",
    tagline: "Your brand voice. Captured once. Perfectly preserved forever.",
    accentColor: "rgba(168,85,247,0.75)",
  },
  {
    icon: "edit_note",
    title: "Script Editor",
    tagline: "AI-assisted pacing, emotion, and emphasis — built right in.",
    accentColor: "rgba(109,40,217,0.75)",
  },
  {
    icon: "verified_user",
    title: "Safety & Compliance",
    tagline: "Deepfake protection and watermark injection. Always on.",
    stat: "SOC 2",
    statLabel: "compliant",
    accentColor: "rgba(91,33,182,0.75)",
  },
];

const AUTOPLAY_INTERVAL_MS = 4000;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** A single slide card rendered inside the viewport. */
const SlideCard: React.FC<{
  slide: Slide;
  isActive: boolean;
  direction: "enter" | "exit-left" | "exit-right" | "idle";
}> = ({ slide, isActive, direction }) => {
  /*
   * Transition logic:
   *  - idle / inactive  → fully transparent, translated off-screen
   *  - enter (active)   → fade + slide in from right → centre
   *  - exit-left        → fade out, slide to left
   *
   * We achieve this with inline style + Tailwind utility classes.
   * Because Tailwind CDN processes class names at runtime we can use
   * arbitrary values safely here.
   */

  const visibilityClass = isActive
    ? "opacity-100 translate-x-0 scale-100"
    : direction === "exit-left"
    ? "opacity-0 -translate-x-10 scale-95"
    : "opacity-0 translate-x-10 scale-95";

  return (
    <div
      className={[
        "absolute inset-0 flex flex-col items-center justify-center px-8 sm:px-12 md:px-20",
        "transition-all duration-700 ease-in-out will-change-transform",
        visibilityClass,
      ].join(" ")}
      aria-hidden={!isActive}
    >
      {/* ── Icon block ─────────────────────────────────────── */}
      <div className="relative flex items-center justify-center mb-7 sm:mb-9">
        {/* Glow ring */}
        <span
          className="absolute rounded-full blur-2xl opacity-60"
          style={{
            width: 120,
            height: 120,
            background: slide.accentColor ?? "rgba(127,19,236,0.75)",
          }}
        />
        {/* Icon */}
        <span
          className="relative z-10 select-none"
          style={{
            fontFamily: "'Material Symbols Outlined'",
            fontVariationSettings: "'FILL' 0, 'wght' 200, 'GRAD' 0, 'opsz' 48",
            fontSize: 80,
            lineHeight: 1,
            color: "#c084fc",
            filter: `drop-shadow(0 0 18px ${slide.accentColor ?? "rgba(127,19,236,0.9)"})`,
          }}
          aria-hidden="true"
        >
          {slide.icon}
        </span>
      </div>

      {/* ── Stat badge ─────────────────────────────────────── */}
      {slide.stat && (
        <div className="flex flex-col items-center mb-5">
          <div
            className="px-4 py-1.5 rounded-full border text-xs font-semibold tracking-widest uppercase"
            style={{
              background: "rgba(127,19,236,0.12)",
              borderColor: "rgba(127,19,236,0.35)",
              color: "#c084fc",
            }}
          >
            {slide.stat}
            {slide.statLabel && (
              <span className="ml-2 text-slate-400 font-normal normal-case tracking-normal">
                {slide.statLabel}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Title ──────────────────────────────────────────── */}
      <h3
        className="text-center font-bold text-white leading-tight mb-3 tracking-tight"
        style={{ fontSize: "clamp(1.4rem, 3.5vw, 2rem)" }}
      >
        {slide.title}
      </h3>

      {/* ── Tagline ────────────────────────────────────────── */}
      <p
        className="text-center text-slate-400 max-w-sm leading-relaxed"
        style={{ fontSize: "clamp(0.82rem, 1.8vw, 0.97rem)" }}
      >
        {slide.tagline}
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dot navigation
// ---------------------------------------------------------------------------

const DotNav: React.FC<{
  count: number;
  active: number;
  onSelect: (index: number) => void;
}> = ({ count, active, onSelect }) => (
  <div className="flex items-center justify-center gap-2.5" role="tablist" aria-label="Slide navigation">
    {Array.from({ length: count }).map((_, i) => (
      <button
        key={i}
        role="tab"
        aria-selected={i === active}
        aria-label={`Go to slide ${i + 1}`}
        onClick={() => onSelect(i)}
        className={[
          "rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500",
          i === active
            ? "w-6 h-2 bg-purple-500"
            : "w-2 h-2 bg-white/20 hover:bg-white/40",
        ].join(" ")}
      />
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Progress bar (thin line at the very top of the card)
// ---------------------------------------------------------------------------

const ProgressBar: React.FC<{ durationMs: number; tick: number }> = ({
  durationMs,
  tick,
}) => {
  /*
   * `tick` is incremented every time the slide advances. We key the animation
   * on it so the bar resets and re-runs from 0% on each new slide.
   */
  return (
    <div className="absolute top-0 left-0 right-0 h-[2px] overflow-hidden rounded-t-3xl z-20">
      <div
        key={tick}
        className="h-full rounded-full"
        style={{
          background:
            "linear-gradient(90deg, #7f13ec 0%, #c084fc 60%, #a855f7 100%)",
          animation: `slideProgress ${durationMs}ms linear forwards`,
        }}
      />
      <style>{`
        @keyframes slideProgress {
          from { width: 0%; }
          to   { width: 100%; }
        }
      `}</style>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * FeatureVideoPlayer
 *
 * Replaces a 16:9 video player section on the StudioLuxe Voice landing page.
 * Maintains the same outer dimensions: `relative w-full max-w-6xl mx-auto`,
 * 16:9 aspect ratio via `aspect-video` (Tailwind v3) or inline padding-top hack.
 *
 * Requires in <head>:
 *   <!-- Tailwind CDN -->
 *   <script src="https://cdn.tailwindcss.com"></script>
 *
 *   <!-- Material Symbols Outlined -->
 *   <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
 */
const FeatureVideoPlayer: React.FC = () => {
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const [tick, setTick] = useState<number>(0);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  // Auto-advance
  useEffect(() => {
    if (isPaused) return;
    const id = setInterval(() => {
      advance();
    }, AUTOPLAY_INTERVAL_MS);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, isPaused]);

  const advance = (target?: number) => {
    setPrevIndex(activeIndex);
    const next =
      target !== undefined
        ? target
        : (activeIndex + 1) % SLIDES.length;
    setActiveIndex(next);
    setTick((t) => t + 1);
  };

  const handleDotClick = (i: number) => {
    if (i === activeIndex) return;
    advance(i);
  };

  return (
    /*
     * Outer wrapper matches original video section sizing:
     *   max-w-6xl, w-full, mx-auto, aspect-video (16:9)
     * The `aspect-video` class is Tailwind v3+. For broader compat we also
     * provide the inline padding-top fallback via a wrapper div.
     */
    <div className="relative w-full max-w-6xl mx-auto">
      {/* 16:9 aspect-ratio shell */}
      <div
        className="relative w-full overflow-hidden rounded-2xl md:rounded-3xl border"
        style={{
          aspectRatio: "16 / 9",
          background: "#08080d",
          borderColor: "rgba(255,255,255,0.05)",
        }}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onFocus={() => setIsPaused(true)}
        onBlur={() => setIsPaused(false)}
        role="region"
        aria-label="Feature showcase"
        aria-roledescription="slideshow"
        aria-live="polite"
      >
        {/* ── Radial gradient backdrop ─────────────────────── */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 70% at 50% 50%, rgba(127,19,236,0.08), transparent)",
          }}
          aria-hidden="true"
        />

        {/* ── Subtle grid texture overlay ──────────────────── */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), " +
              "linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
          aria-hidden="true"
        />

        {/* ── Top-edge progress bar ─────────────────────────── */}
        {!isPaused && (
          <ProgressBar durationMs={AUTOPLAY_INTERVAL_MS} tick={tick} />
        )}

        {/* ── Corner accent lines ───────────────────────────── */}
        <CornerAccents />

        {/* ── Slide cards ───────────────────────────────────── */}
        {SLIDES.map((slide, i) => (
          <SlideCard
            key={slide.icon}
            slide={slide}
            isActive={i === activeIndex}
            direction={
              i === prevIndex
                ? "exit-left"
                : i === activeIndex
                ? "enter"
                : "idle"
            }
          />
        ))}

        {/* ── Bottom bar: dots + pause indicator ───────────── */}
        <div className="absolute bottom-5 sm:bottom-7 left-0 right-0 flex flex-col items-center gap-2.5 z-30">
          <DotNav
            count={SLIDES.length}
            active={activeIndex}
            onSelect={handleDotClick}
          />
          {isPaused && (
            <span
              className="text-xs text-white/20 tracking-widest uppercase"
              aria-live="polite"
            >
              paused
            </span>
          )}
        </div>

        {/* ── Slide counter (top-right) ─────────────────────── */}
        <div
          className="absolute top-4 right-5 z-30 tabular-nums text-xs font-medium tracking-wider"
          style={{ color: "rgba(255,255,255,0.18)" }}
          aria-hidden="true"
        >
          {String(activeIndex + 1).padStart(2, "0")}{" "}
          <span style={{ color: "rgba(255,255,255,0.08)" }}>/</span>{" "}
          {String(SLIDES.length).padStart(2, "0")}
        </div>

        {/* ── Brand wordmark (top-left) ─────────────────────── */}
        <div
          className="absolute top-4 left-5 z-30 flex items-center gap-1.5"
          aria-hidden="true"
        >
          <span
            className="rounded-full inline-block"
            style={{
              width: 6,
              height: 6,
              background: "#7f13ec",
              boxShadow: "0 0 6px 2px rgba(127,19,236,0.7)",
            }}
          />
          <span
            className="text-xs font-semibold tracking-widest uppercase"
            style={{ color: "rgba(255,255,255,0.22)", letterSpacing: "0.15em" }}
          >
            StudioLuxe Voice
          </span>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Corner accent decoration (purely visual)
// ---------------------------------------------------------------------------

const CornerAccents: React.FC = () => (
  <>
    {/* Top-left */}
    <svg
      className="absolute top-0 left-0 z-10 pointer-events-none"
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 38 L2 8 Q2 2 8 2 L38 2"
        stroke="rgba(127,19,236,0.35)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
    {/* Top-right */}
    <svg
      className="absolute top-0 right-0 z-10 pointer-events-none"
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M38 38 L38 8 Q38 2 32 2 L2 2"
        stroke="rgba(127,19,236,0.35)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
    {/* Bottom-left */}
    <svg
      className="absolute bottom-0 left-0 z-10 pointer-events-none"
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 2 L2 32 Q2 38 8 38 L38 38"
        stroke="rgba(127,19,236,0.35)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
    {/* Bottom-right */}
    <svg
      className="absolute bottom-0 right-0 z-10 pointer-events-none"
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M38 2 L38 32 Q38 38 32 38 L2 38"
        stroke="rgba(127,19,236,0.35)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  </>
);

export default FeatureVideoPlayer;

// EAS brand mark — a recreation of the logo (industrial gear + green energy
// bolt) as a self-contained, theme-aware SVG so it stays crisp at any size and
// adapts to light/dark surfaces. The gear inherits `currentColor` (so each
// placement sets its tone — metallic grey on the dark app, charcoal on white),
// while the lightning bolt is always the brand green. No raster, no external
// asset, no network fetch.

const TEETH = [0, 36, 72, 108, 144, 180, 216, 252, 288, 324];

export function EasMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="EAS"
      fill="none"
    >
      {/* Gear teeth + ring inherit currentColor */}
      <g fill="currentColor">
        {TEETH.map((a) => (
          <rect key={a} x="22.3" y="1.5" width="3.4" height="6.5" rx="1.1" transform={`rotate(${a} 24 24)`} />
        ))}
      </g>
      <circle cx="24" cy="24" r="17.5" stroke="currentColor" strokeWidth="5" />
      {/* Energy bolt — always brand green */}
      <path
        d="M26.5 11 L15.5 26.8 L22.5 26.8 L21 37 L32.5 20.5 L25.2 20.5 Z"
        fill="var(--color-accent)"
        stroke="var(--color-accent)"
        strokeWidth="0.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Mark on a rounded industrial tile — a drop-in for the old gradient "E" box.
// The tile keeps the brand visible on any surrounding surface.
export function EasBadge({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`shrink-0 grid place-items-center rounded-lg bg-gradient-to-br from-[#232a2a] to-[#12161a] text-[#c9d2ce] shadow-lg shadow-black/40 ${className}`}
      style={{ width: size, height: size }}
    >
      <EasMark size={Math.round(size * 0.78)} />
    </span>
  );
}

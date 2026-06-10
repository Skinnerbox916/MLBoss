/**
 * LineupOrderPip — batting-order indicator (see docs/design-system.md badges).
 *
 * Batting order drives plate-appearance volume and feeds the rating, so it
 * earns its own glyph — but it reads as a *lineup slot*, not a standing, so
 * it's a numeric pip (number-in-a-circle), never ordinal "1st / 3rd" text.
 *
 * States:
 *  - confirmed (in lineup): solid navy pip with the slot number 1–9
 *  - projected: dashed outline + number (future — we don't source projected
 *    order today, but the state exists so the system is ready)
 *  - not in lineup: red ✕ circle — a high-signal "won't accrue stats" warning
 */

interface LineupOrderPipProps {
  /** Batting slot 1–9. Omit/null when the player isn't in today's lineup. */
  order?: number | null;
  /** false → render the red ✕ "not in lineup" state regardless of order. */
  inLineup?: boolean;
  /** Dashed/“proj” treatment for projected (not-yet-confirmed) order. */
  projected?: boolean;
  className?: string;
}

export default function LineupOrderPip({
  order,
  inLineup = true,
  projected = false,
  className = '',
}: LineupOrderPipProps) {
  // Not in today's lineup — won't accrue stats. High-signal red ✕.
  if (inLineup === false) {
    return (
      <span
        title="Not in today's lineup"
        aria-label="Not in today's lineup"
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full bg-error/15 text-error ring-1 ring-error/40 text-[11px] font-bold leading-none ${className}`}
      >
        ✕
      </span>
    );
  }

  if (order == null || order < 1) return null;

  if (projected) {
    return (
      <span
        title={`Projected to bat ${order}`}
        aria-label={`Projected to bat ${order}`}
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full border border-dashed border-primary/50 text-primary text-[11px] font-bold font-mono leading-none ${className}`}
      >
        {order}
      </span>
    );
  }

  return (
    <span
      title={`Bats ${order}`}
      aria-label={`Bats ${order}`}
      className={`inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-white text-[11px] font-bold font-mono leading-none ${className}`}
    >
      {order}
    </span>
  );
}

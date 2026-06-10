'use client';

import type { ReactNode } from 'react';
import { FiChevronDown } from 'react-icons/fi';
import Icon from '@/components/Icon';

/**
 * Presentational shell for an expandable player row — the shared visual
 * primitive behind BOTH the categories lineup (`PlayerRow`) and the points
 * lineup. All look/layout lives here; the mode-specific wrappers compute the
 * data (rating vs points), the tier tint, the meta/matchup/score nodes, and
 * the expanded panel, then hand them in. Keeping the chrome in one component
 * is what stops the two surfaces from drifting apart.
 *
 * Structure mirrors the design system's canonical player row
 * (mlboss-design-system/project/preview/comp-player-row.html): avatar ·
 * identity (name + TEAM·POS meta) · matchup line · right cluster · chevron,
 * expanding to a detail panel.
 */
export interface PlayerRowShellProps {
  /** Left-border tint class, e.g. `border-l-success` (verdict / tier). */
  tierBorder: string;
  /** Row background tint class, e.g. `bg-success/5` (or ''). */
  tierBg?: string;
  /** Yahoo headshot URL; falls back to initials. */
  imageUrl?: string | null;
  /** Initials shown when no/failed image. */
  initials: string;
  /** Dim the row (injured / out). */
  dimmed?: boolean;
  /** Optional leading pip (lineup-order indicator). */
  pip?: ReactNode;
  name: string;
  /** Optional status badge after the name (IL / DTD). */
  statusBadge?: ReactNode;
  /** Mono metadata line, e.g. "LAD · OF". */
  metaText: string;
  /** Optional extra on the meta line (OPS badge / points figure). */
  metaExtra?: ReactNode;
  /** Matchup context line (opp + SP + weather), or a points equivalent. */
  matchupLine?: ReactNode;
  /** Right cluster before the chevron — slot badge, score column, etc. */
  right?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  /** Expanded detail panel. */
  children?: ReactNode;
}

export default function PlayerRowShell({
  tierBorder,
  tierBg = '',
  imageUrl,
  initials,
  dimmed = false,
  pip,
  name,
  statusBadge,
  metaText,
  metaExtra,
  matchupLine,
  right,
  expanded,
  onToggle,
  children,
}: PlayerRowShellProps) {
  return (
    <div className={`rounded-lg overflow-hidden border-l-[3px] ${tierBorder} ${tierBg} hover:bg-surface-muted/40 transition-colors`}>
      <button onClick={onToggle} className={`w-full flex items-start gap-3 px-3 py-2 text-left ${dimmed ? 'opacity-60' : ''}`}>
        {/* Avatar */}
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={name}
            className="w-9 h-9 rounded-full border border-border object-cover shrink-0 mt-0.5"
            onError={e => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <div className={`w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold ${imageUrl ? 'hidden' : ''}`}>
          {initials}
        </div>

        {/* Identity */}
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5">
            {pip}
            <span className="text-sm font-semibold text-foreground truncate">{name}</span>
            {statusBadge}
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
            <span className="truncate">{metaText}</span>
            {metaExtra}
          </div>
          {matchupLine}
        </div>

        {/* Right cluster + chevron */}
        <div className="shrink-0 flex items-center gap-2 mt-0.5">
          {right}
          <Icon
            icon={FiChevronDown}
            size={16}
            className={`text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {expanded && children}
    </div>
  );
}

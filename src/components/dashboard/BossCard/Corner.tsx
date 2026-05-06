import Image from 'next/image';
import { Heading } from '@/components/typography';

interface CornerProps {
  /** Team name. Rendered in display font. */
  teamName: string;
  /** Manager's display name (e.g. "Michael" or "Jose H"). Optional. */
  managerName?: string;
  /** Yahoo team logo URL. Optional — fallback initial bubble renders when absent. */
  logoUrl?: string;
  /** Pre-formatted record string (e.g. "40-32-8"). Optional. */
  record?: string;
  /** Standings rank. Optional. */
  rank?: number;
  /** Side of the marquee — controls text alignment and crown anchor. */
  side: 'left' | 'right';
  /** True when this team is the current matchup leader. Renders the crown
   *  insignia above the avatar and a faint logo watermark behind the name. */
  isLeader: boolean;
}

/**
 * Fight-card corner for the Boss Card marquee — avatar + name + record + rank.
 *
 * The leading team gets a crown above the avatar and a low-opacity watermark
 * behind the name. Both fall away when the matchup is tied so the card stays
 * symmetric.
 */
export default function Corner({
  teamName,
  managerName,
  logoUrl,
  record,
  rank,
  side,
  isLeader,
}: CornerProps) {
  const isRight = side === 'right';
  const initial = teamName.charAt(0).toUpperCase();

  return (
    <div
      className={`relative flex items-center gap-3 sm:gap-4 ${isRight ? 'flex-row-reverse text-right' : 'flex-row text-left'}`}
    >
      {/* Avatar + crown */}
      <div className="relative shrink-0">
        {isLeader && (
          <Image
            src="/assets/mlboss-crown.png"
            alt="Leader"
            width={36}
            height={24}
            priority
            aria-label="Matchup leader"
            className={`absolute -top-4 z-10 drop-shadow-sm ${
              isRight ? 'right-1 -rotate-[8deg]' : 'left-1 -rotate-[8deg]'
            }`}
          />
        )}
        <div
          className={`relative w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden bg-surface-muted ring-2 ring-offset-2 ring-offset-surface ${
            isLeader ? 'ring-accent' : 'ring-border'
          }`}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={`${teamName} logo`}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-primary">
              {initial}
            </div>
          )}
        </div>
      </div>

      {/* Name + sub-line */}
      <div className={`min-w-0 flex flex-col ${isRight ? 'items-end' : 'items-start'}`}>
        <Heading
          as="h2"
          className="text-xl sm:text-2xl text-primary truncate max-w-[14ch] sm:max-w-[20ch]"
        >
          {teamName}
        </Heading>
        <span
          className={`mt-1 inline-block h-px w-12 bg-accent/60 ${isRight ? 'self-end' : 'self-start'}`}
          aria-hidden="true"
        />
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
          {managerName && <span className="truncate">{managerName}</span>}
          {record && (
            <>
              {managerName && <span aria-hidden="true">·</span>}
              <span className="font-mono font-numeric tracking-tight text-foreground">
                {record}
              </span>
            </>
          )}
          {typeof rank === 'number' && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono font-numeric text-accent font-semibold">
                #{rank}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

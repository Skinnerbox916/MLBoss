'use client';

import Link from 'next/link';
import { GiBaseballBat } from 'react-icons/gi';
import Icon from '@/components/Icon';
import type { BossBriefOutput } from '@/lib/dashboard/bossBrief';

interface BossBriefProps {
  brief: BossBriefOutput | null;
}

/**
 * The Boss Brief — a single italic line of tactical guidance under the
 * marquee. v1 is rules-driven (`getBossBrief`), but the component renders
 * any `BossBriefOutput` — same shape will work when we swap the rules
 * engine for an LLM call later.
 *
 * The CTA, when present, links to the page where the user can act on the
 * recommendation (today / streaming / etc.) — closing the loop from "what
 * does the boss think?" to "what should I do about it?"
 */
export default function BossBrief({ brief }: BossBriefProps) {
  if (!brief) return null;

  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-primary/5 border-l-2 border-accent">
      <Icon
        icon={GiBaseballBat}
        size={16}
        className="text-accent shrink-0 mt-0.5"
        aria-hidden="true"
      />
      <p className="flex-1 text-sm italic font-body text-foreground leading-snug">
        <span>{brief.text}</span>
        {brief.cta && (
          <>
            {' '}
            <Link
              href={brief.cta.href}
              className="not-italic font-semibold text-accent underline decoration-accent/50 underline-offset-2 hover:decoration-accent transition-colors"
            >
              {brief.cta.phrase}
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

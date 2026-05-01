'use client';

import { type ReactNode, useTransition } from 'react';

interface Props {
  /** Server action invoked after the user confirms. */
  action: () => Promise<void>;
  /** Confirmation prompt shown via window.confirm(). Empty = no confirm. */
  confirm?: string;
  /** Tailwind classes for the button surface. */
  className: string;
  /** Disables the button (e.g. count === 0). */
  disabled?: boolean;
  /** Button label. */
  children: ReactNode;
}

/**
 * Client-side wrapper for destructive server actions. Prompts via
 * window.confirm before invoking the action. Wraps the call in a
 * transition so the UI reflects the pending state instead of feeling
 * dead.
 */
export default function ConfirmButton({
  action,
  confirm,
  className,
  disabled,
  children,
}: Props) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (disabled || pending) return;
    if (confirm && !window.confirm(confirm)) return;
    startTransition(async () => {
      await action();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      className={`${className} ${pending ? 'opacity-60 cursor-wait' : ''} disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {pending ? 'Clearing…' : children}
    </button>
  );
}

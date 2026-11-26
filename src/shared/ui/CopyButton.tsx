import { useEffect } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  targetId: string;
  label: string;
}

interface CommandLikeEvent extends Event {
  command?: string;
  source?: EventTarget | null;
}

const feedbackTimers = new WeakMap<HTMLElement, number>();
let handlersInstalled = false;
let lastAnnouncement = '';

function reportCopyResult(button: HTMLElement, ok: boolean): void {
  const tip = button.nextElementSibling;
  const existing = feedbackTimers.get(button);
  if (existing !== undefined) {
    window.clearTimeout(existing);
  }
  button.removeAttribute('data-copied');
  button.removeAttribute('data-failed');

  let message = ok ? 'Copied' : 'Copy failed';
  // VoiceOver skips repeated identical announcements even after clearing the region.
  if (message === lastAnnouncement) {
    message += '\u00A0';
  }
  lastAnnouncement = message;

  if (tip) tip.textContent = '';
  void button.offsetWidth;
  button.setAttribute(ok ? 'data-copied' : 'data-failed', '');
  window.requestAnimationFrame(() => {
    if (tip) tip.textContent = message;
  });

  const timer = window.setTimeout(() => {
    button.removeAttribute('data-copied');
    button.removeAttribute('data-failed');
    if (tip) tip.textContent = '';
    feedbackTimers.delete(button);
  }, 2000);
  feedbackTimers.set(button, timer);
}

async function copyTargetText(button: HTMLElement, target: HTMLElement): Promise<void> {
  const raw = target.matches('input, textarea')
    ? (target as HTMLInputElement | HTMLTextAreaElement).value
    : (target.innerText ?? target.textContent ?? '');
  const text = raw.trim();
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    reportCopyResult(button, true);
  } catch {
    reportCopyResult(button, false);
  }
}

function ensureCopyHandlersInstalled(): void {
  if (handlersInstalled || typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }
  handlersInstalled = true;

  // Register only one path (Invoker Commands where supported, delegated click fallback otherwise)
  // so a click never copies twice.
  if ('CommandEvent' in window) {
    document.addEventListener(
      'command',
      (event: Event) => {
        const cmdEvent = event as CommandLikeEvent;
        if (
          typeof cmdEvent.command === 'string' &&
          cmdEvent.command.startsWith('--copy') &&
          cmdEvent.source instanceof HTMLElement &&
          cmdEvent.target instanceof HTMLElement
        ) {
          void copyTargetText(cmdEvent.source, cmdEvent.target);
        }
      },
      true,
    );
  } else {
    document.addEventListener('click', (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const origin = event.target instanceof Element ? event.target : null;
      const button = origin?.closest<HTMLButtonElement>('button[command^="--copy"]');
      if (!button) return;
      const targetId = button.getAttribute('commandfor');
      const target = targetId ? document.getElementById(targetId) : null;
      if (target) {
        void copyTargetText(button, target);
      }
    });
  }
}

/**
 * Copy button using Invoker Commands (`command="--copy"` + `commandfor`) with progressive fallback,
 * Async Clipboard API, and an external `role="status"` live region hidden only via opacity.
 */
export function CopyButton({ targetId, label }: CopyButtonProps) {
  useEffect(() => {
    ensureCopyHandlersInstalled();
  }, []);

  const invokerProps = {
    command: '--copy',
    commandfor: targetId,
  } as Record<string, string>;

  return (
    <span className="copy-control">
      <button
        type="button"
        className="btn btn-sm btn-ghost copy-button"
        aria-label={label}
        title={label}
        {...invokerProps}
      >
        <Copy size={13} className="copy-icon-default" aria-hidden="true" />
        <Check size={13} className="copy-icon-done" aria-hidden="true" />
      </button>
      <span className="copy-tip" role="status" />
    </span>
  );
}

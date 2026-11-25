import { useEffect, type RefObject } from 'react';

/**
 * Synchronizes programmatic aria-invalid and aria-describedby with visual :user-invalid state:
 *
 * - Initializes every field to aria-invalid="false" so Safari/Firefox do not flag untouched required fields.
 * - Appends data-error id to aria-describedby only while invalid, removing it once fixed.
 * - Adds .user-invalid-fallback where :user-invalid is unsupported.
 */
export function useAccessibleValidation(formRef: RefObject<HTMLFormElement | null>): void {
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;

    const supportsUserInvalid =
      typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('selector(:user-invalid)');
    const interacted = new WeakSet<Element>();

    const linkError = (el: HTMLElement, shown: boolean) => {
      const errorId = el.dataset.error;
      if (!errorId) return;
      const ids = (el.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((id) => id && id !== errorId);
      if (shown) ids.push(errorId);
      if (ids.length > 0) {
        el.setAttribute('aria-describedby', ids.join(' '));
      } else {
        el.removeAttribute('aria-describedby');
      }
    };

    const syncField = (target: EventTarget | null, force = false) => {
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
        return;
      }
      if (force) interacted.add(target);

      const isInvalid = supportsUserInvalid
        ? target.matches(':user-invalid')
        : interacted.has(target) && !target.validity.valid;

      if (!supportsUserInvalid && interacted.has(target)) {
        target.classList.toggle('user-invalid-fallback', isInvalid);
      }

      target.setAttribute('aria-invalid', isInvalid ? 'true' : 'false');
      linkError(target, isInvalid);
    };

    form.querySelectorAll('input, select, textarea').forEach((el) => {
      if (!el.hasAttribute('aria-invalid')) {
        el.setAttribute('aria-invalid', 'false');
      }
    });

    const onBlur = (e: Event) => syncField(e.target, true);
    const onInput = (e: Event) => syncField(e.target, false);
    const onChange = (e: Event) => syncField(e.target, true);
    const onInvalid = (e: Event) => syncField(e.target, true);
    const onReset = () => {
      window.setTimeout(() => {
        form.querySelectorAll<HTMLElement>('input, select, textarea').forEach((el) => {
          el.classList.remove('user-invalid-fallback');
          el.setAttribute('aria-invalid', 'false');
          linkError(el, false);
        });
      });
    };

    form.addEventListener('blur', onBlur, true);
    form.addEventListener('input', onInput);
    form.addEventListener('change', onChange, true);
    form.addEventListener('invalid', onInvalid, true);
    form.addEventListener('reset', onReset);

    return () => {
      form.removeEventListener('blur', onBlur, true);
      form.removeEventListener('input', onInput);
      form.removeEventListener('change', onChange, true);
      form.removeEventListener('invalid', onInvalid, true);
      form.removeEventListener('reset', onReset);
    };
  }, [formRef]);
}

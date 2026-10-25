const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Svelte action for the `.modal-dialog` box inside a `.modal-overlay`.
 *
 * Moves focus into the dialog (unless an element inside already took it via
 * autofocus), keeps Tab inside it and gives focus back to the element that
 * opened it when it closes. With focus inside, the overlay's own `Escape`
 * handler receives the key. Also marks the box as a modal dialog for screen
 * readers.
 */
export function modalDialog(node: HTMLElement) {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
  const heading = node.querySelector('h1, h2, h3, h4');
  if (heading && !node.hasAttribute('aria-labelledby') && !node.hasAttribute('aria-label')) {
    heading.id ||= `dialog-title-${Math.random().toString(36).slice(2, 10)}`;
    node.setAttribute('aria-labelledby', heading.id);
  }

  if (!node.contains(document.activeElement)) node.focus({ preventScroll: true });

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  node.addEventListener('keydown', onKeydown);

  return {
    destroy() {
      node.removeEventListener('keydown', onKeydown);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    }
  };
}

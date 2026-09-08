let previousFocus: HTMLElement | null = null;
const focusable =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]';

export function openModal(modalId: string) {
  const modal = document.getElementById(modalId);
  if (!modal || document.body.dataset.view !== 'workspace') return;
  previousFocus = document.activeElement as HTMLElement;
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  modal.querySelector<HTMLElement>('input, button')?.focus();
}
export function closeModal(modalId: string) {
  const modal = document.getElementById(modalId);
  if (!modal?.classList.contains('active')) return;
  modal.classList.remove('active');
  document.body.style.overflow = '';
  previousFocus?.focus();
  previousFocus = null;
}
export function closeAllModals() {
  document.querySelectorAll('.modal-backdrop.active').forEach((modal) => closeModal(modal.id));
}
export function initModalManager() {
  document.querySelectorAll<HTMLElement>('.modal-backdrop').forEach((modal) => {
    const dialog = modal.querySelector<HTMLElement>('.modal-dialog')!;
    const title = dialog.querySelector('h3')!;
    title.id = `${modal.id}-title`;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', title.id);
    modal.querySelector('[data-close-modal]')?.setAttribute('aria-label', 'Close dialog');
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal(modal.id);
    });
    modal
      .querySelector('[data-close-modal]')
      ?.addEventListener('click', () => closeModal(modal.id));
  });
  document
    .querySelectorAll<HTMLElement>('[data-open-modal]')
    .forEach((trigger) =>
      trigger.addEventListener('click', () => openModal(trigger.dataset.openModal!)),
    );
  window.addEventListener('keydown', (event) => {
    const modal = document.querySelector<HTMLElement>('.modal-backdrop.active');
    if (!modal) return;
    if (event.key === 'Escape') closeModal(modal.id);
    if (event.key === 'Tab') {
      const elements = Array.from(modal.querySelectorAll<HTMLElement>(focusable)).filter(
        (el) => el.getClientRects().length,
      );
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
}

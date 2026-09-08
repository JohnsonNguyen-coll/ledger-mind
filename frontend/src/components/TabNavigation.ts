import { navigateTo } from './Router.js';

const tabRouteMap: Record<string, string> = {
  'tab-overview': '/overview',
  'tab-assets': '/assets',
  'tab-risk-audit': '/risk-audit',
  'tab-copilot': '/copilot',
  'tab-premium': '/premium',
};

export function switchTab(tabId: string) {
  const flow = document.querySelector<HTMLElement>('.cashflow-panel');
  if (flow) flow.hidden = tabId !== 'tab-overview';
  // Update Tab buttons active state
  document.querySelectorAll('[data-tab-target]').forEach((tabBtn) => {
    if ((tabBtn as HTMLElement).dataset.tabTarget === tabId) {
      tabBtn.classList.add('active');
      tabBtn.setAttribute('aria-current', 'page');
    } else {
      tabBtn.classList.remove('active');
      tabBtn.removeAttribute('aria-current');
    }
  });

  // Update Tab content visibility
  document.querySelectorAll('.tab-content').forEach((content) => {
    if (content.id === tabId) {
      (content as HTMLElement).hidden = false;
    } else {
      (content as HTMLElement).hidden = true;
    }
  });
}

export function initTabNavigation() {
  document.querySelectorAll('[data-tab-target]').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      const targetId = (tabBtn as HTMLElement).dataset.tabTarget;
      if (targetId && tabRouteMap[targetId]) {
        navigateTo(tabRouteMap[targetId]);
      }
    });
  });
}

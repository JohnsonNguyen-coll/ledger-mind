import { navigateTo } from './Router.js';

const tabRouteMap: Record<string, string> = {
  'tab-overview': '/overview',
  'tab-assets': '/assets',
  'tab-risk-audit': '/risk-audit',
  'tab-copilot': '/copilot',
};

export function switchTab(tabId: string) {
  // Update Tab buttons active state
  document.querySelectorAll('[data-tab-target]').forEach((tabBtn) => {
    if ((tabBtn as HTMLElement).dataset.tabTarget === tabId) {
      tabBtn.classList.add('active');
    } else {
      tabBtn.classList.remove('active');
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

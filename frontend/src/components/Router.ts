import { showLandingPage, showWorkspace, showView } from './LandingPage.js';
import { switchTab } from './TabNavigation.js';
import { openModal, closeAllModals } from './ModalManager.js';

export function handleRoute(path: string, pushState = true) {
  const normalizedPath = path.toLowerCase().replace(/\/$/, '') || '/';

  if (pushState && window.location.pathname !== normalizedPath) {
    window.history.pushState({}, '', normalizedPath);
  }

  closeAllModals();
  document.title = normalizedPath === '/docs' ? 'Documentation · LedgerMind' : normalizedPath === '/' ? 'LedgerMind · Treasury intelligence, clearly.' : 'Dashboard · LedgerMind';
  switch (normalizedPath) {
    case '/':
      showLandingPage();
      break;
    case '/docs':
      showView('docs');
      break;
    case '/dashboard':
    case '/overview':
      showWorkspace();
      switchTab('tab-overview');
      break;
    case '/assets':
      showWorkspace();
      switchTab('tab-assets');
      break;
    case '/risk-audit':
      showWorkspace();
      switchTab('tab-risk-audit');
      break;
    case '/copilot':
      showWorkspace();
      switchTab('tab-copilot');
      break;
    default:
      showLandingPage();
      break;
  }
}

export function navigateTo(path: string) {
  handleRoute(path, true);
  window.scrollTo(0, 0);
}

export function initRouter() {
  // Listen for browser Back (←) and Forward (→) buttons
  window.addEventListener('popstate', () => {
    handleRoute(window.location.pathname, false);
  });

  // Global Event Delegation for all route and action clicks
  document.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const routeTarget = (event.target as HTMLElement).closest<HTMLElement>('[data-route]');
    if (routeTarget) {
      event.preventDefault();
      const route = routeTarget.dataset.route;
      if (route) {
        navigateTo(route);
        return;
      }
    }

    const actionTarget = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (actionTarget) {
      const action = actionTarget.dataset.action;
      if (action === 'launch-app') {
        event.preventDefault();
        navigateTo('/dashboard');
      } else if (action === 'go-home') {
        event.preventDefault();
        navigateTo('/');
      } else if (action === 'quick-analyze') {
        event.preventDefault();
        navigateTo('/dashboard');
        openModal('analysis-modal');
      }
    }
  });

  // Initial routing on page load
  handleRoute(window.location.pathname, false);
}

export function showView(view: 'landing' | 'workspace' | 'docs') {
  for (const [name, id] of Object.entries({
    landing: 'landing-page',
    workspace: 'app-workspace',
    docs: 'docs-page',
  }))
    document.getElementById(id)!.hidden = name !== view;
  document.body.dataset.view = view;
  const launch = document.querySelector<HTMLElement>('[data-nav="workspace"]');
  if (launch)
    launch.innerHTML =
      view === 'workspace'
        ? 'Dashboard <span aria-hidden="true">↗</span>'
        : 'Launch app <span aria-hidden="true">↗</span>';
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach((link) => {
    if (link.dataset.nav === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
export function showWorkspace() {
  showView('workspace');
}
export function showLandingPage() {
  showView('landing');
}

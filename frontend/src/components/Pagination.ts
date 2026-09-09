export function createPagination(label: string, onPage: (page: number) => void) {
  const nav = document.createElement('nav');
  nav.className = 'pagination';
  nav.setAttribute('aria-label', `${label} pagination`);
  const previous = document.createElement('button');
  const next = document.createElement('button');
  const status = document.createElement('span');
  previous.type = next.type = 'button';
  previous.textContent = 'Previous';
  next.textContent = 'Next';
  status.setAttribute('aria-live', 'polite');
  let page = 1;
  let pages = 1;
  previous.onclick = () => onPage(Math.max(1, page - 1));
  next.onclick = () => onPage(Math.min(pages, page + 1));
  nav.append(previous, status, next);
  return {
    nav,
    update(current: number, total: number, size: number) {
      pages = Math.max(1, Math.ceil(total / size));
      page = Math.min(pages, Math.max(1, current));
      nav.hidden = total <= size;
      previous.disabled = page === 1;
      next.disabled = page === pages;
      status.textContent = `${(page - 1) * size + 1}–${Math.min(page * size, total)} of ${total} · Page ${page} / ${pages}`;
    },
  };
}

// Observe only direct children: paging never mutates the underlying report data.
export function paginateChildren(id: string, selector: string, size = 10, latest = false) {
  const host = document.getElementById(id);
  if (!host) return;
  let page = 1;
  const rows = () => Array.from(host.children).filter((row): row is HTMLElement => row instanceof HTMLElement && row.matches(selector));
  const pager = createPagination(id.replaceAll('-', ' '), (value) => { page = value; render(); });
  const anchor = host.closest('.table-wrap') || host;
  anchor.after(pager.nav);
  function render() {
    const items = rows();
    page = Math.max(1, Math.min(page, Math.ceil(items.length / size)));
    items.forEach((item, index) => { item.hidden = index < (page - 1) * size || index >= page * size; });
    pager.update(page, items.length, size);
  }
  new MutationObserver(() => {
    page = latest ? Math.max(1, Math.ceil(rows().length / size)) : 1;
    render();
  }).observe(host, { childList: true });
  render();
}

export function initPagination() {
  paginateChildren('transactions', 'tr:not(:has(.empty-cell))');
  paginateChildren('allocation-bars', '.asset-row', 8);
  paginateChildren('cashflow-chart', '.flow-row', 10);
  paginateChildren('risks', '.risk-item', 5);
  paginateChildren('audit-list', '.audit-row', 10);
  paginateChildren('sources', '.source-item', 6);
  paginateChildren('chat-log', '.chat-user, .chat-answer', 10, true);
}

export class PagesPanel {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('pages-panel');
  }

  render(state) {
    const activePageId = state.project.activePageId;
    const pages = Object.values(state.pages);

    this.container.innerHTML = '';
    for (const page of pages) {
      const item = document.createElement('div');
      item.className = 'page-item' + (page.id === activePageId ? ' active' : '');

      const indicator = document.createElement('span');
      indicator.className = 'page-item-indicator';

      const name = document.createElement('span');
      name.className = 'page-item-name';
      name.textContent = page.name;

      item.appendChild(indicator);
      item.appendChild(name);

      item.addEventListener('click', () => {
        this.app.ws.send('page:select', { pageId: page.id });
      });

      this.container.appendChild(item);
    }
  }
}

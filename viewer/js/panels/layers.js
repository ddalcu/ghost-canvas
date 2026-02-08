export class LayersPanel {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('layers-panel');
    this.expandedIds = new Set();
  }

  expandToElement(elementId, state) {
    if (!elementId || !state) return;
    let el = state.elements[elementId];
    if (!el) return;
    // Walk up the parent chain, expanding each ancestor
    while (el.parentId) {
      this.expandedIds.add(el.parentId);
      el = state.elements[el.parentId];
      if (!el) break;
    }
  }

  render(state) {
    const activePageId = state.project.activePageId;
    const page = state.pages[activePageId];
    if (!page) {
      this.container.innerHTML = '';
      return;
    }

    const root = state.elements[page.rootId];
    if (!root) {
      this.container.innerHTML = '';
      return;
    }

    this.container.innerHTML = '';
    this.renderNode(root, state.elements, 0);
  }

  renderNode(element, elements, depth) {
    const item = document.createElement('div');
    item.className = 'layer-item';
    if (element.id === this.app.selectedElementId) {
      item.classList.add('selected');
    }

    const hasChildren = element.children && element.children.length > 0;
    const isExpanded = this.expandedIds.has(element.id);
    const indent = 8 + depth * 16;

    item.style.paddingLeft = indent + 'px';

    // Toggle
    const toggle = document.createElement('span');
    toggle.className = 'layer-toggle';
    if (hasChildren) {
      toggle.textContent = isExpanded ? '\u25BC' : '\u25B6';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.expandedIds.has(element.id)) {
          this.expandedIds.delete(element.id);
        } else {
          this.expandedIds.add(element.id);
        }
        this.render(this.app.state);
      });
    } else {
      toggle.textContent = ' ';
    }

    // Tag
    const tag = document.createElement('span');
    tag.className = 'layer-tag';
    tag.textContent = element.tag;

    item.appendChild(toggle);
    item.appendChild(tag);

    // Classes
    if (element.classes.length > 0) {
      const cls = document.createElement('span');
      cls.className = 'layer-class';
      cls.textContent = '.' + element.classes[0];
      item.appendChild(cls);
    }

    // Text preview
    if (element.textContent) {
      const text = document.createElement('span');
      text.className = 'layer-text';
      const preview = element.textContent.length > 20
        ? element.textContent.substring(0, 20) + '...'
        : element.textContent;
      text.textContent = `"${preview}"`;
      item.appendChild(text);
    }

    item.addEventListener('click', () => {
      this.app.canvas.selectElement(element.id);
    });

    this.container.appendChild(item);

    // Render children if expanded
    if (hasChildren && isExpanded) {
      for (const childId of element.children) {
        const child = elements[childId];
        if (child) {
          this.renderNode(child, elements, depth + 1);
        }
      }
    }
  }
}

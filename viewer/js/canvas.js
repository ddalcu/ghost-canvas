export class Canvas {
  constructor(app) {
    this.app = app;
    this.wrapper = document.getElementById('canvas-wrapper');
    this.iframe = document.getElementById('canvas-iframe');
    this.selectedId = null;
    this.hoveredId = null;
  }

  init() {
    window.addEventListener('resize', () => this.fitToArea());
  }

  render(state) {
    // Render HTML into iframe
    const html = this.buildHtml(state);
    const doc = this.iframe.contentDocument;
    doc.open();
    doc.write(html);
    doc.close();

    // Re-bind click handler after document rewrite
    this.setupIframeInteraction();

    // Re-apply selection highlight if an element was selected
    if (this.selectedId) {
      const el = doc.querySelector(`[data-ofid="${this.selectedId}"]`);
      if (el) el.classList.add('ofig-selected');
    }
  }

  buildHtml(state) {
    const pageId = state.project.activePageId;
    const page = state.pages[pageId];
    if (!page) return '<html><body></body></html>';

    const rootElement = state.elements[page.rootId];
    if (!rootElement) return '<html><body></body></html>';

    const body = this.renderElement(rootElement, state.elements);
    const css = this.renderStyles(state.styles);

    return `<!DOCTYPE html>
<html>
<head>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
[data-ofid] { cursor: default; }
[data-ofid]:hover { outline: 1px dashed rgba(137, 180, 250, 0.5); outline-offset: 1px; }
.ofig-selected { outline: 2px solid #89b4fa !important; outline-offset: 1px; }
.ofig-drop-target { outline: 2px dashed #89b4fa !important; outline-offset: 2px; background-color: rgba(137, 180, 250, 0.08); }
${css}
</style>
</head>
<body>${body}</body>
</html>`;
  }

  renderElement(element, elements) {
    const voidElements = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
    const attrs = [];

    if (element.classes.length > 0) {
      attrs.push(`class="${this.escapeAttr(element.classes.join(' '))}"`);
    }
    attrs.push(`data-ofid="${element.id}"`);

    for (const [key, value] of Object.entries(element.attributes || {})) {
      attrs.push(`${this.escapeAttr(key)}="${this.escapeAttr(value)}"`);
    }

    const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
    const tag = element.tag;

    if (voidElements.has(tag)) {
      return `<${tag}${attrStr}>`;
    }

    let inner = '';
    if (element.textContent) {
      inner += this.escapeHtml(element.textContent);
    }
    for (const childId of (element.children || [])) {
      const child = elements[childId];
      if (child) {
        inner += this.renderElement(child, elements);
      }
    }

    return `<${tag}${attrStr}>${inner}</${tag}>`;
  }

  renderStyles(styles) {
    const rules = [];
    const mediaGroups = {};

    for (const [selector, properties] of Object.entries(styles || {})) {
      const props = Object.entries(properties)
        .map(([prop, val]) => `${prop}: ${val};`)
        .join(' ');

      const mediaMatch = selector.match(/^(@media\s*\([^)]+\))\s+(.+)$/);
      if (mediaMatch) {
        const [, query, innerSelector] = mediaMatch;
        if (!mediaGroups[query]) mediaGroups[query] = [];
        mediaGroups[query].push(`  ${innerSelector} { ${props} }`);
      } else {
        rules.push(`${selector} { ${props} }`);
      }
    }

    for (const [query, innerRules] of Object.entries(mediaGroups)) {
      rules.push(`${query} {\n${innerRules.join('\n')}\n}`);
    }

    return rules.join('\n');
  }

  escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  setupIframeInteraction() {
    const doc = this.iframe.contentDocument;
    if (!doc) return;

    doc.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.target.closest('[data-ofid]');
      if (target) {
        const id = target.getAttribute('data-ofid');
        this.selectElement(id);
      }
    });

    // Asset drag-and-drop onto elements
    doc.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const target = e.target.closest('[data-ofid]');
      // Clear previous drop target highlights
      const prev = doc.querySelector('.ofig-drop-target');
      if (prev) prev.classList.remove('ofig-drop-target');
      if (target) {
        target.classList.add('ofig-drop-target');
      }
    });

    doc.addEventListener('dragleave', (e) => {
      const target = e.target.closest('[data-ofid]');
      if (target) target.classList.remove('ofig-drop-target');
    });

    doc.addEventListener('drop', (e) => {
      e.preventDefault();
      // Clear all drop target highlights
      const highlighted = doc.querySelector('.ofig-drop-target');
      if (highlighted) highlighted.classList.remove('ofig-drop-target');

      const assetData = e.dataTransfer.getData('application/x-ghostcanvas-asset');
      if (!assetData) return;

      const target = e.target.closest('[data-ofid]');
      if (!target) return;

      const elementId = target.getAttribute('data-ofid');
      const asset = JSON.parse(assetData);

      this.app.ws.send('asset:apply', {
        elementId,
        filename: asset.filename,
        url: asset.url,
      });
    });
  }

  selectElement(id) {
    // Clear previous selection in iframe
    const doc = this.iframe.contentDocument;
    if (doc) {
      const prev = doc.querySelector('.ofig-selected');
      if (prev) prev.classList.remove('ofig-selected');

      if (id) {
        const el = doc.querySelector(`[data-ofid="${id}"]`);
        if (el) el.classList.add('ofig-selected');
      }
    }

    this.selectedId = id;
    this.app.onElementSelected(id);
  }

  setViewport(width, height) {
    this.wrapper.style.width = width + 'px';
    this.wrapper.style.height = height + 'px';
    this.fitToArea();
  }

  fitToArea() {
    const area = this.wrapper.parentElement;
    if (!area) return;

    const padding = 32;
    const areaW = area.clientWidth - padding * 2;
    const areaH = area.clientHeight - padding * 2;
    const wrapperW = parseInt(this.wrapper.style.width) || 1440;
    const wrapperH = parseInt(this.wrapper.style.height) || 900;

    const scale = Math.min(1, areaW / wrapperW, areaH / wrapperH);
    this.wrapper.style.transform = scale < 1 ? `scale(${scale})` : '';
  }
}

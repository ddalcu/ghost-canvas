import { WsClient } from './ws.js';
import { Canvas } from './canvas.js';
import { PagesPanel } from './panels/pages.js';
import { LayersPanel } from './panels/layers.js';
import { InspectorPanel } from './panels/inspector.js';
import { HistoryPanel } from './panels/history.js';
import { DevicesPanel } from './panels/devices.js';
import { ActivityPanel } from './panels/activity.js';
import { ProjectsPanel } from './panels/projects.js';
import { AssetsPanel } from './panels/assets.js';
import { TokensPanel } from './panels/tokens.js';

class App {
  constructor() {
    this.state = null;
    this.selectedElementId = null;
    this.ws = new WsClient();
    this.canvas = new Canvas(this);
    this.pages = new PagesPanel(this);
    this.layers = new LayersPanel(this);
    this.inspector = new InspectorPanel(this);
    this.history = new HistoryPanel(this);
    this.devices = new DevicesPanel(this);
    this.activity = new ActivityPanel(this);
    this.projects = new ProjectsPanel(this);
    this.assetsPanel = new AssetsPanel(this);
    this.tokensPanel = new TokensPanel(this);
    this.viewportInfo = document.getElementById('viewport-info');
    this.activityIndicator = document.getElementById('activity-indicator');
    this._renderScheduled = false;
    this._activeToolCount = 0;
    this._graceTimeout = null;
    this._failsafeTimeout = null;
  }

  init() {
    this.canvas.init();
    this.devices.init();
    this.setupWsHandlers();
    this.setupPreviewButton();
    this.setupExportButton();
    this.ws.connect();
  }

  setupPreviewButton() {
    const btn = document.getElementById('preview-btn');
    btn.addEventListener('click', () => {
      const pageId = this.state?.project?.activePageId || '';
      window.open(`/api/render?pageId=${encodeURIComponent(pageId)}`, '_blank');
    });
  }

  setupExportButton() {
    const btn = document.getElementById('export-zip-btn');
    btn.addEventListener('click', () => {
      const pageId = this.state?.project?.activePageId || '';
      const link = document.createElement('a');
      link.href = `/api/export/zip?pageId=${encodeURIComponent(pageId)}`;
      link.click();
    });
  }

  setupWsHandlers() {
    // Full state (initial connection + checkout)
    this.ws.on('design:full', (state) => {
      this.state = state;
      this.renderAll();
      this.assetsPanel.fetchAssets();
    });

    // Legacy support: treat design:updated same as design:full
    this.ws.on('design:updated', (state) => {
      this.state = state;
      this.renderAll();
    });

    // --- Element deltas ---
    this.ws.on('delta:element:created', (data) => {
      if (!this.state) return;
      this.state.elements[data.element.id] = data.element;
      const parent = this.state.elements[data.parentId];
      if (parent) {
        if (data.insertIndex !== undefined && data.insertIndex !== null) {
          parent.children.splice(data.insertIndex, 0, data.element.id);
        } else {
          parent.children.push(data.element.id);
        }
      }
      this.scheduleRender();
    });

    this.ws.on('delta:element:updated', (data) => {
      if (!this.state) return;
      const el = this.state.elements[data.id];
      if (el) {
        Object.assign(el, data.changes);
      }
      this.scheduleRender();
    });

    this.ws.on('delta:element:deleted', (data) => {
      if (!this.state) return;
      this._deleteElementRecursive(data.id);
      const parent = this.state.elements[data.parentId];
      if (parent) {
        parent.children = parent.children.filter(cid => cid !== data.id);
      }
      if (this.selectedElementId === data.id) {
        this.selectedElementId = null;
      }
      this.scheduleRender();
    });

    this.ws.on('delta:element:moved', (data) => {
      if (!this.state) return;
      const el = this.state.elements[data.id];
      if (!el) return;

      // Remove from old parent
      const oldParent = this.state.elements[data.oldParentId];
      if (oldParent) {
        oldParent.children = oldParent.children.filter(cid => cid !== data.id);
      }

      // Add to new parent
      el.parentId = data.newParentId;
      const newParent = this.state.elements[data.newParentId];
      if (newParent) {
        if (data.insertIndex !== undefined && data.insertIndex !== null) {
          newParent.children.splice(data.insertIndex, 0, data.id);
        } else {
          newParent.children.push(data.id);
        }
        // Update pageId if page changed
        if (el.pageId !== newParent.pageId) {
          this._updateElementPageId(data.id, newParent.pageId);
        }
      }
      this.scheduleRender();
    });

    // --- Page deltas ---
    this.ws.on('delta:page:created', (data) => {
      if (!this.state) return;
      this.state.pages[data.page.id] = data.page;
      this.state.elements[data.rootElement.id] = data.rootElement;
      this.scheduleRender();
    });

    this.ws.on('delta:page:deleted', (data) => {
      if (!this.state) return;
      // Remove page elements
      for (const [id, el] of Object.entries(this.state.elements)) {
        if (el.pageId === data.pageId) {
          delete this.state.elements[id];
        }
      }
      delete this.state.pages[data.pageId];
      if (data.newActivePageId) {
        this.state.project.activePageId = data.newActivePageId;
      }
      this.scheduleRender();
    });

    this.ws.on('delta:page:renamed', (data) => {
      if (!this.state) return;
      const page = this.state.pages[data.pageId];
      if (page) page.name = data.name;
      this.scheduleRender();
    });

    this.ws.on('delta:page:activated', (data) => {
      if (!this.state) return;
      this.state.project.activePageId = data.pageId;
      this.scheduleRender();
    });

    // --- Style deltas ---
    this.ws.on('delta:styles:set', (data) => {
      if (!this.state) return;
      this.state.styles[data.selector] = data.properties;
      this.scheduleRender();
    });

    this.ws.on('delta:styles:batch', (data) => {
      if (!this.state) return;
      Object.assign(this.state.styles, data.styles);
      this.scheduleRender();
    });

    this.ws.on('delta:styles:deleted', (data) => {
      if (!this.state) return;
      delete this.state.styles[data.selector];
      this.scheduleRender();
    });

    // --- Token deltas ---
    this.ws.on('delta:tokens:set', (data) => {
      if (!this.state) return;
      this.state.designTokens[data.category] = data.tokens;
      // Re-render token editors (both have focus guards)
      this.tokensPanel.render(this.state);
      if (this.selectedElementId) {
        this.inspector.render(this.selectedElementId, this.state);
      }
    });

    // --- Viewport deltas ---
    this.ws.on('delta:viewport:set', (data) => {
      if (!this.state) return;
      this.state.project.viewport = data.viewport;
      this.canvas.setViewport(data.viewport.width, data.viewport.height);
      this.devices.update(data.viewport);
      this.updateViewportInfo(data.viewport.device, data.viewport.width, data.viewport.height);
    });

    // --- Project deltas ---
    this.ws.on('projects:updated', (data) => {
      this.projects.render(data.projects);
    });

    // --- Other events ---
    this.ws.on('history:updated', (data) => {
      this.history.render(data.commits);
    });

    // Activity indicator driven by tool start/stop lifecycle
    this.ws.on('activity:start', () => {
      this._activeToolCount++;
      this._showActivity();
    });

    this.ws.on('activity:stop', () => {
      this._activeToolCount = Math.max(0, this._activeToolCount - 1);
      if (this._activeToolCount === 0) {
        this._scheduleActivityHide();
      }
    });

    // Activity feed panel (separate from indicator)
    this.ws.on('activity:log', (data) => {
      this.activity.addEntry(data);
    });

    // Asset updates
    this.ws.on('assets:updated', () => {
      this.assetsPanel.fetchAssets();
    });

    // Screenshot capture
    this.ws.on('screenshot:request', (data) => {
      this.handleScreenshotRequest(data);
    });
  }

  // Coalesce rapid deltas into a single rAF render
  scheduleRender() {
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    requestAnimationFrame(() => {
      this._renderScheduled = false;
      this.renderActivePage();
    });
  }

  // Lightweight render for delta updates — re-renders canvas + panels
  renderActivePage() {
    if (!this.state) return;
    this.canvas.render(this.state);
    this.pages.render(this.state);
    this.layers.render(this.state);
    this.inspector.render(this.selectedElementId, this.state);
  }

  // Full render including viewport info
  renderAll() {
    if (!this.state) return;

    const { viewport } = this.state.project;
    this.canvas.setViewport(viewport.width, viewport.height);
    this.canvas.render(this.state);
    this.pages.render(this.state);
    this.layers.render(this.state);
    this.inspector.render(this.selectedElementId, this.state);
    this.tokensPanel.render(this.state);

    this.devices.update(viewport);
    this.updateViewportInfo(viewport.device, viewport.width, viewport.height);
  }

  onElementSelected(elementId) {
    this.selectedElementId = elementId;
    this.inspector.render(elementId, this.state);

    if (this.state) {
      this.layers.expandToElement(elementId, this.state);
      this.layers.render(this.state);
    }

    this.ws.send('element:selected', { elementId: elementId || null });
  }

  // --- Activity indicator lifecycle ---

  _showActivity() {
    clearTimeout(this._graceTimeout);
    this._graceTimeout = null;

    if (!this.activityIndicator.classList.contains('active')) {
      this.activityIndicator.classList.add('active');
    }

    // Failsafe: force-hide after 60s in case a stop event is lost
    clearTimeout(this._failsafeTimeout);
    this._failsafeTimeout = setTimeout(() => this._hideActivity(), 60_000);
  }

  _scheduleActivityHide() {
    clearTimeout(this._graceTimeout);
    // Grace period bridges LLM thinking gaps between tool calls
    this._graceTimeout = setTimeout(() => this._hideActivity(), 5_000);
  }

  _hideActivity() {
    this._activeToolCount = 0;
    clearTimeout(this._graceTimeout);
    clearTimeout(this._failsafeTimeout);
    this._graceTimeout = null;
    this._failsafeTimeout = null;
    this.activityIndicator.classList.remove('active');
  }

  updateViewportInfo(device, width, height) {
    this.viewportInfo.textContent = `${device} ${width}\u00D7${height}`;
  }

  async handleScreenshotRequest(data) {
    const { requestId, pageId, device } = data;

    try {
      // If a specific page was requested, switch to it first
      if (pageId && this.state && this.state.project.activePageId !== pageId) {
        this.ws.send('page:select', { pageId });
        // Wait for render to settle
        await new Promise(r => setTimeout(r, 200));
      }

      // If a device override was requested, temporarily resize
      const devicePresets = {
        mobile: { width: 375, height: 812 },
        tablet: { width: 768, height: 1024 },
        desktop: { width: 1440, height: 900 },
      };
      const originalWidth = this.canvas.wrapper.style.width;
      const originalHeight = this.canvas.wrapper.style.height;
      let resized = false;

      if (device && devicePresets[device]) {
        const preset = devicePresets[device];
        this.canvas.wrapper.style.width = preset.width + 'px';
        this.canvas.wrapper.style.height = preset.height + 'px';
        resized = true;
        // Wait a frame for layout
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      }

      // Capture the iframe body using html2canvas
      const doc = this.canvas.iframe.contentDocument;
      if (!doc || !doc.body) {
        throw new Error('Iframe document not available');
      }

      const canvas = await html2canvas(doc.body, {
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: parseInt(this.canvas.wrapper.style.width),
        height: parseInt(this.canvas.wrapper.style.height),
      });

      // Restore original size if we changed it
      if (resized) {
        this.canvas.wrapper.style.width = originalWidth;
        this.canvas.wrapper.style.height = originalHeight;
      }

      // Convert to base64 PNG (strip the data:image/png;base64, prefix)
      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

      this.ws.send('screenshot:response', {
        requestId,
        success: true,
        image: base64,
      });
    } catch (err) {
      this.ws.send('screenshot:response', {
        requestId,
        success: false,
        error: err.message,
      });
    }
  }

  // --- Helpers for local state mutation ---

  _deleteElementRecursive(id) {
    const el = this.state.elements[id];
    if (!el) return;
    for (const childId of [...(el.children || [])]) {
      this._deleteElementRecursive(childId);
    }
    delete this.state.elements[id];
  }

  _updateElementPageId(id, pageId) {
    const el = this.state.elements[id];
    if (!el) return;
    el.pageId = pageId;
    for (const childId of (el.children || [])) {
      this._updateElementPageId(childId, pageId);
    }
  }
}

const app = new App();
app.init();

import { readFile, writeFile, mkdir, readdir, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import { DesignStateSchema, createDefaultState } from './schema.js';

function decodeUnicodeEscapes(str) {
  if (!str || !str.includes('\\u')) return str;
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

export class StateManager extends EventEmitter {
  constructor(designsDir) {
    super();
    this.designsDir = designsDir;
    this.projectPath = join(designsDir, 'project.json');
    this.stylesPath = join(designsDir, 'styles.json');
    this.pagesDir = join(designsDir, 'pages');
    this.legacyPath = join(designsDir, 'design.json');
    this.state = null;
    this.dirty = { project: false, styles: false, pages: new Set(), deletedPages: new Set() };
  }

  pageFilePath(pageId) {
    return join(this.pagesDir, `${pageId}.json`);
  }

  async init() {
    if (!existsSync(this.designsDir)) {
      await mkdir(this.designsDir, { recursive: true });
    }

    // Legacy migration: design.json -> split files
    if (existsSync(this.legacyPath)) {
      const raw = await readFile(this.legacyPath, 'utf-8');
      this.state = DesignStateSchema.parse(JSON.parse(raw));
      await this._writeSplitFiles();
      await unlink(this.legacyPath);
      return;
    }

    // Load from split files
    if (existsSync(this.projectPath)) {
      await this._loadSplitFiles();
    } else {
      this.state = createDefaultState();
      await this._writeSplitFiles();
    }
  }

  async _writeSplitFiles() {
    if (!existsSync(this.pagesDir)) {
      await mkdir(this.pagesDir, { recursive: true });
    }

    const { project, pages, elements, styles, designTokens } = this.state;

    // project.json holds project metadata + designTokens
    const projectData = { ...project, designTokens };

    // styles.json
    const stylesData = styles;

    // Per-page files: page metadata + its elements
    const pageWrites = [];
    for (const [pageId, page] of Object.entries(pages)) {
      const pageElements = {};
      for (const [elId, el] of Object.entries(elements)) {
        if (el.pageId === pageId) {
          pageElements[elId] = el;
        }
      }
      const pageData = { ...page, elements: pageElements };
      pageWrites.push(writeFile(this.pageFilePath(pageId), JSON.stringify(pageData, null, 2), 'utf-8'));
    }

    await Promise.all([
      writeFile(this.projectPath, JSON.stringify(projectData, null, 2), 'utf-8'),
      writeFile(this.stylesPath, JSON.stringify(stylesData, null, 2), 'utf-8'),
      ...pageWrites,
    ]);

    this._clearDirty();
  }

  async _loadSplitFiles() {
    const [projectRaw, stylesRaw] = await Promise.all([
      readFile(this.projectPath, 'utf-8'),
      readFile(this.stylesPath, 'utf-8'),
    ]);

    const projectData = JSON.parse(projectRaw);
    const stylesData = JSON.parse(stylesRaw);

    // Extract designTokens from project data
    const { designTokens, ...project } = projectData;

    // Load all page files
    const pages = {};
    const elements = {};
    const pageFiles = await readdir(this.pagesDir).catch(() => []);
    const pageReads = pageFiles
      .filter(f => f.endsWith('.json'))
      .map(f => readFile(join(this.pagesDir, f), 'utf-8'));
    const pageRaws = await Promise.all(pageReads);

    for (const raw of pageRaws) {
      const pageData = JSON.parse(raw);
      const { elements: pageElements, ...page } = pageData;
      pages[page.id] = page;
      Object.assign(elements, pageElements);
    }

    this.state = DesignStateSchema.parse({
      project,
      pages,
      elements,
      styles: stylesData,
      designTokens: designTokens || { colors: {}, fonts: {}, spacing: {} },
    });
  }

  async save() {
    if (!existsSync(this.pagesDir)) {
      await mkdir(this.pagesDir, { recursive: true });
    }

    const writes = [];
    const { project, pages, elements, styles, designTokens } = this.state;

    if (this.dirty.project) {
      const projectData = { ...project, designTokens };
      writes.push(writeFile(this.projectPath, JSON.stringify(projectData, null, 2), 'utf-8'));
    }

    if (this.dirty.styles) {
      writes.push(writeFile(this.stylesPath, JSON.stringify(styles, null, 2), 'utf-8'));
    }

    for (const pageId of this.dirty.pages) {
      const page = pages[pageId];
      if (!page) continue;
      const pageElements = {};
      for (const [elId, el] of Object.entries(elements)) {
        if (el.pageId === pageId) {
          pageElements[elId] = el;
        }
      }
      const pageData = { ...page, elements: pageElements };
      writes.push(writeFile(this.pageFilePath(pageId), JSON.stringify(pageData, null, 2), 'utf-8'));
    }

    for (const pageId of this.dirty.deletedPages) {
      const filePath = this.pageFilePath(pageId);
      if (existsSync(filePath)) {
        writes.push(unlink(filePath));
      }
    }

    if (writes.length > 0) {
      await Promise.all(writes);
    }

    this._clearDirty();
  }

  async reload() {
    await this._loadSplitFiles();
    this._clearDirty();
    this.emit('stateChanged', this.state);
  }

  _clearDirty() {
    this.dirty.project = false;
    this.dirty.styles = false;
    this.dirty.pages.clear();
    this.dirty.deletedPages.clear();
  }

  isDirty() {
    return this.dirty.project || this.dirty.styles || this.dirty.pages.size > 0 || this.dirty.deletedPages.size > 0;
  }

  getState() {
    return this.state;
  }

  getStateSnapshot() {
    return structuredClone(this.state);
  }

  generateId() {
    return nanoid(8);
  }

  // --- Element operations ---

  createElement({ tag, parentId, classes, attributes, textContent, insertIndex }) {
    const parent = this.state.elements[parentId];
    if (!parent) throw new Error(`Parent element "${parentId}" not found`);

    const id = this.generateId();
    const element = {
      id,
      tag,
      classes: classes || [],
      attributes: attributes || {},
      textContent: decodeUnicodeEscapes(textContent) || null,
      children: [],
      parentId,
      pageId: parent.pageId,
    };

    this.state.elements[id] = element;

    if (insertIndex !== undefined && insertIndex !== null) {
      parent.children.splice(insertIndex, 0, id);
    } else {
      parent.children.push(id);
    }

    this.dirty.pages.add(parent.pageId);
    this.emit('delta', {
      type: 'delta:element:created',
      data: { element: structuredClone(element), parentId, insertIndex },
    });

    return element;
  }

  updateElement({ id, tag, classes, attributes, textContent }) {
    const element = this.state.elements[id];
    if (!element) throw new Error(`Element "${id}" not found`);

    const changes = {};
    if (tag !== undefined) { element.tag = tag; changes.tag = tag; }
    if (classes !== undefined) { element.classes = classes; changes.classes = classes; }
    if (attributes !== undefined) { element.attributes = { ...element.attributes, ...attributes }; changes.attributes = element.attributes; }
    if (textContent !== undefined) { const decoded = decodeUnicodeEscapes(textContent); element.textContent = decoded; changes.textContent = decoded; }

    this.dirty.pages.add(element.pageId);
    this.emit('delta', {
      type: 'delta:element:updated',
      data: { id, changes },
    });

    return element;
  }

  deleteElement(id) {
    const element = this.state.elements[id];
    if (!element) throw new Error(`Element "${id}" not found`);
    if (!element.parentId) throw new Error('Cannot delete root element');

    const parentId = element.parentId;
    const pageId = element.pageId;

    this._deleteRecursive(id);

    const parent = this.state.elements[parentId];
    if (parent) {
      parent.children = parent.children.filter(cid => cid !== id);
    }

    this.dirty.pages.add(pageId);
    this.emit('delta', {
      type: 'delta:element:deleted',
      data: { id, parentId },
    });
  }

  _deleteRecursive(id) {
    const element = this.state.elements[id];
    if (!element) return;

    for (const childId of [...element.children]) {
      this._deleteRecursive(childId);
    }

    delete this.state.elements[id];
  }

  moveElement({ id, newParentId, insertIndex }) {
    const element = this.state.elements[id];
    if (!element) throw new Error(`Element "${id}" not found`);
    if (!element.parentId) throw new Error('Cannot move root element');

    const newParent = this.state.elements[newParentId];
    if (!newParent) throw new Error(`New parent "${newParentId}" not found`);

    const oldParentId = element.parentId;

    // Remove from old parent
    const oldParent = this.state.elements[oldParentId];
    if (oldParent) {
      oldParent.children = oldParent.children.filter(cid => cid !== id);
    }

    // Add to new parent
    element.parentId = newParentId;
    if (insertIndex !== undefined && insertIndex !== null) {
      newParent.children.splice(insertIndex, 0, id);
    } else {
      newParent.children.push(id);
    }

    // Update pageId recursively if moved to different page
    const oldPageId = element.pageId;
    if (oldPageId !== newParent.pageId) {
      this._updatePageId(id, newParent.pageId);
    }

    this.dirty.pages.add(oldPageId);
    if (oldPageId !== newParent.pageId) {
      this.dirty.pages.add(newParent.pageId);
    }

    this.emit('delta', {
      type: 'delta:element:moved',
      data: { id, oldParentId, newParentId, insertIndex },
    });

    return element;
  }

  _updatePageId(id, pageId) {
    const element = this.state.elements[id];
    if (!element) return;
    element.pageId = pageId;
    for (const childId of element.children) {
      this._updatePageId(childId, pageId);
    }
  }

  getElement(id) {
    const element = this.state.elements[id];
    if (!element) throw new Error(`Element "${id}" not found`);
    return structuredClone(element);
  }

  listElements(pageId) {
    const pid = pageId || this.state.project.activePageId;
    const page = this.state.pages[pid];
    if (!page) throw new Error(`Page "${pid}" not found`);

    const buildTree = (elementId) => {
      const el = this.state.elements[elementId];
      if (!el) return null;
      return {
        ...structuredClone(el),
        children: el.children.map(cid => buildTree(cid)).filter(Boolean),
      };
    };

    return buildTree(page.rootId);
  }

  createElementTree(parentId, elements) {
    const parent = this.state.elements[parentId];
    if (!parent) throw new Error(`Parent element "${parentId}" not found`);

    let count = 0;

    const createRecursive = (pid, defs, pageId) => {
      const ids = [];
      for (const def of defs) {
        const id = this.generateId();
        this.state.elements[id] = {
          id,
          tag: def.tag,
          classes: def.classes || [],
          attributes: def.attributes || {},
          textContent: decodeUnicodeEscapes(def.textContent) || null,
          children: [],
          parentId: pid,
          pageId,
        };
        this.state.elements[pid].children.push(id);
        ids.push(id);
        count++;
        if (def.children?.length) createRecursive(id, def.children, pageId);
      }
      return ids;
    };

    const topIds = createRecursive(parentId, elements, parent.pageId);

    this.dirty.pages.add(parent.pageId);
    this.emit('delta', {
      type: 'design:full',
      data: this.getStateSnapshot(),
    });

    return { count, topIds };
  }

  // --- Page operations ---

  createPage(name) {
    const pageId = `page-${this.generateId()}`;
    const rootId = `root-${this.generateId()}`;

    const page = {
      id: pageId,
      name,
      rootId,
      styles: {},
    };

    const rootElement = {
      id: rootId,
      tag: 'div',
      classes: ['page-root'],
      attributes: {},
      textContent: null,
      children: [],
      parentId: null,
      pageId,
    };

    this.state.pages[pageId] = page;
    this.state.elements[rootId] = rootElement;

    this.dirty.pages.add(pageId);
    this.emit('delta', {
      type: 'delta:page:created',
      data: { page: structuredClone(page), rootElement: structuredClone(rootElement) },
    });

    return page;
  }

  clonePage(sourcePageId, newName) {
    const sourcePage = this.state.pages[sourcePageId];
    if (!sourcePage) throw new Error(`Page "${sourcePageId}" not found`);

    const pageId = `page-${this.generateId()}`;
    const idMap = new Map();

    for (const [id, el] of Object.entries(this.state.elements)) {
      if (el.pageId === sourcePageId) {
        idMap.set(id, id === sourcePage.rootId ? `root-${this.generateId()}` : this.generateId());
      }
    }

    for (const [oldId, newId] of idMap) {
      const src = this.state.elements[oldId];
      this.state.elements[newId] = {
        ...structuredClone(src),
        id: newId,
        parentId: src.parentId ? idMap.get(src.parentId) : null,
        children: src.children.map(cid => idMap.get(cid)).filter(Boolean),
        pageId,
      };
    }

    const rootId = idMap.get(sourcePage.rootId);
    const page = { id: pageId, name: newName, rootId, styles: structuredClone(sourcePage.styles) };
    this.state.pages[pageId] = page;

    this.dirty.pages.add(pageId);
    this.emit('delta', {
      type: 'design:full',
      data: this.getStateSnapshot(),
    });

    return page;
  }

  deletePage(pageId) {
    const page = this.state.pages[pageId];
    if (!page) throw new Error(`Page "${pageId}" not found`);

    const pageIds = Object.keys(this.state.pages);
    if (pageIds.length <= 1) throw new Error('Cannot delete the last page');

    // Delete all elements belonging to this page
    for (const [id, el] of Object.entries(this.state.elements)) {
      if (el.pageId === pageId) {
        delete this.state.elements[id];
      }
    }

    delete this.state.pages[pageId];

    // Switch active page if needed
    let newActivePageId = null;
    if (this.state.project.activePageId === pageId) {
      this.state.project.activePageId = Object.keys(this.state.pages)[0];
      newActivePageId = this.state.project.activePageId;
      this.dirty.project = true;
    }

    this.dirty.deletedPages.add(pageId);
    this.emit('delta', {
      type: 'delta:page:deleted',
      data: { pageId, newActivePageId },
    });
  }

  renamePage(pageId, name) {
    const page = this.state.pages[pageId];
    if (!page) throw new Error(`Page "${pageId}" not found`);
    page.name = name;

    this.dirty.pages.add(pageId);
    this.emit('delta', {
      type: 'delta:page:renamed',
      data: { pageId, name },
    });

    return page;
  }

  listPages() {
    return Object.values(this.state.pages).map(p => ({
      id: p.id,
      name: p.name,
      rootId: p.rootId,
    }));
  }

  setActivePage(pageId) {
    if (!this.state.pages[pageId]) throw new Error(`Page "${pageId}" not found`);
    this.state.project.activePageId = pageId;

    this.dirty.project = true;
    this.emit('delta', {
      type: 'delta:page:activated',
      data: { pageId },
    });
  }

  // --- Style operations ---

  setStyles(selector, properties) {
    this.state.styles[selector] = {
      ...(this.state.styles[selector] || {}),
      ...properties,
    };

    this.dirty.styles = true;
    this.emit('delta', {
      type: 'delta:styles:set',
      data: { selector, properties: this.state.styles[selector] },
    });

    return this.state.styles[selector];
  }

  batchSetStyles(styles) {
    const result = {};
    for (const { selector, properties } of styles) {
      this.state.styles[selector] = {
        ...(this.state.styles[selector] || {}),
        ...properties,
      };
      result[selector] = this.state.styles[selector];
    }

    this.dirty.styles = true;
    this.emit('delta', {
      type: 'delta:styles:batch',
      data: { styles: result },
    });

    return result;
  }

  deleteStyles(selector) {
    if (!this.state.styles[selector]) throw new Error(`Style "${selector}" not found`);
    delete this.state.styles[selector];

    this.dirty.styles = true;
    this.emit('delta', {
      type: 'delta:styles:deleted',
      data: { selector },
    });
  }

  listStyles() {
    return structuredClone(this.state.styles);
  }

  // --- Design token operations ---

  setDesignTokens(category, tokens) {
    if (!this.state.designTokens[category]) {
      this.state.designTokens[category] = {};
    }
    Object.assign(this.state.designTokens[category], tokens);

    this.dirty.project = true;
    this.emit('delta', {
      type: 'delta:tokens:set',
      data: { category, tokens: this.state.designTokens[category] },
    });

    return this.state.designTokens[category];
  }

  getDesignTokens() {
    return structuredClone(this.state.designTokens);
  }

  updateTokenWithPropagation(category, key, newValue) {
    const oldValue = this.state.designTokens[category]?.[key];
    if (oldValue === undefined) throw new Error(`Token "${category}.${key}" not found`);
    if (oldValue === newValue) return { updatedStyles: 0 };

    // Word-boundary regex: matches standalone value, not inside larger tokens
    const escaped = oldValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<![a-zA-Z0-9#])${escaped}(?![a-zA-Z0-9])`, 'g');

    // Scan all styles and replace old value with new value
    let updatedStyles = 0;
    const changedSelectors = {};
    for (const [selector, props] of Object.entries(this.state.styles)) {
      let selectorChanged = false;
      for (const [prop, val] of Object.entries(props)) {
        regex.lastIndex = 0;
        if (regex.test(val)) {
          regex.lastIndex = 0;
          props[prop] = val.replace(regex, newValue);
          selectorChanged = true;
        }
      }
      if (selectorChanged) {
        updatedStyles++;
        changedSelectors[selector] = { ...props };
      }
    }

    // Update the token itself
    this.state.designTokens[category][key] = newValue;

    this.dirty.project = true;
    this.emit('delta', {
      type: 'delta:tokens:set',
      data: { category, tokens: { ...this.state.designTokens[category] } },
    });

    if (updatedStyles > 0) {
      this.dirty.styles = true;
      this.emit('delta', {
        type: 'delta:styles:batch',
        data: { styles: changedSelectors },
      });
    }

    return { updatedStyles };
  }

  // --- Design type operations ---

  setDesignType(designType) {
    this.state.project.designType = designType;
    this.dirty.project = true;
    this.emit('delta', {
      type: 'delta:project:designType',
      data: { designType },
    });
    return designType;
  }

  // --- Viewport operations ---

  setViewport({ device, width, height }) {
    const presets = {
      mobile: { width: 375, height: 812 },
      tablet: { width: 768, height: 1024 },
      desktop: { width: 1440, height: 900 },
    };

    if (device && presets[device]) {
      this.state.project.viewport = {
        device,
        width: width || presets[device].width,
        height: height || presets[device].height,
      };
    } else {
      this.state.project.viewport = {
        device: device || 'custom',
        width: width || this.state.project.viewport.width,
        height: height || this.state.project.viewport.height,
      };
    }

    this.dirty.project = true;
    this.emit('delta', {
      type: 'delta:viewport:set',
      data: { viewport: this.state.project.viewport },
    });

    return this.state.project.viewport;
  }

  // --- Asset operations ---

  get assetsDir() {
    return join(this.designsDir, 'assets');
  }

  async listAssets() {
    const dir = this.assetsDir;
    if (!existsSync(dir)) return [];

    const files = await readdir(dir);
    const assets = [];
    for (const filename of files) {
      const ext = extname(filename).toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'].includes(ext)) continue;
      const fileStat = await stat(join(dir, filename));
      assets.push({
        filename,
        url: `/api/assets/${encodeURIComponent(filename)}`,
        size: fileStat.size,
      });
    }
    return assets;
  }

  async deleteAsset(filename) {
    const filePath = join(this.assetsDir, filename);
    if (!existsSync(filePath)) throw new Error(`Asset "${filename}" not found`);
    await unlink(filePath);
  }

  // --- Page state helper ---

  getPageState(pageId) {
    const pid = pageId || this.state.project.activePageId;
    const page = this.state.pages[pid];
    if (!page) throw new Error(`Page "${pid}" not found`);

    const pageElements = {};
    for (const [id, el] of Object.entries(this.state.elements)) {
      if (el.pageId === pid) {
        pageElements[id] = structuredClone(el);
      }
    }

    return {
      page: structuredClone(page),
      elements: pageElements,
      styles: structuredClone(this.state.styles),
    };
  }
}

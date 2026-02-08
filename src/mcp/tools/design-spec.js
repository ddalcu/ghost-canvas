import { z } from 'zod';
import { requestScreenshot } from '../../web/server.js';

export function registerDesignSpecTools(server, app) {
  server.tool(
    'export_design_spec',
    'Export a structured design spec (markdown + optional screenshot) optimized for AI coding tools to rebuild the design as a real app',
    {
      pageId: z.string().optional().describe('Page ID to export (defaults to active page)'),
      includeScreenshot: z.boolean().optional().default(true).describe('Include a screenshot image (default: true)'),
    },
    async ({ pageId, includeScreenshot }) => {
      const state = app.stateManager.getStateSnapshot();
      const pid = pageId || state.project.activePageId;
      const page = state.pages[pid];
      if (!page) throw new Error(`Page "${pid}" not found`);

      const designType = state.project.designType || 'responsive-web';
      const assets = await app.stateManager.listAssets();
      const spec = buildDesignSpec(state, pid, designType, assets);

      const content = [];

      if (includeScreenshot) {
        try {
          const base64 = await requestScreenshot(app, { pageId: pid });
          content.push({ type: 'image', data: base64, mimeType: 'image/png' });
        } catch {
          // Screenshot failed (no browser open), skip it
        }
      }

      content.push({ type: 'text', text: spec });

      app.notifyActivity('[export] export_design_spec', `Exported spec for "${page.name}"`);
      return { content };
    }
  );
}

// --- Helper Functions ---

export function buildDesignSpec(state, pageId, designType, assets) {
  const page = state.pages[pageId];
  const rootElement = state.elements[page.rootId];
  if (!rootElement) return '# Empty Page';

  const { viewport } = state.project;
  const elementCount = Object.values(state.elements).filter(e => e.pageId === pageId).length;
  const styleCount = Object.keys(state.styles).length;

  const sections = [];

  // Header
  sections.push(`# Design Spec: ${state.project.name} — ${page.name}`);
  sections.push('');
  sections.push(`> **Type:** ${formatDesignType(designType)} (${viewport.width}×${viewport.height})`);
  sections.push(`> **Elements:** ${elementCount} | **Styles:** ${styleCount} | **Assets:** ${assets.length}`);
  sections.push('');

  // Design Tokens
  const tokensSection = formatDesignTokens(state.designTokens);
  if (tokensSection) {
    sections.push('## Design Tokens');
    sections.push('');
    sections.push(tokensSection);
  }

  // Assets
  if (assets.length > 0) {
    sections.push('## Assets');
    sections.push('');
    sections.push(buildAssetsSection(state, pageId, assets));
  }

  // Page Structure (ASCII tree)
  sections.push('## Page Structure');
  sections.push('');
  sections.push('```');
  sections.push(buildStructureTree(rootElement, state.elements, ''));
  sections.push('```');
  sections.push('');

  // Components
  const components = identifyComponents(rootElement, state.elements);
  if (components.length > 0) {
    sections.push('## Components');
    sections.push('');
    for (const comp of components) {
      sections.push(`### ${comp.tag}.${comp.primaryClass || comp.id}`);
      sections.push('');
      sections.push('```html');
      sections.push(renderCleanHtml(comp.element, state.elements, ''));
      sections.push('```');

      const classes = collectClasses(comp.element, state.elements);
      if (classes.length > 0) {
        sections.push(`**Classes:** ${classes.map(c => '`.' + c + '`').join(', ')}`);
      }
      sections.push('');
    }
  }

  // Styles
  sections.push('## Styles');
  sections.push('');

  const groupedStyles = groupStylesByComponent(state.styles, components);

  if (groupedStyles.base.length > 0) {
    sections.push('### Base');
    sections.push('');
    sections.push('```css');
    for (const { selector, properties } of groupedStyles.base) {
      sections.push(formatCssRule(selector, properties));
    }
    sections.push('```');
    sections.push('');
  }

  for (const [compName, rules] of Object.entries(groupedStyles.components)) {
    if (rules.length === 0) continue;
    sections.push(`### Component: ${compName}`);
    sections.push('');
    sections.push('```css');
    for (const { selector, properties } of rules) {
      sections.push(formatCssRule(selector, properties));
    }
    sections.push('```');
    sections.push('');
  }

  if (groupedStyles.responsive.length > 0) {
    sections.push('### Responsive');
    sections.push('');
    sections.push('```css');
    for (const { selector, properties } of groupedStyles.responsive) {
      sections.push(formatCssRule(selector, properties));
    }
    sections.push('```');
    sections.push('');
  }

  // All Pages
  const allPages = Object.values(state.pages);
  if (allPages.length > 1) {
    sections.push('## All Pages');
    sections.push('');
    sections.push('| Page | ID | Active |');
    sections.push('|------|----|--------|');
    for (const p of allPages) {
      const active = p.id === state.project.activePageId ? ' ✓' : '';
      sections.push(`| ${p.name} | ${p.id} |${active} |`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

function formatDesignType(type) {
  const labels = {
    'responsive-web': 'Responsive Web',
    'mobile-app': 'Mobile App',
    'tablet-app': 'Tablet App',
    'desktop-app': 'Desktop App',
  };
  return labels[type] || type;
}

function formatDesignTokens(tokens) {
  if (!tokens) return '';
  const sections = [];

  for (const [category, values] of Object.entries(tokens)) {
    const entries = Object.entries(values);
    if (entries.length === 0) continue;

    sections.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    sections.push('');
    sections.push('| Token | Value |');
    sections.push('|-------|-------|');
    for (const [key, val] of entries) {
      sections.push(`| ${key} | ${val} |`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

function buildAssetsSection(state, pageId, assets) {
  const lines = [];
  lines.push('| File | URL | Used By |');
  lines.push('|------|-----|---------|');

  for (const asset of assets) {
    const usedBy = findAssetUsage(state, pageId, asset.filename);
    lines.push(`| ${asset.filename} | ${asset.url} | ${usedBy || '—'} |`);
  }

  lines.push('');
  return lines.join('\n');
}

function findAssetUsage(state, pageId, filename) {
  const usages = [];
  const urlPattern = `/api/assets/${encodeURIComponent(filename)}`;

  // Check elements for src attributes
  for (const el of Object.values(state.elements)) {
    if (el.pageId !== pageId) continue;
    if (el.attributes?.src?.includes(filename)) {
      const cls = el.classes[0] ? `.${el.classes[0]}` : el.tag;
      usages.push(`${cls} (src)`);
    }
  }

  // Check styles for background-image
  for (const [selector, props] of Object.entries(state.styles)) {
    for (const val of Object.values(props)) {
      if (val.includes(filename) || val.includes(urlPattern)) {
        usages.push(`${selector} (background)`);
      }
    }
  }

  return usages.join(', ');
}

function buildStructureTree(element, elements, prefix) {
  const classStr = element.classes.length > 0 ? `.${element.classes.join('.')}` : '';
  const textPreview = element.textContent
    ? ` "${element.textContent.substring(0, 30)}${element.textContent.length > 30 ? '...' : ''}"`
    : '';

  let line = `${prefix}${element.tag}${classStr}${textPreview}`;
  const lines = [line];

  for (let i = 0; i < element.children.length; i++) {
    const childId = element.children[i];
    const child = elements[childId];
    if (!child) continue;

    const isLast = i === element.children.length - 1;
    const childPrefix = prefix + (isLast ? '  ' : '  ');
    lines.push(buildStructureTree(child, elements, childPrefix));
  }

  return lines.join('\n');
}

function identifyComponents(rootElement, elements) {
  const components = [];

  for (const childId of rootElement.children) {
    const child = elements[childId];
    if (!child) continue;

    components.push({
      id: child.id,
      tag: child.tag,
      primaryClass: child.classes[0] || null,
      element: child,
    });
  }

  return components;
}

function collectClasses(element, elements) {
  const classes = new Set(element.classes);

  for (const childId of element.children) {
    const child = elements[childId];
    if (!child) continue;
    for (const cls of collectClasses(child, elements)) {
      classes.add(cls);
    }
  }

  return [...classes];
}

function renderCleanHtml(element, elements, indent) {
  const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

  const attrs = [];
  if (element.classes.length > 0) {
    attrs.push(`class="${element.classes.join(' ')}"`);
  }
  for (const [key, value] of Object.entries(element.attributes || {})) {
    attrs.push(`${key}="${escapeHtml(value)}"`);
  }
  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

  if (VOID_ELEMENTS.has(element.tag)) {
    return `${indent}<${element.tag}${attrStr}>`;
  }

  const lines = [`${indent}<${element.tag}${attrStr}>`];

  if (element.textContent) {
    lines.push(`${indent}  ${escapeHtml(element.textContent)}`);
  }

  for (const childId of element.children) {
    const child = elements[childId];
    if (child) {
      lines.push(renderCleanHtml(child, elements, indent + '  '));
    }
  }

  lines.push(`${indent}</${element.tag}>`);
  return lines.join('\n');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function groupStylesByComponent(styles, components) {
  const result = {
    base: [],
    components: {},
    responsive: [],
  };

  // Build a map of component class prefixes
  const compClassMap = {};
  for (const comp of components) {
    const name = comp.primaryClass || comp.tag;
    result.components[name] = [];
    const allClasses = collectClasses(comp.element, {});
    // Use primary class as the identifier
    if (comp.primaryClass) {
      compClassMap[comp.primaryClass] = name;
    }
  }

  for (const [selector, properties] of Object.entries(styles)) {
    // Check if it's a media query
    const mediaMatch = selector.match(/^@media/);
    if (mediaMatch) {
      result.responsive.push({ selector, properties });
      continue;
    }

    // Try to match to a component
    let matched = false;
    for (const [cls, compName] of Object.entries(compClassMap)) {
      if (selector.includes(cls)) {
        result.components[compName].push({ selector, properties });
        matched = true;
        break;
      }
    }

    if (!matched) {
      result.base.push({ selector, properties });
    }
  }

  return result;
}

function formatCssRule(selector, properties) {
  const props = Object.entries(properties)
    .map(([prop, val]) => `  ${prop}: ${val};`)
    .join('\n');
  return `${selector} {\n${props}\n}`;
}

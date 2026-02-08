const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderElement(element, elements, indent = '') {
  const attrs = [];

  if (element.classes.length > 0) {
    attrs.push(`class="${escapeHtml(element.classes.join(' '))}"`);
  }

  attrs.push(`data-ofid="${element.id}"`);

  for (const [key, value] of Object.entries(element.attributes)) {
    attrs.push(`${escapeHtml(key)}="${escapeHtml(value)}"`);
  }

  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  const tag = element.tag;

  if (VOID_ELEMENTS.has(tag)) {
    return `${indent}<${tag}${attrStr}>`;
  }

  const lines = [`${indent}<${tag}${attrStr}>`];

  if (element.textContent) {
    const RAW_TEXT_TAGS = new Set(['style', 'script']);
    const text = RAW_TEXT_TAGS.has(tag) ? element.textContent : escapeHtml(element.textContent);
    lines.push(`${indent}  ${text}`);
  }

  for (const childId of element.children) {
    const child = elements[childId];
    if (child) {
      lines.push(renderElement(child, elements, indent + '  '));
    }
  }

  lines.push(`${indent}</${tag}>`);
  return lines.join('\n');
}

function buildTokenVarMap(designTokens) {
  // Build a map of raw token values → CSS variable names, plus the :root block
  const varMap = []; // [{ raw, varName, escaped, regex }]
  const rootProps = [];

  if (!designTokens) return { varMap, rootBlock: '' };

  for (const category of ['colors', 'fonts', 'spacing']) {
    const tokens = designTokens[category];
    if (!tokens) continue;
    for (const [key, value] of Object.entries(tokens)) {
      if (!value) continue;
      const varName = `--${category}-${key}`;
      rootProps.push(`  ${varName}: ${value};`);
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      varMap.push({
        raw: value,
        varName,
        regex: new RegExp(`(?<![a-zA-Z0-9#])${escaped}(?![a-zA-Z0-9])`, 'g'),
      });
    }
  }

  const rootBlock = rootProps.length > 0
    ? `:root {\n${rootProps.join('\n')}\n}`
    : '';

  return { varMap, rootBlock };
}

function substituteTokenVars(value, varMap) {
  let result = value;
  for (const { regex, varName } of varMap) {
    regex.lastIndex = 0;
    result = result.replace(regex, `var(${varName})`);
  }
  return result;
}

function renderStyles(styles, designTokens) {
  const { varMap, rootBlock } = buildTokenVarMap(designTokens);
  const rules = [];
  const mediaGroups = {};

  if (rootBlock) {
    rules.push(rootBlock);
  }

  for (const [selector, properties] of Object.entries(styles)) {
    const mediaMatch = selector.match(/^(@media\s*\([^)]+\))\s+(.+)$/);
    if (mediaMatch) {
      const [, query, innerSelector] = mediaMatch;
      if (!mediaGroups[query]) mediaGroups[query] = [];
      const props = Object.entries(properties)
        .map(([prop, val]) => `    ${prop}: ${substituteTokenVars(val, varMap)};`)
        .join('\n');
      mediaGroups[query].push(`  ${innerSelector} {\n${props}\n  }`);
    } else {
      const props = Object.entries(properties)
        .map(([prop, val]) => `  ${prop}: ${substituteTokenVars(val, varMap)};`)
        .join('\n');
      rules.push(`${selector} {\n${props}\n}`);
    }
  }

  for (const [query, innerRules] of Object.entries(mediaGroups)) {
    rules.push(`${query} {\n${innerRules.join('\n\n')}\n}`);
  }

  return rules.join('\n\n');
}

const HEAD_TAGS = new Set(['link', 'meta', 'base', 'style']);

const GOOGLE_FONT_FAMILIES = new Set([
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins',
  'Raleway', 'Nunito', 'Playfair Display', 'Merriweather', 'Source Sans Pro',
  'Ubuntu', 'Oswald', 'Noto Sans', 'Rubik', 'Work Sans', 'Fira Sans',
  'Quicksand', 'Karla', 'Josefin Sans', 'Cormorant Garamond', 'Libre Baskerville',
  'DM Sans', 'Space Grotesk', 'Plus Jakarta Sans', 'Outfit', 'Manrope',
  'Sora', 'Crimson Text', 'Bitter', 'Arimo', 'Cabin', 'Barlow',
  'Mulish', 'PT Sans', 'PT Serif', 'Inconsolata', 'Fira Code', 'JetBrains Mono',
  'Source Code Pro',
]);

function buildGoogleFontsLink(designTokens) {
  if (!designTokens?.fonts) return '';
  const families = new Set();
  for (const fontValue of Object.values(designTokens.fonts)) {
    // Font values may include fallbacks like "Inter, sans-serif" — take the first part
    const primary = fontValue.split(',')[0].trim().replace(/['"]/g, '');
    if (GOOGLE_FONT_FAMILIES.has(primary)) {
      families.add(primary);
    }
  }
  if (families.size === 0) return '';
  const params = [...families]
    .map(f => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700`)
    .join('&');
  return `  <link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${params}&display=swap">`;
}

function renderHeadElement(element) {
  const attrs = [];
  for (const cls of element.classes) {
    attrs.push(`class="${escapeHtml(cls)}"`);
  }
  for (const [key, value] of Object.entries(element.attributes)) {
    attrs.push(`${escapeHtml(key)}="${escapeHtml(value)}"`);
  }
  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  if (element.textContent) {
    return `  <${element.tag}${attrStr}>\n${element.textContent}\n  </${element.tag}>`;
  }
  return `  <${element.tag}${attrStr}>`;
}

export function renderPageHtml(state, pageId, standalone = false) {
  const pid = pageId || state.project.activePageId;
  const page = state.pages[pid];
  if (!page) return '';

  const rootElement = state.elements[page.rootId];
  if (!rootElement) return '';

  const css = renderStyles(state.styles, state.designTokens);

  if (standalone) {
    // Partition root's children into head-worthy (link/meta/base) and body children
    const headChildIds = [];
    const bodyChildIds = [];
    for (const childId of rootElement.children) {
      const child = state.elements[childId];
      if (child && HEAD_TAGS.has(child.tag)) {
        headChildIds.push(childId);
      } else {
        bodyChildIds.push(childId);
      }
    }

    // Render head elements as proper head tags (no data-ofid)
    const headElements = headChildIds
      .map(id => state.elements[id])
      .filter(Boolean)
      .map(el => renderHeadElement(el))
      .join('\n');

    // Render body with only non-head children
    const bodyLines = [`<${rootElement.tag} class="${escapeHtml(rootElement.classes.join(' '))}" data-ofid="${rootElement.id}">`];
    for (const childId of bodyChildIds) {
      const child = state.elements[childId];
      if (child) {
        bodyLines.push(renderElement(child, state.elements, '  '));
      }
    }
    bodyLines.push(`</${rootElement.tag}>`);
    const body = bodyLines.join('\n');

    const fontsLink = buildGoogleFontsLink(state.designTokens);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(page.name)} - ${escapeHtml(state.project.name)}</title>
${headElements ? headElements + '\n' : ''}${fontsLink ? fontsLink + '\n' : ''}  <style>
* { margin: 0; padding: 0; box-sizing: border-box; }
${css}
  </style>
</head>
<body>
${body}
</body>
</html>`;
  }

  const body = renderElement(rootElement, state.elements);
  return `<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
${css}
</style>
${body}`;
}

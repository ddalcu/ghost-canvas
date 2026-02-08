export class InspectorPanel {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('inspector-panel');
  }

  render(elementId, state) {
    if (!elementId || !state) {
      this.container.innerHTML = '<div class="inspector-empty">Select an element to inspect</div>';
      return;
    }

    const element = state.elements[elementId];
    if (!element) {
      this.container.innerHTML = '<div class="inspector-empty">Element not found</div>';
      return;
    }

    // If a color picker is open, detach the tokens section so we can
    // preserve it (the native picker closes if the DOM node is destroyed).
    // Everything else (including Styles) gets rebuilt with fresh values.
    const focusedColorPicker = this.container.querySelector(
      '.inspector-token-color-input:focus'
    );
    let savedTokensSection = null;
    if (focusedColorPicker) {
      const section = focusedColorPicker.closest('.inspector-section');
      if (section) {
        savedTokensSection = section;
        section.remove(); // detach but keep reference
      }
    }

    // Save focused text input state so we can restore after re-render
    const focusedText = this.container.querySelector('.inspector-token-text-input:focus');
    let restoreFocus = null;
    if (focusedText) {
      restoreFocus = {
        category: focusedText.dataset.category,
        key: focusedText.dataset.key,
        selStart: focusedText.selectionStart,
        selEnd: focusedText.selectionEnd,
      };
    }

    this.container.innerHTML = '';

    // Build token lookup once for Styles + Tokens sections
    const tokenLookup = this._buildTokenLookup(state.designTokens);

    // Tag & ID section
    this.addSection('Element', [
      { key: 'Tag', value: element.tag, cls: 'inspector-tag' },
      { key: 'ID', value: element.id },
    ]);

    // Classes
    if (element.classes.length > 0) {
      this.addSection('Classes', [
        { key: 'Classes', value: element.classes.join(', ') },
      ]);
    }

    // Attributes
    const attrEntries = Object.entries(element.attributes || {});
    if (attrEntries.length > 0) {
      this.addPropsSection('Attributes', attrEntries);
    }

    // Text content
    if (element.textContent) {
      this.addSection('Content', [
        { key: 'Text', value: element.textContent },
      ]);
    }

    // Computed styles from classes — with token link indicators
    const styles = this.getElementStyles(element, state);
    const styleEntries = Object.entries(styles);
    if (styleEntries.length > 0) {
      this.addStylesSection(styleEntries, tokenLookup);
    }

    // Design tokens matched to this element's styles
    const tokenMatches = this.getMatchingTokens(styles, state.designTokens);
    if (tokenMatches.length > 0) {
      if (savedTokensSection) {
        // Reinsert the preserved section (color picker still active)
        this.container.appendChild(savedTokensSection);
      } else {
        this.addTokensSection(tokenMatches);
      }
    }

    // Tree info
    this.addSection('Tree', [
      { key: 'Parent', value: element.parentId || '(root)' },
      { key: 'Children', value: String(element.children.length) },
      { key: 'Page', value: element.pageId },
    ]);

    // Restore focus to the equivalent text input after re-render
    if (restoreFocus) {
      const input = this.container.querySelector(
        `.inspector-token-text-input[data-category="${restoreFocus.category}"][data-key="${restoreFocus.key}"]`
      );
      if (input) {
        input.focus();
        input.setSelectionRange(restoreFocus.selStart, restoreFocus.selEnd);
      }
    }
  }

  getElementStyles(element, state) {
    const merged = {};
    for (const cls of element.classes) {
      const selector = '.' + cls;
      if (state.styles[selector]) {
        Object.assign(merged, state.styles[selector]);
      }
    }
    // Also check tag-level styles
    if (state.styles[element.tag]) {
      Object.assign(merged, state.styles[element.tag]);
    }
    return merged;
  }

  addSection(title, items) {
    const section = document.createElement('div');
    section.className = 'inspector-section';

    const label = document.createElement('div');
    label.className = 'inspector-label';
    label.textContent = title;
    section.appendChild(label);

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'inspector-prop';

      const key = document.createElement('span');
      key.className = 'inspector-prop-key';
      key.textContent = item.key;

      const value = document.createElement('span');
      value.className = item.cls || 'inspector-prop-value';
      value.textContent = item.value;

      row.appendChild(key);
      row.appendChild(value);
      section.appendChild(row);
    }

    this.container.appendChild(section);
  }

  addPropsSection(title, entries) {
    const section = document.createElement('div');
    section.className = 'inspector-section';

    const label = document.createElement('div');
    label.className = 'inspector-label';
    label.textContent = title;
    section.appendChild(label);

    for (const [key, value] of entries) {
      const row = document.createElement('div');
      row.className = 'inspector-prop';

      const keyEl = document.createElement('span');
      keyEl.className = 'inspector-prop-key';
      keyEl.textContent = key;

      const valueEl = document.createElement('span');
      valueEl.className = 'inspector-prop-value';
      valueEl.textContent = value;

      row.appendChild(keyEl);
      row.appendChild(valueEl);
      section.appendChild(row);
    }

    this.container.appendChild(section);
  }

  // --- Token-aware styles section ---

  _buildTokenLookup(designTokens) {
    const entries = [];
    if (!designTokens) return entries;
    for (const category of ['colors', 'fonts', 'spacing']) {
      const tokens = designTokens[category];
      if (!tokens) continue;
      for (const [key, value] of Object.entries(tokens)) {
        if (!value) continue;
        entries.push({ category, key, value });
      }
    }
    return entries;
  }

  _findTokenMatch(cssValue, tokenLookup) {
    for (const entry of tokenLookup) {
      const escaped = entry.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?<![a-zA-Z0-9#])${escaped}(?![a-zA-Z0-9])`);
      if (regex.test(cssValue)) {
        return entry;
      }
    }
    return null;
  }

  addStylesSection(entries, tokenLookup) {
    const section = document.createElement('div');
    section.className = 'inspector-section';

    const label = document.createElement('div');
    label.className = 'inspector-label';
    label.textContent = 'Styles';
    section.appendChild(label);

    for (const [key, value] of entries) {
      const row = document.createElement('div');
      row.className = 'inspector-prop';

      const keyEl = document.createElement('span');
      keyEl.className = 'inspector-prop-key';
      keyEl.textContent = key;

      const valueWrap = document.createElement('span');
      valueWrap.className = 'inspector-prop-value-wrap';

      const match = this._findTokenMatch(value, tokenLookup);

      if (match) {
        const dot = document.createElement('span');
        dot.className = `inspector-token-dot inspector-token-dot-${match.category}`;
        dot.title = `${match.category}.${match.key}`;
        valueWrap.appendChild(dot);

        const tokenLabel = document.createElement('span');
        tokenLabel.className = 'inspector-token-link';
        tokenLabel.textContent = match.key;
        valueWrap.appendChild(tokenLabel);
      }

      const valueEl = document.createElement('span');
      valueEl.className = 'inspector-prop-value';
      valueEl.textContent = value;
      valueWrap.appendChild(valueEl);

      row.appendChild(keyEl);
      row.appendChild(valueWrap);
      section.appendChild(row);
    }

    this.container.appendChild(section);
  }

  // --- Token detection + editing ---

  getMatchingTokens(styles, designTokens) {
    if (!designTokens) return [];
    const matches = [];
    const styleValues = Object.entries(styles);

    for (const category of ['colors', 'fonts', 'spacing']) {
      const tokens = designTokens[category];
      if (!tokens) continue;

      for (const [key, tokenValue] of Object.entries(tokens)) {
        if (!tokenValue) continue;
        const escaped = tokenValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?<![a-zA-Z0-9#])${escaped}(?![a-zA-Z0-9])`, 'g');

        const usedInProps = [];
        for (const [prop, val] of styleValues) {
          regex.lastIndex = 0;
          if (regex.test(val)) {
            usedInProps.push(prop);
          }
        }

        if (usedInProps.length > 0) {
          matches.push({ category, key, value: tokenValue, usedInProps });
        }
      }
    }

    return matches;
  }

  addTokensSection(matches) {
    const section = document.createElement('div');
    section.className = 'inspector-section';

    const label = document.createElement('div');
    label.className = 'inspector-label';
    label.textContent = 'Element Tokens';
    section.appendChild(label);

    const badgeLetters = { colors: 'C', fonts: 'F', spacing: 'S' };

    for (const match of matches) {
      const row = document.createElement('div');
      row.className = 'inspector-token-row';

      // Category badge
      const badge = document.createElement('span');
      badge.className = `inspector-token-badge inspector-token-badge-${match.category}`;
      badge.textContent = badgeLetters[match.category];
      badge.title = match.category;
      row.appendChild(badge);

      // Token name
      const name = document.createElement('span');
      name.className = 'inspector-token-name';
      name.textContent = match.key;
      name.title = `Used in: ${match.usedInProps.join(', ')}`;
      row.appendChild(name);

      // Track last-sent value to avoid redundant WS messages
      let lastSentValue = match.value;

      // Text input (created first so color picker can reference it)
      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.className = 'inspector-token-text-input';
      textInput.value = match.value;
      textInput.dataset.category = match.category;
      textInput.dataset.key = match.key;

      // Color swatch for color tokens
      let colorInput = null;
      if (match.category === 'colors') {
        colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'inspector-token-color-input';
        colorInput.value = this.normalizeColor(match.value);
        colorInput.addEventListener('input', (e) => {
          const newValue = e.target.value;
          textInput.value = newValue; // Sync text input
          if (newValue !== lastSentValue) {
            lastSentValue = newValue;
            this.app.ws.send('token:update', {
              category: match.category,
              key: match.key,
              value: newValue,
            });
          }
        });
        row.appendChild(colorInput);
      }

      const sendTextUpdate = () => {
        const newValue = textInput.value.trim();
        if (newValue && newValue !== lastSentValue) {
          lastSentValue = newValue;
          // Sync color picker if present
          if (colorInput) {
            try { colorInput.value = this.normalizeColor(newValue); } catch {}
          }
          this.app.ws.send('token:update', {
            category: match.category,
            key: match.key,
            value: newValue,
          });
        }
      };

      textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendTextUpdate();
          textInput.blur();
        }
      });
      textInput.addEventListener('blur', sendTextUpdate);

      row.appendChild(textInput);
      section.appendChild(row);
    }

    this.container.appendChild(section);
  }

  normalizeColor(value) {
    // Convert CSS color to #rrggbb for native color picker
    if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(value)) {
      const r = value[1], g = value[2], b = value[3];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    // Try using a temp element to resolve named/rgb/hsl colors
    try {
      const tmp = document.createElement('div');
      tmp.style.color = value;
      document.body.appendChild(tmp);
      const computed = getComputedStyle(tmp).color;
      document.body.removeChild(tmp);
      const rgbMatch = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (rgbMatch) {
        const hex = (n) => parseInt(n).toString(16).padStart(2, '0');
        return `#${hex(rgbMatch[1])}${hex(rgbMatch[2])}${hex(rgbMatch[3])}`;
      }
    } catch {}
    return '#000000';
  }
}

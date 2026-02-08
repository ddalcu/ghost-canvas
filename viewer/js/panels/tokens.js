export class TokensPanel {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('tokens-panel');
  }

  render(state) {
    if (!state || !state.designTokens) {
      this.container.innerHTML = '<div class="tokens-empty">No design tokens defined</div>';
      return;
    }

    // Only skip re-render if a native color picker is open
    const focusedColorPicker = this.container.querySelector('.tokens-color-input:focus');
    if (focusedColorPicker) return;

    // Save focused text input so we can restore after re-render
    const focusedText = this.container.querySelector('.tokens-text-input:focus');
    let restoreFocus = null;
    if (focusedText) {
      restoreFocus = {
        category: focusedText.dataset.category,
        key: focusedText.dataset.key,
        selStart: focusedText.selectionStart,
        selEnd: focusedText.selectionEnd,
      };
    }

    const { colors, fonts, spacing } = state.designTokens;
    const hasTokens = (colors && Object.keys(colors).length > 0)
      || (fonts && Object.keys(fonts).length > 0)
      || (spacing && Object.keys(spacing).length > 0);

    if (!hasTokens) {
      this.container.innerHTML = '<div class="tokens-empty">No design tokens defined</div>';
      return;
    }

    this.container.innerHTML = '';

    if (colors && Object.keys(colors).length > 0) {
      this.addCategory('Colors', 'colors', colors);
    }
    if (fonts && Object.keys(fonts).length > 0) {
      this.addCategory('Fonts', 'fonts', fonts);
    }
    if (spacing && Object.keys(spacing).length > 0) {
      this.addCategory('Spacing', 'spacing', spacing);
    }

    // Restore focus after re-render
    if (restoreFocus) {
      const input = this.container.querySelector(
        `.tokens-text-input[data-category="${restoreFocus.category}"][data-key="${restoreFocus.key}"]`
      );
      if (input) {
        input.focus();
        input.setSelectionRange(restoreFocus.selStart, restoreFocus.selEnd);
      }
    }
  }

  addCategory(title, category, tokens) {
    const group = document.createElement('div');
    group.className = 'tokens-group';

    const header = document.createElement('div');
    header.className = 'tokens-group-header';
    header.textContent = title;
    group.appendChild(header);

    for (const [key, value] of Object.entries(tokens)) {
      group.appendChild(this.createTokenRow(category, key, value));
    }

    this.container.appendChild(group);
  }

  createTokenRow(category, key, value) {
    const row = document.createElement('div');
    row.className = 'tokens-row';

    // Token name
    const nameEl = document.createElement('span');
    nameEl.className = 'tokens-key';
    nameEl.textContent = key;
    row.appendChild(nameEl);

    let lastSentValue = value;

    // Text input (created first so color input can reference it)
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'tokens-text-input';
    textInput.value = value;
    textInput.dataset.category = category;
    textInput.dataset.key = key;

    // Color swatch for color tokens
    let colorInput = null;
    if (category === 'colors') {
      colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'tokens-color-input';
      colorInput.value = this.normalizeColor(value);
      colorInput.addEventListener('input', (e) => {
        const newValue = e.target.value;
        textInput.value = newValue;
        if (newValue !== lastSentValue) {
          lastSentValue = newValue;
          this.app.ws.send('token:update', { category, key, value: newValue });
        }
      });
      row.appendChild(colorInput);
    }

    const sendTextUpdate = () => {
      const newValue = textInput.value.trim();
      if (newValue && newValue !== lastSentValue) {
        lastSentValue = newValue;
        if (colorInput) {
          try { colorInput.value = this.normalizeColor(newValue); } catch {}
        }
        this.app.ws.send('token:update', { category, key, value: newValue });
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
    return row;
  }

  normalizeColor(value) {
    if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(value)) {
      const r = value[1], g = value[2], b = value[3];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
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

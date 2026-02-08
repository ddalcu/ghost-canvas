import { z } from 'zod';

export function registerStyleTools(server, app) {
  server.tool(
    'set_styles',
    'Define or update a CSS class with properties',
    {
      selector: z.string().describe('CSS selector (e.g. ".header", ".hero-title", "body")'),
      properties: z.record(z.string()).describe('CSS properties (e.g. { "background-color": "#007bff", "padding": "16px" })'),
    },
    async ({ selector, properties }) => {
      const styles = app.stateManager.setStyles(selector, properties);
      app.notifyActivity('[style] set_styles', `Updated styles for "${selector}"`);
      return { content: [{ type: 'text', text: JSON.stringify({ [selector]: styles }, null, 2) }] };
    }
  );

  server.tool(
    'batch_set_styles',
    'Define or update multiple CSS classes in one call. Much faster than individual set_styles calls.',
    {
      styles: z.array(z.object({
        selector: z.string().describe('CSS selector (e.g. ".header", "@media (max-width: 768px) .header")'),
        properties: z.record(z.string()).describe('CSS properties'),
      })).describe('Array of { selector, properties } pairs'),
    },
    async ({ styles }) => {
      const result = app.stateManager.batchSetStyles(styles);
      app.notifyActivity('[style] batch_set_styles', `Updated ${styles.length} style rules`);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'delete_styles',
    'Remove a CSS class definition',
    {
      selector: z.string().describe('CSS selector to remove'),
    },
    async ({ selector }) => {
      app.stateManager.deleteStyles(selector);
      app.notifyActivity('[style] delete_styles', `Deleted styles for "${selector}"`);
      return { content: [{ type: 'text', text: `Deleted styles for "${selector}"` }] };
    }
  );

  server.tool(
    'list_styles',
    'List all defined CSS styles',
    {},
    async () => {
      const styles = app.stateManager.listStyles();
      return { content: [{ type: 'text', text: JSON.stringify(styles, null, 2) }] };
    }
  );

  server.tool(
    'set_design_tokens',
    'Set design tokens (colors, fonts, spacing)',
    {
      category: z.enum(['colors', 'fonts', 'spacing']).describe('Token category'),
      tokens: z.record(z.string()).describe('Token key-value pairs (e.g. { "primary": "#007bff", "danger": "#dc3545" })'),
      propagate: z.boolean().optional().default(false).describe('When true, also updates every CSS style that references the old token value (global find-and-replace)'),
    },
    async ({ category, tokens, propagate }) => {
      let totalUpdatedStyles = 0;

      if (propagate) {
        // For each token key that already exists, propagate the change through styles
        const existing = app.stateManager.getDesignTokens()[category] || {};
        for (const [key, newValue] of Object.entries(tokens)) {
          if (key in existing && existing[key] !== newValue) {
            const result = app.stateManager.updateTokenWithPropagation(category, key, newValue);
            totalUpdatedStyles += result.updatedStyles;
          } else {
            // New token or same value — just set it
            app.stateManager.setDesignTokens(category, { [key]: newValue });
          }
        }
      } else {
        app.stateManager.setDesignTokens(category, tokens);
      }

      const result = app.stateManager.getDesignTokens()[category];
      const suffix = propagate ? ` (propagated, ${totalUpdatedStyles} styles updated)` : '';
      app.notifyActivity('[style] set_design_tokens', `Updated ${category} design tokens${suffix}`);
      return { content: [{ type: 'text', text: JSON.stringify({ [category]: result }, null, 2) }] };
    }
  );

  server.tool(
    'get_design_tokens',
    'Get all design tokens',
    {},
    async () => {
      const tokens = app.stateManager.getDesignTokens();
      return { content: [{ type: 'text', text: JSON.stringify(tokens, null, 2) }] };
    }
  );
}

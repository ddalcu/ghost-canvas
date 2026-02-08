import { z } from 'zod';
import { renderPageHtml } from '../../renderer/html.js';

export function registerExportTools(server, app) {
  server.tool(
    'export_html',
    'Export a page as standalone HTML with embedded CSS',
    {
      pageId: z.string().optional().describe('Page ID to export (defaults to active page)'),
    },
    async ({ pageId }) => {
      const state = app.stateManager.getState();
      const pid = pageId || state.project.activePageId;
      const page = state.pages[pid];
      if (!page) throw new Error(`Page "${pid}" not found`);

      const html = renderPageHtml(state, pid, true);
      return { content: [{ type: 'text', text: html }] };
    }
  );
}

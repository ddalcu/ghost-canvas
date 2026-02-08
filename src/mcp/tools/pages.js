import { z } from 'zod';

export function registerPageTools(server, app) {
  server.tool(
    'create_page',
    'Create a new page with its own root element',
    {
      name: z.string().describe('Page name (e.g. "About", "Contact")'),
    },
    async ({ name }) => {
      const page = app.stateManager.createPage(name);
      app.notifyActivity('[page] create_page', `Created page "${name}"`);
      return { content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] };
    }
  );

  server.tool(
    'clone_page',
    'Clone an existing page with all its elements (new IDs generated)',
    {
      sourcePageId: z.string().describe('Page ID to clone'),
      name: z.string().describe('Name for the cloned page'),
    },
    async ({ sourcePageId, name }) => {
      const page = app.stateManager.clonePage(sourcePageId, name);
      app.notifyActivity('[page] clone_page', `Cloned page as "${name}"`);
      return { content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] };
    }
  );

  server.tool(
    'delete_page',
    'Delete a page and all its elements',
    {
      pageId: z.string().describe('Page ID to delete'),
    },
    async ({ pageId }) => {
      app.stateManager.deletePage(pageId);
      app.notifyActivity('[page] delete_page', `Deleted page "${pageId}"`);
      return { content: [{ type: 'text', text: `Deleted page "${pageId}"` }] };
    }
  );

  server.tool(
    'rename_page',
    'Rename an existing page',
    {
      pageId: z.string().describe('Page ID to rename'),
      name: z.string().describe('New page name'),
    },
    async ({ pageId, name }) => {
      const page = app.stateManager.renamePage(pageId, name);
      app.notifyActivity('[page] rename_page', `Renamed page to "${name}"`);
      return { content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] };
    }
  );

  server.tool(
    'list_pages',
    'List all pages in the design',
    {},
    async () => {
      const pages = app.stateManager.listPages();
      return { content: [{ type: 'text', text: JSON.stringify(pages, null, 2) }] };
    }
  );

  server.tool(
    'set_active_page',
    'Switch which page is displayed in the viewer',
    {
      pageId: z.string().describe('Page ID to make active'),
    },
    async ({ pageId }) => {
      app.stateManager.setActivePage(pageId);
      app.notifyActivity('[page] set_active_page', `Switched to page "${pageId}"`);
      return { content: [{ type: 'text', text: `Active page set to "${pageId}"` }] };
    }
  );
}

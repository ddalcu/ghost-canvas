import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerElementTools } from './tools/elements.js';
import { registerPageTools } from './tools/pages.js';
import { registerStyleTools } from './tools/styles.js';
import { registerViewportTools } from './tools/viewport.js';
import { registerHistoryTools } from './tools/history.js';
import { registerExportTools } from './tools/export.js';
import { registerProjectTools } from './tools/projects.js';
import { registerScreenshotTools } from './tools/screenshot.js';
import { registerAssetTools } from './tools/assets.js';
import { registerDesignSpecTools } from './tools/design-spec.js';

export function createMcpServer(app) {
  const server = new McpServer({
    name: 'ghostcanvas',
    version: '1.0.0',
  });

  // Wrap server.tool so every tool call emits activity:start/stop.
  // The handler is always the last argument regardless of overload.
  const originalTool = server.tool.bind(server);
  server.tool = (name, ...args) => {
    const handler = args[args.length - 1];
    args[args.length - 1] = async (...handlerArgs) => {
      app.broadcast('activity:start', { tool: name, ts: Date.now() });
      try {
        return await handler(...handlerArgs);
      } finally {
        app.broadcast('activity:stop', { tool: name, ts: Date.now() });
      }
    };
    return originalTool(name, ...args);
  };

  // Register all tool modules
  registerElementTools(server, app);
  registerPageTools(server, app);
  registerStyleTools(server, app);
  registerViewportTools(server, app);
  registerHistoryTools(server, app);
  registerExportTools(server, app);
  registerProjectTools(server, app);
  registerScreenshotTools(server, app);
  registerAssetTools(server, app);
  registerDesignSpecTools(server, app);

  // State tools registered directly here
  server.tool(
    'get_design_state',
    'Get the full design state JSON',
    {},
    async () => {
      const state = app.stateManager.getStateSnapshot();
      return { content: [{ type: 'text', text: JSON.stringify(state, null, 2) }] };
    }
  );

  server.tool(
    'get_page_state',
    'Get elements and styles for a specific page',
    {
      pageId: z.string().optional().describe('Page ID (defaults to active page)'),
    },
    async ({ pageId }) => {
      const pageState = app.stateManager.getPageState(pageId);
      return { content: [{ type: 'text', text: JSON.stringify(pageState, null, 2) }] };
    }
  );

  return server;
}

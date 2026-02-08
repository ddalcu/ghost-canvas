import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ProjectManager } from './project/manager.js';
import { createMcpServer } from './mcp/server.js';
import { createWebServer } from './web/server.js';
import { renderPageHtml } from './renderer/html.js';
import { resolve } from 'node:path';

const PORT = parseInt(process.env.GHOSTCANVAS_PORT || '4800', 10);
const DESIGNS_DIR = resolve(process.env.GHOSTCANVAS_DESIGNS_DIR || './designs');

async function main() {
  // Initialize project manager (handles StateManager, Writer, GitManager per project)
  const projectManager = new ProjectManager(DESIGNS_DIR);

  // App context shared across all modules
  // Getters delegate to projectManager's active project — transparent hot-swap on project switch
  const app = {
    projectManager,
    wss: null,
    broadcast: () => {},
    renderPageHtml,
    selectedElementId: null,
  };

  Object.defineProperties(app, {
    stateManager: { get() { return projectManager.stateManager; }, enumerable: true },
    gitManager: { get() { return projectManager.gitManager; }, enumerable: true },
    writer: { get() { return projectManager.writer; }, enumerable: true },
  });

  await projectManager.init();

  // Forward deltas from ProjectManager to WebSocket broadcast + disk writer
  projectManager.on('delta', (delta) => {
    app.broadcast(delta.type, delta.data);
    app.writer.schedule();
  });

  // On project switch, send full state to all viewers
  projectManager.on('project:switched', async ({ projects }) => {
    app.selectedElementId = null;
    app.broadcast('projects:updated', { projects });
    app.broadcast('design:full', app.stateManager.getStateSnapshot());
    const commits = await app.gitManager.getLog();
    app.broadcast('history:updated', { commits });
  });

  // Activity log broadcast (fire-and-forget, no disk I/O)
  app.notifyActivity = (tool, description) => {
    app.broadcast('activity:log', {
      tool,
      description,
      ts: new Date().toISOString(),
    });
  };

  // Manual revision save (triggered from UI)
  app.saveRevision = async (message) => {
    await app.writer.waitForFlush();
    await app.gitManager.commit(message || `Manual save: ${new Date().toISOString()}`);
    const commits = await app.gitManager.getLog();
    app.broadcast('history:updated', { commits });
  };

  // Start HTTP + WebSocket server
  await createWebServer(app, PORT);
  process.stderr.write(`GhostCanvas viewer running at http://localhost:${PORT}\n`);

  // Start MCP server on stdio
  const mcpServer = createMcpServer(app);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  process.stderr.write('GhostCanvas MCP server connected via stdio\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});

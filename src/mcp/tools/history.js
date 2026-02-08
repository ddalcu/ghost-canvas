import { z } from 'zod';

export function registerHistoryTools(server, app) {
  server.tool(
    'get_history',
    'Get git commit history of design changes',
    {
      limit: z.number().optional().default(50).describe('Maximum number of commits to return'),
    },
    async ({ limit }) => {
      const commits = await app.gitManager.getLog(limit);
      return { content: [{ type: 'text', text: JSON.stringify(commits, null, 2) }] };
    }
  );

  server.tool(
    'checkout_version',
    'Restore design to a previous version by commit hash',
    {
      commitHash: z.string().describe('Git commit hash to checkout'),
    },
    async ({ commitHash }) => {
      await app.writer.waitForFlush();
      await app.gitManager.checkout(commitHash);
      await app.stateManager.reload();
      app.broadcast('design:full', app.stateManager.getStateSnapshot());
      const commits = await app.gitManager.getLog();
      app.broadcast('history:updated', { commits });
      return { content: [{ type: 'text', text: `Checked out version ${commitHash}` }] };
    }
  );

  server.tool(
    'save_revision',
    'Save a named revision (git commit) of the current design state',
    {
      message: z.string().optional().describe('Commit message (defaults to timestamp)'),
    },
    async ({ message }) => {
      await app.saveRevision(message);
      app.notifyActivity('save_revision', message || 'Auto-save revision');
      return { content: [{ type: 'text', text: `Revision saved: ${message || 'Auto-save'}` }] };
    }
  );

  server.tool(
    'get_diff',
    'Get diff between current state and a commit',
    {
      commitHash: z.string().optional().describe('Commit hash to diff against (defaults to HEAD)'),
    },
    async ({ commitHash }) => {
      await app.writer.waitForFlush();
      const diff = await app.gitManager.getDiff(commitHash);
      return { content: [{ type: 'text', text: diff || 'No differences' }] };
    }
  );
}

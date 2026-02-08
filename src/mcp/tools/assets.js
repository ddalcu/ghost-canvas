import { z } from 'zod';

export function registerAssetTools(server, app) {
  server.tool(
    'list_assets',
    'Returns all uploaded images with URLs',
    {},
    async () => {
      const assets = await app.stateManager.listAssets();
      return { content: [{ type: 'text', text: JSON.stringify(assets, null, 2) }] };
    }
  );

  server.tool(
    'delete_asset',
    'Remove an image file',
    {
      filename: z.string().describe('Filename of the asset to delete'),
    },
    async ({ filename }) => {
      await app.stateManager.deleteAsset(filename);
      app.broadcast('assets:updated', {});
      app.notifyActivity('[assets] delete_asset', `Deleted "${filename}"`);
      return { content: [{ type: 'text', text: `Deleted asset "${filename}"` }] };
    }
  );
}

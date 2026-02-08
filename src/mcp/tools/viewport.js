import { z } from 'zod';

export function registerViewportTools(server, app) {
  server.tool(
    'set_viewport',
    'Set the viewport size (presets: mobile 375x812, tablet 768x1024, desktop 1440x900)',
    {
      device: z.string().optional().describe('Device preset: "mobile", "tablet", or "desktop"'),
      width: z.number().optional().describe('Custom width in pixels'),
      height: z.number().optional().describe('Custom height in pixels'),
    },
    async (params) => {
      const viewport = app.stateManager.setViewport(params);
      app.notifyActivity('[viewport] set_viewport', `Viewport set to ${viewport.device} (${viewport.width}x${viewport.height})`);
      return { content: [{ type: 'text', text: JSON.stringify(viewport, null, 2) }] };
    }
  );
}

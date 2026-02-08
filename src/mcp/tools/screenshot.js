import { z } from 'zod';
import { requestScreenshot } from '../../web/server.js';

export function registerScreenshotTools(server, app) {
  server.tool(
    'screenshot_page',
    'Capture a screenshot of the current design as a PNG image. Requires the viewer browser to be open at localhost:4800.',
    {
      pageId: z.string().optional().describe('Page ID to capture (defaults to active page)'),
      device: z.string().optional().describe('Device preset for capture: "mobile", "tablet", or "desktop"'),
    },
    async ({ pageId, device }) => {
      try {
        const base64 = await requestScreenshot(app, { pageId, device });
        app.notifyActivity('[screenshot] screenshot_page', `Captured screenshot${pageId ? ` of page ${pageId}` : ''}${device ? ` at ${device} size` : ''}`);
        return {
          content: [{
            type: 'image',
            data: base64,
            mimeType: 'image/png',
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `Screenshot failed: ${err.message}`,
          }],
        };
      }
    }
  );
}

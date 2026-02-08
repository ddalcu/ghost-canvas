import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import multer, { diskStorage } from 'multer';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import archiver from 'archiver';
import { buildDesignSpec } from '../mcp/tools/design-spec.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Pending screenshot requests: requestId → { resolve, reject, timeoutId }
const screenshotRequests = new Map();

const SCREENSHOT_TIMEOUT_MS = 10_000;

export function requestScreenshot(app, options = {}) {
  return new Promise((resolve, reject) => {
    const requestId = nanoid(8);

    const timeoutId = setTimeout(() => {
      screenshotRequests.delete(requestId);
      reject(new Error('Screenshot timed out — is a browser open at localhost:4800?'));
    }, SCREENSHOT_TIMEOUT_MS);

    screenshotRequests.set(requestId, { resolve, reject, timeoutId });

    app.broadcast('screenshot:request', {
      requestId,
      pageId: options.pageId || null,
      device: options.device || null,
    });
  });
}

export function createWebServer(app, port) {
  const expressApp = express();
  const httpServer = createServer(expressApp);
  const wss = new WebSocketServer({ server: httpServer });

  // Serve static viewer files
  const viewerDir = join(__dirname, '..', '..', 'viewer');
  expressApp.use(express.static(viewerDir));

  // API endpoint for rendered HTML (used by iframe)
  expressApp.get('/api/render', (req, res) => {
    const { renderPageHtml } = app;
    const state = app.stateManager.getState();
    const pageId = req.query.pageId || state.project.activePageId;
    const html = renderPageHtml(state, pageId, true);
    res.type('html').send(html);
  });

  // API endpoint for current state
  expressApp.get('/api/state', (req, res) => {
    res.json(app.stateManager.getStateSnapshot());
  });

  // API endpoint for project list
  expressApp.get('/api/projects', (req, res) => {
    res.json(app.projectManager.listProjects());
  });

  // Asset upload endpoint
  const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico']);

  const storage = diskStorage({
    destination: async (req, file, cb) => {
      const assetsDir = app.stateManager.assetsDir;
      if (!existsSync(assetsDir)) {
        await mkdir(assetsDir, { recursive: true });
      }
      cb(null, assetsDir);
    },
    filename: (req, file, cb) => {
      // Sanitize: keep original name but ensure uniqueness
      const ext = extname(file.originalname).toLowerCase();
      const base = file.originalname
        .replace(ext, '')
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .substring(0, 60);
      const unique = `${base}-${nanoid(4)}${ext}`;
      cb(null, unique);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return cb(new Error(`File type "${ext}" not allowed`));
      }
      cb(null, true);
    },
  });

  expressApp.post('/api/assets', upload.single('file'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const filename = req.file.filename;
    const url = `/api/assets/${encodeURIComponent(filename)}`;
    app.broadcast('assets:updated', {});
    app.notifyActivity('[assets] upload', `Uploaded "${filename}"`);
    res.json({ filename, url });
  });

  expressApp.get('/api/assets/:filename', (req, res) => {
    const assetsDir = app.stateManager.assetsDir;
    const filePath = join(assetsDir, req.params.filename);
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Asset not found' });
    }
    res.sendFile(filePath);
  });

  expressApp.get('/api/assets', async (req, res) => {
    const assets = await app.stateManager.listAssets();
    res.json(assets);
  });

  // Export zip endpoint: standalone HTML + assets
  expressApp.get('/api/export/zip', async (req, res) => {
    try {
      const state = app.stateManager.getStateSnapshot();
      const pageId = req.query.pageId || state.project.activePageId;
      const page = state.pages[pageId];
      if (!page) return res.status(404).json({ error: 'Page not found' });

      let html = app.renderPageHtml(state, pageId, true);

      // Rewrite /api/assets/filename → assets/filename
      html = html.replace(/\/api\/assets\//g, 'assets/');

      const projectName = state.project.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
      const zipName = `${projectName}-${page.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()}.zip`;

      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', `attachment; filename="${zipName}"`);

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);

      // Add HTML
      archive.append(html, { name: 'index.html' });

      // Add AI instructions (full design spec)
      const assets = await app.stateManager.listAssets();
      const designType = state.project.designType || 'responsive-web';
      const spec = buildDesignSpec(state, pageId, designType, assets);
      archive.append(spec, { name: 'AI-INSTRUCTIONS.md' });

      // Add assets
      const assetsDir = app.stateManager.assetsDir;
      if (existsSync(assetsDir)) {
        const files = await readdir(assetsDir);
        for (const file of files) {
          const filePath = join(assetsDir, file);
          if (existsSync(filePath)) {
            archive.file(filePath, { name: `assets/${file}` });
          }
        }
      }

      await archive.finalize();
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  });

  // WebSocket connections
  wss.on('connection', async (ws) => {
    // Send project list + full state + history on initial connection
    ws.send(JSON.stringify({
      type: 'projects:updated',
      data: { projects: app.projectManager.listProjects() },
    }));

    const state = app.stateManager.getStateSnapshot();
    ws.send(JSON.stringify({ type: 'design:full', data: state }));

    const commits = await app.gitManager.getLog();
    ws.send(JSON.stringify({ type: 'history:updated', data: { commits } }));

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        await handleClientMessage(app, msg);
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', data: { message: err.message } }));
      }
    });
  });

  app.wss = wss;
  app.broadcast = (type, data) => {
    const message = JSON.stringify({ type, data });
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  };

  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      resolve(httpServer);
    });
  });
}

async function handleClientMessage(app, msg) {
  switch (msg.type) {
    case 'history:checkout': {
      await app.writer.waitForFlush();
      await app.gitManager.checkout(msg.data.commitHash);
      await app.stateManager.reload();
      app.broadcast('design:full', app.stateManager.getStateSnapshot());
      const commits = await app.gitManager.getLog();
      app.broadcast('history:updated', { commits });
      break;
    }
    case 'page:select': {
      // setActivePage emits delta:page:activated which auto-broadcasts + schedules write
      app.stateManager.setActivePage(msg.data.pageId);
      break;
    }
    case 'revision:save': {
      const message = msg.data?.message || '';
      await app.saveRevision(message);
      break;
    }
    case 'project:switch': {
      await app.projectManager.switchProject(msg.data.projectId);
      // project:switched event in index.js handles broadcasting
      break;
    }
    case 'element:selected': {
      app.selectedElementId = msg.data.elementId || null;
      break;
    }
    case 'asset:apply': {
      const { elementId, filename, url } = msg.data;
      const element = app.stateManager.getElement(elementId);

      if (element.tag === 'img') {
        // Set src attribute for <img> elements
        app.stateManager.updateElement({ id: elementId, attributes: { src: url } });
      } else if (element.classes.length > 0) {
        // Apply as background-image on the element's first class
        const selector = `.${element.classes[0]}`;
        const existing = app.stateManager.listStyles()[selector] || {};
        app.stateManager.setStyles(selector, {
          ...existing,
          'background': `url(${url}) center/cover no-repeat`,
        });
      }

      app.notifyActivity('[assets] apply', `Applied "${filename}" to ${element.tag}.${element.classes[0] || element.id}`);
      break;
    }
    case 'token:update': {
      const { category, key, value } = msg.data;
      const result = app.stateManager.updateTokenWithPropagation(category, key, value);
      app.notifyActivity('[style] token:update', `Updated ${category}.${key} → "${value}" (${result.updatedStyles} styles updated)`);
      break;
    }
    case 'screenshot:response': {
      const { requestId, success, image, error } = msg.data;
      const pending = screenshotRequests.get(requestId);
      if (!pending) break; // already resolved or timed out
      screenshotRequests.delete(requestId);
      clearTimeout(pending.timeoutId);
      if (success) {
        pending.resolve(image);
      } else {
        pending.reject(new Error(error || 'Screenshot capture failed'));
      }
      break;
    }
  }
}

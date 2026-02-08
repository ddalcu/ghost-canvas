# GhostCanvas - AI-Controlled Visual Design Tool

## What This Is
A visual design tool where AI is the designer and humans are read-only viewers. Claude manipulates designs through MCP tools, and changes are saved to local git repos in `designs/`. The viewer is a browser-based UI at `http://localhost:4800` showing the live design.

**Key principle**: Humans view, AI designs. All editing happens via MCP tools. The viewer UI is entirely read-only except for navigation.

## Architecture
Single Node.js process (ESM) with two interfaces:
- **stdio** -- MCP protocol for Claude Code
- **HTTP + WebSocket** -- Viewer UI on port 4800 (configurable via `GHOSTCANVAS_PORT`)

### Multi-Project Support
- `designs/registry.json` tracks all projects with `activeProjectId`
- Each project lives in `designs/<slug>/` with its own git repo
- `ProjectManager` orchestrates project lifecycle and hot-swaps the active project
- `app` context uses getter properties for `stateManager`, `gitManager`, `writer` -- transparent delegation

### State Management
- State split into: `project.json`, `styles.json`, `pages/<pageId>.json` per project
- Debounced disk writes (200ms) via `DebouncedWriter` -- only dirty files written
- Delta WebSocket broadcasts (~200-500 bytes) instead of full state
- Git commits only on explicit "Save Revision" (no per-tool-call commits)

## Project Structure
```
src/
├── index.js              # Entry point -- wires ProjectManager, MCP, and web together
├── project/
│   └── manager.js        # ProjectManager: registry, project CRUD, switch orchestration
├── state/
│   ├── schema.js         # Zod schemas for the design data model
│   ├── manager.js        # StateManager: CRUD for elements/pages/styles, EventEmitter, dirty tracking
│   └── writer.js         # DebouncedWriter: schedule/flush/waitForFlush
├── git/
│   └── manager.js        # GitManager: simple-git wrapper (init, commit, log, checkout, diff)
├── mcp/
│   ├── server.js         # McpServer setup + registers all tool modules
│   └── tools/
│       ├── elements.js   # create/update/delete/move/get/list/batch_create + get_selected
│       ├── pages.js      # create/clone/delete/rename/list/set_active page
│       ├── styles.js     # set/batch_set/delete/list styles, design tokens
│       ├── viewport.js   # set_viewport (mobile/tablet/desktop/custom)
│       ├── history.js    # get_history, checkout_version, get_diff
│       ├── export.js     # export_html (standalone page)
│       ├── projects.js   # list/create/switch/delete/rename project, set_design_type
│       ├── assets.js     # list_assets, delete_asset
│       ├── design-spec.js # export_design_spec (markdown + screenshot for AI coding tools)
│       └── screenshot.js # screenshot_page (PNG capture via html2canvas)
├── web/
│   └── server.js         # Express static server + WebSocket broadcast + asset upload API
└── renderer/
    └── html.js           # JSON element tree -> HTML string

viewer/                   # Static viewer UI (vanilla JS, no framework)
├── index.html
├── css/styles.css
└── js/
    ├── app.js            # Main: inits panels, manages state, WS connection
    ├── canvas.js         # Renders design HTML into iframe, click-to-select, asset drag-drop
    ├── ws.js             # WebSocket client wrapper
    └── panels/
        ├── layers.js     # Collapsible element tree
        ├── inspector.js  # Selected element properties (read-only)
        ├── history.js    # Git commit timeline + save revision
        ├── pages.js      # Page list, click to switch
        ├── devices.js    # Phone/Tablet/Desktop switcher
        ├── activity.js   # Live MCP tool call feed
        ├── projects.js   # Project selector dropdown
        ├── assets.js     # Image upload + thumbnail grid with drag-to-canvas
        └── tokens.js     # Design tokens display

designs/                  # Auto-managed -- do NOT manually edit
├── registry.json         # { projects: [...], activeProjectId }
└── <project-slug>/
    ├── .git/
    ├── project.json      # { name, activePageId, viewport, designType, designTokens }
    ├── styles.json       # { ".selector": { prop: val } }
    ├── assets/           # Uploaded images (served at /api/assets/:filename)
    └── pages/
        └── <pageId>.json # { id, name, rootId, elements: {...} }
```

## Data Model
State is split across files per project. Element IDs are generated with `nanoid(8)`. Root elements per page use `root-` prefix. Elements reference their page via `pageId`. The flat element map uses tree structure via `children`/`parentId`.

## MCP Tools (38 total)
- **Elements** (8): `create_element`, `batch_create_elements`, `update_element`, `delete_element`, `move_element`, `get_element`, `list_elements`, `get_selected_element`
- **Pages** (6): `create_page`, `clone_page`, `delete_page`, `rename_page`, `list_pages`, `set_active_page`
- **Styles** (6): `set_styles`, `batch_set_styles`, `delete_styles`, `list_styles`, `set_design_tokens`, `get_design_tokens`
- **Viewport** (1): `set_viewport`
- **Projects** (6): `list_projects`, `create_project`, `switch_project`, `delete_project`, `rename_project`, `set_design_type`
- **Assets** (2): `list_assets`, `delete_asset`
- **History** (4): `save_revision`, `get_history`, `checkout_version`, `get_diff`
- **Export** (2): `export_html`, `export_design_spec`
- **Screenshot** (1): `screenshot_page`
- **State** (2): `get_design_state`, `get_page_state`

## WebSocket Delta Protocol
Server -> Client deltas: `element:created/updated/deleted/moved`, `page:created/deleted/renamed/activated`, `styles:set/deleted`, `tokens:set`, `viewport:set`, `project:designType`, `design:full`, `projects:updated`, `assets:updated`, `history:updated`, `activity:log`

## Dependencies
express@5, ws@8, simple-git@3, zod@3, nanoid@5, multer@2, archiver@7, @modelcontextprotocol/sdk@1.25

## Rules
- **No inline CSS** (`style="..."`). All styling goes through `set_styles`/`batch_set_styles` MCP tools.
- Elements use `data-ofid` attribute for click-to-select in the viewer iframe.
- Do not manually edit files in `designs/` -- all mutations go through StateManager.
- The `designs/` git repos are separate from the project code repo.

## Running
```bash
node src/index.js          # Starts MCP (stdio) + viewer (http://localhost:4800)
```
Environment vars: `GHOSTCANVAS_PORT` (default 4800), `GHOSTCANVAS_DESIGNS_DIR` (default ./designs)

## Software Principles
This project adheres to four core principles:

- **DRY** (Don't Repeat Yourself) -- Every piece of knowledge has a single, unambiguous, authoritative representation. Avoid code duplication; shared logic lives in one place.
- **KISS** (Keep It Stupid Simple) -- Create solutions with the greatest simplicity possible. Simple solutions work; complex ones fail. Use single-responsibility modules, short methods, clear architecture.
- **YAGNI** (You Ain't Gonna Need It) -- Do not implement features or abstractions you don't currently need. Future requirements differ from predictions. Build for today, refactor when needed.
- **SINE** (Simple Is Not Easy) -- Achieving simplicity requires effort. "Anyone can make the simple complicated. Creativity is making the complicated simple." Refactor toward simplicity; don't confuse easy with simple.

Reference: https://mattilehtinen.com/articles/4-most-important-software-development-principles-dry-yagni-kiss-and-sine/

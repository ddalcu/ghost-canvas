import { z } from 'zod';

const ElementDefSchema = z.lazy(() =>
  z.object({
    tag: z.string().describe('HTML tag name'),
    classes: z.array(z.string()).optional().describe('CSS class names'),
    attributes: z.record(z.string()).optional().describe('HTML attributes'),
    textContent: z.string().optional().describe('Text content'),
    children: z.array(ElementDefSchema).optional().describe('Child elements (recursive)'),
  })
);

export function registerElementTools(server, app) {
  server.tool(
    'batch_create_elements',
    'Create a tree of elements in one call. Much faster than individual create_element calls.',
    {
      parentId: z.string().describe('ID of the parent element to attach the tree under'),
      elements: z.array(ElementDefSchema).describe('Array of element definitions with nested children'),
    },
    async ({ parentId, elements }) => {
      const result = app.stateManager.createElementTree(parentId, elements);
      app.notifyActivity('[element] batch_create_elements', `Created ${result.count} elements`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'create_element',
    'Create a new HTML element as a child of an existing element',
    {
      tag: z.string().describe('HTML tag name (div, h1, p, nav, section, etc.)'),
      parentId: z.string().describe('ID of the parent element'),
      classes: z.array(z.string()).optional().describe('CSS class names'),
      attributes: z.record(z.string()).optional().describe('HTML attributes (e.g. { href: "/about", role: "banner" })'),
      textContent: z.string().optional().describe('Text content for the element'),
      insertIndex: z.number().optional().describe('Position index among siblings (0-based). Appends to end if omitted'),
    },
    async (params) => {
      const element = app.stateManager.createElement(params);
      app.notifyActivity('[element] create_element', `Created ${params.tag} element "${element.id}"`);
      return { content: [{ type: 'text', text: JSON.stringify(element, null, 2) }] };
    }
  );

  server.tool(
    'update_element',
    'Update properties of an existing element',
    {
      id: z.string().describe('Element ID to update'),
      tag: z.string().optional().describe('New HTML tag name'),
      classes: z.array(z.string()).optional().describe('Replace CSS class names'),
      attributes: z.record(z.string()).optional().describe('Merge into existing attributes'),
      textContent: z.string().nullable().optional().describe('New text content (null to clear)'),
    },
    async (params) => {
      const element = app.stateManager.updateElement(params);
      app.notifyActivity('[element] update_element', `Updated element "${params.id}"`);
      return { content: [{ type: 'text', text: JSON.stringify(element, null, 2) }] };
    }
  );

  server.tool(
    'delete_element',
    'Delete an element and all its children',
    {
      id: z.string().describe('Element ID to delete'),
    },
    async ({ id }) => {
      app.stateManager.deleteElement(id);
      app.notifyActivity('[element] delete_element', `Deleted element "${id}"`);
      return { content: [{ type: 'text', text: `Deleted element "${id}" and its children` }] };
    }
  );

  server.tool(
    'move_element',
    'Move an element to a new parent or position',
    {
      id: z.string().describe('Element ID to move'),
      newParentId: z.string().describe('ID of the new parent element'),
      insertIndex: z.number().optional().describe('Position index among new siblings'),
    },
    async (params) => {
      const element = app.stateManager.moveElement(params);
      app.notifyActivity('[element] move_element', `Moved element "${params.id}" to "${params.newParentId}"`);
      return { content: [{ type: 'text', text: JSON.stringify(element, null, 2) }] };
    }
  );

  server.tool(
    'get_element',
    'Get full details of an element by ID',
    {
      id: z.string().describe('Element ID'),
    },
    async ({ id }) => {
      const element = app.stateManager.getElement(id);
      return { content: [{ type: 'text', text: JSON.stringify(element, null, 2) }] };
    }
  );

  server.tool(
    'list_elements',
    'List the element tree for a page',
    {
      pageId: z.string().optional().describe('Page ID (defaults to active page)'),
    },
    async ({ pageId }) => {
      const tree = app.stateManager.listElements(pageId);
      return { content: [{ type: 'text', text: JSON.stringify(tree, null, 2) }] };
    }
  );

  server.tool(
    'get_selected_element',
    'Get the element currently selected by the user in the viewer, with full context (parent, children, page, applied styles, viewport)',
    {},
    async () => {
      const elementId = app.selectedElementId;

      if (!elementId) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ selected: false, message: 'No element is currently selected in the viewer' }),
          }],
        };
      }

      const state = app.stateManager.getState();
      const element = state.elements[elementId];

      if (!element) {
        app.selectedElementId = null;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ selected: false, message: 'Previously selected element no longer exists' }),
          }],
        };
      }

      // Parent summary
      let parent = null;
      if (element.parentId) {
        const parentEl = state.elements[element.parentId];
        if (parentEl) {
          parent = {
            id: parentEl.id,
            tag: parentEl.tag,
            classes: parentEl.classes,
            childCount: parentEl.children.length,
          };
        }
      }

      // Children summaries
      const children = element.children.map(childId => {
        const child = state.elements[childId];
        if (!child) return null;
        return {
          id: child.id,
          tag: child.tag,
          classes: child.classes,
          textContent: child.textContent
            ? (child.textContent.length > 50 ? child.textContent.substring(0, 50) + '...' : child.textContent)
            : null,
        };
      }).filter(Boolean);

      // Applied styles
      const appliedStyles = {};
      for (const cls of element.classes) {
        const selector = '.' + cls;
        if (state.styles[selector]) {
          appliedStyles[selector] = state.styles[selector];
        }
      }
      if (state.styles[element.tag]) {
        appliedStyles[element.tag] = state.styles[element.tag];
      }

      // Page info
      const page = state.pages[element.pageId];
      const pageInfo = page ? { id: page.id, name: page.name } : null;

      // Viewport info
      const viewport = state.project.viewport;

      const result = {
        selected: true,
        element: structuredClone(element),
        parent,
        children,
        appliedStyles,
        page: pageInfo,
        viewport,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

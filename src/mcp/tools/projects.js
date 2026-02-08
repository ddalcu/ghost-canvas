import { z } from 'zod';
import { DESIGN_TYPES } from '../../state/schema.js';

export function registerProjectTools(server, app) {
  server.tool(
    'list_projects',
    'List all projects with active indicator',
    {},
    async () => {
      const projects = app.projectManager.listProjects();
      return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] };
    }
  );

  server.tool(
    'create_project',
    'Create a new project by name',
    {
      name: z.string().describe('Project name (e.g. "My Dashboard")'),
      switchTo: z.boolean().optional().default(true).describe('Switch to the new project after creation (default: true)'),
      designType: z.enum(DESIGN_TYPES).optional().describe('Design type: responsive-web, mobile-app, tablet-app, desktop-app'),
    },
    async ({ name, switchTo, designType }) => {
      const project = await app.projectManager.createProject(name, { switchTo });
      if (designType && switchTo) {
        app.stateManager.setDesignType(designType);
      }

      // If switchTo, project:switched event in index.js handles broadcasting.
      // If not switching, viewers still need the updated project list.
      if (!switchTo) {
        app.broadcast('projects:updated', { projects: app.projectManager.listProjects() });
      }

      app.notifyActivity('[project] create_project', `Created project "${name}"`);
      return { content: [{ type: 'text', text: JSON.stringify(project, null, 2) }] };
    }
  );

  server.tool(
    'switch_project',
    'Switch to a different project by ID',
    {
      projectId: z.string().describe('Project ID to switch to'),
    },
    async ({ projectId }) => {
      await app.projectManager.switchProject(projectId);
      // project:switched event in index.js handles broadcasting
      const project = app.projectManager.getActiveProject();
      app.notifyActivity('[project] switch_project', `Switched to "${project.name}"`);
      return { content: [{ type: 'text', text: JSON.stringify(project, null, 2) }] };
    }
  );

  server.tool(
    'delete_project',
    'Delete a project by ID',
    {
      projectId: z.string().describe('Project ID to delete'),
    },
    async ({ projectId }) => {
      const result = await app.projectManager.deleteProject(projectId);
      app.broadcast('projects:updated', { projects: app.projectManager.listProjects() });
      app.notifyActivity('[project] delete_project', `Deleted project "${result.deleted.name}"`);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'rename_project',
    'Rename a project by ID',
    {
      projectId: z.string().describe('Project ID to rename'),
      name: z.string().describe('New project name'),
    },
    async ({ projectId, name }) => {
      const project = await app.projectManager.renameProject(projectId, name);
      app.broadcast('projects:updated', { projects: app.projectManager.listProjects() });
      app.notifyActivity('[project] rename_project', `Renamed project to "${name}"`);
      return { content: [{ type: 'text', text: JSON.stringify(project, null, 2) }] };
    }
  );

  server.tool(
    'set_design_type',
    'Set the design type of the active project (responsive-web, mobile-app, tablet-app, desktop-app)',
    {
      designType: z.enum(DESIGN_TYPES).describe('Design type'),
    },
    async ({ designType }) => {
      app.stateManager.setDesignType(designType);
      app.notifyActivity('[project] set_design_type', `Set design type to "${designType}"`);
      return { content: [{ type: 'text', text: `Design type set to "${designType}"` }] };
    }
  );
}

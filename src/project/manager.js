import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import { StateManager } from '../state/manager.js';
import { DebouncedWriter } from '../state/writer.js';
import { GitManager } from '../git/manager.js';

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50) || 'project';
}

export class ProjectManager extends EventEmitter {
  constructor(designsDir) {
    super();
    this.designsDir = designsDir;
    this.registryPath = join(designsDir, 'registry.json');
    this.registry = null;

    // Active project instances
    this.stateManager = null;
    this.writer = null;
    this.gitManager = null;
  }

  async init() {
    if (!existsSync(this.designsDir)) {
      await mkdir(this.designsDir, { recursive: true });
    }

    await this._loadRegistry();

    // If no projects exist, create a default one
    if (this.registry.projects.length === 0) {
      await this.createProject('Untitled Project', { switchTo: true });
      return;
    }

    // Initialize the active project
    const activeId = this.registry.activeProjectId;
    const project = this.registry.projects.find(p => p.id === activeId);
    if (!project) {
      // Active project missing, fall back to first
      this.registry.activeProjectId = this.registry.projects[0].id;
      await this._saveRegistry();
    }
    await this._initProject(this.registry.activeProjectId);
  }

  async _loadRegistry() {
    if (existsSync(this.registryPath)) {
      const raw = await readFile(this.registryPath, 'utf-8');
      this.registry = JSON.parse(raw);
    } else {
      this.registry = { projects: [], activeProjectId: null };
      await this._saveRegistry();
    }
  }

  async _saveRegistry() {
    await writeFile(this.registryPath, JSON.stringify(this.registry, null, 2), 'utf-8');
  }

  _projectDir(slug) {
    return join(this.designsDir, slug);
  }

  async _initProject(projectId) {
    const project = this.registry.projects.find(p => p.id === projectId);
    if (!project) throw new Error(`Project "${projectId}" not found in registry`);

    const projectDir = this._projectDir(project.slug);

    this.stateManager = new StateManager(projectDir);
    await this.stateManager.init();

    this.writer = new DebouncedWriter(this.stateManager);

    this.gitManager = new GitManager(projectDir);
    await this.gitManager.init();

    // Wire up delta listener — will be rewired on project switch
    this._deltaHandler = (delta) => {
      this.emit('delta', delta);
    };
    this.stateManager.on('delta', this._deltaHandler);
  }

  async _teardownProject() {
    if (!this.stateManager) return;

    // Flush pending writes
    if (this.writer) {
      await this.writer.waitForFlush();
    }

    // Remove delta listener
    if (this._deltaHandler) {
      this.stateManager.removeListener('delta', this._deltaHandler);
      this._deltaHandler = null;
    }

    this.stateManager = null;
    this.writer = null;
    this.gitManager = null;
  }

  listProjects() {
    return this.registry.projects.map(p => ({
      ...p,
      active: p.id === this.registry.activeProjectId,
    }));
  }

  getActiveProject() {
    return this.registry.projects.find(p => p.id === this.registry.activeProjectId) || null;
  }

  async createProject(name, { switchTo = true } = {}) {
    const id = `proj-${nanoid(8)}`;
    const baseSlug = slugify(name);

    // Ensure unique slug
    let slug = baseSlug;
    let counter = 1;
    while (this.registry.projects.some(p => p.slug === slug)) {
      slug = `${baseSlug}-${counter++}`;
    }

    const projectDir = this._projectDir(slug);
    await mkdir(projectDir, { recursive: true });

    const project = {
      id,
      name,
      slug,
      createdAt: new Date().toISOString(),
    };

    this.registry.projects.push(project);

    if (switchTo) {
      await this._teardownProject();
      this.registry.activeProjectId = id;
      await this._saveRegistry();
      await this._initProject(id);
      this.emit('project:switched', { project, projects: this.listProjects() });
    } else {
      await this._saveRegistry();
      // Still need to init the project dir so StateManager creates default files
      const tempState = new StateManager(projectDir);
      await tempState.init();
      const tempGit = new GitManager(projectDir);
      await tempGit.init();
    }

    return project;
  }

  async switchProject(projectId) {
    if (this.registry.activeProjectId === projectId) return;

    const project = this.registry.projects.find(p => p.id === projectId);
    if (!project) throw new Error(`Project "${projectId}" not found`);

    await this._teardownProject();

    this.registry.activeProjectId = projectId;
    await this._saveRegistry();

    await this._initProject(projectId);

    this.emit('project:switched', { project, projects: this.listProjects() });
  }

  async deleteProject(projectId) {
    const idx = this.registry.projects.findIndex(p => p.id === projectId);
    if (idx === -1) throw new Error(`Project "${projectId}" not found`);
    if (this.registry.projects.length <= 1) throw new Error('Cannot delete the last project');

    const project = this.registry.projects[idx];

    // If deleting active project, switch to another first
    if (this.registry.activeProjectId === projectId) {
      const nextProject = this.registry.projects.find(p => p.id !== projectId);
      await this.switchProject(nextProject.id);
    }

    // Remove from registry
    this.registry.projects.splice(idx, 1);
    await this._saveRegistry();

    // Remove project directory
    const projectDir = this._projectDir(project.slug);
    if (existsSync(projectDir)) {
      await rm(projectDir, { recursive: true, force: true });
    }

    return { deleted: project };
  }

  async renameProject(projectId, newName) {
    const project = this.registry.projects.find(p => p.id === projectId);
    if (!project) throw new Error(`Project "${projectId}" not found`);

    project.name = newName;
    await this._saveRegistry();

    return project;
  }
}

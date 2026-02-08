export class ProjectsPanel {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('projects-panel');
    this.projects = [];

    this.el.addEventListener('change', () => {
      const projectId = this.el.value;
      if (projectId) {
        this.app.ws.send('project:switch', { projectId });
      }
    });
  }

  render(projects) {
    this.projects = projects;
    this.el.innerHTML = '';

    for (const project of projects) {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      option.selected = project.active;
      this.el.appendChild(option);
    }
  }
}

export class ActivityPanel {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('activity-panel');
  }

  addEntry(data) {
    const item = document.createElement('div');
    item.className = 'activity-item';

    const time = document.createElement('span');
    time.className = 'activity-time';
    const date = new Date(data.ts);
    time.textContent = date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const tool = document.createElement('span');
    tool.className = 'activity-tool';
    tool.textContent = data.tool;

    const desc = document.createElement('span');
    desc.className = 'activity-desc';
    desc.textContent = data.description;

    item.appendChild(time);
    item.appendChild(tool);
    item.appendChild(desc);

    this.container.appendChild(item);
    this.container.scrollTop = this.container.scrollHeight;
  }
}

export class HistoryPanel {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('history-panel');
    this.saveBtn = document.getElementById('save-revision-btn');
    this.saveBtn.addEventListener('click', () => {
      const message = prompt('Revision message (optional):') || '';
      this.app.ws.send('revision:save', { message });
    });
  }

  render(commits) {
    this.container.innerHTML = '';

    if (!commits || commits.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inspector-empty';
      empty.textContent = 'No history yet — click Save Revision to save';
      this.container.appendChild(empty);
      return;
    }

    for (let i = 0; i < commits.length; i++) {
      const commit = commits[i];
      const item = document.createElement('div');
      item.className = 'history-item';

      const dot = document.createElement('span');
      dot.className = 'history-dot';

      const content = document.createElement('div');
      content.className = 'history-content';

      const message = document.createElement('div');
      message.className = 'history-message';
      message.textContent = commit.message;

      const hash = document.createElement('div');
      hash.className = 'history-hash';
      hash.textContent = commit.shortHash;

      content.appendChild(message);
      content.appendChild(hash);

      item.appendChild(dot);
      item.appendChild(content);

      item.addEventListener('click', () => {
        this.app.ws.send('history:checkout', { commitHash: commit.hash });
      });

      this.container.appendChild(item);
    }
  }
}

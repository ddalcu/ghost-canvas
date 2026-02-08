export class AssetsPanel {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('assets-panel');
    this.assets = [];
  }

  async fetchAssets() {
    try {
      const res = await fetch('/api/assets');
      this.assets = await res.json();
    } catch {
      this.assets = [];
    }
    this.render();
  }

  render() {
    this.container.innerHTML = '';

    // Drop zone
    const dropZone = document.createElement('div');
    dropZone.className = 'assets-dropzone';
    dropZone.textContent = 'Drop images here or click to upload';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'assets-file-input';
    fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('assets-dropzone-active');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('assets-dropzone-active');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('assets-dropzone-active');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        this.uploadFile(files[0]);
      }
    });

    this.container.appendChild(dropZone);
    this.container.appendChild(fileInput);

    // Thumbnail grid
    if (this.assets.length > 0) {
      const grid = document.createElement('div');
      grid.className = 'assets-grid';

      for (const asset of this.assets) {
        const item = document.createElement('div');
        item.className = 'assets-item';
        item.draggable = true;
        item.dataset.assetFilename = asset.filename;
        item.dataset.assetUrl = asset.url;

        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('application/x-ghostcanvas-asset', JSON.stringify({
            filename: asset.filename,
            url: asset.url,
          }));
          e.dataTransfer.effectAllowed = 'copy';
        });

        const thumb = document.createElement('div');
        thumb.className = 'assets-thumb';

        if (asset.filename.endsWith('.svg')) {
          thumb.innerHTML = `<img src="${asset.url}" alt="${asset.filename}" class="assets-thumb-img">`;
        } else {
          thumb.innerHTML = `<img src="${asset.url}" alt="${asset.filename}" class="assets-thumb-img">`;
        }

        const label = document.createElement('div');
        label.className = 'assets-label';
        label.textContent = asset.filename;
        label.title = asset.filename;

        item.appendChild(thumb);
        item.appendChild(label);
        grid.appendChild(item);
      }

      this.container.appendChild(grid);
    }
  }

  handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      this.uploadFile(file);
    }
    e.target.value = '';
  }

  async uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/assets', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        console.error('Upload failed:', err.error);
        return;
      }
      await this.fetchAssets();
    } catch (err) {
      console.error('Upload failed:', err);
    }
  }
}

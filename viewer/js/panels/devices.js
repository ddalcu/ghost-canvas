const PRESETS = [
  { name: 'Phone', device: 'mobile', width: 375, height: 812 },
  { name: 'Tablet', device: 'tablet', width: 768, height: 1024 },
  { name: 'Desktop', device: 'desktop', width: 1440, height: 900 },
];

export class DevicesPanel {
  constructor(app) {
    this.app = app;
    this.container = document.getElementById('device-buttons');
    this.activeDevice = 'desktop';
  }

  init() {
    for (const preset of PRESETS) {
      const btn = document.createElement('button');
      btn.className = 'device-btn' + (preset.device === this.activeDevice ? ' active' : '');
      btn.textContent = preset.name;
      btn.dataset.device = preset.device;

      btn.addEventListener('click', () => {
        this.setActive(preset.device);
        this.app.canvas.setViewport(preset.width, preset.height);
        this.app.updateViewportInfo(preset.device, preset.width, preset.height);
      });

      this.container.appendChild(btn);
    }
  }

  setActive(device) {
    this.activeDevice = device;
    const buttons = this.container.querySelectorAll('.device-btn');
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.device === device);
    });
  }

  update(viewport) {
    this.setActive(viewport.device);
  }
}

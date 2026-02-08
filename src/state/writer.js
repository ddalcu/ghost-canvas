export class DebouncedWriter {
  constructor(stateManager, delayMs = 200) {
    this.stateManager = stateManager;
    this.delayMs = delayMs;
    this._timer = null;
    this._flushPromise = null;
  }

  schedule() {
    if (this._timer) {
      clearTimeout(this._timer);
    }
    this._timer = setTimeout(() => this._doFlush(), this.delayMs);
  }

  async flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    await this._doFlush();
  }

  async waitForFlush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._flushPromise) {
      await this._flushPromise;
    }
    if (this.stateManager.isDirty()) {
      await this._doFlush();
    }
  }

  async _doFlush() {
    if (!this.stateManager.isDirty()) return;
    this._flushPromise = this.stateManager.save();
    try {
      await this._flushPromise;
    } finally {
      this._flushPromise = null;
    }
  }
}

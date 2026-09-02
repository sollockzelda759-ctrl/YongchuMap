// MvuAdapter.js —— MVU可选适配器 (ESM, 第一版仅接口)
export default class MvuAdapter {
  constructor(mapStore) {
    this.store = mapStore;
    this.enabled = false;
    this._mvuAvailable = false;
  }
  async detect() {
    try {
      if (typeof Mvu !== 'undefined' && Mvu.events) {
        this._mvuAvailable = true;
        return { available: true };
      }
      return { available: false };
    } catch (e) { return { available: false, error: e.message }; }
  }
  enable() {
    if (!this._mvuAvailable) return { success: false, error: 'MVU不可用' };
    this.enabled = true;
    return { success: true, note: '第一版仅接口，同步待实现' };
  }
  disable() { this.enabled = false; return { success: true }; }
  syncLocationToMvu() { return this.enabled ? { success: true, note: '待实现' } : { success: false }; }
  syncLocationFromMvu() { return this.enabled ? { success: true, note: '待实现' } : { success: false }; }
}

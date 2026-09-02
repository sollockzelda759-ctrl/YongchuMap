// DatabaseAdapter.js —— 数据库可选适配器 (ESM, 第一版仅接口)
export default class DatabaseAdapter {
  constructor(mapStore) {
    this.store = mapStore;
    this.enabled = false;
    this._dbAvailable = false;
  }
  async detect() {
    try {
      this._dbAvailable = false;
      return { available: false };
    } catch (e) { return { available: false, error: e.message }; }
  }
  enable() {
    if (!this._dbAvailable) return { success: false, error: '数据库不可用' };
    this.enabled = true;
    return { success: true, note: '第一版仅接口，同步待实现' };
  }
  disable() { this.enabled = false; return { success: true }; }
  syncLocationToDatabase() { return this.enabled ? { success: true, note: '待实现' } : { success: false }; }
  syncLocationFromDatabase() { return this.enabled ? { success: true, note: '待实现' } : { success: false }; }
}

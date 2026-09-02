// MapPanel.js —— 地图UI面板 (ESM, 第一版空壳)
export default class MapPanel {
  constructor(mapStore, locationRegistry, travelEngine) {
    this.store = mapStore;
    this.registry = locationRegistry;
    this.travel = travelEngine;
    this._panelElement = null;
    this._visible = false;
  }
  init() {
    console.log('[YongchuMap] MapPanel初始化（第一版空壳，UI待后续实现）');
    return { success: true, note: '第一版仅接口' };
  }
  show() { this._visible = true; return { success: true }; }
  hide() { this._visible = false; return { success: true }; }
  toggle() { this._visible = !this._visible; return this._visible; }
  render() { return { success: true, note: '待实现' }; }
  refreshLocationMarker() { return { success: true, note: '待实现' }; }
  getState() {
    return { visible: this._visible, current_location: this.store.getState().physical_state.location_name };
  }
}

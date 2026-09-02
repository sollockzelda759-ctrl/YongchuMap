// ============================================================
// MapContext.js —— 持久 map_state 注入管理 (ESM)
// v0.1.2: position='in_chat', 切聊天先uninject再注入
// ============================================================

export default class MapContext {
  constructor(mapStore, locationRegistry) {
    this.store = mapStore;
    this.registry = locationRegistry;
    this._injectHandle = null;
    this._currentContent = null;
    this.INJECT_ID = 'map_state';
  }

  generateMapStateText() {
    const state = this.store.getState();
    const phys = state.physical_state;
    const intent = state.intent_state;
    const travel = state.travel_state;

    const lines = [];
    lines.push('<map_state>');
    if (phys.world_id) lines.push('世界：' + phys.world_id);
    if (phys.nation) lines.push('国家：' + phys.nation);
    if (phys.city_id) lines.push('城市：' + phys.city_id);
    if (phys.location_name) lines.push('当前地点：' + phys.location_name);
    if (phys.coords && (phys.coords.x !== 0 || phys.coords.y !== 0)) {
      lines.push('坐标：' + phys.coords.x + ',' + phys.coords.y);
    }
    lines.push('室内：' + (phys.is_indoor ? '是' : '否'));

    if (intent.status === 'planned' && intent.destination_name) {
      lines.push('旅行意图：计划前往' + intent.destination_name + '（尚未出发）');
    }

    if (travel.active) {
      lines.push('旅行状态：' + travel.from_name + ' → ' + travel.to_name);
      lines.push('总距离：' + travel.total_distance + '里');
      lines.push('已走：' + Math.round(travel.traveled_distance * 10) / 10 + '里');
      lines.push('剩余：' + Math.round((travel.total_distance - travel.traveled_distance) * 10) / 10 + '里');
      lines.push('进度：' + Math.round(travel.progress * 100) + '%');
      lines.push('方式：' + this._modeLabel(travel.travel_mode));
    } else if (intent.status !== 'planned') {
      lines.push('旅行状态：无');
    }

    const activeDyn = state.dynamic_locations.filter(function(l) { return l.active && l.visible; }).slice(0, 3);
    if (activeDyn.length > 0) {
      lines.push('附近地点：' + activeDyn.map(function(l) { return l.name; }).join('、'));
    }
    lines.push('</map_state>');
    return lines.join('\n');
  }

  _modeLabel(mode) {
    const labels = { walking: '步行', horse: '骑马', carriage: '马车', boat: '乘船' };
    return labels[mode] || mode;
  }

  inject() {
    const content = this.generateMapStateText();

    if (content === this._currentContent && this._injectHandle) {
      return { success: true, skipped: true, reason: '内容未变化' };
    }

    // 先uninject旧值
    this.uninject();

    if (typeof injectPrompts !== 'function') {
      console.warn('[YongchuMap] injectPrompts不可用');
      return { success: false, error: 'injectPrompts不可用' };
    }

    try {
      // position='in_chat'
      const prompts = [{
        id: this.INJECT_ID,
        position: 'in_chat',
        depth: 0,
        role: 'system',
        content: content,
        should_scan: false
      }];
      const result = injectPrompts(prompts, { once: false });
      if (result && typeof result.uninject === 'function') {
        this._injectHandle = result;
      } else if (typeof result === 'function') {
        this._injectHandle = { uninject: result };
      } else {
        this._injectHandle = null;
        console.warn('[YongchuMap] injectPrompts返回值异常');
      }
      this._currentContent = content;
      return { success: true, injected: true, content_length: content.length, has_uninject: this._injectHandle !== null };
    } catch (e) {
      console.error('[YongchuMap] 注入失败:', e.message);
      return { success: false, error: e.message };
    }
  }

  uninject() {
    if (this._injectHandle) {
      try {
        if (typeof this._injectHandle.uninject === 'function') {
          this._injectHandle.uninject();
        } else if (typeof this._injectHandle === 'function') {
          this._injectHandle();
        }
      } catch (e) { /* 忽略 */ }
    }
    this._injectHandle = null;
    this._currentContent = null;
    return { success: true };
  }

  // 切聊天：先uninject旧注入，再重新注入
  onChatChanged() {
    this.uninject();
    this._currentContent = null;
    return this.inject();
  }

  refresh() {
    return this.inject();
  }

  getCurrentContent() { return this._currentContent; }
  isInjected() { return this._injectHandle !== null; }
}

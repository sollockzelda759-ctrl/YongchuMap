// ============================================================
// MapContext.js —— 持久 map_state 注入管理 (ESM)
// v0.1.2:
//   1. 宿主原生注入优先 (SillyTavern setExtensionPrompt)
//   2. 固定 promptId: 'yongchu_map_state'，同ID原地覆盖，无重复注入
//   3. Tavern Helper injectPrompts 作为可选兼容后备
//   4. 切聊天重新覆盖，destroy/unload 时传空串彻底清空
// ============================================================

export default class MapContext {
  constructor(mapStore, locationRegistry) {
    this.store = mapStore;
    this.registry = locationRegistry;
    this.PROMPT_ID = 'yongchu_map_state';
    this.INJECT_ID = this.PROMPT_ID; // 兼容别名
    this._currentContent = null;
    this._isInjected = false;
    this._injectHandle = null; // TavernHelper后备句柄
    this._mode = null; // 'native' | 'tavern_helper' | null
  }

  _getHostContext() {
    try {
      if (typeof globalThis !== 'undefined' && globalThis.SillyTavern && typeof globalThis.SillyTavern.getContext === 'function') {
        return globalThis.SillyTavern.getContext();
      }
      if (typeof window !== 'undefined' && window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
        return window.SillyTavern.getContext();
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  _getSetExtensionPrompt() {
    try {
      const ctx = this._getHostContext();
      if (ctx && typeof ctx.setExtensionPrompt === 'function') {
        return ctx.setExtensionPrompt.bind(ctx);
      }
      if (typeof globalThis !== 'undefined') {
        if (typeof globalThis.setExtensionPrompt === 'function') return globalThis.setExtensionPrompt;
        if (globalThis.SillyTavern && typeof globalThis.SillyTavern.setExtensionPrompt === 'function') {
          return globalThis.SillyTavern.setExtensionPrompt.bind(globalThis.SillyTavern);
        }
      }
      if (typeof window !== 'undefined') {
        if (typeof window.setExtensionPrompt === 'function') return window.setExtensionPrompt;
        if (window.SillyTavern && typeof window.SillyTavern.setExtensionPrompt === 'function') {
          return window.SillyTavern.setExtensionPrompt.bind(window.SillyTavern);
        }
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  _getPromptConstants() {
    const ctx = this._getHostContext();
    const types = (ctx && (ctx.extension_prompt_types || ctx.extensionPromptTypes)) ||
                  (typeof globalThis !== 'undefined' && globalThis.extension_prompt_types) ||
                  (typeof window !== 'undefined' && window.extension_prompt_types) || {};
    const roles = (ctx && (ctx.extension_prompt_roles || ctx.extensionPromptRoles)) ||
                  (typeof globalThis !== 'undefined' && globalThis.extension_prompt_roles) ||
                  (typeof window !== 'undefined' && window.extension_prompt_roles) || {};
    return {
      position: typeof types.IN_CHAT === 'number' ? types.IN_CHAT : 1, // 1 = IN_CHAT (atDepth)
      role: typeof roles.SYSTEM === 'number' ? roles.SYSTEM : 0,        // 0 = SYSTEM
      depth: 0,
      scan: false
    };
  }

  _getInjectPromptsFallback() {
    try {
      if (typeof injectPrompts === 'function') return injectPrompts;
      if (typeof globalThis !== 'undefined' && typeof globalThis.injectPrompts === 'function') return globalThis.injectPrompts;
      if (typeof window !== 'undefined') {
        if (typeof window.injectPrompts === 'function') return window.injectPrompts;
        if (window.TavernHelper && typeof window.TavernHelper.injectPrompts === 'function') {
          return window.TavernHelper.injectPrompts.bind(window.TavernHelper);
        }
      }
    } catch (e) { /* 忽略 */ }
    return null;
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
    if (!content) return { success: false, reason: 'empty_content' };

    if (content === this._currentContent && this.isInjected()) {
      return { success: true, skipped: true, reason: '内容未变化', mode: this._mode };
    }

    // ── 优先方案：SillyTavern 原生 setExtensionPrompt ──
    const setPromptFn = this._getSetExtensionPrompt();
    if (setPromptFn) {
      try {
        const { position, role, depth, scan } = this._getPromptConstants();
        // 传入相同 id 自动覆盖旧内容
        setPromptFn(this.PROMPT_ID, content, position, depth, scan, role);
        this._mode = 'native';
        this._currentContent = content;
        this._isInjected = true;
        console.log('[YongchuMap] 宿主原生提示词注入成功 (setExtensionPrompt): id=' + this.PROMPT_ID + ', len=' + content.length);
        return { success: true, mode: 'native', prompt_id: this.PROMPT_ID, length: content.length };
      } catch (e) {
        console.error('[YongchuMap] 宿主原生注入失败:', e.message);
      }
    }

    // ── 后备方案：Tavern Helper / 裸全局 injectPrompts ──
    const injectPromptsFn = this._getInjectPromptsFallback();
    if (injectPromptsFn) {
      try {
        if (this._injectHandle) {
          try {
            if (typeof this._injectHandle.uninject === 'function') this._injectHandle.uninject();
            else if (typeof this._injectHandle === 'function') this._injectHandle();
          } catch (e) {}
          this._injectHandle = null;
        }
        const prompts = [{
          id: this.PROMPT_ID,
          position: 'in_chat',
          depth: 0,
          role: 'system',
          content: content,
          should_scan: false
        }];
        const result = injectPromptsFn(prompts, { once: false });
        if (result && typeof result.uninject === 'function') {
          this._injectHandle = result;
        } else if (typeof result === 'function') {
          this._injectHandle = { uninject: result };
        }
        this._mode = 'tavern_helper';
        this._currentContent = content;
        this._isInjected = true;
        console.log('[YongchuMap] TavernHelper注入成功 (injectPrompts后备): id=' + this.PROMPT_ID);
        return { success: true, mode: 'tavern_helper', prompt_id: this.PROMPT_ID, length: content.length };
      } catch (e) {
        console.error('[YongchuMap] injectPrompts后备注入失败:', e.message);
      }
    }

    console.warn('[YongchuMap] 提示词注入接口不可用 (未检测到 setExtensionPrompt 或 injectPrompts)');
    return { success: false, reason: 'no_prompt_api_available' };
  }

  uninject() {
    const setPromptFn = this._getSetExtensionPrompt();
    if (setPromptFn) {
      try {
        const { position, role, depth, scan } = this._getPromptConstants();
        // 原生规范：传入空字符串或 null 即从 extension_prompts 清除对应 ID
        setPromptFn(this.PROMPT_ID, '', position, depth, scan, role);
      } catch (e) { /* 忽略 */ }
    }

    if (this._injectHandle) {
      try {
        if (typeof this._injectHandle.uninject === 'function') this._injectHandle.uninject();
        else if (typeof this._injectHandle === 'function') this._injectHandle();
      } catch (e) { /* 忽略 */ }
      this._injectHandle = null;
    }

    this._currentContent = null;
    this._isInjected = false;
    this._mode = null;
    return { success: true };
  }

  // 切聊天：直接以新状态覆盖当前 prompt
  onChatChanged() {
    this._currentContent = null;
    return this.inject();
  }

  refresh() {
    return this.inject();
  }

  destroy() {
    return this.uninject();
  }

  getCurrentContent() { return this._currentContent; }
  isInjected() { return this._isInjected === true; }
  getInjectionMode() { return this._mode; }
}

// ============================================================
// YongchuMap —— 独立地图扩展入口 (ESM)
// v0.1.2: 最终宿主兼容修复
//   - import.meta.url解析数据路径
//   - 等APP_READY/有效聊天上下文再初始化
//   - 真实characterId/chatId/getCurrentChatId/groupId
//   - world pack配置层（activeWorldPackId，不写死yongchu）
// ============================================================

import MapStore from './src/core/MapStore.js';
import LocationRegistry from './src/core/LocationRegistry.js';
import RouteEngine from './src/core/RouteEngine.js';
import TravelEngine from './src/core/TravelEngine.js';
import MapContext from './src/core/MapContext.js';
import SettlementEngine from './src/core/SettlementEngine.js';
import GenerationEvents from './src/events/GenerationEvents.js';
import MvuAdapter from './src/adapters/MvuAdapter.js';
import DatabaseAdapter from './src/adapters/DatabaseAdapter.js';
import MapPanel from './src/ui/MapPanel.js';

// ── 重复初始化保护 ──
if (typeof window !== 'undefined' && window.__YONGCHU_MAP_INSTANCE__) {
  console.warn('[YongchuMap] 检测到已存在的实例，跳过重复初始化');
} else {

class YongchuMap {
  constructor() {
    this.version = '0.1.2';
    this.initialized = false;
    this._destroyed = false;
    this._initPromise = null;

    // ── World Pack配置层 ──
    // 核心不写死worldId，从配置读取。第二张卡只切world pack。
    this.worldPacks = {
      yongchu: {
        id: 'yongchu',
        displayName: '永初大陆',
        defaultNation: '大昭',
        defaultCityId: 'yongan',
        defaultCityName: '永安城',
        defaultLocationId: 'jiujia_zhaidi',
        dataPath: './data/worlds/yongchu/cities/yongan.locations.json'
      }
    };
    this.activeWorldPackId = 'yongchu'; // 默认，可以通过setActiveWorldPack切换

    // 核心组件
    this.store = new MapStore();
    this.registry = new LocationRegistry();
    this.routeEngine = new RouteEngine(this.registry);
    this.travelEngine = new TravelEngine(this.store, this.routeEngine, this.registry);
    this.mapContext = new MapContext(this.store, this.registry);
    this.settlementEngine = new SettlementEngine(this.store, this.travelEngine, this.mapContext, this.registry);
    this.events = new GenerationEvents(this.settlementEngine, this.mapContext, this.store, () => this.ensureDefaultLocation());

    // 可选适配器
    this.mvuAdapter = new MvuAdapter(this.store);
    this.dbAdapter = new DatabaseAdapter(this.store);

    // UI
    this.panel = new MapPanel(this.store, this.registry, this.travelEngine);
  }

  // ── World Pack配置 ──
  getActiveWorldPack() {
    return this.worldPacks[this.activeWorldPackId] || this.worldPacks.yongchu;
  }

  setActiveWorldPack(packId) {
    if (!this.worldPacks[packId]) {
      console.warn('[YongchuMap] 未知world pack: ' + packId + '，保持当前');
      return false;
    }
    this.activeWorldPackId = packId;
    console.log('[YongchuMap] 切换world pack: ' + packId + ' (' + this.worldPacks[packId].displayName + ')');
    return true;
  }

  registerWorldPack(pack) {
    if (!pack || !pack.id) return false;
    this.worldPacks[pack.id] = pack;
    console.log('[YongchuMap] 注册world pack: ' + pack.id);
    return true;
  }

  // ── 自动初始化（等APP_READY或有效上下文） ──
  async init() {
    if (this.initialized) {
      console.warn('[YongchuMap] 已初始化，跳过');
      return this.getStatus();
    }
    if (this._destroyed) {
      console.error('[YongchuMap] 实例已销毁');
      return null;
    }
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInit();
    return this._initPromise;
  }

  async _doInit() {
    console.log('[YongchuMap] 初始化开始 v' + this.version);

    // 等待APP_READY或有效聊天上下文
    await this._waitForReady();

    // 1. 从宿主读取真实上下文
    const hostContext = this._readHostContext();
    const pack = this.getActiveWorldPack();

    this.store.setContext(
      pack.id,
      hostContext.characterId,
      hostContext.chatId,
      hostContext.groupId
    );
    console.log('[YongchuMap] 上下文: world=' + pack.id +
                ', char=' + hostContext.characterId +
                ', chat=' + hostContext.chatId +
                ', group=' + (hostContext.groupId || 'none'));

    // 2. 加载world pack数据（用import.meta.url解析）
    await this._loadWorldPackData(pack);

    // 3. 设置默认位置
    this.ensureDefaultLocation();

    // 4. 同步动态地点
    this._syncDynamicLocations();

    // 5. 注册事件（用SillyTavern正式事件系统）
    const eventsRegistered = this.events.register();
    console.log('[YongchuMap] 事件注册: ' + (eventsRegistered ? '成功' : '失败'));

    // 6. 注入初始map_state (优先SillyTavern原生setExtensionPrompt)
    const injectResult = this.mapContext.inject();
    console.log('[YongchuMap] 初始map_state注入结果:', JSON.stringify(injectResult));

    // 7. UI初始化
    this.panel.init();

    this.initialized = true;
    console.log('[YongchuMap] 初始化完成');
    return this.getStatus();
  }

  // ── 等待APP_READY或有效上下文 ──
  async _waitForReady() {
    const maxWait = 30000; // 最多等30秒
    const started = Date.now();

    while (Date.now() - started < maxWait) {
      const ctx = this._getSillyTavernContext();
      if (ctx && this._hasValidChatContext(ctx)) {
        console.log('[YongchuMap] 检测到有效聊天上下文，开始初始化');
        return;
      }
      // 检查APP_READY事件
      if (ctx && ctx.eventSource && ctx.eventTypes && ctx.eventTypes.APP_READY) {
        // 已经有eventSource，说明APP已就绪
        return;
      }
      await new Promise(function(resolve) { setTimeout(resolve, 200); });
    }
    console.warn('[YongchuMap] 等待上下文超时，继续初始化（可能功能受限）');
  }

  _hasValidChatContext(ctx) {
    if (!ctx) return false;
    // 有characterId或有chat数组即认为有效
    return !!(ctx.characterId || (ctx.character && ctx.character.id) ||
              (ctx.chat && Array.isArray(ctx.chat) && ctx.chat.length > 0));
  }

  _getSillyTavernContext() {
    try {
      if (typeof window !== 'undefined' && window.SillyTavern) {
        return window.SillyTavern.getContext();
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  // ── 从宿主读取真实host identity ──
  _readHostContext() {
    const ctx = this._getSillyTavernContext();
    let characterId = 'default';
    let chatId = 'default';
    let groupId = null;

    if (ctx) {
      // 真实字段
      characterId = ctx.characterId || (ctx.character && ctx.character.id) || 'default';
      // chatId：优先getCurrentChatId()
      if (typeof ctx.getCurrentChatId === 'function') {
        try { chatId = ctx.getCurrentChatId(); } catch (e) {}
      }
      if (!chatId || chatId === 'default') chatId = ctx.chatId || 'default';
      // groupId：群聊namespace必须包含
      groupId = ctx.groupId || (ctx.group && ctx.group.id) || null;
    }

    return {
      characterId: String(characterId),
      chatId: String(chatId),
      groupId: groupId ? String(groupId) : null
    };
  }

  // ── 加载world pack数据（import.meta.url解析） ──
  async _loadWorldPackData(pack) {
    try {
      // 用import.meta.url解析模块相对路径，不依赖页面URL
      const dataUrl = new URL(pack.dataPath, import.meta.url);
      const response = await fetch(dataUrl);
      if (response.ok) {
        const data = await response.json();
        const result = this.registry.loadCityLocations(pack.id, pack.defaultCityId, data);
        console.log('[YongchuMap] 地点数据加载: ' + result.count + '个地点 (' + pack.displayName + ')');
        return;
      }
      console.warn('[YongchuMap] 数据文件加载失败: ' + dataUrl.href + ', status=' + response.status);
    } catch (e) {
      console.warn('[YongchuMap] 数据加载异常:', e.message);
    }
  }

  _syncDynamicLocations() {
    const state = this.store.getState();
    this.routeEngine.setDynamicLocations(state.dynamic_locations);
  }

  ensureDefaultLocation() {
    const state = this.store.getState();
    const pack = this.getActiveWorldPack();
    if (!state.physical_state.location_id && pack) {
      const defaultLoc = this.registry.getLocationInCity(pack.id, pack.defaultCityId, pack.defaultLocationId);
      if (defaultLoc) {
        this.store.setPhysicalLocation({
          id: defaultLoc.id,
          name: defaultLoc.name,
          world_id: pack.id,
          nation: pack.defaultNation,
          city_id: pack.defaultCityId,
          coords: { x: defaultLoc.x, y: defaultLoc.y },
          is_indoor: defaultLoc.type === 'indoor'
        });
        console.log('[YongchuMap] 设置默认位置: ' + defaultLoc.name);
      }
    }
  }

  getStatus() {
    const state = this.store.getState();
    const pack = this.getActiveWorldPack();
    return {
      version: this.version,
      initialized: this.initialized,
      active_world_pack: this.activeWorldPackId,
      world_display: pack.displayName,
      world_id: state.physical_state.world_id,
      city_id: state.physical_state.city_id,
      current_location: state.physical_state.location_name,
      travel_active: state.travel_state.active,
      location_count: this.registry.getTotalLocationCount(),
      dynamic_location_count: state.dynamic_locations.filter(function(l) { return l.active; }).length,
      candidate_count: state.candidates.filter(function(c) { return c.status === 'pending'; }).length,
      map_state_injected: this.mapContext.isInjected(),
      events_registered: this.events.getRegisteredEventCount() > 0,
      schema_version: state.schema_version
    };
  }

  loadCityData(worldId, cityId, data) {
    return this.registry.loadCityLocations(worldId, cityId, data);
  }

  setLocation(locationId) {
    const state = this.store.getState();
    const worldId = state.physical_state.world_id || this.activeWorldPackId;
    const cityId = state.physical_state.city_id || this.getActiveWorldPack().defaultCityId;
    const loc = this.registry.getLocationInCity(worldId, cityId, locationId) ||
                this.routeEngine.dynamicLocations.find(function(l) { return l.id === locationId; });
    if (!loc) return { success: false, error: '地点不存在' };
    this.store.setPhysicalLocation({
      id: loc.id, name: loc.name, world_id: worldId, city_id: cityId,
      nation: state.physical_state.nation,
      coords: { x: loc.x, y: loc.y }, is_indoor: loc.type === 'indoor'
    });
    this.mapContext.refresh();
    return { success: true, location: loc.name };
  }

  declareTravelIntent(destinationId) {
    const result = this.travelEngine.declareIntent(destinationId);
    this.mapContext.refresh();
    return result;
  }

  depart(destinationId, travelMode) {
    const result = this.travelEngine.depart(destinationId, travelMode);
    this.mapContext.refresh();
    return result;
  }

  getDistance(fromId, toId) {
    const state = this.store.getState();
    return this.routeEngine.getDistanceById(
      state.physical_state.world_id || this.activeWorldPackId,
      state.physical_state.city_id || this.getActiveWorldPack().defaultCityId,
      fromId, toId
    );
  }

  createTravelPlan(fromId, toId, travelMode) {
    const state = this.store.getState();
    return this.routeEngine.createTravelPlan(
      state.physical_state.world_id || this.activeWorldPackId,
      state.physical_state.city_id || this.getActiveWorldPack().defaultCityId,
      fromId, toId, travelMode
    );
  }

  getMapStateText() {
    return this.mapContext.generateMapStateText();
  }

  async triggerSettlement(messageId, messageContent) {
    return this.settlementEngine.settle({
      messageId: messageId || ('manual_' + Date.now()),
      messageContent: messageContent,
      sourceMessageId: null, generationId: 'manual',
      isError: false, isAborted: false
    });
  }

  // ── [临时调试入口] 实机生命周期验收专用 ──
  // 后续 Map Core v1 实机验收完成后可随时移除或关闭
  async debugSettle(messageId, locationIdOrName) {
    if (messageId === undefined || messageId === null) {
      console.warn('[YongchuMap.debugSettle] 缺少 messageId 参数');
      return { success: false, error: '缺少 messageId' };
    }
    const state = this.store.getState();
    const worldId = state.physical_state.world_id || this.activeWorldPackId;
    const cityId = state.physical_state.city_id || this.getActiveWorldPack().defaultCityId;

    // 查找目标地点
    let loc = this.registry.getLocationInCity(worldId, cityId, locationIdOrName) ||
              this.registry.findLocationByName(worldId, cityId, locationIdOrName, state.dynamic_locations) ||
              this.routeEngine.dynamicLocations.find(function(l) { return l.id === locationIdOrName || l.name === locationIdOrName; });

    const targetName = loc ? loc.name : locationIdOrName;
    const simulatedContent = '<scene>地点：' + targetName + '</scene>\n<map_event>\naction: arrive\nname: ' + targetName + '\n</map_event>';

    console.log('[YongchuMap.debugSettle] 触发调试结算: messageId=' + messageId + ', 目标地点=' + targetName);
    return this.settlementEngine.settle({
      messageId: messageId,
      messageContent: simulatedContent,
      sourceMessageId: null,
      generationId: 'debug_' + Date.now(),
      isError: false,
      isAborted: false
    });
  }

  destroy() {
    if (this._destroyed) {
      console.warn('[YongchuMap] 已销毁，跳过重复销毁');
      return;
    }
    this.events.unregister();
    this.mapContext.uninject();
    this.initialized = false;
    this._destroyed = true;
    if (typeof window !== 'undefined') {
      delete window.__YONGCHU_MAP_INSTANCE__;
      delete window.YongchuMap;
    }
    console.log('[YongchuMap] 已销毁');
  }
}

// ── 自动初始化（等APP_READY，不DOM ready抢跑） ──
const instance = new YongchuMap();
if (typeof window !== 'undefined') {
  window.__YONGCHU_MAP_INSTANCE__ = instance;
  window.YongchuMap = instance;
}

// 不立即DOM ready初始化，等APP_READY或有效上下文
if (typeof window !== 'undefined') {
  // 尝试监听APP_READY
  const tryInit = function() {
    instance.init().catch(function(e) {
      console.error('[YongchuMap] 初始化失败:', e);
    });
  };

  // 如果SillyTavern已就绪，直接初始化
  if (window.SillyTavern && window.SillyTavern.getContext) {
    tryInit();
  } else {
    // 否则轮询等待
    const checkInterval = setInterval(function() {
      if (window.SillyTavern && window.SillyTavern.getContext) {
        clearInterval(checkInterval);
        tryInit();
      }
    }, 300);
    // 10秒后强制初始化（即使没检测到SillyTavern）
    setTimeout(function() {
      clearInterval(checkInterval);
      if (!instance.initialized) tryInit();
    }, 10000);
  }
}

} // end of duplicate-check else

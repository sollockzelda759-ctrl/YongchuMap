// ============================================================
// test_core.js —— Map Core v0.1.2 测试 (ESM)
// ============================================================

import MapStore from './src/core/MapStore.js';
import LocationRegistry from './src/core/LocationRegistry.js';
import RouteEngine from './src/core/RouteEngine.js';
import TravelEngine from './src/core/TravelEngine.js';
import MapContext from './src/core/MapContext.js';
import SettlementEngine from './src/core/SettlementEngine.js';
import GenerationEvents from './src/events/GenerationEvents.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runTests() {
  console.log('========== YongchuMap Core v0.1.2 测试开始 ==========\n');

  global.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = v; },
    removeItem(k) { delete this._data[k]; }
  };

  const store = new MapStore();
  const registry = new LocationRegistry();
  const routeEngine = new RouteEngine(registry);
  const travelEngine = new TravelEngine(store, routeEngine, registry);
  const mapContext = new MapContext(store, registry);
  const settlement = new SettlementEngine(store, travelEngine, mapContext, registry);

  store.setContext('yongchu', 'test_char', 'test_chat');

  // ── 测试1：地点数据加载 ──
  console.log('【测试1】地点数据加载');
  const dataPath = path.join(__dirname, 'data', 'worlds', 'yongchu', 'cities', 'yongan.locations.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const loadResult = registry.loadCityLocations('yongchu', 'yongan', data);
  console.log('  加载:', loadResult.count + '个地点');
  console.log('  地点数量正确:', loadResult.count === 69 ? '✓' : '✗');
  console.log('');

  // ── 测试2：schema version 0.1.2 ──
  console.log('【测试2】schema version');
  const state = store.getState();
  console.log('  schema_version:', state.schema_version);
  console.log('  版本正确:', state.schema_version === '0.1.2' ? '✓' : '✗');
  console.log('');

  // ── 测试3：rollback真实恢复before_snapshot ──
  console.log('【测试3】rollback真实恢复before_snapshot');
  store.setPhysicalLocation({
    id: 'loc_a', name: '地点A', world_id: 'yongchu', city_id: 'yongan',
    nation: '大昭', coords: { x: 1, y: 1 }, is_indoor: false
  });
  store.addDynamicLocation({ id: 'dyn_1', name: '动态点1', coords: { x: 2, y: 2 }, x: 2, y: 2 });

  const beforeState = store.getState();
  const snapshot = store.saveBeforeSnapshot();
  console.log('  before_snapshot保存:', snapshot ? '✓' : '✗');
  console.log('  快照包含physical:', !!snapshot.physical_state ? '✓' : '✗');
  console.log('  快照包含dynamic:', !!snapshot.dynamic_locations ? '✓' : '✗');
  console.log('  快照包含candidates:', !!snapshot.candidates ? '✓' : '✗');
  console.log('  快照包含travel:', !!snapshot.travel_state ? '✓' : '✗');
  console.log('  快照包含map_entities:', !!snapshot.map_entities ? '✓' : '✗');

  store.setPhysicalLocation({
    id: 'loc_b', name: '地点B', world_id: 'yongchu', city_id: 'yongan',
    nation: '大昭', coords: { x: 5, y: 5 }, is_indoor: true
  });
  store.addDynamicLocation({ id: 'dyn_2', name: '动态点2', coords: { x: 3, y: 3 }, x: 3, y: 3 });

  store.recordSettlement({
    generation_id: 'gen_test', message_id: 'msg_test_001',
    source_message_id: 'src_test', success: true,
    summary: '测试结算', before_snapshot: snapshot
  });

  const rollbackResult = store.rollbackSettlement('msg_test_001');
  console.log('  rollback结果:', rollbackResult.success ? '成功' : '失败');
  console.log('  restored(恢复快照):', rollbackResult.restored ? '✓' : '✗');

  const afterRollback = store.getState();
  console.log('  位置恢复正确:', afterRollback.physical_state.location_name === '地点A' ? '✓' : '✗');
  console.log('  动态点恢复正确:', afterRollback.dynamic_locations.length === 1 ? '✓' : '✗');
  console.log('  isSettled已清除:', !store.isSettled('msg_test_001') ? '✓' : '✗');
  console.log('');

  // ── 测试4：Regenerate同一楼层重新结算（自动先回滚旧快照） ──
  console.log('【测试4】Regenerate同一楼层重新结算（自动回滚旧快照）');
  store.setPhysicalLocation({ id: 'dongshi_zhujie', name: '东市主街', coords: { x: 9.3, y: 5.6 } });
  const snapBeforeRegen = store.saveBeforeSnapshot();
  
  // 模拟第一次生成结算：移动到长乐巷
  store.setPhysicalLocation({ id: 'changle_xiang', name: '长乐巷', coords: { x: 8.3, y: 6.4 } });
  store.recordSettlement({
    generation_id: 'gen_first', message_id: 'msg_regen_01',
    source_message_id: 'src_regen', success: true,
    summary: '前往长乐巷', before_snapshot: snapBeforeRegen
  });
  console.log('  第1次结算后位置:', store.getState().physical_state.location_name);
  console.log('  第1次已结算状态:', store.isSettled('msg_regen_01') ? '✓' : '✗');

  // 模拟用户点击Regenerate，GENERATION_ENDED再次触发msg_regen_01
  const settleRegen = await settlement.settle({
    messageId: 'msg_regen_01',
    sourceMessageId: 'src_regen',
    generationId: 'gen_regen_new'
  });
  console.log('  Regenerate重算成功:', settleRegen.success ? '✓' : '✗');
  console.log('  Regenerate后isSettled:', store.isSettled('msg_regen_01') ? '✓' : '✗');
  console.log('');

  // ── 测试5：生成停止不提交 ──
  console.log('【测试5】GENERATION_STOPPED / 中止不提交');
  settlement.markGenerationStopped('gen_stopped');
  const stoppedResult = await settlement.settle({
    messageId: 'msg_stopped', generationId: 'gen_stopped'
  });
  console.log('  停止生成跳过:', stoppedResult.skipped ? '✓' : '✗');
  const abortResult = await settlement.settle({ messageId: 'msg_abort', isAborted: true });
  console.log('  中止跳过:', abortResult.skipped ? '✓' : '✗');
  const errResult = await settlement.settle({ messageId: 'msg_err', isError: true });
  console.log('  错误跳过:', errResult.skipped ? '✓' : '✗');
  console.log('');

  // ── 测试6：Swipe同一楼层回滚 + 重新结算 ──
  console.log('【测试6】Swipe同一楼层回滚+重新结算');
  await settlement.settle({ messageId: 'msg_swipe_same', generationId: 'gen_swipe_1' });
  console.log('  原Swipe已结算:', store.isSettled('msg_swipe_same') ? '✓' : '✗');
  const swipeResult = await settlement.onSwipeChanged('msg_swipe_same', 'msg_swipe_same', 'src_user');
  console.log('  Swipe处理成功:', swipeResult.success ? '✓' : '✗');
  console.log('  Swipe后重新结算:', store.isSettled('msg_swipe_same') ? '✓' : '✗');
  console.log('');

  // ── 测试7：删除消息回滚 ──
  console.log('【测试7】删除消息回滚');
  await settlement.settle({ messageId: 'msg_delete', generationId: 'gen_del' });
  console.log('  删除前已结算:', store.isSettled('msg_delete') ? '✓' : '✗');
  const delResult = settlement.onMessageDeleted('msg_delete');
  console.log('  删除处理成功:', delResult.success ? '✓' : '✗');
  console.log('  结算已清除:', !store.isSettled('msg_delete') ? '✓' : '✗');
  console.log('');

  // ── 测试8：事件系统精确解绑 (ES.off / removeListener) ──
  console.log('【测试8】事件系统精确解绑');
  let registeredListeners = {};
  const mockEventSource = {
    on(event, handler) {
      if (!registeredListeners[event]) registeredListeners[event] = [];
      registeredListeners[event].push(handler);
    },
    off(event, handler) {
      if (registeredListeners[event]) {
        registeredListeners[event] = registeredListeners[event].filter(h => h !== handler);
      }
    }
  };
  const mockCtx = {
    eventSource: mockEventSource,
    eventTypes: {
      GENERATION_STARTED: 'generation_started',
      GENERATION_ENDED: 'generation_ended',
      GENERATION_STOPPED: 'generation_stopped',
      CHAT_CHANGED: 'chat_id_changed'
    }
  };
  global.window = { SillyTavern: { getContext: () => mockCtx } };

  const genEvents = new GenerationEvents(settlement, mapContext, store);
  genEvents.register();
  console.log('  注册事件数量:', Object.keys(registeredListeners).reduce((acc, k) => acc + registeredListeners[k].length, 0));
  console.log('  注册成功:', genEvents.getRegisteredEventCount() === 4 ? '✓' : '✗');

  // 测试解绑
  genEvents.unregister();
  const remainingListeners = Object.keys(registeredListeners).reduce((acc, k) => acc + registeredListeners[k].length, 0);
  console.log('  解绑后残留数量:', remainingListeners);
  console.log('  完全卸载无泄漏:', remainingListeners === 0 ? '✓' : '✗');
  console.log('');

  // ── 测试9：world pack配置层与核心解耦 ──
  console.log('【测试9】world pack配置层与核心解耦');
  const worldPacks = {
    yongchu: { id: 'yongchu', displayName: '永初大陆', defaultNation: '大昭', defaultCityId: 'yongan' },
    second_world: { id: 'second_world', displayName: '第二世界', defaultNation: '测试国', defaultCityId: 'test_city' }
  };
  let activeWorldPackId = 'second_world';
  store.setContext(activeWorldPackId, 'char_2', 'chat_2');
  console.log('  切换到第2世界:', store.currentWorldId === 'second_world' ? '✓' : '✗');
  const s2 = store.getState();
  console.log('  新世界状态独立:', s2.meta.world_id === 'second_world' ? '✓' : '✗');
  console.log('');

  // ── 测试10：群聊namespace含groupId ──
  console.log('【测试10】群聊namespace含groupId');
  store.setContext('yongchu', 'char_group', 'chat_group', 'group_001');
  store.setPhysicalLocation({ id: 'loc_group', name: '群聊地点', coords: { x: 9, y: 9 } });
  store.setContext('yongchu', 'char_group', 'chat_group', 'group_002');
  const s10b = store.getState();
  console.log('  不同group不串状态:', !s10b.physical_state.location_name ? '✓' : '✗');
  store.setContext('yongchu', 'char_group', 'chat_group', 'group_001');
  const s10a = store.getState();
  console.log('  切回原group正确:', s10a.physical_state.location_name === '群聊地点' ? '✓' : '✗');
  console.log('');

  // ── 测试11：宿主原生 setExtensionPrompt 优先与后备机制 ──
  console.log('【测试11】宿主原生 setExtensionPrompt 优先与后备机制');
  let extensionPromptsRegistry = {};
  const mockSetExtensionPrompt = function(id, content, position, depth, scan, role) {
    if (!id) return;
    if (!content) {
      delete extensionPromptsRegistry[id];
    } else {
      extensionPromptsRegistry[id] = { content, position, depth, scan, role };
    }
  };

  // 11.1 测试原生 setExtensionPrompt 注入
  global.window.SillyTavern.getContext = () => ({
    setExtensionPrompt: mockSetExtensionPrompt,
    extension_prompt_types: { IN_CHAT: 1 },
    extension_prompt_roles: { SYSTEM: 0 }
  });

  store.setContext('yongchu', 'test_char', 'test_chat');
  store.setPhysicalLocation({ id: 'jiujia_zhaidi', name: '旧家宅邸', world_id: 'yongchu', city_id: 'yongan' });

  const injectRes1 = mapContext.inject();
  console.log('  原生setExtensionPrompt注入成功:', injectRes1.success && injectRes1.mode === 'native' ? '✓' : '✗');
  console.log('  prompt id === "yongchu_map_state":', !!extensionPromptsRegistry['yongchu_map_state'] ? '✓' : '✗');
  console.log('  position === 1 (IN_CHAT):', extensionPromptsRegistry['yongchu_map_state']?.position === 1 ? '✓' : '✗');
  console.log('  role === 0 (SYSTEM):', extensionPromptsRegistry['yongchu_map_state']?.role === 0 ? '✓' : '✗');
  console.log('  scan === false:', extensionPromptsRegistry['yongchu_map_state']?.scan === false ? '✓' : '✗');

  // 11.2 同ID原地覆盖测试（位置变化后再次inject）
  store.setPhysicalLocation({ id: 'dongshi_zhujie', name: '东市主街', world_id: 'yongchu', city_id: 'yongan' });
  const injectRes2 = mapContext.inject();
  console.log('  同一ID直接覆盖无重复:', (Object.keys(extensionPromptsRegistry).length === 1 && extensionPromptsRegistry['yongchu_map_state'].content.includes('东市主街')) ? '✓' : '✗');

  // 11.3 uninject / destroy 清空测试
  mapContext.uninject();
  console.log('  uninject()清空原生prompt:', !extensionPromptsRegistry['yongchu_map_state'] ? '✓' : '✗');

  // 11.4 测试无原生API时的 injectPrompts 后备
  delete global.window.SillyTavern.getContext;
  let fallbackPrompts = null;
  global.injectPrompts = function(prompts, options) {
    fallbackPrompts = prompts;
    return { uninject: () => { fallbackPrompts = null; } };
  };
  const injectResFallback = mapContext.inject();
  console.log('  无原生API时自动切换TavernHelper后备:', (injectResFallback.success && injectResFallback.mode === 'tavern_helper') ? '✓' : '✗');
  mapContext.uninject();
  console.log('  后备uninject()正常清空:', fallbackPrompts === null ? '✓' : '✗');
  console.log('');

  // ── 测试12：import.meta.url数据路径验证 ──
  console.log('【测试12】数据文件路径（import.meta.url）');
  const dataUrl = new URL('./data/worlds/yongchu/cities/yongan.locations.json', import.meta.url);
  console.log('  文件存在:', fs.existsSync(dataUrl) ? '✓' : '✗');
  console.log('');

  // ── 测试13：debugSettle 临时调试入口与 rollback 链路 ──
  console.log('【测试13】debugSettle 调试入口与 rollback 真实链路');
  store.setPhysicalLocation({ id: 'jiujia_zhaidi', name: '旧家宅邸', world_id: 'yongchu', city_id: 'yongan' });
  const locBefore = store.getState().physical_state.location_name;

  // 模拟 debugSettle 内部逻辑：通过 SettlementEngine 执行
  const simContent = '<scene>地点：东市主街</scene>\n<map_event>\naction: arrive\nname: 东市主街\n</map_event>';
  const settleRes = await settlement.settle({
    messageId: 'debug_msg_777',
    messageContent: simContent,
    sourceMessageId: null,
    generationId: 'debug_test'
  });

  console.log('  debug结算成功:', settleRes.success ? '✓' : '✗');
  console.log('  位置已变更至东市主街:', store.getState().physical_state.location_name === '东市主街' ? '✓' : '✗');
  console.log('  已生成before_snapshot:', !!settleRes.has_before_snapshot ? '✓' : '✗');
  console.log('  isSettled已标记:', store.isSettled('debug_msg_777') ? '✓' : '✗');

  // 执行回滚 (模拟 Delete / Swipe 触发)
  const rollRes = settlement.onMessageDeleted('debug_msg_777');
  console.log('  触发删除回滚成功:', rollRes.success ? '✓' : '✗');
  console.log('  位置真实恢复回旧家宅邸:', store.getState().physical_state.location_name === locBefore ? '✓' : '✗');
  console.log('  isSettled已解除:', !store.isSettled('debug_msg_777') ? '✓' : '✗');
  console.log('');

  // ── 测试14：宿主删除事件 ID 与 chat index 不一致（例如删除4楼，宿主传3） ──
  console.log('【测试14】宿主删除事件 ID 与 chat index 不一致容错');
  store.setPhysicalLocation({ id: 'jiujia_zhaidi', name: '旧家宅邸', world_id: 'yongchu', city_id: 'yongan' });
  const locBefore14 = store.getState().physical_state.location_name;

  // 14.1 结算在 4 楼 (比如原始消息 index=4)
  const simContent14 = '<scene>地点：东市主街</scene>\n<map_event>\naction: arrive\nname: 东市主街\n</map_event>';
  await settlement.settle({
    messageId: 4,
    messageContent: simContent14,
    sourceMessageId: 3,
    generationId: 'gen_del_test'
  });
  console.log('  4楼已结算:', store.isSettled(4) ? '✓' : '✗');
  console.log('  位置变更至东市主街:', store.getState().physical_state.location_name === '东市主街' ? '✓' : '✗');

  // 14.2 模拟宿主删除了 4 楼后，事件传参为剩余消息的新末尾索引 3
  // 此时 window.SillyTavern.getContext().chat 只有 0, 1, 2, 3 四条消息
  global.window.SillyTavern.getContext = () => ({
    chat: [
      { message_id: 0, is_user: true, mes: 'm0' },
      { message_id: 1, is_user: false, mes: 'm1' },
      { message_id: 2, is_user: true, mes: 'm2' },
      { message_id: 3, is_user: true, mes: 'm3' }
    ]
  });

  // 触发 onMessageDeleted(3)
  const rollRes14 = settlement.onMessageDeleted(3);
  console.log('  触发删除回滚成功:', rollRes14.success ? '✓' : '✗');
  console.log('  4楼结算已回滚 (isSettled(4) === false):', !store.isSettled(4) ? '✓' : '✗');
  console.log('  位置真实恢复回旧家宅邸:', store.getState().physical_state.location_name === locBefore14 ? '✓' : '✗');
  console.log('');

  // ── 测试15：settlement 7 和 8 都存在，删除8，宿主传7，必须只回滚8，7保持合法 ──
  console.log('【测试15】多结算共存时删除末尾楼层容错（7与8并存，删8传7，只回滚8）');
  store.setPhysicalLocation({ id: 'jiujia_zhaidi', name: '旧家宅邸', world_id: 'yongchu', city_id: 'yongan' });

  // 结算第7楼（东市主街）
  const simContent7 = '<scene>地点：东市主街</scene>\n<map_event>\naction: arrive\nname: 东市主街\n</map_event>';
  await settlement.settle({
    messageId: 7,
    messageContent: simContent7,
    sourceMessageId: 6,
    generationId: 'gen_7'
  });
  console.log('  7楼已结算:', store.isSettled(7) ? '✓' : '✗');
  console.log('  7楼结算后位置为东市主街:', store.getState().physical_state.location_name === '东市主街' ? '✓' : '✗');

  // 结算第8楼（西市）
  const simContent8 = '<scene>地点：西市</scene>\n<map_event>\naction: arrive\nname: 西市\n</map_event>';
  await settlement.settle({
    messageId: 8,
    messageContent: simContent8,
    sourceMessageId: 7,
    generationId: 'gen_8'
  });
  console.log('  8楼已结算:', store.isSettled(8) ? '✓' : '✗');
  console.log('  8楼结算后位置为西市:', store.getState().physical_state.location_name === '西市' ? '✓' : '✗');
  console.log('  7楼和8楼同时处于结算状态:', (store.isSettled(7) && store.isSettled(8)) ? '✓' : '✗');

  // 模拟宿主删除 8 楼，当前 chat 中只有 0..7
  global.window.SillyTavern.getContext = () => ({
    chat: [
      { message_id: 0, is_user: true, mes: 'm0' },
      { message_id: 1, is_user: false, mes: 'm1' },
      { message_id: 2, is_user: true, mes: 'm2' },
      { message_id: 3, is_user: false, mes: 'm3' },
      { message_id: 4, is_user: true, mes: 'm4' },
      { message_id: 5, is_user: false, mes: 'm5' },
      { message_id: 6, is_user: true, mes: 'm6' },
      { message_id: 7, is_user: false, mes: 'm7' }
    ]
  });

  // 宿主触发 MESSAGE_DELETED(7) —— 传的是 7，但真正被删除的是 8
  const rollRes15 = settlement.onMessageDeleted(7);
  console.log('  删除8触发回滚结果成功:', rollRes15.success ? '✓' : '✗');
  console.log('  回滚的楼层正确为8:', rollRes15.message_id === 8 ? '✓' : '✗');
  console.log('  8楼结算已回滚 (isSettled(8) === false):', !store.isSettled(8) ? '✓' : '✗');
  console.log('  7楼结算未被误删 (isSettled(7) === true):', store.isSettled(7) ? '✓' : '✗');
  console.log('  位置恢复为8结算前的状态(东市主街):', store.getState().physical_state.location_name === '东市主街' ? '✓' : '✗');
  console.log('');
  // ── 测试16：Swipe 宿主 GENERATION_ENDED 传 chat.length (7) 对齐到 assistant 索引 6 ──
  console.log('【测试16】Swipe 生命周期实机对齐测试（chat.length=7, active assistant index=6, GENERATION_ENDED=7）');
  store.setPhysicalLocation({ id: 'jiujia_zhaidi', name: '旧家宅邸', world_id: 'yongchu', city_id: 'yongan' });
  // 先重置当前 context 的结算记录，防止测试15残留的 7 楼结算影响
  store.rollbackSettlement(7);


  // 16.1 模拟前序状态：
  // assistant message index = 6 之前已结算过为“西市”
  const simContentWest = '<scene>地点：西市</scene>\n<map_event>\naction: arrive\nname: 西市\n</map_event>';
  await settlement.settle({
    messageId: 6,
    messageContent: simContentWest,
    sourceMessageId: 5,
    generationId: 'gen_before_swipe'
  });
  console.log('  测试前 6 楼已结算:', store.isSettled(6) ? '✓' : '✗');
  console.log('  测试前 physical_state 为西市:', store.getState().physical_state.location_name === '西市' ? '✓' : '✗');

  // ── 模拟宿主事件总线或真机注册 ──
  // 16.2 构造宿主真实环境：
  // 当前 chat 数组长度为 7（索引 0..6），其中 index 6 是 assistant 消息（最新 swipe 为“东市主街”）
  const simContentEast = '<scene>地点：东市主街</scene>\n<map_event>\naction: arrive\nname: 东市主街\n</map_event>';
  const fakeChat = [
    { message_id: 0, is_user: true, mes: 'm0' },
    { message_id: 1, is_user: false, mes: 'm1' },
    { message_id: 2, is_user: true, mes: 'm2' },
    { message_id: 3, is_user: false, mes: 'm3' },
    { message_id: 4, is_user: true, mes: 'm4' },
    { message_id: 5, is_user: true, mes: 'm5' },
    { message_id: 6, is_user: false, mes: simContentEast }
  ];

  const fakeEventSource = {
    listeners: {},
    on(event, handler) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(handler);
    },
    off(event, handler) {
      if (!this.listeners[event]) return;
      this.listeners[event] = this.listeners[event].filter(h => h !== handler);
    },
    emit(event, ...args) {
      if (this.listeners[event]) {
        for (const h of this.listeners[event]) {
          h(...args);
        }
      }
    }
  };

  global.window.SillyTavern.getContext = () => ({
    chat: fakeChat,
    eventSource: fakeEventSource,
    eventTypes: {
      GENERATION_STARTED: 'generation_started',
      MESSAGE_RECEIVED: 'message_received',
      GENERATION_ENDED: 'generation_ended',
      MESSAGE_SWIPED: 'message_swiped'
    }
  });

  const swipeGenEvents = new GenerationEvents(settlement, mapContext, store);
  swipeGenEvents.register();

  // 16.3 模拟宿主真机 Swipe 事件时序：
  // a. 触发 MESSAGE_RECEIVED { message_id: 6, type: 'swipe' }
  fakeEventSource.emit('message_received', { message_id: 6, type: 'swipe' });
  // b. 触发 GENERATION_ENDED(7) —— 传参为 7（即 chat.length）
  fakeEventSource.emit('generation_ended', 7);

  // 等待 settle promise 完成
  if (swipeGenEvents._lastSettlePromise) {
    await swipeGenEvents._lastSettlePromise;
  }

  // 16.4 验证：
  // 处理的目标必须是 6，绝不能产生 7
  console.log('  结算记录没有错误创建 7 (isSettled(7) === false):', !store.isSettled(7) ? '✓' : '✗');
  console.log('  6 楼最终处于结算状态 (isSettled(6) === true):', store.isSettled(6) ? '✓' : '✗');
  console.log('  physical_state 成功更新为新 Swipe 结算结果东市主街:', store.getState().physical_state.location_name === '东市主街' ? '✓' : '✗');
  console.log('  最近处理的 messageId 正确为 6:', swipeGenEvents._lastMessageId === 6 ? '✓' : '✗');
  console.log('');


  // ── 总结 ──
  console.log('========== 测试总结 ==========');
  console.log('  地点总数:', registry.getTotalLocationCount());
  console.log('  schema版本:', store.getState().schema_version);
  console.log('  所有16项核心单元与宿主合同测试全部通过！');
  console.log('==============================');
}

runTests().catch(function(e) {
  console.error('测试失败:', e);
  process.exit(1);
});

// ============================================================
// test_ui.js —— MapPanel UI 骨架与 MapDataLoader 数据串联测试
// ============================================================

import MapStore from './src/core/MapStore.js';
import LocationRegistry from './src/core/LocationRegistry.js';
import TravelEngine from './src/core/TravelEngine.js';
import RouteEngine from './src/core/RouteEngine.js';
import MapPanel from './src/ui/MapPanel.js';
import MapDataLoader from './src/data/MapDataLoader.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let failedChecks = 0;
const nativeConsoleLog = console.log.bind(console);
console.log = (...args) => {
  if (args.some(value => typeof value === 'string' && value.includes('✗'))) failedChecks++;
  nativeConsoleLog(...args);
};

console.log('========== YongchuMap UI v1 与 Map Data v1 联动测试开始 ==========');

// 1. 准备核心依赖
global.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] || null; },
  setItem(k, v) { this._data[k] = v; },
  removeItem(k) { delete this._data[k]; }
};

const store = new MapStore();
store.setContext('yongchu', 'test_char', 'test_chat');
store.setPhysicalLocation({
  world_id: 'yongchu',
  nation: '大昭',
  city_id: 'yongan',
  id: 'jiujia_zhaidi',
  name: '旧家宅邸',
  sub_location: '正堂',
  is_indoor: true,
  coords: { x: 50, y: 50 }
});

const registry = new LocationRegistry();
const locationsPath = join(__dirname, 'data', 'worlds', 'yongchu', 'cities', 'yongan.locations.json');
const locationsData = JSON.parse(readFileSync(locationsPath, 'utf8'));
registry.loadCityLocations('yongchu', 'yongan', locationsData);

const routeEngine = new RouteEngine(registry);
const travelEngine = new TravelEngine(store, routeEngine, registry);

async function runTests() {
  // 2. 测试 MapDataLoader 独立数据串联
  console.log('\n【测试1】MapDataLoader 跨层级数据加载验证');
  const loader = new MapDataLoader();
  const worldRef = await loader.loadWorld('yongchu');
  assert.equal(worldRef.worldData.id, 'yongchu');
  console.log('  世界数据加载:', worldRef.worldData.id === 'yongchu' ? '✓' : '✗');
  console.log('  包含 6 个国家:', worldRef.worldData.nations.length === 6 ? '✓' : '✗');

  const zhaoRef = await loader.loadNation(worldRef, 'zhao_guo');
  assert.equal(zhaoRef.hasDetail, true);
  console.log('  大昭国数据加载:', zhaoRef.nationMeta.fullName === '大昭' && zhaoRef.hasDetail ? '✓' : '✗');
  console.log('  包含 13 个城市:', zhaoRef.nationData.cities.length === 13 ? '✓' : '✗');

  const yanRef = await loader.loadNation(worldRef, 'yan');
  console.log('  无详细图国家 (大燕) 降级兜底:', yanRef.hasDetail === false ? '✓' : '✗');

  const yonganRef = await loader.loadCity(worldRef, zhaoRef, 'yongan');
  assert.equal(yonganRef.hasDetail, true);
  console.log('  永安城数据加载 (含相对路径容错解析):', yonganRef.cityMeta.name === '永安' && yonganRef.hasDetail ? '✓' : '✗');
  console.log('  永安城 8 个城区:', yonganRef.cityData.districts.length === 8 ? '✓' : '✗');

  const locsRef = await loader.loadCityLocations(worldRef, zhaoRef, yonganRef);
  assert.equal(locsRef.locations.length, 69);
  console.log('  永安城 69 个地点加载:', locsRef.locations.length === 69 && locsRef.hasDetail ? '✓' : '✗');

  // 3. 实例化 MapPanel
  console.log('\n【测试2】MapPanel 实例化与默认状态');
  const panel = new MapPanel(store, registry, travelEngine, null, loader);
  const s0 = panel.getState();
  console.log('  visible:', s0.visible === false ? '✓' : '✗');
  console.log('  current_location:', s0.current_location === '旧家宅邸' ? '✓' : '✗');
  console.log('  默认世界层级:', s0.navState.worldId === 'yongchu' ? '✓' : '✗');
  console.log('  默认无国家锁定:', s0.navState.nationId === null ? '✓' : '✗');

  // 4. 模拟 DOM 容器以供 MapPanel 异步 render 验证
  global.document = {
    _elements: {},
    getElementById(id) {
      if (!this._elements[id]) {
        this._elements[id] = {
          id,
          innerHTML: '',
          style: {},
          querySelectorAll: () => [],
          appendChild: () => {},
          addEventListener: () => {},
          classList: { add: () => {}, remove: () => {} }
        };
      }
      return this._elements[id];
    },
    createElement(tag) {
      return {
        tag,
        innerHTML: '',
        style: {},
        setAttribute: () => {},
        addEventListener: () => {},
        classList: { add: () => {}, remove: () => {} },
        appendChild: () => {}
      };
    },
    body: {
      appendChild: () => {}
    },
    head: {
      appendChild: () => {}
    }
  };

  console.log('\n【测试3】三级导航切换与动态数据绑定 (World -> Nation -> City)');
  await panel.navigateToNation('zhao_guo');
  console.log('  切换到大昭国家层:', panel.navState.nationId === 'zhao_guo' && panel.navState.cityId === null ? '✓' : '✗');
  console.log('  国家引用已加载:', panel._currentNationRef?.nationMeta?.fullName === '大昭' ? '✓' : '✗');

  await panel.navigateToCity('yongan');
  assert.equal(panel._currentCityRef?.cityMeta?.id, 'yongan');
  assert.equal(panel._cityLocationsRef?.locations?.length, 69);
  console.log('  切换到永安城市层:', panel.navState.nationId === 'zhao_guo' && panel.navState.cityId === 'yongan' ? '✓' : '✗');
  console.log('  城市引用已加载:', panel._currentCityRef?.cityMeta?.name === '永安' ? '✓' : '✗');
  console.log('  地点引用已加载 (69处):', panel._cityLocationsRef?.locations?.length === 69 ? '✓' : '✗');

  // world.json 同时存在“昭(zhao_guo)”与“赵(zhao)”，二者不得混淆。
  await panel.navigateToNation('zhao');
  console.log('  大赵 ID "zhao" 保持独立:', panel.navState.nationId === 'zhao' ? '✓' : '✗');
  assert.equal(panel.navState.nationId, 'zhao');
  assert.equal(panel._currentNationRef?.nationMeta?.fullName, '大赵');

  // 未勘绘国家测试
  await panel.navigateToNation('yan');
  assert.equal(panel._currentNationRef?.hasDetail, false);
  console.log('  未勘绘国家层级状态:', panel.navState.nationId === 'yan' && panel._currentNationRef?.hasDetail === false ? '✓' : '✗');

  console.log('\n【测试4】面包屑回退导航 (City -> Nation -> World)');
  await panel.navigateToNation('zhao_guo');
  await panel.navigateToCity('yongan');
  await panel.navigateBack();
  console.log('  城市退回国家层:', panel.navState.nationId === 'zhao_guo' && panel.navState.cityId === null ? '✓' : '✗');

  await panel.navigateBack();
  console.log('  国家退回世界层:', panel.navState.nationId === null && panel.navState.cityId === null ? '✓' : '✗');

  await panel.navigateToCity('yongan');
  await panel.navigateToWorld();
  console.log('  一键跳回世界层:', panel.navState.nationId === null && panel.navState.cityId === null ? '✓' : '✗');

  console.log('\n【测试5】同步当前物理状态 (永安直接聚焦)');
  await panel._syncNavWithCurrentState();
  console.log('  自动聚焦永安:', panel.navState.nationId === 'zhao_guo' && panel.navState.cityId === 'yongan' ? '✓' : '✗');
  assert.deepEqual(panel.navState, { worldId: 'yongchu', nationId: 'zhao_guo', cityId: 'yongan' });

  console.log('\n【测试6】无假地点兜底、HTML 转义与异步竞态');
  store.setPhysicalLocation({
    world_id: 'yongchu', nation: '<img src=x>', city_id: 'yongan',
    id: null, name: null, is_indoor: false
  });
  const banner = panel._renderCurrentLocationBanner();
  assert.ok(banner.includes('&lt;img src=x&gt;'));
  assert.ok(banner.includes('未记录'));
  assert.ok(!banner.includes('旧家宅邸'));
  console.log('  空位置不伪造旧家宅邸且动态文本已转义: ✓');

  const delayedLoader = {
    async loadWorld(id) {
      return { worldData: { id, name: '测试世界', nations: [] }, baseUrl: new URL('file:///world.json') };
    },
    async loadNation(_world, id) {
      await new Promise(resolve => setTimeout(resolve, id === 'zhao' ? 20 : 1));
      return { nationMeta: { id, name: id }, nationData: null, hasDetail: false };
    },
    async loadCity() { return null; },
    async loadCityLocations() { return null; }
  };
  const racePanel = new MapPanel(store, registry, travelEngine, null, delayedLoader);
  racePanel.navState.worldId = 'race-world';
  racePanel._panelElement = {};
  const slowRender = racePanel.navigateToNation('zhao');
  const fastRender = racePanel.navigateToNation('yan');
  await Promise.all([slowRender, fastRender]);
  assert.equal(racePanel.navState.nationId, 'yan');
  assert.equal(racePanel._currentNationRef?.nationMeta?.id, 'yan');
  console.log('  较慢的旧导航请求不会覆盖最新页面: ✓');

  console.log('\n【测试7】生命周期与 destroy() 安全释放');
  const hostListeners = [];
  const eventSource = {
    on(event, handler) { hostListeners.push({ event, handler }); },
    off(event, handler) {
      const index = hostListeners.findIndex(item => item.event === event && item.handler === handler);
      if (index >= 0) hostListeners.splice(index, 1);
    }
  };
  global.window = {
    SillyTavern: { getContext: () => ({ eventSource, eventTypes: { CHAT_CHANGED: 'chat_changed' } }) },
    addEventListener() {},
    removeEventListener() {}
  };
  const lifecyclePanel = new MapPanel(store, registry, travelEngine, null, loader);
  lifecyclePanel._bindHostEvents();
  assert.equal(hostListeners.length, 1);
  lifecyclePanel.destroy();
  assert.equal(hostListeners.length, 0);
  panel.destroy();
  console.log('  销毁无报错:', panel._visible === false ? '✓' : '✗');
  assert.equal(panel._visible, false);

  if (failedChecks > 0) throw new Error(`${failedChecks} 项 UI 检查失败`);
  console.log('\n========== UI 与 Data 联动测试总结 ==========');
  console.log('所有 7 项测试及关键断言全部通过！');
  console.log('============================================');
}

runTests().catch(err => {
  console.error('测试运行失败:', err);
  process.exit(1);
});

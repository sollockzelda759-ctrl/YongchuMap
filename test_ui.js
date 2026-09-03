// ============================================================
// test_ui.js —— MapPanel UI 骨架与 MapDataLoader 数据串联测试
// ============================================================

import MapStore from './src/core/MapStore.js';
import LocationRegistry from './src/core/LocationRegistry.js';
import TravelEngine from './src/core/TravelEngine.js';
import RouteEngine from './src/core/RouteEngine.js';
import MapPanel from './src/ui/MapPanel.js';
import MapDataLoader from './src/data/MapDataLoader.js';
import YonganCityMapRenderer from './src/ui/YonganCityMapRenderer.js';
import StrategicMapRenderer from './src/ui/StrategicMapRenderer.js';

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

console.log('========== YongchuMap UI v2 与 Map Data v1 联动测试开始 ==========');

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
  assert.equal(locsRef.locations.length, locsRef.meta.total_locations);
  assert.equal(new Set(locsRef.locations.map(loc => loc.id)).size, locsRef.locations.length);
  assert.ok(locsRef.locations.every(loc => Number.isFinite(loc.x) && Number.isFinite(loc.y)));
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


  console.log('\n【测试8】YonganCityMapRenderer 视口与坐标系统渲染');
  const cityRef = yonganRef;
  const locRef = locsRef;

  const mockContainer = {
    innerHTML: '',
    appendChild() {},
    querySelector() { return null; }
  };

  // 构造简易 mock DOM 环境支持 renderer 内部 createElement / appendChild
  const renderer = new YonganCityMapRenderer({
    container: mockContainer,
    cityData: cityRef.cityData,
    locations: locRef.locations,
    currentLocationId: 'changle_xiang'
  });

  // 验证坐标映射
  const changLeXiang = locRef.locations.find(l => l.id === 'changle_xiang');
  const coords = renderer.locationToCanvasCoords(changLeXiang);
  assert.ok(coords.x > 0 && coords.x < renderer.worldWidth, 'X坐标应处于实际画布内');
  assert.ok(coords.y > 0 && coords.y < renderer.worldHeight, 'Y坐标应处于实际画布内');
  assert.equal(renderer.scaleX, renderer.scaleY, '12×10布局单位应等比');
  console.log('  长乐巷坐标映射正确:', coords, '✓');

  // 西郊同样使用当前数据字段，不硬编码伪造坐标。
  const westSuburbLoc = locRef.locations.find(l => l.district_id === 'west_suburb');
  if (westSuburbLoc) {
    const westCoords = renderer.locationToCanvasCoords(westSuburbLoc);
    assert.equal(westCoords.x, Math.round(renderer.originX + westSuburbLoc.x * renderer.scaleX));
    assert.equal(westCoords.y, Math.round(renderer.originY + (10 - westSuburbLoc.y) * renderer.scaleY));
    console.log('  西郊使用数据驱动布局坐标: ✓');
  }

  const provenanceProbe = { ...changLeXiang, legacy_reference: { grid_x: -999, grid_y: -999 } };
  assert.deepEqual(renderer.locationToCanvasCoords(provenanceProbe), coords, 'legacy_reference 不得覆盖当前布局字段');
  assert.equal(renderer.locationToCanvasCoords({ id: 'missing-layout' }), null, '缺坐标时不得伪造 (0,0) 标记');

  // 验证 8 大城区边界
  assert.equal(Object.keys(renderer.districtBounds).length, 8);
  assert.deepEqual(
    cityRef.cityData.districts.map(d => [d.id, d.name]),
    [
      ['city_center', '城中心'], ['city_east', '城东'], ['city_south', '城南'], ['city_west', '城西'],
      ['luoshui_north', '洛水北岸'], ['luoshui_south', '洛水南岸'], ['jinshui_junction', '金水合流角'], ['west_suburb', '城外西郊']
    ]
  );
  console.log('  8 大主城区几何边界完整映射: ✓');

  const background = renderer._generateBackgroundSvg();
  ['北定门', '长乐门', '宣武门', '洛水大桥', '东渡渡口', '西渡渡口'].forEach(name => {
    assert.ok(!background.includes(name), `不得渲染未在正式数据定名的 ${name}`);
  });

  const rendererSource = readFileSync(join(__dirname, 'src', 'ui', 'YonganCityMapRenderer.js'), 'utf8');
  assert.ok(!rendererSource.includes('item.innerHTML ='), '索引动态数据不得直接写 innerHTML');
  assert.ok(!rendererSource.includes('card.innerHTML ='), '详情动态数据不得直接写 innerHTML');
  assert.ok(!rendererSource.includes('1 里'), '非精确测绘画布不得显示误导性固定比例尺');
  const cssSource = readFileSync(join(__dirname, 'src', 'ui', 'MapPanel.css'), 'utf8');
  assert.equal((cssSource.match(/{/g) || []).length, (cssSource.match(/}/g) || []).length, 'CSS 规则大括号必须平衡');

  let resetCalled = false;
  let bindCalled = false;
  const initRenderer = new YonganCityMapRenderer({ container: mockContainer, cityData: cityRef.cityData, locations: [] });
  initRenderer._renderDrawer = () => {};
  initRenderer.resetView = () => { resetCalled = true; };
  initRenderer._bindEvents = () => { bindCalled = true; };
  initRenderer.init();
  assert.ok(resetCalled && bindCalled, '真实 init() 必须初始化视角并绑定交互');

  // 验证缩放与聚焦接口
  renderer.focusLocation('changle_xiang');
  assert.ok(renderer.zoom >= 1.4);
  console.log('  聚焦地点缩放正常: ✓');

  renderer.resetView();
  assert.equal(renderer.zoom, 1.0);
  console.log('  重置视图恢复 zoom=1.0: ✓');

  renderer.destroy();
  console.log('  CityMapRenderer 安全销毁: ✓');

  console.log('\n【测试9】Map Visual v2 世界/国家舆图与选中反馈');
  class FakeElement {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.attributes = {};
      this.listeners = {};
      this.style = { setProperty: (key, value) => { this.style[key] = value; } };
      this.className = '';
      this.textContent = '';
      this._innerHTML = '';
      this.classList = {
        add: (...names) => {
          const all = new Set(this.className.split(/\s+/).filter(Boolean));
          names.forEach(name => all.add(name));
          this.className = [...all].join(' ');
        },
        remove: (...names) => {
          const remove = new Set(names);
          this.className = this.className.split(/\s+/).filter(name => name && !remove.has(name)).join(' ');
        },
        toggle: (name, force) => {
          const all = new Set(this.className.split(/\s+/).filter(Boolean));
          const enabled = force === undefined ? !all.has(name) : !!force;
          if (enabled) all.add(name); else all.delete(name);
          this.className = [...all].join(' ');
          return enabled;
        },
        contains: name => this.className.split(/\s+/).includes(name)
      };
    }
    set innerHTML(value) { this._innerHTML = String(value); if (value === '') this.children = []; }
    get innerHTML() { return this._innerHTML; }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    removeEventListener(type) { delete this.listeners[type]; }
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
      const results = [];
      const matches = node => {
        if (selector.startsWith('.')) return node.className.split(/\s+/).includes(selector.slice(1));
        if (selector.startsWith('#')) return node.id === selector.slice(1);
        const attr = selector.match(/^\[([^=\]]+)(?:="?([^"\]]+)"?)?\]$/);
        if (attr) return Object.hasOwn(node.attributes, attr[1]) && (attr[2] === undefined || node.attributes[attr[1]] === attr[2]);
        return node.tag === selector;
      };
      const walk = node => node.children.forEach(child => {
        if (matches(child)) results.push(child);
        walk(child);
      });
      walk(this);
      return results;
    }
    getBoundingClientRect() { return { left: 0, top: 0, width: 700, height: 500 }; }
  }
  const visualDocument = {
    createElement: tag => new FakeElement(tag),
    createElementNS: (_namespace, tag) => new FakeElement(tag)
  };
  global.document = visualDocument;

  const worldMount = new FakeElement('div');
  const worldRenderer = new StrategicMapRenderer({ container: worldMount, mode: 'world', worldData: worldRef.worldData });
  worldRenderer.init();
  const stateGlyphs = worldMount.querySelectorAll('.ycm-state-glyph').map(node => node.textContent);
  assert.deepEqual(stateGlyphs, ['昭', '燕', '赵', '楚', '梁', '陈']);
  assert.equal(worldMount.querySelectorAll('[data-nation-id]').length, 6);
  assert.ok(!worldMount.querySelector('.ycm-strategic-surface').querySelectorAll('.ycm-state-glyph').some(node => node.textContent.startsWith('大')));
  console.log('  世界地图六国仅渲染单字国号且六区可交互: ✓');

  const nationMount = new FakeElement('div');
  const nationRenderer = new StrategicMapRenderer({ container: nationMount, mode: 'nation', nationData: zhaoRef.nationData });
  nationRenderer.init();
  assert.equal(nationMount.querySelectorAll('[data-city-id]').length, 13);
  assert.equal(nationMount.querySelectorAll('.ycm-nation-city-name').length, 13);
  assert.ok(!nationMount.querySelector('.ycm-strategic-surface').querySelectorAll('.ycm-terrain-label').some(node => node.textContent === '昭'));
  console.log('  昭国地图从正式数据渲染 13 城且无地形中央巨型国号: ✓');

  const cityMount = new FakeElement('div');
  const selectionRenderer = new YonganCityMapRenderer({
    container: cityMount,
    cityData: cityRef.cityData,
    locations: locRef.locations,
    currentLocationId: 'jiujia_zhaidi'
  });
  selectionRenderer._renderDrawer = () => {};
  selectionRenderer.init();
  selectionRenderer.focusLocation('changle_xiang');
  const selectedMarker = cityMount.querySelectorAll('.ycm-map-marker').find(node => node.getAttribute('data-loc-id') === 'changle_xiang');
  const currentMarker = cityMount.querySelectorAll('.ycm-map-marker').find(node => node.getAttribute('data-loc-id') === 'jiujia_zhaidi');
  assert.ok(selectedMarker.classList.contains('is-selected'));
  assert.ok(!currentMarker.classList.contains('is-selected'));
  assert.ok(currentMarker.classList.contains('is-current-pos'));
  assert.equal(selectionRenderer._selectedLocId, 'changle_xiang');
  console.log('  选中地点蓝金高亮与红色当前位置保持独立: ✓');

  const controlsEl = cityMount.querySelector('.ycm-map-controls');
  assert.ok(controlsEl.innerHTML.includes('data-act="zoom-in"'));
  assert.ok(controlsEl.innerHTML.includes('data-act="zoom-out"'));
  assert.ok(controlsEl.innerHTML.includes('data-act="reset"'));
  let invoked = [];
  selectionRenderer.zoomIn = () => invoked.push('zoom-in');
  selectionRenderer.zoomOut = () => invoked.push('zoom-out');
  selectionRenderer.resetView = () => invoked.push('reset');
  ['zoom-in', 'zoom-out', 'reset'].forEach(action => {
    controlsEl.listeners.click({ target: { closest: () => ({ getAttribute: () => action }) } });
  });
  assert.deepEqual(invoked, ['zoom-in', 'zoom-out', 'reset']);
  assert.ok(cssSource.includes('.ycm-map-controls') && cssSource.includes('flex-direction: row'));
  console.log('  +、−、重置三控件完整存在、横排可见且全部绑定: ✓');
  selectionRenderer.destroy();

  console.log('\n【测试10】独立可拖拽浮动按钮生命周期与防误触');
  let storageState = {};
  global.localStorage = {
    getItem(k) { return storageState[k] || null; },
    setItem(k, v) { storageState[k] = String(v); },
    removeItem(k) { delete storageState[k]; }
  };

  const floatPanel = new MapPanel(store, registry, travelEngine, null, loader);
  let currentFloatBtn = null;
  const floatDoc = {
    getElementById(id) {
      if (id === 'yongchu-map-floating-btn') return currentFloatBtn;
      return null;
    },
    createElement(tag) {
      const el = {
        tag,
        id: '',
        className: '',
        style: {},
        innerHTML: '',
        listeners: {},
        setAttribute(k, v) { el[k] = v; },
        classList: { add() {}, remove() {} },
        addEventListener(evt, fn) { el.listeners[evt] = fn; },
        removeEventListener(evt, fn) { delete el.listeners[evt]; },
        remove() { currentFloatBtn = null; },
        getBoundingClientRect() {
          return { left: parseFloat(el.style.left) || 20, top: parseFloat(el.style.top) || 160, width: 88, height: 36 };
        }
      };
      return el;
    },
    body: {
      appendChild(node) {
        if (node.id === 'yongchu-map-floating-btn') currentFloatBtn = node;
      }
    },
    querySelector() { return null; }
  };

  global.window.innerWidth = 300;
  global.window.innerHeight = 200;
  storageState.yongchu_map_btn_pos_v1 = JSON.stringify({ left: 9999, top: 9999 });

  floatPanel._getDoc = () => floatDoc;

  // 确保生成浮动按钮
  floatPanel._ensureFloatingButton();
  const floatBtn = floatDoc.getElementById('yongchu-map-floating-btn');
  assert.ok(floatBtn, '浮动按钮已创建并挂载');
  assert.ok(parseFloat(floatBtn.style.left) <= 212 && parseFloat(floatBtn.style.top) <= 156, '恢复的位置必须被夹在当前视口内');
  floatPanel._ensureFloatingButton();
  assert.equal(floatDoc.getElementById('yongchu-map-floating-btn'), floatBtn, '重复 ensure 不得创建第二个浮动按钮');
  console.log('  浮动按钮挂载成功: ✓');

  // 模拟点击 (未移动)
  let toggleCalled = false;
  floatPanel.toggle = () => { toggleCalled = true; };
  floatBtn.listeners['pointerdown']({ clientX: 100, clientY: 100, stopPropagation() {} });
  floatBtn.listeners['pointerup']({ clientX: 100, clientY: 100 });
  assert.ok(toggleCalled, '原地轻点应触发 toggle() 开启/关闭面板');
  console.log('  原地点击正确触发面板切换: ✓');

  toggleCalled = false;
  floatBtn.listeners['pointerdown']({ clientX: 100, clientY: 100, stopPropagation() {} });
  floatBtn.listeners['pointercancel']({});
  assert.equal(toggleCalled, false, 'pointercancel 不得误触发点击');

  floatBtn.listeners.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(toggleCalled, true, '键盘 Enter 应能打开浮动按钮');

  // 模拟拖拽移动超过阈值并持久化
  toggleCalled = false;
  floatBtn.listeners['pointerdown']({ clientX: 100, clientY: 100, stopPropagation() {} });
  floatBtn.listeners['pointermove']({ clientX: 160, clientY: 220 });
  floatBtn.listeners['pointerup']({ clientX: 160, clientY: 220 });
  assert.equal(toggleCalled, false, '拖动后 pointerup 不应触发 toggle');
  assert.ok(storageState['yongchu_map_btn_pos_v1'], '拖拽后位置已持久化');
  console.log('  拖拽与点击防误触区分且位置持久化成功: ✓');

  floatPanel.destroy();
  assert.equal(floatDoc.getElementById('yongchu-map-floating-btn'), null);
  console.log('  面板销毁时浮动按钮一并安全清理: ✓');

  if (failedChecks > 0) throw new Error(`${failedChecks} 项 UI 检查失败`);
  console.log('\n========== UI 与 Data 联动测试总结 ==========');
  console.log('所有 10 项测试及关键断言全部通过！');
  console.log('============================================');
}

runTests().catch(err => {
  console.error('测试运行失败:', err);
  process.exit(1);
});

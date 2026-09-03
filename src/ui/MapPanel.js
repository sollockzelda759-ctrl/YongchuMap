// ============================================================
// MapPanel.js —— 地图UI面板 (ESM, UI v1)
// 职责：DOM挂载、三级导航(世界/国家/城市)、地点卡片渲染与实时定位
// 严禁接管：MapStore, travel, settlement, rollback, map_event
// ============================================================

import MapDataLoader from '../data/MapDataLoader.js';
import YonganCityMapRenderer from './YonganCityMapRenderer.js';


const UI_BTN_ID = 'yongchu-map-toggle-btn';
const UI_FLOAT_BTN_ID = 'yongchu-map-floating-btn';
const STORAGE_BTN_POS_KEY = 'yongchu_map_btn_pos_v1';

const UI_MODAL_ID = 'yongchu-map-modal';
const UI_STYLE_ID = 'yongchu-map-styles';

export default class MapPanel {
  constructor(mapStore, locationRegistry, travelEngine, mapInstance, dataLoader) {
    this.store = mapStore;
    this.registry = locationRegistry;
    this.travel = travelEngine;
    this.mapInstance = mapInstance || null;
    this.loader = dataLoader || new MapDataLoader();

    this._panelElement = null;
    this._btnElement = null;
    this._floatingBtnElement = null;
    this._cityMapRenderer = null;
    this._floatDragCleanup = null;

    this._styleElement = null;
    this._visible = false;
    this._chatChangedHandler = null;
    this._hostEventBinding = null;
    this._reensureTimer = null;
    this._destroyed = false;
    this._renderGeneration = 0;

    const initialState = this.store ? this.store.getState() : null;
    const configuredWorldId = this.mapInstance?.getActiveWorldPack?.()?.id ||
                              this.mapInstance?.activeWorldPackId || null;

    this.navState = {
      worldId: initialState?.physical_state?.world_id || configuredWorldId,
      nationId: null,
      cityId: null
    };

    // 动态加载的数据缓存引用
    this._currentWorldRef = null;
    this._currentNationRef = null;
    this._currentCityRef = null;
    this._cityLocationsRef = null;
    this._isLoading = false;
    this._loadError = null;

    this._boundKeyDown = this._onKeyDown.bind(this);
  }

  setMapInstance(instance) {
    this.mapInstance = instance;
  }

  setDataLoader(loader) {
    this.loader = loader;
  }

  init() {
    if (typeof document === 'undefined') {
      return { success: true, note: '无DOM环境，跳过UI挂载' };
    }
    this._injectStyles();
    this._ensureButton();
    this._ensureFloatingButton();
    this._ensurePanel();
    this._bindHostEvents();
    console.log('[YongchuMap] MapPanel UI v1 骨架初始化完成');
    return { success: true };
  }

  _injectStyles() {
    const doc = this._getDoc();
    if (!doc || doc.getElementById(UI_STYLE_ID)) return;
    const link = doc.createElement('link');
    link.id = UI_STYLE_ID;
    link.rel = 'stylesheet';
    link.href = new URL('./MapPanel.css', import.meta.url).href;
    doc.head.appendChild(link);
    this._styleElement = link;
  }

  _ensureButton() {
    const doc = this._getDoc();
    if (!doc || doc.getElementById(UI_BTN_ID)) {
      if (doc) this._btnElement = doc.getElementById(UI_BTN_ID);
      return;
    }
    const btn = doc.createElement('button');
    btn.id = UI_BTN_ID;
    btn.className = 'ycm-btn-map-entry';
    btn.type = 'button';
    btn.setAttribute('title', '打开地舆图');
    btn.innerHTML = '<span>🗺️</span><span>地图</span>';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._toggleFromUi();
    });

    const wandTarget = doc.querySelector('#extensionsMenu') || doc.querySelector('.extensionsMenu');
    const topSettings = doc.querySelector('#top-settings') || doc.querySelector('#navbar');

    if (wandTarget) {
      btn.classList.remove('floating-fallback');
      wandTarget.appendChild(btn);
    } else if (topSettings) {
      btn.classList.remove('floating-fallback');
      topSettings.appendChild(btn);
    } else {
      btn.classList.add('floating-fallback');
      doc.body.appendChild(btn);
    }
    this._btnElement = btn;
  }

  _ensureFloatingButton() {
    const doc = this._getDoc();
    if (!doc) return;

    if (doc.getElementById(UI_FLOAT_BTN_ID)) {
      this._floatingBtnElement = doc.getElementById(UI_FLOAT_BTN_ID);
      return;
    }

    const btn = doc.createElement('div');
    btn.id = UI_FLOAT_BTN_ID;
    btn.className = 'ycm-floating-btn';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('title', '打开永初地舆图 (可自由拖拽)');
    btn.innerHTML = '<span class="ycm-floating-icon">🗺️</span><span class="ycm-floating-text">地舆图</span>';

    // 读取持久化保存的位置 (从 localStorage)
    let savedPos = null;
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_BTN_POS_KEY);
        if (raw) savedPos = JSON.parse(raw);
      }
    } catch (_) {}

    const defaultRight = 20;
    const defaultBottom = 160;

    if (savedPos && typeof savedPos.left === 'number' && typeof savedPos.top === 'number') {
      btn.style.left = `${savedPos.left}px`;
      btn.style.top = `${savedPos.top}px`;
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';
    } else {
      btn.style.right = `${defaultRight}px`;
      btn.style.bottom = `${defaultBottom}px`;
    }

    doc.body.appendChild(btn);
    this._floatingBtnElement = btn;
    if (savedPos) this._clampFloatingButtonPosition(btn);

    // 绑定拖拽与点击防误判逻辑
    this._bindFloatingButtonEvents(btn);
  }

  _bindFloatingButtonEvents(btn) {
    let isDragging = false;
    let dragMoved = false;
    let startPointerX = 0;
    let startPointerY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const onPointerDown = (e) => {
      e.stopPropagation();
      isDragging = true;
      dragMoved = false;
      startPointerX = e.clientX;
      startPointerY = e.clientY;

      const rect = btn.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      // 切换为 left/top 定位
      btn.style.left = `${initialLeft}px`;
      btn.style.top = `${initialTop}px`;
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';

      if (typeof btn.setPointerCapture === 'function') {
        try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      }
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startPointerX;
      const dy = e.clientY - startPointerY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        dragMoved = true;
      }

      let curLeft = initialLeft + dx;
      let curTop = initialTop + dy;

      // 边界限制，防止拖出屏幕可视区域
      const view = btn.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
      const winW = view?.innerWidth || 1200;
      const winH = view?.innerHeight || 800;
      const btnW = btn.offsetWidth || 80;
      const btnH = btn.offsetHeight || 36;

      curLeft = Math.max(8, Math.min(winW - btnW - 8, curLeft));
      curTop = Math.max(8, Math.min(winH - btnH - 8, curTop));

      btn.style.left = `${curLeft}px`;
      btn.style.top = `${curTop}px`;
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      if (typeof btn.releasePointerCapture === 'function') {
        try { btn.releasePointerCapture(e.pointerId); } catch (_) {}
      }

      if (dragMoved) {
        // 保存新位置至 localStorage
        try {
          if (typeof localStorage !== 'undefined') {
            const rect = btn.getBoundingClientRect();
            localStorage.setItem(STORAGE_BTN_POS_KEY, JSON.stringify({
              left: Math.round(rect.left),
              top: Math.round(rect.top)
            }));
          }
        } catch (_) {}
      } else {
        // 未显著移动，判定为点击
        this._toggleFromUi();
      }
    };

    const onPointerCancel = (e) => {
      if (!isDragging) return;
      isDragging = false;
      if (typeof btn.releasePointerCapture === 'function') {
        try { btn.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };

    const onKeyDown = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      this._toggleFromUi();
    };

    const view = btn.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
    const onResize = () => this._clampFloatingButtonPosition(btn);

    btn.addEventListener('pointerdown', onPointerDown);
    btn.addEventListener('pointermove', onPointerMove);
    btn.addEventListener('pointerup', onPointerUp);
    btn.addEventListener('pointercancel', onPointerCancel);
    btn.addEventListener('keydown', onKeyDown);
    if (view?.addEventListener) view.addEventListener('resize', onResize);

    this._floatDragCleanup = () => {
      btn.removeEventListener('pointerdown', onPointerDown);
      btn.removeEventListener('pointermove', onPointerMove);
      btn.removeEventListener('pointerup', onPointerUp);
      btn.removeEventListener('pointercancel', onPointerCancel);
      btn.removeEventListener('keydown', onKeyDown);
      if (view?.removeEventListener) view.removeEventListener('resize', onResize);
    };
  }

  _clampFloatingButtonPosition(btn) {
    if (!btn || !btn.style || !btn.style.left) return;
    const view = btn.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
    const winW = view?.innerWidth || 1200;
    const winH = view?.innerHeight || 800;
    const btnW = btn.offsetWidth || btn.getBoundingClientRect?.().width || 80;
    const btnH = btn.offsetHeight || btn.getBoundingClientRect?.().height || 36;
    const left = Number.parseFloat(btn.style.left);
    const top = Number.parseFloat(btn.style.top);
    btn.style.left = `${Math.max(8, Math.min(Math.max(8, winW - btnW - 8), Number.isFinite(left) ? left : 8))}px`;
    btn.style.top = `${Math.max(8, Math.min(Math.max(8, winH - btnH - 8), Number.isFinite(top) ? top : 8))}px`;
  }

  _toggleFromUi() {
    try {
      const result = this.toggle();
      if (result && typeof result.catch === 'function') {
        result.catch(err => console.error('[YongchuMap] 打开地图失败:', err));
      }
    } catch (err) {
      console.error('[YongchuMap] 打开地图失败:', err);
    }
  }

  _ensurePanel() {
    const doc = this._getDoc();
    if (!doc) return;
    let modal = doc.getElementById(UI_MODAL_ID);
    if (!modal) {
      modal = doc.createElement('div');
      modal.id = UI_MODAL_ID;
      modal.innerHTML = `
        <div class="ycm-container" role="dialog" aria-modal="true" aria-label="地舆图">
          <div class="ycm-corner ycm-corner-tl"></div>
          <div class="ycm-corner ycm-corner-tr"></div>
          <div class="ycm-corner ycm-corner-bl"></div>
          <div class="ycm-corner ycm-corner-br"></div>
          <div class="ycm-header">
            <div class="ycm-header-left">
              <div class="ycm-title-badge"><span>🗺️</span><span>地舆图</span></div>
              <div class="ycm-breadcrumb" id="ycm-breadcrumb-container"></div>
            </div>
            <div class="ycm-header-right">
              <button type="button" class="ycm-btn-back" id="ycm-btn-back" style="display:none;">← 返回上级</button>
              <button type="button" class="ycm-btn-close" id="ycm-btn-close" title="关闭 (Esc)">✕</button>
            </div>
          </div>
          <div class="ycm-body" id="ycm-body-content"></div>
          <div class="ycm-footer">
            <span class="ycm-footer-tag">YongchuMap · 架构封板核心驱动</span>
            <span id="ycm-footer-version">v0.1.2 独立扩展架构</span>
          </div>
        </div>
      `;
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.hide();
      });
      doc.body.appendChild(modal);

      const closeBtn = modal.querySelector('#ycm-btn-close');
      if (closeBtn) closeBtn.addEventListener('click', () => this.hide());
      const backBtn = modal.querySelector('#ycm-btn-back');
      if (backBtn) backBtn.addEventListener('click', () => this.navigateBack());
    }
    this._panelElement = modal;
  }
  _bindHostEvents() {
    if (typeof window === 'undefined') return;
    this._unbindHostEvents();

    const self = this;
    const reEnsure = () => {
      if (self._reensureTimer) clearTimeout(self._reensureTimer);
      self._reensureTimer = setTimeout(() => {
        self._reensureTimer = null;
        if (!self._destroyed) {
          self._ensureButton();
          self._ensureFloatingButton();
          self._ensurePanel();
          if (self._visible) {
            self._syncNavWithCurrentState()
              .then(() => self.render())
              .catch(err => console.error('[YongchuMap] 切换聊天后刷新地图失败:', err));
          }
        }
      }, 250);
    };

    this._chatChangedHandler = reEnsure;

    try {
      if (window.SillyTavern && window.SillyTavern.getContext) {
        const ctx = window.SillyTavern.getContext();
        if (ctx?.eventSource?.on && ctx?.eventTypes?.CHAT_CHANGED) {
          ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, reEnsure);
          this._hostEventBinding = {
            source: ctx.eventSource,
            event: ctx.eventTypes.CHAT_CHANGED,
            handler: reEnsure
          };
        }
      }
    } catch (_) {}

    try {
      if (!this._hostEventBinding && typeof window.eventOn === 'function' && window.tavern_events?.CHAT_CHANGED) {
        window.eventOn(window.tavern_events.CHAT_CHANGED, reEnsure);
        this._hostEventBinding = {
          source: window,
          event: window.tavern_events.CHAT_CHANGED,
          handler: reEnsure,
          legacy: true
        };
      }
    } catch (_) {}

    window.addEventListener('keydown', this._boundKeyDown);
  }

  _unbindHostEvents() {
    if (typeof window === 'undefined') return;
    if (this._reensureTimer) {
      clearTimeout(this._reensureTimer);
      this._reensureTimer = null;
    }
    const binding = this._hostEventBinding;
    if (binding) {
      try {
        if (binding.legacy && typeof window.eventOff === 'function') {
          window.eventOff(binding.event, binding.handler);
        } else if (typeof binding.source.off === 'function') {
          binding.source.off(binding.event, binding.handler);
        } else if (typeof binding.source.removeListener === 'function') {
          binding.source.removeListener(binding.event, binding.handler);
        } else if (typeof binding.source.removeEventListener === 'function') {
          binding.source.removeEventListener(binding.event, binding.handler);
        }
      } catch (_) {}
      this._hostEventBinding = null;
    }
    try {
      window.removeEventListener('keydown', this._boundKeyDown);
    } catch (_) {}
  }

  _onKeyDown(e) {
    if (e.key === 'Escape' && this._visible) {
      this.hide();
    }
  }

  async show() {
    if (this._destroyed) return { success: false, error: '已销毁' };
    this._ensurePanel();
    this._ensureButton();
    this._ensureFloatingButton();
    this._visible = true;

    if (this._panelElement) {
      this._panelElement.classList.add('active');
    }

    await this._syncNavWithCurrentState();
    if (this._destroyed) return { success: false, error: '已销毁' };
    return await this.render();
  }

  hide() {
    this._visible = false;
    if (this._panelElement) {
      this._panelElement.classList.remove('active');
    }
    return { success: true };
  }

  toggle() {
    if (this._visible) {
      return this.hide();
    } else {
      return this.show();
    }
  }

  async _syncNavWithCurrentState() {
    const state = this.store ? this.store.getState() : null;
    const phys = state ? state.physical_state : {};

    const worldId = phys.world_id ||
                    this.mapInstance?.getActiveWorldPack?.()?.id ||
                    this.mapInstance?.activeWorldPackId ||
                    this.navState.worldId;
    this.navState.worldId = worldId;

    if (phys.city_id && worldId) {
      this.navState.nationId = await this._findNationId(worldId, phys);
      this.navState.cityId = phys.city_id;
    } else {
      this.navState.nationId = null;
      this.navState.cityId = null;
    }
  }

  async navigateToWorld() {
    this.navState.nationId = null;
    this.navState.cityId = null;
    return await this.render();
  }

  async navigateToNation(nationId) {
    this.navState.nationId = nationId;
    this.navState.cityId = null;
    return await this.render();
  }

  async navigateToCity(cityId) {
    this.navState.cityId = cityId;
    return await this.render();
  }

  async navigateBack() {
    if (this.navState.cityId) {
      this.navState.cityId = null;
    } else if (this.navState.nationId) {
      this.navState.nationId = null;
    }
    return await this.render();
  }

  async _findNationId(worldId, phys) {
    const worldRef = await this.loader.loadWorld(worldId);
    const nations = worldRef?.worldData?.nations || [];
    const explicit = phys.nation_id || null;
    if (explicit && nations.some(n => n.id === explicit)) return explicit;

    const byName = phys.nation && nations.find(n => n.id === phys.nation || n.name === phys.nation || n.fullName === phys.nation);
    if (byName) return byName.id;

    const cityId = phys.city_id;
    const inline = nations.find(n => n.capital === cityId || (n.keyCities || []).some(c => c.id === cityId));
    if (inline) return inline.id;

    for (const nation of nations) {
      if (!nation.nationalDataFile) continue;
      const nationRef = await this.loader.loadNation(worldRef, nation.id);
      if ((nationRef?.nationData?.cities || []).some(c => c.id === cityId)) return nation.id;
    }
    return null;
  }

  // 每次加载都使用导航快照；结果只由最后一次 render 提交，避免快速点击时旧请求覆盖新页面。
  async _loadData(nav) {
    if (!nav.worldId) throw new Error('未配置 worldId');
    const worldRef = await this.loader.loadWorld(nav.worldId);
    const nationRef = nav.nationId ? await this.loader.loadNation(worldRef, nav.nationId) : null;
    const cityRef = nav.cityId && nationRef ? await this.loader.loadCity(worldRef, nationRef, nav.cityId) : null;
    const cityLocationsRef = cityRef?.hasDetail ? await this.loader.loadCityLocations(worldRef, nationRef, cityRef) : null;
    return { worldRef, nationRef, cityRef, cityLocationsRef };
  }

  async render() {
    if (this._destroyed) return { success: false, error: '已销毁' };
    // 即使在无 DOM 或面板未挂载时，也先确保数据加载完成（方便无头测试与后台预加载）
    const generation = ++this._renderGeneration;
    const nav = { ...this.navState };
    try {
      this._isLoading = true;
      const loaded = await this._loadData(nav);
      if (generation !== this._renderGeneration) return { success: false, stale: true };
      this._currentWorldRef = loaded.worldRef;
      this._currentNationRef = loaded.nationRef;
      this._currentCityRef = loaded.cityRef;
      this._cityLocationsRef = loaded.cityLocationsRef;
      if (this.registry && loaded.cityLocationsRef?.locations?.length > 0) {
        const registered = this.registry.getCityLocations(nav.worldId, nav.cityId);
        if (!registered || registered.length === 0) {
          this.registry.loadCityLocations(nav.worldId, nav.cityId, loaded.cityLocationsRef.locationsData);
        }
      }
      this._isLoading = false;
      this._loadError = null;
    } catch (err) {
      if (generation !== this._renderGeneration) return { success: false, stale: true };
      this._isLoading = false;
      this._loadError = err.message;
      this._currentWorldRef = null;
      this._currentNationRef = null;
      this._currentCityRef = null;
      this._cityLocationsRef = null;
      console.error('[YongchuMap] 数据加载失败:', err);
    }

    if (!this._panelElement) return { success: false, error: '未初始化' };

    const doc = this._getDoc();
    const breadcrumbContainer = doc.getElementById('ycm-breadcrumb-container');
    const bodyContent = doc.getElementById('ycm-body-content');
    const backBtn = doc.getElementById('ycm-btn-back');

    if (!breadcrumbContainer || !bodyContent) return { success: false };

    this._renderBreadcrumbs(breadcrumbContainer, backBtn);

    if (this.navState.cityId) {
      this._renderCityView(bodyContent);
    } else if (this.navState.nationId) {
      this._renderNationView(bodyContent);
    } else {
      this._renderWorldView(bodyContent);
    }

    return { success: true };
  }

  _renderBreadcrumbs(container, backBtn) {
    container.innerHTML = '';
    const items = [];

    const worldName = this._currentWorldRef?.worldData?.name || this.navState.worldId || '未配置世界';
    items.push({
      label: worldName,
      active: !this.navState.nationId && !this.navState.cityId,
      onClick: () => this.navigateToWorld()
    });

    if (this.navState.nationId) {
      const nationLabel = this._currentNationRef?.nationMeta?.fullName ||
                          this._currentNationRef?.nationMeta?.name ||
                          this.navState.nationId;
      items.push({
        label: nationLabel,
        active: !this.navState.cityId,
        onClick: () => this.navigateToNation(this.navState.nationId)
      });
    }

    if (this.navState.cityId) {
      const cityLabel = this._currentCityRef?.cityMeta?.name ? (this._currentCityRef.cityMeta.name + '城') : this.navState.cityId;
      items.push({
        label: cityLabel,
        active: true,
        onClick: null
      });
    }

    items.forEach((item, idx) => {
      if (idx > 0) {
        const sep = this._getDoc().createElement('span');
        sep.className = 'ycm-breadcrumb-sep';
        sep.textContent = '>';
        container.appendChild(sep);
      }

      const span = this._getDoc().createElement('span');
      span.className = 'ycm-breadcrumb-item' + (item.active ? ' active' : '');
      span.textContent = item.label;
      if (!item.active && item.onClick) {
        span.addEventListener('click', item.onClick);
      }
      container.appendChild(span);
    });

    if (backBtn) {
      backBtn.style.display = (this.navState.nationId || this.navState.cityId) ? 'inline-block' : 'none';
    }
  }

  _renderCurrentLocationBanner() {
    const state = this.store ? this.store.getState() : null;
    const phys = state ? state.physical_state : {};
    const locName = phys.location_name || '未记录';
    const loadedCity = this._currentCityRef?.cityMeta;
    const loadedNation = this._currentWorldRef?.worldData?.nations?.find(n => n.id === this.navState.nationId);
    const cityName = phys.city_id
      ? (loadedCity?.id === phys.city_id ? loadedCity.name : phys.city_id)
      : '未记录';
    const nationName = phys.nation || loadedNation?.fullName || loadedNation?.name || '未记录';

    return `
      <div class="ycm-current-status">
        <div class="ycm-status-text">
          <span>当前身处：</span>
          <strong>${this._escapeHtml(nationName)} · ${this._escapeHtml(cityName)} · ${this._escapeHtml(locName)}</strong>
          ${phys.is_indoor ? '<span style="font-size:11px;color:#7a6d58;margin-left:6px;">(室内)</span>' : ''}
        </div>
        <div class="ycm-status-tag">实时物理状态同步</div>
      </div>
    `;
  }

  _renderWorldView(container) {
    const bannerHtml = this._renderCurrentLocationBanner();
    const nations = this._currentWorldRef?.worldData?.nations || [];

    let cardsHtml = '';
    nations.forEach(n => {
      const hasDetail = !!n.nationalDataFile;
      const tagText = hasDetail ? '疆域在览 · 可查' : '天下万邦';
      const capitalDesc = n.capital ? `国都：${n.capital}` : '';
      const summary = n.summary || n.desc || capitalDesc || '暂无简介';

      cardsHtml += `
        <div class="ycm-card" data-nation-id="${this._escapeHtml(n.id)}">
          <div class="ycm-card-header">
            <div class="ycm-card-title">${this._escapeHtml(n.fullName || n.name)} (${this._escapeHtml(n.name)})</div>
            <span class="ycm-card-tag">${tagText}</span>
          </div>
          <div class="ycm-card-desc">${this._escapeHtml(summary)}</div>
          <div class="ycm-card-footer">
            <span>${hasDetail ? '查阅疆域城邑' : '详细地舆尚未绘制'}</span>
            <span>→</span>
          </div>
        </div>
      `;
    });

    container.innerHTML = `
      ${bannerHtml}
      <div style="margin-bottom: 12px; font-size: 13px; color: #d4af37; font-weight: 600;">
        天下大势 · 诸国分野
      </div>
      <div class="ycm-grid">
        ${cardsHtml}
      </div>
    `;

    const cards = container.querySelectorAll('.ycm-card');
    cards.forEach(card => {
      const nationId = card.getAttribute('data-nation-id');
      card.addEventListener('click', () => this.navigateToNation(nationId));
    });
  }

  _renderNationView(container) {
    const nationRef = this._currentNationRef;
    const bannerHtml = this._renderCurrentLocationBanner();
    const fullName = nationRef?.nationMeta?.fullName || nationRef?.nationMeta?.name || '该国';

    if (!nationRef || !nationRef.hasDetail) {
      container.innerHTML = `
        ${bannerHtml}
        <div style="margin-bottom: 12px; font-size: 13px; color: #d4af37; font-weight: 600;">
          ${this._escapeHtml(fullName)} · 疆域城邑
        </div>
        <div class="ycm-empty-fallback">
          <div class="ycm-empty-title">⚠️ 详细地图尚未建立</div>
          <div class="ycm-empty-desc">
            目前 ${this._escapeHtml(fullName)} 舆图册府尚未绘制完备，暂无下辖城邑的详细坐标及街巷分布。
          </div>
        </div>
      `;
      return;
    }

    const cities = nationRef.nationData?.cities || [];
    let cardsHtml = '';

    if (cities.length > 0) {
      cities.forEach(c => {
        const hasCityDetail = !!c.city_data_file;
        const isCapital = nationRef.nationData?.capital_city_id === c.id;
        const tagText = hasCityDetail ? '已接入地图引擎' : (isCapital ? '国都 (待勘绘)' : '要邑');
        const desc = c.description || c.features || '暂无简介';

        cardsHtml += `
          <div class="ycm-card" data-city-id="${this._escapeHtml(c.id)}" style="${hasCityDetail ? '' : 'opacity:0.75;'}">
            <div class="ycm-card-header">
              <div class="ycm-card-title">${this._escapeHtml(c.name)}城 ${isCapital ? '👑' : ''}</div>
              <span class="ycm-card-tag">${tagText}</span>
            </div>
            <div class="ycm-card-desc">${this._escapeHtml(desc)}</div>
            <div class="ycm-card-footer">
              <span>${hasCityDetail ? '点击查阅全城坊市与地点' : '详细城坊尚未绘制'}</span>
              <span>→</span>
            </div>
          </div>
        `;
      });
    } else {
      cardsHtml = `
        <div class="ycm-card" style="grid-column: 1 / -1; opacity: 0.85; cursor: default;">
          <div class="ycm-card-header">
            <div class="ycm-card-title">${this._escapeHtml(fullName)} 诸城</div>
            <span class="ycm-card-tag">山河广阔</span>
          </div>
          <div class="ycm-card-desc">暂无可用城池数据。</div>
        </div>
      `;
    }

    container.innerHTML = `
      ${bannerHtml}
      <div style="margin-bottom: 12px; font-size: 13px; color: #d4af37; font-weight: 600;">
        ${this._escapeHtml(fullName)} · 疆域城邑
      </div>
      <div class="ycm-grid">
        ${cardsHtml}
      </div>
    `;

    const cityCards = container.querySelectorAll('[data-city-id]');
    cityCards.forEach(card => {
      const cityId = card.getAttribute('data-city-id');
      card.addEventListener('click', () => this.navigateToCity(cityId));
    });
  }

  _renderCityView(container) {
    const bannerHtml = this._renderCurrentLocationBanner();
    const cityRef = this._currentCityRef;
    const cityName = cityRef?.cityMeta?.name || '本城';

    if (!cityRef || !cityRef.hasDetail) {
      if (this._cityMapRenderer) {
        this._cityMapRenderer.destroy();
        this._cityMapRenderer = null;
      }
      container.innerHTML = `
        ${bannerHtml}
        <div class="ycm-empty-fallback">
          <div class="ycm-empty-title">⚠️ 详细地图尚未建立</div>
          <div class="ycm-empty-desc">
            ${this._escapeHtml(cityName)}城 暂未绘制街坊与详细地点图谱。
          </div>
        </div>
      `;
      return;
    }

    const cityData = cityRef.cityData;
    const worldId = this.navState.worldId;
    const locations = this.registry ? this.registry.getCityLocations(worldId, this.navState.cityId) : (this._cityLocationsRef?.locations || []);

    const state = this.store ? this.store.getState() : null;
    const phys = state ? state.physical_state : {};
    // 只有当当前物理位置有效，且确实属于当前城市时才传入 location_id
    const currentLocationId = (phys.city_id === this.navState.cityId && phys.location_id) ? phys.location_id : null;

    container.innerHTML = `
      ${bannerHtml}
      <div id="ycm-city-map-mount" style="height: calc(100% - 60px); min-height: 480px;"></div>
    `;

    const mountPoint = container.querySelector('#ycm-city-map-mount');
    if (mountPoint) {
      if (this._cityMapRenderer) {
        this._cityMapRenderer.destroy();
      }
      this._cityMapRenderer = new YonganCityMapRenderer({
        container: mountPoint,
        cityData: cityData,
        locations: locations,
        currentLocationId: currentLocationId,
        onLocationClick: (loc) => {
          console.log('[YongchuMap] 点击城市地点:', loc.name);
        }
      });
      this._cityMapRenderer.init();
    }
  }

  refreshLocationMarker() {
    if (this._visible) {
      this.render();
    }
    return { success: true };
  }

  getState() {
    const locName = this.store ? this.store.getState()?.physical_state?.location_name : null;
    return {
      visible: this._visible,
      navState: { ...this.navState },
      current_location: locName
    };
  }

  destroy() {
    this._destroyed = true;
    this._renderGeneration++;
    this._unbindHostEvents();
    if (this._floatDragCleanup) {
      try { this._floatDragCleanup(); } catch (_) {}
      this._floatDragCleanup = null;
    }
    if (this._cityMapRenderer) {
      try { this._cityMapRenderer.destroy(); } catch (_) {}
      this._cityMapRenderer = null;
    }
    if (this._floatingBtnElement) {
      try { this._floatingBtnElement.remove(); } catch (_) {}
      this._floatingBtnElement = null;
    }
    if (this._btnElement) {
      try { this._btnElement.remove(); } catch (_) {}
      this._btnElement = null;
    }
    if (this._panelElement) {
      try { this._panelElement.remove(); } catch (_) {}
      this._panelElement = null;
    }
    if (this._styleElement) {
      try { this._styleElement.remove(); } catch (_) {}
      this._styleElement = null;
    }
    this._visible = false;
    console.log('[YongchuMap] MapPanel 已安全销毁');
  }

  _getDoc() {
    return typeof document !== 'undefined' ? document : null;
  }

  _escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }
}

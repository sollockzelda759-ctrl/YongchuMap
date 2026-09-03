// ============================================================
// MapPanel.js —— 地图UI面板 (ESM, UI v1)
// 职责：DOM挂载、三级导航(世界/国家/城市)、地点卡片渲染与实时定位
// 严禁接管：MapStore, travel, settlement, rollback, map_event
// ============================================================

import MapDataLoader from '../data/MapDataLoader.js';

const UI_BTN_ID = 'yongchu-map-toggle-btn';
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
      this.toggle();
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
        if (!self._destroyed) self._ensureButton();
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
    this._ensurePanel();
    this._ensureButton();
    this._visible = true;

    if (this._panelElement) {
      this._panelElement.classList.add('active');
    }

    await this._syncNavWithCurrentState();
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
    const totalCount = locations.length;

    const state = this.store ? this.store.getState() : null;
    const currentLocationId = state?.physical_state?.location_id || null;

    const categories = {};
    locations.forEach(l => {
      categories[l.category] = (categories[l.category] || 0) + 1;
    });

    let pillsHtml = '';
    locations.forEach(l => {
      const isCurrent = l.id === currentLocationId;
      const currentBadge = isCurrent ? ' (当前)' : '';
      pillsHtml += `
        <div class="ycm-loc-pill ${isCurrent ? 'is-current' : ''}" title="${this._escapeHtml(l.atmosphere || l.name)}">
          <span>${isCurrent ? '📍 ' : ''}${this._escapeHtml(l.name)}${currentBadge}</span>
          <span class="ycm-loc-category">[${this._escapeHtml(l.category)}]</span>
        </div>
      `;
    });

    const districtsCount = cityData?.districts ? cityData.districts.length : 0;
    const cityDesc = cityData?.meta?.description || '暂无城市简介';

    container.innerHTML = `
      ${bannerHtml}
      <div class="ycm-city-panel">
        <div class="ycm-city-banner">
          <div>
            <div style="font-size:18px; font-weight:700; color:#f5d475; margin-bottom:4px;">
              ${this._escapeHtml(cityName)}城全域风貌
            </div>
            <div style="font-size:12px; color:#a2a7b3;">
              ${districtsCount > 0 ? districtsCount + '大主城区域 · ' : ''}${this._escapeHtml(cityDesc)}
            </div>
          </div>
          <div class="ycm-city-stats">
            <div class="ycm-stat-item">
              <span class="ycm-stat-value">${totalCount}</span>
              <span class="ycm-stat-label">已加载地点</span>
            </div>
            <div class="ycm-stat-item">
              <span class="ycm-stat-value">${Object.keys(categories).length}</span>
              <span class="ycm-stat-label">风貌门类</span>
            </div>
            <div class="ycm-stat-item">
              <span class="ycm-stat-value">${districtsCount}</span>
              <span class="ycm-stat-label">区域坊市</span>
            </div>
          </div>
        </div>

        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:13px; color:#d4af37; font-weight:600;">地点索引列表（已全量接通 LocationRegistry 数据源）</span>
            <span style="font-size:11px; color:#858c99;">共 ${totalCount} 处</span>
          </div>
          <div class="ycm-locations-flow">
            ${pillsHtml}
          </div>
        </div>
      </div>
    `;
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

// ============================================================
// StrategicMapRenderer.js —— 世界/国家层美术舆图渲染器
// 美术底图只承载地形与氛围；名称、点位、路线与交互均为独立覆盖层。
// 本文件中的百分比坐标仅用于非权威视觉布局，不供路线/旅行逻辑使用。
// ============================================================

const WORLD_LAYOUT = {
  yan:       { x: 49, y: 19, width: 34, height: 27 },
  liang:     { x: 18, y: 49, width: 28, height: 35 },
  zhao_guo: { x: 51, y: 48, width: 34, height: 31 },
  zhao:      { x: 79, y: 34, width: 29, height: 37 },
  chu:       { x: 37, y: 76, width: 35, height: 31 },
  chen:      { x: 72, y: 76, width: 34, height: 31 }
};

const MAP_ASSETS = {
  world: new URL('../../assets/maps/yongchu/world.png', import.meta.url).href,
  zhao_guo: new URL('../../assets/maps/yongchu/nations/zhao_guo.png', import.meta.url).href,
  yan: new URL('../../assets/maps/yongchu/nations/yan.png', import.meta.url).href,
  zhao: new URL('../../assets/maps/yongchu/nations/zhao.png', import.meta.url).href,
  chu: new URL('../../assets/maps/yongchu/nations/chu.png', import.meta.url).href,
  liang: new URL('../../assets/maps/yongchu/nations/liang.png', import.meta.url).href,
  chen: new URL('../../assets/maps/yongchu/nations/chen.png', import.meta.url).href
};

export default class StrategicMapRenderer {
  constructor(options = {}) {
    this.container = options.container || null;
    this.mode = options.mode || 'world';
    this.worldData = options.worldData || null;
    this.nationData = options.nationData || null;
    this.onNationClick = options.onNationClick || null;
    this.onCityClick = options.onCityClick || null;
    this.onCityOpen = options.onCityOpen || null;
    this.currentCityId = options.currentCityId || null;
    this.artAssetUrl = options.artAssetUrl || null;
    this.worldWidth = 1200;
    this.worldHeight = 900;
    this.zoom = 0.6;
    this.minZoom = 0.45;
    this.maxZoom = 2.2;
    this.panX = 0;
    this.panY = 0;
    this.fitZoom = 0.6;
    this._selectedId = null;
    this._isDragging = false;
    this._dragMoved = false;
    this._captureEl = null;
    this._rootEl = null;
    this._viewportEl = null;
    this._worldEl = null;
    this._indexEl = null;
    this._detailEl = null;
  }

  init() {
    if (this.container) this.render();
  }

  render() {
    this.container.innerHTML = '';
    const root = document.createElement('section');
    root.className = `ycm-strategic-map ycm-strategic-mode-${this.mode}`;
    root.setAttribute('data-layout-authority', 'illustrative-only');

    const heading = document.createElement('div');
    heading.className = 'ycm-map-section-heading';
    const title = document.createElement('div');
    title.className = 'ycm-map-section-title';
    title.textContent = this.mode === 'world'
      ? `${this.worldData?.name || '天下'} · 六国舆图`
      : `${this.nationData?.full_name || this.nationData?.name || '本国'} · 山河城邑`;
    const note = document.createElement('div');
    note.className = 'ycm-map-section-note';
    note.textContent = '底图与交互层分离 · visualCoord 仅用于百分比显示';
    heading.appendChild(title);
    heading.appendChild(note);
    root.appendChild(heading);

    const layout = document.createElement('div');
    layout.className = 'ycm-strategic-layout';
    const viewport = document.createElement('div');
    viewport.className = 'ycm-strategic-viewport';
    viewport.setAttribute('aria-label', this.mode === 'world' ? '永初大陆六国地图' : `${this.nationData?.name || '国家'}城邑地图`);
    this._viewportEl = viewport;

    const mapWorld = document.createElement('div');
    mapWorld.className = 'ycm-strategic-world';
    this._worldEl = mapWorld;
    const art = document.createElement('img');
    art.className = 'ycm-strategic-art';
    art.src = this._getArtAssetUrl();
    art.alt = '';
    art.draggable = false;
    art.setAttribute('aria-hidden', 'true');
    mapWorld.appendChild(art);
    if (this.mode === 'world') this._renderWorld(mapWorld);
    else this._renderNation(mapWorld);
    viewport.appendChild(mapWorld);
    viewport.appendChild(this._createControls());

    const cartouche = document.createElement('div');
    cartouche.className = 'ycm-map-cartouche';
    cartouche.textContent = this.mode === 'world'
      ? '永初大陆 · 山河万里'
      : `${this.nationData?.name || '本国'}国疆域 · 城邑相连`;
    viewport.appendChild(cartouche);

    const drawer = document.createElement('aside');
    drawer.className = 'ycm-strategic-drawer';
    const drawerTitle = document.createElement('div');
    drawerTitle.className = 'ycm-strategic-drawer-title';
    drawerTitle.textContent = this.mode === 'world' ? '六国索引' : `城邑索引 (${this.nationData?.cities?.length || 0})`;
    drawer.appendChild(drawerTitle);
    const search = document.createElement('input');
    search.className = 'ycm-strategic-search';
    search.type = 'search';
    search.placeholder = this.mode === 'world' ? '搜索国家' : '搜索城邑';
    search.setAttribute('aria-label', search.placeholder);
    drawer.appendChild(search);
    const index = document.createElement('div');
    index.className = 'ycm-strategic-index';
    this._indexEl = index;
    this._renderIndex(index);
    drawer.appendChild(index);
    const detail = document.createElement('div');
    detail.className = 'ycm-strategic-detail';
    this._detailEl = detail;
    this._renderDetail(null);
    drawer.appendChild(detail);
    layout.appendChild(viewport);
    layout.appendChild(drawer);
    root.appendChild(layout);
    this.container.appendChild(root);
    this._rootEl = root;
    this.resetView();
    this._bindEvents();
    search.addEventListener('input', () => this._filterIndex(search.value));
    search.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      const first = Array.from(this._indexEl?.querySelectorAll('.ycm-strategic-index-item') || []).find(item => !item.hidden);
      first?.click?.();
    });
  }

  _createControls() {
    const controls = document.createElement('div');
    controls.className = 'ycm-map-controls ycm-strategic-controls';
    controls.setAttribute('role', 'toolbar');
    controls.setAttribute('aria-label', '地图视角控制');
    controls.innerHTML = `
      <button type="button" class="ycm-map-ctrl-btn" data-act="zoom-in" title="放大" aria-label="放大地图">+</button>
      <button type="button" class="ycm-map-ctrl-btn" data-act="zoom-out" title="缩小" aria-label="缩小地图">−</button>
      <button type="button" class="ycm-map-ctrl-btn" data-act="reset" title="重置视角" aria-label="重置地图视角">⟳</button>
    `;
    return controls;
  }

  _renderWorld(mapWorld) {
    const overlay = document.createElement('div');
    overlay.className = 'ycm-world-overlay';
    (this.worldData?.nations || []).forEach(nation => {
      const position = nation.visualCoord || WORLD_LAYOUT[nation.id];
      if (!position) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ycm-state-hotspot';
      button.setAttribute('data-nation-id', nation.id);
      button.setAttribute('aria-label', `查看${nation.fullName || nation.name}`);
      this._positionElement(button, position);
      const halo = document.createElement('span');
      halo.className = 'ycm-state-halo';
      const glyph = document.createElement('span');
      glyph.className = 'ycm-state-glyph';
      glyph.textContent = nation.name || '';
      button.appendChild(halo);
      button.appendChild(glyph);
      const capital = (nation.keyCities || []).find(city => city.id === nation.capital);
      if (capital) {
        const capitalEl = document.createElement('span');
        capitalEl.className = 'ycm-capital-label';
        capitalEl.textContent = `◆ ${capital.name}`;
        button.appendChild(capitalEl);
      }
      this._bindActivation(button, () => this.selectNation(nation.id));
      overlay.appendChild(button);
    });
    mapWorld.appendChild(overlay);
  }

  _renderNation(mapWorld) {
    const citiesLayer = document.createElement('div');
    citiesLayer.className = 'ycm-nation-cities';
    const cities = this.nationData?.cities || [];
    cities.forEach((city, index) => {
      const position = city.visualCoord;
      if (!position) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ycm-nation-city';
      if (city.id === this.nationData?.capital_city_id) button.classList.add('is-capital');
      if (city.id === this.currentCityId) button.classList.add('is-current-pos');
      button.setAttribute('data-city-id', city.id);
      button.setAttribute('data-label-placement', this._getLabelPlacement(city, index, cities));
      button.setAttribute('aria-label', `查看${city.name}`);
      if (city.id === this.currentCityId) button.setAttribute('aria-current', 'location');
      button.style.left = `${position.x}%`;
      button.style.top = `${position.y}%`;
      const dot = document.createElement('span');
      dot.className = 'ycm-nation-city-dot';
      const label = document.createElement('span');
      label.className = 'ycm-nation-city-name';
      label.textContent = city.name;
      button.appendChild(dot);
      button.appendChild(label);
      this._bindActivation(button, () => this.selectCity(city.id));
      citiesLayer.appendChild(button);
    });
    mapWorld.appendChild(citiesLayer);
  }

  _renderIndex(container) {
    const records = this.mode === 'world' ? (this.worldData?.nations || []) : (this.nationData?.cities || []);
    records.forEach(record => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ycm-strategic-index-item';
      const attr = this.mode === 'world' ? 'data-index-nation-id' : 'data-index-city-id';
      button.setAttribute(attr, record.id);
      button.setAttribute('data-search-text', `${record.name || ''} ${record.fullName || ''} ${record.type || ''}`.toLowerCase());
      if (this.mode === 'nation' && record.id === this.currentCityId) button.classList.add('is-current-pos');
      const name = document.createElement('strong');
      name.textContent = this.mode === 'world' ? (record.fullName || record.name) : record.name;
      const meta = document.createElement('span');
      meta.textContent = this.mode === 'world'
        ? (record.geographicPosition || '地理资料待考')
        : (record.type || record.position_in_nation || '城邑');
      button.appendChild(name);
      button.appendChild(meta);
      this._bindActivation(button, () => this.mode === 'world' ? this.selectNation(record.id) : this.selectCity(record.id));
      container.appendChild(button);
    });
  }

  selectNation(nationId) {
    const record = (this.worldData?.nations || []).find(nation => nation.id === nationId);
    const position = record?.visualCoord || WORLD_LAYOUT[nationId];
    if (!position) return;
    this._selectedId = nationId;
    this._syncSelected('nation', nationId);
    this._renderDetail(record);
    this.focusCoordinates(position.x * 12, position.y * 9, Math.max(this.fitZoom * 1.2, 0.72));
    this.onNationClick?.(nationId);
  }

  selectCity(cityId) {
    const record = (this.nationData?.cities || []).find(city => city.id === cityId);
    const position = record?.visualCoord;
    if (!position) return;
    this._selectedId = cityId;
    this._syncSelected('city', cityId);
    this._renderDetail(record);
    this.focusCoordinates(position.x * 12, position.y * 9, Math.max(this.fitZoom * 1.35, 0.82));
    this.onCityClick?.(cityId, record);
  }

  _getArtAssetUrl() {
    if (this.artAssetUrl) return this.artAssetUrl;
    if (this.mode === 'world') return MAP_ASSETS.world;
    return MAP_ASSETS[this.nationData?.id] || '';
  }

  _filterIndex(query) {
    const needle = String(query || '').trim().toLowerCase();
    this._indexEl?.querySelectorAll('.ycm-strategic-index-item').forEach(item => {
      const haystack = item.getAttribute('data-search-text') || '';
      item.hidden = !!needle && !haystack.includes(needle);
    });
  }

  _renderDetail(record) {
    if (!this._detailEl) return;
    this._detailEl.innerHTML = '';
    if (!record) {
      const hint = document.createElement('p');
      hint.className = 'ycm-strategic-detail-hint';
      hint.textContent = this.mode === 'world' ? '点击国号进入对应国家地图。' : '点击城邑标记查看正式资料。';
      this._detailEl.appendChild(hint);
      return;
    }

    const title = document.createElement('strong');
    title.className = 'ycm-strategic-detail-title';
    title.textContent = this.mode === 'world' ? (record.fullName || record.name) : record.name;
    this._detailEl.appendChild(title);

    const fields = this.mode === 'world'
      ? [record.geographicPosition, record.terrain]
      : [record.type, record.position_in_nation, record.features];
    fields.filter(Boolean).forEach(value => {
      const line = document.createElement('p');
      line.textContent = value;
      this._detailEl.appendChild(line);
    });

    if (this.mode === 'nation' && record.id === this.currentCityId) {
      const current = document.createElement('span');
      current.className = 'ycm-strategic-current-tag';
      current.textContent = '当前位置';
      this._detailEl.appendChild(current);
    }

    if (this.mode === 'nation' && record.city_data_file && this.onCityOpen) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'ycm-strategic-open-city';
      open.textContent = '进入城市地图';
      open.addEventListener('click', event => {
        event.stopPropagation();
        this.onCityOpen(record.id);
      });
      this._detailEl.appendChild(open);
    }
  }

  _getLabelPlacement(city, index, cities) {
    const position = city.visualCoord || {};
    if (position.labelPlacement) return position.labelPlacement;
    if (position.x < 16) return 'right';
    if (position.x > 84) return 'left';
    if (position.y < 14) return 'bottom';
    if (position.y > 86) return 'top';

    const nearbyBefore = cities.slice(0, index).filter(other => {
      const otherPosition = other.visualCoord || {};
      return Math.abs((otherPosition.x || 0) - position.x) < 13 && Math.abs((otherPosition.y || 0) - position.y) < 10;
    }).length;
    return nearbyBefore % 2 ? 'left' : 'right';
  }

  _syncSelected(type, id) {
    if (!this._rootEl) return;
    const mapSelector = type === 'nation' ? '.ycm-state-hotspot' : '.ycm-nation-city';
    const mapAttr = type === 'nation' ? 'data-nation-id' : 'data-city-id';
    const indexAttr = type === 'nation' ? 'data-index-nation-id' : 'data-index-city-id';
    this._rootEl.querySelectorAll(mapSelector).forEach(item => item.classList.toggle('is-selected', item.getAttribute(mapAttr) === id));
    this._rootEl.querySelectorAll(`[${indexAttr}]`).forEach(item => item.classList.toggle('is-selected', item.getAttribute(indexAttr) === id));
  }

  focusCoordinates(targetX, targetY, targetZoom = this.zoom) {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, targetZoom));
    const vw = this._viewportEl?.clientWidth || 700;
    const vh = this._viewportEl?.clientHeight || 500;
    this.panX = vw / 2 - targetX * this.zoom;
    this.panY = vh / 2 - targetY * this.zoom;
    this._clampPan();
    this._updateTransform(true);
  }

  resetView() {
    const vw = this._viewportEl?.clientWidth || 700;
    const vh = this._viewportEl?.clientHeight || 500;
    this.fitZoom = Math.max(this.minZoom, Math.min(1, Math.min((vw - 12) / this.worldWidth, (vh - 12) / this.worldHeight)));
    this.zoom = this.fitZoom;
    this.panX = (vw - this.worldWidth * this.zoom) / 2;
    this.panY = (vh - this.worldHeight * this.zoom) / 2;
    this._updateTransform(true);
  }

  zoomIn() { this._zoomAtCenter(0.14); }
  zoomOut() { this._zoomAtCenter(-0.14); }

  _zoomAtCenter(delta) {
    const vw = this._viewportEl?.clientWidth || 700;
    const vh = this._viewportEl?.clientHeight || 500;
    this._setZoomAt(this.zoom + delta, vw / 2, vh / 2);
  }

  _setZoomAt(nextZoom, anchorX, anchorY) {
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, nextZoom));
    if (newZoom === this.zoom) return;
    const ratio = newZoom / this.zoom;
    this.panX = anchorX - (anchorX - this.panX) * ratio;
    this.panY = anchorY - (anchorY - this.panY) * ratio;
    this.zoom = newZoom;
    this._clampPan();
    this._updateTransform(false);
  }

  _clampPan() {
    const vw = this._viewportEl?.clientWidth || 700;
    const vh = this._viewportEl?.clientHeight || 500;
    const scaledW = this.worldWidth * this.zoom;
    const scaledH = this.worldHeight * this.zoom;
    const margin = 70;
    this.panX = scaledW <= vw ? (vw - scaledW) / 2 : Math.min(margin, Math.max(vw - scaledW - margin, this.panX));
    this.panY = scaledH <= vh ? (vh - scaledH) / 2 : Math.min(margin, Math.max(vh - scaledH - margin, this.panY));
  }

  _updateTransform(animated) {
    if (!this._worldEl) return;
    this._worldEl.classList.toggle('is-animated', !!animated && !this._isDragging);
    this._worldEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }

  _bindEvents() {
    if (!this._viewportEl) return;
    const controls = this._viewportEl.querySelector('.ycm-map-controls');
    if (controls) {
      const buttons = controls.querySelectorAll('.ycm-map-ctrl-btn');
      const runAction = action => {
        if (action === 'zoom-in') this.zoomIn();
        if (action === 'zoom-out') this.zoomOut();
        if (action === 'reset') this.resetView();
      };
      if (buttons.length) {
        buttons.forEach(button => button.addEventListener('click', event => {
          event.stopPropagation();
          runAction(button.getAttribute('data-act'));
        }));
      } else {
        controls.addEventListener('click', event => runAction(event.target.closest('.ycm-map-ctrl-btn')?.getAttribute('data-act')));
      }
    }
    this._viewportEl.addEventListener('wheel', event => {
      event.preventDefault();
      const rect = this._viewportEl.getBoundingClientRect();
      this._setZoomAt(this.zoom + (event.deltaY < 0 ? 0.12 : -0.12), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    this._viewportEl.addEventListener('pointerdown', event => {
      if (event.target?.closest?.('.ycm-map-controls')) return;
      this._isDragging = true;
      this._dragMoved = false;
      this._pointerStartX = event.clientX;
      this._pointerStartY = event.clientY;
      this._startX = event.clientX - this.panX;
      this._startY = event.clientY - this.panY;
      this._worldEl?.classList.remove('is-animated');
      this._viewportEl.classList.add('is-dragging');
      this._captureEl = event.target || this._viewportEl;
      try { this._captureEl.setPointerCapture?.(event.pointerId); } catch (_) {}
    });
    this._viewportEl.addEventListener('pointermove', event => {
      if (!this._isDragging) return;
      if (Math.abs(event.clientX - this._pointerStartX) > 3 || Math.abs(event.clientY - this._pointerStartY) > 3) this._dragMoved = true;
      this.panX = event.clientX - this._startX;
      this.panY = event.clientY - this._startY;
      this._clampPan();
      this._updateTransform(false);
    });
    const stopDrag = event => {
      if (!this._isDragging) return;
      this._isDragging = false;
      this._viewportEl.classList.remove('is-dragging');
      try { this._captureEl?.releasePointerCapture?.(event.pointerId); } catch (_) {}
      this._captureEl = null;
    };
    this._viewportEl.addEventListener('pointerup', stopDrag);
    this._viewportEl.addEventListener('pointercancel', stopDrag);
  }

  _bindActivation(element, callback) {
    element.addEventListener('click', event => {
      event.stopPropagation();
      if (!this._dragMoved) callback();
    });
  }

  _positionElement(element, position) {
    element.style.left = `${position.x}%`;
    element.style.top = `${position.y}%`;
    element.style.width = `${position.width}%`;
    element.style.height = `${position.height}%`;
  }

  destroy() {
    if (this.container) this.container.innerHTML = '';
    this._rootEl = null;
    this._viewportEl = null;
    this._worldEl = null;
    this._indexEl = null;
    this._detailEl = null;
  }
}

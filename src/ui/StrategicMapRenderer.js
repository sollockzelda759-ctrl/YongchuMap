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

const NATION_LAYOUT = {
  qingbicheng: { x: 50, y: 17 }, yunling: { x: 49, y: 29 },
  luokou: { x: 16, y: 49 }, fengshui: { x: 29, y: 43 },
  pingchuan: { x: 42, y: 38 }, yongan: { x: 50, y: 54 },
  heqing: { x: 63, y: 45 }, dongqiu: { x: 84, y: 38 },
  shimen: { x: 82, y: 58 }, bailu: { x: 58, y: 65 },
  nanxi: { x: 29, y: 73 }, dujiang: { x: 47, y: 82 },
  linlan: { x: 72, y: 76 }
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAP_ASSETS = {
  world: new URL('../../assets/maps/yongchu-world-v2.png', import.meta.url).href,
  nation: new URL('../../assets/maps/zhaoguo-national-v2.png', import.meta.url).href
};

export default class StrategicMapRenderer {
  constructor(options = {}) {
    this.container = options.container || null;
    this.mode = options.mode || 'world';
    this.worldData = options.worldData || null;
    this.nationData = options.nationData || null;
    this.onNationClick = options.onNationClick || null;
    this.onCityClick = options.onCityClick || null;
    this.worldWidth = 1200;
    this.worldHeight = 800;
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
    note.textContent = '美术布局示意 · 地名与地理信息以正式资料为准';
    heading.appendChild(title);
    heading.appendChild(note);
    root.appendChild(heading);

    const layout = document.createElement('div');
    layout.className = 'ycm-strategic-layout';
    const viewport = document.createElement('div');
    viewport.className = 'ycm-strategic-viewport';
    viewport.setAttribute('aria-label', this.mode === 'world' ? '永初大陆六国地图' : '昭国十三城地图');
    this._viewportEl = viewport;

    const mapWorld = document.createElement('div');
    mapWorld.className = 'ycm-strategic-world';
    this._worldEl = mapWorld;
    const art = document.createElement('img');
    art.className = 'ycm-strategic-art';
    art.src = MAP_ASSETS[this.mode];
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
    cartouche.textContent = this.mode === 'world' ? '永初大陆 · 山河万里' : '昭国疆域 · 城邑相连';
    viewport.appendChild(cartouche);

    const drawer = document.createElement('aside');
    drawer.className = 'ycm-strategic-drawer';
    const drawerTitle = document.createElement('div');
    drawerTitle.className = 'ycm-strategic-drawer-title';
    drawerTitle.textContent = this.mode === 'world' ? '六国索引' : `城邑索引 (${this.nationData?.cities?.length || 0})`;
    drawer.appendChild(drawerTitle);
    const index = document.createElement('div');
    index.className = 'ycm-strategic-index';
    this._indexEl = index;
    this._renderIndex(index);
    drawer.appendChild(index);
    layout.appendChild(viewport);
    layout.appendChild(drawer);
    root.appendChild(layout);
    this.container.appendChild(root);
    this._rootEl = root;
    this.resetView();
    this._bindEvents();
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
      const position = WORLD_LAYOUT[nation.id];
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
    const routesSvg = this._svg('svg', { class: 'ycm-nation-routes', viewBox: '0 0 1200 800', 'aria-hidden': 'true' });
    (this.nationData?.internal_routes || []).forEach(route => {
      const ids = [route.from, ...(route.via || []), route.to];
      const points = ids.map(id => NATION_LAYOUT[id]).filter(Boolean).map(point => ({ x: point.x * 12, y: point.y * 8 }));
      if (points.length < 2) return;
      const path = this._svg('path', { class: 'ycm-nation-route', d: this._routePath(points) });
      const title = this._svg('title');
      title.textContent = route.name || '';
      path.appendChild(title);
      routesSvg.appendChild(path);
    });
    mapWorld.appendChild(routesSvg);

    const features = this.worldData?.natural_features || {};
    const labels = document.createElement('div');
    labels.className = 'ycm-terrain-labels';
    this._addTerrainLabel(labels, 49, 7, (features.mountain_ranges || []).find(item => item.id === 'qingping_mountains')?.name, 'mountain');
    this._addTerrainLabel(labels, 24, 39, (features.rivers || []).find(item => item.id === 'luoshui')?.name, 'river');
    this._addTerrainLabel(labels, 52, 87, (features.rivers || []).find(item => item.id === 'lanjiang')?.name, 'river');
    mapWorld.appendChild(labels);

    const citiesLayer = document.createElement('div');
    citiesLayer.className = 'ycm-nation-cities';
    (this.nationData?.cities || []).forEach(city => {
      const position = NATION_LAYOUT[city.id];
      if (!position) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ycm-nation-city';
      if (city.id === this.nationData?.capital_city_id) button.classList.add('is-capital');
      button.setAttribute('data-city-id', city.id);
      button.setAttribute('aria-label', `查看${city.name}城`);
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
    const position = WORLD_LAYOUT[nationId];
    if (!position) return;
    this._selectedId = nationId;
    this._syncSelected('nation', nationId);
    this.focusCoordinates(position.x * 12, position.y * 8, Math.max(this.fitZoom * 1.2, 0.72));
    this.onNationClick?.(nationId);
  }

  selectCity(cityId) {
    const position = NATION_LAYOUT[cityId];
    if (!position) return;
    this._selectedId = cityId;
    this._syncSelected('city', cityId);
    this.focusCoordinates(position.x * 12, position.y * 8, Math.max(this.fitZoom * 1.35, 0.82));
    this.onCityClick?.(cityId);
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

  _addTerrainLabel(container, x, y, text, type) {
    if (!text) return;
    const label = document.createElement('span');
    label.className = `ycm-terrain-label ycm-terrain-${type}`;
    label.style.left = `${x}%`;
    label.style.top = `${y}%`;
    label.textContent = text;
    container.appendChild(label);
  }

  _routePath(points) {
    if (points.length === 2) {
      const [a, b] = points;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2 - Math.min(24, Math.abs(b.x - a.x) * 0.05);
      return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
    }
    return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  }

  _svg(tag, attributes = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }

  destroy() {
    if (this.container) this.container.innerHTML = '';
    this._rootEl = null;
    this._viewportEl = null;
    this._worldEl = null;
    this._indexEl = null;
  }
}

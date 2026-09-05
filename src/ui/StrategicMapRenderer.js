// ============================================================
// StrategicMapRenderer.js —— 世界/国家层美术舆图渲染器
// 美术底图只承载地形与氛围；名称、点位、路线与交互均为独立覆盖层。
// 本文件中的百分比坐标仅用于非权威视觉布局，不供路线/旅行逻辑使用。
// ============================================================

import { getNationDisplayName } from './MapPresentation.js';

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

// 依据已确认六国参考图手工描摹的静态边界。仅用于世界层视觉识别，不代表动态领土权威。
const WORLD_BORDER_REGIONS = Object.freeze({
  yan: 'M330 40 C410 18 560 20 680 34 C760 46 830 84 900 130 C862 160 826 197 780 226 C734 260 690 294 632 300 C560 302 518 284 462 264 C415 247 382 222 354 190 C330 162 315 112 330 40 Z',
  liang: 'M40 145 C120 110 220 115 315 125 C324 158 340 180 354 190 C385 220 415 246 462 264 C438 300 424 342 434 378 C440 420 425 465 405 505 C370 550 330 588 280 615 C210 606 150 575 100 535 C60 475 40 390 34 300 C28 235 30 185 40 145 Z',
  zhao_guo: 'M462 264 C520 282 565 300 632 300 C700 295 770 310 820 345 C846 375 860 408 865 430 C840 465 825 505 800 540 C784 568 772 592 785 610 C720 632 660 624 610 610 C555 596 520 570 472 540 C442 522 420 512 405 505 C425 465 440 420 434 378 C428 340 440 300 462 264 Z',
  zhao: 'M900 130 C970 120 1050 145 1110 190 C1150 235 1164 292 1150 350 C1135 405 1090 440 1010 470 C955 475 915 458 865 430 C860 408 846 375 820 345 C800 310 790 266 780 226 C826 197 862 160 900 130 Z',
  chu: 'M280 615 C330 588 370 550 405 505 C420 512 442 522 472 540 C520 570 555 596 610 610 C660 624 720 632 785 610 C800 660 820 710 805 760 C780 820 720 860 640 875 C520 900 400 880 310 830 C250 790 220 720 230 670 C240 640 260 620 280 615 Z',
  chen: 'M865 430 C915 458 955 475 1010 470 C1070 480 1120 520 1150 580 C1160 640 1130 700 1080 745 C1020 800 940 835 855 820 C810 780 790 720 800 660 C805 635 795 620 785 610 C772 592 784 568 800 540 C825 505 840 465 865 430 Z'
});

const DRAG_THRESHOLD_PX = 8;
const LABEL_PLACEMENTS = ['top', 'top-right', 'top-left', 'bottom-right', 'bottom-left'];
const UI_CONTROL_SELECTOR = [
  '.ycm-map-controls',
  '.ycm-state-hotspot',
  '.ycm-nation-city',
  '.ycm-strategic-drawer',
  '.ycm-calibration-panel',
  'button',
  'input',
  'select',
  'textarea'
].join(',');

export default class StrategicMapRenderer {
  constructor(options = {}) {
    this.container = options.container || null;
    this.mode = options.mode || 'world';
    this.worldData = options.worldData || null;
    this.nationData = options.nationData || null;
    this.onNationClick = options.onNationClick || null;
    this.onCityClick = options.onCityClick || null;
    this.onCityOpen = options.onCityOpen || null;
    this.onCalibrationNationChange = options.onCalibrationNationChange || null;
    this.currentCityId = options.currentCityId || null;
    this.artAssetUrl = options.artAssetUrl || null;
    this.calibrationMode = this.mode === 'nation' && options.calibrationMode === true;
    this.worldWidth = 1200;
    this.worldHeight = 900;
    this.zoom = 1;
    this.minZoom = 1;
    this.maxZoom = 2.2;
    this.panX = 0;
    this.panY = 0;
    this.fitZoom = 1;
    this._selectedId = null;
    this._isDragging = false;
    this._dragMoved = false;
    this._captureEl = null;
    this._resizeObserver = null;
    this._windowResizeHandler = null;
    this._lastViewportWidth = 0;
    this._lastViewportHeight = 0;
    this._rootEl = null;
    this._viewportEl = null;
    this._worldEl = null;
    this._indexEl = null;
    this._detailEl = null;
    this._calibrationPanelEl = null;
    this._calibrationCitySelectEl = null;
    this._calibrationCoordEl = null;
    this._calibrationOutputEl = null;
    this._calibrationPreviewEl = null;
    this._calibrationCityId = this.nationData?.cities?.[0]?.id || null;
    this._calibrationPending = null;
    this._calibrationDrafts = new Map();
    this._labelsLaidOut = false;
  }

  init() {
    if (this.container) this.render();
  }

  render() {
    this._unbindResizeObserver();
    this._labelsLaidOut = false;
    this.container.innerHTML = '';
    const root = document.createElement('section');
    root.className = `ycm-strategic-map ycm-strategic-mode-${this.mode}`;
    if (this.calibrationMode) root.classList.add('is-calibration-mode');
    root.setAttribute('data-layout-authority', 'illustrative-only');

    const heading = document.createElement('div');
    heading.className = 'ycm-map-section-heading';
    const title = document.createElement('div');
    title.className = 'ycm-map-section-title';
    title.textContent = this.mode === 'world'
      ? `${this.worldData?.name || '天下'} · 六国舆图`
      : `${getNationDisplayName(this.nationData)} · 山河城邑`;
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
    viewport.setAttribute('aria-label', this.mode === 'world'
      ? '永初大陆六国地图'
      : `${getNationDisplayName(this.nationData, '国家')}城邑地图`);
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
      : `${getNationDisplayName(this.nationData)}疆域 · 城邑相连`;
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
    if (this.calibrationMode) {
      this._calibrationPanelEl = this._createCalibrationPanel();
      root.appendChild(this._calibrationPanelEl);
    }
    this.container.appendChild(root);
    this._rootEl = root;
    this.resetView();
    this._bindEvents();
    this._bindResizeObserver();
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
    this._renderWorldBorderLayer(mapWorld);
    const overlay = document.createElement('div');
    overlay.className = 'ycm-world-overlay';
    (this.worldData?.nations || []).forEach(nation => {
      const position = nation.visualCoord || WORLD_LAYOUT[nation.id];
      if (!position) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ycm-state-hotspot';
      button.setAttribute('data-nation-id', nation.id);
      button.setAttribute('aria-label', `查看${getNationDisplayName(nation)}`);
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

  _renderWorldBorderLayer(mapWorld) {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.classList.add('ycm-world-border-layer');
    svg.setAttribute('viewBox', `0 0 ${this.worldWidth} ${this.worldHeight}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('data-territory-authority', 'static-reference-v1');
    Object.entries(WORLD_BORDER_REGIONS).forEach(([nationId, pathData]) => {
      const path = document.createElementNS(namespace, 'path');
      path.classList.add('ycm-world-region');
      path.setAttribute('data-nation-id', nationId);
      path.setAttribute('d', pathData);
      svg.appendChild(path);
    });
    mapWorld.appendChild(svg);
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
    if (this.calibrationMode) {
      const preview = document.createElement('div');
      preview.className = 'ycm-calibration-preview';
      preview.setAttribute('aria-hidden', 'true');
      const previewDot = document.createElement('span');
      previewDot.className = 'ycm-calibration-preview-dot';
      const previewLabel = document.createElement('span');
      previewLabel.className = 'ycm-calibration-preview-label';
      preview.appendChild(previewDot);
      preview.appendChild(previewLabel);
      preview.hidden = true;
      citiesLayer.appendChild(preview);
      this._calibrationPreviewEl = preview;
    }
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
      name.textContent = this.mode === 'world' ? getNationDisplayName(record) : record.name;
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
    if (this.calibrationMode) {
      this._calibrationCityId = cityId;
      if (this._calibrationCitySelectEl) this._calibrationCitySelectEl.value = cityId;
      this._clearCalibrationPending();
    }
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

  _createCalibrationPanel() {
    const panel = document.createElement('section');
    panel.className = 'ycm-calibration-panel';
    panel.setAttribute('aria-label', 'visualCoord 开发标定');

    const header = document.createElement('div');
    header.className = 'ycm-calibration-header';
    const title = document.createElement('strong');
    title.textContent = 'visualCoord 标定（仅开发）';
    const warning = document.createElement('span');
    warning.textContent = '只生成 JSON，不写入正式数据文件';
    header.appendChild(title);
    header.appendChild(warning);
    panel.appendChild(header);

    const controls = document.createElement('div');
    controls.className = 'ycm-calibration-controls';
    const nationSelect = this._createCalibrationSelect('国家', (this.worldData?.nations || []).map(nation => ({
      value: nation.id,
      label: getNationDisplayName(nation)
    })), this.nationData?.id);
    nationSelect.select.addEventListener('change', () => {
      if (nationSelect.select.value !== this.nationData?.id) this.onCalibrationNationChange?.(nationSelect.select.value);
    });
    controls.appendChild(nationSelect.field);

    const citySelect = this._createCalibrationSelect('正式城市', (this.nationData?.cities || []).map(city => ({
      value: city.id,
      label: city.name
    })), this._calibrationCityId);
    this._calibrationCitySelectEl = citySelect.select;
    citySelect.select.addEventListener('change', () => this._chooseCalibrationCity(citySelect.select.value));
    controls.appendChild(citySelect.field);

    const coords = document.createElement('div');
    coords.className = 'ycm-calibration-coords';
    coords.textContent = '点击地图上的真实城池中心';
    this._calibrationCoordEl = coords;
    controls.appendChild(coords);
    panel.appendChild(controls);

    const actions = document.createElement('div');
    actions.className = 'ycm-calibration-actions';
    const previous = this._createCalibrationButton('上一个', () => this._stepCalibrationCity(-1));
    const next = this._createCalibrationButton('下一个', () => this._stepCalibrationCity(1));
    const retry = this._createCalibrationButton('重新点击', () => this._clearCalibrationPending());
    const confirm = this._createCalibrationButton('确认当前点', () => this._confirmCalibrationPoint(), 'is-primary');
    confirm.disabled = true;
    this._calibrationConfirmBtn = confirm;
    const copy = this._createCalibrationButton('复制 JSON', () => this._copyCalibrationJson(), 'is-copy');
    this._calibrationCopyBtn = copy;
    [previous, next, retry, confirm, copy].forEach(button => actions.appendChild(button));
    panel.appendChild(actions);

    const output = document.createElement('textarea');
    output.className = 'ycm-calibration-output';
    output.readOnly = true;
    output.spellcheck = false;
    output.setAttribute('aria-label', '当前国家 visualCoord JSON');
    this._calibrationOutputEl = output;
    panel.appendChild(output);
    this._refreshCalibrationOutput();
    return panel;
  }

  _createCalibrationSelect(labelText, options, selectedValue) {
    const field = document.createElement('label');
    field.className = 'ycm-calibration-field';
    const label = document.createElement('span');
    label.textContent = labelText;
    const select = document.createElement('select');
    options.forEach(optionData => {
      const option = document.createElement('option');
      option.value = optionData.value;
      option.textContent = optionData.label;
      select.appendChild(option);
    });
    select.value = selectedValue || options[0]?.value || '';
    field.appendChild(label);
    field.appendChild(select);
    return { field, select };
  }

  _createCalibrationButton(text, onClick, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ycm-calibration-button ${extraClass}`.trim();
    button.textContent = text;
    button.addEventListener('click', event => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  _chooseCalibrationCity(cityId) {
    if (!(this.nationData?.cities || []).some(city => city.id === cityId)) return;
    this._calibrationCityId = cityId;
    if (this._calibrationCitySelectEl) this._calibrationCitySelectEl.value = cityId;
    this._clearCalibrationPending();
    this._syncSelected('city', cityId);
  }

  _stepCalibrationCity(delta) {
    const cities = this.nationData?.cities || [];
    if (!cities.length) return;
    const currentIndex = Math.max(0, cities.findIndex(city => city.id === this._calibrationCityId));
    const nextIndex = (currentIndex + delta + cities.length) % cities.length;
    this._chooseCalibrationCity(cities[nextIndex].id);
  }

  _clearCalibrationPending() {
    this._calibrationPending = null;
    if (this._calibrationCoordEl) this._calibrationCoordEl.textContent = '点击地图上的真实城池中心';
    if (this._calibrationConfirmBtn) this._calibrationConfirmBtn.disabled = true;
    if (this._calibrationPreviewEl) this._calibrationPreviewEl.hidden = true;
  }

  _setCalibrationPoint(point) {
    if (!point || !this._calibrationCityId) return;
    this._calibrationPending = point;
    if (this._calibrationCoordEl) {
      this._calibrationCoordEl.textContent = `x ${point.x.toFixed(2)}% · y ${point.y.toFixed(2)}%`;
    }
    if (this._calibrationConfirmBtn) this._calibrationConfirmBtn.disabled = false;
    this._updateCalibrationPreview();
  }

  _confirmCalibrationPoint() {
    if (!this._calibrationPending || !this._calibrationCityId) return;
    this._calibrationDrafts.set(this._calibrationCityId, { ...this._calibrationPending });
    this._refreshCalibrationOutput();
    if (this._calibrationCoordEl) {
      this._calibrationCoordEl.textContent = `已确认 · x ${this._calibrationPending.x.toFixed(2)}% · y ${this._calibrationPending.y.toFixed(2)}%`;
    }
  }

  _updateCalibrationPreview() {
    if (!this._calibrationPreviewEl || !this._calibrationPending) return;
    const city = (this.nationData?.cities || []).find(item => item.id === this._calibrationCityId);
    this._calibrationPreviewEl.style.left = `${this._calibrationPending.x}%`;
    this._calibrationPreviewEl.style.top = `${this._calibrationPending.y}%`;
    const label = this._calibrationPreviewEl.querySelector('.ycm-calibration-preview-label');
    if (label) label.textContent = `${city?.name || this._calibrationCityId} · 预览`;
    this._calibrationPreviewEl.hidden = false;
  }

  _refreshCalibrationOutput() {
    if (!this._calibrationOutputEl) return;
    this._calibrationOutputEl.value = this.exportCalibrationJson();
  }

  exportCalibrationJson() {
    const result = {};
    (this.nationData?.cities || []).forEach(city => {
      const point = this._calibrationDrafts.get(city.id);
      result[city.id] = point ? {
        x: Number(point.x.toFixed(2)),
        y: Number(point.y.toFixed(2))
      } : null;
    });
    return JSON.stringify(result, null, 2);
  }

  async _copyCalibrationJson() {
    const text = this.exportCalibrationJson();
    let copied = false;
    try {
      if (globalThis.navigator?.clipboard?.writeText) {
        await globalThis.navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (_) {}
    if (!copied) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select?.();
      try { copied = document.execCommand?.('copy') === true; } catch (_) {}
      textarea.remove();
    }
    if (this._calibrationCopyBtn) this._calibrationCopyBtn.textContent = copied ? '已复制' : '请从文本框复制';
  }

  _clientPointToVisualCoord(clientX, clientY) {
    if (!this._viewportEl || !Number.isFinite(this.zoom) || this.zoom <= 0) return null;
    const rect = this._viewportEl.getBoundingClientRect();
    const mapX = (clientX - rect.left - (this._viewportEl.clientLeft || 0) - this.panX) / this.zoom;
    const mapY = (clientY - rect.top - (this._viewportEl.clientTop || 0) - this.panY) / this.zoom;
    if (mapX < 0 || mapY < 0 || mapX > this.worldWidth || mapY > this.worldHeight) return null;
    return {
      x: Number((mapX / this.worldWidth * 100).toFixed(2)),
      y: Number((mapY / this.worldHeight * 100).toFixed(2))
    };
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
    title.textContent = this.mode === 'world' ? getNationDisplayName(record) : record.name;
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
    void city;
    void index;
    void cities;
    return 'top';
  }

  _layoutCityLabels(force = false) {
    if (this.mode !== 'nation' || !this._rootEl || (this._labelsLaidOut && !force)) return;
    const occupied = [];
    const viewportWidth = this._viewportEl?.clientWidth || 700;
    const viewportHeight = this._viewportEl?.clientHeight || 500;
    const cities = this.nationData?.cities || [];
    const cityById = new Map(cities.map(city => [city.id, city]));
    const buttons = Array.from(this._rootEl.querySelectorAll('.ycm-nation-city'));

    const overlaps = (a, b) => !(
      a.right + 4 < b.left ||
      a.left - 4 > b.right ||
      a.bottom + 4 < b.top ||
      a.top - 4 > b.bottom
    );

    buttons.forEach(button => {
      const city = cityById.get(button.getAttribute('data-city-id'));
      if (!city?.visualCoord) return;
      const nameLength = Array.from(city.name || '').length;
      const width = Math.max(42, 18 + nameLength * (city.id === this.nationData?.capital_city_id ? 18 : 16));
      const height = city.id === this.nationData?.capital_city_id ? 30 : 28;
      const markerX = this.panX + city.visualCoord.x / 100 * this.worldWidth * this.zoom;
      const markerY = this.panY + city.visualCoord.y / 100 * this.worldHeight * this.zoom;
      const rectangles = {
        top: { left: markerX - width / 2, top: markerY - height - 25, right: markerX + width / 2, bottom: markerY - 25 },
        'top-right': { left: markerX + 10, top: markerY - height - 18, right: markerX + width + 10, bottom: markerY - 18 },
        'top-left': { left: markerX - width - 10, top: markerY - height - 18, right: markerX - 10, bottom: markerY - 18 },
        'bottom-right': { left: markerX + 10, top: markerY + 18, right: markerX + width + 10, bottom: markerY + height + 18 },
        'bottom-left': { left: markerX - width - 10, top: markerY + 18, right: markerX - 10, bottom: markerY + height + 18 }
      };
      const placement = LABEL_PLACEMENTS.find(candidate => {
        const rect = rectangles[candidate];
        const inside = rect.left >= 4 && rect.right <= viewportWidth - 4 && rect.top >= 4 && rect.bottom <= viewportHeight - 4;
        return inside && !occupied.some(other => overlaps(rect, other));
      }) || 'top';
      button.setAttribute('data-label-placement', placement);
      occupied.push(rectangles[placement]);
    });
    this._labelsLaidOut = true;
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
    this.minZoom = this._calculateCoverMinZoom(vw, vh);
    this.maxZoom = Math.max(2.2, this.minZoom * 2.5);
    this.fitZoom = this.minZoom;
    this.zoom = this.fitZoom;
    this.panX = (vw - this.worldWidth * this.zoom) / 2;
    this.panY = (vh - this.worldHeight * this.zoom) / 2;
    this._lastViewportWidth = vw;
    this._lastViewportHeight = vh;
    this._clampPan();
    this._updateTransform(true);
    this._layoutCityLabels(true);
  }

  _calculateCoverMinZoom(viewportWidth, viewportHeight) {
    const width = Math.max(1, Number(viewportWidth) || 1);
    const height = Math.max(1, Number(viewportHeight) || 1);
    return Math.max(width / this.worldWidth, height / this.worldHeight);
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
    this.panX = scaledW <= vw ? (vw - scaledW) / 2 : Math.min(0, Math.max(vw - scaledW, this.panX));
    this.panY = scaledH <= vh ? (vh - scaledH) / 2 : Math.min(0, Math.max(vh - scaledH, this.panY));
  }

  _updateTransform(animated) {
    if (!this._worldEl) return;
    this._worldEl.classList.toggle('is-animated', !!animated && !this._isDragging);
    this._worldEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    this._worldEl.style.setProperty('--ycm-overlay-inverse-scale', String(1 / this.zoom));
  }

  _bindResizeObserver() {
    if (!this._viewportEl) return;
    const handleResize = () => this._handleResize();
    if (typeof ResizeObserver === 'function') {
      this._resizeObserver = new ResizeObserver(handleResize);
      this._resizeObserver.observe(this._viewportEl);
      return;
    }
    if (typeof window !== 'undefined') {
      this._windowResizeHandler = handleResize;
      window.addEventListener('resize', handleResize);
    }
  }

  _unbindResizeObserver() {
    this._resizeObserver?.disconnect?.();
    this._resizeObserver = null;
    if (this._windowResizeHandler && typeof window !== 'undefined') {
      window.removeEventListener('resize', this._windowResizeHandler);
    }
    this._windowResizeHandler = null;
  }

  _handleResize() {
    if (!this._viewportEl) return;
    const vw = this._viewportEl.clientWidth || 700;
    const vh = this._viewportEl.clientHeight || 500;
    if (vw === this._lastViewportWidth && vh === this._lastViewportHeight) return;
    const previousWidth = this._lastViewportWidth || vw;
    const previousHeight = this._lastViewportHeight || vh;
    const centerMapX = (previousWidth / 2 - this.panX) / this.zoom;
    const centerMapY = (previousHeight / 2 - this.panY) / this.zoom;
    this.minZoom = this._calculateCoverMinZoom(vw, vh);
    this.maxZoom = Math.max(2.2, this.minZoom * 2.5);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
    this.fitZoom = this.minZoom;
    this.panX = vw / 2 - centerMapX * this.zoom;
    this.panY = vh / 2 - centerMapY * this.zoom;
    this._lastViewportWidth = vw;
    this._lastViewportHeight = vh;
    this._clampPan();
    this._updateTransform(false);
    this._layoutCityLabels(true);
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
      event.stopPropagation();
      const rect = this._viewportEl.getBoundingClientRect();
      this._setZoomAt(this.zoom + (event.deltaY < 0 ? 0.12 : -0.12), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    this._viewportEl.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      if (event.target?.closest?.(UI_CONTROL_SELECTOR)) return;
      this._isDragging = true;
      this._dragMoved = false;
      this._pointerStartX = event.clientX;
      this._pointerStartY = event.clientY;
      this._startX = event.clientX - this.panX;
      this._startY = event.clientY - this.panY;
      this._worldEl?.classList.remove('is-animated');
      this._viewportEl.classList.add('is-dragging');
      this._captureEl = this._viewportEl;
      try { this._captureEl.setPointerCapture?.(event.pointerId); } catch (_) {}
    });
    this._viewportEl.addEventListener('pointermove', event => {
      if (!this._isDragging) return;
      const deltaX = event.clientX - this._pointerStartX;
      const deltaY = event.clientY - this._pointerStartY;
      if (!this._dragMoved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) return;
      this._dragMoved = true;
      this.panX = event.clientX - this._startX;
      this.panY = event.clientY - this._startY;
      this._clampPan();
      this._updateTransform(false);
    });
    const stopDrag = (event, cancelled = false) => {
      if (!this._isDragging) return;
      const wasMoved = this._dragMoved;
      this._isDragging = false;
      this._viewportEl.classList.remove('is-dragging');
      try { this._captureEl?.releasePointerCapture?.(event.pointerId); } catch (_) {}
      this._captureEl = null;
      if (this.calibrationMode && !cancelled && !wasMoved) {
        this._setCalibrationPoint(this._clientPointToVisualCoord(event.clientX, event.clientY));
      }
    };
    this._viewportEl.addEventListener('pointerup', stopDrag);
    this._viewportEl.addEventListener('pointercancel', event => stopDrag(event, true));
  }

  _bindActivation(element, callback) {
    element.addEventListener('click', event => {
      event.stopPropagation();
      callback();
    });
  }

  _positionElement(element, position) {
    element.style.left = `${position.x}%`;
    element.style.top = `${position.y}%`;
    element.style.width = `${position.width}%`;
    element.style.height = `${position.height}%`;
  }

  destroy() {
    this._unbindResizeObserver();
    if (this.container) this.container.innerHTML = '';
    this._rootEl = null;
    this._viewportEl = null;
    this._worldEl = null;
    this._indexEl = null;
    this._detailEl = null;
  }
}

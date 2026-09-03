// ============================================================
// YonganCityMapRenderer.js —— 永安城可视化地图渲染器 (ESM)
// 职责：永安城 12×10 里视觉布局参考画布、视口平移缩放、8个城区与69地点映射、
//       当前物理位置 Marker、比例尺、地点详情浮窗与辅助索引联动。
// 严禁接管：MapStore 状态改变、travel、settlement、rollback。
// ============================================================

export default class YonganCityMapRenderer {
  constructor(options = {}) {
    this.container = options.container || null;
    this.cityData = options.cityData || null;
    this.locations = options.locations || [];
    this.currentLocationId = options.currentLocationId || null;
    this.onLocationClick = options.onLocationClick || null;

    // 视口平移与缩放 (Viewport State)
    this.zoom = 1.0;
    this.minZoom = 0.65;
    this.maxZoom = 2.5;
    this.panX = 0;
    this.panY = 0;

    // 拖拽平移交互状态
    this._isDragging = false;
    this._startX = 0;
    this._startY = 0;
    this._dragMoved = false;
    this._pointerStartX = 0;
    this._pointerStartY = 0;

    // DOM 缓存引用
    this._rootEl = null;
    this._viewportEl = null;
    this._worldEl = null;
    this._detailCardEl = null;
    this._selectedLocId = null;

    // 永安城基准尺寸（1000px × 750px 世界坐标）
    this.worldWidth = 1000;
    this.worldHeight = 750;

    // 仅用于画板的等比布局参考；不供 RouteEngine/TravelEngine 作世界几何。
    this.originX = 140;
    this.originY = 90;
    this.scaleX = 60;
    this.scaleY = 60;

    // 8 城区世界盒定义（基于 city.json 8 个城区）
    this.districtBounds = {
      city_center: { x: 380, y: 150, width: 240, height: 260 },
      city_east: { x: 620, y: 150, width: 240, height: 320 },
      city_south: { x: 220, y: 440, width: 440, height: 230 },
      city_west: { x: 160, y: 180, width: 220, height: 260 },
      luoshui_north: { x: 340, y: 350, width: 340, height: 60 },
      luoshui_south: { x: 300, y: 410, width: 460, height: 70 },
      jinshui_junction: { x: 360, y: 450, width: 120, height: 70 },
      west_suburb: { x: 20, y: 480, width: 140, height: 180 }
    };

    // 重点显眼地点名称集合（名称以 JSON 为准）
    this.keyLocationNames = new Set([
      '皇城', '昭国皇宫', '王府街', '旧家宅邸', '东市主街', '金汇街',
      '百草街', '富春坊', '锦绣街', '长风街', '凌霄阁', '旧家洛水泊位',
      '魏府水云坞', '四宜堂', '醉春楼', '洗心茶庄'
    ]);
  }

  locationToCanvasCoords(loc) {
    if (!loc) return null;
    // 只读取当前城市数据的顶层布局字段。legacy_reference 是溯源备注，不升格为权威坐标。
    const rawX = Number(loc.x);
    const rawY = Number(loc.y);
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;

    const px = this.originX + rawX * this.scaleX;
    const py = this.originY + (10 - rawY) * this.scaleY;

    return { x: Math.round(px), y: Math.round(py) };
  }

  init() {
    if (!this.container) return;
    this.render();
  }

  render() {
    this.container.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'ycm-city-view-container';

    // 1. 视口容器
    const viewport = document.createElement('div');
    viewport.className = 'ycm-map-viewport';
    this._viewportEl = viewport;

    // 2. 世界层
    const world = document.createElement('div');
    world.className = 'ycm-map-world' + (this.zoom < 1.1 ? ' zoom-low' : '');
    this._worldEl = world;

    // 2.1 背景层
    const bgLayer = document.createElement('div');
    bgLayer.className = 'ycm-layer-bg';
    bgLayer.innerHTML = this._generateBackgroundSvg();
    world.appendChild(bgLayer);

    // 2.2 城区层
    const districtsLayer = document.createElement('div');
    districtsLayer.className = 'ycm-layer-districts';
    this._renderDistricts(districtsLayer);
    world.appendChild(districtsLayer);

    // 2.3 地点层
    const locationsLayer = document.createElement('div');
    locationsLayer.className = 'ycm-layer-locations';
    this._renderLocations(locationsLayer);
    world.appendChild(locationsLayer);

    viewport.appendChild(world);

    // 2.4 控制器 (放大/缩小/重置)
    const controls = document.createElement('div');
    controls.className = 'ycm-map-controls';
    controls.setAttribute('role', 'toolbar');
    controls.setAttribute('aria-label', '地图视角控制');
    controls.innerHTML = `
      <button type="button" class="ycm-map-ctrl-btn" data-act="zoom-in" title="放大" aria-label="放大地图">+</button>
      <button type="button" class="ycm-map-ctrl-btn" data-act="zoom-out" title="缩小" aria-label="缩小地图">−</button>
      <button type="button" class="ycm-map-ctrl-btn" data-act="reset" title="重置视角" aria-label="重置地图视角">⟳</button>
    `;
    viewport.appendChild(controls);

    // 2.5 明确标注为布局示意，避免把画布误当精确测绘比例尺
    const scaleEl = document.createElement('div');
    scaleEl.className = 'ycm-map-scale';
    scaleEl.innerHTML = `
      <div class="ycm-scale-text">布局示意 · 非精确测绘</div>
    `;
    viewport.appendChild(scaleEl);

    // 3. 右侧地点抽屉侧边栏
    const drawer = document.createElement('div');
    drawer.className = 'ycm-side-drawer';
    this._renderDrawer(drawer);

    root.appendChild(viewport);
    root.appendChild(drawer);
    this.container.appendChild(root);
    this._rootEl = root;

    this.resetView();
    this._bindEvents();
  }

  _generateBackgroundSvg() {
    const northBlocks = [
      [180, 165, 5, 3], [175, 250, 5, 3], [650, 165, 5, 3], [655, 255, 5, 3],
      [260, 175, 4, 3], [270, 270, 4, 2], [690, 335, 5, 2]
    ].map(args => this._buildingCluster(...args, true)).join('');
    const southBlocks = [
      [235, 480, 4, 2], [330, 500, 4, 2], [535, 485, 4, 2], [650, 500, 4, 2],
      [240, 585, 3, 2], [450, 590, 4, 2], [650, 590, 3, 2]
    ].map(args => this._buildingCluster(...args, false)).join('');
    const palaceBuildings = [
      [430, 175, 140, 38], [448, 230, 104, 32], [463, 278, 74, 27]
    ].map(([x, y, w, h]) => this._palaceBuilding(x, y, w, h)).join('');
    return `
      <svg class="ycm-map-svg-bg" viewBox="0 0 1000 750" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="riverGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#527c83"/>
            <stop offset="50%" stop-color="#7fa2a0"/>
            <stop offset="100%" stop-color="#496f78"/>
          </linearGradient>
          <linearGradient id="cityPaper" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#b9a477"/>
            <stop offset="45%" stop-color="#d2c49e"/>
            <stop offset="100%" stop-color="#9e865d"/>
          </linearGradient>
          <filter id="cityShadow"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#201a12" flood-opacity=".5"/></filter>
          <pattern id="paperFibres" width="23" height="23" patternUnits="userSpaceOnUse">
            <path d="M0 7 L23 4 M3 19 L19 22" stroke="#604c31" stroke-width=".6" opacity=".12"/>
          </pattern>
        </defs>
        <rect width="1000" height="750" fill="#7c7257"/>
        <rect width="1000" height="750" fill="url(#paperFibres)"/>
        <!-- 城外山林与护城河：均来自 city.json 的景山/护城河资料 -->
        <path d="M55 130 Q125 42 205 121 Q275 18 355 116 Q430 30 501 116 Q585 14 665 119 Q750 36 837 123 Q902 72 955 143 L955 3 L45 3 Z" fill="#556349" opacity=".9"/>
        <path d="M108 74 L882 74 Q906 74 906 101 L906 682 Q906 714 875 714 L124 714 Q94 714 94 683 L94 108 Q94 77 108 74 Z" fill="none" stroke="#567d80" stroke-width="20" opacity=".82"/>
        <!-- 外城轮廓与角楼，不为未定名城门添加文字 -->
        <path d="M140 96 L860 96 L875 112 L875 676 L858 692 L142 692 L125 675 L125 113 Z" fill="url(#cityPaper)" stroke="#4a3828" stroke-width="12" filter="url(#cityShadow)"/>
        <path d="M145 110 L855 110 L860 118 L860 670 L850 678 L150 678 L140 668 L140 120 Z" fill="none" stroke="#806a45" stroke-width="3"/>
        <g fill="#3c2c21" stroke="#b79455" stroke-width="2">
          <path d="M112 120 L150 82 L188 120 Z"/><path d="M812 120 L850 82 L888 120 Z"/>
          <path d="M112 668 L150 630 L188 668 Z"/><path d="M812 668 L850 630 L888 668 Z"/>
        </g>
        <!-- 主干街路与街巷网络 -->
        <g fill="none" stroke="#846f4d" stroke-linecap="round">
          <path d="M500 118 L500 675" stroke-width="15"/><path d="M160 330 L840 330" stroke-width="12"/>
          <path d="M190 205 L810 205 M175 275 L825 275 M170 525 L830 525 M180 610 L820 610" stroke-width="7" opacity=".72"/>
          <path d="M235 120 L235 365 M320 120 L320 365 M680 120 L680 365 M765 120 L765 365" stroke-width="6" opacity=".68"/>
          <path d="M285 445 L285 670 M390 445 L390 670 M610 445 L610 670 M720 445 L720 670" stroke-width="6" opacity=".58"/>
        </g>
        <!-- 宫城建筑群 -->
        <rect x="395" y="130" width="210" height="193" rx="3" fill="#b59662" stroke="#722f25" stroke-width="6"/>
        ${palaceBuildings}
        <!-- 街区是画面：成组屋脊，不把 69 个地点各画成孤立房屋 -->
        <g opacity=".9">${northBlocks}</g>
        <g opacity=".76">${southBlocks}</g>
        <!-- 洛水、支流、无名渡船与沿岸泊位 -->
        <path d="M70 394 C230 370 380 422 510 397 C650 371 780 425 950 391" fill="none" stroke="url(#riverGrad)" stroke-width="58" stroke-linecap="round"/>
        <path d="M70 394 C230 370 380 422 510 397 C650 371 780 425 950 391" fill="none" stroke="#d2e0d5" stroke-width="2" opacity=".65"/>
        <path d="M410 482 Q422 438 464 408" fill="none" stroke="#668e8b" stroke-width="20" stroke-linecap="round"/>
        <g fill="#5d3e28" stroke="#d0b173" stroke-width="2">
          <path d="M232 372 l42 0 l-8 12 l-27 0 Z"/><path d="M690 414 l44 0 l-9 12 l-27 0 Z"/>
          <path d="M355 419 q18 11 36 0 l-7 12 h-22 Z"/><path d="M775 369 q18 11 36 0 l-7 12 h-22 Z"/>
        </g>
        <!-- 城外西郊疏林 -->
        <path d="M25 490 Q75 432 119 495 L119 691 L20 691 Z" fill="#596347" opacity=".78"/>
        <g fill="#354630"><circle cx="48" cy="522" r="14"/><circle cx="86" cy="555" r="18"/><circle cx="44" cy="620" r="20"/><circle cx="95" cy="662" r="15"/></g>
      </svg>
    `;
  }

  _buildingCluster(x, y, columns, rows, dense) {
    let markup = '<g class="ycm-building-cluster">';
    const stepX = dense ? 33 : 42;
    const stepY = dense ? 29 : 38;
    const width = dense ? 25 : 30;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const bx = x + col * stepX + (row % 2) * 5;
        const by = y + row * stepY;
        markup += `<path d="M${bx} ${by + 9} l${width / 2} -9 l${width / 2} 9 v12 h-${width} Z"/>`;
      }
    }
    return `${markup}</g>`;
  }

  _palaceBuilding(x, y, width, height) {
    return `<g class="ycm-palace-building"><path d="M${x - 8} ${y + 10} L${x + width / 2} ${y - 5} L${x + width + 8} ${y + 10} Z"/><rect x="${x}" y="${y + 10}" width="${width}" height="${height - 10}"/></g>`;
  }


  _renderDistricts(container) {
    const districts = this.cityData?.districts || [];
    districts.forEach(d => {
      const bound = this.districtBounds[d.id];
      if (!bound) return;

      const el = document.createElement('div');
      el.className = 'ycm-district-zone';
      el.id = `ycm-dist-${d.id}`;
      el.style.left = `${bound.x}px`;
      el.style.top = `${bound.y}px`;
      el.style.width = `${bound.width}px`;
      el.style.height = `${bound.height}px`;

      const label = document.createElement('div');
      label.className = 'ycm-district-label';
      label.textContent = d.name;
      el.appendChild(label);

      el.addEventListener('click', () => {
        if (!this._dragMoved) {
          this.focusDistrict(d.id);
        }
      });

      container.appendChild(el);
    });
  }

  _renderLocations(container) {
    const locations = this.locations || [];
    locations.forEach(loc => {
      const coords = this.locationToCanvasCoords(loc);
      if (!coords) return;
      const isKey = this.keyLocationNames.has(loc.name);
      const isCurrent = loc.id === this.currentLocationId;
      const isRoyal = loc.category === 'royal' || loc.id === 'huangcheng' || loc.id === 'zhaoguo_huanggong';
      const isWater = loc.district_id === 'luoshui_north' || loc.district_id === 'luoshui_south' || loc.district_id === 'jinshui_junction';

      const marker = document.createElement('div');
      const isSelected = loc.id === this._selectedLocId;
      marker.className = `ycm-map-marker ${isKey ? 'is-key' : 'non-key'} ${isCurrent ? 'is-current-pos' : ''} ${isSelected ? 'is-selected' : ''} ${isRoyal ? 'is-royal' : ''} ${isWater ? 'is-water' : ''}`;
      marker.id = `ycm-marker-${loc.id}`;
      marker.setAttribute('data-loc-id', loc.id);
      marker.setAttribute('role', 'button');
      marker.setAttribute('tabindex', '0');
      marker.setAttribute('aria-label', `查看地点：${loc.name || ''}`);
      marker.style.left = `${coords.x}px`;
      marker.style.top = `${coords.y}px`;

      const dot = document.createElement('div');
      dot.className = 'ycm-marker-dot';
      marker.appendChild(dot);

      const label = document.createElement('div');
      label.className = 'ycm-marker-label';
      label.textContent = (isCurrent ? '📍 ' : '') + loc.name;
      marker.appendChild(label);

      const activate = (e) => {
        e.stopPropagation();
        if (!this._dragMoved) {
          this.focusLocation(loc.id);
          this.showLocationDetail(loc);
          if (this.onLocationClick) {
            this.onLocationClick(loc);
          }
        }
      };
      marker.addEventListener('click', activate);
      marker.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        activate(e);
      });

      container.appendChild(marker);
    });
  }

  _renderDrawer(container) {
    container.innerHTML = `
      <div class="ycm-drawer-header">
        <div class="ycm-drawer-title">永安地点 (${this.locations.length})</div>
      </div>
      <input type="text" class="ycm-drawer-search" placeholder="搜寻地点..." />
      <div class="ycm-drawer-list" id="ycm-drawer-list-el"></div>
    `;

    const listEl = container.querySelector('#ycm-drawer-list-el');
    const searchInput = container.querySelector('.ycm-drawer-search');

    const renderList = (filterText = '') => {
      listEl.innerHTML = '';
      const filtered = this.locations.filter(l => {
        if (!filterText) return true;
        const ft = filterText.toLowerCase();
        return (l.name && l.name.toLowerCase().includes(ft)) ||
               (l.official_name && l.official_name.toLowerCase().includes(ft)) ||
               (l.street && l.street.toLowerCase().includes(ft)) ||
               (l.category && l.category.toLowerCase().includes(ft));
      });

      filtered.forEach(loc => {
        const item = document.createElement('div');
        const isCurrent = loc.id === this.currentLocationId;
        const isSelected = loc.id === this._selectedLocId;
        item.className = `ycm-drawer-item ${isCurrent ? 'is-current' : ''} ${isSelected ? 'active' : ''}`;
        item.setAttribute('data-id', loc.id);
        const name = document.createElement('div');
        name.className = 'ycm-drawer-item-name';
        name.textContent = (isCurrent ? '📍 ' : '') + (loc.name || '');
        const category = document.createElement('div');
        category.className = 'ycm-drawer-item-cat';
        category.textContent = loc.category || '';
        item.appendChild(name);
        item.appendChild(category);
        item.addEventListener('click', () => {
          this.focusLocation(loc.id);
          this.showLocationDetail(loc);
        });
        listEl.appendChild(item);
      });
    };

    renderList();

    searchInput.addEventListener('input', (e) => {
      renderList(e.target.value.trim());
    });
  }

  showLocationDetail(loc) {
    if (!this._viewportEl) return;
    this._selectLocation(loc.id);

    if (this._detailCardEl) {
      this._detailCardEl.remove();
      this._detailCardEl = null;
    }

    const card = document.createElement('div');
    card.className = 'ycm-detail-card';

    const districtObj = this.cityData?.districts?.find(d => d.id === loc.district_id);
    const districtName = districtObj ? districtObj.name : loc.district_id;

    const header = document.createElement('div');
    header.className = 'ycm-detail-header';
    const heading = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'ycm-detail-title';
    title.textContent = loc.name || '';
    heading.appendChild(title);
    if (loc.official_name && loc.official_name !== loc.name) {
      const official = document.createElement('div');
      official.className = 'ycm-detail-official';
      official.textContent = `正式定名：${loc.official_name}`;
      heading.appendChild(official);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ycm-detail-close';
    close.title = '关闭详情';
    close.textContent = '✕';
    header.appendChild(heading);
    header.appendChild(close);
    card.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'ycm-detail-meta-row';
    const addBadge = (text) => {
      const badge = document.createElement('span');
      badge.className = 'ycm-detail-badge';
      badge.textContent = text;
      meta.appendChild(badge);
    };
    addBadge(`城区：${districtName || '未知'}`);
    if (loc.street) addBadge(`街巷：${loc.street}`);
    addBadge(`类型：${loc.category || '通用'}`);
    card.appendChild(meta);

    const desc = document.createElement('div');
    desc.className = 'ycm-detail-desc';
    desc.textContent = loc.atmosphere || '暂无该地点风貌概述。';
    card.appendChild(desc);
    if (Array.isArray(loc.sub_areas) && loc.sub_areas.length > 0) {
      const subAreas = document.createElement('div');
      subAreas.className = 'ycm-detail-subareas';
      subAreas.textContent = `内含区域：${loc.sub_areas.join('、')}`;
      card.appendChild(subAreas);
    }
    const actions = document.createElement('div');
    actions.className = 'ycm-detail-actions';
    const destination = document.createElement('button');
    destination.type = 'button';
    destination.className = 'ycm-btn-dest-disabled';
    destination.disabled = true;
    destination.title = '本轮未开放移动逻辑';
    destination.textContent = '设为目的地 (后续接入)';
    actions.appendChild(destination);
    card.appendChild(actions);

    close.addEventListener('click', () => {
      card.remove();
      this._detailCardEl = null;
    });

    this._viewportEl.appendChild(card);
    this._detailCardEl = card;

    if (this._rootEl) {
      const items = this._rootEl.querySelectorAll('.ycm-drawer-item');
      items.forEach(it => {
        if (it.getAttribute('data-id') === loc.id) {
          it.classList.add('active');
        } else {
          it.classList.remove('active');
        }
      });
    }
  }

  focusLocation(locationId) {
    const loc = this.locations.find(l => l.id === locationId);
    if (!loc) return;
    this._selectLocation(locationId);
    const coords = this.locationToCanvasCoords(loc);
    if (!coords) return;
    this.focusCoordinates(coords.x, coords.y, 1.4);
  }

  _selectLocation(locationId) {
    this._selectedLocId = locationId;
    if (!this._rootEl) return;
    this._rootEl.querySelectorAll('.ycm-map-marker').forEach(marker => {
      const selected = marker.getAttribute('data-loc-id') === locationId;
      if (marker.classList?.toggle) marker.classList.toggle('is-selected', selected);
    });
    this._rootEl.querySelectorAll('.ycm-drawer-item').forEach(item => {
      const selected = item.getAttribute('data-id') === locationId;
      if (item.classList?.toggle) item.classList.toggle('active', selected);
    });
  }

  focusDistrict(districtId) {
    const bound = this.districtBounds[districtId];
    if (!bound) return;
    const cx = bound.x + bound.width / 2;
    const cy = bound.y + bound.height / 2;
    this.focusCoordinates(cx, cy, 1.3);
  }

  focusCoordinates(targetX, targetY, targetZoom = this.zoom) {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, targetZoom));
    const vw = this._viewportEl ? (this._viewportEl.clientWidth || 600) : 600;
    const vh = this._viewportEl ? (this._viewportEl.clientHeight || 500) : 500;

    this.panX = vw / 2 - targetX * this.zoom;
    this.panY = vh / 2 - targetY * this.zoom;
    this._updateTransform();
  }

  resetView() {
    this.zoom = 1.0;
    if (this._viewportEl) {
      const vw = this._viewportEl.clientWidth || 600;
      const vh = this._viewportEl.clientHeight || 500;
      this.panX = (vw - this.worldWidth * this.zoom) / 2;
      this.panY = (vh - this.worldHeight * this.zoom) / 2;
    } else {
      this.panX = 0;
      this.panY = 0;
    }
    this._updateTransform();
  }

  _bindEvents() {
    if (!this._viewportEl) return;

    const controls = this._viewportEl.querySelector('.ycm-map-controls');
    if (controls) {
      controls.addEventListener('click', (e) => {
        const btn = e.target.closest('.ycm-map-ctrl-btn');
        if (!btn) return;
        const act = btn.getAttribute('data-act');
        if (act === 'zoom-in') this.zoomIn();
        if (act === 'zoom-out') this.zoomOut();
        if (act === 'reset') this.resetView();
      });
    }

    this._viewportEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this._viewportEl.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom + delta));
      if (newZoom === this.zoom) return;

      const scaleRatio = newZoom / this.zoom;
      this.panX = mouseX - (mouseX - this.panX) * scaleRatio;
      this.panY = mouseY - (mouseY - this.panY) * scaleRatio;
      this.zoom = newZoom;
      this._updateTransform();
    }, { passive: false });

    this._viewportEl.addEventListener('pointerdown', (e) => {
      const target = e.target;
      if (target?.closest?.('.ycm-map-controls') || target?.closest?.('.ycm-detail-card')) return;
      this._isDragging = true;
      this._pointerStartX = e.clientX;
      this._pointerStartY = e.clientY;
      this._startX = e.clientX - this.panX;
      this._startY = e.clientY - this.panY;
      this._dragMoved = false;
      if (typeof this._viewportEl.setPointerCapture === 'function') {
        try { this._viewportEl.setPointerCapture(e.pointerId); } catch (_) {}
      }
    });

    this._viewportEl.addEventListener('pointermove', (e) => {
      if (!this._isDragging) return;
      const newPanX = e.clientX - this._startX;
      const newPanY = e.clientY - this._startY;
      if (Math.abs(e.clientX - this._pointerStartX) > 3 || Math.abs(e.clientY - this._pointerStartY) > 3) {
        this._dragMoved = true;
      }
      this.panX = newPanX;
      this.panY = newPanY;
      this._updateTransform();
    });

    const stopDrag = (e) => {
      if (this._isDragging) {
        this._isDragging = false;
        if (typeof this._viewportEl.releasePointerCapture === 'function') {
          try { this._viewportEl.releasePointerCapture(e.pointerId); } catch (_) {}
        }
      }
    };

    this._viewportEl.addEventListener('pointerup', stopDrag);
    this._viewportEl.addEventListener('pointercancel', stopDrag);
  }

  zoomIn() {
    this.zoom = Math.min(this.maxZoom, this.zoom + 0.2);
    this._updateTransform();
  }

  zoomOut() {
    this.zoom = Math.max(this.minZoom, this.zoom - 0.2);
    this._updateTransform();
  }

  _updateTransform() {
    if (!this._worldEl) return;
    this._worldEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    if (this.zoom < 1.1) {
      this._worldEl.classList.add('zoom-low');
    } else {
      this._worldEl.classList.remove('zoom-low');
    }
  }

  destroy() {
    if (this._detailCardEl) {
      this._detailCardEl.remove();
      this._detailCardEl = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
    this._rootEl = null;
    this._viewportEl = null;
    this._worldEl = null;
  }
}

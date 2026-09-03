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
    controls.innerHTML = `
      <button type="button" class="ycm-map-ctrl-btn" data-act="zoom-in" title="放大">+</button>
      <button type="button" class="ycm-map-ctrl-btn" data-act="zoom-out" title="缩小">-</button>
      <button type="button" class="ycm-map-ctrl-btn" data-act="reset" title="重置视角">⊙</button>
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
    return `
      <svg class="ycm-map-svg-bg" viewBox="0 0 1000 750" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="riverGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#1b4965" stop-opacity="0.8"/>
            <stop offset="50%" stop-color="#2a6f97" stop-opacity="0.9"/>
            <stop offset="100%" stop-color="#1b4965" stop-opacity="0.8"/>
          </linearGradient>
          <linearGradient id="wallGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#3d372e"/>
            <stop offset="100%" stop-color="#231f1a"/>
          </linearGradient>
          <linearGradient id="mountainGrad" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#1c251f" stop-opacity="0.7"/>
            <stop offset="100%" stop-color="#0e1410" stop-opacity="0.9"/>
          </linearGradient>
        </defs>

        <!-- 北部背景：景山山峦叠嶂 -->
        <path d="M 80,120 Q 220,30 380,80 T 680,60 T 920,110 L 920,130 L 80,130 Z" fill="url(#mountainGrad)"/>
        <path d="M 280,110 Q 480,20 620,90 L 620,130 L 280,130 Z" fill="#141c16" opacity="0.6"/>
        <text x="500" y="70" fill="#6d8374" font-size="16" font-weight="700" letter-spacing="4" text-anchor="middle">景 山</text>

        <!-- 永安城外城墙示意 (东西12里，南北10里，等比布局) -->
        <rect x="140" y="90" width="720" height="600" rx="10" ry="10" fill="none" stroke="url(#wallGrad)" stroke-width="8"/>
        <rect x="144" y="94" width="712" height="592" rx="8" ry="8" fill="none" stroke="#d4af37" stroke-width="1" stroke-opacity="0.4"/>

        <!-- 皇城内城墙 (偏北中轴) -->
        <rect x="380" y="140" width="240" height="200" fill="rgba(140,45,25,0.06)" stroke="#8c2d19" stroke-width="3" stroke-dasharray="6 3"/>

        <!-- 中央主轴线：承天门大街 (贯通南北) -->
        <line x1="500" y1="340" x2="500" y2="690" stroke="#8a7353" stroke-width="6" stroke-opacity="0.6"/>

        <!-- 洛水穿城而过 (自西向东东西横贯) -->
        <path d="M 80,390 C 250,380 400,410 500,400 C 620,390 780,415 950,400" fill="none" stroke="url(#riverGrad)" stroke-width="32" stroke-linecap="round"/>
        <path d="M 80,390 C 250,380 400,410 500,400 C 620,390 780,415 950,400" fill="none" stroke="#48cae4" stroke-width="2" stroke-opacity="0.6" stroke-dasharray="8 6"/>
        <text x="320" y="396" fill="#90e0ef" font-size="14" font-weight="700" letter-spacing="4">洛 水 ─── 自西向东穿城</text>

        <!-- 金水支流汇流处 -->
        <path d="M 410,480 Q 420,430 460,405" fill="none" stroke="#1b4965" stroke-width="14" stroke-linecap="round"/>

        <!-- 城外西郊 -->
        <path d="M 40,460 Q 90,440 120,530 T 40,680 Z" fill="#18221c" stroke="#2d4233" stroke-width="1.5"/>
      </svg>
    `;
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
      marker.className = `ycm-map-marker ${isKey ? 'is-key' : 'non-key'} ${isCurrent ? 'is-current-pos' : ''} ${isRoyal ? 'is-royal' : ''} ${isWater ? 'is-water' : ''}`;
      marker.id = `ycm-marker-${loc.id}`;
      marker.setAttribute('data-loc-id', loc.id);
      marker.style.left = `${coords.x}px`;
      marker.style.top = `${coords.y}px`;

      const dot = document.createElement('div');
      dot.className = 'ycm-marker-dot';
      marker.appendChild(dot);

      const label = document.createElement('div');
      label.className = 'ycm-marker-label';
      label.textContent = (isCurrent ? '📍 ' : '') + loc.name;
      marker.appendChild(label);

      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this._dragMoved) {
          this.showLocationDetail(loc);
          if (this.onLocationClick) {
            this.onLocationClick(loc);
          }
        }
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
    const coords = this.locationToCanvasCoords(loc);
    if (!coords) return;
    this.focusCoordinates(coords.x, coords.y, 1.4);
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

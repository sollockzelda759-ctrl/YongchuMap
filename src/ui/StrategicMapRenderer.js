// ============================================================
// StrategicMapRenderer.js —— 世界/国家层舆图展示器
// 仅负责非权威视觉布局与数据展示，不向任何路线/旅行逻辑提供几何。
// ============================================================

const WORLD_LAYOUT = {
  yan:       { x: 50, y: 19, shape: '10% 28%, 30% 5%, 72% 4%, 96% 34%, 82% 91%, 38% 96%, 5% 65%' },
  liang:     { x: 21, y: 48, shape: '8% 20%, 46% 3%, 94% 22%, 88% 75%, 54% 97%, 5% 72%' },
  zhao_guo: { x: 49, y: 48, shape: '9% 18%, 48% 2%, 92% 17%, 98% 68%, 70% 96%, 22% 91%, 3% 54%' },
  zhao:      { x: 78, y: 39, shape: '18% 4%, 74% 8%, 98% 38%, 87% 90%, 39% 97%, 3% 62%' },
  chu:       { x: 37, y: 76, shape: '5% 24%, 40% 3%, 92% 15%, 97% 62%, 63% 97%, 18% 88%' },
  chen:      { x: 72, y: 75, shape: '9% 20%, 54% 2%, 94% 29%, 87% 84%, 44% 97%, 3% 61%' }
};

const NATION_LAYOUT = {
  qingbicheng: { x: 49, y: 14 }, yunling: { x: 51, y: 26 },
  luokou: { x: 15, y: 45 }, fengshui: { x: 32, y: 46 },
  pingchuan: { x: 43, y: 38 }, yongan: { x: 53, y: 52 },
  heqing: { x: 60, y: 43 }, dongqiu: { x: 83, y: 45 },
  shimen: { x: 73, y: 59 }, bailu: { x: 55, y: 64 },
  nanxi: { x: 31, y: 72 }, dujiang: { x: 46, y: 84 },
  linlan: { x: 69, y: 82 }
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export default class StrategicMapRenderer {
  constructor(options = {}) {
    this.container = options.container || null;
    this.mode = options.mode || 'world';
    this.worldData = options.worldData || null;
    this.nationData = options.nationData || null;
    this.onNationClick = options.onNationClick || null;
    this.onCityClick = options.onCityClick || null;
    this._selectedId = null;
  }

  init() {
    if (!this.container) return;
    this.render();
  }

  render() {
    this.container.innerHTML = '';
    const root = document.createElement('section');
    root.className = `ycm-strategic-map ycm-strategic-${this.mode}`;
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
    note.textContent = '布局示意 · 地名与地理信息以正式资料为准';
    heading.appendChild(title);
    heading.appendChild(note);
    root.appendChild(heading);

    const surface = document.createElement('div');
    surface.className = 'ycm-strategic-surface';
    surface.setAttribute('role', 'group');
    surface.setAttribute('aria-label', this.mode === 'world' ? '永初大陆六国地图' : '昭国十三城地图');
    if (this.mode === 'world') this._renderWorld(surface);
    else this._renderNation(surface);
    root.appendChild(surface);

    const index = document.createElement('div');
    index.className = 'ycm-strategic-index';
    this._renderIndex(index);
    root.appendChild(index);
    this.container.appendChild(root);
  }

  _renderWorld(surface) {
    surface.appendChild(this._worldTerrainSvg());
    const nations = this.worldData?.nations || [];
    nations.forEach(nation => {
      const layout = WORLD_LAYOUT[nation.id];
      if (!layout) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ycm-state-region ycm-state-${nation.id}`;
      button.setAttribute('data-nation-id', nation.id);
      button.setAttribute('aria-label', `查看${nation.fullName || nation.name}`);
      button.style.left = `${layout.x}%`;
      button.style.top = `${layout.y}%`;
      button.style.setProperty('--ycm-region-shape', `polygon(${layout.shape})`);

      const glyph = document.createElement('span');
      glyph.className = 'ycm-state-glyph';
      // 地图表面严格只使用 world.json 中的单字国号。
      glyph.textContent = nation.name || '';
      button.appendChild(glyph);

      const capital = (nation.keyCities || []).find(city => city.id === nation.capital);
      if (capital) {
        const capitalEl = document.createElement('span');
        capitalEl.className = 'ycm-capital-label';
        capitalEl.textContent = `◆ ${capital.name}`;
        button.appendChild(capitalEl);
      }
      button.addEventListener('click', () => this.onNationClick?.(nation.id));
      surface.appendChild(button);
    });
  }

  _worldTerrainSvg() {
    const svg = this._svg('svg', { class: 'ycm-strategic-terrain', viewBox: '0 0 1000 620', 'aria-hidden': 'true' });
    const defs = this._svg('defs');
    const paper = this._svg('radialGradient', { id: 'ycm-paper-light', cx: '48%', cy: '42%', r: '74%' });
    paper.appendChild(this._svg('stop', { offset: '0%', 'stop-color': '#e7d9b7' }));
    paper.appendChild(this._svg('stop', { offset: '100%', 'stop-color': '#a88d61' }));
    defs.appendChild(paper);
    svg.appendChild(defs);
    svg.appendChild(this._svg('path', { d: 'M93 112 C180 37 350 30 487 48 C658 20 827 68 901 175 C961 261 927 400 848 483 C741 586 567 580 447 557 C291 597 137 537 78 421 C23 314 32 186 93 112 Z', fill: 'url(#ycm-paper-light)', stroke: '#6d5437', 'stroke-width': '7' }));

    const features = this.worldData?.natural_features || {};
    const mountains = features.mountain_ranges || [];
    if (mountains[0]) {
      svg.appendChild(this._svg('path', { class: 'ycm-terrain-mountain', d: 'M245 228 Q285 173 323 225 Q366 155 410 226 Q452 171 501 230 Q545 181 589 233 Q632 190 674 241' }));
      svg.appendChild(this._svgText(458, 185, mountains[0].name, 'ycm-terrain-label'));
    }
    const rivers = features.rivers || [];
    if (rivers[0]) {
      svg.appendChild(this._svg('path', { class: 'ycm-terrain-river', d: 'M132 332 C292 296 381 341 507 322 S742 337 880 295' }));
      svg.appendChild(this._svgText(430, 305, rivers[0].name, 'ycm-terrain-label ycm-water-label'));
    }
    if (rivers[1]) {
      svg.appendChild(this._svg('path', { class: 'ycm-terrain-river ycm-river-wide', d: 'M191 442 C357 416 493 467 632 444 S783 458 868 425' }));
      svg.appendChild(this._svgText(698, 430, rivers[1].name, 'ycm-terrain-label ycm-water-label'));
    }
    const waters = features.waters || [];
    if (waters[0]) {
      svg.appendChild(this._svg('path', { class: 'ycm-terrain-water', d: 'M286 455 C238 430 220 488 257 515 C298 545 357 516 354 477 C350 449 320 440 286 455 Z' }));
      svg.appendChild(this._svgText(288, 490, waters[0].name, 'ycm-terrain-label ycm-water-label'));
    }
    return svg;
  }

  _renderNation(surface) {
    surface.appendChild(this._nationTerrainSvg());
    const cities = this.nationData?.cities || [];
    cities.forEach(city => {
      const layout = NATION_LAYOUT[city.id];
      if (!layout) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ycm-nation-city';
      if (city.id === this.nationData?.capital_city_id) button.classList.add('is-capital');
      button.setAttribute('data-city-id', city.id);
      button.setAttribute('aria-label', `查看${city.name}城`);
      button.style.left = `${layout.x}%`;
      button.style.top = `${layout.y}%`;
      const dot = document.createElement('span');
      dot.className = 'ycm-nation-city-dot';
      const label = document.createElement('span');
      label.className = 'ycm-nation-city-name';
      label.textContent = city.name;
      button.appendChild(dot);
      button.appendChild(label);
      button.addEventListener('click', () => {
        this._selectedId = city.id;
        this._setSelected(surface, '.ycm-nation-city', 'data-city-id', city.id);
        this.onCityClick?.(city.id);
      });
      surface.appendChild(button);
    });
  }

  _nationTerrainSvg() {
    const svg = this._svg('svg', { class: 'ycm-strategic-terrain', viewBox: '0 0 1000 620', 'aria-hidden': 'true' });
    const features = this.worldData?.natural_features || {};
    const qingpingName = (features.mountain_ranges || []).find(item => item.id === 'qingping_mountains')?.name;
    const luoshuiName = (features.rivers || []).find(item => item.id === 'luoshui')?.name;
    const lanjiangName = (features.rivers || []).find(item => item.id === 'lanjiang')?.name;
    svg.appendChild(this._svg('path', { d: 'M111 85 C268 26 548 29 763 76 C897 116 941 240 897 358 C859 481 738 560 571 573 C394 590 205 552 112 453 C35 367 34 179 111 85 Z', class: 'ycm-nation-land' }));
    svg.appendChild(this._svg('path', { class: 'ycm-terrain-mountain', d: 'M120 115 Q170 58 214 119 Q264 51 312 120 Q360 62 410 121 Q463 54 512 120 Q569 59 617 125 Q675 70 727 131 Q780 80 841 139' }));
    if (qingpingName) svg.appendChild(this._svgText(470, 78, qingpingName, 'ycm-terrain-label'));
    svg.appendChild(this._svg('path', { class: 'ycm-terrain-river', d: 'M95 292 C243 269 348 306 474 289 S713 313 900 274' }));
    if (luoshuiName) svg.appendChild(this._svgText(268, 274, luoshuiName, 'ycm-terrain-label ycm-water-label'));
    svg.appendChild(this._svg('path', { class: 'ycm-terrain-river ycm-river-wide', d: 'M86 506 C245 474 395 528 558 501 S754 523 910 483' }));
    if (lanjiangName) svg.appendChild(this._svgText(720, 495, lanjiangName, 'ycm-terrain-label ycm-water-label'));
    svg.appendChild(this._svg('path', { class: 'ycm-east-hills', d: 'M760 185 Q800 140 835 185 T895 210 M778 235 Q815 195 850 238 T910 255 M770 292 Q810 250 848 292 T905 310' }));

    (this.nationData?.internal_routes || []).forEach(route => {
      const ids = [route.from, ...(route.via || []), route.to];
      const points = ids.map(id => NATION_LAYOUT[id]).filter(Boolean);
      for (let i = 1; i < points.length; i++) {
        svg.appendChild(this._svg('line', {
          class: 'ycm-nation-route', x1: points[i - 1].x * 10, y1: points[i - 1].y * 6.2,
          x2: points[i].x * 10, y2: points[i].y * 6.2
        }));
      }
    });
    return svg;
  }

  _renderIndex(container) {
    const records = this.mode === 'world' ? (this.worldData?.nations || []) : (this.nationData?.cities || []);
    records.forEach(record => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ycm-strategic-index-item';
      button.setAttribute(this.mode === 'world' ? 'data-index-nation-id' : 'data-index-city-id', record.id);
      const name = document.createElement('strong');
      name.textContent = this.mode === 'world' ? (record.fullName || record.name) : record.name;
      const meta = document.createElement('span');
      meta.textContent = this.mode === 'world'
        ? (record.geographicPosition || '地理资料待考')
        : (record.type || record.position_in_nation || '城邑');
      button.appendChild(name);
      button.appendChild(meta);
      button.addEventListener('click', () => {
        if (this.mode === 'world') this.onNationClick?.(record.id);
        else this.onCityClick?.(record.id);
      });
      container.appendChild(button);
    });
  }

  _setSelected(root, selector, attribute, id) {
    root.querySelectorAll(selector).forEach(item => {
      item.classList.toggle('is-selected', item.getAttribute(attribute) === id);
    });
  }

  _svg(tag, attributes = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }

  _svgText(x, y, content, className) {
    const text = this._svg('text', { x, y, class: className });
    text.textContent = content;
    return text;
  }

  destroy() {
    if (this.container) this.container.innerHTML = '';
  }
}

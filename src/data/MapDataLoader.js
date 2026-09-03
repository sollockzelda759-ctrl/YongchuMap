// ============================================================
// MapDataLoader.js —— 轻量只读地图数据加载器 (ESM)
// 职责：JSON 加载、相对路径解析与内存缓存
// 严禁接管：MapStore, travel, settlement, rollback, map_event
// ============================================================

export default class MapDataLoader {
  constructor() {
    this._cache = new Map();
    this._nodeFs = null;
    this._fileURLToPath = null;
    this._nodeSupportPromise = null;
  }

  // Node 支持必须延迟加载；浏览器原生 ESM 无法解析静态的 Node "module" 导入。
  async _ensureNodeSupport() {
    if (typeof window !== 'undefined' || typeof process === 'undefined') return;
    if (!this._nodeSupportPromise) {
      this._nodeSupportPromise = Promise.all([
        import('node:fs'),
        import('node:url')
      ]).then(([fsMod, urlMod]) => {
        this._nodeFs = fsMod.default || fsMod;
        this._fileURLToPath = urlMod.fileURLToPath;
      });
    }
    await this._nodeSupportPromise;
  }

  // ── 通用底层 JSON 加载 ──
  async _loadJson(urlObj) {
    await this._ensureNodeSupport();
    const urlStr = urlObj.href;
    if (this._cache.has(urlStr)) {
      return this._cache.get(urlStr);
    }

    let data = null;
    if (this._nodeFs && (urlObj.protocol === 'file:' || typeof window === 'undefined')) {
      const filePath = this._fileURLToPath ? this._fileURLToPath(urlObj) : urlObj.pathname;
      const content = this._nodeFs.readFileSync(filePath, 'utf8');
      data = JSON.parse(content);
    } else {
      const res = await fetch(urlObj);
      if (!res.ok) {
        throw new Error(`加载数据失败 HTTP ${res.status}: ${urlStr}`);
      }
      data = await res.json();
    }

    this._cache.set(urlStr, data);
    return data;
  }

  // ── 解析并安全加载，带回退 Base ──
  async _resolveAndLoad(relPath, baseUrls) {
    await this._ensureNodeSupport();
    const bases = Array.isArray(baseUrls) ? baseUrls : [baseUrls];
    for (const base of bases) {
      if (!base) continue;
      try {
        let targetUrl = new URL(relPath, base);
        // 如果在 Node 环境且路径不存在，尝试下一个 base
        if (this._nodeFs && this._fileURLToPath && targetUrl.protocol === 'file:') {
          const filePath = this._fileURLToPath(targetUrl);
          if (!this._nodeFs.existsSync(filePath)) {
            continue;
          }
        }
        const data = await this._loadJson(targetUrl);
        return { data, url: targetUrl };
      } catch (_) {
        // 尝试下一个候选 base
      }
    }
    return null;
  }

  // ── 1. 加载世界数据 (world.json) ──
  async loadWorld(worldId) {
    if (!worldId) throw new Error('loadWorld 需要明确的 worldId');
    const cacheKey = `world::${worldId}`;
    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const worldUrl = new URL(`../../data/worlds/${worldId}/world.json`, import.meta.url);
    const data = await this._loadJson(worldUrl);
    const result = {
      worldData: data,
      baseUrl: worldUrl
    };
    this._cache.set(cacheKey, result);
    return result;
  }

  // ── 2. 加载国家数据 (xxx.national.json) ──
  async loadNation(worldRef, nationId) {
    if (!worldRef || !worldRef.worldData) return null;
    const nations = worldRef.worldData.nations || [];
    const nationMeta = nations.find(n => n.id === nationId);
    if (!nationMeta) return null;

    if (!nationMeta.nationalDataFile) {
      return {
        nationMeta,
        nationData: null,
        baseUrl: null,
        hasDetail: false
      };
    }

    const loaded = await this._resolveAndLoad(nationMeta.nationalDataFile, [worldRef.baseUrl]);
    if (!loaded) {
      return {
        nationMeta,
        nationData: null,
        baseUrl: null,
        hasDetail: false
      };
    }

    return {
      nationMeta,
      nationData: loaded.data,
      baseUrl: loaded.url,
      hasDetail: true
    };
  }

  // ── 3. 加载城市数据 (xxx.city.json) ──
  async loadCity(worldRef, nationRef, cityId) {
    if (!nationRef || !nationRef.nationData) return null;
    const cities = nationRef.nationData.cities || [];
    const cityMeta = cities.find(c => c.id === cityId);
    if (!cityMeta) return null;

    if (!cityMeta.city_data_file) {
      return {
        cityMeta,
        cityData: null,
        baseUrl: null,
        hasDetail: false
      };
    }

    // 候选 base：可能是国家文件所在目录，也可能是世界文件所在目录
    const bases = [nationRef.baseUrl, worldRef?.baseUrl].filter(Boolean);
    const loaded = await this._resolveAndLoad(cityMeta.city_data_file, bases);
    if (!loaded) {
      return {
        cityMeta,
        cityData: null,
        baseUrl: null,
        hasDetail: false
      };
    }

    return {
      cityMeta,
      cityData: loaded.data,
      baseUrl: loaded.url,
      hasDetail: true
    };
  }

  // ── 4. 加载城市全量地点 (xxx.locations.json) ──
  async loadCityLocations(worldRef, nationRef, cityRef) {
    if (!cityRef || !cityRef.cityData) return null;
    const locFile = cityRef.cityData.locations_file;
    if (!locFile) {
      return {
        locationsData: null,
        locations: [],
        hasDetail: false
      };
    }

    const bases = [cityRef.baseUrl, nationRef?.baseUrl, worldRef?.baseUrl].filter(Boolean);
    const loaded = await this._resolveAndLoad(locFile, bases);
    if (!loaded) {
      return {
        locationsData: null,
        locations: [],
        hasDetail: false
      };
    }

    return {
      locationsData: loaded.data,
      locations: loaded.data.locations || [],
      meta: loaded.data.meta || {},
      hasDetail: true
    };
  }

  clearCache() {
    this._cache.clear();
  }
}

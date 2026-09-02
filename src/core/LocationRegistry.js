// ============================================================
// LocationRegistry.js —— 地点注册系统 (ESM)
// v0.1.1: 索引带 world/city namespace，防第二世界id覆盖
// ============================================================

export default class LocationRegistry {
  constructor() {
    this.worlds = {};
    this._index = {}; // key: "worldId::cityId::locationId"
    this._idLookup = {}; // 全局id → namespace key（如果id全局唯一）
  }

  // ── 生成namespace key ──
  _nsKey(worldId, cityId, locationId) {
    return worldId + '::' + cityId + '::' + locationId;
  }

  loadCityLocations(worldId, cityId, data) {
    if (!this.worlds[worldId]) {
      this.worlds[worldId] = { cities: {} };
    }
    if (!this.worlds[worldId].cities[cityId]) {
      this.worlds[worldId].cities[cityId] = { locations: [], meta: {} };
    }

    const city = this.worlds[worldId].cities[cityId];
    city.meta = data.meta || {};
    city.locations = data.locations || [];

    const self = this;
    city.locations.forEach(function(loc) {
      const nsKey = self._nsKey(worldId, cityId, loc.id);
      self._index[nsKey] = {
        worldId: worldId,
        cityId: cityId,
        location: loc
      };
      // 全局id映射（如果不冲突）
      if (!self._idLookup[loc.id]) {
        self._idLookup[loc.id] = nsKey;
      }
    });

    return {
      world: worldId,
      city: cityId,
      count: city.locations.length,
      fields: this._getFieldSummary(city.locations)
    };
  }

  // ── 按namespace获取地点（推荐） ──
  getLocation(worldId, cityId, locationId) {
    // 支持两种调用：getLocation(id) 或 getLocation(worldId, cityId, id)
    if (cityId === undefined) {
      // 单参数：用全局id查找
      const nsKey = this._idLookup[worldId];
      if (nsKey) {
        const entry = this._index[nsKey];
        return entry ? JSON.parse(JSON.stringify(entry.location)) : null;
      }
      return null;
    }
    const nsKey = this._nsKey(worldId, cityId, locationId);
    const entry = this._index[nsKey];
    return entry ? JSON.parse(JSON.stringify(entry.location)) : null;
  }

  // ── 在当前世界/城市内按id查找 ──
  getLocationInCity(worldId, cityId, locationId) {
    const nsKey = this._nsKey(worldId, cityId, locationId);
    const entry = this._index[nsKey];
    return entry ? JSON.parse(JSON.stringify(entry.location)) : null;
  }

  getCityLocations(worldId, cityId) {
    if (this.worlds[worldId] && this.worlds[worldId].cities[cityId]) {
      return JSON.parse(JSON.stringify(this.worlds[worldId].cities[cityId].locations));
    }
    return [];
  }

  getLocationsByCategory(worldId, cityId, category) {
    return this.getCityLocations(worldId, cityId).filter(function(l) { return l.category === category; });
  }

  getLocationsByType(worldId, cityId, type) {
    return this.getCityLocations(worldId, cityId).filter(function(l) { return l.type === type; });
  }

  searchLocations(worldId, cityId, keyword) {
    const locs = this.getCityLocations(worldId, cityId);
    const kw = keyword.toLowerCase();
    return locs.filter(function(l) {
      return l.name.toLowerCase().indexOf(kw) >= 0 ||
             l.id.toLowerCase().indexOf(kw) >= 0;
    });
  }

  // ── 按名称在当前城市查找（支持动态地点） ──
  findLocationByName(worldId, cityId, name, dynamicLocations) {
    const locs = this.getCityLocations(worldId, cityId);
    let found = locs.find(function(l) {
      return l.name === name || l.name.indexOf(name) >= 0 || name.indexOf(l.name) >= 0;
    });
    if (found) return found;
    // 查动态地点
    if (dynamicLocations && Array.isArray(dynamicLocations)) {
      found = dynamicLocations.find(function(l) {
        return l.name === name && l.active;
      });
    }
    return found || null;
  }

  verifyIntegrity(worldId, cityId) {
    const locs = this.getCityLocations(worldId, cityId);
    const requiredFields = ['id', 'name', 'x', 'y', 'width', 'height', 'type', 'category'];
    const issues = [];
    const idSet = {};

    locs.forEach(function(loc, idx) {
      requiredFields.forEach(function(field) {
        if (loc[field] === undefined || loc[field] === null) {
          issues.push({ index: idx, id: loc.id || 'unknown', field: field, problem: '缺失必填字段' });
        }
      });
      if (loc.id) {
        if (idSet[loc.id]) {
          issues.push({ index: idx, id: loc.id, field: 'id', problem: 'id重复(同城市内)' });
        }
        idSet[loc.id] = true;
      }
    });

    return {
      total: locs.length,
      valid: locs.length - issues.length,
      issues: issues,
      allFieldsPresent: issues.length === 0,
      fieldSummary: this._getFieldSummary(locs)
    };
  }

  _getFieldSummary(locations) {
    const fieldCounts = {};
    locations.forEach(function(loc) {
      Object.keys(loc).forEach(function(key) {
        fieldCounts[key] = (fieldCounts[key] || 0) + 1;
      });
    });
    return fieldCounts;
  }

  getLoadedWorlds() {
    const result = {};
    for (var worldId in this.worlds) {
      result[worldId] = {
        cities: Object.keys(this.worlds[worldId].cities).map(function(cityId) {
          return {
            id: cityId,
            locationCount: this.worlds[worldId].cities[cityId].locations.length
          };
        }.bind(this))
      };
    }
    return result;
  }

  getTotalLocationCount() {
    return Object.keys(this._index).length;
  }

  // ── 检查某id在某世界/城市是否已注册 ──
  hasLocation(worldId, cityId, locationId) {
    return this._index.hasOwnProperty(this._nsKey(worldId, cityId, locationId));
  }
}

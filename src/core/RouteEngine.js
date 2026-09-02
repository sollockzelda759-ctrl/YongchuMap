// ============================================================
// RouteEngine.js —— 路线与距离计算引擎 (ESM)
// v0.1.1: 支持动态地点参与距离计算
// ============================================================

const TRAVEL_SPEEDS = {
  walking: { speed_li_per_hour: 4, label: '步行' },
  horse: { speed_li_per_hour: 12, label: '骑马' },
  carriage: { speed_li_per_hour: 8, label: '马车' },
  boat: { speed_li_per_hour: 15, label: '乘船' }
};

export default class RouteEngine {
  constructor(locationRegistry) {
    this.registry = locationRegistry;
    this.dynamicLocations = []; // 运行时动态地点，参与距离计算
  }

  // ── 设置动态地点列表 ──
  setDynamicLocations(locs) {
    this.dynamicLocations = Array.isArray(locs) ? locs : [];
  }

  // ── 从任意来源获取地点（注册+动态） ──
  _resolveLocation(worldId, cityId, locationId) {
    // 先查注册地点
    let loc = this.registry.getLocationInCity(worldId, cityId, locationId);
    if (loc) return loc;
    // 再查动态地点
    loc = this.dynamicLocations.find(function(l) { return l.id === locationId && l.active; });
    return loc || null;
  }

  getDistance(locationA, locationB) {
    if (!locationA || !locationB) return 0;
    const ax = locationA.x !== undefined ? locationA.x : locationA.coords?.x || 0;
    const ay = locationA.y !== undefined ? locationA.y : locationA.coords?.y || 0;
    const bx = locationB.x !== undefined ? locationB.x : locationB.coords?.x || 0;
    const by = locationB.y !== undefined ? locationB.y : locationB.coords?.y || 0;
    const dx = bx - ax;
    const dy = by - ay;
    const straight = Math.sqrt(dx * dx + dy * dy);
    return Math.round(straight * 1.3 * 10) / 10;
  }

  getDistanceById(worldId, cityId, idA, idB) {
    // 支持旧调用：getDistanceById(idA, idB)
    if (idB === undefined) {
      idB = idA;
      idA = cityId;
      cityId = 'default';
      worldId = 'default';
    }
    const a = this._resolveLocation(worldId, cityId, idA);
    const b = this._resolveLocation(worldId, cityId, idB);
    return this.getDistance(a, b);
  }

  createTravelPlan(worldId, cityId, fromId, toId, travelMode) {
    // 支持旧调用：createTravelPlan(fromId, toId, travelMode)
    if (typeof worldId === 'string' && cityId && typeof cityId !== 'string') {
      travelMode = toId;
      toId = cityId;
      cityId = fromId;
      fromId = worldId;
      worldId = 'default';
      cityId = 'default';
    }

    const from = this._resolveLocation(worldId, cityId, fromId);
    const to = this._resolveLocation(worldId, cityId, toId);

    if (!from || !to) {
      return { error: '起点或终点不存在', fromId: fromId, toId: toId };
    }

    const mode = travelMode || 'walking';
    const speedInfo = TRAVEL_SPEEDS[mode] || TRAVEL_SPEEDS.walking;
    const distance = this.getDistance(from, to);
    const durationHours = distance / speedInfo.speed_li_per_hour;

    return {
      world_id: worldId,
      city_id: cityId,
      from_id: fromId,
      from_name: from.name,
      from_coords: { x: from.x, y: from.y },
      to_id: toId,
      to_name: to.name,
      to_coords: { x: to.x, y: to.y },
      route: [
        { id: fromId, name: from.name, coords: { x: from.x, y: from.y } },
        { id: toId, name: to.name, coords: { x: to.x, y: to.y } }
      ],
      total_distance: distance,
      distance_unit: '里',
      travel_mode: mode,
      travel_mode_label: speedInfo.label,
      speed: speedInfo.speed_li_per_hour,
      estimated_duration: Math.round(durationHours * 10) / 10,
      duration_unit: '小时',
      estimated_days: Math.round(durationHours / 12 * 10) / 10,
      created_at: new Date().toISOString()
    };
  }

  calculateProgress(travelPlan, elapsedHours) {
    if (!travelPlan || travelPlan.error) return null;
    const speedInfo = TRAVEL_SPEEDS[travelPlan.travel_mode] || TRAVEL_SPEEDS.walking;
    const traveledDistance = Math.min(
      elapsedHours * speedInfo.speed_li_per_hour,
      travelPlan.total_distance
    );
    const progress = travelPlan.total_distance > 0
      ? traveledDistance / travelPlan.total_distance
      : 0;

    const from = travelPlan.from_coords;
    const to = travelPlan.to_coords;
    const currentCoords = {
      x: Math.round((from.x + (to.x - from.x) * progress) * 100) / 100,
      y: Math.round((from.y + (to.y - from.y) * progress) * 100) / 100
    };

    return {
      traveled_distance: Math.round(traveledDistance * 10) / 10,
      remaining_distance: Math.round((travelPlan.total_distance - traveledDistance) * 10) / 10,
      progress: Math.round(progress * 1000) / 1000,
      current_coords: currentCoords,
      elapsed_hours: elapsedHours,
      remaining_hours: Math.round((travelPlan.estimated_duration - elapsedHours) * 10) / 10,
      arrived: progress >= 1
    };
  }

  getTravelModes() {
    return Object.keys(TRAVEL_SPEEDS).map(function(key) {
      return { mode: key, label: TRAVEL_SPEEDS[key].label, speed: TRAVEL_SPEEDS[key].speed_li_per_hour };
    });
  }
}

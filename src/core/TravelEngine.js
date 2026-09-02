// ============================================================
// TravelEngine.js —— 旅行管理引擎 (ESM)
// v0.1.1: 统一worldId/cityId，动态地点可抵达
// ============================================================

export default class TravelEngine {
  constructor(mapStore, routeEngine, locationRegistry) {
    this.store = mapStore;
    this.routeEngine = routeEngine;
    this.registry = locationRegistry;
  }

  _getWorldCity() {
    const state = this.store.getState();
    return {
      worldId: state.physical_state.world_id || this.store.currentWorldId || 'default',
      cityId: state.physical_state.city_id || 'default'
    };
  }

  declareIntent(destinationId) {
    const { worldId, cityId } = this._getWorldCity();
    const dest = this.registry.getLocationInCity(worldId, cityId, destinationId) ||
                 this.routeEngine.dynamicLocations.find(function(l) { return l.id === destinationId; });
    if (!dest) {
      return { success: false, error: '目的地不存在: ' + destinationId };
    }
    const state = this.store.setIntent({ id: destinationId, name: dest.name });
    return {
      success: true,
      action: 'intent_declared',
      destination: dest.name,
      current_location: state.physical_state.location_name,
      message: '已记录旅行意图：前往' + dest.name + '。当前仍在' + state.physical_state.location_name
    };
  }

  depart(destinationId, travelMode) {
    const state = this.store.getState();
    const { worldId, cityId } = this._getWorldCity();
    const fromId = state.physical_state.location_id;
    if (!fromId) return { success: false, error: '当前位置未知，无法出发' };
    if (fromId === destinationId) return { success: false, error: '已在目的地' };

    const plan = this.routeEngine.createTravelPlan(worldId, cityId, fromId, destinationId, travelMode);
    if (plan.error) return { success: false, error: plan.error };

    this.store.startTravel(plan);
    return {
      success: true,
      action: 'departed',
      plan: plan,
      message: '已从' + plan.from_name + '出发，前往' + plan.to_name +
               '，距离' + plan.total_distance + '里，预计' + plan.estimated_duration + '小时'
    };
  }

  advanceTravel(elapsedHours) {
    const state = this.store.getState();
    if (!state.travel_state.active) {
      return { success: false, error: '当前没有进行中的旅行' };
    }

    const { worldId, cityId } = this._getWorldCity();
    const fromLoc = this.registry.getLocationInCity(worldId, cityId, state.travel_state.from_id) ||
                    this.routeEngine.dynamicLocations.find(function(l) { return l.id === state.travel_state.from_id; });
    const toLoc = this.registry.getLocationInCity(worldId, cityId, state.travel_state.to_id) ||
                  this.routeEngine.dynamicLocations.find(function(l) { return l.id === state.travel_state.to_id; });

    const plan = {
      from_coords: { x: fromLoc?.x || 0, y: fromLoc?.y || 0 },
      to_coords: { x: toLoc?.x || 0, y: toLoc?.y || 0 },
      total_distance: state.travel_state.total_distance,
      travel_mode: state.travel_state.travel_mode,
      estimated_duration: state.travel_state.estimated_duration
    };

    const speedInfo = { walking: 4, horse: 12, carriage: 8, boat: 15 };
    const speed = speedInfo[plan.travel_mode] || 4;
    const alreadyHours = state.travel_state.traveled_distance / speed;
    const totalHours = alreadyHours + elapsedHours;

    const progress = this.routeEngine.calculateProgress(plan, totalHours);

    if (progress.arrived) {
      const dest = toLoc;
      this.store.setPhysicalLocation({
        id: dest.id,
        name: dest.name,
        world_id: worldId,
        city_id: cityId,
        nation: state.physical_state.nation,
        coords: { x: dest.x, y: dest.y },
        is_indoor: dest.type === 'indoor'
      });
      return { success: true, action: 'arrived', destination: dest.name, traveled: progress.traveled_distance };
    } else {
      this.store.updateTravelProgress(progress.traveled_distance);
      return {
        success: true,
        action: 'traveling',
        progress: progress.progress,
        traveled: progress.traveled_distance,
        remaining: progress.remaining_distance
      };
    }
  }

  arriveAt(locationId) {
    const { worldId, cityId } = this._getWorldCity();
    const loc = this.registry.getLocationInCity(worldId, cityId, locationId) ||
                this.routeEngine.dynamicLocations.find(function(l) { return l.id === locationId; });
    if (!loc) return { success: false, error: '地点不存在: ' + locationId };

    const state = this.store.getState();
    this.store.setPhysicalLocation({
      id: loc.id,
      name: loc.name,
      world_id: worldId,
      city_id: cityId,
      nation: state.physical_state.nation,
      coords: { x: loc.x, y: loc.y },
      is_indoor: loc.type === 'indoor'
    });
    return { success: true, action: 'arrived', location: loc.name };
  }

  getTravelSummary() {
    const state = this.store.getState();
    if (!state.travel_state.active) return { active: false, message: '当前无旅行' };
    return {
      active: true,
      from: state.travel_state.from_name,
      to: state.travel_state.to_name,
      total_distance: state.travel_state.total_distance,
      traveled: state.travel_state.traveled_distance,
      remaining: state.travel_state.total_distance - state.travel_state.traveled_distance,
      progress: state.travel_state.progress,
      mode: state.travel_state.travel_mode
    };
  }

  cancelTravel() {
    return this.store._updateState(function(state) {
      state.travel_state.active = false;
      state.intent_state.status = 'none';
      state.intent_state.destination_id = null;
      state.intent_state.destination_name = null;
    });
  }
}

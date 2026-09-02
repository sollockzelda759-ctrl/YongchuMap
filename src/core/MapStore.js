// ============================================================
// MapStore.js —— 地图核心状态存储 (ESM)
// v0.1.2: 真实rollback恢复before_snapshot，不只是标记
// ============================================================

const STORAGE_PREFIX = 'yongchumap_state_';
const CURRENT_SCHEMA_VERSION = '0.1.2';

export default class MapStore {
  constructor() {
    this.currentWorldId = null;
    this.currentCharacterId = null;
    this.currentChatId = null;
    this.currentGroupId = null;
    this._stateCache = {};
  }

  setContext(worldId, characterId, chatId, groupId) {
    this.currentWorldId = worldId || 'default';
    this.currentCharacterId = characterId || 'default';
    this.currentChatId = chatId || 'default';
    this.currentGroupId = groupId || null;
    this._ensureState();
  }

  _storageKey(worldId, characterId, chatId, groupId) {
    const parts = [worldId, characterId, chatId];
    if (groupId) parts.push(groupId);
    return STORAGE_PREFIX + parts.join('__');
  }

  _createEmptyState() {
    return {
      schema_version: CURRENT_SCHEMA_VERSION,
      physical_state: {
        world_id: null, nation: null, city_id: null,
        location_id: null, location_name: null,
        coords: { x: 0, y: 0 }, is_indoor: false, last_updated: null
      },
      intent_state: {
        destination_id: null, destination_name: null,
        status: 'none', declared_at: null
      },
      travel_state: {
        active: false, from_id: null, from_name: null,
        to_id: null, to_name: null, route: [],
        total_distance: 0, traveled_distance: 0,
        travel_mode: 'walking', start_time: null,
        estimated_duration: 0, progress: 0
      },
      dynamic_locations: [],
      candidates: [],
      map_entities: [],
      settlement_history: [],
      settlement_index: {},
      meta: {
        created_at: new Date().toISOString(),
        schema_version: CURRENT_SCHEMA_VERSION,
        world_id: null, character_id: null, chat_id: null, group_id: null
      }
    };
  }

  _migrateIfNeeded(state) {
    if (!state.schema_version) state.schema_version = '0.1.0';
    if (state.schema_version === CURRENT_SCHEMA_VERSION) return state;

    if (state.schema_version === '0.1.0' || state.schema_version === '0.1.1') {
      if (state.physical_state?.world && !state.physical_state.world_id) {
        state.physical_state.world_id = state.physical_state.world;
      }
      if (state.physical_state?.city && !state.physical_state.city_id) {
        state.physical_state.city_id = state.physical_state.city;
      }
      if (!state.settlement_index) state.settlement_index = {};
      state.schema_version = CURRENT_SCHEMA_VERSION;
    }
    return state;
  }

  _ensureState() {
    const key = this._storageKey(
      this.currentWorldId, this.currentCharacterId, this.currentChatId, this.currentGroupId
    );
    if (!this._stateCache[key]) {
      try {
        const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(key) : null;
        if (raw) {
          let state = JSON.parse(raw);
          state = this._migrateIfNeeded(state);
          this._stateCache[key] = state;
        } else {
          this._stateCache[key] = this._createEmptyState();
          this._stateCache[key].meta.world_id = this.currentWorldId;
          this._stateCache[key].meta.character_id = this.currentCharacterId;
          this._stateCache[key].meta.chat_id = this.currentChatId;
          this._stateCache[key].meta.group_id = this.currentGroupId;
        }
      } catch (e) {
        this._stateCache[key] = this._createEmptyState();
      }
    }
    return this._stateCache[key];
  }

  getState() {
    return JSON.parse(JSON.stringify(this._ensureState()));
  }

  _updateState(mutator) {
    const state = this._ensureState();
    mutator(state);
    state.meta.last_updated = new Date().toISOString();
    this._persist(state);
    return JSON.parse(JSON.stringify(state));
  }

  _persist(state) {
    try {
      if (typeof localStorage !== 'undefined') {
        const key = this._storageKey(
          this.currentWorldId, this.currentCharacterId, this.currentChatId, this.currentGroupId
        );
        localStorage.setItem(key, JSON.stringify(state));
      }
    } catch (e) {
      console.warn('[YongchuMap] localStorage写入失败:', e.message);
    }
  }

  // ── 保存结算前快照（用于rollback） ──
  saveBeforeSnapshot() {
    const state = this._ensureState();
    return {
      physical_state: JSON.parse(JSON.stringify(state.physical_state)),
      intent_state: JSON.parse(JSON.stringify(state.intent_state)),
      travel_state: JSON.parse(JSON.stringify(state.travel_state)),
      dynamic_locations: JSON.parse(JSON.stringify(state.dynamic_locations)),
      candidates: JSON.parse(JSON.stringify(state.candidates)),
      map_entities: JSON.parse(JSON.stringify(state.map_entities))
    };
  }

  // ── 真实恢复快照 ──
  restoreSnapshot(snapshot) {
    if (!snapshot) return false;
    return this._updateState(function(state) {
      state.physical_state = JSON.parse(JSON.stringify(snapshot.physical_state));
      state.intent_state = JSON.parse(JSON.stringify(snapshot.intent_state));
      state.travel_state = JSON.parse(JSON.stringify(snapshot.travel_state));
      state.dynamic_locations = JSON.parse(JSON.stringify(snapshot.dynamic_locations));
      state.candidates = JSON.parse(JSON.stringify(snapshot.candidates));
      state.map_entities = JSON.parse(JSON.stringify(snapshot.map_entities));
    });
  }

  setPhysicalLocation(location) {
    return this._updateState(function(state) {
      state.physical_state.world_id = location.world_id || state.physical_state.world_id;
      state.physical_state.nation = location.nation || state.physical_state.nation;
      state.physical_state.city_id = location.city_id || state.physical_state.city_id;
      state.physical_state.location_id = location.id;
      state.physical_state.location_name = location.name;
      state.physical_state.coords = location.coords || { x: 0, y: 0 };
      state.physical_state.is_indoor = location.is_indoor !== undefined ? location.is_indoor : false;
      state.physical_state.last_updated = new Date().toISOString();
      if (state.intent_state.destination_id === location.id) {
        state.intent_state.status = 'arrived';
        state.intent_state.destination_id = null;
        state.intent_state.destination_name = null;
      }
      if (state.travel_state.active && state.travel_state.to_id === location.id) {
        state.travel_state.active = false;
        state.travel_state.progress = 1;
        state.travel_state.traveled_distance = state.travel_state.total_distance;
      }
    });
  }

  setIntent(destination) {
    return this._updateState(function(state) {
      state.intent_state.destination_id = destination.id;
      state.intent_state.destination_name = destination.name;
      state.intent_state.status = 'planned';
      state.intent_state.declared_at = new Date().toISOString();
    });
  }

  startTravel(travelPlan) {
    return this._updateState(function(state) {
      state.travel_state.active = true;
      state.travel_state.from_id = travelPlan.from_id;
      state.travel_state.from_name = travelPlan.from_name;
      state.travel_state.to_id = travelPlan.to_id;
      state.travel_state.to_name = travelPlan.to_name;
      state.travel_state.route = travelPlan.route || [];
      state.travel_state.total_distance = travelPlan.total_distance || 0;
      state.travel_state.traveled_distance = 0;
      state.travel_state.travel_mode = travelPlan.travel_mode || 'walking';
      state.travel_state.start_time = new Date().toISOString();
      state.travel_state.estimated_duration = travelPlan.estimated_duration || 0;
      state.travel_state.progress = 0;
      state.intent_state.status = 'travelling';
    });
  }

  updateTravelProgress(traveledDistance) {
    return this._updateState(function(state) {
      if (!state.travel_state.active) return;
      state.travel_state.traveled_distance = Math.min(traveledDistance, state.travel_state.total_distance);
      state.travel_state.progress = state.travel_state.total_distance > 0
        ? state.travel_state.traveled_distance / state.travel_state.total_distance : 0;
    });
  }

  addDynamicLocation(loc) {
    return this._updateState(function(state) {
      const exists = state.dynamic_locations.find(function(l) { return l.id === loc.id; });
      if (!exists) {
        state.dynamic_locations.push({
          id: loc.id, name: loc.name, type: loc.type || 'unknown',
          category: loc.category || 'dynamic', scope: loc.scope || 'local',
          parent: loc.parent || null, coords: loc.coords || { x: 0, y: 0 },
          x: loc.coords?.x || loc.x || 0, y: loc.coords?.y || loc.y || 0,
          width: loc.width || 0.5, height: loc.height || 0.5,
          importance: loc.importance || 'session', status: loc.status || 'active',
          desc: loc.desc || '', atmosphere: loc.atmosphere || '', sub_areas: loc.sub_areas || [],
          created_at: new Date().toISOString(), expires_at: loc.expires_at || null,
          confidence: loc.confidence || 100, active: true, visible: true, historical: false,
          world_id: loc.world_id || null, city_id: loc.city_id || null
        });
      }
    });
  }

  addCandidate(candidate) {
    return this._updateState(function(state) {
      const exists = state.candidates.find(function(c) { return c.name === candidate.name; });
      if (exists) {
        exists.confidence = (exists.confidence || 0) + 1;
        exists.last_mentioned = new Date().toISOString();
      } else {
        state.candidates.push({
          id: 'cand_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          name: candidate.name, type: candidate.type || 'unknown',
          source: candidate.source || 'text', confidence: 1, status: 'pending',
          first_mentioned: new Date().toISOString(), last_mentioned: new Date().toISOString(),
          desc: candidate.desc || ''
        });
      }
    });
  }

  promoteCandidate(candidateId, locationData) {
    return this._updateState(function(state) {
      const idx = state.candidates.findIndex(function(c) { return c.id === candidateId; });
      if (idx >= 0) {
        const cand = state.candidates[idx];
        cand.status = 'confirmed';
        state.dynamic_locations.push({
          id: locationData.id || cand.id, name: cand.name,
          type: locationData.type || cand.type, category: locationData.category || 'dynamic',
          scope: locationData.scope || 'local', parent: locationData.parent || null,
          coords: locationData.coords || { x: 0, y: 0 },
          x: locationData.coords?.x || 0, y: locationData.coords?.y || 0,
          width: locationData.width || 0.5, height: locationData.height || 0.5,
          importance: locationData.importance || 'persistent', status: 'active',
          desc: locationData.desc || cand.desc || '', atmosphere: locationData.atmosphere || '',
          sub_areas: locationData.sub_areas || [], created_at: new Date().toISOString(),
          active: true, visible: true, historical: false, promoted_from: candidateId
        });
      }
    });
  }

  expireEphemeralLocations() {
    return this._updateState(function(state) {
      const now = new Date().toISOString();
      state.dynamic_locations.forEach(function(loc) {
        if (loc.importance === 'ephemeral' && loc.expires_at && loc.expires_at <= now) {
          loc.active = false; loc.visible = false; loc.historical = true; loc.status = 'expired';
        }
      });
    });
  }

  // ── 记录结算（带before_snapshot） ──
  recordSettlement(record) {
    return this._updateState(function(state) {
      const entry = {
        settlement_id: 'settle_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        generation_id: record.generation_id || null,
        message_id: record.message_id || null,
        source_message_id: record.source_message_id || null,
        swipe_id: record.swipe_id || null,
        settled_at: new Date().toISOString(),
        success: record.success !== false,
        summary: record.summary || '',
        before_snapshot: record.before_snapshot || null,
        rolled_back: false
      };
      state.settlement_history.push(entry);
      if (entry.message_id) {
        state.settlement_index[entry.message_id] = entry.settlement_id;
      }
      if (state.settlement_history.length > 200) {
        state.settlement_history = state.settlement_history.slice(-200);
      }
    });
  }

  isSettled(messageId) {
    if (!messageId) return false;
    const state = this._ensureState();
    const settleId = state.settlement_index[messageId];
    if (!settleId) return false;
    const record = state.settlement_history.find(function(s) { return s.settlement_id === settleId; });
    return record && !record.rolled_back;
  }

  // ── 真实回滚：恢复before_snapshot + 清理索引 ──
  rollbackSettlement(messageId) {
    const state = this._ensureState();
    const settleId = state.settlement_index[messageId];
    if (!settleId) return { success: false, error: '未找到结算记录' };

    const record = state.settlement_history.find(function(s) { return s.settlement_id === settleId; });
    if (!record) return { success: false, error: '结算记录不存在' };
    if (record.rolled_back) return { success: false, error: '已回滚' };

    // 真正恢复before_snapshot
    if (record.before_snapshot) {
      this.restoreSnapshot(record.before_snapshot);
    }

    // 标记回滚 + 清理索引
    this._updateState(function(s) {
      const rec = s.settlement_history.find(function(x) { return x.settlement_id === settleId; });
      if (rec) {
        rec.rolled_back = true;
        rec.rolled_back_at = new Date().toISOString();
      }
      delete s.settlement_index[messageId];
    });

    return { success: true, message_id: messageId, restored: !!record.before_snapshot };
  }

  getSettlementRecord(messageId) {
    const state = this._ensureState();
    const settleId = state.settlement_index[messageId];
    if (!settleId) return null;
    return state.settlement_history.find(function(s) { return s.settlement_id === settleId; }) || null;
  }

  resetCurrentChat() {
    const key = this._storageKey(
      this.currentWorldId, this.currentCharacterId, this.currentChatId, this.currentGroupId
    );
    delete this._stateCache[key];
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    } catch (e) {}
    this._ensureState();
  }
}

// ============================================================
// SettlementEngine.js —— 后置结算引擎 (ESM)
// v0.1.2: 结算前保存before_snapshot，rollback真实恢复
// ============================================================

export default class SettlementEngine {
  constructor(mapStore, travelEngine, mapContext, locationRegistry) {
    this.store = mapStore;
    this.travel = travelEngine;
    this.context = mapContext;
    this.registry = locationRegistry;
    this._processing = false;
    this._stoppedGenerations = new Set(); // 记录被停止的generation
  }

  // 标记某generation被停止/取消，不做结算
  markGenerationStopped(generationId) {
    if (generationId) this._stoppedGenerations.add(generationId);
  }

  isGenerationStopped(generationId) {
    return generationId && this._stoppedGenerations.has(generationId);
  }

  async settle(context) {
    const messageId = context.messageId;
    const sourceMessageId = context.sourceMessageId || null;
    const generationId = context.generationId || null;
    const isError = context.isError || false;
    const isAborted = context.isAborted || false;

    if (messageId === null || messageId === undefined) {
      return { success: false, error: '缺少messageId' };
    }

    // 停止/取消的生成不提交
    if (isAborted || (generationId && this.isGenerationStopped(generationId))) {
      console.log('[YongchuMap] 该生成已被停止，跳过结算' + (generationId ? (', gen=' + generationId) : ''));
      if (generationId) this._stoppedGenerations.delete(generationId);
      return { success: false, skipped: true, reason: '生成已停止' };
    }

    if (isError) {
      return { success: false, skipped: true, reason: '生成错误' };
    }

    // 如果该消息已被结算过（例如regenerate在同一楼层重新生成，或Swipe），先回滚旧结算恢复快照
    if (this.store.isSettled(messageId)) {
      console.log('[YongchuMap] 消息已结算过，先回滚旧快照再重新结算 (支持Regenerate): messageId=' + messageId);
      this.rollback(messageId);
    }

    if (this._processing) {
      return { success: false, skipped: true, reason: '结算进行中' };
    }
    this._processing = true;

    try {
      // 1. 保存结算前快照（用于rollback）
      const beforeSnapshot = this.store.saveBeforeSnapshot();

      // 2. 读取消息内容
      const messageContent = await this._getMessageContent(messageId);

      // 3. 执行结算
      const result = this._doSettlement(messageContent);

      // 4. 提交：记录结算（带before_snapshot）
      this.store.recordSettlement({
        generation_id: generationId,
        message_id: messageId,
        source_message_id: sourceMessageId,
        success: true,
        summary: result.actions.join(', '),
        before_snapshot: beforeSnapshot
      });

      // 5. 刷新注入
      if (result.shouldRefresh) this.context.refresh();

      return {
        success: true, message_id: messageId, source_message_id: sourceMessageId,
        actions: result.actions, location_changed: result.locationChanged,
        travel_updated: result.travelUpdated, dynamic_created: result.dynamicCreated,
        has_before_snapshot: !!beforeSnapshot
      };
    } catch (e) {
      console.error('[YongchuMap] 结算异常:', e);
      return { success: false, error: e.message, message_id: messageId };
    } finally {
      this._processing = false;
    }
  }

  // 回滚：真实恢复before_snapshot
  rollback(messageId) {
    const result = this.store.rollbackSettlement(messageId);
    if (result.success) {
      console.log('[YongchuMap] 已回滚结算(恢复快照), messageId=' + messageId + ', restored=' + result.restored);
      this.context.refresh();
    }
    return result;
  }

  // Swipe变化：回滚旧版本，重新结算当前版本
  async onSwipeChanged(oldMessageId, newMessageId, sourceMessageId) {
    const targetId = (newMessageId !== undefined && newMessageId !== null) ? newMessageId : oldMessageId;
    if (oldMessageId !== null && oldMessageId !== undefined && this.store.isSettled(oldMessageId)) {
      this.rollback(oldMessageId);
    }
    if (targetId !== null && targetId !== undefined) {
      return this.settle({
        messageId: targetId,
        sourceMessageId: sourceMessageId,
        generationId: null
      });
    }
    return { success: true, action: 'swipe_handled' };
  }

  // 删除消息：回滚对应结算
  onMessageDeleted(messageId) {
    if (this.store.isSettled(messageId)) {
      return this.rollback(messageId);
    }
    return { success: true, action: 'no_settlement_to_clean' };
  }

  async _getMessageContent(messageId) {
    try {
      if (typeof window !== 'undefined' && window.SillyTavern) {
        const ctx = window.SillyTavern.getContext();
        if (ctx && ctx.chat && Array.isArray(ctx.chat)) {
          // 1. 按数字索引直取
          if (typeof messageId === 'number' && ctx.chat[messageId]) {
            return ctx.chat[messageId].mes || '';
          }
          // 2. 按message_id / id属性查找
          const msg = ctx.chat.find(function(m) { return m && (m.message_id === messageId || m.id === messageId); });
          if (msg) return msg.mes || '';
          // 3. 数字字符串转数字索引
          const num = Number(messageId);
          if (!isNaN(num) && ctx.chat[num]) {
            return ctx.chat[num].mes || '';
          }
        }
      }
      return '';
    } catch (e) {
      console.warn('[YongchuMap] 读取消息内容失败:', e.message);
      return '';
    }
  }

  _doSettlement(messageContent) {
    const result = {
      actions: [], locationChanged: false, travelUpdated: false,
      dynamicCreated: 0, candidateCreated: 0, shouldRefresh: false
    };
    if (!messageContent) return result;

    const scene = this._parseScene(messageContent);
    const mapEvents = this._parseMapEvents(messageContent);

    if (scene && scene.time_elapsed_hours > 0) {
      const travelResult = this._settleTravelByTime(scene.time_elapsed_hours);
      if (travelResult.success) {
        result.travelUpdated = true;
        result.actions.push(travelResult.action);
        if (travelResult.action === 'arrived') result.locationChanged = true;
      }
    }

    const self = this;
    mapEvents.forEach(function(event) {
      try {
        const eventResult = self._handleMapEvent(event);
        if (eventResult.success) {
          result.actions.push(eventResult.action);
          if (eventResult.action === 'discover' || eventResult.action === 'confirm') result.dynamicCreated++;
          if (eventResult.action === 'candidate') result.candidateCreated++;
          if (eventResult.location_changed) result.locationChanged = true;
        }
      } catch (e) { /* 忽略 */ }
    });

    if (scene && scene.location) {
      const state = this.store.getState();
      const worldId = state.physical_state.world_id || this.store.currentWorldId || 'default';
      const cityId = state.physical_state.city_id || 'default';
      const loc = this.registry.findLocationByName(worldId, cityId, scene.location, state.dynamic_locations);
      if (loc && loc.id !== state.physical_state.location_id) {
        this.travel.arriveAt(loc.id);
        result.locationChanged = true;
        result.actions.push('scene_location_sync:' + loc.name);
      }
    }

    this.store.expireEphemeralLocations();
    result.shouldRefresh = result.locationChanged || result.travelUpdated || result.dynamicCreated > 0;
    return result;
  }

  _parseScene(content) {
    const sceneMatch = content.match(/<scene>([\s\S]*?)<\/scene>/i);
    if (!sceneMatch) return null;
    const sceneText = sceneMatch[1];
    const result = { raw: sceneText, time_elapsed_hours: 0, location: null };
    const locMatch = sceneText.match(/地点[：:]\s*([^\n|]+)/);
    if (locMatch) result.location = locMatch[1].trim();
    const jumpMatch = sceneText.match(/跳跃[：:]\s*([^\n|]+)/);
    if (jumpMatch) {
      result.jump = jumpMatch[1].trim();
      if (result.jump.indexOf('中跳') >= 0) result.time_elapsed_hours = 2;
      if (result.jump.indexOf('大跳') >= 0) result.time_elapsed_hours = 8;
      if (result.jump.indexOf('跨日') >= 0 || result.jump.indexOf('天') >= 0) result.time_elapsed_hours = 12;
    }
    return result;
  }

  _parseMapEvents(content) {
    const events = [];
    const regex = /<map_event>([\s\S]*?)<\/map_event>/gi;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const event = {};
      match[1].split('\n').forEach(function(line) {
        const kv = line.match(/(\w+)\s*[：:]\s*(.+)/);
        if (kv) event[kv[1].trim().toLowerCase()] = kv[2].trim();
      });
      if (event.action) events.push(event);
    }
    return events;
  }

  _handleMapEvent(event) {
    const action = event.action.toLowerCase();
    const state = this.store.getState();
    const worldId = state.physical_state.world_id || this.store.currentWorldId || 'default';
    const cityId = state.physical_state.city_id || 'default';

    switch (action) {
      case 'none': return { success: true, action: 'none' };
      case 'discover':
        this.store.addDynamicLocation({
          id: 'dyn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          name: event.name || '未知地点', type: event.type || 'unknown',
          category: event.category || 'dynamic', scope: event.scope || 'local',
          parent: event.parent || null, importance: event.importance || 'session',
          desc: event.desc || '', world_id: worldId, city_id: cityId
        });
        return { success: true, action: 'discover', name: event.name };
      case 'arrive':
        if (event.name) {
          const loc = this.registry.findLocationByName(worldId, cityId, event.name, state.dynamic_locations);
          if (loc) {
            this.travel.arriveAt(loc.id);
            return { success: true, action: 'arrive', name: loc.name, location_changed: true };
          }
        }
        return { success: false, error: 'arrive: 地点未找到' };
      case 'leave': return { success: true, action: 'leave' };
      case 'confirm':
        if (event.name) {
          const cand = state.candidates.find(function(c) { return c.name === event.name; });
          if (cand) {
            this.store.promoteCandidate(cand.id, {
              type: event.type, importance: event.importance || 'persistent', desc: event.desc
            });
            return { success: true, action: 'confirm', name: event.name };
          }
        }
        return { success: false, error: 'confirm: 候选未找到' };
      case 'destroy': return { success: true, action: 'destroy' };
      default: return { success: false, error: '未知action: ' + action };
    }
  }

  _settleTravelByTime(elapsedHours) {
    const state = this.store.getState();
    if (!state.travel_state.active) return { success: false, error: '无旅行' };
    return this.travel.advanceTravel(elapsedHours);
  }
}

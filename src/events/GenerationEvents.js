// ============================================================
// GenerationEvents.js —— 生成事件监听 (ESM)
// v0.1.2: SillyTavern正式事件系统
//   - 从getContext()获取eventSource/eventTypes
//   - CHAT_CHANGED/GENERATION_ENDED/GENERATION_STOPPED/MESSAGE_SWIPED/MESSAGE_DELETED
//   - GENERATION_ENDED回调参数按messageId数字处理
//   - Swipe/删除/regenerate真正接线
//   - 正确解绑事件 (ES.off(event, handler)) 防止重载泄漏
//   - 不伪造generationId，通过轮次状态标记stopped
// ============================================================

export default class GenerationEvents {
  constructor(settlementEngine, mapContext, mapStore, onContextRebound) {
    this.settlement = settlementEngine;
    this.context = mapContext;
    this.store = mapStore;
    this.onContextRebound = onContextRebound || null;
    this._handlers = []; // 存储 { event, handler }
    this._msgSeq = 0;
    this._lastMessageId = null;
    this._currentGenerationId = null;
    this._generationStopped = false;
    this._lastReceivedMessage = null; // 记录最近的 MESSAGE_RECEIVED (含 messageId, type)
    this._lastSwipedMessage = null;   // 记录最近的 MESSAGE_SWIPED
    this._lastSettlePromise = null;   // 最近一次 settle 的 promise，便于测试和链式对账
    this._eventSource = null;
    this._eventTypes = null;
  }

  _addListener(event, handler) {
    if (!this._eventSource || !event || typeof handler !== 'function') return;
    this._eventSource.on(event, handler);
    this._handlers.push({ event: event, handler: handler });
  }

  register() {
    // 从SillyTavern获取事件系统
    const ctx = this._getContext();
    if (!ctx) {
      console.warn('[YongchuMap] SillyTavern上下文不可用，无法注册事件');
      return false;
    }

    this._eventSource = ctx.eventSource || ctx;
    this._eventTypes = ctx.eventTypes || {};

    if (!this._eventSource || typeof this._eventSource.on !== 'function') {
      console.warn('[YongchuMap] eventSource.on不可用');
      return false;
    }

    const self = this;
    const ET = this._eventTypes;

    // ── GENERATION_STARTED：记录真实generationId（不伪造） ──
    if (ET.GENERATION_STARTED) {
      this._addListener(ET.GENERATION_STARTED, function(data) {
        self._msgSeq++;
        self._generationStopped = false;
        self._currentGenerationId = (data && data.generation_id) ? data.generation_id : null;
        console.log('[YongchuMap] GENERATION_STARTED, seq=' + self._msgSeq + (self._currentGenerationId ? ', genId=' + self._currentGenerationId : ''));
      });
    }

    // ── MESSAGE_RECEIVED：记录最新接收到的 AI 消息与类型（用于校准 GENERATION_ENDED 的 messageId） ──
    if (ET.MESSAGE_RECEIVED) {
      this._addListener(ET.MESSAGE_RECEIVED, function(messageId, type) {
        const resolvedId = self._resolveMessageId(messageId);
        self._lastReceivedMessage = {
          messageId: resolvedId,
          type: (type !== undefined && type !== null) ? (typeof type === 'object' ? type.type || 'swipe' : type) : null,
          timestamp: Date.now()
        };
        console.log('[YongchuMap] MESSAGE_RECEIVED: messageId=' + resolvedId + ', type=' + self._lastReceivedMessage.type);
      });
    }

    // ── GENERATION_ENDED：后置结算主入口 ──
    if (ET.GENERATION_ENDED) {
      this._addListener(ET.GENERATION_ENDED, function(rawMessageParam) {
        console.log('[YongchuMap] GENERATION_ENDED 触发, rawParam=' + rawMessageParam + ', seq=' + self._msgSeq);

        if (self._generationStopped) {
          console.log('[YongchuMap] 当前生成轮次已被停止/取消，跳过结算');
          self._generationStopped = false;
          self._currentGenerationId = null;
          return;
        }

        // 结合 host chat、active assistant 消息及 MESSAGE_RECEIVED 动态校准真实 target messageId
        const resolvedMessageId = self._resolveTargetAssistantMessageId(rawMessageParam);
        if (resolvedMessageId === null || resolvedMessageId === undefined) {
          console.warn('[YongchuMap] GENERATION_ENDED无法解析有效messageId, 放弃结算');
          self._generationStopped = false;
          self._currentGenerationId = null;
          return;
        }

        const sourceMessageId = self._getSourceMessageId();
        const genId = self._currentGenerationId;
        self._currentGenerationId = null;
        self._generationStopped = false;

        self._lastSettlePromise = self.settlement.settle({
          messageId: resolvedMessageId,
          sourceMessageId: sourceMessageId,
          generationId: genId,
          isError: false,
          isAborted: false
        }).then(function(result) {
          if (result.skipped) {
            console.log('[YongchuMap] 结算跳过:', result.reason);
          } else if (result.success === false && result.error) {
            console.error('[YongchuMap] 结算失败:', result.error);
          } else if (result.success) {
            console.log('[YongchuMap] 结算完成:', JSON.stringify({
              message_id: result.message_id,
              actions: result.actions,
              location_changed: result.location_changed,
              has_before_snapshot: result.has_before_snapshot
            }));
          }
          return result;
        }).catch(function(e) {
          console.error('[YongchuMap] 结算异常:', e.message);
        });

        self._lastMessageId = resolvedMessageId;
      });
    }

    // ── GENERATION_STOPPED：停止/取消生成时不提交 ──
    if (ET.GENERATION_STOPPED) {
      this._addListener(ET.GENERATION_STOPPED, function(data) {
        console.log('[YongchuMap] GENERATION_STOPPED, 标记本轮中止不结算');
        self._generationStopped = true;
        const genId = (data && data.generation_id) ? data.generation_id : self._currentGenerationId;
        if (genId) self.settlement.markGenerationStopped(genId);
        self._currentGenerationId = null;
      });
    }

    // ── GENERATION_ERROR：生成错误不提交 ──
    if (ET.GENERATION_ERROR) {
      this._addListener(ET.GENERATION_ERROR, function() {
        console.log('[YongchuMap] GENERATION_ERROR, 标记本轮出错不结算');
        self._generationStopped = true;
        if (self._currentGenerationId) self.settlement.markGenerationStopped(self._currentGenerationId);
        self._currentGenerationId = null;
      });
    }

    // ── CHAT_CHANGED：切聊天重建context/namespace/注入 ──
    if (ET.CHAT_CHANGED) {
      this._addListener(ET.CHAT_CHANGED, function(chatId) {
        console.log('[YongchuMap] CHAT_CHANGED, chatId=' + chatId);
        self._rebindContext(chatId);
      });
    }

    // ── MESSAGE_SWIPED：Swipe时记录并触发Swipe处理 ──
    if (ET.MESSAGE_SWIPED) {
      this._addListener(ET.MESSAGE_SWIPED, function(data) {
        console.log('[YongchuMap] MESSAGE_SWIPED, data=' + JSON.stringify(data));
        const messageId = self._resolveMessageId(data);
        if (messageId !== null && messageId !== undefined) {
          self._lastSwipedMessage = {
            messageId: messageId,
            timestamp: Date.now()
          };
          const sourceMessageId = self._getSourceMessageId();
          self.settlement.onSwipeChanged(messageId, messageId, sourceMessageId);
        }
      });
    }

  // ── MESSAGE_DELETED：删除消息时回滚对应结算 ──
  // 注意：SillyTavern/TauriTavern 的 MESSAGE_DELETED 事件在消息被从 chat 数组切除后触发，
  // 传来的参数可能是删除后选中的消息、残留的索引或原索引。
  // 因此该参数仅作为辅助参考，对账核心依赖当前 chat 数组与活跃结算的差异。
  if (ET.MESSAGE_DELETED) {
    this._addListener(ET.MESSAGE_DELETED, function(data) {
      const messageId = self._resolveMessageId(data);
      console.log('[YongchuMap] MESSAGE_DELETED 触发, 原始参数=' + JSON.stringify(data) + ', 解析 messageId=' + messageId);
      self.settlement.onMessageDeleted(messageId);
    });
  }

    // ── CHARACTER_CHANGED：切角色卡重建context ──
    if (ET.CHARACTER_CHANGED) {
      this._addListener(ET.CHARACTER_CHANGED, function() {
        console.log('[YongchuMap] CHARACTER_CHANGED, 重建上下文');
        self._rebindContext();
      });
    }

    console.log('[YongchuMap] 事件注册完成: ' +
      [ET.GENERATION_STARTED && 'STARTED', ET.GENERATION_ENDED && 'ENDED',
       ET.GENERATION_STOPPED && 'STOPPED', ET.GENERATION_ERROR && 'ERROR',
       ET.CHAT_CHANGED && 'CHAT_CHANGED', ET.MESSAGE_RECEIVED && 'RECEIVED',
       ET.MESSAGE_SWIPED && 'SWIPED', ET.MESSAGE_DELETED && 'DELETED',
       ET.CHARACTER_CHANGED && 'CHAR_CHANGED']
      .filter(Boolean).join(', '));
    return true;
  }

  // ── 获取SillyTavern上下文 ──
  _getContext() {
    try {
      if (typeof window !== 'undefined' && window.SillyTavern) {
        return window.SillyTavern.getContext();
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  // ── 解析 messageId（支持数字、数字字符串、对象结构如 { id, messageId, message_id }） ──
  _resolveMessageId(param) {
    if (typeof param === 'number') return param;
    if (typeof param === 'string' && !isNaN(Number(param))) return Number(param);
    if (param && typeof param === 'object') {
      if (param.message_id !== undefined && param.message_id !== null) return this._resolveMessageId(param.message_id);
      if (param.messageId !== undefined && param.messageId !== null) return this._resolveMessageId(param.messageId);
      if (param.id !== undefined && param.id !== null) return this._resolveMessageId(param.id);
    }
    return param !== undefined && param !== null ? param : null;
  }

  // ── 解析并校准目标 Assistant messageId ──
  // 在 Swipe 场景下，TauriTavern/SillyTavern 的 GENERATION_ENDED 传参经常是剩余总长度 chat.length 或其它数字（例如7），
  // 但真实 Swipe 的 assistant message 索引是 6，MESSAGE_RECEIVED 事件也明确是 6。
  // 本方法结合真实 host chat 数组、active assistant message 和 MESSAGE_RECEIVED 进行对齐。
  _resolveTargetAssistantMessageId(rawParam) {
    const rawId = this._resolveMessageId(rawParam);
    const ctx = this._getContext();
    const chat = (ctx && Array.isArray(ctx.chat)) ? ctx.chat : null;

    // 1. 如果有近期记录的 MESSAGE_RECEIVED (尤其是 swipe 类型或在当前生成轮次收到的)，且在 chat 范围内或为合法ID，优先采纳
    if (this._lastReceivedMessage && this._lastReceivedMessage.messageId !== null && this._lastReceivedMessage.messageId !== undefined) {
      const recId = this._lastReceivedMessage.messageId;
      // 如果 chat 可用，核验 recId 是否为非用户消息
      if (chat && chat.length > 0) {
        if (typeof recId === 'number' && recId >= 0 && recId < chat.length && chat[recId] && !chat[recId].is_user) {
          return recId;
        }
        const found = chat.find((m, idx) => (m && (m.message_id === recId || m.id === recId || idx === recId) && !m.is_user));
        if (found) {
          return (found.message_id !== undefined && found.message_id !== null) ? found.message_id : recId;
        }
      } else {
        return recId;
      }
    }

    // 2. 如果发生了 MESSAGE_SWIPED，优先对准 swiped 消息
    if (this._lastSwipedMessage && this._lastSwipedMessage.messageId !== null && this._lastSwipedMessage.messageId !== undefined) {
      const swipedId = this._lastSwipedMessage.messageId;
      if (chat && chat.length > 0) {
        if (typeof swipedId === 'number' && swipedId >= 0 && swipedId < chat.length && chat[swipedId] && !chat[swipedId].is_user) {
          return swipedId;
        }
      } else {
        return swipedId;
      }
    }

    // 3. 如果能访问 host chat，检查 rawId 在 chat 里的情况
    if (chat && chat.length > 0) {
      // 3.1 若 rawId 正好是当前消息索引且该消息为 assistant (非 user)，直接匹配
      if (typeof rawId === 'number' && rawId >= 0 && rawId < chat.length && chat[rawId] && !chat[rawId].is_user) {
        return (chat[rawId].message_id !== undefined && chat[rawId].message_id !== null) ? chat[rawId].message_id : rawId;
      }

      // 3.2 若 rawId 等于 chat.length 或超出有效索引边界，说明 host 传入的是 length 或下一个空位索引
      // 此时目标 assistant 必然是当前聊天中最后一条活跃的 assistant 消息
      for (let i = chat.length - 1; i >= 0; i--) {
        const item = chat[i];
        if (item && item.is_user !== true) {
          return (item.message_id !== undefined && item.message_id !== null) ? item.message_id : i;
        }
      }

      // 3.3 如果 rawId 指向的是 user 消息，而紧接着或倒序存在 assistant 消息，寻找最近的 assistant 消息
      for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i] && !chat[i].is_user) {
          return (chat[i].message_id !== undefined && chat[i].message_id !== null) ? chat[i].message_id : i;
        }
      }
    }

    // 4. 后备：无 chat 上下文时返回 rawId
    return rawId;
  }

  // ── 获取sourceMessageId（最新用户消息） ──
  _getSourceMessageId() {
    const ctx = this._getContext();
    if (ctx && ctx.chat && Array.isArray(ctx.chat)) {
      for (let i = ctx.chat.length - 1; i >= 0; i--) {
        if (ctx.chat[i].is_user === true && ctx.chat[i].message_id !== undefined) {
          return ctx.chat[i].message_id;
        }
      }
    }
    return null;
  }

  // ── 切聊天/角色卡时重建 ──
  _rebindContext(newChatId) {
    try {
      const ctx = this._getContext();
      if (!ctx) return;

      // 用真实字段
      const characterId = ctx.characterId || (ctx.character && ctx.character.id) || 'default';
      const chatId = newChatId ||
                     (typeof ctx.getCurrentChatId === 'function' ? ctx.getCurrentChatId() : null) ||
                     ctx.chatId ||
                     'default';
      const groupId = ctx.groupId || (ctx.group && ctx.group.id) || null;

      // 先uninject旧注入
      this.context.uninject();

      // 重建MapStore namespace
      const worldId = this.store.currentWorldId || 'yongchu';
      this.store.setContext(
        worldId,
        String(characterId),
        String(chatId),
        groupId ? String(groupId) : null
      );

      // 回调给主模块确保新chat有默认位置
      if (typeof this.onContextRebound === 'function') {
        this.onContextRebound();
      }

      // 重新注入
      this.context.onChatChanged();

      console.log('[YongchuMap] 上下文重建: char=' + characterId + ', chat=' + chatId + ', group=' + (groupId || 'none'));
    } catch (e) {
      console.warn('[YongchuMap] 重建上下文失败:', e.message);
    }
  }

  // ── 外部手动触发Swipe处理 ──
  async onSwipeChanged(oldMessageId, newMessageId) {
    const sourceMessageId = this._getSourceMessageId();
    return this.settlement.onSwipeChanged(oldMessageId, newMessageId, sourceMessageId);
  }

  onMessageDeleted(messageId) {
    return this.settlement.onMessageDeleted(messageId);
  }

  unregister() {
    if (this._eventSource) {
      const ES = this._eventSource;
      this._handlers.forEach(function(item) {
        if (!item) return;
        const event = item.event;
        const handler = item.handler;
        try {
          if (typeof ES.off === 'function') {
            ES.off(event, handler);
          } else if (typeof ES.removeListener === 'function') {
            ES.removeListener(event, handler);
          } else if (typeof ES.removeEventListener === 'function') {
            ES.removeEventListener(event, handler);
          }
        } catch (e) {
          console.warn('[YongchuMap] 解绑事件失败:', event, e);
        }
      });
    }
    this._handlers = [];
  }

  getMsgSeq() { return this._msgSeq; }
  getRegisteredEventCount() { return this._handlers.length; }
}

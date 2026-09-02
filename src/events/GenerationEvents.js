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

    // ── GENERATION_ENDED：后置结算主入口，参数按messageId数字处理 ──
    if (ET.GENERATION_ENDED) {
      this._addListener(ET.GENERATION_ENDED, function(messageId) {
        console.log('[YongchuMap] GENERATION_ENDED, messageId=' + messageId + ', seq=' + self._msgSeq);

        if (self._generationStopped) {
          console.log('[YongchuMap] 当前生成轮次已被停止/取消，跳过结算');
          self._generationStopped = false;
          self._currentGenerationId = null;
          return;
        }

        // 参数就是messageId（数字）
        const resolvedMessageId = self._resolveMessageId(messageId);
        if (resolvedMessageId === null || resolvedMessageId === undefined) {
          console.warn('[YongchuMap] GENERATION_ENDED无法解析messageId');
          self._generationStopped = false;
          self._currentGenerationId = null;
          return;
        }

        const sourceMessageId = self._getSourceMessageId();
        const genId = self._currentGenerationId;
        self._currentGenerationId = null;
        self._generationStopped = false;

        self.settlement.settle({
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

    // ── MESSAGE_SWIPED：Swipe时回滚旧版本，重新结算当前版本 ──
    if (ET.MESSAGE_SWIPED) {
      this._addListener(ET.MESSAGE_SWIPED, function(data) {
        console.log('[YongchuMap] MESSAGE_SWIPED, data=' + JSON.stringify(data));
        const messageId = self._resolveMessageId(data);
        if (messageId !== null && messageId !== undefined) {
          const sourceMessageId = self._getSourceMessageId();
          self.settlement.onSwipeChanged(messageId, messageId, sourceMessageId);
        }
      });
    }

  // ── MESSAGE_DELETED：删除消息时回滚对应结算 ──
  // 注意：SillyTavern/TauriTavern 的 MESSAGE_DELETED 事件在消息被从 chat 数组切除后触发，
  // 传来的参数可能是被删除消息的原始索引、messageId，或删除后末尾的新索引/当前选中的消息。
  // 因此，若直接传入的 messageId 在结算索引中，优先直接回滚；
  // 若未直接命中，说明传入的是删除后残留的新末尾索引，应自动在 settlement_history / index 中比对并回滚孤立/已被删楼层的结算。
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
       ET.CHAT_CHANGED && 'CHAT_CHANGED', ET.MESSAGE_SWIPED && 'SWIPED',
       ET.MESSAGE_DELETED && 'DELETED', ET.CHARACTER_CHANGED && 'CHAR_CHANGED']
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

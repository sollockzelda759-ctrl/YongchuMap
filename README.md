# YongchuMap —— 永初地图系统（独立扩展）

## 版本
v0.1.0 — Map Core v1

## 定位
可复用的独立地图扩展，不只给《永初大陆》用，支持多世界数据包。
地图不只是UI，还参与剧情：当前位置、目标位置、路线、距离、旅行方式、最短耗时、旅行进度、动态地点。

## 第一阶段范围（Map Core v1）
**只做核心引擎，不做UI视觉：**
- 地图状态独立存储（按worldId/characterId/chatId隔离）
- physical_state与intent_state分离
- 持久map_state注入（injectPrompts, once:false）
- generation_ended后置结算（幂等）
- 地点注册系统（69个永安地点）
- 距离与路线计算
- 旅行计划与进度管理
- 动态地点（ephemeral/session/persistent）
- candidate候选地点机制
- Location与Entity分离（Entity预留）

**第一阶段不做：**
- 六国漂亮世界地图
- 国家地图视觉
- 二次元永安城市图
- 动态村庄AI生成
- 数据库联动
- MVU联动
- Entity移动系统
- 复杂A*寻路
- GitHub仓库

## 已验证的核心时序
```
地图状态变化
  ↓ uninject旧map_state
  ↓ injectPrompts新map_state（once:false，持久）
用户发消息
  ↓ 剧情推进AI读取map_state
  ↓ 正文AI读取map_state
generation_ended
  ↓ 地图后置结算
  ↓ 更新地图状态
  ↓ 刷新持久map_state
等待下一轮
```

## 项目结构
```
YongchuMap/
├─ manifest.json              # 扩展清单
├─ index.js                   # 入口，组装所有模块
├─ src/
│  ├─ core/
│  │  ├─ MapStore.js          # 状态存储（三级隔离+持久化）
│  │  ├─ MapContext.js        # 持久map_state注入管理
│  │  ├─ LocationRegistry.js  # 地点注册系统
│  │  ├─ RouteEngine.js       # 路线与距离计算
│  │  ├─ TravelEngine.js      # 旅行计划与进度
│  │  └─ SettlementEngine.js  # 后置结算（幂等）
│  ├─ events/
│  │  └─ GenerationEvents.js  # 生成事件监听
│  ├─ adapters/
│  │  ├─ MvuAdapter.js        # MVU可选适配器（接口）
│  │  └─ DatabaseAdapter.js   # 数据库可选适配器（接口）
│  └─ ui/
│     └─ MapPanel.js          # 地图UI面板（空壳）
├─ data/
│  └─ worlds/
│     └─ yongchu/
│        └─ cities/
│           └─ yongan.locations.json  # 69个永安地点
└─ README.md
```

## 核心数据结构

### MapStore 状态
```
physical_state    真实所在位置（只有真正抵达后才更新）
intent_state      用户想去但还没到的地方
travel_state      旅行计划与进度
dynamic_locations 动态地点（运行时创建，不写回STATIC_LOCATIONS）
candidates        候选地点（正文提到但未确认）
map_entities      地图实体（商队/军队/船只，第一版预留）
settlement_history 结算历史（幂等用）
```

### 动态地点生命周期
- ephemeral：路边茶摊、临时商队，过期后标记historical
- session：营地、临时据点，离开区域或剧情结束后清除
- persistent：新发现村庄、重要据点，永久保存

临时地点过期不真正delete，标记 active:false, visible:false, historical:true。

### Location与Entity分离
- Location：城市、村落、驿站、寺庙、渡口、宗门、据点
- Entity：商队、军队、船只、马车、NPC（移动实体，不混进地点数据库）

## 设计原则
1. **地图核心独立**：不强依赖数据库、MVU、世界自运转引擎、某张角色卡
2. **脚本管确定性，AI管生成性**：距离、坐标、路线由脚本计算；AI只声明map_event
3. **map_event只是通知单**：AI不直接写地图数据库，脚本负责建点/坐标/TTL
4. **永久地点不写回STATIC_LOCATIONS**：继续存在动态数据库，标记persistence:permanent
5. **正文关键词兜底只建candidate**：不直接建正式地点，避免"听说/回忆/远处看到"污染地图

## 未来视觉目标（第二阶段以后）
- 世界总图：永初大陆六国
- 国家地图：主要城市、宗门、港口、山脉、据点、路线
- 城市地图：二次元古风RPG/乙女游戏城镇地图
- 局部地图：宅邸、宗门、山寨、客栈内部

永安城视觉要求：皇城突出、街坊连片、洛水穿城、北岸繁华南岸稀疏、王府世家官署形成街区、标签克制、普通地点靠Tooltip。

## 多世界支持
扩展不写死《永初大陆》。同一扩展可加载不同世界数据包：
```
YongchuMap/
└─ data/worlds/
   ├─ yongchu/          # 永初大陆数据包
   └─ second_world/     # 第二张角色卡世界数据包
```
换世界数据，不重写引擎。

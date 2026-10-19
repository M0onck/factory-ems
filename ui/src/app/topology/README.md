# 拓扑画布（Topology Canvas）二次开发文档

> 本文档描述 `openems/ui/src/app/topology/` 下「工厂能源管理系统拓扑编辑器」的设计、已实现能力、
> 关键实现细节、扩展方式与**待实现功能**。适用于继续二次开发者快速上手。

---

## 1. 模块简介

本模块在 OpenEMS（FENECON）官方 UI 中新增一个 **拓扑编辑器** 页面，用 [AntV X6](https://x6.antv.antgroup.com/)
绘制一张可编辑的「控制设计图」：

- 从 Edge 拉取真实组件配置（`getEdgeConfig`），按白名单渲染为可拖拽节点；
- 支持拖拽元件、连线（测量 / 控制语义）、编辑参数、连接组（Bridge）；
- 连线与属性之间**双向同步**（连线自动填引用，改属性自动增删连线）；
- 校验后「应用到 Edge」（只增改、不删除、带保护清单与 diff 预览）；
- 自动生成 Scheduler，自动推断数据源绑定与初始连线。

挂载路由：`/device/:edgeId/topology`（必须位于 `/device/:edgeId/...` 之下，依赖「当前 Edge」上下文）。

---

## 2. 快速开始

### 2.1 构建 UI

```powershell
$node = 'C:\Users\<你>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$env:NODE_OPTIONS = '--max-old-space-size=8192'
& $node 'D:\project\ems_dev\openems\ui\node_modules\@angular\cli\bin\ng.js' build -c openems,openems-edge-prod,prod
```

产物在 `openems/ui/target/`。

### 2.2 部署到本地演示环境

```powershell
$src = 'D:\project\ems_dev\openems\ui\target'
$dst = 'D:\project\ems_dev\ems-mvp\ui\openems-ui'
Remove-Item "$dst\*" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$src\*" -Destination $dst -Recurse -Force
```

### 2.3 访问

| 项目           | 地址 / 凭据                                                  |
| -------------- | ------------------------------------------------------------ |
| Edge 启动      | `powershell -File D:\project\ems_dev\ems-mvp\start-edge.ps1` |
| UI 静态服务    | `http://127.0.0.1:4200`（`start-ui.ps1`）                    |
| Edge WebSocket | `127.0.0.1:8075`                                             |
| 拓扑页         | `http://localhost:4200/device/0/topology`                    |
| 登录           | 密码 `admin` = 管理员；`user` = 访客                         |

> **重要**：`getPropertiesOfFactory`（拉取参数 schema）在 Edge 侧要求 **ADMIN 角色**，
> 访客登录时参数表单会降级为「按已配置属性渲染」。要完整体验请用 `admin` 登录。

---

## 3. 文件与职责

| 文件                             | 职责                                                                                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `topology-canvas.component.ts`   | 组件本体：X6 图、面板、表单、连线、校验、导出/下发、上下文菜单、快捷键等（约 3700 行）                                                                                           |
| `topology.draft.ts`              | 草稿数据结构：`DraftComponent` / `DraftConnection` / `TopologySemantic` / `TopologyDraft`                                                                                        |
| `topology.whitelist.ts`          | `FACTORY_WHITELIST`（渲染白名单）、`ComponentKind` 四分类、`componentKind()` / `factoryKind()`                                                                                   |
| `topology.visual.ts`             | 视觉常量：设备类型颜色/图标、分类、Channel 角标、连线语义、边框、分组框                                                                                                          |
| `topology.controller.ts`         | 控制器语义：`inferFieldSemantic()`、`deviceRefIsInput()`、`controllerPropertyDefinitions()`、`controllerDeviceRefFields()`、`componentRefType()`、`componentIdOptionsByPrefix()` |
| `topology.channel-capability.ts` | 由 natureId 推导 `ChannelCapability{measure,control}`（当前为启发式表，见 Roadmap）                                                                                              |
| `topology.factory-schema.ts`     | `PropertyDefinition`、`mapFactoryType()`、`repeatElementType()`                                                                                                                  |
| `topology.connection-group.ts`   | 连接组（Modbus Bridge）模型与 factoryPid/properties 转换                                                                                                                         |
| `topology.devices.ts`            | `DevicePaletteEntry`（面板条目）                                                                                                                                                 |
| `property-form.component.ts`     | 通用 @ngx-formly 参数表单（含数组/点号 key 处理）                                                                                                                                |
| `legend.component.ts`            | 可折叠图例（读取 `topology.visual.ts`）                                                                                                                                          |

---

## 4. 核心概念

### 4.1 组件四分类（`ComponentKind`）

`componentKind(factoryPid, id)` 判定：

| 分类             | 判定规则                                                       | 是否显示在画布 |
| ---------------- | -------------------------------------------------------------- | -------------- |
| `infrastructure` | `id` 以 `_` 开头；或 `Controller.Api.*` / `Controller.Debug.*` | ❌ 隐藏        |
| `datasource`     | `Simulator.Datasource.*`                                       | ✅             |
| `controller`     | `Controller.*`（除 Api/Debug）                                 | ✅             |
| `device`         | 其余                                                           | ✅             |

基础设施（`Ess.Power`、`Evcs.*Filter`、WebSocket / Debug 控制器、Core/Scheduler/Timedata）
属于系统管线，**不进入控制设计图**，但仍保留在 Edge 上（下发保护清单里不会删除它们）。

### 4.2 设备引用与方向

OpenEMS 组件的引用字段有两种命名（开启识别）：

- `ess.id` / `meter.id` / `datasource.id`（点号）
- `ess_id` / `meter_id`（下划线）

`inferFieldSemantic()` 统一识别为 `device-ref`（单个）或 `device-ref-list`（列表）。

`deviceRefIsInput(prefix)` 决定连线方向（启发式）：

| 字段前缀                                    | 方向 | 连线语义      | 边方向            |
| ------------------------------------------- | ---- | ------------- | ----------------- |
| `meter` / `sensor` / `input` / `datasource` | 输入 | `MEASUREMENT` | 被引用设备 → 组件 |
| 其他（如 `ess`）                            | 输出 | `CONTROL`     | 组件 → 被引用设备 |

### 4.3 连线语义

| 语义          | 视觉            | 含义           |
| ------------- | --------------- | -------------- |
| `MEASUREMENT` | 蓝色虚线 + 箭头 | 数据被读取方向 |
| `CONTROL`     | 红色实线 + 箭头 | 指令写入方向   |

### 4.4 连接组（Bridge）

连接组 = 一个可复用的 Modbus Bridge（TCP / Serial），设备通过 `modbus_id` 引用。
导出时 `bridgeId` 对应 `Bridge.Modbus.Tcp` / `Bridge.Modbus.Serial` 组件。

### 4.5 数据源

`Simulator.Datasource.*` 组件为「数据源」，供 Acting 类模拟设备（`Simulator.*.Acting`）通过
`datasource.id` 引用；`datasource.target` 由 Edge 的 `@GenerateTargetsFromReferences` 自动生成，前端不写。

---

## 5. 数据流与生命周期

```
Edge (getEdgeConfig) ──► EdgeConfig
  ├─ 白名单过滤 + 四分类 → DraftComponent[]
  ├─ 渲染节点（renderAll）
  └─ 推断连线（inferConnectionsFromConfig）
          └─ 读 ess.id/meter.id/datasource.id → addConnection()

用户操作
  ├─ 拖拽元件 → createComponent()
  ├─ 连线 → chooseSemantic() → applyConnectionAutoFill()（自动填引用）
  ├─ 编辑属性 → onPropertyChange() → syncDeviceRefEdges()（自动增删连线）
  └─ 编辑「默认数据源」→ onDatasourceChange() → 同上

保存 / 载入 / 导入 / 导出
  └─ localStorage（openems-topology-draft）或 JSON 文本

应用到 Edge
  └─ openApplyPreview()（diff）→ confirmApply()（create/update，不删除）
```

`ngAfterViewInit` 初始化 X6（Selection / Keyboard / History / MiniMap、事件绑定、快捷键），
末尾调用 `loadTopology()`；`ngOnDestroy` 调 `graph.dispose()`。

---

## 6. 已实现功能

### 6.1 渲染与元件

- 从 `getEdgeConfig` 加载组件，按 `FACTORY_WHITELIST` 渲染。
- 设备面板**工厂驱动**，按 `DEVICE_CATEGORIES` 分组；Simulator 也纳入同一分组，
  名称末尾标注 `（Simulator）`（如 `EssSymmetric Reacting（Simulator）`）。
- 控制器面板只列真实控制策略（排除 API / Debug）。
- 拖拽元件到画布创建节点（`createComponent`），自动分配 ID（如 `meter_1`）。
- 节点显示：左侧色条、图标、label、factoryPid、M/C 角标、状态边框（实线=已部署，虚线=草稿）。
- 连线端口：上/右/下/左四个 magnet。

### 6.2 连线

- 从端口拖出连线 → 弹出「测量 / 控制」语义选择器。
- 禁止：自连接、反向重复连接、同向同语义重复。
- 边样式由语义决定；选中边可右键切换语义、删除。
- 渲染与删除同步维护 `this.connections`。

### 6.3 连线 ↔ 属性双向同步

- **连线 → 属性**：`applyConnectionAutoFill()`
  - `meter → Controller`（MEASUREMENT）→ 填 `controller.meter.id`
  - `Controller → ess`（CONTROL）→ 填 `controller.ess.id`
  - `datasource → meter`（MEASUREMENT）→ 填 `meter.datasource.id`
- **属性 → 连线**：`syncDeviceRefEdges()`
  - 手动改 `ess.id` / `meter.id` / `datasource.id` → 自动增删对应边。
- 兼容 `datasource.id` 与 `datasource_id` 两种 key。

### 6.4 参数面板

- 上半「画布抽象层 / 控制策略」：设备类型（factoryPid）、名称、连接组（`modbus_id`）、
  Unit-ID，以及模拟设备的**默认数据源**下拉。
- 下半「驱动参数 / 控制参数」：由 Factory 元数据驱动（`getPropertiesOfFactory`）。
  - 支持 STRING / INTEGER / LONG / SHORT / FLOAT / DOUBLE / BOOLEAN / SELECT / REPEAT。
  - ENUM 通过 `schema.templateOptions.options` 识别为下拉。
  - REPEAT（数组，如 `values`、`controllers.ids`）以逗号分隔文本编辑，提交转数组。
  - 属性 id 含 `.`（如 `ess.id`）时表单 key 换成 `_`，避免 formly 当嵌套路径。
  - schema 拉取失败（非 ADMIN）时**降级**为按已配置属性渲染。

### 6.5 连接组

- 新建 / 编辑 / 删除（TCP：IP+端口；Serial：串口+波特率）。
- 节点按其 `modbus_id` 归入分组框（Bridge 分组框，不参与历史/选择）。

### 6.6 校验（`validateTopology`）

- 角标与元数据一致性；
- Bridge 引用有效性、连线端点有效性；
- nature 级：测量边源需可读、控制边目标需可写；
- 孤儿设备提示；
- Controller 必需引用为空、无出边、CONTROL 边与引用字段不一致；
- 设备引用有效性（引用了画布上不存在的组件，跳过 `modbus_id`）；
- Acting 类 Simulator 未绑定数据源；
- 有设备无控制器提示。

### 6.7 保存 / 载入 / 导入 / 导出

- 保存草稿：`localStorage["openems-topology-draft"]`（含 bridges/components/位置/connections）。
- 载入草稿、粘贴 JSON 导入。
- 导出 JSON：`{ bridges, devices, connections }`（devices 含 `alias` 与 properties）。

### 6.8 应用到 Edge（安全下发）

- `openApplyPreview()`：与 Edge 现状 diff，分为
  **新增 / 修改（含字段级变化）/ 受保护跳过 / 保留不删除**。
- `confirmApply()`：**只 create + update，绝不 delete**。
  - 顺序：先 Bridge，再 Device/Controller。
  - 保护清单：`_` 前缀、`Core.` / `Timedata.` / `Controller.Api.` 不创建不修改。
  - 自动附加 Scheduler（`scheduler0`，`controllers.ids` = 画布全部控制器，按字母序）。
  - 下发前检查核心件（`_sum`/`_cycle`/`_componentManager`）缺失并提示。

### 6.9 画布交互

- 网格吸附（10px）、点阵背景、小地图、缩放（0.4–2.5）、`blank:dblclick` 复位。
- 平移：空格 + 左键、或中键拖动。
- 撤销/重做（History，50 步；Bridge 分组框不计入）。
- 快捷键：`Ctrl+Z` / `Ctrl+Shift+Z` / `Delete` / `Ctrl+A` / `Ctrl+C` / `Ctrl+V` / `Ctrl+D`。
- 右键菜单（空白 / 节点 / 边）、拖到左下回收站删除、多选（Ctrl/Shift/框选）、复制粘贴。
- 侧栏分上下两栏：**画布元件**（控制器/设备/连接组 页签）+ **操作面板**。

### 6.10 其他

- 图例（设备类型 / Channel 能力 / 连线语义 / 状态与分组 / 不显示项）。
- 加载时**自动推断并绘制**连线（数据源→表、表→控制器、控制器→储能）。
- Toast 提示、校验面板点击定位闪烁。

---

## 7. 关键实现细节与坑

1. **X6 `<text>` 定位**：用 `refX/refY`，用 `x/y` 不生效。
2. **`targetMarker`**：箭头用 `{ name: "block" }`。
3. **高亮滤镜**：`filter: null` 不会移除，需 `removeAttrByPath`。
4. **History**：`beforeAddCommand` 过滤 `bridge-group:*`；Selection `filter` 同样排除。
5. **`getEdgeConfig` 不含 Factory properties**：必须用 `getPropertiesOfFactory`
   （`edge.getFactoryProperties(ws, factoryPid)`），且 **要求 ADMIN**；拿不到时降级。
6. **属性名点号**：OpenEMS 约定 `ess_id()` → OSGi 属性 `ess.id`（点号）；表单 key 里点号换下划线。
7. **Type 小写**：`Property.toJson()` 输出 `type` 为小写（`integer`/`string`…），比较需小写化。
8. **REPEAT**：`schema.type === "repeat"`；元素类型由 `property.type` 推导。
9. **`datasource.target`**：由 Edge `@GenerateTargetsFromReferences` 自动生成，前端只写 `datasource.id`。
10. **保护清单**：`isProtectedComponent()` 对 `_` 前缀与 `Core.`/`Timedata.`/`Controller.Api.` 生效。
11. **Async**：Factory 属性按需拉取 + 缓存（`factoryPropertiesCache`）；`openPanel` 同步刷新后异步补全。
12. **Zone**：X6 回调在 Angular Zone 外，需 `cdRef.detectChanges()`。

---

## 8. 扩展指南

### 8.1 新增一类设备到面板

1. 在 `topology.visual.ts` 的 `DEVICE_CATEGORIES` 增加 `{ label, pattern }`（如 `/^MyDevice\./i`）。
2. 在 `DEVICE_TYPE_VISUAL` 增加颜色/图标/标签。
3. 若需要渲染到画布，在 `topology.whitelist.ts` 的 `FACTORY_WHITELIST` 增加规则。
4. 若需按 nature 归类（如 Simulator），已有 `deviceCategory(factoryPid, natureIds)` 兜底。

### 8.2 新增语义自动填充

在 `topology.controller.ts` 的 `inferFieldSemantic()` 增加后缀规则，
并在 `topology-canvas.component.ts` 的 `applyConnectionAutoFill()` / `syncDeviceRefField()` 中
复用 `deviceRefIsInput()` 决定方向。

### 8.3 新增校验规则

在 `validateTopology()` 内追加 `warnings.push({ severity, message, cellId })` 即可，
校验面板会自动展示并支持点击定位。

### 8.4 新增表单控件类型

1. `topology.factory-schema.ts`：扩展 `PropertyDefinition["type"]`。
2. `property-form.component.ts`：在 `toField()` 增加分支；数组类参考 `REPEAT` 的 `toRepeatString/fromRepeatString`。

---

## 9. 待实现功能（Roadmap）

> 以下为**尚未实现**、但已识别或规划中的能力，按优先级列示。

### 9.1 高优先级

| 功能                             | 说明                                                                          | 相关位置                          |
| -------------------------------- | ----------------------------------------------------------------------------- | --------------------------------- |
| **Scheduler 执行顺序可视化**     | 目前自动生成 `controllers.ids`（字母序），尚不支持手动拖拽排序 / 显示执行顺序 | `buildSchedulerApplyItem()`、侧栏 |
| **正交连线路由**                 | 当前边为默认曲线/直线，未做正交（直角）路由与避让                             | X6 `router` 配置                  |
| **自动布局**                     | 无「一键整理」布局算法（分层/力导向）                                         | `renderAll` / 工具栏              |
| **真实 Channel accessMode 角标** | 现用 nature 启发式表（`NATURE_CAPABILITY`），应改为读 Channel `accessMode`    | `topology.channel-capability.ts`  |
| **全新 Edge 最小骨架初始化**     | 目前仅提示缺失核心件，未真正创建 `_sum`/`_cycle`/`scheduler` 骨架             | `openApplyPreview()`              |

### 9.2 中优先级

| 功能                        | 说明                                                    |
| --------------------------- | ------------------------------------------------------- |
| **图片 / SVG 导出**         | 把画布导出为 PNG/SVG（X6 `toPNG`/`toSVG`）              |
| **实时数据叠加**            | 订阅 Channel，在节点上显示实时功率 / SOC                |
| **手动输入/输出方向选择器** | 允许用户覆盖 `deviceRefIsInput` 的启发式判断            |
| **更多设备引用语义**        | ESS 集群、虚拟表加减、IO 映射等自动绑定                 |
| **设备属性强类型下拉**      | 对 `datasource_id` 等字段统一渲染为下拉（而非自由文本） |
| **多选批量编辑**            | 批量修改同一类设备属性                                  |
| **撤销/重做的属性一致性**   | 撤销后确保面板/`components` 与图同步                    |

### 9.3 低优先级 / 体验

| 功能                | 说明                                                                               |
| ------------------- | ---------------------------------------------------------------------------------- |
| **修复 alias 乱码** | `config.d` 中中文 alias 为 GBK 误读（如「鐢垫睜」=「电池」），需修正编码或重写配置 |
| **多语言**          | 目前界面中文，代码注释中文；如需国际化需接入 i18n                                  |
| **节点内联编辑**    | 双击节点直接改 label                                                               |
| **边标签/注释**     | 连线可加说明文字                                                                   |
| **画布缩略导航**    | MiniMap 已实现，可增强交互                                                         |

---

## 10. 已知问题与排障

| 现象                           | 原因 / 处理                                                             |
| ------------------------------ | ----------------------------------------------------------------------- |
| 参数面板字段很少 / 全空        | 未以 ADMIN 登录，`getPropertiesOfFactory` 被拒绝；用 `admin/admin` 登录 |
| 登录页无法输入                 | 已修复：移除密码框预填 `user`、修正 `type="input"`→`text`               |
| `config.d` 中文乱码            | GBK/UTF-8 编码问题，alias 显示为乱码，不影响画布逻辑                    |
| 画布不显示某设备               | 检查 `FACTORY_WHITELIST` 是否命中；基础设施会被隐藏（正常）             |
| 应用到 Edge 后未生效           | 刷新页面重载；确认无「受保护跳过」；确认 Scheduler 已生成               |
| 控制台 `获取 Factory 属性失败` | 角色不足或 factory 不存在；查看打印的具体 message                       |

---

## 11. 附录：核心数据结构

### 11.1 DraftComponent

```ts
interface DraftComponent {
  id: string;
  factoryPid: string;
  label: string;
  properties: Record<string, unknown>;
  category: TopologyCategory;
  persisted: boolean;
  natureIds?: string[];
}
```

### 11.2 DraftConnection

```ts
interface DraftConnection {
  source: string;
  target: string;
  semantic: "MEASUREMENT" | "CONTROL";
  edgeId: string;
}
```

### 11.3 草稿 JSON（保存/导入）

```json
{
  "bridges": [{ "id": "modbus0", "type": "tcp", "ip": "192.168.1.10", "port": 502, "portName": "/dev/ttyUSB0", "baudRate": 9600 }],
  "components": [{ "id": "meter0", "factoryPid": "Simulator.GridMeter.Reacting", "label": "meter0", "properties": {}, "x": 40, "y": 40 }],
  "connections": [{ "source": "meter0", "target": "ctrlPeakShaving0", "semantic": "MEASUREMENT" }]
}
```

### 11.4 导出 JSON（`exportDraft`）

```json
{
  "bridges": [{ "id": "modbus0", "factoryPid": "Bridge.Modbus.Tcp", "properties": { "ip": "192.168.1.10", "port": 502 } }],
  "connections": [{ "source": "meter0", "target": "ctrlPeakShaving0", "semantic": "MEASUREMENT" }],
  "devices": [{ "id": "meter0", "factoryPid": "Simulator.GridMeter.Reacting", "alias": "meter0", "properties": {} }]
}
```

### 11.5 应用到 Edge 的预览结构

```ts
interface ApplyPreview {
  toCreate: ApplyItem[];
  toUpdate: { item: ApplyItem; changes: string[] }[];
  skippedProtected: { id: string; factoryPid: string }[];
  kept: { id: string; factoryPid: string }[];
}
```

---

## 12. 相关文档

- 演示环境与 Edge 配置说明：`ems-mvp/README.md`
- OpenEMS 官方：<https://github.com/OpenEMS/openems>
- AntV X6：<https://x6.antv.antgroup.com/>

# TopologyCanvasComponent

一个 Angular **standalone** 组件，使用 [AntV X6](https://x6.antv.antgroup.com/) 渲染一张**只读**的电气拓扑图。

- 阶段一：只做「数据 → 图」的单向渲染（硬编码模拟数据）。
- 阶段二：通过现有 WebSocket 服务请求 `getEdgeConfig`，从真实 Edge 获取 Component 列表，按白名单渲染节点。
- 阶段三（当前）：点击节点 → 打开参数面板 → 编辑 → 回写本地状态（不发送 JSON-RPC）。

## 文件

| 文件 | 说明 |
|---|---|
| `topology-canvas.component.ts` | 组件本体（EdgeConfig + 渲染 + 点击 + 参数面板） |
| `topology.whitelist.ts` | 前端侧 factoryId 白名单 |
| `topology.factory-schema.ts` | 阶段三 mock factory schema + `PropertyDefinition` |
| `property-form.component.ts` | 通用 @ngx-formly 参数表单 |

## 数据流

```
Edge (WebSocket + JSON-RPC getEdgeConfig)
  → Service.getConfig() → EdgeConfig
  → 按 factoryId 白名单过滤
  → X6 addNode / addEdge（只读渲染）
  → 点击节点 → 参数面板（mock schema 驱动）→ 回写 Component.properties + console.log
```

## 阶段三：点击节点 → 参数编辑

### 节点点击拿到 componentId

```ts
this.graph.on("node:click", ({ node }) => {
    this.onNodeClick(node.id); // node.id 即创建节点时传入的 componentId
});
```

因为创建节点时用 `id: component.id`，所以 X6 回调里的 `node.id` 就是 `componentId`。

### 通用 PropertyFormComponent

输入 `properties: PropertyDefinition[]`（每个含 `id/name/type/default/required`），
内部用 @ngx-formly 动态生成字段（`type` 映射：STRING→input、INTEGER 等→number input、
BOOLEAN→checkbox-button），输出 `(valueChange)` 即编辑后的 `{ [id]: value }`。

### mock factory schema

阶段三暂不接入真实 Factory 元数据，用 `MOCK_FACTORY_SCHEMA` 驱动：

| factoryId | 属性 |
|---|---|
| `Meter.Socomec.DirisA40` | `modbusUnitId`(INTEGER)、`ip`(STRING) |
| `Ess.Power` | `maxChargePower`(INTEGER)、`maxDischargePower`(INTEGER) |

点击无 schema 的节点时，面板显示「该设备类型暂无参数定义」。

### 回写本地状态（不发 JSON-RPC）

编辑后把 `{ [id]: value }` 写回该 Component 的 `properties`，并打印完整 JSON：

```ts
Object.assign(this.selectedComponent.properties, values);
console.log(JSON.stringify(this.selectedComponent, null, 2));
```

## factoryId 白名单

见 `topology.whitelist.ts`：`Meter.*`、`Ess.*`、`Pv(Inverter)?.*`、`Evcs.*`，并**临时**加入
`Simulator.*` 以便用虚拟设备测试。

> 真实 OpenEMS 的光伏逆变器 factoryId 前缀不统一（`PvInverter.*`、`PV-Inverter.*`、
> `SolarEdge.PV-Inverter` 等），接入真实设备时按实际 factoryId 扩展。

## 节点 label 规则

主标题 `alias?.trim() || id`，副标题 `factoryId`。

## 连线（阶段二暂用占位）

`EdgeConfig` 中没有连线信息，组件不推断连接。当前：同一分类内按顺序生成虚线占位连线，
画布顶部有提示条。连线语义留待后续阶段。

## 挂载方式

已挂在 Edge 上下文路由下：`/device/:edgeId/topology`。组件依赖「当前 Edge」上下文
（`Service.getCurrentEdge()`），必须挂在 `/device/:edgeId/...` 之下。

## X6 生命周期

- `ngAfterViewInit`：容器挂载后可测量尺寸，才 `new Graph({ container })`。
- `ngOnDestroy`：`graph.dispose()` 释放 SVG/DOM/事件监听，避免内存泄漏。

## 只读约束

`interacting: false` + `panning: false` + `mousewheel: false`，拓扑图只能看；但节点点击
事件仍可触发（点击不改变拓扑，只打开参数面板）。

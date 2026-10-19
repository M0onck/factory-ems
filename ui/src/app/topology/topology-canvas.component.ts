import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, ViewChild, } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Cell, CellAttrs, Edge, Graph, History, Keyboard, MiniMap, Node, Selection } from "@antv/x6";
import { EdgeConfig, Service } from "src/app/shared/shared";
import { PropertyFormComponent } from "./property-form.component";
import { LegendComponent } from "./legend.component";
import { ConnectionGroup, connectionGroupFactoryPid, connectionGroupProperties, createConnectionGroup, } from "./topology.connection-group";
import { ChannelCapability, channelCapability } from "./topology.channel-capability";
import { componentIdOptionsByPrefix, componentRefType, controllerDeviceRefFields, controllerLabel, controllerPropertyDefinitions, deviceRefIsInput, inferFieldSemantic, isControllerFactoryPid, } from "./topology.controller";
import { DevicePaletteEntry } from "./topology.devices";
import { DraftComponent, DraftConnection, TopologySemantic } from "./topology.draft";
import { mapFactoryType, PropertyDefinition, repeatElementType } from "./topology.factory-schema";
import { CONTROL_BADGE, DEPLOYED_BORDER, deviceCategory, deviceTypeVisual, DRAFT_BORDER, EDGE_SEMANTIC_VISUAL, GROUP_FRAME, MEASURE_BADGE, UNKNOWN_SEMANTIC_VISUAL, } from "./topology.visual";
import { componentKind, factoryKind, FACTORY_WHITELIST, TopologyCategory } from "./topology.whitelist";

interface TopologyWarning {
    severity: "warning" | "info";
    message: string;
    cellId?: string;
}

const DRAFT_STORAGE_KEY = "openems-topology-draft";

/** 下发保护清单：这些 factoryPid 前缀的组件是 Edge 核心基础设施，禁止创建/修改/删除 */
const PROTECTED_FACTORY_PREFIXES = ["Core.", "Timedata.", "Controller.Api."];

function isProtectedComponent(factoryPid: string, id: string): boolean {
    if (id.startsWith("_")) {
        return true;
    }
    return PROTECTED_FACTORY_PREFIXES.some((prefix) => factoryPid.startsWith(prefix));
}

interface ApplyItem {
    id: string;
    factoryPid: string;
    properties: Record<string, unknown>;
    alias: string;
}

interface ApplyPreview {
    toCreate: ApplyItem[];
    toUpdate: { item: ApplyItem; changes: string[] }[];
    skippedProtected: { id: string; factoryPid: string }[];
    kept: { id: string; factoryPid: string }[];
}

/** 自定义矩形卡片节点：显示 label 与 factoryPid 两行文字，并带上下左右 4 个连接端口。 */
Graph.registerNode(
    "topology-node",
    {
        inherit: "rect",
        markup: [
            { tagName: "rect", selector: "body" },
            { tagName: "rect", selector: "leftBar" },
            { tagName: "rect", selector: "iconBg" },
            { tagName: "text", selector: "icon" },
            { tagName: "text", selector: "label" },
            { tagName: "text", selector: "pid" },
            { tagName: "circle", selector: "measureBadge" },
            { tagName: "text", selector: "measureBadgeText" },
            { tagName: "circle", selector: "controlBadge" },
            { tagName: "text", selector: "controlBadgeText" },
        ],
        attrs: {
            body: {
                fill: "#ffffff",
                stroke: DEPLOYED_BORDER.stroke,
                strokeWidth: 1,
                rx: 6,
                ry: 6,
            },
            leftBar: {
                x: 0,
                y: 0,
                width: 4,
                height: 64,
                fill: "#9E9E9E",
                rx: 2,
                ry: 2,
                pointerEvents: "none",
            },
            iconBg: {
                x: 12,
                y: 22,
                width: 20,
                height: 20,
                rx: 4,
                ry: 4,
                fill: "#9E9E9E",
                pointerEvents: "none",
            },
            icon: {
                refX: 22,
                refY: 32,
                text: "?",
                fill: "#ffffff",
                fontSize: 12,
                fontWeight: 700,
                textAnchor: "middle",
                textVerticalAnchor: "middle",
                pointerEvents: "none",
            },
            label: {
                refX: 44,
                refY: 25,
                text: "",
                fill: "#262626",
                fontSize: 14,
                fontWeight: 600,
                textAnchor: "start",
                textVerticalAnchor: "middle",
                pointerEvents: "none",
            },
            pid: {
                refX: 44,
                refY: 43,
                text: "",
                fill: "#8c8c8c",
                fontSize: 10,
                textAnchor: "start",
                textVerticalAnchor: "middle",
                pointerEvents: "none",
            },
            measureBadge: {
                cx: 13,
                cy: 11,
                r: 7,
                fill: MEASURE_BADGE.color,
                display: "none",
            },
            measureBadgeText: {
                refX: 13,
                refY: 11,
                text: MEASURE_BADGE.letter,
                fill: "#ffffff",
                fontSize: 9,
                fontWeight: 700,
                textAnchor: "middle",
                textVerticalAnchor: "middle",
                display: "none",
            },
            controlBadge: {
                cx: 29,
                cy: 11,
                r: 7,
                fill: CONTROL_BADGE.color,
                display: "none",
            },
            controlBadgeText: {
                refX: 29,
                refY: 11,
                text: CONTROL_BADGE.letter,
                fill: "#ffffff",
                fontSize: 9,
                fontWeight: 700,
                textAnchor: "middle",
                textVerticalAnchor: "middle",
                display: "none",
            },
        },
        ports: {
            groups: {
                top: {
                    position: "top",
                    attrs: { circle: { r: 4, magnet: true, stroke: "#5f95ff", strokeWidth: 2, fill: "#ffffff" } },
                },
                right: {
                    position: "right",
                    attrs: { circle: { r: 4, magnet: true, stroke: "#5f95ff", strokeWidth: 2, fill: "#ffffff" } },
                },
                bottom: {
                    position: "bottom",
                    attrs: { circle: { r: 4, magnet: true, stroke: "#5f95ff", strokeWidth: 2, fill: "#ffffff" } },
                },
                left: {
                    position: "left",
                    attrs: { circle: { r: 4, magnet: true, stroke: "#5f95ff", strokeWidth: 2, fill: "#ffffff" } },
                },
            },
            items: [
                { id: "top", group: "top" },
                { id: "right", group: "right" },
                { id: "bottom", group: "bottom" },
                { id: "left", group: "left" },
            ],
        },
    },
    true,
);

/** Bridge 分组框节点：浅灰虚线边框 + 左上角标题，圈住同一 Bridge 下的设备。 */
Graph.registerNode(
    "bridge-group",
    {
        inherit: "rect",
        markup: [
            { tagName: "rect", selector: "body" },
            { tagName: "text", selector: "title" },
        ],
        attrs: {
            body: {
                fill: GROUP_FRAME.fill,
                stroke: GROUP_FRAME.stroke,
                strokeWidth: 1,
                strokeDasharray: GROUP_FRAME.dasharray,
                rx: 6,
                ry: 6,
                pointerEvents: "none",
            },
            title: {
                refX: 10,
                refY: 6,
                text: "",
                fill: "#616161",
                fontSize: 11,
                textAnchor: "start",
                textVerticalAnchor: "top",
                pointerEvents: "none",
            },
        },
    },
    true,
);

/** 六边形 Controller 节点：蓝灰主色 + 齿轮图标 + M/C 角标 */
Graph.registerNode(
    "controller-node",
    {
        inherit: "polygon",
        markup: [
            { tagName: "polygon", selector: "body" },
            { tagName: "text", selector: "icon" },
            { tagName: "text", selector: "label" },
            { tagName: "text", selector: "pid" },
            { tagName: "circle", selector: "measureBadge" },
            { tagName: "text", selector: "measureBadgeText" },
            { tagName: "circle", selector: "controlBadge" },
            { tagName: "text", selector: "controlBadgeText" },
        ],
        attrs: {
            body: {
                refPoints: "10,0 90,0 100,50 90,100 10,100 0,50",
                fill: "#455A64",
                stroke: "#37474F",
                strokeWidth: 1,
            },
            icon: {
                refX: 30,
                refY: 32,
                text: "⚙",
                fill: "#ffffff",
                fontSize: 16,
                textAnchor: "middle",
                textVerticalAnchor: "middle",
                pointerEvents: "none",
            },
            label: {
                refX: 52,
                refY: 25,
                text: "",
                fill: "#ffffff",
                fontSize: 14,
                fontWeight: 600,
                textAnchor: "start",
                textVerticalAnchor: "middle",
                pointerEvents: "none",
            },
            pid: {
                refX: 52,
                refY: 43,
                text: "",
                fill: "#B0BEC5",
                fontSize: 10,
                textAnchor: "start",
                textVerticalAnchor: "middle",
                pointerEvents: "none",
            },
            measureBadge: {
                cx: 13,
                cy: 11,
                r: 7,
                fill: MEASURE_BADGE.color,
                display: "none",
            },
            measureBadgeText: {
                refX: 13,
                refY: 11,
                text: MEASURE_BADGE.letter,
                fill: "#ffffff",
                fontSize: 9,
                fontWeight: 700,
                textAnchor: "middle",
                textVerticalAnchor: "middle",
                display: "none",
            },
            controlBadge: {
                cx: 29,
                cy: 11,
                r: 7,
                fill: CONTROL_BADGE.color,
                display: "none",
            },
            controlBadgeText: {
                refX: 29,
                refY: 11,
                text: CONTROL_BADGE.letter,
                fill: "#ffffff",
                fontSize: 9,
                fontWeight: 700,
                textAnchor: "middle",
                textVerticalAnchor: "middle",
                display: "none",
            },
        },
        ports: {
            groups: {
                top: {
                    position: "top",
                    attrs: { circle: { r: 4, magnet: true, stroke: "#455A64", strokeWidth: 2, fill: "#ffffff" } },
                },
                right: {
                    position: "right",
                    attrs: { circle: { r: 4, magnet: true, stroke: "#455A64", strokeWidth: 2, fill: "#ffffff" } },
                },
                bottom: {
                    position: "bottom",
                    attrs: { circle: { r: 4, magnet: true, stroke: "#455A64", strokeWidth: 2, fill: "#ffffff" } },
                },
                left: {
                    position: "left",
                    attrs: { circle: { r: 4, magnet: true, stroke: "#455A64", strokeWidth: 2, fill: "#ffffff" } },
                },
            },
            items: [
                { id: "top", group: "top" },
                { id: "right", group: "right" },
                { id: "bottom", group: "bottom" },
                { id: "left", group: "left" },
            ],
        },
    },
    true,
);

@Component({
    selector: "app-topology-canvas",
    standalone: true,
    imports: [PropertyFormComponent, FormsModule, LegendComponent],
    template: `
        <div class="editor-layout">
            <!-- 左侧栏：上栏「画布元件」+ 下栏「操作面板」 -->
            <aside class="sidebar">
                <!-- 上栏：画布元件（控制器 / 设备 / 连接组 页签） -->
                <section class="sidebar-section elements-section">
                    <h3 class="panel-heading">画布元件</h3>
                    <div class="element-tabs">
                        <button
                            type="button"
                            class="element-tab"
                            [class.active]="activeElementTab === 'controller'"
                            (click)="activeElementTab = 'controller'"
                        >
                            控制器
                        </button>
                        <button
                            type="button"
                            class="element-tab"
                            [class.active]="activeElementTab === 'device'"
                            (click)="activeElementTab = 'device'"
                        >
                            设备
                        </button>
                        <button
                            type="button"
                            class="element-tab"
                            [class.active]="activeElementTab === 'group'"
                            (click)="activeElementTab = 'group'"
                        >
                            连接组
                        </button>
                    </div>
                    <div class="element-tab-content">
                        @if (activeElementTab === "controller") {
                            @for (controller of controllerPalette; track controller.factoryPid) {
                                <div class="device-item" draggable="true" (dragstart)="onDragStart($event, controller)">
                                    <span class="device-label">{{ controller.label }}</span>
                                    <span class="device-pid">{{ controller.factoryPid }}</span>
                                </div>
                            }
                        }
                        @if (activeElementTab === "device") {
                            @for (group of deviceGroups; track group.label) {
                                <h4 class="device-group-title">{{ group.label }}</h4>
                                @for (device of group.devices; track device.factoryPid) {
                                    <div class="device-item" draggable="true" (dragstart)="onDragStart($event, device)">
                                        <span class="device-label">{{ device.label }}</span>
                                        <span class="device-pid">{{ device.factoryPid }}</span>
                                    </div>
                                }
                            }
                        }
                        @if (activeElementTab === "group") {
                            @for (group of connectionGroups; track group.id) {
                                <div class="group-item">
                                    <span class="group-label"
                                        >{{ group.id }} · {{ group.type === "tcp" ? "TCP" : "Serial" }}</span
                                    >
                                    <button type="button" class="group-btn" (click)="startEditGroup(group)">
                                        编辑
                                    </button>
                                    <button type="button" class="group-btn" (click)="deleteGroup(group.id)">
                                        删除
                                    </button>
                                </div>
                            }
                            @if (editingGroup) {
                                <div class="group-form">
                                    <label class="group-field-label">ID</label>
                                    <input
                                        class="group-input"
                                        [(ngModel)]="editingGroup.id"
                                        [disabled]="!isCreatingGroup"
                                    />
                                    <label class="group-field-label">类型</label>
                                    <select class="group-input" [(ngModel)]="editingGroup.type">
                                        <option value="tcp">Modbus TCP</option>
                                        <option value="serial">Modbus Serial</option>
                                    </select>
                                    @if (editingGroup.type === "tcp") {
                                        <label class="group-field-label">IP</label>
                                        <input class="group-input" [(ngModel)]="editingGroup.ip" />
                                        <label class="group-field-label">端口</label>
                                        <input class="group-input" type="number" [(ngModel)]="editingGroup.port" />
                                    } @else {
                                        <label class="group-field-label">串口</label>
                                        <input class="group-input" [(ngModel)]="editingGroup.portName" />
                                        <label class="group-field-label">波特率</label>
                                        <input class="group-input" type="number" [(ngModel)]="editingGroup.baudRate" />
                                    }
                                    <div class="group-actions">
                                        <button type="button" class="group-btn" (click)="saveGroup()">保存</button>
                                        <button type="button" class="group-btn" (click)="cancelGroupEdit()">
                                            取消
                                        </button>
                                    </div>
                                </div>
                            } @else {
                                <button type="button" class="group-add" (click)="startCreateGroup()">
                                    ＋ 新建连接组
                                </button>
                            }
                        }
                    </div>
                </section>

                <!-- 下栏：操作面板 -->
                <section class="sidebar-section operation-section">
                    <h3 class="panel-heading">操作面板</h3>
                    <div class="toolbar">
                        <button type="button" class="toolbar-btn" [disabled]="!canUndo" (click)="undo()">撤销</button>
                        <button type="button" class="toolbar-btn" [disabled]="!canRedo" (click)="redo()">重做</button>
                    </div>
                    <div class="toolbar">
                        <button type="button" class="toolbar-btn" (click)="saveDraft()">保存草稿</button>
                        <button type="button" class="toolbar-btn" (click)="loadDraft()">载入草稿</button>
                    </div>
                    <textarea
                        class="import-input"
                        [(ngModel)]="importText"
                        placeholder="粘贴草稿 JSON 后点导入"
                    ></textarea>
                    <button type="button" class="toolbar-btn" (click)="importDraft()">导入草稿</button>
                    <button type="button" class="apply-btn" (click)="openApplyPreview()">应用到 Edge</button>
                    <button type="button" class="export-btn" (click)="exportDraft()">
                        导出拓扑草稿
                        @if (validationWarnings.length > 0) {
                            <span class="warning-badge">{{ validationWarnings.length }}</span>
                        }
                    </button>
                    <p class="export-note">导出后请先应用 Bridge 配置，再应用 Device 配置</p>
                    <textarea
                        class="export-area"
                        [value]="exportedJson"
                        readonly
                        placeholder="导出结果将显示在这里"
                    ></textarea>
                </section>
            </aside>

            <!-- 画布 -->
            <div #canvasWrap class="canvas-wrap" (dragover)="onDragOver($event)" (drop)="onDrop($event)">
                <div class="topology-note">拖拽左侧设备到画布创建节点 · 从节点端口拖出连线</div>
                <div #canvas class="topology-canvas"></div>
                <!-- 图例 -->
                <app-topology-legend />
                <!-- 校验警告面板 -->
                @if (showValidationPanel && validationWarnings.length > 0) {
                    <div class="validation-panel">
                        <div class="validation-header">
                            <span class="validation-title">拓扑校验（{{ validationWarnings.length }}）</span>
                            <button type="button" class="validation-close" (click)="closeValidationPanel()">×</button>
                        </div>
                        @for (warning of validationWarnings; track $index) {
                            <div
                                class="validation-item"
                                [class.warning]="warning.severity === 'warning'"
                                [class.info]="warning.severity === 'info'"
                                (click)="focusWarning(warning)"
                            >
                                {{ warning.message }}
                            </div>
                        }
                    </div>
                }
                <!-- 下发预览 -->
                @if (applyPreview) {
                    <div class="apply-modal-backdrop">
                        <div class="apply-modal">
                            <div class="apply-modal-header">
                                <span class="apply-modal-title">下发预览（只增改，不删除）</span>
                                <button type="button" class="validation-close" (click)="cancelApply()">×</button>
                            </div>
                            <div class="apply-modal-body">
                                @if (applyPreview.toCreate.length > 0) {
                                    <h4 class="apply-section-title">新增（{{ applyPreview.toCreate.length }}）</h4>
                                    @for (item of applyPreview.toCreate; track item.id) {
                                        <div class="apply-item create">{{ item.id }} · {{ item.factoryPid }}</div>
                                    }
                                }
                                @if (applyPreview.toUpdate.length > 0) {
                                    <h4 class="apply-section-title">修改（{{ applyPreview.toUpdate.length }}）</h4>
                                    @for (change of applyPreview.toUpdate; track change.item.id) {
                                        <div class="apply-item update">
                                            <div>{{ change.item.id }} · {{ change.item.factoryPid }}</div>
                                            @for (detail of change.changes; track detail) {
                                                <div class="apply-change">{{ detail }}</div>
                                            }
                                        </div>
                                    }
                                }
                                @if (applyPreview.skippedProtected.length > 0) {
                                    <h4 class="apply-section-title">
                                        受保护，跳过（{{ applyPreview.skippedProtected.length }}）
                                    </h4>
                                    @for (item of applyPreview.skippedProtected; track item.id) {
                                        <div class="apply-item skipped">{{ item.id }} · {{ item.factoryPid }}</div>
                                    }
                                }
                                @if (applyPreview.kept.length > 0) {
                                    <h4 class="apply-section-title">
                                        不在画布中，保留不删（{{ applyPreview.kept.length }}）
                                    </h4>
                                    @for (item of applyPreview.kept; track item.id) {
                                        <div class="apply-item kept">{{ item.id }} · {{ item.factoryPid }}</div>
                                    }
                                }
                                @if (applyPreview.toCreate.length === 0 && applyPreview.toUpdate.length === 0) {
                                    <p class="apply-empty">画布与 Edge 配置一致，无需应用。</p>
                                }
                            </div>
                            <div class="apply-modal-footer">
                                <button type="button" class="toolbar-btn" (click)="cancelApply()">取消</button>
                                <button
                                    type="button"
                                    class="apply-confirm-btn"
                                    [disabled]="
                                        applyPreview.toCreate.length === 0 && applyPreview.toUpdate.length === 0
                                    "
                                    (click)="confirmApply()"
                                >
                                    确认应用
                                </button>
                            </div>
                        </div>
                    </div>
                }
                <!-- 回收站：拖拽节点到此删除 -->
                <div #trashZone class="trash-zone">🗑 回收站</div>
                <!-- 小地图 -->
                <div #minimapContainer class="minimap"></div>
                <!-- 缩放控制 -->
                <div class="zoom-controls">
                    <button type="button" class="zoom-btn" [disabled]="!canZoomIn" (click)="zoomIn()">＋</button>
                    <span class="zoom-indicator">{{ zoomPercent }}%</span>
                    <button type="button" class="zoom-btn" [disabled]="!canZoomOut" (click)="zoomOut()">－</button>
                    <button type="button" class="zoom-btn" (click)="zoomToFit()">适应</button>
                    <button type="button" class="zoom-btn" (click)="resetView()">重置</button>
                </div>
                <!-- 右键上下文菜单 -->
                @if (contextMenu) {
                    <div class="context-menu" [style.left.px]="contextMenu.x" [style.top.px]="contextMenu.y">
                        @if (contextMenu.type === "blank") {
                            @if (hasClipboard) {
                                <button type="button" class="context-menu-item" (click)="onContextAction('paste')">
                                    粘贴
                                </button>
                            }
                            <button type="button" class="context-menu-item" (click)="onContextAction('zoom')">
                                适应画布
                            </button>
                            <button type="button" class="context-menu-item" (click)="onContextAction('selectAll')">
                                全选
                            </button>
                        }
                        @if (contextMenu.type === "node") {
                            <button type="button" class="context-menu-item" (click)="onContextAction('delete')">
                                删除
                            </button>
                            <button type="button" class="context-menu-item" (click)="onContextAction('copy')">
                                复制
                            </button>
                            <button type="button" class="context-menu-item" (click)="onContextAction('edit')">
                                编辑参数
                            </button>
                        }
                        @if (contextMenu.type === "edge") {
                            <button type="button" class="context-menu-item" (click)="onContextAction('delete')">
                                删除
                            </button>
                            <button type="button" class="context-menu-item" (click)="onContextAction('setMeasurement')">
                                改为测量 (M)
                            </button>
                            <button type="button" class="context-menu-item" (click)="onContextAction('setControl')">
                                改为控制 (C)
                            </button>
                        }
                    </div>
                }
            </div>

            <!-- 参数面板（点击节点） -->
            @if (selectedComponent) {
                <aside class="property-panel">
                    <header class="panel-header">
                        <span class="panel-title">{{ selectedComponent.id }}</span>
                        <button type="button" class="panel-close" (click)="closePanel()">×</button>
                    </header>
                    <!-- 上层：画布抽象层 / 控制策略 -->
                    <div class="panel-section">
                        <h4 class="section-title">{{ isControllerSelected ? "控制策略" : "画布抽象层" }}</h4>
                        <label class="field-label">{{ isControllerSelected ? "控制策略" : "设备类型" }}</label>
                        <select
                            class="field-select"
                            [(ngModel)]="upperFactoryPid"
                            (ngModelChange)="onFactoryPidChange($event)"
                        >
                            @for (factoryId of factoryOptions; track factoryId) {
                                <option [value]="factoryId">{{ factoryId }}</option>
                            }
                        </select>
                        @if (!isControllerSelected) {
                            <label class="field-label">名称</label>
                            <input
                                class="field-input"
                                [(ngModel)]="upperLabel"
                                (ngModelChange)="onLabelChange($event)"
                            />
                            <label class="field-label">连接组 (Bridge)</label>
                            <select
                                class="field-select"
                                [(ngModel)]="upperBridgeId"
                                (ngModelChange)="onBridgeChange($event)"
                            >
                                <option value="">无（直连）</option>
                                @for (group of connectionGroups; track group.id) {
                                    <option [value]="group.id">{{ group.id }}</option>
                                }
                            </select>
                            <label class="field-label">Unit-ID</label>
                            <input
                                class="field-input"
                                type="number"
                                [(ngModel)]="upperUnitId"
                                (ngModelChange)="onUnitIdChange($event)"
                            />
                            @if (upperHasDatasource) {
                                <label class="field-label">默认数据源 (Datasource)</label>
                                <select
                                    class="field-select"
                                    [(ngModel)]="upperDatasourceId"
                                    (ngModelChange)="onDatasourceChange($event)"
                                >
                                    <option value="">未指定</option>
                                    @for (datasource of datasourceOptions; track datasource.id) {
                                        <option [value]="datasource.id">{{ datasource.label }}</option>
                                    }
                                </select>
                            }
                        }
                    </div>
                    <!-- 下层：驱动参数层 -->
                    <div class="panel-section">
                        <h4 class="section-title">{{ isControllerSelected ? "控制参数" : "驱动参数" }}</h4>
                        @if (selectedProperties.length > 0) {
                            <app-property-form
                                [properties]="selectedProperties"
                                (valueChange)="onPropertyChange($event)"
                            />
                        } @else {
                            <p class="panel-empty">
                                {{
                                    isControllerSelected ? "该控制策略暂无参数定义" : "该设备类型暂无驱动参数定义"
                                }}（factoryPid：{{ selectedComponent.factoryPid }}）
                            </p>
                        }
                    </div>
                </aside>
            }
        </div>

        <!-- 连线语义选择器 -->
        @if (showSemanticSelector) {
            <div class="modal-backdrop">
                <div class="modal">
                    <p class="modal-title">选择连线语义</p>
                    <button type="button" class="modal-btn measurement" (click)="chooseSemantic('MEASUREMENT')">
                        测量 (M)
                    </button>
                    <button type="button" class="modal-btn control" (click)="chooseSemantic('CONTROL')">
                        控制 (C)
                    </button>
                    <button type="button" class="modal-btn cancel" (click)="cancelEdge()">取消</button>
                </div>
            </div>
        }

        <!-- 轻提示 -->
        @if (toastMessage) {
            <div class="toast">{{ toastMessage }}</div>
        }
    `,
    styles: [
        `
            :host {
                display: block;
                width: 100%;
                height: 100%;
            }

            .editor-layout {
                display: flex;
                width: 100%;
                height: 100%;
            }

            .sidebar {
                width: 260px;
                flex-shrink: 0;
                border-right: 1px solid #e8e8e8;
                background: #ffffff;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }

            .sidebar-section {
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding: 12px;
                min-height: 0;
            }

            .elements-section {
                flex: 1 1 55%;
                border-bottom: 1px solid #e8e8e8;
                overflow: hidden;
            }

            .operation-section {
                flex: 0 1 45%;
                overflow-y: auto;
            }

            .element-tabs {
                display: flex;
                gap: 4px;
            }

            .element-tab {
                flex: 1;
                border: 1px solid #d9d9d9;
                background: #f5f5f5;
                color: #595959;
                border-radius: 4px;
                padding: 5px 4px;
                font-size: 13px;
                cursor: pointer;
            }

            .element-tab.active {
                border-color: #1677ff;
                background: #e6f4ff;
                color: #1677ff;
                font-weight: 600;
            }

            .element-tab-content {
                flex: 1;
                min-height: 0;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 6px;
                padding-right: 2px;
            }

            .panel-heading {
                font-size: 14px;
                font-weight: 600;
                color: #262626;
                margin: 0 0 4px;
            }

            .device-group-title {
                font-size: 12px;
                font-weight: 600;
                color: #8c8c8c;
                margin: 10px 0 4px;
            }

            .device-item {
                border: 1px solid #d9d9d9;
                border-radius: 6px;
                padding: 8px 10px;
                cursor: grab;
                user-select: none;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .device-item:hover {
                border-color: #5f95ff;
                background: #f0f5ff;
            }

            .device-label {
                font-size: 13px;
                color: #262626;
            }

            .device-pid {
                font-size: 10px;
                color: #8c8c8c;
            }

            .group-item {
                display: flex;
                align-items: center;
                gap: 6px;
                border: 1px solid #d9d9d9;
                border-radius: 6px;
                padding: 6px 8px;
                margin-top: 6px;
            }

            .group-label {
                flex: 1;
                font-size: 12px;
                color: #262626;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .group-btn {
                border: 1px solid #d9d9d9;
                background: #ffffff;
                color: #262626;
                border-radius: 4px;
                padding: 2px 6px;
                cursor: pointer;
                font-size: 11px;
            }

            .group-add {
                margin-top: 8px;
                width: 100%;
                border: 1px dashed #d9d9d9;
                background: #fafafa;
                color: #595959;
                border-radius: 6px;
                padding: 6px 10px;
                cursor: pointer;
                font-size: 13px;
            }

            .group-form {
                margin-top: 8px;
                border: 1px solid #d9d9d9;
                border-radius: 6px;
                padding: 8px;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .group-field-label {
                font-size: 11px;
                color: #8c8c8c;
            }

            .group-input {
                border: 1px solid #d9d9d9;
                border-radius: 4px;
                padding: 4px 6px;
                font-size: 12px;
            }

            .group-actions {
                display: flex;
                gap: 6px;
                margin-top: 4px;
            }

            .export-note {
                margin: 6px 0 0;
                font-size: 11px;
                color: #fa8c16;
            }

            .toolbar {
                display: flex;
                gap: 8px;
                margin-top: 8px;
            }

            .toolbar-btn {
                flex: 1;
                border: 1px solid #d9d9d9;
                background: #ffffff;
                color: #262626;
                border-radius: 4px;
                padding: 6px 10px;
                cursor: pointer;
                font-size: 13px;
            }

            .toolbar-btn:disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }

            .export-btn {
                margin-top: 8px;
                border: 1px solid #1677ff;
                background: #1677ff;
                color: #ffffff;
                border-radius: 4px;
                padding: 6px 10px;
                cursor: pointer;
                font-size: 13px;
            }

            .apply-btn {
                margin-top: 8px;
                border: 1px solid #52c41a;
                background: #52c41a;
                color: #ffffff;
                border-radius: 4px;
                padding: 6px 10px;
                cursor: pointer;
                font-size: 13px;
            }

            .export-area {
                margin-top: 8px;
                min-height: 160px;
                flex: 1;
                font-family: monospace;
                font-size: 11px;
                border: 1px solid #d9d9d9;
                border-radius: 4px;
                padding: 6px;
                resize: vertical;
            }

            .import-input {
                margin-top: 8px;
                min-height: 64px;
                font-family: monospace;
                font-size: 11px;
                border: 1px solid #d9d9d9;
                border-radius: 4px;
                padding: 6px;
                resize: vertical;
            }

            .canvas-wrap {
                flex: 1;
                position: relative;
                min-width: 0;
            }

            .trash-zone {
                position: absolute;
                left: 12px;
                bottom: 12px;
                padding: 8px 14px;
                background: #fff1f0;
                border: 2px dashed #ff4d4f;
                border-radius: 8px;
                color: #ff4d4f;
                font-size: 13px;
                pointer-events: none;
                z-index: 10;
            }

            .minimap {
                position: absolute;
                top: 12px;
                right: 12px;
                z-index: 10;
                width: 200px;
                height: 140px;
                border: 1px solid #d9d9d9;
                border-radius: 6px;
                background: #ffffff;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                overflow: hidden;
            }

            .zoom-controls {
                position: absolute;
                right: 12px;
                bottom: 12px;
                z-index: 10;
                display: flex;
                flex-direction: column;
                gap: 6px;
                background: #ffffff;
                border: 1px solid #d9d9d9;
                border-radius: 8px;
                padding: 8px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }

            .zoom-btn {
                border: 1px solid #d9d9d9;
                background: #ffffff;
                color: #262626;
                border-radius: 4px;
                padding: 5px 10px;
                cursor: pointer;
                font-size: 14px;
                min-width: 44px;
            }

            .zoom-btn:disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }

            .zoom-indicator {
                font-size: 12px;
                color: #595959;
                text-align: center;
                padding: 2px 0;
            }

            .context-menu {
                position: absolute;
                z-index: 2000;
                background: #ffffff;
                border: 1px solid #d9d9d9;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                padding: 4px;
                display: flex;
                flex-direction: column;
                min-width: 140px;
            }

            .context-menu-item {
                border: none;
                background: transparent;
                text-align: left;
                padding: 7px 12px;
                cursor: pointer;
                font-size: 13px;
                color: #262626;
                border-radius: 4px;
            }

            .context-menu-item:hover {
                background: #f5f5f5;
            }

            .topology-note {
                position: absolute;
                top: 8px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 10;
                padding: 4px 12px;
                font-size: 12px;
                color: #ad6800;
                background: #fff7e6;
                border: 1px solid #ffd591;
                border-radius: 4px;
                white-space: nowrap;
                pointer-events: none;
            }

            .warning-badge {
                display: inline-block;
                min-width: 16px;
                height: 16px;
                margin-left: 6px;
                padding: 0 4px;
                border-radius: 8px;
                background: #faad14;
                color: #ffffff;
                font-size: 11px;
                line-height: 16px;
                text-align: center;
            }

            .validation-panel {
                position: absolute;
                left: 12px;
                bottom: 12px;
                z-index: 20;
                width: 240px;
                max-height: 300px;
                overflow-y: auto;
                background: #ffffff;
                border: 1px solid #e8e8e8;
                border-radius: 8px;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
                padding: 10px 12px;
            }

            .validation-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 6px;
            }

            .validation-title {
                font-size: 13px;
                font-weight: 600;
                color: #262626;
            }

            .validation-close {
                border: none;
                background: none;
                font-size: 16px;
                cursor: pointer;
                color: #8c8c8c;
            }

            .validation-item {
                padding: 5px 8px;
                margin: 3px 0;
                border-radius: 4px;
                font-size: 11px;
                cursor: pointer;
                border-left: 3px solid;
            }

            .validation-item.warning {
                background: #fff7e6;
                border-left-color: #faad14;
                color: #ad6800;
            }

            .validation-item.info {
                background: #f0f5ff;
                border-left-color: #1677ff;
                color: #0958d9;
            }

            .validation-item:hover {
                filter: brightness(0.97);
            }

            .apply-modal-backdrop {
                position: absolute;
                inset: 0;
                background: rgba(0, 0, 0, 0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 100;
            }

            .apply-modal {
                width: 480px;
                max-width: calc(100% - 32px);
                max-height: 80%;
                background: #ffffff;
                border-radius: 8px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
                display: flex;
                flex-direction: column;
            }

            .apply-modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                border-bottom: 1px solid #f0f0f0;
            }

            .apply-modal-title {
                font-size: 14px;
                font-weight: 600;
                color: #262626;
            }

            .apply-modal-body {
                padding: 12px 16px;
                overflow-y: auto;
            }

            .apply-section-title {
                margin: 10px 0 4px;
                font-size: 12px;
                font-weight: 600;
                color: #595959;
            }

            .apply-item {
                font-size: 12px;
                padding: 4px 8px;
                margin: 2px 0;
                border-radius: 4px;
                border-left: 3px solid;
            }

            .apply-item.create {
                background: #f6ffed;
                border-left-color: #52c41a;
                color: #389e0d;
            }

            .apply-item.update {
                background: #e6f4ff;
                border-left-color: #1677ff;
                color: #0958d9;
            }

            .apply-item.skipped {
                background: #fffbe6;
                border-left-color: #faad14;
                color: #ad6800;
            }

            .apply-item.kept {
                background: #fafafa;
                border-left-color: #bfbfbf;
                color: #595959;
            }

            .apply-change {
                font-size: 11px;
                color: #595959;
                padding-left: 8px;
            }

            .apply-empty {
                font-size: 12px;
                color: #8c8c8c;
                text-align: center;
                padding: 12px 0;
            }

            .apply-modal-footer {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
                padding: 12px 16px;
                border-top: 1px solid #f0f0f0;
            }

            .apply-confirm-btn {
                border: 1px solid #52c41a;
                background: #52c41a;
                color: #ffffff;
                border-radius: 4px;
                padding: 6px 14px;
                cursor: pointer;
                font-size: 13px;
            }

            .apply-confirm-btn:disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }

            .topology-canvas {
                width: 100%;
                height: 100%;
                min-height: 480px;
            }

            .property-panel {
                width: 320px;
                flex-shrink: 0;
                border-left: 1px solid #e8e8e8;
                background: #ffffff;
                padding: 12px 16px;
                overflow-y: auto;
            }

            .panel-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 12px;
            }

            .panel-title {
                font-size: 14px;
                font-weight: 600;
                color: #262626;
            }

            .panel-close {
                border: none;
                background: transparent;
                font-size: 20px;
                line-height: 1;
                cursor: pointer;
                color: #8c8c8c;
                padding: 0 4px;
            }

            .panel-empty {
                color: #8c8c8c;
                font-size: 13px;
            }

            .panel-section {
                border-top: 1px solid #f0f0f0;
                padding-top: 10px;
                margin-top: 10px;
            }

            .section-title {
                margin: 0 0 6px;
                font-size: 12px;
                font-weight: 600;
                color: #595959;
            }

            .field-label {
                display: block;
                margin-top: 6px;
                font-size: 11px;
                color: #8c8c8c;
            }

            .field-select,
            .field-input {
                width: 100%;
                border: 1px solid #d9d9d9;
                border-radius: 4px;
                padding: 6px 8px;
                font-size: 13px;
                margin-top: 2px;
            }

            .modal-backdrop {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 1000;
            }

            .modal {
                background: #ffffff;
                border-radius: 8px;
                padding: 20px 24px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                min-width: 200px;
                box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
            }

            .modal-title {
                margin: 0 0 4px;
                font-size: 14px;
                font-weight: 600;
                color: #262626;
            }

            .modal-btn {
                border: none;
                border-radius: 4px;
                padding: 8px 12px;
                cursor: pointer;
                font-size: 13px;
                color: #ffffff;
            }

            .modal-btn.measurement {
                background: #1677ff;
            }

            .modal-btn.control {
                background: #fa8c16;
            }

            .modal-btn.cancel {
                background: #8c8c8c;
            }

            .toast {
                position: fixed;
                top: 16px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.75);
                color: #ffffff;
                padding: 6px 14px;
                border-radius: 4px;
                font-size: 13px;
                z-index: 3000;
                pointer-events: none;
            }
        `,
    ],
})
export class TopologyCanvasComponent implements AfterViewInit, OnDestroy {
    @ViewChild("canvas", { static: true })
    private canvas!: ElementRef<HTMLDivElement>;

    @ViewChild("canvasWrap", { static: true })
    private canvasWrap!: ElementRef<HTMLDivElement>;

    @ViewChild("trashZone", { static: true })
    private trashZone!: ElementRef<HTMLDivElement>;

    @ViewChild("minimapContainer", { static: true })
    private minimapContainer!: ElementRef<HTMLDivElement>;

    private graph: Graph | null = null;
    private components: DraftComponent[] = [];
    private connections: DraftConnection[] = [];
    private readonly idCounters = new Map<string, number>();
    private pendingEdge: Edge | null = null;
    private readonly processedEdges = new Set<string>();
    private hoveredCellId: string | null = null;
    private clipboard: { components: DraftComponent[]; connections: DraftConnection[] } | null = null;
    protected connectionGroups: ConnectionGroup[] = [];
    protected editingGroup: ConnectionGroup | null = null;
    protected isCreatingGroup = false;
    private connectionGroupCounter = 0;

    /** 设备面板：按 nature 分组，列出所有可用的设备 Factory（含 Simulator，名称末尾标注 Simulator） */
    protected get deviceGroups(): { label: string; devices: DevicePaletteEntry[] }[] {
        const map = new Map<string, DevicePaletteEntry[]>();
        for (const factoryId of this.availableDeviceFactoryIds) {
            const category = deviceCategory(factoryId, this.factories[factoryId]?.natureIds);
            if (category == null) {
                continue;
            }
            const list = map.get(category) ?? [];
            list.push({ factoryPid: factoryId, label: this.deviceLabel(factoryId) });
            map.set(category, list);
        }
        return [...map.entries()].map(([label, devices]) => ({ label, devices }));
    }

    private deviceLabel(factoryId: string): string {
        const name = this.factories[factoryId]?.name?.trim();
        const base = name != null && name !== "" ? name : (factoryId.split(".").pop() ?? factoryId);
        if (factoryId.startsWith("Simulator.")) {
            const stripped = base.replace(/^Simulator\s+/i, "");
            return `${stripped}（Simulator）`;
        }
        return base;
    }

    /** 左侧「画布元件」当前页签 */
    protected activeElementTab: "controller" | "device" | "group" = "controller";

    /** 控制器面板：列出所有可用的 Controller Factory */
    protected get controllerPalette(): DevicePaletteEntry[] {
        return this.availableControllerFactoryIds.map((factoryId) => ({
            factoryPid: factoryId,
            label: controllerLabel(factoryId),
        }));
    }

    protected get isControllerSelected(): boolean {
        return this.selectedComponent != null && isControllerFactoryPid(this.selectedComponent.factoryPid);
    }
    protected selectedComponent: DraftComponent | null = null;
    protected selectedProperties: PropertyDefinition[] = [];
    private factories: { [id: string]: EdgeConfig.Factory } = {};
    private factoryPropertiesCache: Record<string, EdgeConfig.FactoryProperty[]> = {};
    protected availableFactoryIds: string[] = [];
    protected availableControllerFactoryIds: string[] = [];
    protected availableDeviceFactoryIds: string[] = [];

    /** 参数面板"设备类型"下拉：Controller 只列 Controller Factory，设备只列设备 Factory */
    protected get factoryOptions(): string[] {
        return this.selectedComponent != null && isControllerFactoryPid(this.selectedComponent.factoryPid)
            ? this.availableControllerFactoryIds
            : this.availableFactoryIds;
    }
    protected upperFactoryPid = "";
    protected upperLabel = "";
    protected upperBridgeId = "";
    protected upperUnitId: number | null = null;
    protected upperDatasourceId = "";
    protected upperHasDatasource = false;
    protected importText = "";
    protected exportedJson = "";
    protected validationWarnings: TopologyWarning[] = [];
    protected showValidationPanel = false;
    protected applyPreview: ApplyPreview | null = null;
    protected showSemanticSelector = false;
    protected canUndo = false;
    protected canRedo = false;
    protected contextMenu: { x: number; y: number; type: "blank" | "node" | "edge"; cellId: string | null } | null =
        null;
    protected toastMessage: string | null = null;
    private toastTimer: ReturnType<typeof setTimeout> | null = null;
    protected zoomPercent = 100;
    protected canZoomIn = true;
    protected canZoomOut = true;
    private middlePanning: { clientX: number; clientY: number } | null = null;

    constructor(
        private readonly service: Service,
        private readonly cdRef: ChangeDetectorRef,
    ) {}

    public ngAfterViewInit(): void {
        this.graph = new Graph({
            container: this.canvas.nativeElement,
            autoResize: true,
            // 画布编辑器：允许拖动节点、从端口连线；禁用端点拖动重连
            interacting: {
                nodeMovable: true,
                edgeMovable: false,
                edgeLabelMovable: true,
                arrowheadMovable: false,
                vertexMovable: true,
                vertexAddable: true,
                vertexDeletable: true,
                magnetConnectable: true,
            },
            scaling: { min: 0.4, max: 2.5 },
            panning: {
                enabled: true,
                eventTypes: ["leftMouseDown"],
                modifiers: "space",
            },
            mousewheel: {
                enabled: true,
                modifiers: null,
                factor: 1.1,
                zoomAtMousePosition: true,
                minScale: 0.4,
                maxScale: 2.5,
                guard: (e: WheelEvent) => !this.isFormInput(e.target),
            },
            background: { color: "#fafafa" },
            grid: { size: 10, visible: true, type: "dot" },
            connecting: {
                allowNode: true,
                allowBlank: false,
                allowLoop: false,
                allowMulti: true,
                snap: true,
                highlight: true,
                // Single-line diagram: disallow a reverse edge if the opposite direction already exists.
                validateConnection: ({ sourceCell, targetCell }) => {
                    if (sourceCell == null || targetCell == null || sourceCell.id === targetCell.id) {
                        this.showToast("不允许自连接");
                        return false;
                    }
                    if (this.hasReverseEdge(sourceCell.id, targetCell.id)) {
                        this.showToast("不允许反向重复连接");
                        return false;
                    }
                    return true;
                },
            },
        });

        this.graph.use(
            new Selection({
                enabled: true,
                multiple: true,
                multipleSelectionModifiers: ["ctrl", "meta", "shift"],
                rubberband: true,
                rubberNode: true,
                rubberEdge: true,
                showNodeSelectionBox: true,
                showEdgeSelectionBox: false,
                movable: false,
                eventTypes: ["leftMouseDown"],
                filter: (cell) => !cell.id.startsWith("bridge-group:"),
            }),
        );
        this.graph.use(
            new Keyboard({
                enabled: true,
                global: false,
                guard: (e: KeyboardEvent) => this.keyboardGuard(e),
            }),
        );
        this.graph.use(
            new History({
                enabled: true,
                stackSize: 50,
                beforeAddCommand: (_event, args) => {
                    const cell = (args as { cell?: Cell }).cell;
                    return cell == null || !cell.id.startsWith("bridge-group:");
                },
            }),
        );
        this.graph.use(
            new MiniMap({
                container: this.minimapContainer.nativeElement,
                width: 200,
                height: 140,
                padding: 10,
                scalable: true,
                minScale: 0.4,
                maxScale: 2.5,
            }),
        );
        this.bindKeyboardShortcuts();

        this.graph.on("node:click", ({ node }) => {
            this.onNodeClick(node.id);
        });
        this.graph.on("cell:selected", ({ cell }) => {
            this.syncTools(cell.id);
        });
        this.graph.on("cell:unselected", ({ cell }) => {
            this.syncTools(cell.id);
        });
        this.graph.on("history:change", () => {
            this.canUndo = this.graph?.canUndo() ?? false;
            this.canRedo = this.graph?.canRedo() ?? false;
            this.cdRef.detectChanges();
        });
        this.graph.on("history:undo", () => {
            this.refreshPanelProperties();
            this.cdRef.detectChanges();
        });
        this.graph.on("history:redo", () => {
            this.refreshPanelProperties();
            this.cdRef.detectChanges();
        });
        this.graph.on("node:change:data", ({ node }) => {
            this.syncComponentPropertiesFromNode(node.id);
        });
        this.graph.on("node:change:position", ({ node, current }) => {
            if (node.id.startsWith("bridge-group:")) {
                return;
            }
            // 网格吸附（10px）
            const grid = 10;
            const snappedX = Math.round(current.x / grid) * grid;
            const snappedY = Math.round(current.y / grid) * grid;
            if (snappedX !== current.x || snappedY !== current.y) {
                node.setPosition(snappedX, snappedY);
            }
            this.refreshBridgeGroups();
        });
        this.graph.on("node:mouseenter", ({ node }) => {
            this.hoveredCellId = node.id;
            this.syncTools(node.id);
        });
        this.graph.on("node:mouseleave", ({ node }) => {
            this.hoveredCellId = null;
            this.syncTools(node.id);
        });
        this.graph.on("edge:mouseenter", ({ edge }) => {
            this.hoveredCellId = edge.id;
            this.syncTools(edge.id);
        });
        this.graph.on("edge:mouseleave", ({ edge }) => {
            this.hoveredCellId = null;
            this.syncTools(edge.id);
        });
        this.graph.on("blank:contextmenu", ({ e }) => {
            e.preventDefault();
            this.showContextMenu("blank", null, e.clientX, e.clientY);
        });
        this.graph.on("node:contextmenu", ({ node, e }) => {
            e.preventDefault();
            this.showContextMenu("node", node.id, e.clientX, e.clientY);
        });
        this.graph.on("edge:contextmenu", ({ edge, e }) => {
            e.preventDefault();
            this.showContextMenu("edge", edge.id, e.clientX, e.clientY);
        });
        this.graph.on("node:mouseup", ({ node, e }) => {
            if (this.isOverTrashZone(e.clientX, e.clientY)) {
                this.deleteCell(node.id);
            }
        });
        this.graph.on("edge:connected", ({ edge }) => {
            if (this.processedEdges.has(edge.id)) {
                return;
            }
            this.processedEdges.add(edge.id);
            this.onEdgeConnected(edge);
        });
        this.graph.on("scale", () => {
            this.updateZoomState();
        });
        this.graph.on("blank:dblclick", () => {
            this.resetView();
        });
        this.graph.on("blank:mousedown", ({ e }) => {
            // 中键：阻止默认自动滚动，并启动手动平移
            if (e.button === 1) {
                e.preventDefault();
                this.middlePanning = { clientX: e.clientX, clientY: e.clientY };
            }
        });

        void this.loadTopology();
    }

    public ngOnDestroy(): void {
        this.graph?.disableKeyboard();
        this.graph?.dispose();
        this.graph = null;
    }

    // ------------------------------------------------------------------
    // 初始加载：读取 EdgeConfig → 白名单过滤 → 转为草稿组件
    // ------------------------------------------------------------------

    private async loadTopology(): Promise<void> {
        try {
            const config: EdgeConfig = await this.service.getConfig();
            this.factories = config.factories ?? {};
            this.availableFactoryIds = Object.keys(this.factories).filter((factoryId) => {
                if (!FACTORY_WHITELIST.some((entry) => entry.pattern.test(factoryId))) {
                    return false;
                }
                // 排除基础设施工厂：其实例均为 "_" 开头单例（如 Ess.Power → _power、Evcs 过滤器 → _evcs...）
                const componentIds = this.factories[factoryId]?.componentIds ?? [];
                return !(componentIds.length > 0 && componentIds.every((id) => id.startsWith("_")));
            });
            this.availableControllerFactoryIds = Object.keys(this.factories).filter(
                (factoryId) => factoryKind(factoryId) === "controller",
            );
            this.availableDeviceFactoryIds = Object.keys(this.factories).filter(
                (factoryId) => deviceCategory(factoryId, this.factories[factoryId]?.natureIds) != null,
            );
            this.components = Object.values(config.components)
                .map((component) => this.toDraftComponent(component))
                .filter((component): component is DraftComponent => component != null);
            this.connections = [];
            this.renderAll();
            // 从 Edge 组件属性推断连线（如 datasource→meter、meter→controller、controller→ess）
            await this.inferConnectionsFromConfig();
            // 从 Edge 加载/重载后清空历史，避免撤销到加载之前的状态
            this.graph?.cleanHistory();
        } catch (error) {
            console.warn("[Topology] 获取 EdgeConfig 失败：", error);
        }
    }

    /** 根据 Edge 各组件的设备引用字段（ess.id/meter.id/datasource.id）自动推断并绘制连线 */
    private async inferConnectionsFromConfig(): Promise<void> {
        const componentIds = new Set(this.components.map((component) => component.id));
        for (const component of this.components) {
            await this.ensureFactoryProperties(component.factoryPid);
            const properties = this.getFactoryProperties(component.factoryPid);
            for (const field of controllerDeviceRefFields(properties)) {
                const value = this.deviceIdOf(component.properties[field.id]);
                if (value == null || !componentIds.has(value)) {
                    continue;
                }
                const isInput = deviceRefIsInput(field.prefix);
                const semantic: TopologySemantic = isInput ? "MEASUREMENT" : "CONTROL";
                // 输入：被引用设备 → 组件；输出：组件 → 被引用设备
                this.addConnection(isInput ? value : component.id, isInput ? component.id : value, semantic);
            }
        }
        this.refreshControllerBadges();
    }

    private toDraftComponent(component: EdgeConfig.Component): DraftComponent | null {
        if (componentKind(component.factoryId, component.id) === "infrastructure") {
            // 基础设施（Ess.Power、Evcs 过滤器、API、日志等）不属于控制设计，不在图中显示
            return null;
        }
        const category = FACTORY_WHITELIST.find((entry) => entry.pattern.test(component.factoryId));
        if (category == null) {
            // 未知 factoryId：忽略并告警，而不是崩溃
            console.warn(`[Topology] 忽略未知 factoryId "${component.factoryId}"（component "${component.id}"）`);
            return null;
        }
        return {
            id: component.id,
            factoryPid: component.factoryId,
            label: component.alias?.trim() || component.id,
            properties: { ...component.properties },
            category,
            persisted: true,
            natureIds: this.factories[component.factoryId]?.natureIds ?? [],
        };
    }

    private renderAll(): void {
        if (this.graph == null) {
            return;
        }
        this.graph.clearCells();
        this.components.forEach((component, index) => {
            this.addNodeToGraph(component, 40 + (index % 4) * 280, 40 + Math.floor(index / 4) * 120);
        });
        this.refreshBridgeGroups();
        this.graph.centerContent();
    }

    private channelCapabilityFor(factoryPid: string): ChannelCapability {
        const factory = this.factories[factoryPid];
        if (factory == null) {
            return { measure: false, control: false };
        }
        return channelCapability(factory.natureIds ?? []);
    }

    private controllerCapability(componentId: string): ChannelCapability {
        return {
            measure: this.connections.some((connection) => connection.target === componentId),
            control: this.connections.some((connection) => connection.source === componentId),
        };
    }

    private badgeAttrs(component: DraftComponent): CellAttrs {
        const capability = isControllerFactoryPid(component.factoryPid)
            ? this.controllerCapability(component.id)
            : this.channelCapabilityFor(component.factoryPid);
        const measureCx = 13;
        const controlCx = capability.measure ? 29 : 13;
        return {
            measureBadge: capability.measure ? { display: "block", cx: measureCx } : { display: "none", cx: measureCx },
            measureBadgeText: capability.measure
                ? { display: "block", refX: measureCx }
                : { display: "none", refX: measureCx },
            controlBadge: capability.control ? { display: "block", cx: controlCx } : { display: "none", cx: controlCx },
            controlBadgeText: capability.control
                ? { display: "block", refX: controlCx }
                : { display: "none", refX: controlCx },
        };
    }

    private bridgeGroupNodeId(groupId: string): string {
        return `bridge-group:${groupId}`;
    }

    private groupSummary(group: ConnectionGroup): string {
        return group.type === "tcp" ? `${group.ip}:${group.port}` : `${group.portName} @ ${group.baudRate}`;
    }

    private updateBridgeGroup(group: ConnectionGroup): void {
        if (this.graph == null) {
            return;
        }
        const groupNodeId = this.bridgeGroupNodeId(group.id);
        const deviceNodes = this.components
            .filter((component) => component.properties["modbus_id"] === group.id)
            .map((component) => this.graph?.getCellById(component.id))
            .filter((cell): cell is Node => cell != null && cell.isNode());

        if (deviceNodes.length === 0) {
            if (this.graph.getCellById(groupNodeId) != null) {
                this.graph.removeCell(groupNodeId);
            }
            return;
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const node of deviceNodes) {
            const bbox = node.getBBox();
            minX = Math.min(minX, bbox.x);
            minY = Math.min(minY, bbox.y);
            maxX = Math.max(maxX, bbox.x + bbox.width);
            maxY = Math.max(maxY, bbox.y + bbox.height);
        }
        const padding = 20;
        const x = minX - padding;
        const y = minY - padding;
        const width = maxX - minX + padding * 2;
        const height = maxY - minY + padding * 2;
        const title = `Bridge ${group.id} · ${this.groupSummary(group)}`;

        const existing = this.graph.getCellById(groupNodeId);
        if (existing != null && existing.isNode()) {
            const node = existing as Node;
            node.setPosition(x, y);
            node.setSize(width, height);
            node.setAttrs({ title: { text: title } });
        } else {
            this.graph.addNode({
                id: groupNodeId,
                shape: "bridge-group",
                x,
                y,
                width,
                height,
                zIndex: -1,
                attrs: { title: { text: title } },
            });
        }
    }

    private refreshBridgeGroups(): void {
        if (this.graph == null) {
            return;
        }
        for (const group of this.connectionGroups) {
            this.updateBridgeGroup(group);
        }
        const activeIds = new Set(this.connectionGroups.map((group) => this.bridgeGroupNodeId(group.id)));
        const orphans = this.graph
            .getNodes()
            .filter((node) => node.id.startsWith("bridge-group:") && !activeIds.has(node.id));
        for (const node of orphans) {
            this.graph.removeCell(node.id);
        }
    }

    private addNodeToGraph(component: DraftComponent, x: number, y: number): void {
        const badges = this.badgeAttrs(component);
        if (isControllerFactoryPid(component.factoryPid)) {
            this.graph?.addNode({
                id: component.id,
                shape: "controller-node",
                x,
                y,
                width: 220,
                height: 64,
                data: { properties: { ...component.properties } },
                attrs: {
                    label: { text: controllerLabel(component.factoryPid) },
                    pid: { text: component.factoryPid },
                    ...badges,
                },
            });
            return;
        }
        const visual = deviceTypeVisual(component.factoryPid);
        this.graph?.addNode({
            id: component.id,
            shape: "topology-node",
            x,
            y,
            width: 220,
            height: 64,
            data: { properties: { ...component.properties } },
            attrs: {
                body: {
                    strokeDasharray: component.persisted ? DEPLOYED_BORDER.dasharray : DRAFT_BORDER.dasharray,
                    title: component.persisted ? "已部署" : "草稿",
                },
                leftBar: { fill: visual.color },
                iconBg: { fill: visual.color },
                icon: { text: visual.icon },
                label: { text: component.label },
                pid: { text: component.factoryPid },
                ...badges,
            },
        });
    }

    // ------------------------------------------------------------------
    // 设备面板拖拽 → 创建节点
    // ------------------------------------------------------------------

    protected onDragStart(event: DragEvent, device: DevicePaletteEntry): void {
        event.dataTransfer?.setData("text/plain", device.factoryPid);
    }

    protected onDragOver(event: DragEvent): void {
        event.preventDefault();
    }

    protected onDrop(event: DragEvent): void {
        event.preventDefault();
        const factoryPid = event.dataTransfer?.getData("text/plain");
        if (factoryPid == null || factoryPid.length === 0 || this.graph == null) {
            return;
        }
        const point = this.graph.clientToLocal(event.clientX, event.clientY);
        this.createComponent(factoryPid, point.x - 110, point.y - 32);
    }

    /** 拖拽创建节点：生成唯一临时 componentId（如 meter_1、ess_2） */
    private createComponent(factoryPid: string, x: number, y: number): void {
        const category = FACTORY_WHITELIST.find((entry) => entry.pattern.test(factoryPid));
        if (category == null) {
            return;
        }
        const id = this.nextComponentId(factoryPid);
        const component: DraftComponent = {
            id,
            factoryPid,
            // Controller 用短名作 label，设备用 id（alias 为空时回退到 id）
            label: isControllerFactoryPid(factoryPid) ? controllerLabel(factoryPid) : id,
            properties: {},
            category,
            persisted: false,
            natureIds: this.factories[factoryPid]?.natureIds ?? [],
        };
        this.components.push(component);
        // 批量合并：创建节点（含其 data）作为一次历史操作
        this.graph?.batchUpdate(() => {
            this.addNodeToGraph(component, x, y);
        });
        // 新建节点后自动打开参数面板
        this.openPanel(component);
    }

    private nextComponentId(factoryPid: string): string {
        const prefix = factoryPid.split(".")[0].toLowerCase();
        const next = (this.idCounters.get(prefix) ?? 0) + 1;
        this.idCounters.set(prefix, next);
        return `${prefix}_${next}`;
    }

    // ------------------------------------------------------------------
    // 节点点击 → 参数面板（复用阶段三 PropertyFormComponent）
    // ------------------------------------------------------------------

    private onNodeClick(componentId: string): void {
        const component = this.components.find((candidate) => candidate.id === componentId);
        if (component == null) {
            return;
        }
        this.openPanel(component);
    }

    private openPanel(component: DraftComponent): void {
        this.selectedComponent = component;
        this.refreshPanelProperties();
        // X6 事件在 Angular Zone 外触发，显式刷新以让面板及时显示
        this.cdRef.detectChanges();
        // 异步加载 Factory 属性后刷新面板（getEdgeConfig 的 factories 不含 properties）
        void this.loadFactoryProperties(component.factoryPid);
    }

    private async loadFactoryProperties(factoryPid: string): Promise<void> {
        await this.ensureFactoryProperties(factoryPid);
        if (this.selectedComponent?.factoryPid === factoryPid) {
            this.refreshPanelProperties();
            this.cdRef.detectChanges();
        }
    }

    private refreshPanelProperties(): void {
        if (this.selectedComponent == null) {
            return;
        }
        // 上层（画布抽象层）状态
        this.upperFactoryPid = this.selectedComponent.factoryPid;
        this.upperLabel = this.selectedComponent.label;
        this.upperBridgeId = (this.selectedComponent.properties["modbus_id"] as string) ?? "";
        this.upperUnitId = (this.selectedComponent.properties["unitId"] as number) ?? null;
        // 默认 Datasource（仅对消费数据源的模拟设备显示）
        const datasourceField = this.datasourceFieldId(this.selectedComponent.factoryPid);
        this.upperHasDatasource = datasourceField != null;
        this.upperDatasourceId = this.readDatasourceId(this.selectedComponent);
        // 下层（驱动参数层）
        const definitions = this.componentPropertyDefinitions(this.selectedComponent);
        this.selectedProperties = definitions.map((definition) => ({
            ...definition,
            default: this.selectedComponent.properties[definition.id] ?? definition.default,
        }));
    }

    /** 该 Factory 是否消费数据源；若是，返回其 datasource 属性 id（datasource.id 或 datasource_id） */
    private datasourceFieldId(factoryPid: string): string | null {
        for (const property of this.getFactoryProperties(factoryPid)) {
            const semantic = inferFieldSemantic(property.id);
            if (semantic.kind === "device-ref" && semantic.prefix.toLowerCase() === "datasource") {
                return property.id;
            }
        }
        return null;
    }

    /** 读取组件的 datasource 引用值（兼容 datasource.id / datasource_id 两种 key） */
    private readDatasourceId(component: DraftComponent): string {
        const fieldId = this.datasourceFieldId(component.factoryPid);
        if (fieldId != null && component.properties[fieldId] != null) {
            return String(component.properties[fieldId]);
        }
        return (
            (component.properties["datasource.id"] as string) ?? (component.properties["datasource_id"] as string) ?? ""
        );
    }

    private componentPropertyDefinitions(component: DraftComponent): PropertyDefinition[] {
        const properties = this.getFactoryProperties(component.factoryPid);
        const definitions = isControllerFactoryPid(component.factoryPid)
            ? controllerPropertyDefinitions(properties, this.components)
            : this.factoryPropertyDefinitions(component.factoryPid);
        // schema 为空（getPropertiesOfFactory 需要 ADMIN 权限）时，降级为按已配置属性渲染
        return definitions.length > 0 ? definitions : this.fallbackPropertyDefinitions(component);
    }

    /** Schema 拉取失败时的降级：按组件已配置的属性渲染（设备引用仍用下拉） */
    private fallbackPropertyDefinitions(component: DraftComponent): PropertyDefinition[] {
        return Object.entries(component.properties)
            .filter(([id, value]) => value != null && value !== "" && !id.startsWith("service.") && id !== "id")
            .map(([id, value]) => {
                const semantic = inferFieldSemantic(id);
                if (semantic.kind === "device-ref") {
                    return {
                        id,
                        name: id,
                        type: "SELECT" as const,
                        required: false,
                        default: value,
                        options: componentIdOptionsByPrefix(this.components, semantic.prefix),
                        hint: "属性 schema 未加载（需 ADMIN 权限），以设备引用显示",
                    };
                }
                const type = typeof value === "number" ? "INTEGER" : typeof value === "boolean" ? "BOOLEAN" : "STRING";
                return {
                    id,
                    name: id,
                    type: type as PropertyDefinition["type"],
                    required: false,
                    default: value,
                    hint: "属性 schema 未加载（需 ADMIN 权限）",
                };
            });
    }

    private factoryPropertyDefinitions(factoryPid: string): PropertyDefinition[] {
        return this.getFactoryProperties(factoryPid).map((property) => {
            const repeatOf = repeatElementType(property.schema, property.type);
            if (repeatOf != null) {
                return {
                    id: property.id,
                    name: property.name || property.id,
                    type: "REPEAT",
                    default: property.defaultValue,
                    required: property.isRequired,
                    repeatOf,
                    hint: "数组：请用逗号分隔",
                };
            }
            return {
                id: property.id,
                name: property.name || property.id,
                type: mapFactoryType(property.type),
                default: property.defaultValue,
                required: property.isRequired,
            };
        });
    }

    private getFactoryProperties(factoryPid: string): EdgeConfig.FactoryProperty[] {
        return this.factoryPropertiesCache[factoryPid] ?? this.factories[factoryPid]?.properties ?? [];
    }

    private async ensureFactoryProperties(factoryPid: string): Promise<void> {
        if (this.factoryPropertiesCache[factoryPid] != null) {
            return;
        }
        try {
            const edge = await this.service.getCurrentEdge();
            const [, properties] = await edge.getFactoryProperties(this.service.websocket, factoryPid);
            this.factoryPropertiesCache[factoryPid] = properties ?? [];
        } catch (error) {
            const message = (error as { error?: { message?: string } })?.error?.message ?? String(error);
            console.warn(`[Topology] 获取 Factory 属性失败（${factoryPid}）：${message}`);
            this.factoryPropertiesCache[factoryPid] = [];
        }
    }

    protected onFactoryPidChange(factoryPid: string): void {
        if (this.selectedComponent == null || factoryPid === this.selectedComponent.factoryPid) {
            return;
        }
        const component = this.selectedComponent;
        component.factoryPid = factoryPid;
        const category = FACTORY_WHITELIST.find((entry) => entry.pattern.test(factoryPid));
        if (category != null) {
            component.category = category;
        }
        // Controller 切换类型时，清理旧类型的属性与连线，仅保留新类型声明的字段
        if (isControllerFactoryPid(factoryPid)) {
            this.resetController(component);
        }
        this.applyFactoryDefaults(component);
        this.updateNodeForComponent(component);
        this.refreshPanelProperties();
        this.cdRef.detectChanges();
    }

    private resetController(component: DraftComponent): void {
        const factory = this.factories[component.factoryPid];
        const validIds = new Set((factory?.properties ?? []).map((property) => property.id));
        const next: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(component.properties)) {
            if (validIds.has(key)) {
                next[key] = value;
            }
        }
        component.properties = next;

        const connected = this.connections.filter(
            (connection) => connection.source === component.id || connection.target === component.id,
        );
        for (const connection of connected) {
            this.graph?.removeCell(connection.edgeId);
        }
        this.connections = this.connections.filter(
            (connection) => connection.source !== component.id && connection.target !== component.id,
        );
        this.refreshControllerBadges();
    }

    protected onLabelChange(label: string): void {
        if (this.selectedComponent == null) {
            return;
        }
        this.selectedComponent.label = label;
        const node = this.graph?.getCellById(this.selectedComponent.id);
        if (node != null && node.isNode()) {
            node.setAttrs({ label: { text: label } });
        }
    }

    protected onBridgeChange(bridgeId: string): void {
        if (this.selectedComponent == null) {
            return;
        }
        this.selectedComponent.properties["modbus_id"] = bridgeId;
        this.syncNodeProperties(this.selectedComponent);
        this.refreshBridgeGroups();
    }

    protected onUnitIdChange(unitId: number | null): void {
        if (this.selectedComponent == null) {
            return;
        }
        this.selectedComponent.properties["unitId"] = unitId;
        this.syncNodeProperties(this.selectedComponent);
    }

    /** 画布上可作为数据源的组件（Simulator.Datasource.*） */
    protected get datasourceOptions(): { id: string; label: string }[] {
        return this.components
            .filter((component) => component.factoryPid.startsWith("Simulator.Datasource."))
            .map((component) => ({ id: component.id, label: component.label || component.id }));
    }

    protected onDatasourceChange(datasourceId: string): void {
        if (this.selectedComponent == null) {
            return;
        }
        const oldProperties = { ...this.selectedComponent.properties };
        // 优先写 factory 元数据里的字段 id（datasource.id 或 datasource_id）
        const fieldId = this.datasourceFieldId(this.selectedComponent.factoryPid) ?? "datasource.id";
        this.selectedComponent.properties[fieldId] = datasourceId;
        // 兼容：若 factory 字段是 datasource_id（下划线），同时写 datasource.id（Edge 实际 key）
        if (fieldId !== "datasource.id") {
            this.selectedComponent.properties["datasource.id"] = datasourceId;
        }
        this.syncNodeProperties(this.selectedComponent);
        this.syncDeviceRefEdges(this.selectedComponent, oldProperties);
        this.refreshPanelProperties();
    }

    private applyFactoryDefaults(component: DraftComponent): void {
        const factory = this.factories[component.factoryPid];
        if (factory == null) {
            return;
        }
        for (const property of factory.properties ?? []) {
            if (component.properties[property.id] == null && property.defaultValue != null) {
                component.properties[property.id] = property.defaultValue;
            }
        }
    }

    private updateNodeForComponent(component: DraftComponent): void {
        const node = this.graph?.getCellById(component.id);
        if (node == null || !node.isNode()) {
            return;
        }
        const badges = this.badgeAttrs(component);
        if (isControllerFactoryPid(component.factoryPid)) {
            node.setAttrs({
                label: { text: controllerLabel(component.factoryPid) },
                pid: { text: component.factoryPid },
                ...badges,
            });
            return;
        }
        const visual = deviceTypeVisual(component.factoryPid);
        node.setAttrs({
            leftBar: { fill: visual.color },
            iconBg: { fill: visual.color },
            icon: { text: visual.icon },
            pid: { text: component.factoryPid },
            ...badges,
        });
    }

    private syncNodeProperties(component: DraftComponent): void {
        const node = this.graph?.getCellById(component.id);
        if (node != null && node.isNode()) {
            node.setData({ properties: { ...component.properties } });
        }
    }

    protected startCreateGroup(): void {
        const id = `modbus${this.connectionGroupCounter}`;
        this.connectionGroupCounter += 1;
        this.editingGroup = createConnectionGroup("tcp", id);
        this.isCreatingGroup = true;
    }

    protected startEditGroup(group: ConnectionGroup): void {
        this.editingGroup = { ...group };
        this.isCreatingGroup = false;
    }

    protected saveGroup(): void {
        if (this.editingGroup == null) {
            return;
        }
        const group = this.editingGroup;
        if (this.isCreatingGroup) {
            this.connectionGroups = [...this.connectionGroups, { ...group }];
        } else {
            const index = this.connectionGroups.findIndex((candidate) => candidate.id === group.id);
            if (index >= 0) {
                const next = this.connectionGroups.slice();
                next[index] = { ...group };
                this.connectionGroups = next;
            }
        }
        this.editingGroup = null;
        this.isCreatingGroup = false;
        this.refreshPanelProperties();
        this.refreshBridgeGroups();
        this.cdRef.detectChanges();
    }

    protected deleteGroup(groupId: string): void {
        this.connectionGroups = this.connectionGroups.filter((group) => group.id !== groupId);
        for (const component of this.components) {
            if (component.properties["modbus_id"] === groupId) {
                component.properties["modbus_id"] = "";
            }
        }
        this.refreshPanelProperties();
        this.refreshBridgeGroups();
        this.cdRef.detectChanges();
    }

    protected cancelGroupEdit(): void {
        this.editingGroup = null;
        this.isCreatingGroup = false;
    }

    protected onPropertyChange(values: { [id: string]: unknown }): void {
        if (this.selectedComponent == null) {
            return;
        }
        const component = this.selectedComponent;
        const oldProperties = { ...component.properties };
        Object.assign(component.properties, values);
        this.syncNodeProperties(component);
        // 设备引用字段的反向同步：手动改属性 → 同步连线（Controller 与 Simulator 数据源均适用）
        this.syncDeviceRefEdges(component, oldProperties);
        console.log("[Topology] 更新后的 Component：", JSON.stringify(component, null, 2));
    }

    protected closePanel(): void {
        this.selectedComponent = null;
        this.selectedProperties = [];
        // X6 事件在 Angular Zone 外触发，显式刷新以让面板及时关闭
        this.cdRef.detectChanges();
    }

    // ------------------------------------------------------------------
    // 连线：从端口拖出边 + 语义选择
    // ------------------------------------------------------------------

    private onEdgeConnected(edge: Edge): void {
        this.pendingEdge = edge;
        this.showSemanticSelector = true;
        // X6 事件在 Angular Zone 外触发，显式刷新以让弹窗及时显示
        this.cdRef.detectChanges();
    }

    protected chooseSemantic(semantic: TopologySemantic): void {
        if (this.pendingEdge == null) {
            return;
        }
        const edge = this.pendingEdge;
        const source = edge.getSourceCellId();
        const target = edge.getTargetCellId();
        // 禁止同一节点对之间出现两条语义相同的边
        const duplicate = this.connections.some(
            (connection) =>
                connection.source === source && connection.target === target && connection.semantic === semantic,
        );
        // 先关闭弹窗并清空 pending，避免 applyEdgeStyle 触发历史变更（history:change）时弹窗仍被重渲染
        this.pendingEdge = null;
        this.showSemanticSelector = false;
        if (duplicate) {
            edge.remove();
            this.showToast("该方向已存在相同语义的连线");
            this.cdRef.detectChanges();
            return;
        }
        // 批量合并：语义样式（attrs + label）合并为一条历史记录
        this.graph?.batchUpdate(() => {
            this.applyEdgeStyle(edge, semantic);
        });
        this.connections.push({
            source,
            target,
            semantic,
            edgeId: edge.id,
        });
        const connection = this.connections[this.connections.length - 1];
        // 连线驱动的属性自动填充（Controller）
        void this.applyConnectionAutoFill(connection);
        // 刷新 Controller 角标（入边→M、出边→C）
        this.refreshControllerBadges();
        // 显式刷新，确保弹窗关闭
        this.cdRef.detectChanges();
    }

    protected cancelEdge(): void {
        const edge = this.pendingEdge;
        this.pendingEdge = null;
        this.showSemanticSelector = false;
        edge?.remove();
        // 显式刷新，确保弹窗关闭
        this.cdRef.detectChanges();
    }

    // ------------------------------------------------------------------
    // Controller 连线驱动的属性自动填充 + 反向同步
    // ------------------------------------------------------------------

    private async applyConnectionAutoFill(connection: DraftConnection): Promise<void> {
        const sourceComponent = this.components.find((component) => component.id === connection.source);
        const targetComponent = this.components.find((component) => component.id === connection.target);
        if (sourceComponent == null || targetComponent == null) {
            return;
        }
        if (connection.semantic === "MEASUREMENT" && isControllerFactoryPid(targetComponent.factoryPid)) {
            await this.autoFillDeviceRef(targetComponent, sourceComponent, "input");
        } else if (connection.semantic === "CONTROL" && isControllerFactoryPid(sourceComponent.factoryPid)) {
            await this.autoFillDeviceRef(sourceComponent, targetComponent, "output");
        } else if (connection.semantic === "MEASUREMENT" && !isControllerFactoryPid(targetComponent.factoryPid)) {
            // 设备→设备测量连线：如 datasource → meter，自动为目标设备指定数据源
            await this.autoFillDeviceRef(targetComponent, sourceComponent, "input");
        }
    }

    /** 根据边的设备类型 + 方向，找到目标组件中语义匹配的设备引用字段并自动填充 */
    private async autoFillDeviceRef(
        target: DraftComponent,
        device: DraftComponent,
        direction: "input" | "output",
    ): Promise<void> {
        await this.ensureFactoryProperties(target.factoryPid);
        const properties = this.getFactoryProperties(target.factoryPid);
        const devicePrefix = componentRefType(device);
        const field = controllerDeviceRefFields(properties).find(
            (candidate) =>
                devicePrefix != null &&
                candidate.prefix.toLowerCase() === devicePrefix &&
                deviceRefIsInput(candidate.prefix) === (direction === "input"),
        );
        if (field == null) {
            this.showToast("该连线未对应到目标组件的已知输入/输出字段，请手动配置");
            return;
        }
        target.properties[field.id] = device.id;
        this.syncControllerProperty(target);
    }

    private syncControllerProperty(controller: DraftComponent): void {
        this.syncNodeProperties(controller);
        if (this.selectedComponent?.id === controller.id) {
            this.refreshPanelProperties();
        }
    }

    private syncDeviceRefEdges(component: DraftComponent, oldProperties: Record<string, unknown>): void {
        const properties = this.getFactoryProperties(component.factoryPid);
        for (const field of controllerDeviceRefFields(properties)) {
            this.syncDeviceRefField(component, field.id, field.prefix, oldProperties);
        }
        if (isControllerFactoryPid(component.factoryPid)) {
            this.refreshControllerBadges();
        }
    }

    /** 单个设备引用字段变化时，同步入边/出边（方向由设备类型启发式推断） */
    private syncDeviceRefField(
        component: DraftComponent,
        fieldId: string,
        prefix: string,
        oldProperties: Record<string, unknown>,
    ): void {
        const oldDevice = this.deviceIdOf(oldProperties[fieldId]);
        const newDevice = this.deviceIdOf(component.properties[fieldId]);
        if (oldDevice === newDevice) {
            return;
        }
        const isInput = deviceRefIsInput(prefix);
        const semantic: TopologySemantic = isInput ? "MEASUREMENT" : "CONTROL";
        const sourceIsController = !isInput;
        if (oldDevice != null) {
            this.removeConnectionByEndpoints(
                sourceIsController ? component.id : oldDevice,
                sourceIsController ? oldDevice : component.id,
                semantic,
            );
        }
        if (newDevice != null) {
            this.addConnection(
                sourceIsController ? component.id : newDevice,
                sourceIsController ? newDevice : component.id,
                semantic,
            );
        }
    }

    private deviceIdOf(value: unknown): string | null {
        return value == null || value === "" ? null : String(value);
    }

    private removeConnectionByEndpoints(source: string, target: string, semantic: TopologySemantic): void {
        const connection = this.connections.find(
            (candidate) =>
                candidate.source === source && candidate.target === target && candidate.semantic === semantic,
        );
        if (connection == null) {
            return;
        }
        this.graph?.removeCell(connection.edgeId);
        this.connections = this.connections.filter((candidate) => candidate.edgeId !== connection.edgeId);
    }

    private refreshControllerBadges(): void {
        for (const component of this.components) {
            if (!isControllerFactoryPid(component.factoryPid)) {
                continue;
            }
            const node = this.graph?.getCellById(component.id);
            if (node != null && node.isNode()) {
                node.setAttrs(this.badgeAttrs(component));
            }
        }
    }

    private applyEdgeStyle(edge: Edge, semantic: TopologySemantic): void {
        const meta = EDGE_SEMANTIC_VISUAL[semantic] ?? UNKNOWN_SEMANTIC_VISUAL;
        edge.setAttrs({
            line: {
                stroke: meta.color,
                strokeWidth: meta.width,
                strokeDasharray: meta.dashed ? "6 4" : "none",
                targetMarker: meta.arrow ? { name: "block" } : null,
            },
        });
        edge.setLabels([
            {
                attrs: {
                    body: { fill: "rgba(255, 255, 255, 0.75)", stroke: "none" },
                    label: { text: meta.abbreviation, fill: meta.color, fontSize: 10 },
                },
            },
        ]);
    }

    private changeEdgeSemantic(edgeId: string, semantic: TopologySemantic): void {
        if (this.graph == null) {
            return;
        }
        const edge = this.graph.getCellById(edgeId);
        const connection = this.connections.find((candidate) => candidate.edgeId === edgeId);
        if (edge == null || !edge.isEdge() || connection == null) {
            return;
        }
        // 批量合并：语义修改 + 样式变更合并为一条历史记录
        this.graph.batchUpdate(() => {
            this.applyEdgeStyle(edge, semantic);
        });
        connection.semantic = semantic;
    }

    // ------------------------------------------------------------------
    // 快捷键与选中管理
    // ------------------------------------------------------------------

    private keyboardGuard(e: KeyboardEvent): boolean {
        const target = e.target as HTMLElement | null;
        if (target == null) {
            return true;
        }
        const tagName = target.tagName?.toLowerCase() ?? "";
        if (tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable) {
            return false;
        }
        return true;
    }

    private bindKeyboardShortcuts(): void {
        if (this.graph == null) {
            return;
        }
        const graph = this.graph;

        // Undo / Redo
        graph.bindKey(["ctrl+z", "cmd+z"], () => this.undo());
        graph.bindKey(["ctrl+shift+z", "cmd+shift+z"], () => this.redo());

        // 删除选中元素
        graph.bindKey(["delete", "backspace"], () => this.deleteSelectedCells());

        // 全选
        graph.bindKey(["ctrl+a", "cmd+a"], () => this.selectAllCells());

        // 复制 / 粘贴 / 原地复制
        graph.bindKey(["ctrl+c", "cmd+c"], () => this.copySelection());
        graph.bindKey(["ctrl+v", "cmd+v"], () => this.pasteClipboard());
        graph.bindKey(["ctrl+d", "cmd+d"], () => this.duplicateSelection());
    }

    protected undo(): void {
        this.graph?.undo();
    }

    protected redo(): void {
        this.graph?.redo();
    }

    private syncComponentPropertiesFromNode(nodeId: string): void {
        const node = this.graph?.getCellById(nodeId);
        const component = this.components.find((candidate) => candidate.id === nodeId);
        if (node == null || !node.isNode() || component == null) {
            return;
        }
        const data = node.getData() as { properties?: Record<string, unknown> };
        if (data?.properties == null) {
            return;
        }
        component.properties = { ...data.properties };
    }

    private syncTools(cellId: string): void {
        const cell = this.graph?.getCellById(cellId);
        if (cell == null) {
            return;
        }
        const isHovered = cellId === this.hoveredCellId;
        const isSelected = this.graph?.isSelected(cellId) ?? false;

        if (cell.isNode()) {
            // 节点：button-remove 在悬停或选中时显示
            if (isHovered || isSelected) {
                this.showTool(cellId, "button-remove", this.removeToolArgs(cell));
            } else {
                this.hideTool(cellId, "button-remove");
            }
        } else {
            // 边：选中显示 vertices（隐藏 button-remove，避免与中点手柄重叠）+ 高亮；未选中时悬停显示 button-remove
            if (isSelected) {
                this.hideTool(cellId, "button-remove");
                this.showTool(cellId, "vertices", this.verticesToolArgs());
                this.setEdgeHighlight(cellId, true);
            } else {
                this.hideTool(cellId, "vertices");
                this.setEdgeHighlight(cellId, false);
                if (isHovered) {
                    this.showTool(cellId, "button-remove", this.removeToolArgs(cell));
                } else {
                    this.hideTool(cellId, "button-remove");
                }
            }
        }
    }

    private setEdgeHighlight(cellId: string, highlighted: boolean): void {
        const cell = this.graph?.getCellById(cellId);
        if (cell == null || !cell.isEdge()) {
            return;
        }
        if (highlighted) {
            cell.setAttrs({
                line: {
                    filter: { name: "dropShadow", args: { dx: 0, dy: 0, blur: 3, color: "#000000", opacity: 0.45 } },
                },
            });
        } else {
            cell.removeAttrByPath("line/filter");
        }
    }

    private showTool(cellId: string, name: string, args: unknown): void {
        const cell = this.graph?.getCellById(cellId);
        if (cell == null || cell.hasTool(name)) {
            return;
        }
        cell.addTools([{ name, args }] as any);
    }

    private hideTool(cellId: string, name: string): void {
        const cell = this.graph?.getCellById(cellId);
        if (cell == null || !cell.hasTool(name)) {
            return;
        }
        cell.removeTool(name);
    }

    private removeToolArgs(cell: Cell): any {
        if (cell.isNode()) {
            // Node: top-right corner (offset inward so the tool stays within the node on hover)
            return {
                x: "100%",
                y: 0,
                offset: { x: -10, y: 10 },
                onClick: ({ cell: clicked }: { cell: Cell }) => this.deleteCell(clicked.id),
            };
        }
        // Edge: near the midpoint
        return {
            distance: 0.5,
            onClick: ({ cell: clicked }: { cell: Cell }) => this.deleteCell(clicked.id),
        };
    }

    private verticesToolArgs(): any {
        return {
            addable: true,
            removable: true,
        };
    }

    private hasReverseEdge(sourceId: string, targetId: string): boolean {
        if (this.graph == null) {
            return false;
        }
        return this.graph.getEdges().some((edge) => {
            return edge.getSourceCellId() === targetId && edge.getTargetCellId() === sourceId;
        });
    }

    // ------------------------------------------------------------------
    // 删除
    // ------------------------------------------------------------------

    private removeCellById(cellId: string): void {
        const cell = this.graph?.getCellById(cellId);
        if (cell == null || this.graph == null) {
            return;
        }
        if (cell.isNode()) {
            // X6 会自动移除关联连线
            this.graph.removeCell(cell);
            this.components = this.components.filter((component) => component.id !== cellId);
            this.connections = this.connections.filter(
                (connection) => connection.source !== cellId && connection.target !== cellId,
            );
            // 删除的节点若正显示在属性面板，则同时关闭面板
            if (this.selectedComponent?.id === cellId) {
                this.closePanel();
            }
        } else if (cell.isEdge()) {
            this.graph.removeCell(cell);
            this.connections = this.connections.filter((connection) => connection.edgeId !== cellId);
        }
        this.refreshBridgeGroups();
        this.refreshControllerBadges();
    }

    private deleteCell(cellId: string): void {
        const cell = this.graph?.getCellById(cellId);
        if (cell == null || this.graph == null) {
            return;
        }
        if (cell.isNode()) {
            const component = this.components.find((candidate) => candidate.id === cellId);
            // 删除已持久化设备前做安全确认
            if (component?.persisted) {
                const confirmed = window.confirm(
                    "该设备已存在于 EdgeConfig 中，删除画布节点不会自动删除 Edge 上的设备配置，是否继续？",
                );
                if (!confirmed) {
                    return;
                }
            }
        }
        // 批量合并：删除节点及其关联边合并为一条历史记录
        this.graph.batchUpdate(() => {
            this.removeCellById(cellId);
        });
    }

    private deleteSelectedCells(): void {
        if (this.graph == null) {
            return;
        }
        const selected = this.graph.getSelectedCells();
        if (selected.length === 0) {
            return;
        }
        const hasPersisted = selected.some((cell) => {
            return cell.isNode() && (this.components.find((candidate) => candidate.id === cell.id)?.persisted ?? false);
        });
        if (hasPersisted) {
            const confirmed = window.confirm(
                "所选设备中存在已持久化到 EdgeConfig 的组件，删除画布节点不会自动删除 Edge 上的设备配置，是否继续？",
            );
            if (!confirmed) {
                return;
            }
        }
        const ids = selected.map((cell) => cell.id);
        // 批量合并：删除所有选中元素及其关联边合并为一条历史记录
        this.graph.batchUpdate(() => {
            for (const id of ids) {
                this.removeCellById(id);
            }
        });
        this.graph.cleanSelection();
    }

    // ------------------------------------------------------------------
    // 全选 / 复制 / 粘贴 / 原地复制
    // ------------------------------------------------------------------

    private selectAllCells(): void {
        this.graph?.select(this.graph.getCells());
    }

    private copySelection(): void {
        if (this.graph == null) {
            return;
        }
        const nodeIds = new Set(
            this.graph
                .getSelectedCells()
                .filter((cell) => cell.isNode())
                .map((cell) => cell.id),
        );
        this.copyNodes(nodeIds);
    }

    private copyNode(cellId: string): void {
        this.copyNodes(new Set([cellId]));
    }

    private copyNodes(nodeIds: Set<string>): void {
        if (nodeIds.size === 0) {
            return;
        }
        const components = this.components
            .filter((component) => nodeIds.has(component.id))
            .map((component) => ({ ...component, properties: { ...component.properties } }));
        const connections = this.connections
            .filter((connection) => nodeIds.has(connection.source) && nodeIds.has(connection.target))
            .map((connection) => ({ ...connection }));
        this.clipboard = { components, connections };
        console.log(`[Topology] 已复制 ${components.length} 个节点、${connections.length} 条内部连线`);
    }

    private pasteClipboard(): void {
        if (this.graph == null || this.clipboard == null) {
            return;
        }
        const idMap = new Map<string, string>();
        const newIds: string[] = [];
        for (const source of this.clipboard.components) {
            const newId = this.nextComponentId(source.factoryPid);
            idMap.set(source.id, newId);
            const component: DraftComponent = {
                ...source,
                id: newId,
                properties: { ...source.properties },
                persisted: false,
            };
            this.components.push(component);
            const original = this.graph.getCellById(source.id);
            let x = 40;
            let y = 40;
            if (original != null && original.isNode()) {
                const position = original.getPosition();
                x = position.x + 24;
                y = position.y + 24;
            }
            this.addNodeToGraph(component, x, y);
            newIds.push(newId);
        }
        for (const connection of this.clipboard.connections) {
            const source = idMap.get(connection.source);
            const target = idMap.get(connection.target);
            if (source == null || target == null) {
                continue;
            }
            this.addConnection(source, target, connection.semantic);
        }
        this.graph.select(newIds);
        this.refreshBridgeGroups();
        this.refreshControllerBadges();
    }

    private duplicateSelection(): void {
        this.copySelection();
        this.pasteClipboard();
    }

    private addConnection(sourceId: string, targetId: string, semantic: TopologySemantic): void {
        if (this.graph == null) {
            return;
        }
        // 防御：避免同一节点对之间出现两条语义相同的边
        const duplicate = this.connections.some(
            (connection) =>
                connection.source === sourceId && connection.target === targetId && connection.semantic === semantic,
        );
        if (duplicate) {
            return;
        }
        const edge = this.graph.addEdge({
            source: sourceId,
            target: targetId,
        });
        this.applyEdgeStyle(edge, semantic);
        this.connections.push({
            source: sourceId,
            target: targetId,
            semantic,
            edgeId: edge.id,
        });
    }

    // ------------------------------------------------------------------
    // 右键上下文菜单 / 回收站
    // ------------------------------------------------------------------

    protected get hasClipboard(): boolean {
        return this.clipboard != null && this.clipboard.components.length > 0;
    }

    @HostListener("document:click")
    protected onDocumentClick(): void {
        this.closeContextMenu();
    }

    @HostListener("document:mousemove", ["$event"])
    protected onDocumentMouseMove(e: MouseEvent): void {
        if (this.middlePanning == null) {
            return;
        }
        const dx = e.clientX - this.middlePanning.clientX;
        const dy = e.clientY - this.middlePanning.clientY;
        this.middlePanning = { clientX: e.clientX, clientY: e.clientY };
        this.graph?.translateBy(dx, dy);
    }

    @HostListener("document:mouseup")
    protected onDocumentMouseUp(): void {
        this.middlePanning = null;
    }

    private showContextMenu(
        type: "blank" | "node" | "edge",
        cellId: string | null,
        clientX: number,
        clientY: number,
    ): void {
        const wrapRect = this.canvasWrap.nativeElement.getBoundingClientRect();
        this.contextMenu = {
            x: clientX - wrapRect.left,
            y: clientY - wrapRect.top,
            type,
            cellId,
        };
        this.cdRef.detectChanges();
    }

    private closeContextMenu(): void {
        if (this.contextMenu != null) {
            this.contextMenu = null;
            this.cdRef.detectChanges();
        }
    }

    private showToast(message: string): void {
        this.toastMessage = message;
        if (this.toastTimer != null) {
            clearTimeout(this.toastTimer);
        }
        this.toastTimer = setTimeout(() => {
            this.toastMessage = null;
            this.cdRef.detectChanges();
        }, 1500);
        this.cdRef.detectChanges();
    }

    protected onContextAction(
        action: "delete" | "copy" | "edit" | "paste" | "zoom" | "selectAll" | "setMeasurement" | "setControl",
    ): void {
        const cellId = this.contextMenu?.cellId;
        switch (action) {
            case "delete":
                if (cellId != null) {
                    this.deleteCell(cellId);
                }
                break;
            case "copy":
                if (cellId != null) {
                    this.copyNode(cellId);
                }
                break;
            case "edit":
                if (cellId != null) {
                    this.editNodeParams(cellId);
                }
                break;
            case "paste":
                this.pasteClipboard();
                break;
            case "zoom":
                this.zoomToFit();
                break;
            case "selectAll":
                this.selectAllCells();
                break;
            case "setMeasurement":
                if (cellId != null) {
                    this.changeEdgeSemantic(cellId, "MEASUREMENT");
                }
                break;
            case "setControl":
                if (cellId != null) {
                    this.changeEdgeSemantic(cellId, "CONTROL");
                }
                break;
        }
        this.closeContextMenu();
    }

    private editNodeParams(cellId: string): void {
        const component = this.components.find((candidate) => candidate.id === cellId);
        if (component != null) {
            this.openPanel(component);
        }
    }

    protected zoomToFit(): void {
        this.graph?.zoomToFit({ minScale: 0.5, maxScale: 1, padding: 40 });
    }

    protected zoomIn(): void {
        this.graph?.zoom(0.1);
    }

    protected zoomOut(): void {
        this.graph?.zoom(-0.1);
    }

    protected resetView(): void {
        this.graph?.zoomTo(1);
        this.graph?.centerContent();
    }

    private isFormInput(target: EventTarget | null): boolean {
        if (!(target instanceof HTMLElement)) {
            return false;
        }
        const tagName = target.tagName.toLowerCase();
        return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
    }

    private updateZoomState(): void {
        const zoom = this.graph?.zoom() ?? 1;
        this.zoomPercent = Math.round(zoom * 100);
        this.canZoomIn = zoom < 2.5 - 0.001;
        this.canZoomOut = zoom > 0.4 + 0.001;
        this.cdRef.detectChanges();
    }

    private isOverTrashZone(clientX: number, clientY: number): boolean {
        const rect = this.trashZone?.nativeElement.getBoundingClientRect();
        if (rect == null) {
            return false;
        }
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }

    // ------------------------------------------------------------------
    // 导出
    // ------------------------------------------------------------------

    protected exportDraft(): void {
        this.validationWarnings = this.validateTopology();
        this.showValidationPanel = this.validationWarnings.length > 0;

        const bridges = this.connectionGroups.map((group) => ({
            id: group.id,
            factoryPid: connectionGroupFactoryPid(group),
            properties: connectionGroupProperties(group),
        }));
        const devices = this.components.map((component) => ({
            id: component.id,
            factoryPid: component.factoryPid,
            alias: component.label,
            properties: this.exportDeviceProperties(component),
        }));
        const connections = this.connections.map((connection) => ({
            source: connection.source,
            target: connection.target,
            semantic: connection.semantic,
        }));
        const draft = { bridges, devices, connections };
        this.exportedJson = JSON.stringify(draft, null, 2);
        console.log("[Topology] 导出拓扑草稿：", this.exportedJson);
        this.cdRef.detectChanges();
    }

    protected saveDraft(): void {
        const draft = this.buildCanvasDraft();
        try {
            localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft, null, 2));
            this.showToast("草稿已保存");
        } catch (error) {
            this.showToast("草稿保存失败");
        }
    }

    protected loadDraft(): void {
        const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (raw == null || raw === "") {
            this.showToast("没有已保存的草稿");
            return;
        }
        try {
            this.applyCanvasDraft(JSON.parse(raw));
            this.showToast("草稿已载入");
        } catch (error) {
            this.showToast("草稿解析失败");
        }
    }

    protected importDraft(): void {
        if (this.importText.trim() === "") {
            this.showToast("请先粘贴草稿 JSON");
            return;
        }
        try {
            this.applyCanvasDraft(JSON.parse(this.importText));
            this.showToast("草稿已导入");
        } catch (error) {
            this.showToast("导入失败：JSON 格式不正确");
        }
    }

    private buildCanvasDraft(): unknown {
        const bridges = this.connectionGroups.map((group) => ({ ...group }));
        const components = this.components.map((component) => {
            const node = this.graph?.getCellById(component.id);
            const position = node != null && node.isNode() ? node.getPosition() : { x: 40, y: 40 };
            return {
                id: component.id,
                factoryPid: component.factoryPid,
                label: component.label,
                properties: { ...component.properties },
                x: position.x,
                y: position.y,
            };
        });
        const connections = this.connections.map((connection) => ({
            source: connection.source,
            target: connection.target,
            semantic: connection.semantic,
        }));
        return { bridges, components, connections };
    }

    private applyCanvasDraft(data: unknown): void {
        if (this.graph == null) {
            return;
        }
        const draft = data as {
            bridges?: ConnectionGroup[];
            components?: Array<{
                id: string;
                factoryPid: string;
                label?: string;
                properties?: Record<string, unknown>;
                x?: number;
                y?: number;
            }>;
            connections?: Array<{ source: string; target: string; semantic: TopologySemantic }>;
        };

        this.graph.clearCells();
        this.components = [];
        this.connections = [];
        this.connectionGroups = (draft.bridges ?? []).map((group) => ({ ...group }));
        this.connectionGroupCounter = this.connectionGroups.reduce((max, group) => {
            const match = /^modbus(\d+)$/.exec(group.id);
            return match != null ? Math.max(max, parseInt(match[1], 10) + 1) : max;
        }, 0);

        for (const item of draft.components ?? []) {
            const category = FACTORY_WHITELIST.find((entry) => entry.pattern.test(item.factoryPid));
            if (category == null) {
                continue;
            }
            const component: DraftComponent = {
                id: item.id,
                factoryPid: item.factoryPid,
                label: item.label?.trim() || item.id,
                properties: { ...(item.properties ?? {}) },
                category,
                persisted: false,
                natureIds: this.factories[item.factoryPid]?.natureIds ?? [],
            };
            this.components.push(component);
            this.addNodeToGraph(component, item.x ?? 40, item.y ?? 40);
        }

        for (const connection of draft.connections ?? []) {
            const sourceExists = this.components.some((component) => component.id === connection.source);
            const targetExists = this.components.some((component) => component.id === connection.target);
            if (sourceExists && targetExists) {
                this.addConnection(connection.source, connection.target, connection.semantic);
            }
        }

        // 更新 id 计数器，避免新建节点 id 冲突
        for (const component of this.components) {
            const prefix = component.factoryPid.split(".")[0].toLowerCase();
            const match = /_(\d+)$/.exec(component.id);
            const num = match != null ? parseInt(match[1], 10) : 0;
            this.idCounters.set(prefix, Math.max(this.idCounters.get(prefix) ?? 0, num));
        }

        this.refreshBridgeGroups();
        this.refreshControllerBadges();
        this.graph.cleanHistory();
        this.graph.centerContent();
        this.cdRef.detectChanges();
    }

    // ------------------------------------------------------------------
    // 应用到 Edge
    // ------------------------------------------------------------------

    private buildApplyComponents(): Array<{
        id: string;
        factoryPid: string;
        properties: Record<string, unknown>;
        alias: string;
    }> {
        const bridges = this.connectionGroups.map((group) => ({
            id: group.id,
            factoryPid: connectionGroupFactoryPid(group),
            properties: connectionGroupProperties(group),
            alias: group.id,
        }));
        const devices = this.components.map((component) => ({
            id: component.id,
            factoryPid: component.factoryPid,
            properties: this.exportDeviceProperties(component),
            alias: component.label,
        }));
        const scheduler = this.buildSchedulerApplyItem();
        return scheduler != null ? [...bridges, scheduler, ...devices] : [...bridges, ...devices];
    }

    /** 自动生成 Scheduler（Scheduler.AllAlphabetically），列出画布上所有 Controller */
    private buildSchedulerApplyItem(): {
        id: string;
        factoryPid: string;
        properties: Record<string, unknown>;
        alias: string;
    } | null {
        const controllerIds = this.components
            .filter((component) => isControllerFactoryPid(component.factoryPid))
            .map((component) => component.id)
            .sort();
        if (controllerIds.length === 0) {
            return null;
        }
        return {
            id: "scheduler0",
            factoryPid: "Scheduler.AllAlphabetically",
            properties: { "controllers.ids": controllerIds },
            alias: "scheduler0",
        };
    }

    private toPropertyList(properties: Record<string, unknown>): { name: string; value: any }[] {
        return Object.entries(properties)
            .filter(([, value]) => value != null && value !== "" && !(Array.isArray(value) && value.length === 0))
            .map(([name, value]) => ({ name, value }));
    }

    private cleanProperties(properties: Record<string, unknown>): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(properties)) {
            if (value != null && value !== "" && !(Array.isArray(value) && value.length === 0)) {
                result[key] = value;
            }
        }
        return result;
    }

    protected async openApplyPreview(): Promise<void> {
        if (this.graph == null) {
            return;
        }
        try {
            const config = await this.service.getConfig();
            const applyList = this.buildApplyComponents();

            const toCreate: ApplyItem[] = [];
            const toUpdate: { item: ApplyItem; changes: string[] }[] = [];
            const skippedProtected: { id: string; factoryPid: string }[] = [];
            const kept: { id: string; factoryPid: string }[] = [];

            for (const item of applyList) {
                if (isProtectedComponent(item.factoryPid, item.id)) {
                    skippedProtected.push({ id: item.id, factoryPid: item.factoryPid });
                    continue;
                }
                const existing = config.components[item.id];
                if (existing == null) {
                    toCreate.push(item);
                } else {
                    const changes = this.diffComponent(existing, item);
                    if (changes.length > 0) {
                        toUpdate.push({ item, changes });
                    }
                }
            }

            // Edge 有、画布没有的组件：保留，不删除
            for (const id of Object.keys(config.components)) {
                if (!applyList.some((item) => item.id === id)) {
                    kept.push({ id, factoryPid: config.components[id].factoryId });
                }
            }

            this.applyPreview = { toCreate, toUpdate, skippedProtected, kept };

            // 核心组件存在性检查（全新 Edge 缺失时提示）
            const missingCore = ["_sum", "_cycle", "_componentManager"].filter((id) => config.components[id] == null);
            if (missingCore.length > 0) {
                this.showToast(`Edge 缺少核心组件：${missingCore.join("、")}，请先初始化`);
            }

            // 应用前可运行性校验
            this.validationWarnings = this.validateTopology();
            this.showValidationPanel = this.validationWarnings.length > 0;
            this.cdRef.detectChanges();
        } catch (error) {
            console.error("[Topology] 生成下发预览失败：", error);
            this.showToast("生成下发预览失败");
        }
    }

    protected cancelApply(): void {
        this.applyPreview = null;
    }

    protected async confirmApply(): Promise<void> {
        if (this.applyPreview == null || this.graph == null) {
            return;
        }
        const preview = this.applyPreview;
        try {
            const edge = await this.service.getCurrentEdge();
            const isCanvasBridge = (item: { id: string }) =>
                this.connectionGroups.some((group) => group.id === item.id);

            // 顺序：先 Bridge，再 Device/Controller（只增改，不删）
            const orderedApply = [
                ...preview.toCreate.filter(isCanvasBridge),
                ...preview.toUpdate.map((change) => change.item).filter(isCanvasBridge),
                ...preview.toCreate.filter((item) => !isCanvasBridge(item)),
                ...preview.toUpdate.map((change) => change.item).filter((item) => !isCanvasBridge(item)),
            ];
            for (const item of orderedApply) {
                const isCreate = preview.toCreate.includes(item);
                if (isCreate) {
                    const props: { name: string; value: any }[] = [{ name: "id", value: item.id }];
                    if (item.alias != null && item.alias !== "" && item.alias !== item.id) {
                        props.push({ name: "alias", value: item.alias });
                    }
                    props.push(...this.toPropertyList(item.properties));
                    await edge.createComponentConfig(this.service.websocket, item.factoryPid, props);
                } else {
                    const props: { name: string; value: any }[] = this.toPropertyList(item.properties);
                    if (item.alias != null && item.alias !== "" && item.alias !== item.id) {
                        props.push({ name: "alias", value: item.alias });
                    }
                    await edge.updateComponentConfig(this.service.websocket, item.id, props);
                }
            }

            this.applyPreview = null;
            this.showToast(`已应用到 Edge（新增 ${preview.toCreate.length}、修改 ${preview.toUpdate.length}）`);
            await this.loadTopology();
            this.cdRef.detectChanges();
        } catch (error) {
            console.error("[Topology] 应用到 Edge 失败：", error);
            this.showToast("应用到 Edge 失败");
        }
    }

    private diffComponent(existing: EdgeConfig.Component, item: ApplyItem): string[] {
        const changes: string[] = [];
        const oldAlias = existing.alias?.trim() ?? "";
        const newAlias = item.alias?.trim() ?? "";
        if (oldAlias !== newAlias) {
            changes.push(`alias: ${this.formatValue(oldAlias)} → ${this.formatValue(newAlias)}`);
        }
        const oldProps = this.cleanProperties(existing.properties);
        const newProps = this.cleanProperties(item.properties);
        const keys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
        for (const key of keys) {
            const oldValue = oldProps[key];
            const newValue = newProps[key];
            if (String(oldValue ?? "") !== String(newValue ?? "")) {
                changes.push(`${key}: ${this.formatValue(oldValue)} → ${this.formatValue(newValue)}`);
            }
        }
        return changes;
    }

    private formatValue(value: unknown): string {
        if (value == null || value === "") {
            return "（空）";
        }
        return String(value);
    }

    private validateTopology(): TopologyWarning[] {
        const warnings: TopologyWarning[] = [];
        const bridgeIds = new Set(this.connectionGroups.map((group) => group.id));
        const componentIds = new Set(this.components.map((component) => component.id));

        for (const component of this.components) {
            // 角标一致性：当前由 nature 元数据推导（结构上恒一致）；待接入 Channel accessMode 后替换为真实校验
            const capability = this.channelCapabilityFor(component.factoryPid);
            if (capability.measure && !this.factoryHasReadOnlyChannel(component.factoryPid)) {
                warnings.push({
                    severity: "warning",
                    message: `节点 ${component.id} 的 M 角标与元数据不符`,
                    cellId: component.id,
                });
            }
            if (capability.control && !this.factoryHasWritableChannel(component.factoryPid)) {
                warnings.push({
                    severity: "warning",
                    message: `节点 ${component.id} 的 C 角标与元数据不符`,
                    cellId: component.id,
                });
            }

            // Bridge 引用有效性
            const bridgeId = component.properties["modbus_id"];
            if (bridgeId != null && bridgeId !== "" && !bridgeIds.has(String(bridgeId))) {
                warnings.push({
                    severity: "warning",
                    message: `节点 ${component.id} 引用了未定义的 Bridge ${bridgeId}`,
                    cellId: component.id,
                });
            }
        }

        // 连线端点有效性
        for (const connection of this.connections) {
            if (!componentIds.has(connection.source) || !componentIds.has(connection.target)) {
                warnings.push({
                    severity: "warning",
                    message: "连线引用了不存在的节点",
                    cellId: connection.edgeId,
                });
            }
        }

        // nature 级校验：测量边源需可读、控制边目标需可写（Controller 端点跳过，其能力由连线决定）
        for (const connection of this.connections) {
            if (connection.semantic === "MEASUREMENT") {
                const source = this.components.find((component) => component.id === connection.source);
                if (
                    source != null &&
                    !isControllerFactoryPid(source.factoryPid) &&
                    !this.channelCapabilityFor(source.factoryPid).measure
                ) {
                    warnings.push({
                        severity: "warning",
                        message: `测量连线源 ${source.id} 无可读 Channel`,
                        cellId: connection.edgeId,
                    });
                }
            }
            if (connection.semantic === "CONTROL") {
                const target = this.components.find((component) => component.id === connection.target);
                if (
                    target != null &&
                    !isControllerFactoryPid(target.factoryPid) &&
                    !this.channelCapabilityFor(target.factoryPid).control
                ) {
                    warnings.push({
                        severity: "warning",
                        message: `控制连线目标 ${target.id} 无可写 Channel`,
                        cellId: connection.edgeId,
                    });
                }
            }
        }

        // 孤儿设备提示
        for (const component of this.components) {
            const isBridgeType = component.factoryPid.startsWith("Bridge.");
            const hasConnection = this.connections.some(
                (connection) => connection.source === component.id || connection.target === component.id,
            );
            if (!isBridgeType && !hasConnection) {
                warnings.push({
                    severity: "info",
                    message: `节点 ${component.id} 未参与任何拓扑连线`,
                    cellId: component.id,
                });
            }
        }

        // Controller 相关校验
        for (const component of this.components) {
            if (!isControllerFactoryPid(component.factoryPid)) {
                continue;
            }
            const properties = this.getFactoryProperties(component.factoryPid);

            // 必需的设备引用字段为空
            for (const property of properties) {
                if (property.isRequired && inferFieldSemantic(property.id).kind === "device-ref") {
                    const value = component.properties[property.id];
                    if (value == null || value === "") {
                        warnings.push({
                            severity: "warning",
                            message: `Controller ${component.id} 缺少必需的输入引用 ${property.id}`,
                            cellId: component.id,
                        });
                    }
                }
            }

            // 无出边（无输出目标）
            const hasOutgoing = this.connections.some((connection) => connection.source === component.id);
            if (!hasOutgoing) {
                warnings.push({
                    severity: "info",
                    message: `Controller ${component.id} 未配置输出目标，该控制器不会产生控制效果`,
                    cellId: component.id,
                });
            }

            // CONTROL 边目标与输出引用字段不一致
            const deviceRefFields = controllerDeviceRefFields(properties);
            for (const connection of this.connections) {
                if (connection.semantic !== "CONTROL" || connection.source !== component.id) {
                    continue;
                }
                const targetComponent = this.components.find((candidate) => candidate.id === connection.target);
                if (targetComponent == null) {
                    continue;
                }
                const targetPrefix = targetComponent.factoryPid.split(".")[0].toLowerCase();
                const field = deviceRefFields.find((candidate) => candidate.prefix.toLowerCase() === targetPrefix);
                if (field != null && component.properties[field.id] !== connection.target) {
                    warnings.push({
                        severity: "warning",
                        message: `连线与配置不一致（${connection.source} → ${connection.target} 未匹配 ${field.id}）`,
                        cellId: connection.edgeId,
                    });
                }
            }
        }

        // 设备引用有效性（ess.id / meter.id / datasource.id 等应指向画布上存在的组件）
        for (const component of this.components) {
            for (const property of this.getFactoryProperties(component.factoryPid)) {
                const semantic = inferFieldSemantic(property.id);
                if (semantic.kind !== "device-ref" || semantic.prefix.toLowerCase() === "modbus") {
                    continue; // Bridge 引用（modbus_id）由上面的 Bridge 引用有效性单独校验
                }
                const value = component.properties[property.id];
                if (value == null || value === "" || Array.isArray(value)) {
                    continue;
                }
                if (!componentIds.has(String(value))) {
                    warnings.push({
                        severity: "warning",
                        message: `节点 ${component.id} 的 ${property.id} 引用了不存在的组件 ${value}`,
                        cellId: component.id,
                    });
                }
            }
        }

        // Acting 类 Simulator 必须绑定数据源
        for (const component of this.components) {
            if (!/\.Acting$/.test(component.factoryPid)) {
                continue;
            }
            const datasourceId = component.properties["datasource.id"];
            if (datasourceId == null || datasourceId === "") {
                warnings.push({
                    severity: "warning",
                    message: `模拟设备 ${component.id} 未绑定数据源（datasource.id）`,
                    cellId: component.id,
                });
            }
        }

        // 有设备但无控制器
        const hasController = this.components.some((component) => isControllerFactoryPid(component.factoryPid));
        const hasDevice = this.components.some((component) => !isControllerFactoryPid(component.factoryPid));
        if (hasDevice && !hasController) {
            warnings.push({
                severity: "info",
                message: "画布只有设备、没有控制器，系统可运行但无自动控制逻辑",
            });
        }

        return warnings;
    }

    private factoryHasReadOnlyChannel(factoryPid: string): boolean {
        return this.channelCapabilityFor(factoryPid).measure;
    }

    private factoryHasWritableChannel(factoryPid: string): boolean {
        return this.channelCapabilityFor(factoryPid).control;
    }

    protected closeValidationPanel(): void {
        this.showValidationPanel = false;
    }

    protected focusWarning(warning: TopologyWarning): void {
        if (this.graph == null || warning.cellId == null) {
            return;
        }
        const cell = this.graph.getCellById(warning.cellId);
        if (cell == null) {
            return;
        }
        this.graph.cleanSelection();
        this.graph.select(cell);
        this.graph.centerCell(cell);
        this.flashCell(warning.cellId);
    }

    private flashCell(cellId: string): void {
        const cell = this.graph?.getCellById(cellId);
        if (cell == null || this.graph == null) {
            return;
        }
        const glow = { name: "dropShadow", args: { dx: 0, dy: 0, blur: 6, color: "#1677ff", opacity: 0.9 } };
        const attrPath = cell.isEdge() ? "line/filter" : "body/filter";
        cell.setAttrs(cell.isEdge() ? { line: { filter: glow } } : { body: { filter: glow } });
        setTimeout(() => {
            if (this.graph?.getCellById(cellId) != null) {
                cell.removeAttrByPath(attrPath);
            }
        }, 1200);
    }

    private exportDeviceProperties(component: DraftComponent): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(component.properties)) {
            if (value == null || value === "") {
                continue;
            }
            result[key] = value;
        }
        return result;
    }
}

import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Cell, Edge, Graph, History, Keyboard, MiniMap, Selection } from "@antv/x6";
import { EdgeConfig, Service } from "src/app/shared/shared";
import { PropertyFormComponent } from "./property-form.component";
import { ConnectionGroup, connectionGroupFactoryPid, connectionGroupProperties, createConnectionGroup } from "./topology.connection-group";
import { DEVICE_PALETTE, DevicePaletteEntry } from "./topology.devices";
import { DraftComponent, DraftConnection, TopologySemantic } from "./topology.draft";
import { PropertyDefinition } from "./topology.factory-schema";
import { FACTORY_WHITELIST, TopologyCategory } from "./topology.whitelist";

/** 连线语义的展示元数据 */
const SEMANTIC_META: Record<TopologySemantic, { label: string; abbreviation: string; color: string; dashed: boolean }> = {
    MEASUREMENT: { label: "测量", abbreviation: "M", color: "#1677ff", dashed: false },
    CONTROL: { label: "控制", abbreviation: "C", color: "#fa8c16", dashed: true },
};

/**
 * 自定义矩形卡片节点：显示 label 与 factoryPid 两行文字，并带上下左右 4 个连接端口。
 */
Graph.registerNode(
    "topology-node",
    {
        inherit: "rect",
        markup: [
            { tagName: "rect", selector: "body" },
            { tagName: "text", selector: "label" },
            { tagName: "text", selector: "pid" },
        ],
        attrs: {
            body: {
                fill: "#ffffff",
                stroke: "#5f95ff",
                strokeWidth: 1,
                rx: 6,
                ry: 6,
            },
            label: {
                text: "",
                fill: "#262626",
                fontSize: 14,
                fontWeight: 600,
                textAnchor: "middle",
                textVerticalAnchor: "middle",
                refX: 0.5,
                refY: 0.38,
            },
            pid: {
                text: "",
                fill: "#8c8c8c",
                fontSize: 10,
                textAnchor: "middle",
                textVerticalAnchor: "middle",
                refX: 0.5,
                refY: 0.72,
            },
        },
        ports: {
            groups: {
                top: { position: "top", attrs: { circle: { r: 4, magnet: true, stroke: "#5f95ff", strokeWidth: 2, fill: "#ffffff" } } },
                right: { position: "right", attrs: { circle: { r: 4, magnet: true, stroke: "#5f95ff", strokeWidth: 2, fill: "#ffffff" } } },
                bottom: { position: "bottom", attrs: { circle: { r: 4, magnet: true, stroke: "#5f95ff", strokeWidth: 2, fill: "#ffffff" } } },
                left: { position: "left", attrs: { circle: { r: 4, magnet: true, stroke: "#5f95ff", strokeWidth: 2, fill: "#ffffff" } } },
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
    imports: [PropertyFormComponent, FormsModule],
    template: `
        <div class="editor-layout">
            <!-- 设备面板 -->
            <aside class="device-panel">
                <h3 class="panel-heading">设备面板</h3>
                @for (device of devicePalette; track device.factoryPid) {
                    <div class="device-item" draggable="true" (dragstart)="onDragStart($event, device)">
                        <span class="device-label">{{ device.label }}</span>
                        <span class="device-pid">{{ device.factoryPid }}</span>
                    </div>
                }
                <h3 class="panel-heading">连接组</h3>
                @for (group of connectionGroups; track group.id) {
                    <div class="group-item">
                        <span class="group-label">{{ group.id }} · {{ group.type === 'tcp' ? 'TCP' : 'Serial' }}</span>
                        <button type="button" class="group-btn" (click)="startEditGroup(group)">编辑</button>
                        <button type="button" class="group-btn" (click)="deleteGroup(group.id)">删除</button>
                    </div>
                }
                @if (editingGroup) {
                    <div class="group-form">
                        <label class="group-field-label">ID</label>
                        <input class="group-input" [(ngModel)]="editingGroup.id" [disabled]="!isCreatingGroup" />
                        <label class="group-field-label">类型</label>
                        <select class="group-input" [(ngModel)]="editingGroup.type">
                            <option value="tcp">Modbus TCP</option>
                            <option value="serial">Modbus Serial</option>
                        </select>
                        @if (editingGroup.type === 'tcp') {
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
                            <button type="button" class="group-btn" (click)="cancelGroupEdit()">取消</button>
                        </div>
                    </div>
                } @else {
                    <button type="button" class="group-add" (click)="startCreateGroup()">＋ 新建连接组</button>
                }
                <div class="toolbar">
                    <button type="button" class="toolbar-btn" [disabled]="!canUndo" (click)="undo()">撤销</button>
                    <button type="button" class="toolbar-btn" [disabled]="!canRedo" (click)="redo()">重做</button>
                </div>
                <button type="button" class="export-btn" (click)="exportDraft()">导出拓扑草稿</button>
                <p class="export-note">导出后请先应用 Bridge 配置，再应用 Device 配置</p>
                <textarea class="export-area" [value]="exportedJson" readonly placeholder="导出结果将显示在这里"></textarea>
            </aside>

            <!-- 画布 -->
            <div #canvasWrap class="canvas-wrap" (dragover)="onDragOver($event)" (drop)="onDrop($event)">
                <div class="topology-note">拖拽左侧设备到画布创建节点 · 从节点端口拖出连线</div>
                <div #canvas class="topology-canvas"></div>
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
                                <button type="button" class="context-menu-item" (click)="onContextAction('paste')">粘贴</button>
                            }
                            <button type="button" class="context-menu-item" (click)="onContextAction('zoom')">适应画布</button>
                            <button type="button" class="context-menu-item" (click)="onContextAction('selectAll')">全选</button>
                        }
                        @if (contextMenu.type === "node") {
                            <button type="button" class="context-menu-item" (click)="onContextAction('delete')">删除</button>
                            <button type="button" class="context-menu-item" (click)="onContextAction('copy')">复制</button>
                            <button type="button" class="context-menu-item" (click)="onContextAction('edit')">编辑参数</button>
                        }
                        @if (contextMenu.type === "edge") {
                            <button type="button" class="context-menu-item" (click)="onContextAction('delete')">删除</button>
                            <button type="button" class="context-menu-item" (click)="onContextAction('setMeasurement')">改为测量 (M)</button>
                            <button type="button" class="context-menu-item" (click)="onContextAction('setControl')">改为控制 (C)</button>
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
                    <!-- 上层：画布抽象层 -->
                    <div class="panel-section">
                        <h4 class="section-title">画布抽象层</h4>
                        <label class="field-label">设备类型</label>
                        <select class="field-select" [(ngModel)]="upperFactoryPid" (ngModelChange)="onFactoryPidChange($event)">
                            @for (factoryId of availableFactoryIds; track factoryId) {
                                <option [value]="factoryId">{{ factoryId }}</option>
                            }
                        </select>
                        <label class="field-label">连接组 (Bridge)</label>
                        <select class="field-select" [(ngModel)]="upperBridgeId" (ngModelChange)="onBridgeChange($event)">
                            <option value="">无（直连）</option>
                            @for (group of connectionGroups; track group.id) {
                                <option [value]="group.id">{{ group.id }}</option>
                            }
                        </select>
                        <label class="field-label">Unit-ID</label>
                        <input class="field-input" type="number" [(ngModel)]="upperUnitId" (ngModelChange)="onUnitIdChange($event)" />
                    </div>
                    <!-- 下层：驱动参数层 -->
                    <div class="panel-section">
                        <h4 class="section-title">驱动参数</h4>
                        @if (selectedProperties.length > 0) {
                            <app-property-form [properties]="selectedProperties" (valueChange)="onPropertyChange($event)" />
                        } @else {
                            <p class="panel-empty">该设备类型暂无驱动参数定义（factoryPid：{{ selectedComponent.factoryPid }}）</p>
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
                    <button type="button" class="modal-btn measurement" (click)="chooseSemantic('MEASUREMENT')">测量 (M)</button>
                    <button type="button" class="modal-btn control" (click)="chooseSemantic('CONTROL')">控制 (C)</button>
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

            .device-panel {
                width: 220px;
                flex-shrink: 0;
                border-right: 1px solid #e8e8e8;
                background: #ffffff;
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                overflow-y: auto;
            }

            .panel-heading {
                font-size: 14px;
                font-weight: 600;
                color: #262626;
                margin: 0 0 4px;
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

    protected readonly devicePalette: DevicePaletteEntry[] = DEVICE_PALETTE;
    protected selectedComponent: DraftComponent | null = null;
    protected selectedProperties: PropertyDefinition[] = [];
    private factories: { [id: string]: EdgeConfig.Factory } = {};
    protected availableFactoryIds: string[] = [];
    protected upperFactoryPid = "";
    protected upperBridgeId = "";
    protected upperUnitId: number | null = null;
    protected exportedJson = "";
    protected showSemanticSelector = false;
    protected canUndo = false;
    protected canRedo = false;
    protected contextMenu: { x: number; y: number; type: "blank" | "node" | "edge"; cellId: string | null } | null = null;
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
            this.availableFactoryIds = Object.keys(this.factories).filter((factoryId) =>
                FACTORY_WHITELIST.some((entry) => entry.pattern.test(factoryId)),
            );
            this.components = Object.values(config.components)
                .map((component) => this.toDraftComponent(component))
                .filter((component): component is DraftComponent => component != null);
            this.renderAll();
            // 从 Edge 加载/重载后清空历史，避免撤销到加载之前的状态
            this.graph?.cleanHistory();
        } catch (error) {
            console.warn("[Topology] 获取 EdgeConfig 失败：", error);
        }
    }

    private toDraftComponent(component: EdgeConfig.Component): DraftComponent | null {
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
        this.graph.centerContent();
    }

    private addNodeToGraph(component: DraftComponent, x: number, y: number): void {
        this.graph?.addNode({
            id: component.id,
            shape: "topology-node",
            x,
            y,
            width: 220,
            height: 64,
            data: { properties: { ...component.properties } },
            attrs: {
                body: { stroke: component.category.color },
                label: { text: component.label },
                pid: { text: component.factoryPid },
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
            // 初始 label = id（alias 为空时回退到 id）
            label: id,
            properties: {},
            category,
            persisted: false,
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
    }

    private refreshPanelProperties(): void {
        if (this.selectedComponent == null) {
            return;
        }
        // 上层（画布抽象层）状态
        this.upperFactoryPid = this.selectedComponent.factoryPid;
        this.upperBridgeId = (this.selectedComponent.properties["modbus_id"] as string) ?? "";
        this.upperUnitId = (this.selectedComponent.properties["unitId"] as number) ?? null;
        // 下层（驱动参数层）：由 Factory 元数据驱动
        const definitions = this.factoryPropertyDefinitions(this.selectedComponent.factoryPid);
        this.selectedProperties = definitions.map((definition) => ({
            ...definition,
            default: this.selectedComponent.properties[definition.id] ?? definition.default,
        }));
    }

    private factoryPropertyDefinitions(factoryPid: string): PropertyDefinition[] {
        const factory = this.factories[factoryPid];
        if (factory == null) {
            return [];
        }
        return (factory.properties ?? []).map((property) => ({
            id: property.id,
            name: property.name || property.id,
            type: this.mapFactoryType(property.type),
            default: property.defaultValue,
            required: property.isRequired,
        }));
    }

    private mapFactoryType(type: string): PropertyDefinition["type"] {
        switch (type) {
            case "BOOLEAN":
                return "BOOLEAN";
            case "INTEGER":
                return "INTEGER";
            case "LONG":
                return "LONG";
            case "SHORT":
                return "SHORT";
            case "FLOAT":
                return "FLOAT";
            case "DOUBLE":
                return "DOUBLE";
            default:
                return "STRING";
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
        this.applyFactoryDefaults(component);
        this.updateNodeForComponent(component);
        this.refreshPanelProperties();
        this.cdRef.detectChanges();
    }

    protected onBridgeChange(bridgeId: string): void {
        if (this.selectedComponent == null) {
            return;
        }
        this.selectedComponent.properties["modbus_id"] = bridgeId;
        this.syncNodeProperties(this.selectedComponent);
    }

    protected onUnitIdChange(unitId: number | null): void {
        if (this.selectedComponent == null) {
            return;
        }
        this.selectedComponent.properties["unitId"] = unitId;
        this.syncNodeProperties(this.selectedComponent);
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
        node.setAttrs({
            body: { stroke: component.category.color },
            pid: { text: component.factoryPid },
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
        Object.assign(this.selectedComponent.properties, values);
        this.syncNodeProperties(this.selectedComponent);
        console.log("[Topology] 更新后的 Component：", JSON.stringify(this.selectedComponent, null, 2));
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
        // 先关闭弹窗并清空 pending，避免 applyEdgeStyle 触发历史变更（history:change）时弹窗仍被重渲染
        this.pendingEdge = null;
        this.showSemanticSelector = false;
        // 批量合并：语义样式（attrs + label）合并为一条历史记录
        this.graph?.batchUpdate(() => {
            this.applyEdgeStyle(edge, semantic);
        });
        this.connections.push({
            source: edge.getSourceCellId(),
            target: edge.getTargetCellId(),
            semantic,
            edgeId: edge.id,
        });
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

    private applyEdgeStyle(edge: Edge, semantic: TopologySemantic): void {
        const meta = SEMANTIC_META[semantic];
        edge.setAttrs({
            line: {
                stroke: meta.color,
                strokeWidth: 2,
                strokeDasharray: meta.dashed ? "5 5" : "none",
            },
        });
        edge.setLabels([{ attrs: { label: { text: meta.abbreviation } } }]);
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
            // 边：选中显示 vertices（隐藏 button-remove，避免与中点手柄重叠）；未选中时悬停显示 button-remove
            if (isSelected) {
                this.hideTool(cellId, "button-remove");
                this.showTool(cellId, "vertices", this.verticesToolArgs());
            } else {
                this.hideTool(cellId, "vertices");
                if (isHovered) {
                    this.showTool(cellId, "button-remove", this.removeToolArgs(cell));
                } else {
                    this.hideTool(cellId, "button-remove");
                }
            }
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
    }

    private duplicateSelection(): void {
        this.copySelection();
        this.pasteClipboard();
    }

    private addConnection(sourceId: string, targetId: string, semantic: TopologySemantic): void {
        if (this.graph == null) {
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

    private showContextMenu(type: "blank" | "node" | "edge", cellId: string | null, clientX: number, clientY: number): void {
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

    protected onContextAction(action: "delete" | "copy" | "edit" | "paste" | "zoom" | "selectAll" | "setMeasurement" | "setControl"): void {
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
        const bridges = this.connectionGroups.map((group) => ({
            id: group.id,
            factoryPid: connectionGroupFactoryPid(group),
            properties: connectionGroupProperties(group),
        }));
        const devices = this.components.map((component) => ({
            id: component.id,
            factoryPid: component.factoryPid,
            properties: this.exportDeviceProperties(component),
        }));
        const draft = { bridges, devices };
        this.exportedJson = JSON.stringify(draft, null, 2);
        console.log("[Topology] 导出拓扑草稿：", this.exportedJson);
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

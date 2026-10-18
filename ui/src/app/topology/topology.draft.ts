import { TopologyCategory } from "./topology.whitelist";

/** 连线语义类型 */
export type TopologySemantic = "MEASUREMENT" | "CONTROL";

/** 拓扑草稿中的组件 */
export interface DraftComponent {
    /** 组件 ID（EdgeConfig 里的真实 id，或拖拽创建的临时 id，如 meter_1） */
    id: string;
    /** 组件 factoryPid */
    factoryPid: string;
    /** 节点显示名 */
    label: string;
    /** 组件属性（编辑后回写到这里） */
    properties: Record<string, unknown>;
    /** 白名单分类（用于节点颜色） */
    category: TopologyCategory;
    /** 是否来自 EdgeConfig（已持久化）；false 表示画布上新建的草稿节点 */
    persisted: boolean;
}

/** 拓扑草稿中的连线 */
export interface DraftConnection {
    source: string;
    target: string;
    semantic: TopologySemantic;
    /** X6 边的 id，用于删除时定位 */
    edgeId: string;
}

/** 导出用拓扑草稿（与 EdgeConfig 无关的拓扑元数据） */
export interface TopologyDraft {
    components: Array<{ id: string; factoryPid: string; properties: Record<string, unknown> }>;
    connections: DraftConnection[];
}

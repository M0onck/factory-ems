/** 拓扑画布的视觉编码常量：设备类型主色/图标、Channel 能力角标、连线语义、状态边框与分组框。 画布渲染与图例共用此文件，避免两处维护同一套映射。 */
import { TopologySemantic } from "./topology.draft";

// ------------------------------------------------------------------
// 设备类型视觉编码
// ------------------------------------------------------------------
export interface DeviceTypeVisual {
    pattern: RegExp;
    color: string;
    icon: string;
    label: string;
}

export const DEVICE_TYPE_VISUAL: DeviceTypeVisual[] = [
    { pattern: /^Meter\./, color: "#1E88E5", icon: "◎", label: "电表" },
    { pattern: /^Pv\./, color: "#43A047", icon: "☀", label: "发电" },
    { pattern: /^Ess\./, color: "#8E24AA", icon: "▮", label: "储能" },
    { pattern: /^Evcs\./, color: "#757575", icon: "⚡", label: "可控负载" },
    { pattern: /^IO\./, color: "#B71C1C", icon: "⏻", label: "电闸/继电器" },
    { pattern: /^Simulator\.Datasource\./, color: "#8C8C8C", icon: "▤", label: "数据源" },
    { pattern: /^Simulator\./, color: "#8C8C8C", icon: "◌", label: "模拟设备" },
    { pattern: /^Controller\./, color: "#455A64", icon: "⚙", label: "控制器" },
];

export const UNKNOWN_TYPE_VISUAL: Omit<DeviceTypeVisual, "pattern"> = {
    color: "#9E9E9E",
    icon: "?",
    label: "未知类型",
};

export function deviceTypeVisual(factoryPid: string): Omit<DeviceTypeVisual, "pattern"> {
    const matched = DEVICE_TYPE_VISUAL.find((entry) => entry.pattern.test(factoryPid));
    if (matched != null) {
        return { color: matched.color, icon: matched.icon, label: matched.label };
    }
    return UNKNOWN_TYPE_VISUAL;
}

// ------------------------------------------------------------------
// 设备目录分类（用于设备面板按 nature 分组）
// ------------------------------------------------------------------
export const DEVICE_CATEGORIES: { label: string; pattern: RegExp }[] = [
    { label: "电表", pattern: /^Meter\./i },
    { label: "发电", pattern: /^Pv(Inverter)?\./i },
    { label: "储能", pattern: /^Ess\./i },
    { label: "可控负载", pattern: /^Evcs\./i },
    { label: "电闸/继电器", pattern: /^IO\./i },
    { label: "数据源", pattern: /^Simulator\.Datasource\./i },
];

export function deviceCategory(factoryPid: string, natureIds?: string[]): string | null {
    for (const category of DEVICE_CATEGORIES) {
        if (category.pattern.test(factoryPid)) {
            return category.label;
        }
    }
    // Simulator 等虚拟设备按 nature 归类（真实设备的 nature 与 factoryPid 前缀一致，此处主要用于 Simulator）
    for (const natureId of natureIds ?? []) {
        const last = natureId.split(".").pop() ?? "";
        if (last.includes("Ess")) {
            return "储能";
        }
        if (last.includes("Meter")) {
            return "电表";
        }
        if (last.includes("Pv") || last.includes("Inverter")) {
            return "发电";
        }
        if (last.includes("Evcs") || last.includes("Evse")) {
            return "可控负载";
        }
        if (last.includes("Digital") || last.includes("Relay")) {
            return "电闸/继电器";
        }
        if (last.includes("Datasource")) {
            return "数据源";
        }
    }
    return null;
}

// ------------------------------------------------------------------
// Channel 能力角标
// ------------------------------------------------------------------
export interface BadgeVisual {
    letter: string;
    color: string;
    label: string;
}

export const MEASURE_BADGE: BadgeVisual = { letter: "M", color: "#1E88E5", label: "只读监测" };
export const CONTROL_BADGE: BadgeVisual = { letter: "C", color: "#E53935", label: "可写控制" };

// ------------------------------------------------------------------
// 连线语义视觉编码
// ------------------------------------------------------------------
export interface EdgeSemanticMeta {
    label: string;
    abbreviation: string;
    color: string;
    width: number;
    dashed: boolean;
    arrow: boolean;
    description: string;
}

export const EDGE_SEMANTIC_VISUAL: Record<TopologySemantic, EdgeSemanticMeta> = {
    // MEASUREMENT：箭头从测量源指向消费方（Controller 或下游节点），表示"数据被读取的方向"。
    MEASUREMENT: {
        label: "测量",
        abbreviation: "M",
        color: "#1E88E5",
        width: 1.5,
        dashed: true,
        arrow: true,
        description: "数据被读取方向",
    },
    // CONTROL：箭头从控制源（Controller 或上游节点）指向被控设备，表示"指令写入的方向"。
    CONTROL: {
        label: "控制",
        abbreviation: "C",
        color: "#E53935",
        width: 2,
        dashed: false,
        arrow: true,
        description: "指令写入方向",
    },
};

export const UNKNOWN_SEMANTIC_VISUAL: EdgeSemanticMeta = {
    label: "未知",
    abbreviation: "?",
    color: "#9E9E9E",
    width: 1,
    dashed: false,
    arrow: false,
    description: "",
};

// ------------------------------------------------------------------
// 配置状态边框与 Bridge 分组框
// ------------------------------------------------------------------
export const DEPLOYED_BORDER = { stroke: "#b0b0b0", dasharray: "none" };
export const DRAFT_BORDER = { stroke: "#b0b0b0", dasharray: "4 2" };
export const GROUP_FRAME = { stroke: "#BDBDBD", dasharray: "4 4", fill: "rgba(0, 0, 0, 0.02)" };

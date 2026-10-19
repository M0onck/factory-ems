/**
 * 拓扑图支持的前端侧 factoryId 白名单。
 *
 * 只有 `factoryId` 命中下面某个 `pattern` 的 Component 才会在画布上创建节点； 其余 Component 会被忽略，并在控制台输出 warning（而不是崩溃）。
 */

export interface TopologyCategory {
    /** 匹配 Component.factoryId 的正则表达式 */
    pattern: RegExp;
    /** 分类显示名 */
    label: string;
    /** 节点边框颜色 */
    color: string;
}

export const FACTORY_WHITELIST: TopologyCategory[] = [
    { pattern: /^Meter\./, label: "电表", color: "#1677ff" },
    { pattern: /^Ess\./, label: "储能", color: "#52c41a" },
    // 注意：真实 OpenEMS 的光伏逆变器 factoryId 前缀并不统一
    // （如 PvInverter.*、PV-Inverter.*、SolarEdge.PV-Inverter、Kaco.*.PvInverter），
    // 这里用 Pv./PvInverter. 兜底，接入真实设备时可按实际 factoryId 继续扩展。
    { pattern: /^Pv(Inverter)?\./, label: "发电", color: "#fa8c16" },
    { pattern: /^Evcs\./, label: "充电桩", color: "#722ed1" },
    // 数据源（给虚拟设备喂数据的辅助组件）需先于 Simulator 匹配
    { pattern: /^Simulator\.Datasource\./, label: "数据源", color: "#8c8c8c" },
    // 临时加入：先用虚拟设备（Simulator.*）测试画布
    { pattern: /^Simulator\./, label: "模拟设备", color: "#8c8c8c" },
    { pattern: /^Controller\./, label: "控制器", color: "#455A64" },
];

/**
 * 组件在「控制设计图」中的语义分类：
 *
 * - Device：真实/虚拟设备（能量流参与者）
 * - Controller：控制策略（读取设备、决策、写回设备）
 * - Datasource：数据源（给虚拟设备喂数据）
 * - Infrastructure：系统管线（功率计算、过滤器、API、日志、Core、Scheduler、Timedata），不属于控制设计，默认不在图中显示
 */
export type ComponentKind = "device" | "controller" | "datasource" | "infrastructure";

export function componentKind(factoryPid: string, id: string): ComponentKind {
    // OpenEMS 单例/核心组件约定：id 以 "_" 开头（如 _power、_evcsSlowPowerIncreaseFilter、_sum）
    if (id.startsWith("_")) {
        return "infrastructure";
    }
    return factoryKind(factoryPid);
}

/** 仅按 factoryPid 分类（用于设备/控制器面板，此时尚无组件实例 id） */
export function factoryKind(factoryPid: string): ComponentKind {
    // API / 调试控制器是系统管线，不是控制策略
    if (factoryPid.startsWith("Controller.Api.") || factoryPid.startsWith("Controller.Debug.")) {
        return "infrastructure";
    }
    if (factoryPid.startsWith("Simulator.Datasource.")) {
        return "datasource";
    }
    if (factoryPid.startsWith("Controller.")) {
        return "controller";
    }
    return "device";
}

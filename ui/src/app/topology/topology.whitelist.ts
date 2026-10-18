/**
 * 拓扑图支持的前端侧 factoryId 白名单。
 *
 * 只有 `factoryId` 命中下面某个 `pattern` 的 Component 才会在画布上创建节点；
 * 其余 Component 会被忽略，并在控制台输出 warning（而不是崩溃）。
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
    // 临时加入：先用虚拟设备（Simulator.*）测试画布
    { pattern: /^Simulator\./, label: "模拟设备", color: "#8c8c8c" },
];

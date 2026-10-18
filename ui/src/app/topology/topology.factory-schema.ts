/**
 * 阶段三：mock factory schema。
 *
 * 暂不接入真实的 Factory 元数据（OSGi Metatype），先用这份硬编码 schema 驱动参数表单。
 * key 是 factoryId，value 是该类型可编辑的属性定义列表。
 */

/** 通用参数表单的属性定义 */
export interface PropertyDefinition {
    /** 属性 ID（写回 Component.properties 时作为 key） */
    id: string;
    /** 属性显示名 */
    name: string;
    /** 属性类型 */
    type: "STRING" | "INTEGER" | "LONG" | "SHORT" | "FLOAT" | "DOUBLE" | "BOOLEAN" | "SELECT";
    /** 默认值（若组件 properties 中已有值，则用组件当前值覆盖） */
    default?: unknown;
    /** 是否必填 */
    required: boolean;
    /** SELECT 类型的候选项 */
    options?: { label: string; value: unknown }[];
}

export const MOCK_FACTORY_SCHEMA: Record<string, PropertyDefinition[]> = {
    "Meter.Socomec.DirisA40": [
        // modbus_id（连接组）与 unitId 由参数面板统一注入，这里仅保留驱动特有属性
        { id: "invert", name: "反转电流方向", type: "BOOLEAN", required: false },
    ],
    "Ess.Power": [
        { id: "maxChargePower", name: "最大充电功率 (W)", type: "INTEGER", required: false },
        { id: "maxDischargePower", name: "最大放电功率 (W)", type: "INTEGER", required: false },
    ],
    // 临时：让模拟器储能节点也能测试「点击 → 表单 → 回写」闭环
    "Simulator.EssSymmetric.Reacting": [
        { id: "capacity", name: "容量 (Wh)", type: "INTEGER", required: false },
        { id: "initialSoc", name: "初始 SOC (%)", type: "INTEGER", required: false },
        { id: "maxApparentPower", name: "最大视在功率 (VA)", type: "INTEGER", required: false },
    ],
};

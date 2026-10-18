/**
 * 设备面板（硬编码）。列出允许拖拽创建的 factoryPid。
 * 后续可改为从 getAllComponentFactories 拉取。
 */

export interface DevicePaletteEntry {
    factoryPid: string;
    label: string;
}

export const DEVICE_PALETTE: DevicePaletteEntry[] = [
    { factoryPid: "Meter.Socomec.DirisA40", label: "并网电表" },
    { factoryPid: "Ess.Power", label: "储能系统" },
    { factoryPid: "Pv.Inverter.Kaco", label: "光伏逆变器" },
    { factoryPid: "Evcs.Abl", label: "充电桩" },
];

/** 设备面板条目（label 用于展示，factoryPid 用于拖拽创建）。设备目录现由 Factory 元数据驱动。 */

export interface DevicePaletteEntry {
    factoryPid: string;
    label: string;
}

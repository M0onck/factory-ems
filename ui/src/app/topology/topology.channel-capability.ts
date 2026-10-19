/**
 * Channel 能力角标：从 DeviceNature 元数据的 natureId 推导「只读(Measure)/可写(Control)」能力。
 *
 * TODO: 临时映射表。待接入 Factory 的 Channel 定义（accessMode: READ_ONLY / READ_WRITE / WRITE_ONLY） 后，改为从 Channel
 * 元数据直接推导并删除此表。集中在此文件，便于后续替换。
 */

export interface ChannelCapability {
    /** 至少有一个只读 Channel（Measure） */
    measure: boolean;
    /** 至少有一个可写 Channel（Control） */
    control: boolean;
}

const NATURE_CAPABILITY: { suffix: string; measure: boolean; control: boolean }[] = [
    // 电表类：只读
    { suffix: "ElectricityMeter", measure: true, control: false },
    { suffix: "SymmetricMeter", measure: true, control: false },
    { suffix: "AsymmetricMeter", measure: true, control: false },
    // 储能类：读写
    { suffix: "SymmetricEss", measure: true, control: true },
    { suffix: "ManagedSymmetricEss", measure: true, control: true },
    { suffix: "AsymmetricEss", measure: true, control: true },
    { suffix: "ManagedAsymmetricEss", measure: true, control: true },
    // IO 类：输出可写、输入只读
    { suffix: "DigitalOutput", measure: false, control: true },
    { suffix: "DigitalInput", measure: true, control: false },
    // 充电桩类：读写
    { suffix: "Evcs", measure: true, control: true },
    { suffix: "EvseChargePoint", measure: true, control: true },
];

export function channelCapability(natureIds: string[]): ChannelCapability {
    const result: ChannelCapability = { measure: false, control: false };
    for (const natureId of natureIds ?? []) {
        const matched = NATURE_CAPABILITY.find((entry) => natureId.endsWith(entry.suffix));
        if (matched != null) {
            result.measure = result.measure || matched.measure;
            result.control = result.control || matched.control;
        }
    }
    return result;
}

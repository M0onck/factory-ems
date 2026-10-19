/**
 * Controller 节点：由 Factory 元数据驱动的属性 schema 与连线语义映射。
 *
 * 本步骤不再硬编码具体 Controller 类型；从 EdgeConfig.factories 中读取所有 `Controller.*` Factory 的 properties，再按字段名推断语义（设备引用 / Channel 地址
 * / 普通字段）。
 */
import { EdgeConfig } from "src/app/shared/shared";
import { DraftComponent } from "./topology.draft";
import { mapFactoryType, PropertyDefinition, repeatElementType } from "./topology.factory-schema";

export function isControllerFactoryPid(factoryPid: string): boolean {
    return factoryPid.startsWith("Controller.");
}

export function controllerLabel(factoryPid: string): string {
    return factoryPid.split(".").pop() ?? factoryPid;
}

/** 字段语义推断结果 */
export type ControllerFieldSemantic =
    | { kind: "device-ref"; prefix: string }
    | { kind: "device-ref-list"; prefix: string }
    | { kind: "channel-address" }
    | { kind: "plain" };

/**
 * 语义映射表（前端侧）：
 *
 * - `_id` / `.id` 结尾 → 单个设备引用（下拉，按前缀过滤设备）
 * - `_ids` / `.ids` 结尾 → 设备引用列表（文本，逗号分隔）
 * - 含 `ChannelAddress` → Channel 地址（文本）
 * - 其他 → 按 Factory 声明的 type 渲染
 */
export function inferFieldSemantic(fieldId: string): ControllerFieldSemantic {
    if (fieldId.endsWith("_ids")) {
        return { kind: "device-ref-list", prefix: fieldId.slice(0, -4) };
    }
    if (fieldId.endsWith("_id")) {
        return { kind: "device-ref", prefix: fieldId.slice(0, -3) };
    }
    if (fieldId.endsWith(".ids")) {
        return { kind: "device-ref-list", prefix: fieldId.slice(0, -4) };
    }
    if (fieldId.endsWith(".id")) {
        return { kind: "device-ref", prefix: fieldId.slice(0, -3) };
    }
    if (fieldId.includes("ChannelAddress")) {
        return { kind: "channel-address" };
    }
    return { kind: "plain" };
}

/** 设备引用字段的输入/输出方向启发式：meter/sensor/input/datasource → 输入（MEASUREMENT），其他 → 输出（CONTROL）。 用于连线双向同步与字段提示，两处共用同一规则。 */
export function deviceRefIsInput(prefix: string): boolean {
    const p = prefix.toLowerCase();
    return (
        p === "meter" ||
        p.includes("meter") ||
        p === "sensor" ||
        p.includes("sensor") ||
        p === "input" ||
        p === "datasource" ||
        p.includes("datasource")
    );
}

export function deviceRefDirectionHint(prefix: string): string {
    return deviceRefIsInput(prefix) ? "推断为输入（测量：设备 → 控制器）" : "推断为输出（控制：控制器 → 设备）";
}

/** 根据 Factory 属性 + 语义映射，生成 Controller 的属性定义 */
export function controllerPropertyDefinitions(
    properties: EdgeConfig.FactoryProperty[],
    components: DraftComponent[],
): PropertyDefinition[] {
    return properties.map((property) => {
        const name = property.name || property.id;
        const semantic = inferFieldSemantic(property.id);
        switch (semantic.kind) {
            case "device-ref":
                return {
                    id: property.id,
                    name,
                    type: "SELECT" as const,
                    required: property.isRequired,
                    default: property.defaultValue,
                    options: componentIdOptionsByPrefix(components, semantic.prefix),
                    hint: deviceRefDirectionHint(semantic.prefix),
                };
            case "device-ref-list":
                return {
                    id: property.id,
                    name,
                    type: "STRING" as const,
                    required: property.isRequired,
                    default: property.defaultValue,
                    hint: "设备引用列表：请用逗号分隔组件 ID（如 meter0, ess0）",
                };
            case "channel-address":
                return {
                    id: property.id,
                    name,
                    type: "STRING" as const,
                    required: property.isRequired,
                    default: property.defaultValue,
                    hint: channelHint(components),
                };
            case "plain":
                return plainPropertyDefinition(property, name);
        }
    });
}

/** 返回 Controller 中所有"单个设备引用"字段（用于连线双向同步） */
export function controllerDeviceRefFields(properties: EdgeConfig.FactoryProperty[]): { id: string; prefix: string }[] {
    return properties
        .filter((property) => inferFieldSemantic(property.id).kind === "device-ref")
        .map((property) => {
            const semantic = inferFieldSemantic(property.id) as Extract<
                ControllerFieldSemantic,
                { kind: "device-ref" }
            >;
            return { id: property.id, prefix: semantic.prefix };
        });
}

/** 组件的"设备引用类型"（ess/meter/pv/evcs/io/datasource）： 真实设备按 factoryPid 前缀判定；Simulator 等虚拟设备按 nature 判定。 */
export function componentRefType(component: DraftComponent): string | null {
    const prefix = component.factoryPid.split(".")[0].toLowerCase();
    if (prefix === "meter" || prefix === "ess" || prefix === "pv" || prefix === "evcs" || prefix === "io") {
        return prefix;
    }
    if (prefix === "pvinverter") {
        return "pv";
    }
    if (prefix === "datasource") {
        return "datasource";
    }
    for (const natureId of component.natureIds ?? []) {
        const last = natureId.split(".").pop() ?? "";
        if (last.includes("Ess")) {
            return "ess";
        }
        if (last.includes("Meter")) {
            return "meter";
        }
        if (last.includes("Datasource")) {
            return "datasource";
        }
        if (last.includes("Evcs") || last.includes("Evse")) {
            return "evcs";
        }
        if (last.includes("Digital") || last.includes("Relay")) {
            return "io";
        }
    }
    return null;
}

function plainPropertyDefinition(property: EdgeConfig.FactoryProperty, name: string): PropertyDefinition {
    const knownTypes = ["string", "integer", "long", "short", "float", "double", "boolean"];
    // 重复（数组）类型：schema.type === "repeat"
    const repeatOf = repeatElementType(property.schema, property.type);
    if (repeatOf != null) {
        return {
            id: property.id,
            name,
            type: "REPEAT",
            required: property.isRequired,
            default: property.defaultValue,
            repeatOf,
            hint: "数组：请用逗号分隔",
        };
    }
    // ENUM 通过 schema.templateOptions.options 识别（OpenemsType 没有 ENUM 类型）
    const options = enumOptions(property.schema);
    if (options != null && options.length > 0) {
        return {
            id: property.id,
            name,
            type: "SELECT",
            required: property.isRequired,
            default: property.defaultValue,
            options,
        };
    }
    return {
        id: property.id,
        name,
        type: mapFactoryType(property.type),
        required: property.isRequired,
        default: property.defaultValue,
        hint: knownTypes.includes((property.type ?? "").toLowerCase())
            ? undefined
            : "该字段的语义未自动识别，请手动填写",
    };
}

export function componentIdOptionsByPrefix(
    components: DraftComponent[],
    prefix: string,
): { label: string; value: string }[] {
    const target = prefix.toLowerCase();
    return components
        .filter((component) => componentRefType(component) === target)
        .map((component) => ({ label: component.id, value: component.id }));
}

function channelHint(components: DraftComponent[]): string {
    const channels: string[] = [];
    for (const component of components) {
        if (/^IO\./i.test(component.factoryPid)) {
            for (let i = 1; i <= 4; i += 1) {
                channels.push(`${component.id}/Relay${i}`);
            }
        }
    }
    return channels.length > 0 ? `可用 Channel：${channels.join("、")}` : "Channel 地址（如 _sum/GridActivePower）";
}

function enumOptions(schema: unknown): { label: string; value: string }[] | null {
    if (schema == null || typeof schema !== "object") {
        return null;
    }
    const templateOptions = (schema as { templateOptions?: unknown }).templateOptions;
    if (templateOptions == null || typeof templateOptions !== "object") {
        return null;
    }
    const options = (templateOptions as { options?: unknown }).options;
    if (!Array.isArray(options)) {
        return null;
    }
    return options.map((option) => {
        if (typeof option === "string") {
            return { label: option, value: option };
        }
        if (typeof option === "object" && option != null) {
            const obj = option as { label?: unknown; value?: unknown };
            const value = obj.value ?? obj.label ?? "";
            const label = obj.label ?? value;
            return { label: String(label), value: String(value) };
        }
        return { label: String(option), value: String(option) };
    });
}

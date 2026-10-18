/**
 * 连接组：可复用的 Bridge Component 配置。
 *
 * 每个连接组对应一个 Modbus Bridge，供设备节点在导出时通过 `modbus_id` 引用。
 */

export type ConnectionGroupType = "tcp" | "serial";

export interface ConnectionGroup {
    id: string;
    type: ConnectionGroupType;
    /** TCP：IP 地址 */
    ip: string;
    /** TCP：端口，默认 502 */
    port: number;
    /** Serial：串口名，如 /dev/ttyUSB0 */
    portName: string;
    /** Serial：波特率，默认 9600 */
    baudRate: number;
}

/** 根据类型返回 Bridge 的 factoryPid */
export function connectionGroupFactoryPid(group: ConnectionGroup): string {
    return group.type === "tcp" ? "Bridge.Modbus.Tcp" : "Bridge.Modbus.Serial";
}

/** 根据类型返回 Bridge 的 properties */
export function connectionGroupProperties(group: ConnectionGroup): Record<string, unknown> {
    return group.type === "tcp" ? { ip: group.ip, port: group.port } : { portName: group.portName, baudRate: group.baudRate };
}

/** 新建一个带默认值的连接组 */
export function createConnectionGroup(type: ConnectionGroupType, id: string): ConnectionGroup {
    return { id, type, ip: "", port: 502, portName: "/dev/ttyUSB0", baudRate: 9600 };
}

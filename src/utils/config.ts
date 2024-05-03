import { readFileSync } from "node:fs";
import YAML from "yaml";
import { initializeFileStorage } from "./mime";
export interface MiraiConfig {
    host: string;
    verifyKey: string;
    qq: number;
}
export interface MatrixRegistration {
    path: string;
    localpart: string;
}
export interface MatrixConfig {
    homeserver: string;
    domain: string;
    listenIP: string;
    listenPort: number;
    registration: MatrixRegistration;
    namePrefix: string;
}

export interface PuppetCustomization {
    adminName: string;
    adminAvatar: string;
    customizationVersion: number;
}
export interface GroupBridgeRule {
    mx: string;
    qq: number;
}
export interface SocksProxyConfig {
    enable: boolean;
    url: string;
}

export interface RedisConfig {
    connString: string;
    namespace: string;
}
export interface DBConfig {
    path: string;
}

export interface ConfigFile {
    mirai: MiraiConfig;
    matrix: MatrixConfig;
    bridgedGroups: GroupBridgeRule[];
    socksProxy: SocksProxyConfig;
    puppetCustomization: PuppetCustomization;
    redisConfig: RedisConfig;
    dbConfig: DBConfig;
}

export function readConfig() {
    initializeFileStorage();
    const file = readFileSync("config.yaml", "utf-8");
    const config: ConfigFile = YAML.parse(file);
    return Object.assign(
        {},
        {
            redisNames: {
                QQ_OUTGOING_QUEUE: `${config.redisConfig.namespace}-qqOutgoingQueue`,
                QQ_INCOMING_QUEUE: `${config.redisConfig.namespace}-qqIncomingQueue`,
                MATRIX_OUTGOING_QUEUE: `${config.redisConfig.namespace}-matrixOutgoingQueue`,
                MATRIX_INCOMING_QUEUE: `${config.redisConfig.namespace}-matrixIncomingQueue`,

                QQ_TASK_QUEUE: `${config.redisConfig.namespace}-qqTaskQueue`,
                QQ_TASK_RESPONSE_QUEUE: `${config.redisConfig.namespace}-qqTaskResponseQueue`,
                MATRIX_TASK_QUEUE: `${config.redisConfig.namespace}-matrixTaskQueue`,
                MATRIX_TASK_RESPONSE_QUEUE: `${config.redisConfig.namespace}-matrixTaskResponseQueue`,
            } as const,
        },
        config,
    );
}

export type Config = ReturnType<typeof readConfig>;

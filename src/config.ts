import { readFileSync } from "fs";
import YAML from "yaml";
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

export interface Config {
    mirai: MiraiConfig;
    matrix: MatrixConfig;
    bridgedGroups: GroupBridgeRule[];
    socksProxy: SocksProxyConfig;
    puppetCustomization: PuppetCustomization;
    redisConfig: RedisConfig;
    dbConfig: DBConfig;
}

export function readConfig(): Config {
    const file = readFileSync("config.yaml", "utf-8");
    const config = YAML.parse(file);
    return config;
}

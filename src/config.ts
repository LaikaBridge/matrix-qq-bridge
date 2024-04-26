import { readFileSync } from "fs";
import YAML from "yaml";
interface MiraiConfig {
    host: string;
    verifyKey: string;
    qq: number;
}
interface MatrixRegistration {
    path: string;
    localpart: string;
}
interface MatrixConfig {
    homeserver: string;
    domain: string;
    listenIP: string;
    listenPort: number;
    registration: MatrixRegistration;
    namePrefix: string;
}

interface PuppetCustomization {
    adminName: string;
    adminAvatar: string;
    customizationVersion: number;
}
interface GroupBridgeRule {
    mx: string;
    qq: number;
}
interface SocksProxyConfig {
    enable: boolean;
    url: string;
}
interface RembgConfig {
    enable: boolean;
    url: string;
}

interface RedisConfig {
    connString: string;
    namespace: string;
}
interface DBConfig {
    path: string;
}

interface Config {
    mirai: MiraiConfig;
    matrix: MatrixConfig;
    bridgedGroups: GroupBridgeRule[];
    socksProxy: SocksProxyConfig;
    puppetCustomization: PuppetCustomization;
    redisConfig: RedisConfig;
    dbConfig: DBConfig;
    //    rembgService: RembgConfig
}

export function readConfig(): Config {
    const file = readFileSync("config.yaml", "utf-8");
    const config = YAML.parse(file);
    return config;
}

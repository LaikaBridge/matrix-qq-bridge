import { readFileSync } from "fs"
import YAML from "yaml"
interface MiraiConfig{
    host: string
    verifyKey: string
    qq: number
}
interface MatrixConfig{
    homeserver: string
    domain: string
    listenIP: string
    listenPort: number
}
interface GroupBridgeRule{
    mx: string
    qq: number
}
interface SocksProxyConfig{
    enable: boolean
    url: string
}
interface Config{
    mirai: MiraiConfig
    matrix: MatrixConfig
    bridgedGroups: GroupBridgeRule[]
    socksProxy: SocksProxyConfig
}

export function readConfig(): Config{
    const file = readFileSync("config.yaml", "utf-8");
    const config = YAML.parse(file);
    return config;
}
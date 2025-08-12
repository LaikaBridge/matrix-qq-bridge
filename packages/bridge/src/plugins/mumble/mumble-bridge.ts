import YAML from "yaml"
import { readFileSync } from "fs"
import type { MumbleBridgeRPC } from "./mumble-bridge-rpc";
import { rpcClient } from "typed-rpc";
import { logger } from "../../logger";
import { MUMBLE_CONFIG_PATH } from "../../workdir";
interface MumbleBridgePluginConfig {
    serverAddr: string,
    password: string,
    rpcServerAddr: string,
    rpcServerPort: number
}
const file = readFileSync(MUMBLE_CONFIG_PATH, "utf-8");
const config: MumbleBridgePluginConfig = YAML.parse(file);

const client = rpcClient<MumbleBridgeRPC>({
    url: `http://${config.rpcServerAddr}:${config.rpcServerPort}`
});
export async function mumbleBridgePlugin(x: string): Promise<string> {
    if (x === "!mumble info") {
        return [
            `服务器 ${config.serverAddr}`,
            `第一次登录密码 ${config.password}`
        ].join("\n")
    } else if (x === "!mumble list") {
        try {
            const all_members = await client.getUsers();
            if (all_members.length === 0) {
                return "当前没有用户在线"
            } else {
                return "当前Mumble用户：\n" + all_members.map((x) => `${x.channel}: ${x.users.join(",")}`).join("\n")
            }
        } catch (e) {
            logger.error(e)
            return "获取用户列表失败"
        }
    } else {
        return [
            "Mumble语音服务器",
            "!mumble info 服务器信息",
            "!mumble list 查看在线用户"
        ].join("\n")
    }
}
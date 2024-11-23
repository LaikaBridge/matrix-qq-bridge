import * as jayson from "jayson/promise";
import YAML from "yaml"
import { readFileSync } from "fs"
interface MumbleBridgePluginConfig{
    serverAddr: string,
    password: string,
    rpcServerAddr: string,
    rpcServerPort: number
}
const file = readFileSync("mumble-bridge-config.yaml", "utf-8");
const config: MumbleBridgePluginConfig = YAML.parse(file);

const client = jayson.Client.websocket({
    url: `ws://${config.rpcServerAddr}:${config.rpcServerPort}`
});
type GetUserResp = {channel: string, users: string[]}[];

export async function mumbleBridgePlugin(x: string): Promise<string>{
    if(x==="!mumble info"){
        return [
            `服务器 ${config.serverAddr}`,
            `第一次登录密码 ${config.password}`
        ].join("\n")
    }else if (x==="!mumble list"){
        try{
            const all_members: GetUserResp = (await client.request("getUsers", [])).result;
            if(all_members.length===0){
                return "当前没有用户在线"
            }else{
                return "当前Mumble用户：\n"+all_members.map((x)=>`${x.channel}: ${x.users.join(",")}`).join("\n")
            }
        }catch(e){
            console.error(e)
            return "获取用户列表失败"
        }
    }else{
        return [
            "Mumble语音服务器",
            "!mumble info 服务器信息",
            "!mumble list 查看在线用户"
        ].join("\n")
    }
}
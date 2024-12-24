import YAML from "yaml"
import { readFileSync } from "fs"
import { AVAILABLE_COMMANDS, CtxCommandData, GeminiReq, GeminiRes, HandlerKey, Photo } from "./rpc";
interface GeminiPluginConfig{
    endpoint: string;
    psk: string;
}
const file = readFileSync("gemini-config.yaml", "utf-8");
const config: GeminiPluginConfig = YAML.parse(file);

export async function invoke(req: GeminiReq): Promise<GeminiRes>{
    const result = await fetch(config.endpoint, {
        headers: {
            "Content-Type": "application/json",
            "X-Custom-PSK": config.psk
        },
        body: JSON.stringify(req),
        method: "POST"
    });
    return await result.json();
}
export function getMatrixImageUrl(homeserver: string, imageId: string): string{
    return `https://${homeserver}/_matrix/media/v3/download/${homeserver}/${imageId}`
}
export function getMatrixChatUrl(roomId: string, eventId: string): string{
    // https://matrix.to/#/!beLznZg6kQwtzH831I:matrix-bridge.gjz010.com/$MIfoWK62yKGsZxzC4mzq4RBdQEkYeew4BNE7doAbrUQ
    return `https://matrix.to/#/${roomId}/${eventId}`
}
export async function pluginGeminiMessage(groupId: string, groupName: string, author: string, authorId: string, messageId: string, message: string | Photo): Promise<string | null>{
    let res: GeminiRes;
    if(typeof message === "string"){
        const req: CtxCommandData = {
            update_type: "message",
            update: {
                message: {
                    photo: [],
                    sender_chat: {title: groupName},
                    from: {
                        id: authorId,
                        username: author,
                        first_name: author,
                        is_bot: false
                    },
                    chat: {
                        type: "group",
                        id: groupId,
                        title: groupName
                    },
                    text: message,
                    message_id: messageId,
                }
            },
            bot: {
                api: "APIKEY"
            }
        }
        let handlerKey : HandlerKey = ":message";
        for(const command of AVAILABLE_COMMANDS){
            if(message.startsWith(command)){
                handlerKey = command;
                req.update_type = "command";
                break;
            }
        }
        const result = invoke({event: handlerKey, payload: req});
        if(handlerKey === ":message"){
            return "";
        }
        res = await result;
    }else{
        const req: CtxCommandData = {
            update_type: "photo",
            update: {
                message: {
                    photo: [message],
                    sender_chat: {title: groupName},
                    from: {
                        id: authorId,
                        username: author,
                        first_name: author,
                        is_bot: false
                    },
                    chat: {
                        type: "group",
                        id: groupId,
                        title: groupName
                    },
                    text: "[图片]",
                    message_id: messageId,
                }
            },
            bot: {
                api: "APIKEY"
            }
        };
        invoke({event: ":message", payload: req});
        return null;
    }
    const lines: string[] = [];
    for(const line of res.events){
        if(line.type === "text"){
            lines.push(line.text);
        }else{
            lines.push("查询结果：");
            for(const r of line.payload){
                lines.push(`${r.userName}: ${r.content} ${r.messageId == null ? "" : `[link](${getMatrixChatUrl(groupId, messageId)})`}`);
            }
        }
    }
    return lines.join("\n");
}
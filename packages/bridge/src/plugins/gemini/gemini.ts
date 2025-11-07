import YAML from "yaml"
import { readFileSync } from "fs"
import { AVAILABLE_COMMANDS, CtxCommandData, GeminiReq, GeminiRes, HandlerKey, Photo } from "./rpc";
import { createClient as createRedisClient } from "redis";
import { logger } from "../../logger";
import { GEMINI_CONFIG_PATH } from "../../workdir";
interface GeminiPluginConfig {
    endpoint: string;
    psk: string;
    externalEndpoint: string;
    externalPSK: string;
    externalRedisURL: string;
    externalWhitelistMXID: string[];
}

interface GeminiExternal {
    groupId: string;
    userName: string;
    content: string;
    messageId: number;
    groupName: string;
}
const file = readFileSync(GEMINI_CONFIG_PATH, "utf-8");
const config: GeminiPluginConfig = YAML.parse(file);
const redisClient = createRedisClient({
    url: config.externalRedisURL
}).connect();
interface ExternalTelegramMap {
    telegram_message_id: number
    telegram_group_id: number
}
export async function waitForTelegramMap(event_id: string, room_id: string): Promise<ExternalTelegramMap | null> {
    const key = `mx:${event_id}:${room_id}`;
    // wait for 1 minute.
    // hope that sending message to telegram is faster than that.
    let value_json: string | null = null;
    for (let i = 0; i < 60; i++) {
        const client = await redisClient;
        value_json = await client.get(key);
        if (value_json !== null) {
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (value_json === null) {
        logger.error(`failed to get telegram map for ${key}`);
        return null;
    }
    logger.info(`got telegram map for ${key}: ${value_json}`);
    return JSON.parse(value_json);

}
export async function invoke(req: GeminiReq): Promise<GeminiRes> {
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
export async function invokeExternal(req: GeminiExternal): Promise<object> {
    const result = await fetch(config.externalEndpoint, {
        headers: {
            "Content-Type": "application/json",
            "X-Custom-PSK": config.externalPSK
        },
        body: JSON.stringify(req),
        method: "POST"
    });
    return await result.json();
}
export function getMatrixImageUrl(homeserver: string, imageId: string): string {
    return `https://${homeserver}/_matrix/media/v3/download/${homeserver}/${imageId}`
}
export function getMatrixChatUrl(roomId: string, eventId: string): string {
    // https://matrix.to/#/!beLznZg6kQwtzH831I:matrix-bridge.gjz010.com/$MIfoWK62yKGsZxzC4mzq4RBdQEkYeew4BNE7doAbrUQ
    return `https://matrix.to/#/${roomId}/${eventId}`
}
export async function pluginGeminiMessage(groupId: string, groupName: string, author: string, authorId: string, messageId: string, message: string | Photo): Promise<string | null> {
    let res: GeminiRes;
    if (typeof message === "string") {
        const req: CtxCommandData = {
            update_type: "message",
            update: {
                message: {
                    photo: [],
                    sender_chat: { title: groupName },
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
            options: {
                pro: false,
                with_context: true,
            },
            bot: {
                api: "APIKEY"
            }
        }
        let handlerKey: HandlerKey = ":message";
        for (const command of AVAILABLE_COMMANDS) {
            if (message.startsWith(`!${command}`)) {
                handlerKey = command;
                req.update_type = "command";
                break;
            }
        }
        if (message.startsWith("!askpro")) {
            handlerKey = "ask";
            req.update_type = "command";
            req.options.pro = true;
            req.options.with_context = true;
        }
        if (message.startsWith("!pro")) {
            handlerKey = "ask";
            req.update_type = "command";
            req.options.pro = true;
            req.options.with_context = false;
        }
        // save to external database
        ; (async () => {
            if (!config.externalWhitelistMXID.includes(groupId)) {
                return;
            }
            const msg_map = await waitForTelegramMap(messageId, groupId);
            if (!msg_map) {
                return;
            }
            const payload: GeminiExternal = {
                groupId: `-100${msg_map.telegram_group_id}`,
                messageId: msg_map.telegram_message_id,
                groupName: groupName,
                userName: author,
                content: message
            };
            logger.debug(payload, `external gemini payload`);
            const result = await invokeExternal(payload);
            logger.debug(result, `external gemini result`)
        })();
        const result = invoke({ event: handlerKey, payload: req });

        if (handlerKey === ":message") {
            return "";
        }
        res = await result;
    } else {
        const req: CtxCommandData = {
            update_type: "photo",
            update: {
                message: {
                    photo: [message],
                    sender_chat: { title: groupName },
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
            options: {
                pro: false,
                with_context: true,
            },
            bot: {
                api: "APIKEY"
            }
        };
        invoke({ event: ":message", payload: req });
        return null;
    }
    const lines: string[] = [];
    for (const line of res.events) {
        if (line.type === "text") {
            lines.push(line.text);
        } else {
            lines.push("查询结果：");
            for (const r of line.payload) {
                lines.push(`${r.userName}: ${r.content} ${r.messageId == null ? "" : `[link](${getMatrixChatUrl(groupId, messageId)})`}`);
            }
        }
    }
    return lines.join("\n");
}
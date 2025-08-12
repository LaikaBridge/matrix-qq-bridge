import { EventEmitter } from "node:events";

import { initialize, Mockv2MessageChain, QqBotEndpoint } from "@laikabridge/matrix-qq-bridge-runtime";
import { logger } from "./logger";

type image = Buffer;


function convertInbound(msg: Mockv2MessageChain[]): MockMessageChain[] {
    const messages: MockMessageChain[] = [];
    for (const m of msg) {
        if (m.type === "Quote" || m.type === "Plain" || m.type === "At" || m.type === "Source") {
            messages.push(m);
        } else if (m.type === "ImageOutbound") {
            messages.push(Plain("[错误: 内部错误]"));
        } else if (m.type === "Forward") {
            const forward = m;
            const nodes: (MockForward["nodeList"]) = [];
            for (const node of forward.nodeList) {
                nodes.push({
                    senderName: node.senderName,
                    messageChain: convertInbound(node.messageChain),
                });
            }
            messages.push({ type: "Forward", nodeList: nodes });
        } else if (m.type === "Unknown") {
            messages.push(Plain(`[未知元素: ${m.placeholder}]`));
        } else if (m.type === "Error") {
            messages.push(Plain(`[错误: ${m.message}]`));
        }
    }
    return messages;
}

function convertOutbound(msg: MockMessageChain[]): Mockv2MessageChain[] {
    const messages: Mockv2MessageChain[] = [];
    for (const m of msg) {
        if (m.type === "Quote" || m.type === "Plain" || m.type === "At" || m.type === "Source") {
            messages.push(m);
        } else if (m.type === "Image") {
            messages.push({ type: "ImageOutbound", mime: m.mime ?? "", buffer: m.buffer ?? Buffer.from([]) })
        } else if (m.type === "Forward") {
            messages.push({ type: "Plain", text: `[错误: 不支持转发]` });
        } else if (m.type === "ForwardOnebot") {
            messages.push({ type: "Plain", text: `[错误: 不支持转发]` });
        }
    }
    return messages;
}

initialize();
export class MiraiOnebotAdaptor {
    //ctx: Context;
    bot: QqBotEndpoint;
    ev: EventEmitter;
    get sessionKey() {
        return "LAIKA_MOCK";
    }
    verify() {
        this.ev.emit("verified");
    }
    async getFriendList() {
        return await this.bot.getFriendList();
    }
    constructor(config: {
        host: string;
        verifyKey: string;
        qq: number;
        enableWebsocket: boolean;
        wsOnly: boolean;
    }) {

        this.ev = new EventEmitter();

        this.bot = new QqBotEndpoint({
            addr: config.host,
            accessToken: config.verifyKey,
        });

        this.bot.registerCallback(async (_, ev) => {
            if (ev.type === "Connected") {
                this.connected = true;
            } else if (ev.type === "GroupMessage") {
                if (ev.selfId === ev.sender.userId) {
                    return; // ignore self message
                }
                const msg2: {
                    type: "GroupMessage";
                    sender: MockGroupSender;
                    messageChain: MockMessageChain[];
                } = {
                    type: "GroupMessage",
                    sender: {
                        id: Number(ev.sender.userId),
                        memberName: (ev.sender.nick || ev.sender.name) || `${ev.sender.userId}`,
                        group: {
                            id: Number(ev.groupId),
                            name: "QQ群"
                        }
                    },
                    messageChain: convertInbound(ev.message)
                }
                this.emit("message", msg2);
            } else if (ev.type === "GroupMessageDeleted") {
                logger.debug(ev);
                this.emit("groupRecall", {
                    group: {
                        id: Number(ev.groupId),
                    },
                    //authorId: Number(msg.event.user?.id),
                    messageId: ev.messageId
                })
            }
        });



    }
    connected = false;
    onSignal(signal: "authed", f: () => void): void;
    onSignal(signal: "verified", f: () => void): void;
    onSignal(signal: string, f: Function): void {
        this.ev.on(signal, f as any);
    }
    onEvent(
        event: "groupRecall",
        f: (message: {
            group: { id: number };
            authorId: number;
            messageId: string;
        }) => void,
    ): void;
    onEvent(event: string, f: Function): void {
        this.ev.on(event, f as any);
    }
    readyFlag = false;
    async listen(g: "group") {
        this.bot.registerCallback((err, ev) => {
            if (ev.type === "Connected") {
                this.readyFlag = true;
            }
        });
        await this.bot.start();
        while (1) {
            await new Promise((resolve) => {
                setTimeout(resolve, 1000);
            });
            if (this.readyFlag) break;
        }
        logger.info("Onebot ready.")
    }
    onMessage(
        f: (message: {
            type: "GroupMessage";
            sender: MockGroupSender;
            messageChain: MockMessageChain[];
        }) => void,
    ): void {
        this.ev.on("message", f as any);
    }

    emit(
        ev: "message",
        msg: {
            type: "GroupMessage";
            sender: MockGroupSender;
            messageChain: MockMessageChain[];
        },
    ): void;
    emit(
        ev: "groupRecall",
        msg: {
            group: { id: number };
            //authorId: number;
            messageId: string;
        },
    ): void;
    emit(ev: string, msg: any): void {
        this.ev.emit(ev, msg);
    }

    async getGroupMemberProfile(
        groupid: number,
        qq: number,
    ): Promise<{
        nickname: string;
    }> {
        const member = await this.bot.getGroupMember(`${groupid}`, `${qq}`);
        return {
            nickname: member.nick ?? member.name ?? ""
        };
    }

    async release() {
        this.ev.removeAllListeners();
        await this.bot.terminate();
    }

    async sendQuotedGroupMessage(
        msg: MockMessageChain[] | string,
        group: number,
        quote: string,
    ): Promise<{ messageId: number }> {
        if (typeof msg === "string") {
            return this.sendQuotedGroupMessage([
                {
                    type: "Plain",
                    text: msg
                }
            ], group, quote);
        }
        const chain: Mockv2MessageChain[] = [{
            type: "Quote",
            id: quote
        }, ...convertOutbound(msg)];
        logger.info(chain, "sendQuotedGroupMessage");

        const message = await this.bot.sendGroupMessage(`${group}`, chain);
        return { messageId: Number(message.messageId) };
    }
    async sendGroupMessage(
        msg: MockMessageChain[] | string,
        group: number,
    ): Promise<{ messageId: number }> {
        if (typeof msg === "string") {
            return this.sendGroupMessage([Plain(msg)], group);
        }
        const chain = convertOutbound(msg);
        //console.log("Sending", chain)
        const message = await this.bot.sendGroupMessage(`${group}`, chain);
        logger.debug(message);
        //console.log("Sent")
        return { messageId: Number(message.messageId) };
    }
    async uploadImage(image: Buffer, target: MockGroupTarget): Promise<image> {
        return image;
    }
    async recall(msgid: string, groupid: string) {
        await this.bot.deleteMessage(msgid);
    }
}




export type MockMessageChain = MockForward | MockQuote | MockPlain | MockAt | MockSource | MockImage | ForwardOnebot;
export type MockForward = {
    type: "Forward"
    nodeList: ({
        senderName: string,
        messageChain: MockMessageChain[]
    })[]
}

export type MockGroupSender = {
    id: number;
    memberName: string;
    group: {
        id: number,
        name: string,
    }
};

export type MockQuote = {
    type: "Quote"
    id: string
}
export type MockPlain = {
    type: "Plain"
    text: string
}
export type MockAt = {
    type: "At"
    target: number
    display?: string
}
export type MockSource = {
    type: "Source"
    id: string
}
export type MockImage = {
    type: "Image"
    url?: string
    imageId?: string
    buffer?: Buffer
    mime?: string
}
export type ForwardOnebot = {
    type: "ForwardOnebot",
    id: number
}
export interface MockGroupTarget {
    type: "GroupMessage",
    sender: {
        group: {
            id: number
        }
    }
}
export function Plain(s: string): MockMessageChain {
    return {
        type: "Plain",
        text: s
    }
}
export function At(q: number): MockMessageChain {
    return {
        type: "At",
        target: q
    }
}
export function Image(image: image, mime = "image/png"): MockMessageChain {
    return {
        type: "Image",
        buffer: image,
        mime: mime
    }
}


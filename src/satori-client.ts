import { EventEmitter } from "node:events";
import satori from "@satorijs/adapter-satori";
import discord from "@satorijs/adapter-discord"
import schema from "@cordisjs/schema"
import http from "@cordisjs/plugin-http"
import { Context, Element as KE, ForkScope, Logger, Bot, h } from "koishi";
import type { GroupTarget, MessageChain } from "node-mirai-sdk";
import * as onebot from "koishi-plugin-adapter-onebot";
import Server from "@koishijs/plugin-server";
import { Internal } from "koishi-plugin-adapter-onebot/lib/types";
import { CQCode } from "koishi-plugin-adapter-onebot";
type image = Buffer;
type NapcatMsg = {
    type: "text"
    data: {text: string}
} | {type: "image"}
function napcatToSatori(napcatData: NapcatMsg[]): KE[]{
    const results = [];
    for (const msg of napcatData) {
        if(msg.type==="text"){
            results.push(KE.text(msg.data.text));
        }else if(msg.type==="image"){
            results.push(KE.text("[图片]"));
        }else{
            results.push(KE.text("[未知元素]"));
        }
    }
    return results;

}
export class MiraiSatoriAdaptor {
    ctx: Context;
    ev: EventEmitter;
    get sessionKey() {
        return "LAIKA_MOCK";
    }
    verify() {
        this.ev.emit("verified");
    }
    async getFriendList() {
        return (await this.bot.getFriendList()).data;
    }
    constructor(config: {
        host: string;
        verifyKey: string;
        qq: number;
        enableWebsocket: boolean;
        wsOnly: boolean;
    }) {
        const ctx = (this.ctx = new Context());
        Logger.levels = {
            base: 3
        }
        this.ev = new EventEmitter();

        ctx.inject(["schema"], (ctx) => {
            ctx.plugin(http);
            ctx.plugin(Server as any);
        });

        ctx.inject(["http"], (ctx) => {
            console.log("Loading Onebot")
            ctx.plugin(onebot.OneBotBot, {
                selfId: `${config.qq}`,
                protocol: "ws",
                endpoint: config.host,
                token: config.verifyKey,
            });
        });

        //console.log(satori)
        ctx.on("message", async (msg) => {
            if (!msg.event.guild) {
                return;
            }
            if (msg.event.selfId === msg.event.user?.id) {
                return;
            }


            let elements: KE[] = [];
            const quote = msg.event.message?.quote;
            if (quote) {
                elements.push(h("quote", { id: quote.id }));
            }
            elements.push(...msg.elements)
            //elements.push(...KE.parse(msg.content ?? ""));
            let msgchain: MockMessageChain[] = [];
            console.log("Message", msg, msg.elements);
            const msgchain_body = await this.untranslateMessageChain(msg.event.message?.id ?? "UNMAPPED", elements);

            msgchain.push(...msgchain_body);
            console.log(msg);
            const msg2: {
                type: "GroupMessage";
                sender: MockGroupSender;
                messageChain: MockMessageChain[];
            } = {
                type: "GroupMessage",
                sender: {
                    id: Number(msg.event.user?.id ?? "0"),
                    memberName: (msg.author?.nick || msg.author?.name) || `${msg.author.id}`,
                    group: {
                        id: Number(msg.event.guild.id),
                        name: msg.event.guild.name ?? ""
                    }
                },
                messageChain: msgchain
            }
            this.emit("message", msg2);
        })
        ctx.on("message-deleted", (msg) => {
            console.log(msg);
            if (!msg.event.guild) {
                return;
            }
            if (msg.event.selfId === msg.event.user?.id) {
                return;
            }
            this.emit("groupRecall", {
                group: {
                    id: Number(msg.event.guild.id),
                },
                authorId: Number(msg.event.user?.id),
                messageId: msg.event.message!.id!
            })
        });
        ctx.on("ready", () => {
            //if(bot.selfId === `${config.qq}`){
            this.connected = true;
            //}
        })

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
    get bot() {
        if (!this.connected) {
            return null as any as typeof this.ctx.bots[0];
        }
        return this.ctx.bots[0]
    }
    async listen(g: "group") {
        await this.ctx.start();

        while (1) {

            await new Promise((resolve) => {
                setTimeout(resolve, 1000);
            });
            if (this.bot) break;
        }
        this.ev.emit("authed");
        console.log("Koishi ready.")
        /*
         *       await this.sendQuotedGroupMessage([
         *           Plain("你好世界")
         *       ], 703596130, "7458692580116697144");
         */
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
            authorId: number;
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
        const member = await this.bot.getGuildMember(`${groupid}`, `${qq}`);
        return {
            nickname: member.nick ?? member.name ?? member.user?.name ?? ""
        };
    }

    async release() {
        this.ev.removeAllListeners();
        await this.ctx.stop();
    }
    async untranslateMessageChain(msgid: string, content: string | KE[], disableForward: boolean = false): Promise<MockMessageChain[]> {

        let elements: KE[];
        if (typeof content === "string") {
            elements = KE.parse(content);
        } else {
            elements = content;
        }
        console.log(elements);
        const chains: MockMessageChain[] = [
            {
                type: "Source",
                id: msgid
            }
        ];

        for (const element of elements) {
            if (element.type === "text") {
                chains.push({
                    type: "Plain",
                    text: element.attrs.content
                })
            } else if (element.type === "at") {
                // TODO: icalingua++ at not working
                chains.push({
                    type: "At",
                    target: element.attrs.id
                })
            } else if (element.type === "quote") {
                // TODO: quote not working.
                // need a way to get quoted message id.
                // Fix: No longer required for OneBot.
                chains.push({
                    type: "Quote",
                    id: element.attrs.id
                })
            } else if (element.type === "img" || element.type === "image") {
                chains.push({
                    type: "Image",
                    url: element.attrs.src
                })
            } else if (element.type === "forward") {
                if (disableForward) {
                    chains.push({
                        type: "Plain",
                        text: "[嵌套转发消息]"
                    })
                } else {
                    const forwardId = element.attrs.id;
                    const bot = (this.bot.internal as any as Internal);
                    const req = (await bot._request!("get_forward_msg", { message_id: `${forwardId}` }));
                    console.log(req);
                    const forwardMsg = req.data.messages;
                    const nodeList: MockForward["nodeList"] = [];
                    for (const msg of forwardMsg) {
                        const elements = napcatToSatori(msg.message);
                        console.log("Forwarding", msg);
                        const subChain: MockMessageChain[] = await this.untranslateMessageChain("FORWARDED", elements, true);

                        nodeList.push({
                            senderName: msg.sender.nickname,
                            messageChain: subChain
                        })
                    }
                    chains.push({
                        type: "Forward",
                        nodeList
                    })
                }

            }
        }
        console.log("chains", chains);
        return chains;
    }
    async translateMessageChain(chains: MockMessageChain[]): Promise<KE[]> {
        const elements: KE[] = [];

        for (const chain of chains) {
            if (chain.type === "Plain") {
                elements.push(KE.text(chain.text));
            } else if (chain.type === "At") {
                elements.push(KE.at(chain.target));
            } else if (chain.type === "Quote") {
                elements.push(KE.quote(chain.id));
            } else if (chain.type === "ForwardOnebot") {

                // should not exist.
                // elements.push(KE.text("[转发消息]"))
            } else if (chain.type === "Image") {
                elements.push(KE.image(chain.buffer!, chain.mime!));
            } else if (chain.type === "Source") {
                //elements.push(KE.text("[源消息]"));
            }
        }

        return elements;
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
        const chain: MockMessageChain[] = [{
            type: "Quote",
            id: quote
        }, ...msg];
        console.log("sendQuotedGroupMessage", chain);

        const message = await this.bot.sendMessage(`${group}`, await this.translateMessageChain(
            chain), `${group}`);
        return { messageId: Number(message[0]) };
    }
    async sendGroupMessage(
        msg: MockMessageChain[] | string,
        group: number,
    ): Promise<{ messageId: number }> {
        if (typeof msg === "string") {
            return this.sendGroupMessage([Plain(msg)], group);
        }
        const chain = await this.translateMessageChain(msg);
        //console.log("Sending", chain)
        const message = await this.bot.sendMessage(`${group}`, chain, `${group}`);
        console.log(message);
        //console.log("Sent")
        return { messageId: Number(message[0]) };
    }
    async uploadImage(image: Buffer, target: MockGroupTarget): Promise<image> {
        return image;
    }
    async recall(msgid: string, groupid: string) {
        const bot = (this.bot.internal as any as Internal);
        const req = (await bot._request!("delete_msg", { message_id: Number(msgid) }));
        console.log(req);
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

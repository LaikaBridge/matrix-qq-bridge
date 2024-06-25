import { EventEmitter } from "node:events";
import satori from "@satorijs/adapter-satori";
import discord from "@satorijs/adapter-discord"
import schema from "@cordisjs/schema"
import http from "@cordisjs/plugin-http"
import { Context, Element as KE, ForkScope, Logger } from "koishi";
import type { GroupTarget, MessageChain } from "node-mirai-sdk";
type image = Buffer;
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
 
        ctx.inject(["schema"], (ctx)=>{
            ctx.plugin(http);
        });
        
        ctx.inject(["http"], (ctx)=>{
            ctx.plugin(satori, {
                endpoint: config.host,
                token: config.verifyKey,
            });
        });
        
        //console.log(satori)
        ctx.on("message", (msg)=>{
            if(!msg.event.guild){
                return;
            }
            if(msg.type==="message-created"){
                return;
            }
            const msgchain = this.untranslateMessageChain(msg.event.message?.id ?? "UNMAPPED", msg.content??"");
            console.log(msg);
            const msg2: {
                type: "GroupMessage";
                sender: MockGroupSender;
                messageChain: MockMessageChain[];
            } = {
                type: "GroupMessage",
                sender: {
                    id: Number(msg.event.user?.id ?? "0"),
                    memberName: msg.author.nick ?? msg.author.name ?? "",
                    group: {
                        id: Number(msg.event.guild.id),
                        name: msg.event.guild.name??""
                    }
                },
                messageChain: msgchain
            }
            this.emit("message", msg2);
        })

        
    }
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
    get bot(){
        const bots = this.ctx.get("satori")?.bots ?? [];
        return bots[0];
    }
    async listen(g: "group") {
        await this.ctx.start();
       
        while(1){
            if(this.bot) break;
            await new Promise((resolve)=>{
                setTimeout(resolve, 1000);
            });
        }
        this.ev.emit("authed");
        console.log("Koishi ready.")
        /*
        await this.sendQuotedGroupMessage([
            Plain("你好世界")
        ], 703596130, "7458692580116697144");
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
            messageId: number;
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
    untranslateMessageChain(msgid: string, content: string): MockMessageChain[]{
        const elements = KE.parse(content);
        console.log(elements);
        const chains: MockMessageChain[] = [
            {
                type: "Source",
                id: msgid
            }
        ];
        
        for(const element of elements){
            if(element.type === "text"){
                chains.push({
                    type: "Plain",
                    text: element.attrs.content
                })
            }else if(element.type === "at"){
                // TODO: icalingua++ at not working
                chains.push({
                    type: "At",
                    target: element.attrs.id
                })
            }else if(element.type === "quote"){
                // TODO: quote not working.
                // need a way to get quoted message id.
                for(const e of element.children){
                    if(e.type==="author"){
                        chains.push(Plain("[回复 "), At(e.attrs.id), Plain("]"));
                    }
                }
                /*
                chains.push({
                    type: "Quote",

                    id: element.attrs["chronocat:seq"] ?? element.attrs.id
                })*/
            }else if(element.type ==="img"){
                chains.push({
                    type: "Image",
                    url: element.attrs.src
                })
            }
        }
        
        return chains;
    }
    translateMessageChain(chains: MockMessageChain[]): KE[]{
        const elements: KE[] = [];

        for(const chain of chains){
            if(chain.type === "Plain"){
                elements.push(KE.text(chain.text));
            }else if(chain.type==="At"){
                elements.push(KE.at(chain.target));
            }else if(chain.type==="Quote"){
                elements.push(KE.quote(chain.id));
            }else if(chain.type==="Forward"){
                // should not exist.
                // elements.push(KE.text("[转发消息]"))
            }else if(chain.type==="Image"){
                elements.push(KE.image(chain.buffer!, "image/png"));
            }else if(chain.type==="Source"){
                //elements.push(KE.text("[源消息]"));
            }
        }

        return elements;
    }
    async sendQuotedGroupMessage(
        msg: MockMessageChain[],
        group: number,
        quote: string,
    ): Promise<{ messageId: number }> {
        const chain : MockMessageChain[] = [{
            type: "Quote",
            id: quote
        }, ...msg];
        const message = await this.bot.sendMessage(`${group}`, this.translateMessageChain(
            chain), `${group}`);
        return {messageId: Number(message[0])};
    }
    async sendGroupMessage(
        msg: MockMessageChain[] | string,
        group: number,
    ): Promise<{ messageId: number }> {
        if(typeof msg === "string"){
            return this.sendGroupMessage([Plain(msg)], group);
        }
        const chain = this.translateMessageChain(msg);
        //console.log("Sending", chain)
        const message = await this.bot.sendMessage(`${group}`, chain , `${group}`);
        console.log(message);
        //console.log("Sent")
        return {messageId: Number(message[0])};
    }
    async uploadImage(image: Buffer, target: MockGroupTarget): Promise<image> {
        return image;
    }
    async recall(msgid: number, groupid: number) {
    }
}

export type MockMessageChain = MockForward | MockQuote | MockPlain | MockAt | MockSource | MockImage;
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
}
export interface MockGroupTarget {
    type: "GroupMessage",
    sender: {
        group: {
            id: number
        }
    }
}
export function Plain(s: string): MockMessageChain{
    return {
        type: "Plain",
        text: s
    }
}
export function At(q: number): MockMessageChain{
    return {
        type: "At",
        target: q
    }
}
export function Image(image: image): MockMessageChain{
    return {
        type: "Image",
        buffer: image
    }
}
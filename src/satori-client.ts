import { EventEmitter } from "node:events";
import satori from "@satorijs/adapter-satori";
import { Context } from "@satorijs/core";
import type { GroupTarget, MessageChain } from "node-mirai-sdk";
import type { image } from "node-mirai-sdk/types/src/MessageComponent";
import type { GroupSender } from "node-mirai-sdk/types/src/typedef";
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
        return (await this.ctx.bots[0].getFriendList()).data;
    }
    constructor(config: {
        host: string;
        verifyKey: string;
        qq: number;
        enableWebsocket: boolean;
        wsOnly: boolean;
    }) {
        const ctx = (this.ctx = new Context());
        this.ev = new EventEmitter();
        ctx.plugin(satori, {
            endpoint: config.host,
            token: config.verifyKey,
        });
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
            messageId: number;
        }) => void,
    ): void;
    onEvent(event: string, f: Function): void {
        this.ev.on(event, f as any);
    }
    async listen(g: "group") {
        await this.ctx.start();
        this.ev.emit("authed");
    }
    onMessage(
        f: (message: {
            type: "GroupMessage";
            sender: GroupSender;
            messageChain: MessageChain[];
        }) => void,
    ): void {
        this.ev.on("message", f as any);
    }

    emit(
        ev: "message",
        msg: {
            type: "GroupMessage";
            sender: GroupSender;
            messageChain: MessageChain[];
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
        return { nickname: "LAIKA_MOCK" };
        //this.ctx.get("guild.member.list")
    }

    async release() {
        this.ev.removeAllListeners();
        await this.ctx.stop();
    }
    async sendQuotedGroupMessage(
        msg: MessageChain[],
        group: number,
        quote: number,
    ): Promise<{ messageId: number }> {
        return { messageId: 0 };
    }
    async sendGroupMessage(
        msg: MessageChain[] | string,
        group: number,
    ): Promise<{ messageId: number }> {
        return { messageId: 0 };
    }
    async uploadImage(image: Buffer, target: GroupTarget): Promise<image> {
        return { imageId: "a" };
    }
    async recall(msgid: number, groupid: number) {}
}

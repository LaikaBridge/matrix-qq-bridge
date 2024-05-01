import type { ClientKillFilters } from "@redis/client/dist/lib/commands/CLIENT_KILL.d.ts";
import NodeMirai from "node-mirai-sdk";
const { MessageComponent: MiraiMsg } = NodeMirai;
import type { EventMap } from "node-mirai-sdk/types/src/events.d.ts";
import type {
    ForwardNode,
    ForwardNodeList,
    GroupSender,
    message,
} from "node-mirai-sdk/types/src/typedef.d.ts";
import { type RedisClientType, createClient } from "redis";
import { type Config, readConfig } from "../config.ts";
import { createLogger } from "../log.ts";
import type {
    ForwardedMessageLine,
    IncomingMessage,
    InlineMessage,
    InlineMessageComponent,
    MessageBlock,
    MessageId,
    Quote,
} from "../model/qq/incoming.ts";
import type { OutgoingMessage } from "../model/qq/outgoing.ts";
import { Consumer, InterruptedError, Producer } from "./messageQueue.ts";
import throttledQueue from "./throttledQueue";

import Mirai, { type GroupTarget, type MessageChain } from "node-mirai-sdk";
import * as wtf from "wtfnode";
import { AsyncTaskQueue } from "./asyncTaskQueue.ts";

const logger = createLogger(import.meta);

export class QQBroker {
    outgoingQueue: Consumer<OutgoingMessage>;
    incomingQueue: Producer<IncomingMessage>;
    outgoingRedisClient: RedisClientType;
    incomingRedisClient: RedisClientType;
    terminated: boolean = false;
    config: Config;
    bot: Mirai;
    incomingPending: AsyncTaskQueue;
    outgoingPending: AsyncTaskQueue;
    outgoingThrottler: ReturnType<typeof throttledQueue>;
    private constructor(config: Config) {
        this.outgoingRedisClient = createClient({
            url: config.redisConfig.connString,
        });
        this.outgoingRedisClient.on("error", (err) => {
            console.log(err);
        });
        this.incomingRedisClient = this.outgoingRedisClient.duplicate();

        this.outgoingQueue = new Consumer(
            this.outgoingRedisClient,
            `${config.redisConfig.namespace}-qqOutgoingQueue`,
        );
        this.incomingQueue = new Producer(
            this.incomingRedisClient,
            `${config.redisConfig.namespace}-qqIncomingQueue`,
        );
        this.incomingPending = new AsyncTaskQueue();
        this.outgoingPending = new AsyncTaskQueue();
        this.config = config;
        this.bot = new Mirai({
            host: config.mirai.host,
            // mirai-api-http-2.x
            verifyKey: config.mirai.verifyKey,
            qq: config.mirai.qq,
            enableWebsocket: false,
            wsOnly: false,
        });
        this.outgoingThrottler = throttledQueue(1, 1000);

        this.installHooks();
    }
    installHooks() {
        this.bot.onSignal("authed", () => {
            logger.info(`Authed with session key ${this.bot.sessionKey}`);
            this.bot.verify();
        });

        this.bot.onSignal("verified", async () => {
            logger.info(`Verified with session key ${this.bot.sessionKey}`);
            const friendList = await this.bot.getFriendList();
            logger.info(`There are ${friendList.length} friends in bot`);
            this.startOutgoing();
        });
        this.bot.onEvent("groupRecall", async (ev) => {
            await this.onRecall(ev);
        });
        this.bot.onEvent("memberCardChange", async (ev) => {});
        this.bot.onMessage(async (message) => {
            if (message.type === "GroupMessage") {
                return await this.onGroupMessage(message);
            }
        });
    }
    static async create(config: Config) {
        const broker = new QQBroker(config);
        logger.info("Connecting to Mirai...");
        await broker.bot.listen("group");
        logger.info("Connecting to Redis...");
        await broker.outgoingRedisClient.connect();
        await broker.incomingRedisClient.connect();

        return broker;
    }

    async handleForward(
        forward: ForwardNodeList,
    ): Promise<ForwardedMessageLine[]> {
        const lines: ForwardedMessageLine[] = [];
        for (const line of forward) {
            const senderId = line.senderId;
            const senderString = line.senderName;
            lines.push({
                senderId,
                senderString,
                content: await this.parseMessageBlock(line.messageChain, true),
            });
        }
        return lines;
    }
    async parseMessageBlock(
        chain: MessageChain[],
        allowSourceless: boolean = false,
    ): Promise<MessageBlock> {
        let quoting: Quote | null = null;
        let source: MessageId | null = null;
        const lines: InlineMessageComponent[] = [];
        logger.debug(`parsing ${JSON.stringify(chain)}`);
        for (const msg of chain) {
            if (msg.type === "Source") {
                if (source !== null) {
                    logger.error(
                        "Two Source Messages detected in MessageChain!",
                    );
                }
                source = msg.id!;
            }
            if (msg.type === "Quote") {
                if (quoting !== null) {
                    logger.error("Two Quotes detected in MessageChain!");
                }
                if (msg.id === undefined) {
                    logger.error("Quote Message ID is undefined!");
                }
                const msgQuote = msg as unknown as typeof msg & {
                    targetId: number;
                };
                if (msgQuote.targetId === 0 && msgQuote.groupId === 0) {
                    quoting = {
                        type: "quoteOffline",
                        quoted: await this.parseMessageBlock(
                            [msgQuote.origin!],
                            true,
                        ),
                    };
                } else {
                    quoting = {
                        msgId: msg.id!,
                        type: "quoteOnline",
                    };
                }
            }
        }
        if (source === null && !allowSourceless) {
            logger.error("Source Message not found!");
            throw new Error("Source Message not found!");
        }
        for (const msg of chain) {
            if (msg.type === "Forward") {
                const serializedFwd = await this.handleForward(msg.nodeList);
                return {
                    messageId: source,
                    forwardedLines: serializedFwd,
                    // Quoting not supported.
                    type: "forwarded",
                };
            }
        }
        for (const msg of chain) {
            if (msg.type === "Plain") {
                lines.push({
                    type: "text",
                    data: msg.text ?? "",
                });
            } else if (msg.type === "At") {
                if (msg.target === undefined) {
                    logger.error("At Message Target is undefined!");
                }
                lines.push({
                    type: "at",
                    qq: msg.target ?? -1,
                    name: msg.display ?? "",
                });
            } else if (msg.type === "Image") {
                lines.push({
                    type: "image",
                    url: msg.url ?? "",
                });
            } else if (msg.type === "Source" || msg.type === "Quote") {
                // ignore
            } else {
                lines.push({
                    type: "unknown",
                    placeholder: msg.type ?? "Unknown",
                });
            }
        }
        return {
            quoting,
            messages: lines,
            messageId: source,
            type: "inline",
        };
    }
    static summarizeIncomingMessage(msg: IncomingMessage): string {
        const parts: string[] = [];
        if (msg.type === "retract") {
            parts.push(
                `[Group:${msg.group}] Message ${msg.retractedId} is retracted.`,
            );
        } else if (msg.type === "message") {
            parts.push(
                `[Group:${msg.metadata.group}][QQ:${msg.metadata.qq}]${msg.metadata.senderNickname}: `,
            );
            if (msg.message.type === "inline") {
                for (const component of msg.message.messages) {
                    if (component.type === "text") {
                        parts.push(component.data);
                    } else if (component.type === "at") {
                        parts.push(`@[${component.qq}]${component.name}`);
                    } else if (component.type === "image") {
                        parts.push(`[Image:${component.url}]`);
                    } else {
                        parts.push(`[Unknown:${component.placeholder}]`);
                    }
                }
            } else if (msg.message.type === "forwarded") {
                parts.push("[Forwarded Message]");
            } else {
                parts.push("[Unknown message]");
            }
        }

        return parts.join("");
    }

    async pushIncomingMessage(msg: IncomingMessage) {
        logger.verbose(`${QQBroker.summarizeIncomingMessage(msg)}`);
        await this.incomingQueue.push(msg);
    }
    // qq -> broker -> incomingQueue
    async onRecall(recallEvent: EventMap["groupRecall"]) {
        const [ready, commit] = this.incomingPending.enroll();
        await ready;
        await this.pushIncomingMessage({
            type: "retract",
            group: recallEvent.group.id,
            retractedId: recallEvent.messageId,
        });
        commit();
    }
    async onGroupMessage(message: message) {
        const [ready, commit] = this.incomingPending.enroll();
        const sender = message.sender as GroupSender;
        const serializeMsg: IncomingMessage = {
            type: "message",
            metadata: {
                group: sender.group.id,
                qq: sender.id,
                senderGlobalname: sender.memberName,
                senderNickname: sender.memberName,
            },
            message: await this.parseMessageBlock(message.messageChain),
        };
        await ready;
        await this.pushIncomingMessage(serializeMsg);
        commit();
    }
    async throttleOutgoing() {
        return new Promise<void>((resolve) => {
            this.outgoingThrottler(resolve);
        });
    }
    async startOutgoing() {
        logger.info("Outgoing queue started.");
        while (!this.terminated) {
            const nextOut = await this.outgoingQueue.next().catch((err) => {
                if (err instanceof InterruptedError && this.terminated) {
                    logger.info("Outgoing queue terminating.");
                    return null;
                } else {
                    throw err;
                }
            });
            if (nextOut === null) {
                break;
            }
            try {
                await this.throttleOutgoing();
                await this.handleOutgoing(nextOut[1]);
            } catch (err) {
                logger.error(`Failed to send message: ${err}`);
                logger.error(`MessageKey: ${JSON.stringify(nextOut[0])}`);
                logger.error(`Message: ${JSON.stringify(nextOut[1])}`);
                logger.error(`Caused by: ${err}`);
            }
            this.outgoingQueue.commit(nextOut[0]);
        }
        logger.info("Outgoing queue terminated.");
    }
    // qq <- broker <- outgoingQueue
    async handleOutgoing(msg: OutgoingMessage) {
        //const [ready, commit] = this.outgoingPending.enroll();
        // construct msgchain
        const messageChain: MessageChain[] = [];
        if (msg.metadata.quoting !== undefined) {
            messageChain.push(MiraiMsg.Quote(msg.metadata.quoting));
        }
        for (const part of msg.components) {
            if (part.type === "text") {
                messageChain.push(MiraiMsg.Plain(part.data));
            } else if (part.type === "at") {
                messageChain.push(MiraiMsg.At(part.qq));
            } else if (part.type === "image") {
                messageChain.push(
                    MiraiMsg.Image({
                        url: part.url,
                    }),
                );
            }
        }
        //await ready;
        const sentMessage = await this.bot.sendGroupMessage(
            messageChain,
            msg.metadata.group,
        );
        logger.debug(
            `Send message ${sentMessage.msg}, id=${sentMessage.msg}, code = ${sentMessage.messageId}`,
        );
        //commit();
    }

    lastCtrlCTime: number = 0;
    async shutdown() {
        if (this.terminated) {
            const now = new Date().getTime();
            if (now - this.lastCtrlCTime >= 1000) {
                logger.warn("QQ Broker already terminating...");
                logger.warn(
                    "Press Ctrl+C again in 1 second to force termination.",
                );
                this.lastCtrlCTime = now;
                return;
            } else {
                logger.warn("QQ Broker force terminating...");
                process.exit(1);
            }
        }
        logger.info("QQ Broker graceful shutdown.");
        this.terminated = true;
        logger.info("Shutting down QQ Bot...");
        await this.bot.release();
        logger.info("Shutting down Redis Client...");
        await this.outgoingRedisClient.disconnect();
        await this.incomingRedisClient.disconnect();
        await this.incomingPending.terminate();
        await this.outgoingPending.terminate();
        logger.info("Shutdown complete.");
        //wtf.dump();
        // setInterval is leaked. Can exit safely.
        process.exit(0);
    }
}

(async function main() {
    const config = readConfig();
    const broker = await QQBroker.create(config);
    logger.info("QQ Broker initialized.");
    const gracefulShutdown = async () => {
        await broker.shutdown();
    };
    process.on("SIGINT", gracefulShutdown);
})();

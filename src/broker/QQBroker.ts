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
import { type Config, readConfig } from "../utils/config.ts";
import { createLogger } from "../utils/log.ts";
import { Consumer, InterruptedError, Producer } from "../utils/messageQueue.ts";
import throttledQueue from "../utils/throttledQueue.ts";

import { writeFile } from "node:fs/promises";
import { uuidV4 } from "data-structure-typed";
import Mirai, { type GroupTarget, type MessageChain } from "node-mirai-sdk";
import * as wtf from "wtfnode";
import type {
    Task,
    TaskFetchImage,
    TaskResponse,
    TaskUploadImage,
} from "../model/qq/tasks.ts";
import { AsyncTaskQueue } from "../utils/asyncTaskQueue.ts";
import { downloadMimedFile } from "../utils/downloader.ts";
import {
    MimedFilePath,
    guessMime,
    mimedFilePath,
    writeMimedFile,
} from "../utils/mime.ts";
import { RetryLimitExceededError, retry } from "../utils/retry.ts";
import { Service } from "../utils/service.ts";

const logger = createLogger(import.meta);

export class QQBroker extends Service {
    outgoingQueue: Consumer<OutgoingMessage>;
    incomingQueue: Producer<IncomingMessage>;
    config: Config;
    bot: Mirai;
    incomingPending: AsyncTaskQueue;
    outgoingPending: AsyncTaskQueue;

    taskQueue: Consumer<Task>;
    taskResponseQueue: Producer<TaskResponse>;
    outgoingThrottler: ReturnType<typeof throttledQueue>;
    private constructor(config: Config) {
        super();
        const redisClient: RedisClientType = createClient({
            url: config.redisConfig.connString,
        });
        redisClient.on("error", (err) => {
            console.log(err);
        });

        this.outgoingQueue = new Consumer(
            redisClient,
            config.redisNames.QQ_OUTGOING_QUEUE,
        );
        this.incomingQueue = new Producer(
            redisClient,
            config.redisNames.QQ_INCOMING_QUEUE,
        );
        this.incomingPending = new AsyncTaskQueue();
        this.outgoingPending = new AsyncTaskQueue();

        this.taskQueue = new Consumer(
            redisClient,
            config.redisNames.QQ_TASK_QUEUE,
        );
        this.taskResponseQueue = new Producer(
            redisClient,
            config.redisNames.QQ_TASK_RESPONSE_QUEUE,
        );
        this.config = config;
        this.bot = new Mirai({
            host: config.mirai.host,
            // mirai-api-http-2.x
            verifyKey: config.mirai.verifyKey,
            qq: config.mirai.qq,
            enableWebsocket: false,
            wsOnly: false,
        });
        this.setLogger(logger);
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
            this.startTaskHandler();
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

    async connect() {
        logger.info("Connecting to Mirai...");
        await this.bot.listen("group");
        logger.info("Connecting to Redis...");
        await this.outgoingQueue.connect();
        await this.incomingQueue.connect();
        await this.taskQueue.connect();
        await this.taskResponseQueue.connect();

        this.enableGracefulShowdown();
    }
    static async create(config: Config) {
        const broker = new QQBroker(config);
        await broker.connect();

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
            uuid: uuidV4(),
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
            uuid: uuidV4(),
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
                        imageId: part.imageId,
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
            `Sent message ${sentMessage.msg}, id=${sentMessage.msg}, code = ${sentMessage.code} messageId = ${sentMessage.messageId}`,
        );
        await this.taskResponseQueue.push({
            type: "messageSent",
            uuid: msg.metadata.uuid,
            messageId: sentMessage.messageId,
        });
        //commit();
    }

    async handleFetchImage(task: TaskFetchImage) {
        const image = await downloadMimedFile(task.uuid, task.url);
        if (image === null) {
            this.logger.error("Failed to download image!");
            await this.taskResponseQueue.push({
                type: "fetchImageResponse",
                uuid: task.uuid,
                response: {
                    type: "error",
                    reason: `图片 [UUID=${task.uuid}] 下载失败`,
                },
            });
            return;
        }
        await this.taskResponseQueue.push({
            type: "fetchImageResponse",
            uuid: task.uuid,
            response: {
                type: "success",
                path: image,
            },
        });
    }
    async handleUploadImage(task: TaskUploadImage) {
        this.logger.info(
            `Uploading image [UUID=${task.file.uuid}, mime=${task.file.mime}] to group ${task.group}...`,
        );
        const target: GroupTarget = {
            type: "GroupMessage",
            sender: {
                group: {
                    id: task.group,
                },
            },
        };
        try {
            const image = await retry(async () => {
                await this.throttleOutgoing();
                return await this.bot.uploadImage(
                    mimedFilePath(task.file),
                    target,
                );
            });
            this.logger.info(
                `Image [UUID=${task.file.uuid}] uploaded successfully.`,
            );
            this.logger.debug(`ImageID = ${image.imageId}, URL = ${image.url}`);
            await this.taskResponseQueue.push({
                type: "uploadImageResponse",
                uuid: task.file.uuid,
                response: {
                    type: "success",
                    imageId: image.imageId,
                    url: image.url,
                },
            });
            this.logger.debug("Response sent.");
        } catch (err) {
            logger.error(`Failed to upload image: ${err}`);
            await this.taskResponseQueue.push({
                type: "uploadImageResponse",
                uuid: task.file.uuid,
                response: {
                    type: "error",
                    reason: `图片 [UUID=${task.file.uuid}] 上传失败: ${err}`,
                },
            });
            return;
        }
    }
    async startTaskHandler() {
        while (!this.terminated) {
            const nextTask = await this.taskQueue
                .nextWithCommit()
                .catch((err) => {
                    if (err instanceof InterruptedError && this.terminated) {
                        logger.info("Task handler queue terminating.");
                        return null;
                    } else {
                        throw err;
                    }
                });
            if (nextTask === null) {
                break;
            }
            const [task, commit_] = nextTask;
            const commit = async () => {
                await commit_();
                this.logger.debug(`Task committed: ${JSON.stringify(task)}`);
            };
            if (task.type === "fetchImage") {
                this.handleFetchImage(task).then(commit);
            } else if (task.type === "uploadImage") {
                this.handleUploadImage(task).then(commit);
            } else {
                logger.error("Unknown task", task);
                await commit();
            }
        }
        logger.info("Task handler queue terminated.");
    }
    desc() {
        return "QQ Broker";
    }
    async shutdown() {
        logger.info("Shutting down QQ Bot...");
        await this.bot.release();
        logger.info("Shutting down Redis Client...");
        await this.incomingQueue.terminate();
        await this.outgoingQueue.terminate();
        await this.taskQueue.terminate();
        await this.taskResponseQueue.terminate();
        await this.incomingPending.terminate();
        await this.outgoingPending.terminate();
        logger.info("Shutdown complete.");
        //wtf.dump();
        // setInterval is leaked. Can exit safely.
        process.exit(0);
    }
}

import http from "node:http";
import https from "node:https";
import { escape, unescape } from "html-escaper";
import Jimp from "jimp";
import {
    AppServiceRegistration,
    Bridge,
    Cli,
    type Intent,
    MembershipCache,
    type PowerLevelContent,
    type UserMembership,
} from "matrix-appservice-bridge";
import type { MatrixProfileInfo } from "matrix-bot-sdk";
import fetch from "node-fetch";
import { HTMLElement, type Node, TextNode, parse } from "node-html-parser";
import { LocalStorage } from "./storage";
import Mirai from "node-mirai-sdk";
import { SocksProxyAgent } from "socks-proxy-agent";
import throttledQueue from "throttled-queue";
import { readConfig } from "./config";
import { MiraiSatoriAdaptor } from "./satori-client";
import { MockMessageChain as MessageChain, MockGroupTarget as GroupTarget, MockGroupSender as GroupSender } from "./satori-client";
import sharp from "sharp"
import ffmpeg from "fluent-ffmpeg"
import concatStream from "concat-stream"
import { Plain, At, Image } from "./satori-client";
import { SUPPORTED_MIMES, convertToMX, convertToQQ, guessMime } from "./image-convert";

const config = readConfig();

const localStorage = new LocalStorage("./extra-storage-sqlite.db");

const BOT_UPDATE_VERSION = 1;

const colors = {
    "🔴": rgb2lab([221, 46, 68]),
    "🔵": rgb2lab([85, 172, 238]),
    "🟠": rgb2lab([244, 144, 12]),
    "🟡": rgb2lab([253, 203, 88]),
    "🟢": rgb2lab([120, 177, 89]),
    "🟣": rgb2lab([170, 142, 214]),
    "🟤": rgb2lab([193, 105, 79]),
    "⚫": rgb2lab([49, 55, 61]),
    "⚪": rgb2lab([230, 231, 232]),
};

//converse rgb to lab
function rgb2lab(rgb: number[]): number[] {
    let r = rgb[0] / 255,
        g = rgb[1] / 255,
        b = rgb[2] / 255,
        x,
        y,
        z;
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.0;
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    x = x > 0.008856 ? Math.pow(x, 1 / 3) : 7.787 * x + 16 / 116;
    y = y > 0.008856 ? Math.pow(y, 1 / 3) : 7.787 * y + 16 / 116;
    z = z > 0.008856 ? Math.pow(z, 1 / 3) : 7.787 * z + 16 / 116;
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function cie94(labA: number[], labB: number[]) {
    var deltaL = labA[0] - labB[0];
    var deltaA = labA[1] - labB[1];
    var deltaB = labA[2] - labB[2];
    var c1 = Math.sqrt(labA[1] * labA[1] + labA[2] * labA[2]);
    var c2 = Math.sqrt(labB[1] * labB[1] + labB[2] * labB[2]);
    var deltaC = c1 - c2;
    var deltaH = deltaA * deltaA + deltaB * deltaB - deltaC * deltaC;
    deltaH = deltaH < 0 ? 0 : Math.sqrt(deltaH);
    var sc = 1.0 + 0.045 * c1;
    var sh = 1.0 + 0.015 * c1;
    var deltaLKlsl = deltaL / 1.0;
    var deltaCkcsc = deltaC / sc;
    var deltaHkhsh = deltaH / sh;
    var i =
        deltaLKlsl * deltaLKlsl +
        deltaCkcsc * deltaCkcsc +
        deltaHkhsh * deltaHkhsh;
    return i < 0 ? 0 : Math.sqrt(i);
}

let agent: SocksProxyAgent | any | undefined = undefined;

if (config.socksProxy.enable) {
    agent = new SocksProxyAgent(config.socksProxy.url);
} else {
    const https_agent = new https.Agent({
        family: 4,
    });
    const http_agent = new http.Agent({
        family: 4,
    });
    agent = (url: URL) => {
        if (url.protocol.includes("https")) {
            return https_agent;
        } else {
            return http_agent;
        }
    };
}

const throttle = throttledQueue(1, 1000);

const bot = new MiraiSatoriAdaptor({
    host: config.mirai.host,
    // mirai-api-http-2.x
    verifyKey: config.mirai.verifyKey,
    qq: config.mirai.qq,
    enableWebsocket: false,
    wsOnly: false,
});

// auth 认证(*)
bot.onSignal("authed", () => {
    console.log(`Authed with session key ${bot.sessionKey}`);
    bot.verify();
});

// session 校验回调
bot.onSignal("verified", async () => {
    console.log(`Verified with session key ${bot.sessionKey}`);

    // 获取好友列表，需要等待 session 校验之后 (verified) 才能调用 SDK 中的主动接口
    const friendList = await bot.getFriendList();
    console.log(`There are ${friendList.length} friends in bot`);
});


// 退出前向 mirai-http-api 发送释放指令(*)
process.on("exit", () => {
    bot.release();
});

const QQ_MX_MAPPING: [mx: string, qq: number][] = [];
for (const rule of config.bridgedGroups) {
    QQ_MX_MAPPING.push([rule.mx, rule.qq]);
}

function findMxByQQ(qq: number) {
    for (const ent of QQ_MX_MAPPING) {
        if (qq == ent[1]) return ent[0];
    }
    return null;
}
function findQQByMx(mx: string) {
    for (const ent of QQ_MX_MAPPING) {
        if (mx == ent[0]) return ent[1];
    }
    return null;
}

interface MembershipPair {
    membership: UserMembership;
    profile: MatrixProfileInfo;
}
class PersistentIntentBackingStore {
    private memberShipKey(roomId: string, userId: string) {
        return `pibs-membership-${roomId}-${userId}`;
    }
    private powerLevelContentKey(roomId: string) {
        return `pibs-powerlevelcontent-${roomId}`;
    }
    private loadMembership(
        roomId: string,
        userId: string,
    ): MembershipPair | null {
        const item = localStorage.getItem(this.memberShipKey(roomId, userId));
        if (item === null) return null;
        return JSON.parse(item);
    }
    private storeMembership(
        roomId: string,
        userId: string,
        value: MembershipPair,
    ) {
        localStorage.setItem(
            this.memberShipKey(roomId, userId),
            JSON.stringify(value),
        );
    }
    private loadPowerLevelContent(roomId: string): PowerLevelContent | null {
        const item = localStorage.getItem(this.powerLevelContentKey(roomId));
        if (item === null) return null;
        return JSON.parse(item);
    }
    private storePowerLevelContent(roomId: string, value: PowerLevelContent) {
        localStorage.setItem(
            this.powerLevelContentKey(roomId),
            JSON.stringify(value),
        );
    }
    getMembership(roomId: string, userId: string): UserMembership {
        const pair = this.loadMembership(roomId, userId);
        if (!pair) return null;
        return pair.membership;
    }
    getMemberProfile(roomId: string, userid: string): MatrixProfileInfo {
        const pair = this.loadMembership(roomId, userid);
        if (!pair) return {};
        return pair.profile;
    }
    getPowerLevelContent(roomId: string): PowerLevelContent | undefined {
        const val = this.loadPowerLevelContent(roomId);
        return val ?? undefined;
    }
    setMembership(
        roomId: string,
        userId: string,
        membership: UserMembership,
        profile: MatrixProfileInfo,
    ): void {
        this.storeMembership(roomId, userId, {
            membership,
            profile,
        });
    }
    setPowerLevelContent(roomId: string, content: PowerLevelContent): void {
        this.storePowerLevelContent(roomId, content);
    }
}
const INTENT_MEMBERSHIP_STORE = (() => {
    const store = new PersistentIntentBackingStore();
    return {
        getMembership: store.getMembership.bind(store),
        getMemberProfile: store.getMemberProfile.bind(store),
        getPowerLevelContent: store.getPowerLevelContent.bind(store),
        setMembership: store.setMembership.bind(store),
        setPowerLevelContent: store.setPowerLevelContent.bind(store),
    };
})();
console.log(INTENT_MEMBERSHIP_STORE.getMembership);
const launch_date = new Date();
const matrixAdminId = `@${config.matrix.namePrefix}_admin:${config.matrix.domain}`;
const drivingGroups = new Set<string>();
const matrixPuppetId = (id: string | number) =>
    `@${config.matrix.namePrefix}_qq_${id}:${config.matrix.domain}`;
new Cli({
    registrationPath: config.matrix.registration.path,
    generateRegistration: (reg, callback) => {
        const regConfig = config.matrix.registration;
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart(regConfig.localpart);
        reg.addRegexPattern("users", `@${config.matrix.namePrefix}_.*`, true);
        callback(reg);
    },
    run: async (port, config_) => {
        const cache = new MembershipCache();
        const prev_name_dict: Record<
            string,
            Record<string, { name: string; avatar: string }>
        > = {}; // RoomId -> UserId -> RoomNick * RoomAvatar
        // const prev_profile_dict: Record<string, { name: string, avatar: string }> = {}; // UserId -> UserNick * Avatar
        const bridge = new Bridge({
            homeserverUrl: config.matrix.homeserver,
            domain: config.matrix.domain,
            registration: config.matrix.registration.path,
            membershipCache: cache,
            intentOptions: {
                bot: {
                    backingStore: INTENT_MEMBERSHIP_STORE,
                },
                clients: {
                    backingStore: INTENT_MEMBERSHIP_STORE,
                },
            },
            controller: {
                onUserQuery: (queriedUser) => {
                    return {}; // auto-provision users with no additonal data
                },

                onEvent: async (request, context) => {
                    const event = request.getData();
                    if (event.origin_server_ts < launch_date.getTime()) {
                        console.warn("Ignoring event ", event.event_id);
                        return;
                    }

                    console.log(event);
                    const room_id = event.room_id;
                    const qq_id = findQQByMx(room_id);
                    if (qq_id === null) return;
                    const user_id = event.sender;
                    let name = user_id;
                    let avatar = "";
                    const intent = bridge.getIntent(matrixAdminId);
                    // if (prev_profile_dict[user_id] === undefined) {
                    //     try {
                    //         const prof = await intent.getProfileInfo(
                    //             user_id,
                    //             null,
                    //             true,
                    //         );

                    //         let avatar = "";
                    //         if (prof.avatar_url) {
                    //             const img = await Jimp.read(prof.avatar_url);
                    //             let sum = [0, 0, 0];
                    //             for (let x = 0; x < img.getWidth(); x++) {
                    //                 for (let y = 0; y < img.getHeight(); y++) {
                    //                     const color = Jimp.intToRGBA(img.getPixelColor(x, y));
                    //                     sum[0] += color.r;
                    //                     sum[1] += color.g;
                    //                     sum[2] += color.b;
                    //                 }
                    //             }
                    //             sum.map(v => v / img.getWidth() / img.getHeight());
                    //             function distance(a: number[], b: number[]) {
                    //                 const x = a[0] - b[0];
                    //                 const y = a[1] - b[1];
                    //                 const z = a[2] - b[2];
                    //                 return x * x + y * y + z * z;
                    //             }
                    //             avatar = Object.entries(colors).sort(
                    //                 (a, b) => distance(a[1] as number[], sum) - distance(b[1] as number[], sum))[0][0] as string;
                    //         }

                    //         prev_profile_dict[user_id] = {
                    //             name: prof.displayname?.trim() ?? name,
                    //             avatar,
                    //         };
                    //     } catch (ex) {
                    //         console.log(ex);
                    //     }
                    // }
                    async function getAvatarByMxUrl(
                        mxurl?: string,
                    ): Promise<string> {
                        if (!mxurl) return "";
                        const url = intent.matrixClient.mxcToHttp(mxurl);
                        const req = await fetch(url);
                        const buffer = await req.arrayBuffer();
                        const img = await Jimp.read(Buffer.from(buffer));
                        const colorCount: Record<string, number> = {};
                        for (let x = 0; x < img.getWidth(); x++) {
                            for (let y = 0; y < img.getHeight(); y++) {
                                const { r, g, b, a } = Jimp.intToRGBA(
                                    img.getPixelColor(x, y),
                                );
                                const color256 = [r, g, b].map(
                                    (x) => x * (a / 255) + 255 * (1 - a / 255),
                                );
                                const color16 = color256.map((x) =>
                                    Math.round((x / 255) * 15),
                                );
                                colorCount[JSON.stringify(color16)] =
                                    (colorCount[JSON.stringify(color16)] ?? 0) +
                                    1;
                            }
                        }
                        const rgb16 = Object.entries(colorCount)
                            .map((kv) => {
                                const [k, count] = kv;
                                const [r, g, b]: number[] = JSON.parse(k);
                                return {
                                    color16: [r, g, b],
                                    weight:
                                        /* chroma */ (Math.max(r, g, b) -
                                            Math.min(r, g, b)) *
                                        count,
                                };
                            })
                            .sort((a, b) => a.weight - b.weight)
                            .reverse()[0].color16;
                        const lab = rgb2lab(rgb16.map((x) => (x / 15) * 255));
                        return Object.entries(colors).sort(
                            (a, b) =>
                                cie94(a[1] as number[], lab) -
                                cie94(b[1] as number[], lab),
                        )[0][0] as string;
                    }
                    if (!prev_name_dict[event.room_id])
                        prev_name_dict[event.room_id] = {};
                    const room_prev_name_dict = prev_name_dict[event.room_id];
                    if (room_prev_name_dict[user_id] === undefined) {
                        const profile = cache.getMemberProfile(
                            event.room_id,
                            event.sender,
                        );
                        if (profile.displayname === undefined) {
                            const state = await intent.getStateEvent(
                                room_id,
                                "m.room.member",
                                user_id,
                                true,
                            );
                            room_prev_name_dict[user_id] = {
                                name: state?.displayname?.trim() ?? name,
                                avatar: await getAvatarByMxUrl(
                                    state?.avatar_url,
                                ),
                            };
                        } else {
                            room_prev_name_dict[user_id] = {
                                name: profile.displayname?.trim() ?? name,
                                avatar: await getAvatarByMxUrl(
                                    profile.avatar_url,
                                ),
                            };
                        }
                    }
                    name = room_prev_name_dict[user_id].name ?? name;
                    avatar = room_prev_name_dict[user_id].avatar ?? avatar;
                    name = name || user_id;
                    if (avatar) {
                        name = `${avatar} ${name}`;
                    }
                    //avatar = avatar || "";
                    async function parseQuote() {
                        const l1: any = event.content["m.relates_to"];
                        const l2: any = l1 ? l1["m.in_reply_to"] : undefined;
                        const l3: string | undefined = l2?.event_id;
                        const l4 =
                            l3 === undefined
                                ? l3
                                : await getMatrix2QQMsgMapping(l3);
                        return l4 ?? null;
                    }
                    function htmlToMsgChain(s: string): MessageChain[] {
                        const html = parse(s);
                        const chain: MessageChain[] = [Plain(`${name}: `)];
                        if (
                            html.firstChild instanceof HTMLElement &&
                            html.firstChild?.tagName == "MX-REPLY"
                        ) {
                            html.firstChild.remove();
                        }
                        function onNode(node: Node) {
                            if (node instanceof HTMLElement) {
                                if (
                                    node.tagName == "A" &&
                                    node.attributes?.href?.startsWith(
                                        "https://matrix.to/#/@",
                                    )
                                ) {
                                    const user_id = node.attributes.href.slice(
                                        "https://matrix.to/#/".length,
                                    );
                                    const match = user_id.match(
                                        new RegExp(matrixPuppetId("(\\d+)")),
                                    );
                                    if (match != null) {
                                        const qq: number = Number.parseInt(
                                            match[1],
                                        );
                                        chain.push(At(qq));
                                    } else {
                                        chain.push(Plain("@" + node.text));
                                    }
                                } else if (node.tagName == "BR") {
                                    chain.push(Plain("\n"));
                                } else {
                                    node.childNodes.forEach(onNode);
                                }
                            } else if (node instanceof TextNode) {
                                chain.push(Plain(node.text));
                            }
                        }
                        onNode(html);
                        return chain;
                    }
                    // drive and undrive
                    const driveKey = `is_driving:${event.room_id}`;
                    const isAlreadyDriving = localStorage.getItem(driveKey) === "yes";
                    if (
                        event.type == "m.room.message" &&
                        event.content.msgtype == "m.text"
                    ) {
                        
                        
                        
                        if(event.content.body == "!drive"){
                            if(isAlreadyDriving){
                                intent.sendText(event.room_id, "驾驶模式已经是开启状态！");
                            }else{
                                intent.sendText(event.room_id, "已开启驾驶模式！");
                                localStorage.setItem(driveKey, "yes");
                            }
                            return;
                        }else if(event.content.body == "!undrive"){
                            if(isAlreadyDriving){
                                intent.sendText(event.room_id, "已关闭驾驶模式！");
                                localStorage.setItem(driveKey, "no");
                            }else{
                                intent.sendText(event.room_id, "驾驶模式已经是关闭状态！");
                            }
                            return;
                        }
                    }
                    // not driving
                    if (
                        event.type == "m.room.message" &&
                        event.content.msgtype == "m.text"
                    ) {
                        if(isAlreadyDriving){
                            // driving mode. don't forward to qq.
                            return;
                        }
                        //let quote = null;
                        const l4 = await parseQuote();
                        let msg;
                        if (l4 !== null) {
                            if (
                                event.content.format == "org.matrix.custom.html"
                            ) {
                                const s = event.content
                                    .formatted_body as string;
                                msg = await throttle(async () => {
                                    return await bot.sendQuotedGroupMessage(
                                        htmlToMsgChain(s),
                                        qq_id,
                                        l4[1],
                                    );
                                });
                            } else {
                                const s = event.content.body as string;
                                let lines = s.split("\n");
                                if (
                                    lines[0].startsWith("> ") &&
                                    lines[1] == ""
                                ) {
                                    lines = lines.splice(2);
                                }
                                msg = await throttle(async () => {
                                    return await bot.sendQuotedGroupMessage(
                                        `${name}: ${lines.join("\n")}` as any,
                                        qq_id,
                                        l4[1],
                                    );
                                });
                            }
                        } else {
                            if (
                                event.content.format == "org.matrix.custom.html"
                            ) {
                                const s = event.content
                                    .formatted_body as string;
                                msg = await throttle(async () => {
                                    return await bot.sendGroupMessage(
                                        htmlToMsgChain(s),
                                        qq_id,
                                    );
                                });
                            } else {
                                msg = await throttle(async () => {
                                    return await bot.sendGroupMessage(
                                        `${name}: ${event.content.body}`,
                                        qq_id,
                                    );
                                });
                            }
                        }
                        const source: [string, string] = [
                            String(qq_id),
                            String(msg.messageId),
                        ];
                        const event_id = event.event_id;
                        await addMatrix2QQMsgMapping(event_id, source);
                        await addQQ2MatrixMsgMapping(source, event_id);
                    } else if (
                        event.type == "m.room.message" &&
                        event.content.msgtype == "m.image"
                    ) {
                        if(isAlreadyDriving){
                            // driving mode. don't forward to qq.
                            return;
                        }
                        try {
                            const url = intent.matrixClient.mxcToHttp(
                                event.content.url as string,
                            );
                            const req = await fetch(url);
                            const buffer = await req.arrayBuffer();
                            let msg;
                            const l4 = await parseQuote();
                            const target: GroupTarget = {
                                type: "GroupMessage",
                                sender: {
                                    group: {
                                        id: qq_id,
                                    },
                                },
                            };
                            if (l4) {
                                msg = await throttle(async () => {
                                    const image = await bot.uploadImage(
                                        Buffer.from(buffer),
                                        target,
                                    );
                                    return await bot.sendQuotedGroupMessage(
                                        [Plain(`${name}:`), Image(image)],
                                        qq_id,
                                        l4[1],
                                    );
                                });
                            } else {
                                msg = await throttle(async () => {
                                    const image = await bot.uploadImage(
                                        Buffer.from(buffer),
                                        target,
                                    );
                                    return await bot.sendGroupMessage(
                                        [Plain(`${name}:`), Image(image)],
                                        qq_id,
                                    );
                                });
                            }

                            const source: [string, string] = [
                                String(qq_id),
                                String(msg.messageId),
                            ];
                            const event_id = event.event_id;
                            await addMatrix2QQMsgMapping(event_id, source);
                            await addQQ2MatrixMsgMapping(source, event_id);
                        } catch (err) {
                            console.log(err);
                        }
                        //const url = intent.down
                    } else if (event.type == "m.sticker") {
                        if(isAlreadyDriving){
                            // driving mode. don't forward to qq.
                            return;
                        }
                        /**
                         * 大概解释一下发生了什么
                         * `m.sticker`里面的mimetype不仅可以是静态图，也可以是动态图
                         * (telegram官方预制的表情会直接变成gif而不是转换到mp4发到mx上，原因未知)
                         * 并且没有fi.mau.telegram.animated_sticker字段
                         */
                        try {
                            const url = intent.matrixClient.mxcToHttp(event.content.url as string);
                            const req = await fetch(url);
                            const buf = await req.arrayBuffer();
                            const srcMime = event.content.mimetype as string;
                            const converted = await convertToQQ(Buffer.from(buf));
                            const imgbuf = converted.data;
                            const mime = converted.mime;
                            let msg;
                            const l4 = await parseQuote();
                            const target: GroupTarget = {
                                type: "GroupMessage",
                                sender: {
                                    group: {
                                        id: qq_id,
                                    },
                                },
                            };
                            if (l4) {
                                msg = await throttle(async () => {
                                    const image = await bot.uploadImage(
                                        Buffer.from(imgbuf),
                                        target,
                                    );
                                    return await bot.sendQuotedGroupMessage(
                                        [Plain(`${name}:`), Image(image, mime)],
                                        qq_id,
                                        l4[1],
                                    );
                                });
                            } else {
                                msg = await throttle(async () => {
                                    const image = await bot.uploadImage(
                                        Buffer.from(imgbuf),
                                        target,
                                    );
                                    return await bot.sendGroupMessage(
                                        [Plain(`${name}:`), Image(image, mime)],
                                        qq_id,
                                    );
                                });
                            }

                            const source: [string, string] = [
                                String(qq_id),
                                String(msg.messageId),
                            ];
                            const event_id = event.event_id;
                            await addMatrix2QQMsgMapping(event_id, source);
                            await addQQ2MatrixMsgMapping(source, event_id);
                        } catch (err) {
                            console.log(err);
                        }
                    } else if (event.type == "m.room.message" && ((event.content.info as any)["fi.mau.telegram.animated_sticker"] as boolean) == true) {
                        if(isAlreadyDriving){
                            // driving mode. don't forward to qq.
                            return;
                        }
                        /**
                         * 为啥有的animated sticker转成gif有的转成mp4???
                         */
                        const url = intent.matrixClient.mxcToHttp(event.content.url as string);
                        const req = await fetch(url);
                        const buf = await req.arrayBuffer();
                        const srcMime = event.content.mimetype as string;
                        const converted = await convertToQQ(Buffer.from(buf));
                        const imgbuf = converted.data;
                        const mime = converted.mime;
                        try {
                            const l4 = await parseQuote();
                            let msg;
                            const target: GroupTarget = {
                                type: "GroupMessage",
                                sender: {
                                    group: {
                                        id: qq_id,
                                    },
                                },
                            };
                            if (l4) {
                                msg = await throttle(async () => {
                                    const image = await bot.uploadImage(
                                        imgbuf,
                                        target,
                                    );
                                    return await bot.sendQuotedGroupMessage(
                                        [Plain(`${name}:`), Image(image, mime)],
                                        qq_id,
                                        l4[1],
                                    );
                                });
                            } else {
                                msg = await throttle(async () => {
                                    const image = await bot.uploadImage(
                                        imgbuf,
                                        target,
                                    );
                                    return await bot.sendGroupMessage(
                                        [Plain(`${name}:`), Image(image, mime)],
                                        qq_id,
                                    );
                                });
                            }

                            const source: [string, string] = [
                                String(qq_id),
                                String(msg.messageId),
                            ];
                            const event_id = event.event_id;
                            await addMatrix2QQMsgMapping(event_id, source);
                            await addQQ2MatrixMsgMapping(source, event_id);
                        } catch (error) {
                            console.log(error);
                        }
                    } else if (event.type == "m.room.redaction") {
                        // don't care about drive mode.
                        try {
                            const ev = await getMatrix2QQMsgMapping(
                                event.redacts as string,
                            );
                            if (!ev) return;
                            console.log(ev);
                            await bot.recall(ev[1], ev[0]);
                        } catch (err) {
                            console.log(err);
                        }
                    }
                },
            },
        });

        async function getAvatarUrl(qq: number, intent: Intent) {
            const key = `qq_avatar_${qq}`;
            console.log("t1");
            while (localStorage.getItem(key) === null) {
                try {
                    console.log("t2");
                    const url = `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=140`;
                    const img = await fetch(url, { agent });
                    const buffer = await img.arrayBuffer();
                    console.log("fetched");
                    const content = await intent.uploadContent(
                        Buffer.from(buffer),
                        {
                            name: "avatar.jpg",
                            type: "image/jpeg",
                        },
                    );

                    localStorage.setItem(key, content);
                    console.log("t3");
                } catch (err) {
                    console.log(
                        `Error fetching avatar for ${qq}, retrying`,
                        err,
                    );
                }
            }

            return localStorage.getItem(key);
        }
        function qqmsgStr(msgId: [group: string, id: string]) {
            return `${msgId[0]}|${msgId[1]}`;
        }
        async function addMatrix2QQMsgMapping(
            eventId: string,
            msgId: [group: string, id: string],
        ) {
            console.log(`Mapping ${eventId} to ${qqmsgStr(msgId)}`);
            localStorage.setItem(
                `msgmapping_matrix_to_qq_${eventId}`,
                qqmsgStr(msgId),
            );
        }
        async function addQQ2MatrixMsgMapping(
            msgId: [group: string, id: string],
            eventId: string,
        ) {
            localStorage.setItem(
                `msgmapping_qq_to_matrix_${qqmsgStr(msgId)}`,
                eventId,
            );
        }
        async function getMatrix2QQMsgMapping(
            eventId: string,
        ): Promise<[group: string, id: string] | null> {
            return localStorage
                .getItem(`msgmapping_matrix_to_qq_${eventId}`)
                ?.split("|") as any;
        }
        async function getQQ2MatrixMsgMapping(
            msgId: [group: string, id: string],
        ) {
            return localStorage.getItem(
                `msgmapping_qq_to_matrix_${qqmsgStr(msgId)}`,
            );
        }
        async function joinRoom(bot: string, room_id: string) {
            try {
                const superintent = bridge.getIntent(matrixAdminId);

                try {
                    await superintent;
                } catch (err) { }
                try {
                    await superintent.join(room_id);
                } catch (err) { }
                await superintent.invite(room_id, bot);
            } catch (err) { }
        }
        bot.onEvent("groupRecall", async (message) => {
            const group_id = message.group.id;
            const room_id = findMxByQQ(group_id);
            if (room_id === null) return;
            const user_id = message.authorId;
            const matrix_id = await getQQ2MatrixMsgMapping([
                String(message.group.id),
                String(message.messageId),
            ]);
            if (matrix_id !== null) {
                const key = matrixPuppetId(user_id);
                const intent = bridge.getIntent(key);
                intent.matrixClient.redactEvent(
                    room_id,
                    matrix_id,
                    "撤回了一条消息",
                );
            }
        });
        // 接受消息,发送消息(*)
        bot.onMessage(async (message) => {
            if (message.type == "GroupMessage") {
                const g = message.sender as GroupSender;
                const group_id = g.group.id;
                const mx_id = findMxByQQ(group_id);
                if (mx_id === null) return;
                const { messageChain } = message;
                let msg = "";
                let formatted = "";
                const images: string[] = [];
                console.log(messageChain);
                let quoted: string | null = null;
                let source: string | null = null;
                for (const chain of messageChain) {
                    if (chain.type == "Forward") {
                        const local_msgs: string[] = [];
                        const local_formatted_msgs: string[] = [];
                        for (const node of chain.nodeList) {
                            let local_msg = "";
                            let local_formatted = "";
                            const local_sender = node.senderName;
                            for (const localchain of node.messageChain) {
                                if (localchain.type === "Plain") {
                                    local_msg += localchain.text ?? "";
                                    local_formatted += escape(
                                        localchain.text ?? "",
                                    );
                                } else if (localchain.type === "At") {
                                    local_msg += `@${localchain.display ?? ""}`;
                                    local_formatted += `@${escape(
                                        localchain.display ?? "",
                                    )}`;
                                } else if (localchain.type === "Image") {
                                    local_msg += "[图片]";
                                    local_formatted += "[图片]";
                                } else if (localchain.type === "Forward") {
                                    local_msg += "[转发消息]";
                                    local_formatted += "[转发消息]";
                                }
                            }
                            local_msgs.push(`${local_sender}: ${local_msg}`);
                            local_formatted_msgs.push(
                                `${escape(local_sender)}: ${local_formatted}`,
                            );
                        }
                        msg += local_msgs.join("\n");
                        formatted += `<blockquote>\n<p>${local_formatted_msgs.join(
                            "<br>",
                        )}</p></blockquote>`;
                    }
                }
                for (const chain of messageChain) {
                    if (chain.type == "Quote") {
                        quoted = String(chain.id!);
                    }
                }
                const superintent = bridge.getIntent(matrixAdminId);
                for (const chain of messageChain) {
                    if (chain.type === "Plain") {
                        msg += chain.text; // 从 messageChain 中提取文字内容
                        formatted += escape(chain.text);
                    } else if (chain.type === "At") {
                        if (chain.target! == config.mirai.qq) {
                            // try to find quoted.
                            if (quoted) {
                                const quoted_mx_msg =
                                    await getQQ2MatrixMsgMapping([
                                        String(group_id),
                                        quoted,
                                    ]);
                                if (quoted_mx_msg !== null) {
                                    const sender = await superintent.getEvent(
                                        mx_id,
                                        quoted_mx_msg,
                                        true,
                                    );
                                    if (sender) {
                                        const sender_id: string = sender.sender;
                                        const profile =
                                            await superintent.getStateEvent(
                                                mx_id,
                                                "m.room.member",
                                                sender_id,
                                                true,
                                            );
                                        msg += "@" + profile.displayname;
                                        formatted += `<a href="https://matrix.to/#/${sender_id}">@${escape(
                                            profile.displayname,
                                        )}</a>`;
                                        continue;
                                    }
                                }
                            }

                            msg += "@" + config.puppetCustomization.adminName;
                            formatted += `<a href="https://matrix.to/#/${matrixAdminId}">@${config.puppetCustomization.adminName}</a>`;
                        } else {
                            const id = matrixPuppetId(chain.target!);
                            const profile = await superintent.getStateEvent(
                                mx_id,
                                "m.room.member",
                                id,
                                true,
                            );
                            msg += "@" + profile.displayname;
                            formatted += `<a href="https://matrix.to/#/${id}">@${escape(
                                profile.displayname,
                            )}</a>`;
                        }
                    } else if (chain.type == "Source") {
                        source = String(chain.id!);
                    } else if (chain.type == "Image") {
                        console.log(chain);
                        images.push(chain.url!);
                        //msg+='[图图]';
                    }
                }

                console.log(message.sender);
                const key = matrixPuppetId(g.id);
                const intent = bridge.getIntent(key);
                await joinRoom(key, mx_id);
                const group_profile = await bot.getGroupMemberProfile(
                    g.group.id,
                    g.id,
                );
                const user_profile = await intent.getProfileInfo(
                    key,
                    undefined,
                    false,
                );
                console.log("User", user_profile);
                console.log("Group", group_profile);
                const a = `${group_profile.nickname} (QQ)`;
                const b = (await getAvatarUrl(g.id, intent)) ?? undefined;
                if (user_profile.displayname !== a) {
                    console.log("Reset displayname globally: ignored.");
                    //await intent.setDisplayName(a);
                }
                if (user_profile.avatar_url !== b) {
                    if (b !== undefined) await intent.setAvatarUrl(b);
                }
                console.log("DEBUG", (intent as any).opts);
                const member = await intent.getStateEvent(
                    mx_id,
                    "m.room.member",
                    key,
                    true,
                );
                console.log("Member", member);
                const local_name = `${g.memberName} (QQ)`;
                if (member.displayname !== local_name) {
                    member.displayname = local_name;
                    console.log("Reset displayname locally.");
                    await intent.sendStateEvent(
                        mx_id,
                        "m.room.member",
                        key,
                        member,
                    );
                }
                const member2 = await intent.getStateEvent(
                    mx_id,
                    "m.room.member",
                    key,
                    true,
                );
                console.log("Member after", member2);
                console.log("uploaded");
                if (msg) {
                    const data: any = {
                        body: msg,
                        format: "org.matrix.custom.html",
                        formatted_body: formatted,
                        msgtype: "m.text",
                    };
                    if (quoted !== null) {
                        const orig_mat = await getQQ2MatrixMsgMapping([
                            String(group_id),
                            quoted,
                        ]);
                        if (orig_mat !== null) {
                            data["m.relates_to"] = {
                                "m.in_reply_to": { event_id: orig_mat },
                            };
                        }
                    }
                    const { event_id } = await intent.sendMessage(mx_id, data);
                    const qqsource: [string, string] = [
                        String(group_id),
                        source!,
                    ];
                    await addMatrix2QQMsgMapping(event_id, qqsource);
                    await addQQ2MatrixMsgMapping(qqsource, event_id);
                }

                for (const url of images) {
                    const sending_prompt = intent.sendTyping(mx_id, true);
                    const qqsource: [string, string] = [
                        String(group_id),
                        source!,
                    ];

                    try {
                        const img = await fetch(url, { agent });
                        const buffer = Buffer.from(await img.arrayBuffer());
                        const converted = await convertToMX(buffer);
                        const content = await intent.uploadContent(
                            converted.data
                        );
                        const mimeInfo = SUPPORTED_MIMES[converted.mime];
                        const { event_id } = await intent.sendMessage(mx_id, {
                            msgtype: mimeInfo.matrixMsgType,
                            url: content,
                            body: `QQ图片.${mimeInfo.format}`,
                            info: {
                                mimetype: converted.mime,
                            },
                        });

                        await addMatrix2QQMsgMapping(event_id, qqsource);
                    } catch (err) {
                        const { event_id } = await intent.sendText(
                            mx_id,
                            "Failed to send image: " + url,
                        );
                        await addMatrix2QQMsgMapping(event_id, qqsource);
                    }
                    await sending_prompt;
                }
                await intent.sendTyping(mx_id, false);
            }
        });

        /* 开始监听消息(*)
         * 'all' - 监听好友和群
         * 'friend' - 只监听好友
         * 'group' - 只监听群
         * 'temp' - 只监听临时会话
         */
        await bot.listen("group"); // 相当于 bot.listen('friend', 'group', 'temp')

        console.log(
            "Matrix-side listening on %s:%s",
            config.matrix.listenIP,
            config.matrix.listenPort,
        );
        bridge
            .run(config.matrix.listenPort, undefined, config.matrix.listenIP)
            .then(async () => {
                const intent = bridge.getIntent(matrixAdminId);
                const customizationVersion =
                    config.puppetCustomization.customizationVersion;
                if (
                    Number(
                        localStorage.getItem("CUSTOMIZATION_VERSION") ?? "0",
                    ) < customizationVersion
                ) {
                    await intent.setDisplayName(
                        config.puppetCustomization.adminName,
                    );
                    await intent.setAvatarUrl(
                        config.puppetCustomization.adminAvatar,
                    );
                    localStorage.setItem(
                        "CUSTOMIZATION_VERSION",
                        String(customizationVersion),
                    );
                }
            });
    },
}).run();

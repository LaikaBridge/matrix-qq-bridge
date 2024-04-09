import Mirai, { GroupTarget, MessageChain } from 'node-mirai-sdk';
import {
    Cli,
    Bridge,
    AppServiceRegistration,
    MembershipCache,
    Intent,
    UserMembership,
    PowerLevelContent,
} from 'matrix-appservice-bridge';
import fetch from 'node-fetch';
import { LocalStorage } from 'node-localstorage';
import http from 'node:http';
import https from 'node:https';
import { readConfig } from './config';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { MatrixProfileInfo } from 'matrix-bot-sdk';
import throttledQueue from 'throttled-queue';
import { TextNode, HTMLElement, Node, parse } from 'node-html-parser';
import { escape, unescape } from 'html-escaper';
import Jimp from "jimp";

const { Plain, At, Image } = Mirai.MessageComponent;

const config = readConfig();

const localStorage = new LocalStorage('./extra-storage.db');

const BOT_UPDATE_VERSION = 1;

const colors = {
    "🔴": [221, 46, 68], // [R, G, B]
    "🔵": [85, 172, 238],
    "🟠": [244, 144, 12],
    "🟡": [253, 203, 88],
    "🟢": [120, 177, 89],
    "🟣": [170, 142, 214],
    "🟤": [193, 105, 79],
    "⚫": [49, 55, 61],
    "⚪": [230, 231, 232],
};

// h in radians, c and v in [0, 255], c = v * s
function rgbToHcv(rgb: number[]): number[] {
    const [r, g, b] = rgb;
    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);
    const c = max - min;
    let h;
    if (c == 0) {
        h = 0;
    } else if (r >= g && r >= b) {
        h = (g - b) / c % 6;
    } else if (g >= r && g >= b) {
        h = (b - r) / c + 2;
    } else {
        h = (r - g) / c + 4;
    }
    h *= Math.PI / 3;
    const v = max;
    // const s = v == 0 ? 0 : 255 * c / v;
    return [h, c, v];
}

function hcvDistance(a: number[], b: number[]): number {
    const [h1, c1, v1] = a;
    const [h2, c2, v2] = b;
    const deltav = v1 - v2;
    return c1 * c1 + c2 * c2 + deltav * deltav - 2 * c1 * c2 * Math.cos(h1 - h2);
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
        if (url.protocol.includes('https')) {
            return https_agent;
        } else {
            return http_agent;
        }
    };
}

const throttle = throttledQueue(1, 1000);

const bot = new Mirai({
    host: config.mirai.host,
    // mirai-api-http-2.x
    verifyKey: config.mirai.verifyKey,
    qq: config.mirai.qq,
    enableWebsocket: false,
    wsOnly: false,
});

// auth 认证(*)
bot.onSignal('authed', () => {
    console.log(`Authed with session key ${bot.sessionKey}`);
    bot.verify();
});

// session 校验回调
bot.onSignal('verified', async () => {
    console.log(`Verified with session key ${bot.sessionKey}`);

    // 获取好友列表，需要等待 session 校验之后 (verified) 才能调用 SDK 中的主动接口
    const friendList = await bot.getFriendList();
    console.log(`There are ${friendList.length} friends in bot`);
});

declare type GroupSender = {
    id: number;
    memberName: string;
    specialTitle: string;
    permission: any;
    joinTimestamp: number;
    lastSpeakTimestamp: number;
    group: Mirai.GroupPermissionInfo;
};

// 退出前向 mirai-http-api 发送释放指令(*)
process.on('exit', () => {
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
const INTENT_MEMBERSHIP_STORE = (function () {
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
const matrixPuppetId = (id: string | number) =>
    `@${config.matrix.namePrefix}_qq_${id}:${config.matrix.domain}`;
new Cli({
    registrationPath: config.matrix.registration.path,
    generateRegistration: function (reg, callback) {
        const regConfig = config.matrix.registration;
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart(regConfig.localpart);
        reg.addRegexPattern('users', `@${config.matrix.namePrefix}_.*`, true);
        callback(reg);
    },
    run: function (port, config_) {
        const cache = new MembershipCache();
        const prev_name_dict: Record<string, Record<string, { name: string, avatar: string }>> = {}; // RoomId -> UserId -> RoomNick * RoomAvatar
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
                onUserQuery: function (queriedUser) {
                    return {}; // auto-provision users with no additonal data
                },

                onEvent: async function (request, context) {
                    const event = request.getData();
                    if (event.origin_server_ts < launch_date.getTime()) {
                        console.warn('Ignoring event ', event.event_id);
                        return;
                    }

                    console.log(event);
                    const room_id = event.room_id;
                    const qq_id = findQQByMx(room_id);
                    if (qq_id === null) return;
                    let user_id = event.sender;
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
                    async function getAvatarByMxUrl(mxurl?: string): Promise<string> {
                        if (!mxurl) return "";
                        const url = intent.matrixClient.mxcToHttp(
                            mxurl,
                        );
                        const req = await fetch(url);
                        const buffer = await req.arrayBuffer();
                        const img = await Jimp.read(Buffer.from(buffer));
                        let sum = [0, 0, 0];
                        for (let x = 0; x < img.getWidth(); x++) {
                            for (let y = 0; y < img.getHeight(); y++) {
                                const color = Jimp.intToRGBA(img.getPixelColor(x, y));
                                sum[0] += color.r * (color.a/255);
                                sum[1] += color.g * (color.a/255);
                                sum[2] += color.b * (color.a/255);
                            }
                        }
                        const hcv = rgbToHcv(sum.map(v => v / img.getWidth() / img.getHeight()));
                        return Object.entries(colors).sort(
                            (a, b) => hcvDistance(rgbToHcv(a[1] as number[]), hcv) 
                                    - hcvDistance(rgbToHcv(b[1] as number[]), hcv)
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
                                'm.room.member',
                                user_id,
                                true,
                            );
                            room_prev_name_dict[user_id] = {
                                name: state?.displayname?.trim() ?? name,
                                avatar: await getAvatarByMxUrl(state?.avatar_url)
                            };
                        } else {
                            room_prev_name_dict[user_id] = {
                                name : profile.displayname?.trim() ?? name,
                                avatar : await getAvatarByMxUrl(profile.avatar_url)
                            }
                        }
                    }
                    name = room_prev_name_dict[user_id].name ?? name;
                    avatar = room_prev_name_dict[user_id].avatar ?? avatar;
                    name = name || user_id;
                    if(avatar){
                        name = `${avatar} ${name}`
                    }
                    //avatar = avatar || "";
                    async function parseQuote() {
                        const l1: any = event.content['m.relates_to'];
                        const l2: any = l1 ? l1['m.in_reply_to'] : undefined;
                        const l3: string | undefined = l2?.event_id;
                        const l4 =
                            l3 === undefined
                                ? l3
                                : await getMatrix2QQMsgMapping(l3);
                        return l4 ?? null;
                    }
                    function htmlToMsgChain(s: string): MessageChain[] {
                        const html = parse(s);
                        let chain: MessageChain[] = [Plain(`${name}: `)];
                        if (
                            html.firstChild instanceof HTMLElement &&
                            html.firstChild?.tagName == 'MX-REPLY'
                        ) {
                            html.firstChild.remove();
                        }
                        function onNode(node: Node) {
                            if (node instanceof HTMLElement) {
                                if (
                                    node.tagName == 'A' &&
                                    node.attributes?.href?.startsWith(
                                        'https://matrix.to/#/@',
                                    )
                                ) {
                                    let user_id = node.attributes.href.slice(
                                        'https://matrix.to/#/'.length,
                                    );
                                    let match = user_id.match(
                                        new RegExp(matrixPuppetId('(\\d+)')),
                                    );
                                    if (match != null) {
                                        let qq: number = parseInt(match[1]);
                                        chain.push(At(qq));
                                    } else {
                                        chain.push(Plain('@' + node.text));
                                    }
                                } else if (node.tagName == 'BR') {
                                    chain.push(Plain('\n'));
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
                    if (
                        event.type == 'm.room.message' &&
                        event.content.msgtype == 'm.text'
                    ) {
                        //let quote = null;
                        const l4 = await parseQuote();
                        let msg;
                        if (l4 !== null) {
                            if (
                                event.content.format == 'org.matrix.custom.html'
                            ) {
                                const s = event.content
                                    .formatted_body as string;
                                msg = await throttle(async () => {
                                    return await bot.sendQuotedGroupMessage(
                                        htmlToMsgChain(s),
                                        qq_id,
                                        Number(l4[1]),
                                    );
                                });
                            } else {
                                const s = event.content.body as string;
                                let lines = s.split('\n');
                                if (
                                    lines[0].startsWith('> ') &&
                                    lines[1] == ''
                                ) {
                                    lines = lines.splice(2);
                                }
                                msg = await throttle(async () => {
                                    return await bot.sendQuotedGroupMessage(
                                        `${name}: ${lines.join('\n')}` as any,
                                        qq_id,
                                        Number(l4[1]),
                                    );
                                });
                            }
                        } else {
                            if (
                                event.content.format == 'org.matrix.custom.html'
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
                        event.type == 'm.room.message' &&
                        event.content.msgtype == 'm.image'
                    ) {
                        try {
                            const url = intent.matrixClient.mxcToHttp(
                                event.content.url as string,
                            );
                            const req = await fetch(url);
                            const buffer = await req.arrayBuffer();
                            let msg;
                            const l4 = await parseQuote();
                            const target: GroupTarget = {
                                type: 'GroupMessage',
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
                                        Number(l4[1]),
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
                    } else if (event.type == 'm.room.redaction') {
                        try {
                            const ev = await getMatrix2QQMsgMapping(
                                event.redacts as string,
                            );
                            if (!ev) return;
                            console.log(ev);
                            await bot.recall(Number(ev[1]), Number(ev[0]));
                        } catch (err) {
                            console.log(err);
                        }
                    }
                },
            },
        });

        async function getAvatarUrl(qq: number, intent: Intent) {
            const key = `qq_avatar_${qq}`;
            console.log('t1');
            while (localStorage.getItem(key) === null) {
                try {
                    console.log('t2');
                    const url = `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=140`;
                    const img = await fetch(url, { agent });
                    const buffer = await img.arrayBuffer();
                    console.log('fetched');
                    const content = await intent.uploadContent(
                        Buffer.from(buffer),
                        {
                            name: 'avatar.jpg',
                            type: 'image/jpeg',
                        },
                    );

                    localStorage.setItem(key, content);
                    console.log('t3');
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
                ?.split('|') as any;
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
        bot.onEvent('groupRecall', async (message) => {
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
                    '撤回了一条消息',
                );
            }
        });
        // 接受消息,发送消息(*)
        bot.onMessage(async (message) => {
            if (message.type == 'GroupMessage') {
                const g = message.sender as GroupSender;
                const group_id = g.group.id;
                const mx_id = findMxByQQ(group_id);
                if (mx_id === null) return;
                const { type, sender, messageChain, reply, quoteReply } =
                    message;
                let msg = '';
                let formatted = '';
                let images: string[] = [];
                console.log(messageChain);
                let quoted: string | null = null;
                let source: string | null = null;
                for (const chain of messageChain) {
                    if (chain.type == 'Forward') {
                        const local_msgs: string[] = [];
                        const local_formatted_msgs: string[] = [];
                        for (const node of chain.nodeList) {
                            let local_msg = '';
                            let local_formatted = '';
                            const local_sender = node.senderName;
                            for (const localchain of node.messageChain) {
                                if (localchain.type === 'Plain') {
                                    local_msg += localchain.text ?? '';
                                    local_formatted += escape(
                                        localchain.text ?? '',
                                    );
                                } else if (localchain.type === 'At') {
                                    local_msg += `@${localchain.display ?? ''}`;
                                    local_formatted += `@${escape(
                                        localchain.display ?? '',
                                    )}`;
                                } else if (localchain.type === 'Image') {
                                    local_msg += '[图片]';
                                    local_formatted += '[图片]';
                                } else if (localchain.type === 'Forward') {
                                    local_msg += '[转发消息]';
                                    local_formatted += '[转发消息]';
                                }
                            }
                            local_msgs.push(`${local_sender}: ${local_msg}`);
                            local_formatted_msgs.push(
                                `${escape(local_sender)}: ${local_formatted}`,
                            );
                        }
                        msg += local_msgs.join('\n');
                        formatted += `<blockquote>\n<p>${local_formatted_msgs.join(
                            '<br>',
                        )}</p></blockquote>`;
                    }
                }
                for (const chain of messageChain) {
                    if (chain.type == 'Quote') {
                        quoted = String(chain.id!);
                    }
                }
                const superintent = bridge.getIntent(matrixAdminId);
                for (const chain of messageChain) {
                    if (chain.type === 'Plain') {
                        msg += Plain.value(chain); // 从 messageChain 中提取文字内容
                        formatted += escape(Plain.value(chain));
                    } else if (chain.type === 'At') {
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
                                                'm.room.member',
                                                sender_id,
                                                true,
                                            );
                                        msg += '@' + profile.displayname;
                                        formatted += `<a href="https://matrix.to/#/${sender_id}">@${escape(
                                            profile.displayname,
                                        )}</a>`;
                                        continue;
                                    }
                                }
                            }

                            msg += '@' + config.puppetCustomization.adminName;
                            formatted += `<a href="https://matrix.to/#/${matrixAdminId}">@${config.puppetCustomization.adminName}</a>`;
                        } else {
                            const id = matrixPuppetId(chain.target!);
                            const profile = await superintent.getStateEvent(
                                mx_id,
                                'm.room.member',
                                id,
                                true,
                            );
                            msg += '@' + profile.displayname;
                            formatted += `<a href="https://matrix.to/#/${id}">@${escape(
                                profile.displayname,
                            )}</a>`;
                        }
                    } else if (chain.type == 'Source') {
                        source = String(chain.id!);
                    } else if (chain.type == 'Image') {
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
                console.log('User', user_profile);
                console.log('Group', group_profile);
                const a = `${group_profile.nickname} (QQ)`;
                const b = (await getAvatarUrl(g.id, intent)) ?? undefined;
                if (user_profile.displayname !== a) {
                    console.log('Reset displayname globally: ignored.');
                    //await intent.setDisplayName(a);
                }
                if (user_profile.avatar_url !== b) {
                    if (b !== undefined) await intent.setAvatarUrl(b);
                }
                console.log('DEBUG', (intent as any).opts);
                const member = await intent.getStateEvent(
                    mx_id,
                    'm.room.member',
                    key,
                    true,
                );
                console.log('Member', member);
                const local_name = `${g.memberName} (QQ)`;
                if (member.displayname !== local_name) {
                    member.displayname = local_name;
                    console.log('Reset displayname locally.');
                    await intent.sendStateEvent(
                        mx_id,
                        'm.room.member',
                        key,
                        member,
                    );
                }
                const member2 = await intent.getStateEvent(
                    mx_id,
                    'm.room.member',
                    key,
                    true,
                );
                console.log('Member after', member2);
                console.log('uploaded');
                if (msg) {
                    let data: any = {
                        body: msg,
                        format: 'org.matrix.custom.html',
                        formatted_body: formatted,
                        msgtype: 'm.text',
                    };
                    if (quoted !== null) {
                        const orig_mat = await getQQ2MatrixMsgMapping([
                            String(group_id),
                            quoted,
                        ]);
                        if (orig_mat !== null) {
                            data['m.relates_to'] = {
                                'm.in_reply_to': { event_id: orig_mat },
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
                        const buffer = await img.arrayBuffer();
                        const content = await intent.uploadContent(
                            Buffer.from(buffer),
                        );
                        const { event_id } = await intent.sendMessage(mx_id, {
                            msgtype: 'm.image',
                            url: content,
                            body: `QQ图片.png`,
                            info: {
                                mimetype: 'image/png',
                            },
                        });
                        await addMatrix2QQMsgMapping(event_id, qqsource);
                    } catch (err) {
                        const { event_id } = await intent.sendText(
                            mx_id,
                            'Failed to send image: ' + url,
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
        bot.listen('group'); // 相当于 bot.listen('friend', 'group', 'temp')

        console.log(
            'Matrix-side listening on %s:%s',
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
                        localStorage.getItem('CUSTOMIZATION_VERSION') ?? '0',
                    ) < customizationVersion
                ) {
                    await intent.setDisplayName(
                        config.puppetCustomization.adminName,
                    );
                    await intent.setAvatarUrl(
                        config.puppetCustomization.adminAvatar,
                    );
                    localStorage.setItem(
                        'CUSTOMIZATION_VERSION',
                        String(customizationVersion),
                    );
                }
            });
    },
}).run();

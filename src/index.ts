import Mirai, { GroupTarget } from 'node-mirai-sdk';
import {Cli, Bridge, AppServiceRegistration, MembershipCache, Intent, UserMembership, PowerLevelContent} from "matrix-appservice-bridge"
import {marked} from "marked"
import fetch from "node-fetch"
import { LocalStorage } from "node-localstorage";
import http from 'node:http';
import https from 'node:https';
import {readConfig} from "./config"
import { SocksProxyAgent } from 'socks-proxy-agent';
import { MatrixProfileInfo } from 'matrix-bot-sdk';
import throttledQueue from 'throttled-queue';
const { Plain, At, Image } = Mirai.MessageComponent;
const config = readConfig();
const localStorage = new LocalStorage('./extra-storage.db');

let agent: SocksProxyAgent | any | undefined = undefined;
if(config.socksProxy.enable){
    agent = new SocksProxyAgent(config.socksProxy.url)
}else{
    const https_agent = new https.Agent({
        family: 4
    });
    const http_agent =  new http.Agent({
        family: 4
    })
    agent = (url: URL)=>{
        if(url.protocol.includes("https")){
            return https_agent;
        }else{
            return http_agent;
        }

    }
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


const QQ_MX_MAPPING : [mx: string, qq: number][]= [];
for(const rule of config.bridgedGroups){
    QQ_MX_MAPPING.push([rule.mx, rule.qq]);
}

function findMxByQQ(qq: number){
    for(const ent of QQ_MX_MAPPING){
        if(qq==ent[1]) return ent[0];
    }
    return null;
}
function findQQByMx(mx: string){
    for(const ent of QQ_MX_MAPPING){
        if(mx==ent[0]) return ent[1];
    }
    return null;
}
interface MembershipPair{
    membership: UserMembership,
    profile: MatrixProfileInfo
}
class PersistentIntentBackingStore{
    private memberShipKey(roomId: string, userId: string){
        return `pibs-membership-${roomId}-${userId}`;
    }
    private powerLevelContentKey(roomId: string){
        return `pibs-powerlevelcontent-${roomId}`
    }
    private loadMembership(roomId: string, userId: string): MembershipPair|null{
        const item = localStorage.getItem(this.memberShipKey(roomId, userId));
        if(item===null) return null;
        return JSON.parse(item);
    }
    private storeMembership(roomId: string, userId: string, value: MembershipPair){
        localStorage.setItem(this.memberShipKey(roomId, userId), JSON.stringify(value));
    }
    private loadPowerLevelContent(roomId: string): PowerLevelContent|null{
        const item = localStorage.getItem(this.powerLevelContentKey(roomId));
        if(item===null) return null;
        return JSON.parse(item);
    }
    private storePowerLevelContent(roomId: string, value: PowerLevelContent){
        localStorage.setItem(this.powerLevelContentKey(roomId), JSON.stringify(value));
    }
    getMembership(roomId: string, userId: string) : UserMembership{
        const pair = this.loadMembership(roomId, userId);
        if(!pair) return null;
        return pair.membership;
    }
    getMemberProfile(roomId: string, userid: string) :  MatrixProfileInfo{
        const pair = this.loadMembership(roomId, userid);
        if(!pair) return {};
        return pair.profile;
    }
    getPowerLevelContent(roomId: string) :  PowerLevelContent | undefined{
        const val = this.loadPowerLevelContent(roomId);
        return val ?? undefined;
    }
    setMembership(roomId: string, userId: string, membership: UserMembership, profile: MatrixProfileInfo) : void{
        this.storeMembership(roomId, userId, {
            membership, profile
        })
    }
    setPowerLevelContent(roomId: string, content: PowerLevelContent) :  void{
        this.storePowerLevelContent(roomId, content)
    }
}
const INTENT_MEMBERSHIP_STORE=(function(){
    const store = new PersistentIntentBackingStore();
    return {
        getMembership : store.getMembership.bind(store),
        getMemberProfile: store.getMemberProfile.bind(store),
        getPowerLevelContent: store.getPowerLevelContent.bind(store),
        setMembership: store.setMembership.bind(store),
        setPowerLevelContent: store.setPowerLevelContent.bind(store)
    }
})();
console.log(INTENT_MEMBERSHIP_STORE.getMembership);
const launch_date = new Date();
new Cli({
    registrationPath: "gjz010-qqbridge-registration.yaml",
    generateRegistration: function(reg, callback) {
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("gjz010-qqbridge");
        reg.addRegexPattern("users", "@gjz010_qqbot_.*", true);
        callback(reg);
    },
    run: function(port, config_) {
        const cache = new MembershipCache();
        const prev_name_dict: Record<string, string> = {};
        const prev_profile_dict : Record<string, string> = {};
        const bridge = new Bridge({
            homeserverUrl: config.matrix.homeserver,
            domain: config.matrix.domain,
            registration: "gjz010-qqbridge-registration.yaml",
            membershipCache: cache,
            intentOptions:{
                bot: {
                    backingStore: INTENT_MEMBERSHIP_STORE
                },
                clients: {
                    backingStore: INTENT_MEMBERSHIP_STORE
                }
            },
            controller: {
                onUserQuery: function(queriedUser) {
                    return {}; // auto-provision users with no additonal data
                },
        
                onEvent: async function(request, context) {
                    const event = request.getData();
                    if(event.origin_server_ts< launch_date.getTime()){
                        console.warn("Ignoring event ", event.event_id);
                        return;
                    }
                    
                    console.log(event);
                    const room_id = event.room_id;
                    const qq_id = findQQByMx(room_id);
                    if(qq_id===null) return;
                    let user_id = event.sender;
                    let name = user_id;
                    const intent = bridge.getIntent("@gjz010_qqbot_admin:matrix.gjz010.com");
                    if(prev_profile_dict[user_id]===undefined){
                        const prof = await intent.getProfileInfo(user_id, null, true);
                        //console.log(prof);
                        prev_profile_dict[user_id] = prof.displayname ?? name;
                    }
                    name = prev_name_dict[user_id] ?? name;
                    const profile = cache.getMemberProfile(event.room_id, event.sender);
                    if(profile.displayname===undefined){
                        if(prev_name_dict[user_id]===undefined){
                            const state = await intent.getStateEvent(room_id, "m.room.member", user_id, true);
                            //console.log(state)
                            prev_name_dict[user_id] = state?.displayname ?? name;
                        }
                        name = prev_name_dict[user_id] ?? name;
                    }else{
                        name = profile.displayname ?? name;
                    }
                    async function parseQuote(){
                        const l1: any = event.content["m.relates_to"];
                        const l2: any = l1?l1["m.in_reply_to"]:undefined;
                        const l3: string | undefined = l2?.event_id;
                        const l4 = l3===undefined?l3:await getMatrix2QQMsgMapping(l3);
                        return l4 ?? null;
                    }
                    if(event.type=="m.room.message" && event.content.msgtype=="m.text"){
                        //let quote = null;
                        const l4 = await parseQuote();
                        let msg;
                        if(l4!==null){
                            const s = event.content.body as string;
                            let lines = s.split("\n");
                            if(lines[0].startsWith("> ") && lines[1]==""){
                                lines = lines.splice(2);
                            }
                            msg=await throttle(async ()=>{
                                return await bot.sendQuotedGroupMessage(`${name}: ${lines.join("\n")}` as any, qq_id, Number(l4[1]));
                            });
                        }else{
                            msg=await throttle(async ()=>{
                                return await bot.sendGroupMessage(`${name}: ${event.content.body}`, qq_id);
                            });
                        }
                        const source: [string, string] = [String(qq_id), String(msg.messageId)];
                        const event_id = event.event_id;
                        await addMatrix2QQMsgMapping(event_id, source);
                        await addQQ2MatrixMsgMapping(source, event_id);
                        
                    }else if(event.type=="m.room.message" && event.content.msgtype=="m.image"){
                        try{
                            const url = intent.matrixClient.mxcToHttp(event.content.url as string);
                            const req = await fetch(url);
                            const buffer = await req.arrayBuffer();
                            let msg;
                            const l4 = await parseQuote();
                            const target: GroupTarget = {
                                type: 'GroupMessage',
                                sender: {
                                    group: {
                                        id: qq_id
                                    }
                                }
                            };
                            if(l4){
                                msg=await throttle(async ()=>{
                                    const image = await bot.uploadImage(Buffer.from(buffer), target);
                                    return await bot.sendQuotedGroupMessage([Plain(`${name}:`), Image(image)], qq_id, Number(l4[1]))
                                });
                                
                            }else{
                                msg=await throttle(async ()=>{
                                    const image = await bot.uploadImage(Buffer.from(buffer), target);
                                    return await bot.sendGroupMessage([Plain(`${name}:`), Image(image)], qq_id);
                                });
                                
                            }
                            
                            
                            const source: [string, string] = [String(qq_id), String(msg.messageId)];
                            const event_id = event.event_id;
                            await addMatrix2QQMsgMapping(event_id, source);
                            await addQQ2MatrixMsgMapping(source, event_id);
                        }catch(err){
                            console.log(err)
                        }
                        //const url = intent.down
                    }
                    
                }
            }
        });
        
        async function getAvatarUrl(qq: number, intent: Intent){
            const key = `qq_avatar_${qq}`;
            console.log("t1");
            while(localStorage.getItem(key)===null){
                try{
                console.log("t2");
                const url = `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=140`;
                const img = await fetch(url, {agent});
                const buffer = await img.arrayBuffer();
                console.log("fetched");
                const content = await intent.uploadContent(Buffer.from(buffer), {
                    name: "avatar.jpg",
                    type: "image/jpeg"
                });
                
                localStorage.setItem(key, content);
                console.log("t3");
                }catch(err){
                    console.log(`Error fetching avatar for ${qq}, retrying`, err)
                }
            }
            
            return localStorage.getItem(key);
        }
        function qqmsgStr(msgId: [group: string, id: string]){
            return `${msgId[0]}|${msgId[1]}`
        }
        async function addMatrix2QQMsgMapping(eventId: string, msgId: [group: string, id: string]){
            console.log(`Mapping ${eventId} to ${qqmsgStr(msgId)}`)
            localStorage.setItem(`msgmapping_matrix_to_qq_${eventId}`, qqmsgStr(msgId))
        }
        async function addQQ2MatrixMsgMapping(msgId: [group: string, id: string], eventId: string){
            localStorage.setItem(`msgmapping_qq_to_matrix_${qqmsgStr(msgId)}`, eventId)
        }
        async function getMatrix2QQMsgMapping(eventId: string): Promise<[group: string, id: string]|null>{
            return localStorage.getItem(`msgmapping_matrix_to_qq_${eventId}`)?.split("|") as any
        }
        async function getQQ2MatrixMsgMapping(msgId: [group: string, id: string]){
            return localStorage.getItem(`msgmapping_qq_to_matrix_${qqmsgStr(msgId)}`);
        }
        async function joinRoom(bot: string, room_id: string){
            try{
                const superintent = bridge.getIntent("@gjz010_qqbot_admin:matrix.gjz010.com");
                try{
                    await superintent.join(room_id);
                }catch(err){

                }
                await superintent.invite(room_id, bot);
            }catch(err){

            }
        }
        // 接受消息,发送消息(*)
        bot.onMessage(async message => {
            const { type, sender, messageChain, reply, quoteReply } = message;
            let msg = '';
            let images: string[]=[];
            console.log(messageChain)
            let quoted : string | null = null
            let source : string | null = null
            for(const chain of messageChain) {
                if (chain.type === 'Plain'){
                    msg += Plain.value(chain);                  // 从 messageChain 中提取文字内容
                }
                if(chain.type=="Source"){
                    source= String(chain.id!);
                }
                if(chain.type=="Quote"){
                    quoted=String(chain.id!);
                }
                if(chain.type=='Image'){
                    console.log(chain);
                    images.push(chain.url!);
                    //msg+='[图图]';  
                }
            }
            if(message.type == "GroupMessage"){
                const g = message.sender as GroupSender
                const group_id = g.group.id;
                const mx_id = findMxByQQ(group_id);
                if(mx_id!==null){
                    console.log(message.sender)
                    const key = `@gjz010_qqbot_qq_${g.id}:matrix.gjz010.com`;
                    const intent = bridge.getIntent(key);
                    await joinRoom(key, mx_id);
                    const group_profile = await bot.getGroupMemberProfile(g.group.id, g.id);
                    const user_profile = await intent.getProfileInfo(key, undefined, false);
                    console.log("User", user_profile);
                    console.log("Group", group_profile);
                    const a = `${group_profile.nickname} (QQ)`;
                    const b = await getAvatarUrl(g.id, intent) ?? undefined;
                    if(user_profile.displayname!==a){
                        console.log("Reset displayname globally.");
                        await intent.setDisplayName(a);
                    }
                    if(user_profile.avatar_url!==b){
                        if(b!==undefined) await intent.setAvatarUrl(b);
                    }
                    console.log("DEBUG", (intent as any).opts)
                    const member = await intent.getStateEvent(mx_id, "m.room.member", key, true);
                    console.log("Member", member);
                    const local_name = `${g.memberName} (QQ)`;
                    if(member.displayname!==local_name){
                        member.displayname = local_name;
                        console.log("Reset displayname locally.");
                        await intent.sendStateEvent(mx_id, "m.room.member", key, member);
                    }
                    const member2 = await intent.getStateEvent(mx_id, "m.room.member", key, true);
                    console.log("Member after", member2);
                    console.log("uploaded")
                    const md = `${msg}`;
                    if(md){
                        const html = marked(md).trim()
                        let data: any = {
                            body: md,
                            format: 'org.matrix.custom.html',
                            formatted_body: html,
                            msgtype: "m.text"
                        };
                        let q = quoted;
                        if(quoted!==null){
                            const orig_mat = await getQQ2MatrixMsgMapping([String(group_id), quoted]);
                            if(orig_mat!==null){
                                data["m.relates_to"] = {"m.in_reply_to": {event_id: orig_mat}};
                            }
                        }
                        const {event_id} = await intent.sendMessage(mx_id, data)
                        const qqsource: [string, string] = [String(group_id), source!];
                        await addMatrix2QQMsgMapping(event_id, qqsource);
                        await addQQ2MatrixMsgMapping(qqsource, event_id);
                    }

                    for(const url of images){
                        const sending_prompt = intent.sendTyping(mx_id, true);
                        const qqsource: [string, string] = [String(group_id), source!];
                        try{
                            const img = await fetch(url, {agent});
                            const buffer = await img.arrayBuffer();
                            const content = await intent.uploadContent(Buffer.from(buffer));
                            const {event_id} = await intent.sendMessage(mx_id, {
                                msgtype: "m.image",
                                url: content,
                                body: `QQ图片`,
                                info: {
                                    mimetype: "image/png"
                                }
                            })
                            await addMatrix2QQMsgMapping(event_id, qqsource);
                        }catch(err){
                            const {event_id} = await intent.sendText(mx_id, "Failed to send image: "+url);
                            await addMatrix2QQMsgMapping(event_id, qqsource);
                        }
                        await sending_prompt;
                    }
                    await intent.sendTyping(mx_id, false);
                }


            }
            
        });
        
        /* 开始监听消息(*)
        * 'all' - 监听好友和群
        * 'friend' - 只监听好友
        * 'group' - 只监听群
        * 'temp' - 只监听临时会话
        */
        bot.listen('group'); // 相当于 bot.listen('friend', 'group', 'temp')

        console.log("Matrix-side listening on %s:%s", config.matrix.listenIP, config.matrix.listenPort);
        bridge.run(config.matrix.listenPort, undefined, config.matrix.listenIP);
    }
}).run();
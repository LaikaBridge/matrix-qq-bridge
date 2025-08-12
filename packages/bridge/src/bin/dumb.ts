import { MiraiOnebotAdaptor } from "../onebot-client";

async function main() {
    const onebot = new MiraiOnebotAdaptor({
        host: "127.0.0.1:61000",
        verifyKey: "mirai_test",
        qq: 12345,
        enableWebsocket: true,
        wsOnly: true
    });
    onebot.onEvent("groupRecall", console.log);
    onebot.onMessage(console.log);
    await onebot.listen("group");
}

main();
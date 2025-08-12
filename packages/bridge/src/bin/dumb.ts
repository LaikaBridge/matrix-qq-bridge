import { logger } from "../logger";
import { MiraiOnebotAdaptor } from "../onebot-client";
import "../workdir"
async function main() {
    const onebot = new MiraiOnebotAdaptor({
        host: "127.0.0.1:61000",
        verifyKey: "mirai_test",
        qq: 12345,
        enableWebsocket: true,
        wsOnly: true
    });
    onebot.onEvent("groupRecall", (x) => logger.info(x));
    onebot.onMessage((x) => logger.info(x));
    await onebot.listen("group");
}

main();
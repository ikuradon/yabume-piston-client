import "dotenv/config";

import { finishEvent, relayInit } from "nostr-tools";
import "websocket-polyfill";

import { getUnixTime } from "date-fns";

import piston from "piston-client";

const PISTON_SERVER = process.env.PISTON_SERVER;
const RELAY_URL = process.env.RELAY_URL || "wss://yabu.me";
const PRIVATE_KEY_HEX = process.env.PRIVATE_KEY_HEX;
const ACCEPT_DUR_SEC = 1 * 60;

const pistonClient = piston({ server: PISTON_SERVER });
const runtimes = await pistonClient.runtimes();
const languages = {};

runtimes.forEach(runtime => {
    languages[runtime.language] = {};
    languages[runtime.language].language = runtime.language;
    languages[runtime.language].version = runtime.version;
    if (!!runtime.aliases)
        runtime.aliases.forEach(alias => {
            languages[alias] = {};
            languages[alias].language = runtime.language;
            languages[alias].version = runtime.version;
        });
});

const executePiston = async content => {
    const contentArray = content.match(/[^\r\n]+/g);
    const language = contentArray.shift(1).replace("/run", "").trim();
    console.log(language);
    if (!languages[language])
        return "Language not found.";
    const code = contentArray.join("\n");

    const script = {};
    script.content = code;
    if (languages[language].language === "emojicode")
        script.name = "file0.emojic";

    const result = await pistonClient.execute({
        language: languages[language].language,
        version: languages[language].version,
        files: [
            script,
        ],
        compile_timeout: 10000,
        run_timeout: 10000,
    });

    if (!!result.compile && !!result.compile.code)
        return result.compile.output;
    else
        return !!result.run ? result.run.output : !!result.message ? result.message : "Execution error";
}

const composeReplyPost = (content, targetEvent, created_at = getUnixTime(new Date()) + 1) => {
    const ev = {
        kind: 1,
        content: content,
        tags: [
            ["e", targetEvent.id],
            ["p", targetEvent.pubkey],
        ],
        created_at: created_at,
    };

    return finishEvent(ev, PRIVATE_KEY_HEX);
};

const publishToRelay = async (relay, ev) => {
    await relay.publish(ev)
        .then(() => console.log("post ok"))
        .catch(e => console.log(`post error: ${e}`));
};

(async _ => {
    const relay = relayInit(RELAY_URL);
    relay.on("error", () => {
        console.error("failed to connect");
        process.exit(0);
    });

    relay.connect();

    const sub = relay.sub([{ kinds: [1], since: getUnixTime(new Date()) }]);

    sub.on("event", async ev => {
        if (
            ev.created_at < getUnixTime(new Date()) - ACCEPT_DUR_SEC ||
            !ev.content.startsWith("/run")
        )
            return false;

        const message = await executePiston(ev.content);
        const replyPost = composeReplyPost(message, ev);
        await publishToRelay(relay, replyPost);
    });

})().catch(e => console.error(e));
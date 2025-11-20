import express from "express";
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import pino from "pino";

const app = express();
app.use(express.json());

let sock;
let pairingCode = null;

async function startWa() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");

    sock = makeWASocket({
        logger: pino({ level: "silent" }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false
    });

    sock.ev.on("creds.update", saveCreds);

    return sock;
}

app.post("/pair", async (req, res) => {
    try {
        let { phone } = req.body;

        if (!phone) return res.json({ error: "Phone number required" });

        phone = phone.replace(/[^0-9]/g, "");

        if (!phone.startsWith("91")) {
            return res.json({ error: "Please start with country code (example: 91)" });
        }

        if (!sock) await startWa();

        const code = await sock.requestPairingCode(phone);

        pairingCode = code?.match(/.{1,4}/g)?.join("-");
        console.log("PAIRING CODE:", pairingCode);

        return res.json({ code: pairingCode });

    } catch (err) {
        return res.json({ error: err.message });
    }
});

app.get("/", (req, res) => {
    res.send("WhatsApp Pairing Server Running");
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});

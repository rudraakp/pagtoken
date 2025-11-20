import express from "express";
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import pino from "pino";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static("public"));

let sock;

// Start WhatsApp Socket
async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");

    sock = makeWASocket({
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        }
    });

    sock.ev.on("creds.update", saveCreds);

    return sock;
}

// API → generate pairing code
app.post("/pair", async (req, res) => {
    try {
        let { phone } = req.body;
        phone = phone.replace(/[^0-9]/g, "");

        if (!phone.startsWith("91")) {
            return res.json({ error: "Start with country code e.g. 91XXXXXXXXXX" });
        }

        if (!sock) await startWhatsApp();

        const pc = await sock.requestPairingCode(phone);
        const code = pc?.match(/.{1,4}/g)?.join("-");

        console.log("PAIRING CODE:", code);

        res.json({ code });
    } catch (e) {
        res.json({ error: e.message });
    }
});

// Default route
app.get("/", (req, res) =>
    res.sendFile(path.join(__dirname, "public", "index.html"))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));

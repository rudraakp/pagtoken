import express from "express";
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

let globalSocket = null;

async function startWASession() {
    const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, null)
        },
        printQRInTerminal: false
    });

    sock.ev.on("creds.update", saveCreds);
    globalSocket = sock;
}

startWASession();

app.post("/pair", async (req, res) => {
    try {
        const { number } = req.body;

        if (!number || number.length < 8) {
            return res.json({ status: false, message: "Invalid phone number" });
        }

        const code = await globalSocket.requestPairingCode(number);
        res.json({ status: true, code: code });

    } catch (err) {
        res.json({ status: false, message: err.message });
    }
});

app.use(express.static("public"));

app.listen(3000, () => console.log("Server running on port 3000"));

// server.js - Final Code with Robust Proxy Handling (Proxy is Optional)

import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import express from 'express';
import pino from 'pino';
import chalk from 'chalk';
import cors from 'cors';
// Import HttpsProxyAgent conditionally, only if needed
import { HttpsProxyAgent } from 'https-proxy-agent'; 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// State variables
const SESSION_FOLDER = `./session`;
let MznKing;
let waConnectionState = "close";
let qrCodeData = null; 

// --- Proxy Configuration Logic ---
const PROXY_URL = process.env.PROXY;
let agent = undefined;

if (PROXY_URL) {
    try {
        agent = new HttpsProxyAgent(PROXY_URL);
        console.log(chalk.magenta.bold("✅ PROXY detected and configured."));
    } catch (e) {
        console.error(chalk.red.bold(`❌ Invalid PROXY URL: ${e.message}`));
        // Continue without proxy if URL is invalid
    }
} else {
    console.log(chalk.yellow("⚠️ No PROXY URL found. Connecting directly via Zeabur IP. Expect possible 405/428 errors."));
}
// -----------------------------------

// Utility function for delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Baileys connection state storage
const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);

// --- Baileys Connection Logic ---
const connectBaileys = async () => {
    MznKing = makeWASocket({
        logger: pino.default({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino.default({ level: "fatal" })),
        },
        markOnlineOnConnect: false,
        syncFullHistory: false,
        
        // Use agent if defined, otherwise undefined (direct connection)
        agent: agent, 
    });

    MznKing.ev.on("connection.update", (s) => {
        const { connection, lastDisconnect, qr } = s;
        waConnectionState = connection;
        
        if (qr) {
            qrCodeData = qr;
            console.log(chalk.yellow.bold("⭐ QR Code received. Check the website to scan."));
        }

        if (connection === "open") {
            console.log(chalk.green.bold("✅ WhatsApp connection OPEN. Device is now linked."));
            qrCodeData = null; 
        }

        if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.error(chalk.red(`❌ WhatsApp connection closed. Status: ${statusCode}`));
            
            if (statusCode !== 401) { // Not authentication failure
                 const reconnectDelay = 30000; 
                 console.log(chalk.yellow(`Retrying connection in ${reconnectDelay / 1000} seconds...`));
                 setTimeout(connectBaileys, reconnectDelay); 
            } else {
                 console.log(chalk.red.bold("🛑 Authentication failed (401). Clear session data and pair again."));
            }
        }
    });

    MznKing.ev.on('creds.update', saveCreds);

    return MznKing;
};

// Initial connection
await connectBaileys();

// --- API Endpoint to GET QR Code ---
app.get('/get-qrcode', async (req, res) => {
    if (MznKing.authState.creds.registered) {
        return res.json({ success: true, status: 'linked', message: 'Device is already linked.' });
    }
    
    if (qrCodeData) {
        return res.json({ success: true, status: 'qr_available', qr_code: qrCodeData });
    }
    
    if (waConnectionState === 'connecting') {
        return res.status(200).json({ success: false, status: 'connecting', message: 'Attempting to connect to WhatsApp. Please wait.' });
    }

    // This case suggests the connection keeps failing (e.g., permanent 405/428 block)
    return res.status(200).json({ success: false, status: 'failed', message: 'Connection is unstable or blocked. The server will retry automatically in 30 seconds.' });
});


// Serve static files (your HTML, CSS, JS) - FOR FRONTEND
app.use(express.static('public')); 

app.listen(PORT, () => {
    console.log(chalk.blueBright(`Server running on port ${PORT}`));
});
                         

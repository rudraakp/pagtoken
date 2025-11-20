// server.js - Final Code with QR Code Logic & Proxy

import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import express from 'express';
import pino from 'pino';
import chalk from 'chalk';
import cors from 'cors';
import { HttpsProxyAgent } from 'https-proxy-agent'; 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// State variables
const SESSION_FOLDER = `./session`;
let MznKing;
let waConnectionState = "close";
let qrCodeData = null; // To store the Base64 QR code data

// Get Proxy URL from Environment Variable
const PROXY_URL = process.env.PROXY;
const agent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;
if (agent) {
    console.log(chalk.magenta.bold("Using PROXY for WhatsApp connection."));
}

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
        agent: agent, 
    });

    MznKing.ev.on("connection.update", (s) => {
        const { connection, lastDisconnect, qr } = s;
        waConnectionState = connection;
        
        // --- QR Code Capturing Logic ---
        if (qr) {
            qrCodeData = qr;
            console.log(chalk.yellow.bold("QR Code received. It is valid for about 30 seconds."));
        }
        // -------------------------------

        if (connection === "open") {
            console.log(chalk.green.bold("WhatsApp connection OPEN. Device is now linked."));
            qrCodeData = null; // Clear QR data once connected
        }

        if (connection === "close") {
            console.error(chalk.red(`WhatsApp connection closed. Status: ${lastDisconnect?.error?.output?.statusCode}`));
            
            if (lastDisconnect?.error?.output?.statusCode !== 401) {
                 const reconnectDelay = 30000; 
                 console.log(chalk.yellow(`Attempting to reconnect Baileys in ${reconnectDelay / 1000} seconds...`));
                 setTimeout(connectBaileys, reconnectDelay); 
            } else {
                 console.log(chalk.red.bold("Authentication failed (401). Please clear session data and pair again."));
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
        return res.json({ success: true, status: 'linked', message: 'Device is already linked. QR code is not needed.' });
    }
    
    if (qrCodeData) {
        return res.json({ success: true, status: 'qr_available', qr_code: qrCodeData });
    }
    
    // If QR is not ready, check if connection is open
    if (waConnectionState !== 'open') {
        return res.status(503).json({ success: false, status: 'connecting', message: 'Server is trying to connect to WhatsApp. Please try again in a few seconds.' });
    }

    // This case should be rare, but indicates the QR timed out or wasn.t captured yet.
    return res.status(503).json({ success: false, status: 'waiting', message: 'Connection open but waiting for QR code generation from WhatsApp.' });
});


// Serve static files (your HTML, CSS, JS) - FOR FRONTEND
app.use(express.static('public')); 

app.listen(PORT, () => {
    console.log(chalk.blueBright(`Server running on port ${PORT}`));
});

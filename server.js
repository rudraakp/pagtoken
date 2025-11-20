// server.js - FIXING 428 PRECONDITION REQUIRED ERROR

import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import express from 'express';
import pino from 'pino';
import chalk from 'chalk';
import fs from 'fs';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// State variables
const SESSION_FOLDER = `./session`;
let MznKing;
let waConnectionState = "close"; // Track connection status

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
        syncFullHistory: false // Reduce initial load
    });

    MznKing.ev.on("connection.update", (s) => {
        const { connection, lastDisconnect } = s;
        waConnectionState = connection; // Update global state
        
        if (connection === "open") {
            console.log(chalk.yellow("WhatsApp connection opened successfully. Ready for commands."));
        }

        if (connection === "close") {
            console.error(chalk.red(`WhatsApp connection closed. Status: ${lastDisconnect?.error?.output?.statusCode}`));
            
            // Reconnect logic: Attempt reconnect unless status is 401 (Auth Failed)
            if (lastDisconnect?.error?.output?.statusCode !== 401) {
                 console.log(chalk.yellow("Attempting to reconnect Baileys..."));
                 // Slight delay before reconnecting to avoid immediate loop
                 setTimeout(connectBaileys, 5000); 
            } else {
                 console.log(chalk.red.bold("Authentication failed (401). Please clear session data and pair again."));
                 // Optionally delete session files here
            }
        }
    });

    MznKing.ev.on('creds.update', saveCreds);

    return MznKing;
};

// Initial connection
await connectBaileys();

// --- API Endpoint ---

app.post('/request-pairing-code', async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
        return res.status(400).json({ success: false, message: "Phone number is required." });
    }

    let cleanedNumber = phoneNumber.replace(/[^0-9]/g, '');

    // 1. Connection Readiness Check (FIX for 428)
    if (waConnectionState !== 'open') {
         // Wait up to 10 seconds for connection to open
         console.log(chalk.yellow("Waiting for Baileys connection to open..."));
         await delay(5000); // Wait 5 seconds
         if (waConnectionState !== 'open') {
             return res.status(503).json({ success: false, message: "Baileys connection is not stable or open. Please try again in a few moments." });
         }
    }
    
    // 2. Registration Check
    if (MznKing.authState.creds.registered) {
        return res.status(200).json({ success: true, message: "WhatsApp already linked. To get a new code, please clear session data or unlink manually.", code: "N/A" });
    }

    if (!cleanedNumber.startsWith('91')) { // Adjust country code as needed
        return res.status(400).json({ success: false, message: "Please start with your country code, e.g., +91 for India." });
    }

    try {
        // 3. Request the Pairing Code
        const code = await MznKing.requestPairingCode(cleanedNumber);
        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
        
        console.log(chalk.black(chalk.bgGreen(`Generated Login Code for ${cleanedNumber}: `)), chalk.black(chalk.cyan(formattedCode)));
        
        res.json({ success: true, code: formattedCode });

    } catch (error) {
        console.error(chalk.red("Error requesting pairing code:"), error);
        // Specifically handle cases where the request fails immediately
        res.status(500).json({ success: false, message: "Failed to request pairing code. Check logs for details (428 likely).", error: error.message });
    }
});

// Serve static files (your HTML, CSS, JS) - FOR FRONTEND
app.use(express.static('public')); 

app.listen(PORT, () => {
    console.log(chalk.blueBright(`Server running on port ${PORT}`));
});

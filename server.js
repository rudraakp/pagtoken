// server.js

import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import express from 'express';
import pino from 'pino';
import chalk from 'chalk';
import fs from 'fs';
import cors from 'cors'; // CORS middleware

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // To parse JSON request bodies
app.use(cors()); // Enable CORS for all routes

// Baileys connection state storage
const { state, saveCreds } = await useMultiFileAuthState(`./session`);

let MznKing; // Declare MznKing outside to be accessible globally

// Function to initialize or reconnect Baileys
const connectBaileys = async () => {
    MznKing = makeWASocket({
        logger: pino.default({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino.default({ level: "fatal" })),
        },
        markOnlineOnConnect: false, // Don't mark online until truly needed
    });

    MznKing.ev.on("connection.update", (s) => {
        const { connection, lastDisconnect } = s;
        if (connection === "open") {
            console.log(chalk.yellow("WhatsApp connection opened successfully."));
            // At this point, you could potentially get group info etc.
        }
        if (connection === "close") {
            console.error(chalk.red(`WhatsApp connection closed. Last disconnect: ${lastDisconnect?.error?.output?.statusCode}`));
            // Implement re-connection logic if desired, or just let the user re-initiate pairing
        }
    });

    MznKing.ev.on('creds.update', saveCreds);

    return MznKing;
};

// Initial connection (without expecting pairing code right away)
await connectBaileys();

// API endpoint to request pairing code
app.post('/request-pairing-code', async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
        return res.status(400).json({ success: false, message: "Phone number is required." });
    }

    let cleanedNumber = phoneNumber.replace(/[^0-9]/g, '');

    if (!cleanedNumber.startsWith('91')) { // Adjust country code as needed
        return res.status(400).json({ success: false, message: "Please start with your country code, e.g., +91 for India." });
    }

    try {
        // Ensure MznKing is ready to request a new code if not already registered
        // If it's already registered, this might not return a new code as expected.
        // For a new pairing, the session folder should be empty or credentials cleared.
        if (MznKing.authState.creds.registered) {
            // If already registered, perhaps disconnect first or inform user
            console.log(chalk.green("WhatsApp is already registered. To get a new code, clear the session folder or unlink the device."));
            return res.status(200).json({ success: true, message: "WhatsApp already linked. If you need a new code, please clear session data or unlink manually.", code: "N/A" });
        }
        
        // Request the pairing code
        const code = await MznKing.requestPairingCode(cleanedNumber);
        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
        
        console.log(chalk.black(chalk.bgGreen(`Generated Login Code for ${cleanedNumber}: `)), chalk.black(chalk.cyan(formattedCode)));
        
        res.json({ success: true, code: formattedCode });

    } catch (error) {
        console.error(chalk.red("Error requesting pairing code:"), error);
        res.status(500).json({ success: false, message: "Failed to request pairing code.", error: error.message });
    }
});

// Serve static files (your HTML, CSS, JS) - FOR FRONTEND
app.use(express.static('public')); 

app.listen(PORT, () => {
    console.log(chalk.blueBright(`Server running on port ${PORT}`));
    console.log(chalk.blueBright(`Access the frontend at http://localhost:${PORT}`));
});

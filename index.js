const express = require('express');
const bodyParser = require('body-parser');
const login = require('ws3-fca');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- GLOBAL STATE ---
let botAPI = null;
let adminID = null;
let prefix = '$'; 
let botNickname = '𝐀𝐘𝐀𝐍𝐒𝐇 𝐁𝐎𝐓';

// Har group ki alag setting store karne ke liye
let spamConfigs = {}; 
let currentCookies = null;

const signature = `\n                      ⚠️\n                  𝐀𝐘𝐀𝐍𝐒𝐇 𝐁𝐀𝐃𝐌𝐀𝐒𝐇 𝐇𝐄𝐑𝐄 ⚠️`;

// --- UTILITY FUNCTIONS ---
function emitLog(message, isError = false) {
  const logMessage = `[${new Date().toISOString()}] ${isError ? '❌ ERROR: ' : '✅ INFO: '}${message}`;
  console.log(logMessage);
  io.emit('botlog', logMessage);
}

function formatTime(ms) {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  return `${hours}hr ${minutes}min ${seconds}sec`;
}

function getOrCreateConfig(threadID) {
  if (!spamConfigs[threadID]) {
    spamConfigs[threadID] = {
      haterName: null,
      filePath: null,
      speed1: 2000, // Default Min Speed (2 sec)
      speed2: 5000, // Default Max Speed (5 sec)
      isRunning: false,
      startTime: null, // Uptime ke liye
      timer: null,
      msgIndex: 0
    };
  }
  return spamConfigs[threadID];
}

// --- MESSAGE FORMATTER ---
async function formatMessage(api, event, mainMessage) {
    const { senderID } = event;
    let senderName = 'User';
    try {
      const userInfo = await api.getUserInfo(senderID);
      senderName = userInfo && userInfo[senderID] ? userInfo[senderID].name : 'User';
    } catch (e) {}
    
    const styledMentionBody = `             [🦋°🫧•𖨆٭ ${senderName}꙳○𖨆°🦋]`;
    const finalMessage = `${styledMentionBody}\n${mainMessage}${signature}`;
    return { 
        body: finalMessage, 
        mentions: [{ tag: senderName, id: senderID, fromIndex: styledMentionBody.indexOf(senderName) }] 
    };
}

// --- LOGIN LOGIC ---
function initializeBot(cookies, prefixValue, adminIDValue) {
  emitLog('🚀 Initializing Configurable Bot...');
  currentCookies = cookies;
  if (prefixValue) prefix = prefixValue;
  if (adminIDValue) adminID = adminIDValue;

  login({ appState: currentCookies }, (err, api) => {
    if (err) {
      emitLog(`❌ Login error: ${err.message}. Retrying...`, true);
      setTimeout(() => initializeBot(currentCookies, prefix, adminID), 10000);
      return;
    }

    emitLog('✅ Bot Logged In! Ready for commands.');
    botAPI = api;
    botAPI.setOptions({ selfListen: true, listenEvents: true, updatePresence: false });
    
    api.listenMqtt(async (err, event) => {
      if (err) return;
      if (event.type === 'message' || event.type === 'message_reply') {
        await handleMessage(api, event);
      }
    });
  });
}

// --- WEB SERVER ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.post('/configure', (req, res) => {
    try {
        const cookies = JSON.parse(req.body.cookies);
        if(req.body.prefix) prefix = req.body.prefix;
        adminID = req.body.adminID;
        res.send('Bot Started...');
        initializeBot(cookies, prefix, adminID);
    } catch (e) { res.status(400).send('Config Error'); }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => emitLog(`✅ Server running on port ${PORT}`));
io.on('connection', (s) => { s.emit('botlog', `Bot Status: ${botAPI ? 'Online' : 'Offline'}`); });


// --- MAIN COMMAND HANDLER ---
async function handleMessage(api, event) {
  try {
    const { threadID, senderID, body } = event;
    const isAdmin = senderID === adminID;
    
    if (!body || !body.startsWith(prefix)) return;

    const commandBody = body.slice(prefix.length).trim();
    const args = commandBody.split(/ +/);
    const command = args[0].toLowerCase();

    // --- 1. $HELP COMMAND ---
    if (command === 'help') {
        const helpMsg = `
🛠️ **𝐀𝐘𝐀𝐍𝐒𝐇 𝐁𝐎𝐓 𝐂𝐎𝐍𝐅𝐈𝐆** 🛠️
---------------------------
1️⃣ **Setup:**
   ${prefix}hatername <name>
   ${prefix}message fille <filename>
   ${prefix}random speed 1 <ms>
   ${prefix}random speed 2 <ms>

2️⃣ **Action:**
   ${prefix}now start  ➡️ Hamla Shuru
   ${prefix}now off    ➡️ Hamla Band

3️⃣ **Status:**
   ${prefix}say uptime ➡️ Kitna time hua
`;
        return api.sendMessage(helpMsg, threadID);
    }

    if (!isAdmin) return; 

    const config = getOrCreateConfig(threadID);

    // --- 2. $HATERNAME COMMAND ---
    if (command === 'hatername') {
        const name = args.slice(1).join(' ');
        if (!name) return api.sendMessage("❌ Naam to likh! Usage: $hatername Rahul", threadID);
        config.haterName = name;
        return api.sendMessage(`✅ Target Set: ${name}`, threadID);
    }

    // --- 3. $MESSAGE FILLE COMMAND ---
    if (commandBody.startsWith('message fille')) {
        const fileName = args.slice(2).join(' '); 
        if (!fileName) return api.sendMessage("❌ File name bata! Usage: $message fille np1.txt", threadID);
        const filePath = path.join(__dirname, fileName);
        if (!fs.existsSync(filePath)) return api.sendMessage(`❌ File '${fileName}' nahi mili.`, threadID);
        config.filePath = filePath;
        return api.sendMessage(`✅ File Locked: ${fileName}`, threadID);
    }

    // --- 4. $RANDOM SPEED COMMANDS ---
    if (commandBody.startsWith('random speed 1')) {
        const speed = parseInt(args[3]);
        if (isNaN(speed)) return api.sendMessage("❌ Number daal!", threadID);
        config.speed1 = speed;
        return api.sendMessage(`✅ Min Speed Set: ${speed}ms`, threadID);
    }

    if (commandBody.startsWith('random speed 2')) {
        const speed = parseInt(args[3]);
        if (isNaN(speed)) return api.sendMessage("❌ Number daal!", threadID);
        config.speed2 = speed;
        return api.sendMessage(`✅ Max Speed Set: ${speed}ms`, threadID);
    }

    // --- 5. $SAY UPTIME (NEW) ---
    if (commandBody.startsWith('say uptime')) {
        if (!config.isRunning || !config.startTime) {
            return api.sendMessage("❌ Abhi koi spam nahi chal raha.", threadID);
        }
        const duration = Date.now() - config.startTime;
        const timeString = formatTime(duration);
        return api.sendMessage(`⏳ **Spam Uptime:** ${timeString}`, threadID);
    }

    // --- 6. $NOW START / OFF ---
    if (commandBody.startsWith('now start')) {
        if (!config.haterName) return api.sendMessage("❌ Target name missing ($hatername)", threadID);
        if (!config.filePath) return api.sendMessage("❌ File missing ($message fille)", threadID);
        if (config.isRunning) return api.sendMessage("⚠️ Already running!", threadID);

        const messages = fs.readFileSync(config.filePath, 'utf8').split('\n').filter(l => l.trim());
        if (messages.length === 0) return api.sendMessage("❌ File khali hai!", threadID);

        config.isRunning = true;
        config.startTime = Date.now(); // Time start note kiya
        api.sendMessage(`😈 **ATTACK STARTED** 😈\nTarget: ${config.haterName}\nSpeed: Random (${config.speed1}-${config.speed2}ms)`, threadID);

        const spamLoop = () => {
            if (!config.isRunning) return;

            const msgLine = messages[config.msgIndex];
            const fullMsg = `${config.haterName} ${msgLine}\n\n😈 MR AAHAN HERE`;

            api.sendMessage(fullMsg, threadID).catch(err => emitLog("Spam Fail: " + err.message));
            config.msgIndex = (config.msgIndex + 1) % messages.length;

            const min = Math.min(config.speed1, config.speed2);
            const max = Math.max(config.speed1, config.speed2);
            const randomDelay = Math.floor(Math.random() * (max - min + 1)) + min;

            config.timer = setTimeout(spamLoop, randomDelay);
        };

        spamLoop(); 
    }

    if (commandBody.startsWith('now off')) {
        if (!config.isRunning) return api.sendMessage("❌ Kuch chal hi nahi raha.", threadID);
        config.isRunning = false;
        config.startTime = null;
        if (config.timer) clearTimeout(config.timer);
        api.sendMessage("🛑 **ATTACK STOPPED**", threadID);
    }

  } catch (err) {
    emitLog('Handler Error: ' + err.message, true);
  }
}

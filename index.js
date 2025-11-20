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
let currentCookies = null;
let reconnectAttempt = 0;
let joinedGroups = new Set();

// Har group ki alag setting store karne ke liye
let spamConfigs = {}; 

const signature = `\n                      ⚠️\n                  𝐀𝐘𝐀𝐍𝐒𝐇 𝐁𝐀𝐃𝐌𝐀𝐒𝐇 𝐇𝐄𝐑𝐄 ⚠️`;

// --- 1. UTILITY FUNCTIONS (AAPKA DIYA HUA CODE) ---
function emitLog(message, isError = false) {
  const logMessage = `[${new Date().toISOString()}] ${isError ? '❌ ERROR: ' : '✅ INFO: '}${message}`;
  console.log(logMessage);
  io.emit('botlog', logMessage);
}

function saveCookies() {
  if (!botAPI) {
    return;
  }
  try {
    const newAppState = botAPI.getAppState();
    const configToSave = {
      botNickname: botNickname,
      cookies: newAppState
    };
    fs.writeFileSync('config.json', JSON.stringify(configToSave, null, 2));
    // emitLog('✅ AppState auto-saved.'); // Log spam kam karne ke liye comment kiya hai
  } catch (e) {
    emitLog('❌ Failed to save AppState: ' + e.message, true);
  }
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
      speed1: 2000, 
      speed2: 5000, 
      isRunning: false,
      startTime: null, 
      timer: null,
      msgIndex: 0
    };
  }
  return spamConfigs[threadID];
}

// --- 2. BOT INITIALIZATION (AAPKA DIYA HUA LOGIC) ---
function initializeBot(cookies, prefixValue, adminIDValue) {
  emitLog('🚀 Initializing bot with ws3-fca...');
  currentCookies = cookies;
  if(prefixValue) prefix = prefixValue;
  if(adminIDValue) adminID = adminIDValue;
  reconnectAttempt = 0;

  login({ appState: currentCookies }, (err, api) => {
    if (err) {
      emitLog(`❌ Login error: ${err.message}. Retrying in 10 seconds.`, true);
      // Retry Logic
      setTimeout(() => initializeBot(currentCookies, prefix, adminID), 10000);
      return;
    }

    emitLog('✅ Bot successfully logged in.');
    botAPI = api;
    botAPI.setOptions({
      selfListen: true,
      listenEvents: true,
      updatePresence: false
    });

    // Setup Functions
    updateJoinedGroups(api);

    setTimeout(() => {
        setBotNicknamesInGroups();
        startListening(api);
    }, 5000);

    // Cookies Save Loop (Har 10 minute mein)
    setInterval(saveCookies, 600000);
  });
}

function startListening(api) {
  api.listenMqtt(async (err, event) => {
    if (err) return reconnectAndListen();
    try {
      if (event.type === 'message' || event.type === 'message_reply') {
        await handleMessage(api, event);
      } else if (event.logMessageType === 'log:subscribe') {
        if (event.logMessageData.addedParticipants.some(p => p.userFbId === api.getCurrentUserID())) {
            await api.changeNickname(botNickname, event.threadID, api.getCurrentUserID());
            await api.sendMessage(`😈 AAHAN BOT HERE`, event.threadID);
        }
      }
    } catch (e) {
      emitLog(`❌ Handler Error: ${e.message}`, true);
    }
  });
}

function reconnectAndListen() {
  reconnectAttempt++;
  if (botAPI) try { botAPI.stopListening(); } catch (e) {}

  if (reconnectAttempt > 5) {
    emitLog('❌ Reconnect failed. Restarting login process.', true);
    initializeBot(currentCookies, prefix, adminID);
  } else {
    setTimeout(() => {
      if (botAPI) startListening(botAPI);
      else initializeBot(currentCookies, prefix, adminID);
    }, 5000);
  }
}

// --- HELPER FUNCTIONS ---
async function setBotNicknamesInGroups() {
  if (!botAPI) return;
  try {
    const threads = await botAPI.getThreadList(20, null, ['GROUP']);
    const botID = botAPI.getCurrentUserID();
    for (const thread of threads) {
        try { await botAPI.changeNickname(botNickname, thread.threadID, botID); } catch (e) {}
        await new Promise(r => setTimeout(r, 1000));
    }
  } catch (e) {}
}

async function updateJoinedGroups(api) {
  try {
    const threads = await api.getThreadList(20, null, ['GROUP']);
    joinedGroups = new Set(threads.map(t => t.threadID));
  } catch (e) {}
}

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

// --- WEB SERVER ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));

// --- CONFIGURE ROUTE (SMART PARSER ADDED) ---
app.post('/configure', (req, res) => {
  try {
    let rawCookies = req.body.cookies;
    let cookies;
    
    // Koshish 1: JSON Parse
    try {
        cookies = JSON.parse(rawCookies);
    } catch (e) {
        // Koshish 2: Agar String hai to handle karo
        if (typeof rawCookies === 'string') {
             // Agar ye already object jaisa dikh raha hai par parse nahi hua
             return res.status(400).send('Invalid JSON. Check format.');
        }
        return res.status(400).send('Invalid Cookies.');
    }

    prefix = req.body.prefix || '/';
    adminID = req.body.adminID;

    res.send('Bot configured! Starting Login...');
    initializeBot(cookies, prefix, adminID);
    
  } catch (e) {
    if(!res.headersSent) res.status(400).send('Error: ' + e.message);
  }
});

// Auto-load config
try {
  if (fs.existsSync('config.json')) {
    const conf = JSON.parse(fs.readFileSync('config.json'));
    if (conf.cookies) {
        emitLog('✅ Auto-login from saved config...');
        initializeBot(conf.cookies, prefix, adminID);
    }
  }
} catch (e) {}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => emitLog(`✅ Server running on port ${PORT}`));
io.on('connection', (s) => { s.emit('botlog', `Bot Status: ${botAPI ? 'Online' : 'Offline'}`); });

// --- MAIN COMMAND HANDLER (Fighter Logic) ---
async function handleMessage(api, event) {
  try {
    const { threadID, senderID, body } = event;
    const isAdmin = senderID === adminID;
    
    if (!body || !body.startsWith(prefix)) return;

    const commandBody = body.slice(prefix.length).trim();
    const args = commandBody.split(/ +/);
    const command = args[0].toLowerCase();

    // $HELP
    if (command === 'help') {
        const helpMsg = `😈 **COMMANDS** 😈\n${prefix}hatername <name>\n${prefix}message fille <file>\n${prefix}random speed 1/2 <ms>\n${prefix}now start\n${prefix}now off\n${prefix}say uptime`;
        return api.sendMessage(helpMsg, threadID);
    }

    if (!isAdmin) return; 
    const config = getOrCreateConfig(threadID);

    // $HATERNAME
    if (command === 'hatername') {
        const name = args.slice(1).join(' ');
        if (!name) return api.sendMessage("❌ Name required", threadID);
        config.haterName = name;
        return api.sendMessage(`✅ Target: ${name}`, threadID);
    }

    // $MESSAGE FILLE
    if (commandBody.startsWith('message fille')) {
        const fileName = args.slice(2).join(' '); 
        if (!fileName) return api.sendMessage("❌ File name missing", threadID);
        const filePath = path.join(__dirname, fileName);
        if (!fs.existsSync(filePath)) return api.sendMessage(`❌ File '${fileName}' not found`, threadID);
        config.filePath = filePath;
        return api.sendMessage(`✅ File Locked: ${fileName}`, threadID);
    }

    // SPEEDS
    if (commandBody.startsWith('random speed 1')) {
        config.speed1 = parseInt(args[3]) || 2000;
        return api.sendMessage(`✅ Min Speed: ${config.speed1}ms`, threadID);
    }
    if (commandBody.startsWith('random speed 2')) {
        config.speed2 = parseInt(args[3]) || 5000;
        return api.sendMessage(`✅ Max Speed: ${config.speed2}ms`, threadID);
    }

    // $SAY UPTIME
    if (commandBody.startsWith('say uptime')) {
        if (!config.isRunning || !config.startTime) return api.sendMessage("❌ Not running.", threadID);
        return api.sendMessage(`⏳ Uptime: ${formatTime(Date.now() - config.startTime)}`, threadID);
    }

    // $NOW START
    if (commandBody.startsWith('now start')) {
        if (!config.haterName || !config.filePath) return api.sendMessage("❌ Setup incomplete!", threadID);
        if (config.isRunning) return api.sendMessage("⚠️ Already running!", threadID);

        const messages = fs.readFileSync(config.filePath, 'utf8').split('\n').filter(l => l.trim());
        if (messages.length === 0) return api.sendMessage("❌ Empty File!", threadID);

        config.isRunning = true;
        config.startTime = Date.now();
        api.sendMessage(`😈 **ATTACK STARTED** 😈\nTarget: ${config.haterName}`, threadID);

        const spamLoop = () => {
            if (!config.isRunning) return;
            
            const msgLine = messages[config.msgIndex];
            const fullMsg = `${config.haterName} ${msgLine}\n\n😈 MR AAHAN HERE`;

            api.sendMessage(fullMsg, threadID).catch(() => {});
            config.msgIndex = (config.msgIndex + 1) % messages.length;

            const min = Math.min(config.speed1, config.speed2);
            const max = Math.max(config.speed1, config.speed2);
            const randomDelay = Math.floor(Math.random() * (max - min + 1)) + min;

            config.timer = setTimeout(spamLoop, randomDelay);
        };
        spamLoop(); 
    }

    // $NOW OFF
    if (commandBody.startsWith('now off')) {
        if (!config.isRunning) return api.sendMessage("❌ Not running.", threadID);
        config.isRunning = false;
        config.startTime = null;
        if (config.timer) clearTimeout(config.timer);
        api.sendMessage("🛑 **ATTACK STOPPED**", threadID);
    }
  } catch (err) {
    emitLog('Handler Error: ' + err.message, true);
  }
}

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

function saveCookies() {
  if (!botAPI) return;
  try {
    const newAppState = botAPI.getAppState();
    const configToSave = { botNickname, cookies: newAppState };
    fs.writeFileSync('config.json', JSON.stringify(configToSave, null, 2));
    emitLog('✅ AppState saved.');
  } catch (e) {}
}

// --- 🟢 ORIGINAL LOGIN LOGIC (As Requested) ---

function initializeBot(cookies, prefixValue, adminIDValue) {
  emitLog('🚀 Initializing bot with ws3-fca...');
  currentCookies = cookies;
  if(prefixValue) prefix = prefixValue;
  if(adminIDValue) adminID = adminIDValue;
  reconnectAttempt = 0;

  login({ appState: currentCookies }, (err, api) => {
    if (err) {
      emitLog(`❌ Login error: ${err.message}. Retrying in 10 seconds.`, true);
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

    // Pehle thread list update karein
    updateJoinedGroups(api);

    // Delay ke baad baaki functions call karein (Old style)
    setTimeout(() => {
        setBotNicknamesInGroups();
        sendStartupMessage();
        startListening(api);
    }, 5000); 

    // Periodically save cookies every 10 minutes
    setInterval(saveCookies, 600000);
  });
}

function startListening(api) {
  api.listenMqtt(async (err, event) => {
    if (err) {
      emitLog(`❌ Listener error: ${err.message}. Attempting to reconnect...`, true);
      reconnectAndListen();
      return;
    }

    try {
      if (event.type === 'message' || event.type === 'message_reply') {
        await handleMessage(api, event);
      } else if (event.logMessageType === 'log:subscribe') {
        // Agar bot naye group me add ho
        if (event.logMessageData.addedParticipants.some(p => p.userFbId === api.getCurrentUserID())) {
            await api.changeNickname(botNickname, event.threadID, api.getCurrentUserID());
            await api.sendMessage(`😈 AAHAN BOT HERE`, event.threadID);
        }
      }
    } catch (e) {
      emitLog(`❌ Handler crashed: ${e.message}`, true);
    }
  });
}

function reconnectAndListen() {
  reconnectAttempt++;
  emitLog(`🔄 Reconnect attempt #${reconnectAttempt}...`, false);

  if (botAPI) {
    try { botAPI.stopListening(); } catch (e) {}
  }

  if (reconnectAttempt > 5) {
    emitLog('❌ Maximum reconnect attempts reached. Restarting login process.', true);
    initializeBot(currentCookies, prefix, adminID);
  } else {
    setTimeout(() => {
      if (botAPI) startListening(botAPI);
      else initializeBot(currentCookies, prefix, adminID);
    }, 5000);
  }
}

// --- HELPER FUNCTIONS (From Original Code) ---

async function setBotNicknamesInGroups() {
  if (!botAPI) return;
  try {
    const threads = await botAPI.getThreadList(20, null, ['GROUP']);
    const botID = botAPI.getCurrentUserID();
    for (const thread of threads) {
        try {
            const threadInfo = await botAPI.getThreadInfo(thread.threadID);
            if (threadInfo.nicknames[botID] !== botNickname) {
                await botAPI.changeNickname(botNickname, thread.threadID, botID);
            }
        } catch (e) {}
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (e) {}
}

async function sendStartupMessage() {
  // Optional startup message logic
  // emitLog('✅ Startup checks done.');
}

async function updateJoinedGroups(api) {
  try {
    const threads = await api.getThreadList(20, null, ['GROUP']);
    joinedGroups = new Set(threads.map(t => t.threadID));
  } catch (e) {}
}


// --- WEB SERVER (Original Configure Route) ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));

// YE RAHA PURANA WALA CONFIGURE ROUTE (Jo tumne manga tha)
app.post('/configure', (req, res) => {
  try {
    const cookies = JSON.parse(req.body.cookies);
    prefix = req.body.prefix || '/';
    adminID = req.body.adminID;

    if (!Array.isArray(cookies) || cookies.length === 0) {
      return res.status(400).send('Error: Invalid cookies format.');
    }
    if (!adminID) {
      return res.status(400).send('Error: Admin ID is required.');
    }

    res.send('Bot configured successfully! Starting...');
    initializeBot(cookies, prefix, adminID);
  } catch (e) {
    res.status(400).send('Error: Invalid configuration.');
    emitLog('Configuration error: ' + e.message, true);
  }
});

// Load Config on Start
try {
  if (fs.existsSync('config.json')) {
    const conf = JSON.parse(fs.readFileSync('config.json'));
    if (conf.cookies) {
        emitLog('✅ Cookies found. Auto-login...');
        initializeBot(conf.cookies, prefix, adminID);
    }
  }
} catch (e) {}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => emitLog(`✅ Server running on port ${PORT}`));
io.on('connection', (s) => { s.emit('botlog', `Bot Status: ${botAPI ? 'Online' : 'Offline'}`); });


// --- MAIN COMMAND HANDLER (New Features) ---
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

    // --- 2. $HATERNAME ---
    if (command === 'hatername') {
        const name = args.slice(1).join(' ');
        if (!name) return api.sendMessage("❌ Naam likh! Usage: $hatername Rahul", threadID);
        config.haterName = name;
        return api.sendMessage(`✅ Target Set: ${name}`, threadID);
    }

    // --- 3. $MESSAGE FILLE ---
    if (commandBody.startsWith('message fille')) {
        const fileName = args.slice(2).join(' '); 
        if (!fileName) return api.sendMessage("❌ File name bata! Usage: $message fille np1.txt", threadID);
        const filePath = path.join(__dirname, fileName);
        if (!fs.existsSync(filePath)) return api.sendMessage(`❌ File '${fileName}' nahi mili.`, threadID);
        config.filePath = filePath;
        return api.sendMessage(`✅ File Locked: ${fileName}`, threadID);
    }

    // --- 4. SPEEDS ---
    if (commandBody.startsWith('random speed 1')) {
        config.speed1 = parseInt(args[3]) || 2000;
        return api.sendMessage(`✅ Min Speed: ${config.speed1}ms`, threadID);
    }
    if (commandBody.startsWith('random speed 2')) {
        config.speed2 = parseInt(args[3]) || 5000;
        return api.sendMessage(`✅ Max Speed: ${config.speed2}ms`, threadID);
    }

    // --- 5. $SAY UPTIME ---
    if (commandBody.startsWith('say uptime')) {
        if (!config.isRunning || !config.startTime) return api.sendMessage("❌ Abhi koi spam nahi chal raha.", threadID);
        return api.sendMessage(`⏳ **Spam Uptime:** ${formatTime(Date.now() - config.startTime)}`, threadID);
    }

    // --- 6. $NOW START ---
    if (commandBody.startsWith('now start')) {
        if (!config.haterName) return api.sendMessage("❌ Target name missing", threadID);
        if (!config.filePath) return api.sendMessage("❌ File missing", threadID);
        if (config.isRunning) return api.sendMessage("⚠️ Already running!", threadID);

        const messages = fs.readFileSync(config.filePath, 'utf8').split('\n').filter(l => l.trim());
        if (messages.length === 0) return api.sendMessage("❌ File khali hai!", threadID);

        config.isRunning = true;
        config.startTime = Date.now();
        api.sendMessage(`😈 **ATTACK STARTED** 😈\nTarget: ${config.haterName}`, threadID);

        const spamLoop = () => {
            if (!config.isRunning) return;
            
            const msgLine = messages[config.msgIndex];
            const fullMsg = `${config.haterName} ${msgLine}\n\n😈 MR AAHAN HERE`;

            api.sendMessage(fullMsg, threadID).catch(err => emitLog("Spam Fail"));
            config.msgIndex = (config.msgIndex + 1) % messages.length;

            const min = Math.min(config.speed1, config.speed2);
            const max = Math.max(config.speed1, config.speed2);
            const randomDelay = Math.floor(Math.random() * (max - min + 1)) + min;

            config.timer = setTimeout(spamLoop, randomDelay);
        };
        spamLoop(); 
    }

    // --- 7. $NOW OFF ---
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

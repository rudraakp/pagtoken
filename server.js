const express = require('express');
const bodyParser = require('body-parser');
const login = require('ws3-fca');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer'); // File upload ke liye

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- FILE UPLOAD SETUP ---
const upload = multer({ dest: 'uploads/' }); // Files 'uploads' folder me save hongi

// --- GLOBAL STATE ---
let botAPI = null;
let currentCookies = null;
let spamSession = {
  active: false,
  interval: null,
  postID: null
};

// --- UTILITY LOGS ---
function emitLog(message, isError = false) {
  const logMessage = `[${new Date().toISOString()}] ${isError ? '❌ ERROR: ' : '✅ INFO: '}${message}`;
  console.log(logMessage);
  io.emit('botlog', logMessage);
}

// --- LOGIN LOGIC (UNTOUCHED) ---
// Aapne mana kiya tha isse chedhne ko, ye waisa ka waisa hai
function initializeBot(cookies) {
  emitLog('🚀 Initializing bot for Post Spam...');
  currentCookies = cookies;

  login({ appState: currentCookies }, (err, api) => {
    if (err) {
      emitLog(`❌ Login error: ${err.message}. Retrying in 10 seconds.`, true);
      setTimeout(() => initializeBot(currentCookies), 10000);
      return;
    }

    emitLog('✅ Bot successfully logged in. Ready for Post Spam.');
    botAPI = api;
    botAPI.setOptions({
      selfListen: true,
      listenEvents: true,
      updatePresence: false
    });
    
    // Auto-save cookies logic same rahega
  });
}

// --- WEB SERVER (DASHBOARD) ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// 1. CONFIG ROUTE (Login ke liye)
app.post('/configure', (req, res) => {
  try {
    const cookies = JSON.parse(req.body.cookies);
    if (!Array.isArray(cookies)) return res.status(400).send('Invalid cookies.');
    res.send('Bot starting...');
    initializeBot(cookies);
  } catch (e) {
    res.status(400).send('Config Error');
  }
});

// 2. START SPAM ROUTE (Post UID, Speed, Files)
app.post('/start-spam', upload.fields([{ name: 'msgFile' }, { name: 'haterFile' }]), (req, res) => {
  if (!botAPI) return res.status(400).send('Pehle Bot Login karo!');

  const postID = req.body.postID;
  const speed = parseInt(req.body.speed) * 1000; // Seconds to MS

  if (!req.files['msgFile'] || !req.files['haterFile']) {
    return res.status(400).send('Dono files (Message & Hater Name) upload karo!');
  }
  if (!postID || !speed) {
    return res.status(400).send('Post UID aur Speed zaroori hai.');
  }

  // Files read karo
  const msgPath = req.files['msgFile'][0].path;
  const haterPath = req.files['haterFile'][0].path;

  const messages = fs.readFileSync(msgPath, 'utf8').split('\n').filter(l => l.trim() !== '');
  const haters = fs.readFileSync(haterPath, 'utf8').split('\n').filter(l => l.trim() !== '');

  // Purana session band karo
  if (spamSession.active) clearInterval(spamSession.interval);

  emitLog(`🚀 Starting Spam on Post: ${postID} with Speed: ${speed/1000}s`);

  let msgIndex = 0;
  let haterIndex = 0;

  spamSession.active = true;
  spamSession.postID = postID;

  spamSession.interval = setInterval(() => {
    if (!botAPI) return;

    const msg = messages[msgIndex];
    const hater = haters[haterIndex];
    
    // Comment format: "HaterName Gali"
    const finalComment = `${hater} ${msg}`;

    botAPI.comment(finalComment, postID, (err) => {
      if (err) {
        emitLog(`❌ Comment Failed: ${err.message}`, true);
      } else {
        emitLog(`✅ Commented: ${finalComment}`);
      }
    });

    // Loop Indexes
    msgIndex = (msgIndex + 1) % messages.length;
    haterIndex = (haterIndex + 1) % haters.length;

  }, speed);

  // Clean up uploaded files to save space
  fs.unlinkSync(msgPath);
  fs.unlinkSync(haterPath);

  res.send(`Spam Started on Post ${postID}`);
});

// 3. STOP SPAM ROUTE
app.post('/stop-spam', (req, res) => {
  if (spamSession.active) {
    clearInterval(spamSession.interval);
    spamSession.active = false;
    emitLog('🛑 Spam Stopped manually.');
    res.send('Spam Stopped.');
  } else {
    res.send('Already stopped.');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => emitLog(`✅ Server running on port ${PORT}`));

// Socket Connection for Logs
io.on('connection', (socket) => {
  socket.emit('botlog', `Bot Status: ${botAPI ? 'Logged In' : 'Waiting...'}`);
});

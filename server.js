const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// Port 8080 (Zeabur compatible)
const PORT = process.env.PORT || 8080;

// AppState bada hota hai isliye limit badhai hai
app.use(bodyParser.json({ limit: '50mb' }));

// Public folder serve karna (HTML file ke liye)
app.use(express.static(path.join(__dirname, 'public')));

// API Endpoint: AppState se EAAB Token nikalna
app.post('/get-eaab', async (req, res) => {
    const { appState } = req.body;

    if (!appState) {
        return res.status(400).json({ status: 'error', message: 'AppState khali hai!' });
    }

    try {
        // Step 1: AppState JSON ko Cookie String banana
        let cookieString;
        try {
            const state = typeof appState === 'string' ? JSON.parse(appState) : appState;
            cookieString = state.map(item => `${item.key}=${item.value}`).join('; ');
        } catch (e) {
            return res.status(400).json({ status: 'error', message: 'Invalid JSON Format. Sahi AppState paste karo.' });
        }

        // Step 2: Ads Manager se request karna (EAAB ke liye)
        const response = await axios.get('https://adsmanager.facebook.com/adsmanager/manage/campaigns', {
            headers: {
                'cookie': cookieString,
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'sec-fetch-site': 'same-origin'
            }
        });

        const html = response.data;

        // Step 3: EAAB Token Dhundna
        const tokenMatch = html.match(/access_token:"(EAAB.*?)"/);

        if (tokenMatch && tokenMatch[1]) {
            res.json({ 
                status: 'success', 
                token: tokenMatch[1] 
            });
        } else {
            res.status(400).json({ status: 'failed', message: 'Token nahi mila. Cookies expire ho sakti hain ya Ads Manager open nahi ho raha.' });
        }

    } catch (error) {
        console.error("Error details:", error.message);
        res.status(500).json({ status: 'error', message: 'Server Error: ' + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
    

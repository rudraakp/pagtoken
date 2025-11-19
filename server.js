const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// Yahan maine PORT 8080 kar diya hai
// process.env.PORT isliye rakha hai taaki Zeabur agar apna port de to error na aaye
const PORT = process.env.PORT || 8080;

// AppState limit increased
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public'))); 

// API Endpoint: AppState to EAAB Token (Best for Commenting)
app.post('/get-eaab', async (req, res) => {
    const { appState } = req.body;

    if (!appState) {
        return res.status(400).json({ status: 'error', message: 'AppState nahi mila!' });
    }

    try {
        // 1. Cookie String banana
        let cookieString;
        try {
            const state = typeof appState === 'string' ? JSON.parse(appState) : appState;
            cookieString = state.map(item => `${item.key}=${item.value}`).join('; ');
        } catch (e) {
            return res.status(400).json({ status: 'error', message: 'AppState ka format galat hai.' });
        }

        // 2. Request to Ads Manager
        const response = await axios.get('https://adsmanager.facebook.com/adsmanager/manage/campaigns', {
            headers: {
                'cookie': cookieString,
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'sec-fetch-site': 'same-origin'
            }
        });

        const html = response.data;

        // 3. Extract EAAB Token
        const tokenMatch = html.match(/access_token:"(EAAB.*?)"/);

        if (tokenMatch && tokenMatch[1]) {
            res.json({ 
                status: 'success', 
                token: tokenMatch[1],
                message: 'Token mil gaya! Loader me lagao.'
            });
        } else {
            res.status(400).json({ status: 'failed', message: 'Token nahi mila. Cookies shayad expire hain.' });
        }

    } catch (error) {
        console.error(error.message);
        res.status(500).json({ status: 'error', message: 'Server Error: ' + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

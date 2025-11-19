const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 8080;

// AppState bada hota hai, isliye limit badhai hai
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // Public folder serve karega

// API Endpoint
app.post('/get-eaad', async (req, res) => {
    const { appState } = req.body;

    if (!appState) {
        return res.status(400).json({ status: 'error', message: 'AppState khali hai!' });
    }

    try {
        // AppState (JSON) ko String Cookies banana
        let cookieString;
        try {
            const state = typeof appState === 'string' ? JSON.parse(appState) : appState;
            cookieString = state.map(item => `${item.key}=${item.value}`).join('; ');
        } catch (e) {
            return res.status(400).json({ status: 'error', message: 'Invalid JSON format' });
        }

        // Request bhejna Events Manager par
        const response = await axios.get('https://business.facebook.com/events_manager2/browser_api_calls_setup', {
            headers: {
                'cookie': cookieString,
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'sec-fetch-site': 'same-origin'
            }
        });

        const html = response.data;
        const tokenMatch = html.match(/access_token:"(EAAD.*?)"/);

        if (tokenMatch && tokenMatch[1]) {
            res.json({ status: 'success', token: tokenMatch[1] });
        } else {
            res.status(400).json({ status: 'failed', message: 'Token nahi mila. Cookies expire ho sakti hain.' });
        }

    } catch (error) {
        console.error(error.message);
        res.status(500).json({ status: 'error', message: 'Server Error: ' + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Tool chal gaya hai: http://localhost:${PORT}`);
});

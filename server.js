const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Function: Fake Headers generate karna taaki FB block na kare
const getHeaders = (cookieString) => {
    return {
        'cookie': cookieString,
        'authority': 'adsmanager.facebook.com',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'max-age=0',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
};

app.post('/get-eaab', async (req, res) => {
    const { appState } = req.body;

    if (!appState) {
        return res.status(400).json({ status: 'error', message: 'AppState khali hai!' });
    }

    try {
        // Cookies banao
        let cookieString;
        try {
            const state = typeof appState === 'string' ? JSON.parse(appState) : appState;
            cookieString = state.map(item => `${item.key}=${item.value}`).join('; ');
        } catch (e) {
            return res.status(400).json({ status: 'error', message: 'Invalid AppState JSON' });
        }

        console.log("Attempting Method 1: Ads Manager Campaigns...");
        
        // METHOD 1: Standard Ads Manager
        try {
            const response1 = await axios.get('https://adsmanager.facebook.com/adsmanager/manage/campaigns', {
                headers: getHeaders(cookieString)
            });
            
            const tokenMatch1 = response1.data.match(/access_token:"(EAAB.*?)"/);
            if (tokenMatch1 && tokenMatch1[1]) {
                return res.json({ status: 'success', token: tokenMatch1[1], source: 'Method 1' });
            }
        } catch (err) {
            console.log("Method 1 Failed, trying Method 2...");
        }

        console.log("Attempting Method 2: Account Billing (Hidden)...");

        // METHOD 2: Billing Page (Ye aksar hidden token nikal deta hai)
        try {
            const response2 = await axios.get('https://www.facebook.com/ads/manager/account_settings/account_billing/', {
                headers: getHeaders(cookieString)
            });

            const tokenMatch2 = response2.data.match(/access_token:"(EAAB.*?)"/);
            if (tokenMatch2 && tokenMatch2[1]) {
                return res.json({ status: 'success', token: tokenMatch2[1], source: 'Method 2' });
            }
        } catch (err) {
            console.log("Method 2 also failed.");
        }

        // Agar dono fail ho gaye
        res.status(400).json({ 
            status: 'failed', 
            message: 'Token nahi mila! Tip: Browser me "adsmanager.facebook.com" khol kar dekho ki account active hai ya nahi.' 
        });

    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

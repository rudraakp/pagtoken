const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ✅ GitHub Links (Jo tumne diye the)
const GITHUB_MSG_URL = 'https://raw.githubusercontent.com/rudraakp/pagtoken/main/message.txt';
const GITHUB_NAME_URL = 'https://raw.githubusercontent.com/rudraakp/pagtoken/main/hatername.txt';

const formatCookies = (input) => {
    try {
        if (typeof input === 'object' || (typeof input === 'string' && input.trim().startsWith('['))) {
            const state = typeof input === 'string' ? JSON.parse(input) : input;
            return state.map(item => `${item.key}=${item.value}`).join('; ');
        }
        return input.replace(/[\r\n]+/g, '');
    } catch (e) { return input; }
};

const getHeaders = (cookie) => {
    return {
        'cookie': cookie,
        'authority': 'mbasic.facebook.com',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        // User Agent Updated for better compatibility
        'user-agent': 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36',
        'sec-fetch-site': 'same-origin',
        'upgrade-insecure-requests': '1'
    };
};

app.post('/run-loader', async (req, res) => {
    let { cookies, postId, msgIndex } = req.body;

    if (!cookies || !postId) {
        return res.status(400).json({ status: 'error', message: 'Cookies aur Post ID chahiye!' });
    }

    const validCookie = formatCookies(cookies);

    try {
        // 1. Fetch Messages from GitHub
        let messages = ["System Active"];
        let haterName = "";

        try {
            const [msgResponse, nameResponse] = await Promise.all([
                axios.get(GITHUB_MSG_URL),
                axios.get(GITHUB_NAME_URL)
            ]);
            messages = msgResponse.data.split('\n').filter(line => line.trim() !== '');
            haterName = nameResponse.data.trim();
            if (messages.length === 0) messages.push("System OP");
        } catch (err) {
            console.log("GitHub Fetch Error (Using Default)");
        }

        const currentMsg = messages[msgIndex % messages.length]; 
        const finalComment = `${haterName} ${currentMsg}`.trim();

        console.log(`Target: ${postId} | Comment: ${finalComment}`);

        // 2. Load Post Page
        const pageUrl = `https://mbasic.facebook.com/${postId}`;
        const pageResponse = await axios.get(pageUrl, { headers: getHeaders(validCookie) });
        const html = pageResponse.data;

        // 🔥 FIXED: Universal Regex (Ye har tarah ka form pakdega) 🔥
        const fb_dtsg = html.match(/name="fb_dtsg" value="(.*?)"/)?.[1];
        const jazoest = html.match(/name="jazoest" value="(.*?)"/)?.[1];
        
        // Yahan change kiya hai: Ab ye ?fs= nahi dhundega, balki koi bhi comment url utha lega
        const actionMatch = html.match(/action="(\/a\/comment.php.*?)"/);

        if (!fb_dtsg || !actionMatch) {
            // Debugging ke liye: Agar fail hua to check karo ki login page to nahi aaya
            if(html.includes('Log In') || html.includes('login_form')) {
                return res.status(400).json({ status: 'failed', message: 'Cookies Expire hain (Login Page aaya).' });
            }
            return res.status(400).json({ status: 'failed', message: 'Post Token nahi mila. ID check karo.' });
        }

        const actionUrl = `https://mbasic.facebook.com${actionMatch[1].replace(/&amp;/g, '&')}`;

        // 3. Post Comment
        const formData = new URLSearchParams();
        formData.append('fb_dtsg', fb_dtsg);
        formData.append('jazoest', jazoest);
        formData.append('comment_text', finalComment);

        await axios.post(actionUrl, formData, {
            headers: {
                ...getHeaders(validCookie),
                'content-type': 'application/x-www-form-urlencoded',
                'referer': pageUrl
            }
        });

        res.json({ 
            status: 'success', 
            message: `Comment Sent: ${finalComment}`,
            nextIndex: (msgIndex + 1) % messages.length 
        });

    } catch (error) {
        console.error(error.message);
        res.status(500).json({ status: 'error', message: 'Error: ' + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Universal Loader running on port ${PORT}`);
});

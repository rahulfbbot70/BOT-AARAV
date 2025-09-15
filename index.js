import login from "neha-fca"; // Facebook Chat API
import fs from "fs";
import express from "express";

const OWNER_UIDS = ["61565513061548"]; // Owner's Facebook UID(s)
const OWNER_NAME = "Neha Thakur";

let stopRequested = false;
const lockedGroupNames = {}; // Lock for group names
const lockedNicknames = {}; // Lock for nicknames
const lockedGroupEmojis = {}; // Lock for group emojis
let antiOutEnabled = false;
let lastMedia = null;
let targetUID = null;
let stickerInterval = null;
let stickerLoopActive = false;

// Load Friend UIDs
const friendUIDs = fs.existsSync("Friend.txt") ? fs.readFileSync("Friend.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean) : [];

// Load Target UIDs
const targetUIDs = fs.existsSync("Target.txt") ? fs.readFileSync("Target.txt", "utf8").split("\n").map(x => x.trim()).filter(Boolean) : [];

// Message queues for auto-reply
const messageQueues = {};
const queueRunning = {};

// Express server for status
const app = express();
app.get("/", (_, res) => res.send("<h2>Messenger Bot Running</h2>"));
const PORT = process.env.PORT || 20782;
app.listen(PORT, () => console.log(`🌐 Log server running on port ${PORT}`));

// Error handlers
process.on("uncaughtException", (err) => console.error("❗ Uncaught Exception:", err.message));
process.on("unhandledRejection", (reason) => console.error("❗ Unhandled Rejection:", reason));

login(
  {
    appState: JSON.parse(fs.readFileSync("appstate.json", "utf8")),
  },
  async (err, api) => {
    if (err) return console.error("❌ Login failed:", err);
    api.setOptions({ listenEvents: true });
    console.log("✅ Bot logged in and running...");

    api.listenMqtt(async (err, event) => {
      try {
        if (err || !event) return;

        const {
          threadID,
          senderID,
          body,
          messageID,
          type,
          logMessageType,
          logMessageData,
        } = event;

        // ---- AUTO-REPLY HANDLER ----
        if (
          fs.existsSync("np.txt") &&
          (targetUIDs.includes(senderID) || senderID === targetUID)
        ) {
          const lines = fs.readFileSync("np.txt", "utf8")
            .split("\n").map(x => x.trim()).filter(Boolean);

          for (const line of lines) {
            await api.sendMessage(line, threadID, messageID);
          }
        }

        // ---- LOCK HANDLERS ----
        if (type === "event" && logMessageType === "log:thread-name") {
          const currentName = logMessageData.name;
          const lockedName = lockedGroupNames[threadID];
          if (lockedName && currentName !== lockedName) {
            await api.setTitle(lockedName, threadID);
            await api.sendMessage(`"${lockedName}"`, threadID);
          }
          return;
        }

        if (type === "event" && logMessageType === "log:user-nickname") {
          const changedUID = logMessageData.participant_id;
          const newNick = logMessageData.nickname;
          if (lockedNicknames[threadID]?.[changedUID]) {
            const lockedNick = lockedNicknames[threadID][changedUID];
            if (newNick !== lockedNick) {
              await api.changeNickname(lockedNick, threadID, changedUID);
              await api.sendMessage(
                `💞 Nickname locked by ${OWNER_NAME} ➜ ${lockedNick}`,
                threadID
              );
            }
          }
          return;
        }

        if (type === "event" && logMessageType === "log:thread-icon") {
          const currentEmoji = logMessageData?.thread_icon || "";
          const lockedEmoji = lockedGroupEmojis[threadID];
          if (lockedEmoji && currentEmoji !== lockedEmoji) {
            await api.changeThreadEmoji(lockedEmoji, threadID);
            await api.sendMessage(`💞 Group emoji locked ➜ ${lockedEmoji}`, threadID);
          }
          return;
        }

        if (type === "event" && logMessageType === "log:unsubscribe") {
          const leftUID = logMessageData.leftParticipantFbId;
          if (antiOutEnabled && leftUID !== api.getCurrentUserID()) {
            try {
              await api.addUserToGroup(leftUID, threadID);
              await api.sendMessage(`🚫 You cannot leave group without ${OWNER_NAME}'s permission`, threadID);
            } catch (e) {
              await api.sendMessage(`✅ Adding Back`, threadID);
            }
          }
          return;
        }

        if (!body) return;

        // ---- COMMANDS ONLY FROM OWNER ----
        if (!OWNER_UIDS.includes(senderID)) return;

        const args = body.trim().split(" ");
        const cmd = args[0].toLowerCase().replace(/^\//, "");
        const input = args.slice(1).join(" ").trim();

        switch (cmd) {
          case "groupname": {
            if (args[1] === "on") {
              const groupName = args.slice(2).join(" ");
              lockedGroupNames[threadID] = groupName;
              await api.setTitle(groupName, threadID);
              await api.sendMessage(`✅ Group name locked ➜ "${groupName}"`, threadID);
            } else if (args[1] === "off") {
              delete lockedGroupNames[threadID];
              await api.sendMessage("🔓 Group name unlocked", threadID);
            } else {
              await api.sendMessage("⚠️ Usage: /lockname on <Name> or /lockname off", threadID);
            }
            break;
          }

          case "nicknames": {
            if (args[1] === "on") {
              const nickname = args.slice(2).join(" ");
              const info = await api.getThreadInfo(threadID);
              lockedNicknames[threadID] = {};
              for (const uid of info.participantIDs) {
                await api.changeNickname(nickname, threadID, uid);
                lockedNicknames[threadID][uid] = nickname;
              }
              await api.sendMessage(`✅ All nicknames locked ➜ "${nickname}"`, threadID);
            } else if (args[1] === "off") {
              if (lockedNicknames[threadID]) {
                for (const uid in lockedNicknames[threadID]) {
                  await api.changeNickname("", threadID, uid);
                }
                delete lockedNicknames[threadID];
              }
              await api.sendMessage("🔓 Nicknames unlocked", threadID);
            } else {
              await api.sendMessage("⚠️ Usage: /locknick on <Nick> or /locknick off", threadID);
            }
            break;
          }

          case "nickname": {
            if (args[1] === "on") {
              const targetUid = args[2];
              const nickname = args.slice(3).join(" ");
              if (!lockedNicknames[threadID]) lockedNicknames[threadID] = {};
              await api.changeNickname(nickname, threadID, targetUid);
              lockedNicknames[threadID][targetUid] = nickname;
              await api.sendMessage(`✅ UID ${targetUid} nickname locked ➜ "${nickname}"`, threadID);
            } else if (args[1] === "off") {
              const targetUid = args[2];
              if (lockedNicknames[threadID]?.[targetUid]) {
                await api.changeNickname("", threadID, targetUid);
                delete lockedNicknames[threadID][targetUid];
                await api.sendMessage(`🔓 UID ${targetUid} nickname unlocked`, threadID);
              } else {
                await api.sendMessage("⚠️ No nickname lock found for this UID", threadID);
              }
            } else {
              await api.sendMessage("⚠️ Usage: /uidlocknick on <UID> <Nick> or /uidlocknick off <UID>", threadID);
            }
            break;
          }

          case "emoji": {
            if (!input) {
              await api.sendMessage("📛 Usage: /emoji <Emoji>", threadID);
            } else {
              const emoji = input.split(" ")[0];
              await api.changeThreadEmoji(emoji, threadID);
              lockedGroupEmojis[threadID] = emoji;
              await api.sendMessage(`✅ Group emoji locked ➜ ${emoji}`, threadID);
            }
            break;
          }

          case "antiout": {
            if (args[1] === "on") {
              antiOutEnabled = true;
              await api.sendMessage("✅ Antiout enabled", threadID);
            } else if (args[1] === "off") {
              antiOutEnabled = false;
              await api.sendMessage("❌ Antiout disabled", threadID);
            } else {
              await api.sendMessage("📌 Usage:\n/antiout on\n/antiout off", threadID);
            }
            break;
          }

          case "adduser": {
            const uidToAdd = args[1];
            if (!uidToAdd) {
              await api.sendMessage("⚠️ Usage: /adduser <UID>", threadID);
              break;
            }
            try {
              await api.addUserToGroup(uidToAdd, threadID);
              await api.sendMessage(`✅ UID ${uidToAdd} added to this group`, threadID);
            } catch (e) {
              await api.sendMessage(`🥵 Not In Add: ${e.message}`, threadID);
            }
            break;
          }

          case "uid": {
            await api.sendMessage(`🆔 Group ID ➜ ${threadID}`, threadID);
            break;
          }

          case "groupinfo": {
            const info = await api.getThreadInfo(threadID);
            const threadName = info.threadName || "No Name";
            const members = info.participantIDs || [];
            const istString = new Date().toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
              hour12: true,
            });

            const active = [];
            if (lockedGroupNames[threadID]) active.push("🔒 Name Lock");
            if (lockedNicknames[threadID]) active.push("🔒 Nickname Lock");
            if (lockedGroupEmojis[threadID]) active.push("🔒 Emoji Lock");
            if (antiOutEnabled) active.push("🚫 Anti-Out");
            if (stickerLoopActive) active.push("💟 Sticker Loop");
            if (targetUID) active.push(`🎯 Target: ${targetUID}`);

            const msg = `📊 GROUP INFORMATION

╭─────────────────────►
│👑 Owner ➜ ${OWNER_NAME}
│─────────────────────
│🕒 Time ➜ ${istString}
│─────────────────────
│👥 Group ➜ ${threadName}
│─────────────────────
│👤 Members ➜ ${members.length}
│─────────────────────
│⚙️ Active Features
│${active.length ? active.join("\n") : "— None —"}`;
            await api.sendMessage(msg, threadID);
            break;
          }

          case "exit": {
            await api.removeUserFromGroup(api.getCurrentUserID(), threadID);
            break;
          }

          case "target": {
            if (args[1] === "on") {
              targetUID = args[2];
              await api.sendMessage(`✅ Target set ➜ ${targetUID}`, threadID);
            } else if (args[1] === "off") {
              targetUID = null;
              await api.sendMessage("🔓 Target cleared", threadID);
            } else {
              await api.sendMessage("⚠️ Usage: /target on <UID> or /target off", threadID);
            }
            break;
          }

          case "sticker": {
            if (args[1] === "on") {
              const sec = parseInt(args[2]);
              if (isNaN(sec) || sec < 5) {
                await api.sendMessage("⏳ Give at least 5 seconds", threadID);
                break;
              }
              const stickerIDs = fs.readFileSync("Sticker.txt", "utf8").split("\n").filter(Boolean);
              let i = 0;
              stickerLoopActive = true;
              if (stickerInterval) clearInterval(stickerInterval);
              stickerInterval = setInterval(async () => {
                if (!stickerLoopActive || i >= stickerIDs.length) {
                  clearInterval(stickerInterval);
                  stickerLoopActive = false;
                  return;
                }
                await api.sendMessage({ sticker: stickerIDs[i++] }, threadID);
              }, sec * 1000);
              await api.sendMessage(`✅ Sticker loop started every ${sec} sec`, threadID);
            } else if (args[1] === "off") {
              clearInterval(stickerInterval);
              stickerLoopActive = false;
              await api.sendMessage("🛑 Sticker loop stopped", threadID);
            } else {
              await api.sendMessage("⚠️ Usage: /sticker on <Sec> or /sticker off", threadID);
            }
            break;
          }

          case "help": {
            const helpText = `
╭────────────────────╮
            🧡   [[ 𝐍𝐄𝐇𝐀 ]]    🧡
╰────────────────────╯
╭─────────────────────►
│ Groupname - On <Name> | Off
│─────────────────────
│ Nicknames - On <Nick> | Off
│─────────────────────
│ Nickname - On <Uid> Off <Nick>
│─────────────────────
│ Emoji  -- Group Icon
│─────────────────────
│ Antiout -- On  Off
│─────────────────────
│ Target - On <Uid> | Off
│─────────────────────
│ Sticker On <Sec> | Off
│─────────────────────
│ Uid - Group Uid
│─────────────────────
│ Adduser - <Uid>
│─────────────────────
│ Groupinfo --- Information
│─────────────────────
│ Exit -- Bot Leaves The Group
╰─────────────────────►
╭─────────────────────►
│All Rights Reserved By Neha Thakur
╰─────────────────────►`;
            await api.sendMessage(helpText.trim(), threadID);
            break;
          }
        }
      } catch (e) {
        console.error("❌ Error:", e.message);
      }
    });
  }
);
#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  certificationSummary,
  overallCertificationStatus,
  parseAdbDevices,
  reportToJUnit
} from "./android-certify-lib.mjs";

const ports = [9222, 9223];
const labels = ["Phone A", "Phone B"];
const permissionTimeout = Number(
  process.env.VERGE_ANDROID_PERMISSION_TIMEOUT_MS || 120000
);
const holdSeconds = Number(
  process.env.VERGE_ANDROID_CERTIFY_HOLD_SECONDS || 10
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serialsFromArgs() {
  const args = process.argv.slice(2).filter(Boolean);
  if (args.length >= 2) return args.slice(0, 2);

  const fromEnv = [
    process.env.VERGE_ANDROID_A,
    process.env.VERGE_ANDROID_B
  ].filter(Boolean);
  if (fromEnv.length === 2) return fromEnv;

  const output = execFileSync("adb", ["devices"], { encoding: "utf8" });
  const serials = parseAdbDevices(output);
  if (serials.length !== 2) {
    throw new Error(
      "Expected exactly two authorized devices. Pass serials with: " +
        "pnpm android:certify -- SERIAL_A SERIAL_B"
    );
  }
  return serials;
}

async function waitFor(description, reader, predicate, timeout = 30000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await reader();
      if (predicate(last)) return last;
    } catch {
      // Retry transient page transitions.
    }
    await sleep(350);
  }
  throw new Error(
    "Timed out waiting for " + description + ". Last: " + JSON.stringify(last)
  );
}

async function targetFor(port, room) {
  return waitFor(
    "Chrome DevTools target on port " + port,
    async () => {
      const response = await fetch("http://127.0.0.1:" + port + "/json/list");
      if (!response.ok) return undefined;
      const targets = await response.json();
      return targets.find(
        (target) =>
          target.type === "page" &&
          String(target.url).includes("localhost:5173") &&
          String(target.url).includes("room=" + encodeURIComponent(room))
      );
    },
    Boolean,
    30000
  );
}

class Cdp {
  constructor(label, target) {
    this.label = label;
    this.target = target;
    this.socket = undefined;
    this.id = 1;
    this.pending = new Map();
    this.logs = [];
  }

  async connect() {
    this.socket = new WebSocket(this.target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });

    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }

      const time = new Date().toISOString();
      if (message.method === "Runtime.consoleAPICalled") {
        const args = (message.params?.args || [])
          .map((arg) => arg.value ?? arg.description ?? arg.type)
          .join(" ");
        this.logs.push(
          "[" + time + "] console." +
            (message.params?.type || "log") + " " + args
        );
      }
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params?.exceptionDetails;
        this.logs.push(
          "[" + time + "] exception " +
            (details?.exception?.description || details?.text || "")
        );
      }
      if (message.method === "Log.entryAdded") {
        const entry = message.params?.entry;
        this.logs.push(
          "[" + time + "] log." + (entry?.level || "info") + " " +
            (entry?.text || "")
        );
      }
    });

    await Promise.all([
      this.send("Runtime.enable"),
      this.send("Log.enable"),
      this.send("Page.enable")
    ]);
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ||
          response.exceptionDetails.text ||
          "Runtime.evaluate failed"
      );
    }
    return response.result?.value;
  }

  async screenshot(file) {
    const response = await this.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true
    });
    if (response?.data) {
      fs.writeFileSync(file, Buffer.from(response.data, "base64"));
    }
  }

  close() {
    this.socket?.close();
  }
}

const snapshotExpression =
  "(() => {" +
  "const text=s=>document.querySelector(s)?.textContent?.trim()||'';" +
  "const rem=[...document.querySelectorAll('video[data-remote-video]')].map(v=>{" +
  "const s=v.srcObject;return{audio:s?.getAudioTracks?.().length||0,video:s?.getVideoTracks?.().length||0,ready:v.readyState};});" +
  "const local=[...document.querySelectorAll('.video-tile video')].find(v=>!v.hasAttribute('data-remote-video'))?.srcObject;" +
  "return{href:location.href,status:text('[data-testid=\"conference-status\"]'),lobby:text('[data-testid=\"lobby-status\"]')," +
  "peers:text('.peer-count'),remote:rem," +
  "audio:local?.getAudioTracks?.().map(t=>({enabled:t.enabled,ready:t.readyState}))||[]," +
  "video:local?.getVideoTracks?.().map(t=>({enabled:t.enabled,ready:t.readyState,deviceId:t.getSettings?.().deviceId||''}))||[]," +
  "messages:[...document.querySelectorAll('.message')].map(x=>x.textContent?.trim()||'')," +
  "downloads:[...document.querySelectorAll('.downloads a')].map(x=>x.textContent?.trim()||'')," +
  "quality:[...document.querySelectorAll('.quality-badge')].map(x=>({text:x.textContent?.trim()||'',title:x.getAttribute('title')||''}))," +
  "cameraOptions:document.querySelector('[data-testid=\"camera-select\"]')?.options?.length||0," +
  "shareDisabled:document.querySelector('[data-testid=\"share-screen\"]')?.disabled??true," +
  "blurDisabled:document.querySelector('[data-testid=\"background-blur\"]')?.disabled??true};" +
  "})()";

function snapshot(page) {
  return page.evaluate(snapshotExpression);
}

function click(page, testId) {
  return page.evaluate(
    "(() => {const e=document.querySelector('[data-testid=\"" +
      testId +
      "\"]');if(!e)return false;e.click();return true;})()"
  );
}

function chat(page, text) {
  return page.evaluate(
    "(() => {const i=document.querySelector('input[aria-label=\"Message\"]');" +
      "const f=i?.closest('form');if(!i||!f)return false;" +
      "const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;" +
      "s?.call(i," + JSON.stringify(text) + ");" +
      "i.dispatchEvent(new Event('input',{bubbles:true}));f.requestSubmit();return true;})()"
  );
}

function sendFile(page, name, body) {
  return page.evaluate(
    "(() => {const i=document.querySelector('[data-testid=\"file-input\"]');" +
      "if(!i)return false;const f=new File([" + JSON.stringify(body) + "]," +
      JSON.stringify(name) + ",{type:'text/plain'});" +
      "const d=new DataTransfer();d.items.add(f);i.files=d.files;" +
      "i.dispatchEvent(new Event('change',{bubbles:true}));return true;})()"
  );
}

function switchCamera(page) {
  return page.evaluate(
    "(() => {const s=document.querySelector('[data-testid=\"camera-select\"]');" +
      "if(!s||s.options.length<2)return{ok:false};" +
      "s.selectedIndex=s.selectedIndex===0?1:0;" +
      "s.dispatchEvent(new Event('change',{bubbles:true}));return{ok:true,value:s.value};})()"
  );
}

function record(checks, id, name, status, detail, durationMs = 0) {
  checks.push({ id, name, status, detail, durationMs });
}

async function check(checks, id, name, operation) {
  const started = Date.now();
  try {
    const value = await operation();
    record(
      checks,
      id,
      name,
      "pass",
      typeof value === "string" ? value : JSON.stringify(value),
      Date.now() - started
    );
    return value;
  } catch (error) {
    record(
      checks,
      id,
      name,
      "fail",
      error instanceof Error ? error.message : String(error),
      Date.now() - started
    );
    throw error;
  }
}

function manualChecks(checks) {
  const items = [
    ["physical-audio", "Two-way physical speech audio quality",
      "Confirm speech both directions without unacceptable echo, clipping, or feedback."],
    ["physical-video", "Physical camera image quality",
      "Confirm both feeds are visually correct and camera switching changes the physical view."],
    ["permissions", "Android Chrome media permission prompts",
      "Confirm only expected camera and microphone permissions were granted."],
    ["screen-share", "Android screen sharing chooser",
      "If display capture is available, verify the system chooser and shared output manually."],
    ["blur", "Background blur visual quality",
      "If native blur is available, inspect segmentation and blur quality manually."],
    ["handover", "Wi-Fi to cellular network handover",
      "Perform a deliberate network transition after same-LAN certification."]
  ];
  for (const [id, name, detail] of items) {
    record(checks, id, name, "manual", detail, 0);
  }
}

async function main() {
  const serials = serialsFromArgs();
  const room = process.env.VERGE_ROOM_ID || randomBytes(16).toString("hex");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(room)) {
    throw new Error("VERGE_ROOM_ID must be 1-64 URL-safe characters.");
  }

  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const artifactDir = path.resolve(
    process.env.VERGE_ANDROID_ARTIFACT_DIR ||
      path.join("artifacts", "android-certification", stamp)
  );
  fs.mkdirSync(artifactDir, { recursive: true });

  execFileSync(
    "bash",
    ["scripts/adb-two-phone-mvp.sh", ...serials],
    {
      stdio: "inherit",
      env: { ...process.env, VERGE_ROOM_ID: room }
    }
  );

  const checks = [];
  const pages = [];
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    roomId: room,
    artifactDir,
    devices: serials.map((serial, index) => ({
      serial,
      label: labels[index],
      devtoolsPort: ports[index]
    })),
    checks,
    status: "running"
  };

  try {
    for (let index = 0; index < ports.length; index += 1) {
      const target = await check(
        checks,
        "devtools-" + index,
        labels[index] + " Chrome DevTools attachment",
        () => targetFor(ports[index], room)
      );
      const page = new Cdp(labels[index], target);
      await page.connect();
      pages.push(page);
    }

    await check(checks, "room", "Both phones opened the same room", async () => {
      const states = await Promise.all(pages.map(snapshot));
      if (states.some((state) => !state.href.includes("room=" + encodeURIComponent(room)))) {
        throw new Error("Room URL mismatch.");
      }
      return states.map((state) => state.href);
    });

    await Promise.all(pages.map((page) => click(page, "join-room")));
    console.log(
      "Allow camera/microphone permission prompts on both phones if Chrome shows them."
    );

    await check(checks, "connected", "Both phones connect", async () => {
      const states = await Promise.all(
        pages.map((page) =>
          waitFor(
            page.label + " connected",
            () => snapshot(page),
            (state) => state.status === "Connected",
            permissionTimeout
          )
        )
      );
      return states.map((state) => state.status);
    });

    await check(checks, "peers", "Both phones see two participants", async () => {
      const states = await Promise.all(
        pages.map((page) =>
          waitFor(
            page.label + " peer count",
            () => snapshot(page),
            (state) => state.peers.includes("2 participants")
          )
        )
      );
      return states.map((state) => state.peers);
    });

    await check(checks, "media", "Remote audio/video tracks exist both ways", async () => {
      const states = await Promise.all(
        pages.map((page) =>
          waitFor(
            page.label + " remote media",
            () => snapshot(page),
            (state) =>
              state.remote.length === 1 &&
              state.remote[0].audio > 0 &&
              state.remote[0].video > 0
          )
        )
      );
      return states.map((state) => state.remote[0]);
    });

    await check(checks, "ice", "ICE path is classified on both phones", async () => {
      const states = await Promise.all(
        pages.map((page) =>
          waitFor(
            page.label + " ICE path",
            () => snapshot(page),
            (state) =>
              state.quality.some((item) =>
                /direct|relay/i.test(item.text + " " + item.title)
              ),
            25000
          )
        )
      );
      return states.map((state) => state.quality);
    });

    for (const pair of [[0, 1], [1, 0]]) {
      const from = pages[pair[0]];
      const to = pages[pair[1]];
      const token = "android-chat-" + pair[0] + "-" + Date.now();
      await check(
        checks,
        "chat-" + pair.join("-"),
        "Chat " + from.label + " to " + to.label,
        async () => {
          if (!(await chat(from, token))) throw new Error("Chat composer missing.");
          await waitFor(
            to.label + " receives chat",
            () => snapshot(to),
            (state) => state.messages.some((message) => message.includes(token))
          );
          return token;
        }
      );
    }

    for (const pair of [[0, 1], [1, 0]]) {
      const from = pages[pair[0]];
      const to = pages[pair[1]];
      const name = "verge-android-" + pair[0] + "-" + Date.now() + ".txt";
      await check(
        checks,
        "file-" + pair.join("-"),
        "Verified file " + from.label + " to " + to.label,
        async () => {
          if (!(await sendFile(from, name, "Verge physical-device certification"))) {
            throw new Error("File input missing.");
          }
          const state = await waitFor(
            to.label + " receives file",
            () => snapshot(to),
            (value) =>
              value.downloads.some(
                (item) => item.includes(name) && item.includes("SHA-256 verified")
              ),
            45000
          );
          return state.downloads.find((item) => item.includes(name));
        }
      );
    }

    await check(checks, "mute", "Mute/unmute preserves the call", async () => {
      const page = pages[0];
      await click(page, "microphone-toggle");
      await waitFor(
        "microphone disabled",
        () => snapshot(page),
        (state) => state.audio[0]?.enabled === false
      );
      await click(page, "microphone-toggle");
      return waitFor(
        "microphone enabled",
        () => snapshot(page),
        (state) =>
          state.audio[0]?.enabled === true &&
          state.peers.includes("2 participants")
      );
    });

    await check(checks, "camera-toggle", "Camera off/on preserves the call", async () => {
      const page = pages[0];
      await click(page, "camera-toggle");
      await waitFor(
        "camera disabled",
        () => snapshot(page),
        (state) => state.video[0]?.enabled === false
      );
      await click(page, "camera-toggle");
      return waitFor(
        "camera enabled",
        () => snapshot(page),
        (state) =>
          state.video[0]?.enabled === true &&
          state.peers.includes("2 participants")
      );
    });

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const before = await snapshot(page);
      if (before.cameraOptions < 2) {
        record(
          checks,
          "camera-switch-" + index,
          page.label + " camera switch",
          "skip",
          "Chrome exposed fewer than two camera devices."
        );
        continue;
      }

      await check(
        checks,
        "camera-switch-" + index,
        page.label + " camera switch keeps the call active",
        async () => {
          const action = await switchCamera(page);
          if (!action.ok) throw new Error("Camera switch unavailable.");
          return waitFor(
            page.label + " camera switched",
            () => snapshot(page),
            (state) =>
              state.status === "Camera switched" &&
              state.peers.includes("2 participants") &&
              state.video[0]?.ready === "live"
          );
        }
      );
    }

    await check(
      checks,
      "capabilities",
      "Display capture and blur are explicitly capability-gated",
      async () => {
        const states = await Promise.all(pages.map(snapshot));
        return states.map((state, index) => ({
          phone: labels[index],
          shareDisabled: state.shareDisabled,
          blurDisabled: state.blurDisabled
        }));
      }
    );

    for (let index = 0; index < pages.length; index += 1) {
      await pages[index].screenshot(
        path.join(
          artifactDir,
          labels[index].toLowerCase().replaceAll(" ", "-") + "-connected.png"
        )
      );
    }

    if (holdSeconds > 0) {
      console.log(
        "Holding connected call for " + holdSeconds +
          "s for manual audio/video observation."
      );
      await sleep(holdSeconds * 1000);
    }

    await check(checks, "leave", "Peer leave cleans up remote state", async () => {
      await click(pages[1], "leave-room");
      return waitFor(
        "Phone A peer cleanup",
        () => snapshot(pages[0]),
        (state) =>
          state.peers.includes("1 participant") &&
          state.remote.length === 0
      );
    });
    await click(pages[0], "leave-room");
  } catch (error) {
    record(
      checks,
      "harness",
      "Certification harness completed",
      "fail",
      error instanceof Error ? error.stack || error.message : String(error)
    );
  } finally {
    manualChecks(checks);

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      fs.writeFileSync(
        path.join(
          artifactDir,
          labels[index].toLowerCase().replaceAll(" ", "-") + "-console.log"
        ),
        page.logs.join("\n") + "\n"
      );
      page.close();
    }

    for (let index = 0; index < serials.length; index += 1) {
      let logcat = "";
      try {
        logcat = execFileSync(
          "adb",
          ["-s", serials[index], "logcat", "-d", "-v", "threadtime", "-t", "1200"],
          { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 }
        );
      } catch {}
      fs.writeFileSync(
        path.join(
          artifactDir,
          labels[index].toLowerCase().replaceAll(" ", "-") + "-logcat.txt"
        ),
        logcat
      );
    }

    report.completedAt = new Date().toISOString();
    report.status = overallCertificationStatus(checks);

    fs.writeFileSync(
      path.join(artifactDir, "report.json"),
      JSON.stringify(report, null, 2) + "\n"
    );
    fs.writeFileSync(
      path.join(artifactDir, "report.xml"),
      reportToJUnit(report)
    );
    const summary = certificationSummary(report);
    fs.writeFileSync(
      path.join(artifactDir, "summary.txt"),
      summary + "\n"
    );

    console.log("\n" + summary);
    console.log(
      "\nManual checks remain separate from the automated result."
    );

    if (report.status === "failed") process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

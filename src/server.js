import http from "node:http";
import { URL } from "node:url";
import { loadConfig } from "./config.js";
import { createHandlers } from "./handlers.js";
import { explainSlackSignatureVerification } from "./signing.js";
import { createSlackClient } from "./slack.js";
import { TicketStore } from "./store.js";

const config = loadConfig();
const store = new TicketStore(config.dataFile);
const slack = createSlackClient(config.botToken);
const handlers = createHandlers({ slack, store, config });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ok: true })
      });
    }

    if (req.method !== "POST") {
      return send(res, { statusCode: 404, headers: {}, body: "Not found" });
    }

    const rawBody = await readBody(req);
    const verification = explainSlackSignatureVerification({
      signingSecret: config.signingSecret,
      timestamp: req.headers["x-slack-request-timestamp"],
      signature: req.headers["x-slack-signature"],
      rawBody
    });

    if (!verification.ok) {
      console.warn("Rejected Slack request", {
        path: url.pathname,
        reason: verification.reason,
        bodyLength: verification.bodyLength,
        expectedPrefix: verification.expectedPrefix,
        actualPrefix: verification.actualPrefix,
        timestamp: req.headers["x-slack-request-timestamp"] || null
      });
      return send(res, { statusCode: 401, headers: {}, body: "Invalid Slack signature" });
    }

    if (url.pathname === "/slack/commands") {
      const params = Object.fromEntries(new URLSearchParams(rawBody));
      return send(res, await handlers.handleSlashCommand(params));
    }

    if (url.pathname === "/slack/interactions") {
      const form = new URLSearchParams(rawBody);
      const payload = JSON.parse(form.get("payload"));
      return send(res, await handlers.handleInteraction(payload));
    }

    if (url.pathname === "/slack/events") {
      const envelope = JSON.parse(rawBody);
      return send(res, await handlers.handleEventEnvelope(envelope));
    }

    return send(res, { statusCode: 404, headers: {}, body: "Not found" });
  } catch (error) {
    console.error(error);
    return send(res, { statusCode: 500, headers: {}, body: "Internal server error" });
  }
});

server.listen(config.port, () => {
  console.log(`Club Slack ticketing app listening on http://localhost:${config.port}`);
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function send(res, response) {
  res.writeHead(response.statusCode, response.headers);
  res.end(response.body);
}

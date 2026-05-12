import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const required = [
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "SLACK_UNCLAIMED_CHANNEL_ID",
  "SLACK_CLAIMED_CHANNEL_ID",
  "SLACK_RESOLVED_CHANNEL_ID"
];
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig(env = process.env) {
  loadDotEnv(env);

  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    botToken: env.SLACK_BOT_TOKEN,
    signingSecret: env.SLACK_SIGNING_SECRET,
    unclaimedChannelId: env.SLACK_UNCLAIMED_CHANNEL_ID,
    claimedChannelId: env.SLACK_CLAIMED_CHANNEL_ID,
    resolvedChannelId: env.SLACK_RESOLVED_CHANNEL_ID,
    teams: {
      mechanical: teamConfig(env, "MECHANICAL", "Mechanical"),
      electrical: teamConfig(env, "ELECTRICAL", "Electrical"),
      research: teamConfig(env, "RESEARCH", "Research"),
      business: teamConfig(env, "BUSINESS", "Business")
    },
    port: Number(env.PORT || 3000),
    dataFile: path.resolve(appRoot, env.DATA_FILE || "./data/tickets.json"),
    clubName: env.CLUB_NAME || "Club"
  };
}

function teamConfig(env, key, label) {
  return {
    key: key.toLowerCase(),
    label,
    channelId: env[`${key}_CHANNEL_ID`] || "",
    leadUserIds: splitCsv(env[`${key}_LEAD_USER_IDS`] || "")
  };
}

function splitCsv(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadDotEnv(env) {
  const filePath = path.join(appRoot, ".env");
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    if (!key || env[key] !== undefined) continue;

    env[key] = stripQuotes(rawValue);
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

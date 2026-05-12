import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("loads config from .env when process values are absent", () => {
  const projectEnv = path.resolve(".env");
  const backupEnv = fs.existsSync(projectEnv) ? fs.readFileSync(projectEnv, "utf8") : null;

  try {
    fs.writeFileSync(
      projectEnv,
      [
        "SLACK_BOT_TOKEN=xoxb-test",
        "SLACK_SIGNING_SECRET=secret",
        "SLACK_UNCLAIMED_CHANNEL_ID=CUNCLAIMED",
        "SLACK_CLAIMED_CHANNEL_ID=CCLAIMED",
        "SLACK_RESOLVED_CHANNEL_ID=CRESOLVED",
        "PORT=4000",
        "CLUB_NAME='Chess Club'"
      ].join("\n")
    );

    const config = loadConfig({});
    assert.equal(config.botToken, "xoxb-test");
    assert.equal(config.signingSecret, "secret");
    assert.equal(config.unclaimedChannelId, "CUNCLAIMED");
    assert.equal(config.claimedChannelId, "CCLAIMED");
    assert.equal(config.resolvedChannelId, "CRESOLVED");
    assert.equal(config.port, 4000);
    assert.equal(config.clubName, "Chess Club");
  } finally {
    if (backupEnv === null) {
      fs.rmSync(projectEnv, { force: true });
    } else {
      fs.writeFileSync(projectEnv, backupEnv);
    }
  }
});

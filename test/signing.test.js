import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { verifySlackSignature } from "../src/signing.js";

test("verifies a valid Slack signature", () => {
  const signingSecret = "secret";
  const timestamp = "1710000000";
  const rawBody = "token=x&team_id=T123&text=hello";
  const signature = sign(signingSecret, timestamp, rawBody);

  assert.equal(
    verifySlackSignature({
      signingSecret,
      timestamp,
      signature,
      rawBody,
      now: 1710000000 * 1000
    }),
    true
  );
});

test("rejects an old Slack signature", () => {
  const signingSecret = "secret";
  const timestamp = "1710000000";
  const rawBody = "token=x&team_id=T123&text=hello";
  const signature = sign(signingSecret, timestamp, rawBody);

  assert.equal(
    verifySlackSignature({
      signingSecret,
      timestamp,
      signature,
      rawBody,
      now: (1710000000 + 301) * 1000
    }),
    false
  );
});

test("rejects a mismatched Slack signature", () => {
  assert.equal(
    verifySlackSignature({
      signingSecret: "secret",
      timestamp: "1710000000",
      signature: "v0=bad",
      rawBody: "token=x",
      now: 1710000000 * 1000
    }),
    false
  );
});

function sign(secret, timestamp, body) {
  const digest = crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");
  return `v0=${digest}`;
}

import crypto from "node:crypto";

const fiveMinutesInSeconds = 60 * 5;

export function verifySlackSignature({ signingSecret, timestamp, signature, rawBody, now = Date.now() }) {
  return explainSlackSignatureVerification({ signingSecret, timestamp, signature, rawBody, now }).ok;
}

export function explainSlackSignatureVerification({ signingSecret, timestamp, signature, rawBody, now = Date.now() }) {
  if (!timestamp) return { ok: false, reason: "missing x-slack-request-timestamp header" };
  if (!signature) return { ok: false, reason: "missing x-slack-signature header" };
  if (!rawBody) return { ok: false, reason: "empty request body" };

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return { ok: false, reason: "invalid timestamp" };

  const age = Math.abs(Math.floor(now / 1000) - timestampSeconds);
  if (age > fiveMinutesInSeconds) {
    return { ok: false, reason: `timestamp is ${age} seconds away from server time` };
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = crypto.createHmac("sha256", signingSecret).update(base).digest("hex");
  const expected = `v0=${digest}`;

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return {
      ok: false,
      reason: "signature length mismatch",
      expectedPrefix: expected.slice(0, 12),
      actualPrefix: signature.slice(0, 12),
      bodyLength: rawBody.length
    };
  }

  const ok = crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  return {
    ok,
    reason: ok ? "ok" : "signature mismatch; check SLACK_SIGNING_SECRET and Slack app",
    expectedPrefix: expected.slice(0, 12),
    actualPrefix: signature.slice(0, 12),
    bodyLength: rawBody.length
  };
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { TicketStore } from "../src/store.js";

test("creates and updates a ticket", () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "club-tickets-")), "tickets.json");
  const store = new TicketStore(filePath);

  const ticket = store.createTicket({
    title: "Need room reservation",
    description: "Reserve the big room for Friday.",
    category: "events",
    priority: "normal",
    requesterSlackUserId: "U123"
  });

  assert.equal(ticket.id, "1");
  assert.equal(ticket.status, "open");

  store.attachTriageMessage(ticket.id, "C123", "171.000");
  store.attachWorkflowMessage(ticket.id, "CUNCLAIMED", "172.000");
  store.attachWorkflowMessage(ticket.id, "CCLAIMED", "173.000");
  assert.equal(store.getTicket(ticket.id).workflowChannelId, "CCLAIMED");
  assert.equal(store.getTicket(ticket.id).previousWorkflowMessages.length, 1);

  const assigned = store.assignTicket(ticket.id, "U999", "U456");
  assert.equal(assigned.assignedSlackUserId, "U456");

  const claimed = store.claimTicket(ticket.id, "U777");
  assert.equal(claimed.assignedSlackUserId, "U777");
  assert.equal(claimed.status, "in_progress");

  const escalated = store.escalateTicket(ticket.id, "U888");
  assert.equal(escalated.escalatedBySlackUserId, "U888");
  assert.ok(escalated.escalatedAt);

  const resolved = store.updateStatus(ticket.id, "U999", "resolved");
  assert.equal(resolved.status, "resolved");
  assert.ok(resolved.resolvedAt);

  const reloaded = new TicketStore(filePath);
  assert.equal(reloaded.getTicket("1").triageChannelId, "C123");
  assert.equal(reloaded.getTicket("1").workflowChannelId, "CCLAIMED");
  assert.equal(reloaded.getEvents("1").length, 8);
});

test("filters active tickets by requester and assignee", () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "club-tickets-")), "tickets.json");
  const store = new TicketStore(filePath);

  const first = store.createTicket({
    title: "A",
    description: "A",
    category: "general",
    priority: "low",
    requesterSlackUserId: "U1"
  });
  const second = store.createTicket({
    title: "B",
    description: "B",
    category: "tech",
    priority: "high",
    requesterSlackUserId: "U2"
  });

  store.assignTicket(first.id, "U3", "U4");
  store.updateStatus(second.id, "U3", "resolved");

  assert.deepEqual(store.listTickets({ requesterSlackUserId: "U1", active: true }).map((ticket) => ticket.id), ["1"]);
  assert.deepEqual(store.listTickets({ assignedSlackUserId: "U4", active: true }).map((ticket) => ticket.id), ["1"]);
});

import fs from "node:fs";
import path from "node:path";

const defaultState = {
  nextTicketNumber: 1,
  tickets: [],
  events: []
};

export class TicketStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = structuredClone(defaultState);
    this.load();
  }

  load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.persist();
      return;
    }

    const raw = fs.readFileSync(this.filePath, "utf8");
    this.state = raw.trim() ? JSON.parse(raw) : structuredClone(defaultState);
  }

  persist() {
    fs.writeFileSync(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  createTicket(input) {
    const now = new Date().toISOString();
    const team = input.team || input.category;
    const ticket = {
      id: String(this.state.nextTicketNumber++),
      title: input.title.trim(),
      description: input.description.trim(),
      team,
      category: team,
      priority: input.priority,
      status: "open",
      requesterSlackUserId: input.requesterSlackUserId,
      assignedSlackUserId: null,
      escalatedAt: null,
      escalatedBySlackUserId: null,
      triageChannelId: null,
      triageThreadTs: null,
      teamChannelId: null,
      teamThreadTs: null,
      workflowChannelId: null,
      workflowThreadTs: null,
      previousWorkflowMessages: [],
      sourceChannelId: input.sourceChannelId || input.sourceMessage?.channelId || null,
      sourceMessage: input.sourceMessage || null,
      sourceResponseUrl: input.sourceResponseUrl || null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null
    };

    this.state.tickets.push(ticket);
    this.addEvent(ticket.id, input.requesterSlackUserId, "ticket.created", null, ticket.status, false);
    this.persist();
    return ticket;
  }

  attachTriageMessage(ticketId, channelId, threadTs) {
    return this.updateTicket(ticketId, "system", (ticket) => {
      ticket.triageChannelId = channelId;
      ticket.triageThreadTs = threadTs;
    }, "ticket.triage_attached", null, `${channelId}:${threadTs}`);
  }

  attachTeamMessage(ticketId, channelId, threadTs) {
    return this.updateTicket(ticketId, "system", (ticket) => {
      ticket.teamChannelId = channelId;
      ticket.teamThreadTs = threadTs;
    }, "ticket.team_alert_attached", null, `${channelId}:${threadTs}`);
  }

  attachWorkflowMessage(ticketId, channelId, threadTs) {
    return this.updateTicket(ticketId, "system", (ticket) => {
      if (ticket.workflowChannelId && ticket.workflowThreadTs) {
        ticket.previousWorkflowMessages ||= [];
        ticket.previousWorkflowMessages.push({
          channelId: ticket.workflowChannelId,
          threadTs: ticket.workflowThreadTs,
          movedAt: new Date().toISOString()
        });
      }
      ticket.workflowChannelId = channelId;
      ticket.workflowThreadTs = threadTs;
    }, "ticket.workflow_message_attached", null, `${channelId}:${threadTs}`);
  }

  updateStatus(ticketId, actorSlackUserId, status) {
    return this.updateTicket(ticketId, actorSlackUserId, (ticket) => {
      const oldStatus = ticket.status;
      ticket.status = status;
      ticket.resolvedAt = status === "resolved" ? new Date().toISOString() : null;
      return [oldStatus, status];
    }, "ticket.status_changed");
  }

  resolveTicket(ticketId, actorSlackUserId) {
    return this.updateStatus(ticketId, actorSlackUserId, "resolved");
  }

  assignTicket(ticketId, actorSlackUserId, assigneeSlackUserId) {
    return this.updateTicket(ticketId, actorSlackUserId, (ticket) => {
      const oldAssignee = ticket.assignedSlackUserId;
      ticket.assignedSlackUserId = assigneeSlackUserId;
      return [oldAssignee, assigneeSlackUserId];
    }, "ticket.assigned");
  }

  claimTicket(ticketId, actorSlackUserId) {
    return this.updateTicket(ticketId, actorSlackUserId, (ticket) => {
      const oldValue = {
        assignedSlackUserId: ticket.assignedSlackUserId,
        status: ticket.status
      };
      ticket.assignedSlackUserId = actorSlackUserId;
      if (ticket.status === "open") {
        ticket.status = "in_progress";
      }
      const newValue = {
        assignedSlackUserId: ticket.assignedSlackUserId,
        status: ticket.status
      };
      return [oldValue, newValue];
    }, "ticket.claimed");
  }

  escalateTicket(ticketId, actorSlackUserId) {
    return this.updateTicket(ticketId, actorSlackUserId, (ticket) => {
      const oldEscalatedAt = ticket.escalatedAt;
      ticket.escalatedAt = new Date().toISOString();
      ticket.escalatedBySlackUserId = actorSlackUserId;
      return [oldEscalatedAt, ticket.escalatedAt];
    }, "ticket.escalated");
  }

  addComment(ticketId, actorSlackUserId, comment) {
    const ticket = this.findTicket(ticketId);
    this.addEvent(ticket.id, actorSlackUserId, "ticket.comment_added", null, comment);
    this.persist();
    return ticket;
  }

  listTickets(filters = {}) {
    return this.state.tickets
      .filter((ticket) => {
        if (filters.requesterSlackUserId && ticket.requesterSlackUserId !== filters.requesterSlackUserId) return false;
        if (filters.assignedSlackUserId && ticket.assignedSlackUserId !== filters.assignedSlackUserId) return false;
        if (filters.status && ticket.status !== filters.status) return false;
        if (filters.active && ticket.status === "resolved") return false;
        return true;
      })
      .sort((a, b) => Number(b.id) - Number(a.id));
  }

  getTicket(ticketId) {
    return this.state.tickets.find((ticket) => ticket.id === String(ticketId)) || null;
  }

  getEvents(ticketId) {
    return this.state.events.filter((event) => event.ticketId === String(ticketId));
  }

  findTicket(ticketId) {
    const ticket = this.getTicket(ticketId);
    if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
    return ticket;
  }

  updateTicket(ticketId, actorSlackUserId, updater, eventType, oldValueOverride, newValueOverride) {
    const ticket = this.findTicket(ticketId);
    const maybeValues = updater(ticket);
    ticket.updatedAt = new Date().toISOString();

    const [oldValue, newValue] = Array.isArray(maybeValues)
      ? maybeValues
      : [oldValueOverride, newValueOverride];

    this.addEvent(ticket.id, actorSlackUserId, eventType, oldValue, newValue, false);
    this.persist();
    return ticket;
  }

  addEvent(ticketId, actorSlackUserId, eventType, oldValue, newValue, persist = true) {
    this.state.events.push({
      id: String(this.state.events.length + 1),
      ticketId: String(ticketId),
      actorSlackUserId,
      eventType,
      oldValue,
      newValue,
      createdAt: new Date().toISOString()
    });

    if (persist) this.persist();
  }
}

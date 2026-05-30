export const statuses = ["open", "in_progress", "waiting", "resolved"];
export const priorities = ["low", "medium", "high", "urgent"];
export const teams = ["mechanical", "electrical", "research", "business"];
export const priorityLabels = {
  low: "Low (1 week)",
  medium: "Medium (3-4 days)",
  high: "High (1 day)",
  urgent: "Urgent (EOD)"
};

export function humanize(value) {
  if (!value) return "Unassigned";
  return String(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ticketModal(triggerSource = "slash", defaults = {}) {
  return {
    type: "modal",
    callback_id: "ticket_create_modal",
    private_metadata: JSON.stringify({
      triggerSource,
      sourceChannelId: defaults.sourceChannelId || null,
      sourceMessage: defaults.sourceMessage || null,
      sourceResponseUrl: defaults.sourceResponseUrl || null
    }),
    title: { type: "plain_text", text: "Create ticket" },
    submit: { type: "plain_text", text: "Create" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "title",
        label: { type: "plain_text", text: "Title" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          max_length: 120,
          ...(defaults.title ? { initial_value: defaults.title.slice(0, 120) } : {}),
          placeholder: { type: "plain_text", text: "Short summary" }
        }
      },
      {
        type: "input",
        block_id: "description",
        label: { type: "plain_text", text: "Description" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          max_length: 2000,
          ...(defaults.description ? { initial_value: defaults.description.slice(0, 2000) } : {})
        }
      },
      {
        type: "input",
        block_id: "team",
        label: { type: "plain_text", text: "Team" },
        element: {
          type: "static_select",
          action_id: "value",
          options: teams.map((team) => option(team))
        }
      },
      {
        type: "input",
        block_id: "priority",
        label: { type: "plain_text", text: "Priority" },
        element: {
          type: "static_select",
          action_id: "value",
          initial_option: option("medium"),
          options: priorities.map((priority) => option(priority))
        }
      },
      {
        type: "input",
        block_id: "attachments",
        optional: true,
        label: { type: "plain_text", text: "Relevant files" },
        element: {
          type: "file_input",
          action_id: "value",
          max_files: 10
        }
      }
    ]
  };
}

export function ticketBlocks(ticket, events = []) {
  if (ticket.status === "resolved") {
    return resolvedTicketBlocks(ticket);
  }

  const assigneeText = ticket.assignedSlackUserId ? `<@${ticket.assignedSlackUserId}>` : "Unassigned";
  const requesterText = `<@${ticket.requesterSlackUserId}>`;
  const lastEvents = events.slice(-3).map(formatEvent).join("\n") || "No activity yet.";
  const team = ticket.team || ticket.category;
  const escalationText = ticket.escalatedAt
    ? `Escalated by <@${ticket.escalatedBySlackUserId}> on ${formatDate(ticket.escalatedAt)}`
    : "Not escalated";

  return [
    {
      type: "header",
      text: { type: "plain_text", text: ticket.title }
    },
    {
      type: "section",
      fields: [
        markdownField(`*Status:*\n${humanize(ticket.status)}`),
        markdownField(`*Priority:*\n${displayPriority(ticket.priority)}`),
        markdownField(`*Team:*\n${humanize(team)}`),
        markdownField(`*Assignee:*\n${assigneeText}`),
        markdownField(`*Requester:*\n${requesterText}`),
        markdownField(`*Created:*\n${formatDate(ticket.createdAt)}`),
        markdownField(`*Escalation:*\n${escalationText}`)
      ]
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Description:*\n${escapeMrkdwn(ticket.description)}` }
    },
    {
      type: "actions",
      block_id: `ticket_actions_${ticket.id}`,
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: ticket.assignedSlackUserId ? "Claimed" : "Claim" },
          style: "primary",
          action_id: "claim_ticket",
          value: ticket.id,
          ...(ticket.assignedSlackUserId ? { confirm: alreadyClaimedConfirm(ticket) } : {})
        },
        {
          type: "users_select",
          action_id: "assign_ticket",
          placeholder: { type: "plain_text", text: "Assign" },
          ...(ticket.assignedSlackUserId ? { initial_user: ticket.assignedSlackUserId } : {})
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Resolve" },
          style: "primary",
          action_id: "resolve_ticket",
          value: ticket.id,
          confirm: {
            title: { type: "plain_text", text: "Resolve ticket?" },
            text: { type: "mrkdwn", text: "This will move the ticket to the resolved channel and notify the requester." },
            confirm: { type: "plain_text", text: "Resolve" },
            deny: { type: "plain_text", text: "Cancel" }
          }
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Escalate" },
          style: "danger",
          action_id: "escalate_ticket",
          value: ticket.id
        }
      ]
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `*Recent activity:* ${lastEvents}` }]
    }
  ];
}

export function resolvedTicketBlocks(ticket) {
  const assigneeText = ticket.assignedSlackUserId ? `<@${ticket.assignedSlackUserId}>` : "Unassigned";
  const requesterText = `<@${ticket.requesterSlackUserId}>`;
  const team = ticket.team || ticket.category;

  return [
    {
      type: "header",
      text: { type: "plain_text", text: ticket.title }
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Description:*\n${escapeMrkdwn(ticket.description)}` }
    },
    {
      type: "section",
      fields: [
        markdownField(`*Team:*\n${humanize(team)}`),
        markdownField(`*Requester:*\n${requesterText}`),
        markdownField(`*Assignee:*\n${assigneeText}`)
      ]
    }
  ];
}

export function requesterConfirmationBlocks(ticket) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Your ticket *${escapeMrkdwn(ticket.title)}* was created. Club officers will follow up soon.`
      }
    }
  ];
}

export function appHomeView({ clubName, openTickets, assignedTickets }) {
  return {
    type: "home",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `${clubName} Tickets` }
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Create ticket" },
            style: "primary",
            action_id: "app_home_create_ticket",
            value: "create"
          }
        ]
      },
      divider(),
      sectionList("My open tickets", openTickets),
      divider(),
      sectionList("Assigned to me", assignedTickets)
    ]
  };
}

export function parseTicketModalValues(view) {
  const values = view.state.values;
  return {
    title: values.title.value.value,
    description: values.description.value.value,
    team: values.team.value.selected_option.value,
    priority: values.priority.value.selected_option.value,
    files: parseFileInput(values.attachments?.value)
  };
}

function parseFileInput(value) {
  if (!value) return [];
  return value.files || value.selected_files || [];
}

export function movedTicketBlocks(ticket, destinationLabel) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${escapeMrkdwn(ticket.title)}* moved to *${destinationLabel}*.\nUse the latest ticket post for new discussion.`
      }
    }
  ];
}

function sectionList(title, tickets) {
  if (tickets.length === 0) {
    return {
      type: "section",
      text: { type: "mrkdwn", text: `*${title}*\nNone right now.` }
    };
  }

  const lines = tickets.slice(0, 10).map((ticket) => {
    return `*${escapeMrkdwn(ticket.title)}* - ${humanize(ticket.status)} - ${displayPriority(ticket.priority)}`;
  });

  return {
    type: "section",
    text: { type: "mrkdwn", text: `*${title}*\n${lines.join("\n")}` }
  };
}

function option(value) {
  return {
    text: { type: "plain_text", text: displayPriority(value) },
    value
  };
}

function displayPriority(value) {
  return priorityLabels[value] || humanize(value);
}

function alreadyClaimedConfirm(ticket) {
  return {
    title: { type: "plain_text", text: "Reassign ticket?" },
    text: { type: "mrkdwn", text: `This ticket is currently claimed by <@${ticket.assignedSlackUserId}>.` },
    confirm: { type: "plain_text", text: "Claim anyway" },
    deny: { type: "plain_text", text: "Cancel" }
  };
}

function markdownField(text) {
  return { type: "mrkdwn", text };
}

function divider() {
  return { type: "divider" };
}

function formatEvent(event) {
  const actor = event.actorSlackUserId === "system" ? "System" : `<@${event.actorSlackUserId}>`;
  if (event.eventType === "ticket.status_changed") {
    return `${actor} changed status to ${humanize(event.newValue)}`;
  }
  if (event.eventType === "ticket.assigned") {
    return `${actor} assigned to ${event.newValue ? `<@${event.newValue}>` : "Unassigned"}`;
  }
  if (event.eventType === "ticket.claimed") {
    return `${actor} claimed the ticket`;
  }
  if (event.eventType === "ticket.escalated") {
    return `${actor} escalated to team leads`;
  }
  return `${actor} ${humanize(event.eventType)}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeMrkdwn(text) {
  return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

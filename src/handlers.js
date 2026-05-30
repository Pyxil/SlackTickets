import {
  appHomeView,
  movedTicketBlocks,
  parseTicketModalValues,
  ticketBlocks,
  ticketModal
} from "./views.js";

export function createHandlers({ slack, store, config }) {
  async function handleSlashCommand(params) {
    const commandText = (params.text || "").trim();

    if (commandText === "help") {
      return json({
        response_type: "ephemeral",
        text: "Use `/ticket` to create a ticket. Responders can manage tickets from the workflow channel buttons."
      });
    }

    if (commandText === "open") {
      const tickets = store.listTickets({ active: true }).slice(0, 10);
      return json({
        response_type: "ephemeral",
        text: formatTicketList("Open tickets", tickets)
      });
    }

    await slack.viewsOpen({
      trigger_id: params.trigger_id,
      view: ticketModal("slash", {
        sourceChannelId: params.channel_id,
        sourceResponseUrl: params.response_url || null
      })
    });

    return empty();
  }

  async function handleInteraction(payload) {
    if (payload.type === "view_submission") {
      return handleViewSubmission(payload);
    }

    if (payload.type === "block_actions") {
      return handleBlockActions(payload);
    }

    if (payload.type === "message_action") {
      const sourceMessage = sourceMessageFromMessageAction(payload);
      await slack.viewsOpen({
        trigger_id: payload.trigger_id,
        view: ticketModal("message_action", {
          title: "",
          description: sourceMessage.text || "",
          sourceMessage,
          sourceResponseUrl: payload.response_url || null
        })
      });
      return empty();
    }

    return empty();
  }

  async function handleEventEnvelope(envelope) {
    if (envelope.type === "url_verification") {
      return json({ challenge: envelope.challenge });
    }

    const event = envelope.event;
    if (event?.type === "app_home_opened") {
      const openTickets = store.listTickets({ requesterSlackUserId: event.user, active: true });
      const assignedTickets = store.listTickets({ assignedSlackUserId: event.user, active: true });
      await slack.viewsPublish({
        user_id: event.user,
        view: appHomeView({ clubName: config.clubName, openTickets, assignedTickets })
      });
    }

    return empty();
  }

  async function handleViewSubmission(payload) {
    if (payload.view.callback_id === "ticket_create_modal") {
      const values = parseTicketModalValues(payload.view);
      const metadata = JSON.parse(payload.view.private_metadata || "{}");
      const ticket = store.createTicket({
        ...values,
        requesterSlackUserId: metadata.sourceMessage?.userId || payload.user.id,
        sourceChannelId: metadata.sourceChannelId || metadata.sourceMessage?.channelId || null,
        sourceMessage: metadata.sourceMessage || null,
        sourceResponseUrl: metadata.sourceResponseUrl || null
      });

      await acknowledgeSourceSafely(ticket, metadata.triggerSource);
      const currentTicket = await postWorkflowMessage(ticket, config.unclaimedChannelId, "Unclaimed");
      await copyCreationFilesToWorkflowThread(currentTicket || ticket);
      await alertTeamSafely(ticket);

      return json({ response_action: "clear" });
    }

    return empty();
  }

  async function handleBlockActions(payload) {
    const action = payload.actions?.[0];
    if (!action) return empty();

    if (action.action_id === "app_home_create_ticket") {
      await slack.viewsOpen({
        trigger_id: payload.trigger_id,
        view: ticketModal("app_home")
      });
      return empty();
    }

    const ticketId = action.value || extractTicketIdFromBlockId(action.block_id);
    if (!ticketId) return empty();

    if (!store.getTicket(ticketId)) {
      await markStaleTicketMessage(payload, ticketId);
      return empty();
    }

    if (action.action_id === "assign_ticket") {
      const before = store.findTicket(ticketId);
      const wasUnclaimed = !before.assignedSlackUserId;

      const ticket = store.assignTicket(ticketId, payload.user.id, action.selected_user);

      const currentTicket = wasUnclaimed && config.claimedChannelId
        ? await moveWorkflowMessage(ticket, config.claimedChannelId, "Claimed")
        : ticket;
      if (wasUnclaimed) {
        await deleteTeamAlertSafely(currentTicket);
      }

      if (!wasUnclaimed) {
        await refreshWorkflowMessage(currentTicket);
      }

      const assigneeName = await displayNameForUserId(action.selected_user);
      const actorName = await displayNameForUserId(payload.user.id);

      await postToTicketThreads(
        currentTicket,
        `${actorName} assigned this ticket to ${assigneeName}.`
      );

      return empty();
    }

    if (action.action_id === "claim_ticket") {
      const before = store.findTicket(ticketId);
      const wasUnclaimed = !before.assignedSlackUserId;
      const repliesToCopy = wasUnclaimed ? await readWorkflowRepliesSafely(before) : [];
      const ticket = store.claimTicket(ticketId, payload.user.id);
      const currentTicket = wasUnclaimed && config.claimedChannelId
        ? await moveWorkflowMessage(ticket, config.claimedChannelId, "Claimed")
        : ticket;
      if (wasUnclaimed) {
        await deleteTeamAlertSafely(currentTicket);
      }
      await copyRepliesToWorkflowThread(currentTicket, repliesToCopy);
      if (!wasUnclaimed) {
        await refreshWorkflowMessage(currentTicket);
      }
      await postToTicketThreads(currentTicket, `${await displayNameForUserId(payload.user.id)} claimed this ticket and will respond.`);
      return empty();
    }

    if (action.action_id === "resolve_ticket") {
      const before = store.findTicket(ticketId);
      const repliesToCopy = await readWorkflowRepliesSafely(before);
      const ticket = store.resolveTicket(ticketId, payload.user.id);
      const currentTicket = await moveWorkflowMessage(ticket, config.resolvedChannelId, "Resolved");
      await copyRepliesToWorkflowThread(currentTicket, repliesToCopy);
      await postToTicketThreads(currentTicket, `${await displayNameForUserId(payload.user.id)} resolved this ticket.`);
      return empty();
    }

    if (action.action_id === "escalate_ticket") {
      const ticket = store.escalateTicket(ticketId, payload.user.id);
      await refreshWorkflowMessage(ticket);
      await escalateToLeads(ticket, payload.user.id);
      return empty();
    }

    return empty();
  }

  async function markStaleTicketMessage(payload, ticketId) {
    const channel = payload.container?.channel_id || payload.channel?.id;
    const ts = payload.container?.message_ts || payload.message?.ts;
    console.warn(`Ignoring stale ticket action for missing ticket ${ticketId}.`);

    if (!channel || !ts) return;

    try {
      await slack.chatUpdate({
        channel,
        ts,
        text: "This ticket is no longer available.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*This ticket is no longer available.*\nThe stored ticket record could not be found, so this old message can no longer be used."
            }
          }
        ]
      });
    } catch (error) {
      console.error(`Failed to mark stale ticket message for ticket ${ticketId}`, error.response || error);
    }
  }

  async function acknowledgeSourceSafely(ticket, triggerSource) {
    await acknowledgeSourceResponseUrlSafely(ticket, triggerSource);
  }

  async function acknowledgeSourceResponseUrlSafely(ticket, triggerSource) {
    if (!ticket.sourceResponseUrl) return;

    try {
      await slack.postResponseUrl(ticket.sourceResponseUrl, {
        response_type: triggerSource === "slash" ? "ephemeral" : "in_channel",
        text: "Ticket created!",
        ...(ticket.sourceMessage?.messageTs ? { thread_ts: ticket.sourceMessage.messageTs } : {})
      });
    } catch (error) {
      console.error(`Failed to acknowledge source shortcut for ticket "${ticket.title}"`, error.response || error);
    }
  }

  async function refreshWorkflowMessage(ticket) {
    if (!ticket.workflowChannelId || !ticket.workflowThreadTs) return;
    await slack.chatUpdate({
      channel: ticket.workflowChannelId,
      ts: ticket.workflowThreadTs,
      text: `Ticket: ${ticket.title}`,
      blocks: ticketBlocks(ticket, store.getEvents(ticket.id))
    });
  }

  async function postWorkflowMessage(ticket, channelId, channelLabel) {
    if (!channelId) return null;
    const message = await slack.chatPostMessage({
      channel: channelId,
      text: `Ticket: ${ticket.title}`,
      blocks: ticketBlocks(ticket, store.getEvents(ticket.id))
    });
    const updatedTicket = store.attachWorkflowMessage(ticket.id, message.channel, message.ts);

    return updatedTicket;
  }

  async function moveWorkflowMessage(ticket, destinationChannelId, destinationLabel) {
    const previousChannelId = ticket.workflowChannelId;
    const previousThreadTs = ticket.workflowThreadTs;
    const updatedTicket = await postWorkflowMessage(ticket, destinationChannelId, destinationLabel);

    if (previousChannelId && previousThreadTs) {
      await slack.chatUpdate({
        channel: previousChannelId,
        ts: previousThreadTs,
        text: `Ticket moved to ${destinationLabel}.`,
        blocks: movedTicketBlocks(ticket, destinationLabel)
      });
      deleteThreadLater(previousChannelId, previousThreadTs);
    }

    return updatedTicket;
  }

  async function alertTeamSafely(ticket) {
    try {
      await alertTeam(ticket);
    } catch (error) {
      console.error(`Failed to alert ${teamLabel(ticket)} team for ticket "${ticket.title}"`, error);
      await postToAvailableTicketThread(ticket, `Team alert failed for ${teamLabel(ticket)}. Check that the bot is invited to the configured team channel.`);
    }
  }

  async function alertTeam(ticket) {
    const team = teamConfigForTicket(ticket);
    if (!team) {
      console.warn(`No team config found for ticket "${ticket.title}" with team "${ticket.team || ticket.category}".`);
      return;
    }

    if (!team.channelId) {
      console.warn(`No Slack channel configured for ${team.label}. Set ${team.key.toUpperCase()}_CHANNEL_ID in the environment.`);
      return;
    }

    const message = await slack.chatPostMessage({
      channel: team.channelId,
      text: `A new ticket was made for the ${team.label} team and is in the <#${config.unclaimedChannelId}> channel`
    });

    store.attachTeamMessage(ticket.id, message.channel, message.ts);
  }

  async function deleteTeamAlertSafely(ticket) {
    if (!ticket.teamChannelId || !ticket.teamThreadTs) return;

    await deleteSlackMessageSafely(ticket.teamChannelId, ticket.teamThreadTs);
  }

  async function postToTicketThreads(ticket, text) {
    if (ticket.workflowChannelId && ticket.workflowThreadTs) {
      await slack.chatPostMessage({
        channel: ticket.workflowChannelId,
        thread_ts: ticket.workflowThreadTs,
        text
      });
    }
  }

  async function postToAvailableTicketThread(ticket, text) {
    if (ticket.workflowChannelId && ticket.workflowThreadTs) {
      await slack.chatPostMessage({
        channel: ticket.workflowChannelId,
        thread_ts: ticket.workflowThreadTs,
        text
      });
    }
  }

  async function readWorkflowRepliesSafely(ticket) {
    if (!ticket.workflowChannelId || !ticket.workflowThreadTs) return [];

    try {
      const response = await slack.conversationsReplies({
        channel: ticket.workflowChannelId,
        ts: ticket.workflowThreadTs,
        limit: 15
      });
      return (response.messages || []).filter((message) => message.ts !== ticket.workflowThreadTs);
    } catch (error) {
      console.error(`Failed to read workflow replies for ticket "${ticket.title}"`, {
        channel: ticket.workflowChannelId,
        threadTs: ticket.workflowThreadTs,
        slackError: error.response || error
      });
      return [];
    }
  }

  async function copyRepliesToWorkflowThread(ticket, replies) {
    if (!ticket.workflowChannelId || !ticket.workflowThreadTs || replies.length === 0) return;

    for (const reply of replies) {
      if (isCopyHeaderReply(reply)) continue;

      const text = await formatCopiedReply(reply);
      if (text) {
        await slack.chatPostMessage({
          channel: ticket.workflowChannelId,
          thread_ts: ticket.workflowThreadTs,
          text
        });
      }

      await copyReplyFilesToWorkflowThread(ticket, reply);
    }
  }

  function deleteThreadLater(channel, ts, delayMs = 15000) {
    setTimeout(async () => {
      try {
        const messages = await readAllThreadMessages(channel, ts);
        const replyMessages = messages.filter((message) => message.ts !== ts).reverse();

        for (const message of replyMessages) {
          await deleteSlackMessageSafely(channel, message.ts, message);
        }

        await deleteSlackMessageSafely(channel, ts, messages.find((message) => message.ts === ts));
      } catch (error) {
        console.error(`Failed to delete moved ticket thread in ${channel} at ${ts}`, error.response || error);
      }
    }, delayMs);
  }

  async function readAllThreadMessages(channel, ts) {
    const messages = [];
    let cursor;

    do {
      const response = await slack.conversationsReplies({
        channel,
        ts,
        limit: 100,
        ...(cursor ? { cursor } : {})
      });
      messages.push(...(response.messages || []));
      cursor = response.response_metadata?.next_cursor || "";
    } while (cursor);

    return messages;
  }

  async function deleteSlackMessageSafely(channel, ts, knownMessage = null) {
    try {
      const message = knownMessage || await findThreadMessage(channel, ts);
      await deleteMessageFilesSafely(message);
      await slack.chatDelete({ channel, ts });
    } catch (error) {
      console.error(`Failed to delete Slack message in ${channel} at ${ts}`, error.response || error);
    }
  }

  async function findThreadMessage(channel, ts) {
    try {
      const response = await slack.conversationsReplies({
        channel,
        ts,
        limit: 1
      });
      return response.messages?.[0] || null;
    } catch {
      return null;
    }
  }

  async function deleteMessageFilesSafely(message) {
    for (const file of message?.files || []) {
      if (!file.id) continue;

      try {
        await slack.filesDelete({ file: file.id });
      } catch (error) {
        console.error(`Failed to delete Slack file ${file.id}`, error.response || error);
      }
    }
  }

  function isCopyHeaderReply(reply) {
    const text = reply.text?.trim();
    return text === "Copied replies from the claimed ticket thread:" ||
      text === "Copied replies from the unclaimed ticket thread:";
  }

  async function copyReplyFilesToWorkflowThread(ticket, reply) {
    const files = reply.files || [];
    if (files.length === 0) return;

    const authorName = reply.user ? await displayNameForReply(reply) : "Unknown user";

    for (const file of files) {
      try {
        await copySlackFileToThread({
          file,
          channelId: ticket.workflowChannelId,
          threadTs: ticket.workflowThreadTs
        });
      } catch (error) {
        console.error(`Failed to copy Slack file ${file.id || file.name || ""}`, error.response || error);
        await slack.chatPostMessage({
          channel: ticket.workflowChannelId,
          thread_ts: ticket.workflowThreadTs,
          text: `${authorName} attached ${file.title || file.name || "a file"}, but the app could not copy it.`
        });
      }
    }
  }

  async function copyCreationFilesToWorkflowThread(ticket) {
    const files = ticket.creationFiles || [];
    if (!ticket.workflowChannelId || !ticket.workflowThreadTs || files.length === 0) return;

    for (const file of files) {
      try {
        const hydratedFile = await hydrateSlackFile(file);
        await copySlackFileToThread({
          file: hydratedFile,
          channelId: ticket.workflowChannelId,
          threadTs: ticket.workflowThreadTs
        });
      } catch (error) {
        console.error(`Failed to copy ticket creation file ${file.id || file.name || ""}`, error.response || error);
        await slack.chatPostMessage({
          channel: ticket.workflowChannelId,
          thread_ts: ticket.workflowThreadTs,
          text: `A file was attached during ticket creation, but the app could not copy it.`
        });
      }
    }
  }

  async function hydrateSlackFile(file) {
    if (file.url_private_download || file.url_private) return file;
    if (!file.id) return file;

    const response = await slack.filesInfo({ file: file.id });
    return response.file || file;
  }

  async function copySlackFileToThread({ file, channelId, threadTs, initialComment }) {
    const sourceUrl = file.url_private_download || file.url_private;
    if (!sourceUrl) {
      throw new Error("File has no private download URL");
    }

    const filename = file.name || file.title || "attachment";
    const downloaded = await slack.downloadFile(sourceUrl);
    const upload = await slack.filesGetUploadURLExternal({
      filename,
      length: downloaded.bytes.byteLength
    });

    await slack.uploadFileBytes(upload.upload_url, downloaded.bytes, downloaded.contentType);
    await slack.filesCompleteUploadExternal({
      channel_id: channelId,
      thread_ts: threadTs,
      ...(initialComment ? { initial_comment: initialComment } : {}),
      files: [
        {
          id: upload.file_id,
          title: file.title || filename
        }
      ]
    });
  }

  async function formatCopiedReply(reply) {
    const text = await replaceUserMentions(reply.text?.trim() || "");
    if (!text) return "";

    if (!reply.user) return text;

    return `${await displayNameForReply(reply)}: ${text}`;
  }

  async function displayNameForReply(reply) {
    const profileName = reply.user_profile?.display_name || reply.user_profile?.real_name || reply.user_profile?.name;
    if (profileName) return profileName;

    return displayNameForUserId(reply.user);
  }

  async function replaceUserMentions(text) {
    const userIds = [...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)].map((match) => match[1]);
    const uniqueUserIds = [...new Set(userIds)];
    const names = new Map();

    for (const userId of uniqueUserIds) {
      names.set(userId, await displayNameForUserId(userId));
    }

    return text.replace(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g, (_match, userId) => names.get(userId) || userId);
  }

  async function displayNameForUserId(userId) {
    try {
      const response = await slack.usersInfo({ user: userId });
      return response.user?.profile?.display_name || response.user?.profile?.real_name || response.user?.name || userId;
    } catch (error) {
      console.error(`Failed to look up Slack user ${userId}`, error.response || error);
      return userId;
    }
  }

  async function escalateToLeads(ticket, actorSlackUserId) {
    const team = teamConfigForTicket(ticket);
    const leadMentions = team?.leadUserIds?.map((userId) => `<@${userId}>`).join(" ") || "";
    const text = leadMentions
      ? `${leadMentions} Ticket "${ticket.title}" was escalated by <@${actorSlackUserId}>.`
      : `Ticket "${ticket.title}" was escalated by <@${actorSlackUserId}>, but no ${teamLabel(ticket)} lead user IDs are configured.`;

    await postToTicketThreads(ticket, text);

    for (const leadUserId of team?.leadUserIds || []) {
      await slack.chatPostMessage({
        channel: leadUserId,
        text: `Ticket "${ticket.title}" was escalated by <@${actorSlackUserId}>.`
      });
    }
  }

  function teamConfigForTicket(ticket) {
    return config.teams[ticket.team || ticket.category];
  }

  function teamLabel(ticket) {
    return teamConfigForTicket(ticket)?.label || ticket.team || ticket.category || "selected";
  }

  return {
    handleSlashCommand,
    handleInteraction,
    handleEventEnvelope
  };
}

function sourceMessageFromMessageAction(payload) {
  return {
    channelId: payload.channel?.id,
    messageTs: payload.message?.ts,
    userId: payload.message?.user,
    text: payload.message?.text || ""
  };
}

function extractTicketIdFromBlockId(blockId = "") {
  const match = blockId.match(/^ticket_actions_(\d+)$/);
  return match?.[1] || null;
}

function formatTicketList(title, tickets) {
  if (tickets.length === 0) return `${title}: none.`;
  return [`*${title}*`, ...tickets.map((ticket) => `${ticket.title} - ${ticket.status}`)].join("\n");
}

function json(body, statusCode = 200) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}

function empty(statusCode = 200) {
  return { statusCode, headers: {}, body: "" };
}

# Club Slack Ticketing

A small, dependency-free Slack ticketing app for clubs. Members create tickets from `/ticket` or a Slack message shortcut; responders manage tickets with Slack buttons, assignment, escalation, and resolution.

## Features

- `/ticket` opens a Slack modal for new requests.
- Right-clicking a Slack message can create a ticket from that message using the message shortcut.
- Ticket creation supports optional file attachments, copied into the unclaimed ticket thread.
- Ticket numbers are not shown in Slack messages; tickets are identified by title and workflow state.
- `/ticket open` lists active tickets.
- Unclaimed, claimed, and resolved workflow channels receive the current ticket post.
- Tickets are routed to Mechanical, Electrical, Research, or Business.
- Team channels receive a threaded notice when their ticket type is selected.
- Responders can claim tickets, assign a user, resolve tickets, and escalate to team leads.
- App Home shows a member's open tickets and tickets assigned to them.
- File-backed JSON storage, with a narrow store layer that can be replaced by Postgres later.
- No npm packages required.

## Requirements

- Node.js 20 or newer.
- A Slack workspace where you can create apps.
- A public HTTPS URL for local development, usually from ngrok, Cloudflare Tunnel, or a hosted deployment.

## Quick Start

1. Copy `.env.example` to `.env`.
2. Create workflow channels for unclaimed, claimed, and resolved tickets.
3. Create a Slack app from `slack-app-manifest.yml`.
4. Replace every `https://YOUR_PUBLIC_URL` value in the Slack app settings with your public URL.
5. Install the Slack app to your workspace.
6. Put these values in `.env`:

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_UNCLAIMED_CHANNEL_ID=C...
SLACK_CLAIMED_CHANNEL_ID=C...
SLACK_RESOLVED_CHANNEL_ID=C...
PORT=3000
DATA_FILE=./data/tickets.json
CLUB_NAME=My Club

MECHANICAL_CHANNEL_ID=C...
ELECTRICAL_CHANNEL_ID=C...
RESEARCH_CHANNEL_ID=C...
BUSINESS_CHANNEL_ID=C...

MECHANICAL_LEAD_USER_IDS=U...,U...
ELECTRICAL_LEAD_USER_IDS=U...
RESEARCH_LEAD_USER_IDS=U...
BUSINESS_LEAD_USER_IDS=U...
```

7. Invite the bot to your workflow channels and each private team channel:

```text
/invite @Club Tickets
```

8. Start the server:

```bash
node src/server.js
```

9. In Slack, run:

```text
/ticket
```

## Local HTTPS During Development

Slack needs to reach your machine over HTTPS. One option:

```bash
ngrok http 3000
```

Then use the generated HTTPS URL in:

- Slash command URL: `/slack/commands`
- Interactivity request URL: `/slack/interactions`
- Event subscription URL: `/slack/events`

## Commands

```bash
node src/server.js
node --test
```

If your machine has npm available, these aliases also work:

```bash
npm start
npm test
```

## Project Structure

```text
src/server.js       HTTP server and Slack request routing
src/handlers.js     Slack command, event, modal, and button handlers
src/views.js        Slack Block Kit modal/message/App Home builders
src/store.js        File-backed ticket storage
src/signing.js      Slack signature verification
src/slack.js        Minimal Slack Web API client
docs/deploy.md      Deployment notes
docs/roadmap.md     Suggested next iterations
```

## Production Notes

This is intentionally simple. Before relying on it for a larger organization, move storage to Postgres, add backups, add officer-only authorization for triage actions, and add structured logging.

## Team Routing

The ticket form asks members to select one team:

- Mechanical
- Electrical
- Research
- Business

Each team can have a private Slack channel configured in `.env`. When a ticket is created, the app posts `Ticket created!` in that team's channel, then replies in that thread with a notice that the ticket is available in the unclaimed channel. The team-channel notice does not include claim, resolve, or escalation buttons; those controls live on the workflow ticket card.

Escalation uses the `*_LEAD_USER_IDS` values. When someone clicks **Escalate**, the app posts in the ticket threads tagging those leads and sends each lead a DM.

## Workflow Channels

Set these channel IDs in `.env`:

- `SLACK_UNCLAIMED_CHANNEL_ID`
- `SLACK_CLAIMED_CHANNEL_ID`
- `SLACK_RESOLVED_CHANNEL_ID`

New tickets are posted to the unclaimed channel. When someone clicks **Claim**, the app posts the current ticket in the claimed channel and marks the old workflow post as moved. When someone clicks **Resolve**, the app posts the current ticket in the resolved channel, copies replies from the claimed ticket thread into the resolved ticket thread, and marks the previous workflow post as moved.

Slack does not provide an API to physically move an existing message and all of its replies into another channel. This app creates the next workflow post in the destination channel and copies thread replies when resolving. Reply and file copying requires `channels:history`, `groups:history`, `files:read`, and `files:write`; reinstall the Slack app after adding those scopes.

Slack modal file uploads have a 10MB per-file limit.

The channel where `/ticket` was used only receives:

```text
Ticket created!
```

The full actionable ticket card stays in the workflow channels.

# Deployment

## Minimal Hosting Shape

Run this as a long-lived Node service behind HTTPS:

```bash
node src/server.js
```

Set these environment variables in your host:

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_UNCLAIMED_CHANNEL_ID=C...
SLACK_CLAIMED_CHANNEL_ID=C...
SLACK_RESOLVED_CHANNEL_ID=C...
PORT=3000
DATA_FILE=/var/lib/club-slack-ticketing/tickets.json
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

## Good Small-Club Hosts

- Render web service
- Fly.io machine
- Railway service
- A small VPS with systemd

## Render Example

- Runtime: Node
- Build command: leave blank or use `node --version`
- Start command: `node src/server.js`
- Add the environment variables above.
- Use the Render HTTPS URL in the Slack app URLs.

## VPS systemd Example

```ini
[Unit]
Description=Club Slack Ticketing
After=network.target

[Service]
WorkingDirectory=/opt/club-slack-ticketing
EnvironmentFile=/opt/club-slack-ticketing/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
User=clubtickets

[Install]
WantedBy=multi-user.target
```

Put nginx, Caddy, or another reverse proxy in front of it for HTTPS.

## Storage

The default storage is a JSON file. That is fine for a club MVP if the host has persistent disk and the ticket volume is low.

Move to Postgres when:

- multiple app instances are running,
- you need reliable backups and reporting,
- edits become frequent enough that file storage feels risky,
- you want a web dashboard.

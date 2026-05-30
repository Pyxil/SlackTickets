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

## Railway Example

Railway redeploys replace the app container filesystem. To keep Slack button IDs matched to stored tickets after every deploy, store `tickets.json` on a Railway volume.

1. In Railway, open the ticketing service.
2. Go to **Volumes** and add a volume.
3. Mount it at:

```text
/data
```

4. In **Variables**, set:

```bash
DATA_FILE=/data/tickets.json
```

5. Redeploy the service.
6. Open the service logs and confirm startup prints:

```text
Ticket data file: /data/tickets.json
```

Do not leave production Railway storage at `./data/tickets.json`; that path lives inside the redeployed container and can be reset. If you change `DATA_FILE` after tickets already exist, copy the old JSON file into the new volume path or old Slack buttons will point at tickets the app can no longer find.

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

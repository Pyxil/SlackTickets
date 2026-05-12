# Roadmap

## Version 1

- Create tickets from `/ticket`.
- Manage tickets from workflow channels.
- App Home ticket lists.
- Route tickets to Mechanical, Electrical, Research, and Business team channels.
- Claim tickets and escalate tickets to configured team leads.
- Move active workflow posts through unclaimed, claimed, and resolved channels.

## Version 1.1

- Officer authorization by Slack user group or allowlist.
- Better `/ticket open` filters.
- Due dates and stale ticket reminders.
- Export CSV.
- Default responders by team.

## Version 2

- Postgres storage.
- Web dashboard.
- Full audit log screen.
- Search.
- Slack Workflow Builder trigger.
- Anonymous/public request form for people outside the workspace.

## Suggested Database Upgrade

Keep the public methods from `src/store.js` and replace only the implementation:

- `createTicket`
- `resolveTicket`
- `assignTicket`
- `addComment`
- `listTickets`
- `getTicket`
- `getEvents`

That avoids changing Slack handlers when moving from JSON storage to Postgres.

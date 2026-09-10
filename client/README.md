# client/

Per-client content. On the base template this folder holds only this file.

When a Staff Room is built for a specific business (the AI Staffroom lead-magnet
pipeline does this), the generator writes:

- `CLIENT.md` the brief: what the business is, which agents were built, first-week plan
- `client.json` the same, machine-readable (no contact details)
- `agents.seed.yaml` the agents that appear on first boot (same keys as `agents.yaml`).
  The Boss / chief of staff from the defaults is kept automatically.
- `skills/<client-slug>/<skill>/SKILL.md` SOPs and playbooks. Copied into
  `$HERMES_HOME/skills/` at boot so every agent can read them; listed on the
  Skills page under the client's name.

Nothing here is required. A repo without these files boots with the default agents.

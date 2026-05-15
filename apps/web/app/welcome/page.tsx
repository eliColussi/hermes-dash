export default function WelcomePage() {
  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-4xl font-semibold tracking-tight">Welcome to Staff Room OS</h1>
      <p className="text-muted mt-3">
        This is the dashboard for your autonomous AI staff, powered by HERMÉS Agent under the
        hood. Spin up new agents from the Agents tab, delegate work in Tasks, watch what they do
        in Activity, and tail their logs live in Log.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
        <div className="card p-5">
          <div className="text-sm font-medium mb-1">1 · Add an agent</div>
          <div className="text-xs text-muted">
            Define a role, system prompt, and pick a model. The dashboard handles the rest.
          </div>
        </div>
        <div className="card p-5">
          <div className="text-sm font-medium mb-1">2 · Start it</div>
          <div className="text-xs text-muted">
            One click spawns a HERMÉS process and the status dot turns green.
          </div>
        </div>
        <div className="card p-5">
          <div className="text-sm font-medium mb-1">3 · Delegate</div>
          <div className="text-xs text-muted">
            Send the agent a task. Watch progress in Activity and Log.
          </div>
        </div>
        <div className="card p-5">
          <div className="text-sm font-medium mb-1">4 · Iterate</div>
          <div className="text-xs text-muted">
            Refine the prompt, swap toolsets, scale up. No terminal required.
          </div>
        </div>
      </div>
    </div>
  );
}

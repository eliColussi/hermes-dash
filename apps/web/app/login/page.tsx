"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Land on Home, not the old setup checklist. /welcome went off the menu in
  // 74c375d but stayed the post-login default, so every owner logged in to the
  // page we had deliberately hidden.
  const next = params.get("next") || "/home";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: r.statusText }));
        throw new Error(body.error || "Login failed.");
      }
      router.replace(next);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="font-display text-3xl tracking-tight">Staff Room</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted mt-1.5">
            Operating System
          </div>
        </div>
        <form
          onSubmit={submit}
          className="card p-6 flex flex-col gap-4 shadow-lg"
        >
          <div>
            <label className="text-xs font-medium text-muted block mb-1.5">
              Username
            </label>
            <input
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              placeholder="admin"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted block mb-1.5">
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="••••••••"
            />
          </div>
          {err && (
            <div className="text-sm text-bad bg-bad/5 border border-bad/20 rounded-lg px-3 py-2">
              {err}
            </div>
          )}
          <button
            type="submit"
            disabled={busy || !username || !password}
            className="btn-primary w-full disabled:opacity-40"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="text-xs text-muted text-center mt-6">
          Lost your credentials? Send your team a message — they&apos;ll reset
          them for you.
        </p>
      </div>
    </div>
  );
}

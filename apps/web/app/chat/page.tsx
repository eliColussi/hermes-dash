"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, MessageSquare, Plus, Send, Trash2, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Agent, ChatMessage, ChatThread, api, chat } from "@/lib/api";

export default function ChatPage() {
  const qc = useQueryClient();
  const agentsQ = useQuery({ queryKey: ["agents"], queryFn: api.agents });
  const threadsQ = useQuery({ queryKey: ["chat-threads"], queryFn: () => chat.threads() });

  const agents = agentsQ.data ?? [];
  const threads = threadsQ.data?.items ?? [];

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [showNewMenu, setShowNewMenu] = useState(false);

  // Auto-select the first thread on load
  useEffect(() => {
    if (!activeThreadId && threads.length > 0) {
      setActiveThreadId(threads[0].id);
    }
  }, [threads, activeThreadId]);

  const createMut = useMutation({
    mutationFn: (agent_id: string) => chat.create({ agent_id }),
    onSuccess: (thread) => {
      qc.invalidateQueries({ queryKey: ["chat-threads"] });
      setActiveThreadId(thread.id);
      setShowNewMenu(false);
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => chat.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat-threads"] });
      setActiveThreadId(null);
    },
  });

  const agentLookup = useMemo(() => {
    const m = new Map<string, Agent>();
    agents.forEach((a) => m.set(a.id, a));
    return m;
  }, [agents]);

  return (
    <div className="flex h-[calc(100vh-6rem)] -m-8 border-t border-line">
      {/* Left rail: thread list */}
      <div className="w-[280px] shrink-0 border-r border-line bg-surface flex flex-col">
        <div className="p-3 border-b border-line">
          <div className="relative">
            <button
              onClick={() => setShowNewMenu((s) => !s)}
              disabled={agents.length === 0}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <Plus className="w-4 h-4" /> New conversation
              <ChevronDown className="w-3 h-3" />
            </button>
            {showNewMenu && agents.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-10 card py-1 shadow-lg max-h-72 overflow-y-auto">
                {agents.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => createMut.mutate(a.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-3 text-left"
                  >
                    <span className="text-lg">{a.icon}</span>
                    <span className="flex-1 truncate">{a.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {agents.length === 0 && (
            <div className="text-[11px] text-muted mt-2 text-center">
              Create an agent first.
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {threads.length === 0 && (
            <div className="p-6 text-center text-xs text-muted">
              <MessageSquare className="w-6 h-6 mx-auto mb-2 opacity-50" />
              No conversations yet.
            </div>
          )}
          {threads.map((t) => {
            const agent = agentLookup.get(t.agent_id);
            const active = t.id === activeThreadId;
            return (
              <button
                key={t.id}
                onClick={() => setActiveThreadId(t.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-line/40 hover:bg-surface-2 ${
                  active ? "bg-accent-soft/40" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm shrink-0">{agent?.icon ?? "🤖"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{t.title}</div>
                    <div className="text-[10px] text-muted truncate">
                      {t.agent_name}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right pane: messages */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeThreadId ? (
          <ChatPane
            key={activeThreadId}
            threadId={activeThreadId}
            agent={agentLookup.get(threads.find((t) => t.id === activeThreadId)?.agent_id ?? "")}
            onDelete={() => removeMut.mutate(activeThreadId)}
          />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center text-center p-8">
      <div className="max-w-sm">
        <MessageSquare className="w-10 h-10 mx-auto text-muted mb-3" />
        <div className="font-display text-xl tracking-tight mb-1">Chat with your agents</div>
        <p className="text-sm text-muted">
          Pick an agent on the left to start a conversation. Test what they
          can do, hand them a task, or just see how they think — no Slack or
          Telegram setup needed.
        </p>
      </div>
    </div>
  );
}

function ChatPane({
  threadId,
  agent,
  onDelete,
}: {
  threadId: string;
  agent: Agent | undefined;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["chat-messages", threadId],
    queryFn: () => chat.messages(threadId),
    refetchOnWindowFocus: false,
  });

  const sendMut = useMutation({
    mutationFn: (content: string) => chat.send(threadId, content),
    onSuccess: (data) => {
      qc.setQueryData(["chat-messages", threadId], data);
      qc.invalidateQueries({ queryKey: ["chat-threads"] });
    },
  });

  const [input, setInput] = useState("");
  // Track the in-flight user message so it renders immediately on send and
  // before the server-side state.db read returns. iMessage-style — the bubble
  // pops into the right-hand column the moment the operator hits Enter.
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [q.data?.messages?.length, sendMut.isPending, pendingUser]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sendMut.isPending) return;
    setInput("");
    setPendingUser(trimmed);
    sendMut.mutate(trimmed, {
      onSettled: () => setPendingUser(null),
    });
  }

  const thread = q.data?.thread;
  const serverMessages = (q.data?.messages ?? []).filter(
    (m) => m.role !== "system",
  );
  // If the server's last user message is the one we just sent, drop the
  // optimistic pending bubble. Otherwise show it on top of the server set
  // so the user always sees their text the instant they submit.
  const lastUser = [...serverMessages].reverse().find((m) => m.role === "user");
  const showPending =
    pendingUser !== null && (lastUser?.content ?? "").trim() !== pendingUser.trim();
  const messages = showPending
    ? [
        ...serverMessages,
        {
          id: -999,
          role: "user",
          content: pendingUser,
          tool_calls: null,
          tool_name: null,
          tool_call_id: null,
          timestamp: Date.now() / 1000,
          reasoning: null,
        } satisfies ChatMessage,
      ]
    : serverMessages;

  return (
    <>
      {/* Header */}
      <div className="px-5 py-3 border-b border-line flex items-center justify-between bg-surface">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-[var(--bg)] border border-line flex items-center justify-center text-lg shrink-0">
            {agent?.icon ?? "🤖"}
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{thread?.title ?? "…"}</div>
            <div className="text-[11px] text-muted">{agent?.name}</div>
          </div>
        </div>
        <button
          onClick={() => {
            if (confirm("Delete this conversation?")) onDelete();
          }}
          className="p-1.5 hover:bg-surface-3 rounded text-bad"
          title="Delete conversation"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {q.isLoading && <div className="text-sm text-muted">Loading…</div>}
        {!q.isLoading && messages.length === 0 && !sendMut.isPending && (
          <div className="text-sm text-muted text-center py-12">
            Say hello — the agent is waiting.
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} agentIcon={agent?.icon ?? "🤖"} />
        ))}
        {sendMut.isPending && (
          <ThinkingBubble agentIcon={agent?.icon ?? "🤖"} />
        )}
        {sendMut.isError && (
          <div className="text-sm text-bad">
            {sendMut.error instanceof Error ? sendMut.error.message : "Something went wrong."}
          </div>
        )}
      </div>

      {/* Composer */}
      <form onSubmit={submit} className="border-t border-line p-4 bg-surface flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
          placeholder={`Message ${agent?.name ?? "the agent"}…`}
          rows={1}
          disabled={sendMut.isPending}
          className="input flex-1 resize-none max-h-40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || sendMut.isPending}
          className="btn-primary px-4 disabled:opacity-40"
          title="Send (Enter)"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </>
  );
}

function MessageBubble({ m, agentIcon }: { m: ChatMessage; agentIcon: string }) {
  const isUser = m.role === "user";
  const isTool = m.role === "tool";
  const parsed = m.tool_calls ? safeJSON(m.tool_calls) : null;
  const toolCalls: Array<{ function?: { name?: string }; name?: string }> | null =
    Array.isArray(parsed) ? (parsed as Array<{ function?: { name?: string }; name?: string }>) : null;

  if (isTool) {
    // Tool result — render as a compact collapsible card so the conversation
    // doesn't get drowned in JSON.
    return (
      <details className="ml-12 text-[11px]">
        <summary className="cursor-pointer text-muted flex items-center gap-1.5 hover:text-ink">
          <Wrench className="w-3 h-3" />
          <span className="font-mono">{m.tool_name || "tool"} result</span>
        </summary>
        <pre className="mt-1 p-2 bg-surface-2 border border-line rounded text-[10px] font-mono overflow-x-auto whitespace-pre-wrap max-h-48">
          {(m.content ?? "").slice(0, 4000)}
        </pre>
      </details>
    );
  }

  return (
    <div className={`flex gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-[var(--bg)] border border-line flex items-center justify-center text-sm shrink-0">
          {agentIcon}
        </div>
      )}
      <div
        className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed ${
          isUser
            ? "bg-accent text-accent-fg rounded-tr-sm"
            : "bg-surface-2 border border-line rounded-tl-sm"
        }`}
      >
        {m.content || <span className="italic text-muted">…</span>}
        {toolCalls && toolCalls.length > 0 && (
          <div className="mt-2 pt-2 border-t border-line/40 space-y-1">
            {toolCalls.map((tc, i) => (
              <div key={i} className="text-[10px] flex items-center gap-1.5 text-muted">
                <Wrench className="w-2.5 h-2.5" />
                <span className="font-mono">{tc?.function?.name ?? tc?.name ?? "tool"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingBubble({ agentIcon }: { agentIcon: string }) {
  return (
    <div className="flex gap-2.5 justify-start">
      <div className="w-7 h-7 rounded-full bg-[var(--bg)] border border-line flex items-center justify-center text-sm shrink-0">
        {agentIcon}
      </div>
      <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-sm bg-surface-2 border border-line">
        <div className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}

function safeJSON(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

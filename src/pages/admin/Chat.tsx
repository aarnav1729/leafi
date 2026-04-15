import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Bot,
  Send,
  Sparkles,
  RefreshCcw,
  Database,
  Download,
  CheckCircle2,
  User as UserIcon,
  Info,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  at: string;
};

type StatusResp = {
  ok: boolean;
  reachable: boolean;
  url: string;
  model: string;
  modelInstalled: boolean;
  installedModels?: string[];
  error?: string;
  hint?: string;
};

type ContextResp = {
  ok: boolean;
  context: any;
  suggestedQuestions: string[];
};

export default function ChatPage() {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [ctx, setCtx] = useState<ContextResp | null>(null);
  const [ctxLoading, setCtxLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const [ctxOpen, setCtxOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const loadStatus = React.useCallback(async () => {
    setStatusLoading(true);
    try {
      const r = await fetch("/api/admin/chat/status", {
        credentials: "include",
      });
      setStatus(await r.json());
    } catch (e: any) {
      setStatus({
        ok: false,
        reachable: false,
        url: "",
        model: "",
        modelInstalled: false,
        error: e?.message || "status failed",
      });
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadContext = React.useCallback(async () => {
    setCtxLoading(true);
    try {
      setError("");
      const r = await fetch("/api/admin/chat/context", {
        credentials: "include",
      });

      const data = (await r.json()) as ContextResp & {
        ok?: boolean;
        error?: string;
      };

      if (!r.ok || !data?.ok) {
        setCtx(null);
        throw new Error(data?.error || `HTTP ${r.status}`);
      }

      setCtx(data);
    } catch (e: any) {
      setCtx(null);
      setError(e?.message || "Failed to load analytics context");
    } finally {
      setCtxLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadContext();
  }, [loadStatus, loadContext]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, asking]);

  const runSetup = async () => {
    setSetupBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/chat/setup", {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json();
      if (!data.ok) {
        setError(data.error || "Setup failed");
      }
      await loadStatus();
    } catch (e: any) {
      setError(e?.message || "Setup failed");
    } finally {
      setSetupBusy(false);
    }
  };

  const askQuestion = async (qRaw: string) => {
    const q = (qRaw || "").trim();
    if (!q) return;
    setError("");

    const userMsg: ChatMessage = {
      role: "user",
      content: q,
      at: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setAsking(true);

    try {
      const r = await fetch("/api/admin/chat/ask", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          history: nextMessages.slice(-10).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        const hint = data?.hint ? `\n\nHint: ${data.hint}` : "";
        setError((data?.error || `HTTP ${r.status}`) + hint);
        setAsking(false);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer || "(empty response)",
          at: new Date().toISOString(),
        },
      ]);
    } catch (e: any) {
      setError(e?.message || "ask failed");
    } finally {
      setAsking(false);
    }
  };

  // Always allow asking — the backend rule-engine handles the common CXO
  // questions deterministically, and Ollama (when installed) adds natural
  // phrasing on top. Either way the user can chat.
  const canAsk = !asking && !!input.trim();

  const summary = ctx?.context?.summary;
  const suggestions = ctx?.suggestedQuestions || [];
  const platform = ctx?.context?.platform;
  const capabilities: string[] = ctx?.context?.capabilities || [];
  const improvements: string[] = ctx?.context?.platform?.recommendedImprovements || [];
  const entityCounts = ctx?.context?.entityCounts || {};

  const statusBadge = useMemo(() => {
    if (statusLoading)
      return <Badge variant="outline">Checking runtime…</Badge>;
    if (!status) {
      return (
        <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
          Rule engine ready
        </Badge>
      );
    }
    if (!status.reachable) {
      return (
        <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
          Rule engine ready · Ollama offline
        </Badge>
      );
    }
    if (!status.modelInstalled) {
      return (
        <Badge className="bg-amber-500 text-white hover:bg-amber-500">
          Rule engine ready · LLM not installed
        </Badge>
      );
    }
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
        LLM + rule engine · {status.model}
      </Badge>
    );
  }, [status, statusLoading]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Ask the Data
          </h1>
          <p className="text-sm text-muted-foreground">
            Ask plain-English questions about RFQs, quotes, allocations,
            vendors, lanes, pricing, trends, and what the platform’s data
            actually means.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {statusBadge}
          <Button size="sm" variant="outline" onClick={loadStatus}>
            <RefreshCcw className="h-4 w-4 mr-1" />
            Recheck
          </Button>
        </div>
      </div>

      {/* Optional LLM setup banner — non-blocking; chat works without it */}
      {(!status?.reachable || !status?.modelInstalled) && (
        <Card className="border-sky-300 bg-sky-50/60">
          <CardContent className="p-4 text-sm">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 h-4 w-4 text-sky-700" />
              <div className="space-y-2 w-full">
                <div className="font-semibold">
                  Chat is ready — using the built-in rule engine.
                </div>
                <div className="text-muted-foreground">
                  Optional: install Ollama + a local model for natural-language
                  phrasing. The rule engine will keep providing grounded answers
                  either way.
                </div>
                {!status?.reachable ? (
                  <div className="text-xs text-muted-foreground">
                    Start Ollama on the server (<code>ollama serve</code>) and
                    click Recheck to enable LLM polish.
                    {status?.hint && <div className="mt-1">{status.hint}</div>}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={runSetup}
                      disabled={setupBusy}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      {setupBusy
                        ? "Pulling model…"
                        : `Install "${status.model}" (optional)`}
                    </Button>
                    <span className="text-muted-foreground text-xs">
                      First download is 1–4&nbsp;GB.
                    </span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dataset context (collapsible) */}
      <Collapsible open={ctxOpen} onOpenChange={setCtxOpen}>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-4 w-4" />
                What the assistant knows about
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={loadContext}
                  disabled={ctxLoading}
                >
                  <RefreshCcw className="h-3.5 w-3.5 mr-1" />
                  {ctxLoading ? "Refreshing…" : "Refresh"}
                </Button>
                <CollapsibleTrigger asChild>
                  <Button size="sm" variant="outline">
                    {ctxOpen ? "Hide" : "Show"}
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
          </CardHeader>
          {(platform || summary) && (
            <CardContent className="pt-0 space-y-4">
              {platform && (
                <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                  <div className="font-semibold text-foreground">
                    {platform.name}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {platform.purpose}
                  </div>
                </div>
              )}

              {summary && (
                <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">RFQs</div>
                    <div className="font-semibold">{summary.totalRFQs}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Quotes</div>
                    <div className="font-semibold">{summary.totalQuotes}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">Allocations</div>
                    <div className="font-semibold">
                      {summary.totalAllocations}
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-muted-foreground">
                      Containers allocated / requested
                    </div>
                    <div className="font-semibold">
                      {summary.totalContainersAllocated} /{" "}
                      {summary.totalContainersRequested}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2 text-xs">
                <div className="rounded-md border p-3">
                  <div className="font-semibold text-foreground">
                    Entity coverage
                  </div>
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    <div>Vendors: {entityCounts.vendors ?? "—"}</div>
                    <div>Ports: {entityCounts.portsOfLoading ?? "—"}</div>
                    <div>Companies: {entityCounts.companies ?? "—"}</div>
                    <div>Container Types: {entityCounts.containerTypes ?? "—"}</div>
                    <div>Lanes: {entityCounts.lanes ?? "—"}</div>
                  </div>
                </div>

                <div className="rounded-md border p-3">
                  <div className="font-semibold text-foreground">
                    What it can answer
                  </div>
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    {capabilities.slice(0, 6).map((item) => (
                      <div key={item}>• {item}</div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          )}
          <CollapsibleContent>
            <CardContent className="pt-0 text-xs">
              <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3">
                {JSON.stringify(ctx?.context, null, 2)}
              </pre>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Suggestions */}
      {suggestions.length > 0 && messages.length === 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="h-4 w-4" />
              Suggested questions
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {suggestions.map((q) => (
              <Button
                key={q}
                size="sm"
                variant="outline"
                className="text-left whitespace-normal"
                onClick={() => askQuestion(q)}
                disabled={asking}
              >
                {q}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Chat transcript */}
      <Card className="flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Conversation
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div
            ref={listRef}
            className="h-[400px] overflow-auto rounded-md border bg-muted/10 p-3 space-y-3"
          >
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <Sparkles className="h-6 w-6 text-primary" />
                <div>
                  Ask a question about your RFQs, quotes, vendors, or spend.
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex gap-2 ${
                    m.role === "user" ? "flex-row-reverse" : ""
                  }`}
                >
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    {m.role === "user" ? (
                      <UserIcon className="h-4 w-4" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                  </div>
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background border"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))
            )}
            {asking && (
              <div className="flex gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground">
                  Thinking…
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-700 whitespace-pre-wrap">
              {error}
            </div>
          )}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              askQuestion(input);
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about your RFQs, vendors, ports, spend…"
              disabled={asking}
            />
            <Button type="submit" disabled={!canAsk}>
              <Send className="h-4 w-4 mr-1" />
              Send
            </Button>
          </form>

          {messages.length > 0 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Answers are grounded on the dataset snapshot above.
              </span>
              <Button variant="ghost" size="sm" onClick={() => setMessages([])}>
                Clear chat
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

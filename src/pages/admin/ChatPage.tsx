import React from "react";
import { useData } from "@/contexts/DataContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

const defaultSuggestions = [
  "Show total spend trend in the last 60 days",
  "Which vendor has the highest allocation value this month?",
  "Which POL/POD combination has the highest cycle time?",
  "Why did spend increase vs previous 30 days?",
];

export default function ChatPage() {
  const { rfqs, quotes, allocations } = useData();
  const [prompt, setPrompt] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Hi! I can help analyze RFQs, quotes, and allocations. Ask a question in natural language.",
    },
  ]);

  const handleAsk = async (input?: string) => {
    const question = String(input ?? prompt).trim();
    if (!question || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setPrompt("");
    setLoading(true);

    try {
      const res = await fetch("/api/admin/analytics-chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          question,
          context: {
            rfqCount: rfqs.length,
            quoteCount: quotes.length,
            allocationCount: allocations.length,
          },
        }),
      });

      const data = await res.json().catch(() => ({}));
      const answer = String(data?.answer || "I couldn't generate an answer. Please refine your question.");
      setMessages((prev) => [...prev, { role: "assistant", text: answer }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "I hit a connection issue. Please retry in a few seconds.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Analytics Chat</h1>
          <p className="text-sm text-muted-foreground">
            Natural-language analytics assistant for CXO-style insights and drill-down prompts.
          </p>
        </div>
        <Badge variant="outline">Admin only</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Suggested questions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {defaultSuggestions.map((q) => (
            <Button key={q} variant="outline" size="sm" onClick={() => void handleAsk(q)}>
              {q}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conversation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-h-[420px] space-y-2 overflow-y-auto rounded-lg border bg-muted/20 p-3">
            {messages.map((m, idx) => (
              <div
                key={`${m.role}-${idx}`}
                className={`rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "ml-auto max-w-[85%] bg-primary text-primary-foreground"
                    : "max-w-[90%] bg-background"
                }`}
              >
                {m.text}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask about spend, cycle time, vendor performance, anomaly, forecast..."
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAsk();
              }}
            />
            <Button onClick={() => void handleAsk()} disabled={loading || !prompt.trim()}>
              {loading ? "Thinking..." : "Ask"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

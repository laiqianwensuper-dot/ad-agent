"use client";

import { useState } from "react";
import type { ReviewPresentation } from "@/lib/review-task-store";

type Message = { role: "user" | "assistant"; text: string };

const quickQuestions = [
  "为什么这句话风险高？",
  "保留原意帮我重写",
  "改得更有营销感一点",
  "如果我有证明材料，这一项还能通过吗？",
];

export function ReviewAssistantDrawer({ review, onClose }: { review: ReviewPresentation; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(rawQuestion: string) {
    const trimmed = rawQuestion.trim();
    if (!trimmed || isSending) return;
    setMessages((current) => [...current, { role: "user", text: trimmed }]);
    setQuestion("");
    setError(null);
    setIsSending(true);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, review, canonical: review.canonical }),
      });
      const data = await response.json();
      if (!response.ok || !data.answer) throw new Error(data.error?.message ?? "暂时无法回答");
      setMessages((current) => [...current, { role: "assistant", text: data.answer }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "暂时无法回答，请稍后重试。");
    } finally {
      setIsSending(false);
    }
  }

  return <div className="fixed inset-0 z-50 flex justify-end bg-[#12242c]/30" role="dialog" aria-modal="true" aria-label="询问审核助手">
    <section className="flex h-full w-full max-w-[480px] flex-col bg-white shadow-2xl">
      <header className="flex items-center justify-between border-b border-[#e5e9e7] px-5 py-4">
        <div><h2 className="font-semibold text-[#152d39]">询问审核助手</h2><p className="mt-1 text-xs text-[#66757a]">解释、改写或提示补充材料，不会改变本次审核结论。</p></div>
        <button type="button" aria-label="关闭" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-xl text-[#52636a] hover:bg-[#f2f5f3]">×</button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {messages.length === 0 && <><p className="text-sm leading-6 text-[#52636a]">针对当前审核任务继续追问。若你补充了证明材料，请在修改素材后重新发起审核。</p><div className="mt-5 grid gap-2">{quickQuestions.map((item) => <button key={item} type="button" onClick={() => ask(item)} className="rounded-lg border border-[#dce4e1] px-3 py-3 text-left text-sm text-[#24414c] hover:border-[#75a98f] hover:bg-[#f5faf7]">{item}</button>)}</div></>}
        <div className="mt-5 space-y-4">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === "user" ? "ml-8 rounded-lg bg-[#3370ff] px-4 py-3 text-sm leading-6 text-white" : "mr-4 rounded-lg bg-[#f2f3f5] px-4 py-3 text-sm leading-6 text-[#334950]"}>{message.text}</div>)}{isSending && <div className="mr-4 rounded-lg bg-[#f2f3f5] px-4 py-3 text-sm text-[#52636a]">正在整理建议…</div>}</div>
        {error && <p className="mt-4 rounded-lg bg-[#fff1ef] px-3 py-2 text-sm text-[#9e3029]">{error}</p>}
      </div>

      <form className="border-t border-[#e5e9e7] p-4" onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
        <label className="sr-only" htmlFor="assistant-question">输入问题</label>
        <textarea id="assistant-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1500} placeholder="例如：保留原意，帮我改得更有营销感一点" className="min-h-24 w-full resize-none rounded-lg border border-[#cfdad5] p-3 text-sm leading-6 outline-none focus:border-[#16825c] focus:ring-4 focus:ring-[#dcf2e6]" />
        <div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-[#748187]">不会直接改写本次审核结论</p><button type="submit" disabled={!question.trim() || isSending} className="rounded-md bg-[#3370ff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#245bdb] disabled:cursor-not-allowed disabled:bg-[#aab9bd]">发送</button></div>
      </form>
    </section>
  </div>;
}

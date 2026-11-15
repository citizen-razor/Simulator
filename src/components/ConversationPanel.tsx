/**
 * The conversation with the AI-played customer (shared/conversation.ts), beside the screens.
 * Typed for every channel for now; the channel sets the wording, icon and how the customer talks.
 */
import { useEffect, useRef, useState } from "react";
import { CHANNEL_INFO } from "../../shared/conversation";
import type { Channel, Transcript } from "../../shared/schema";

export function ConversationPanel({
  channel,
  customer,
  transcript,
  busy,
  customerLeft,
  wrapUp,
  failed,
  disabled,
  onSend,
  onRetry,
  onEnd,
}: {
  channel: Channel;
  customer: string;
  transcript: Transcript;
  busy: boolean;
  /** The customer ended the conversation (resolved, or gave up). */
  customerLeft: boolean;
  /** The system steps are done; the learner wraps up and ends the conversation. */
  wrapUp: boolean;
  /** The last reply didn't arrive. */
  failed: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onRetry: () => void;
  onEnd: () => void;
}) {
  const info = CHANNEL_INFO[channel];
  const [draft, setDraft] = useState("");
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [transcript.length, busy]);
  const send = () => {
    const text = draft.trim();
    if (!text || busy || disabled) return;
    onSend(text.slice(0, 2000));
    setDraft("");
  };
  const first = customer.split(" ")[0] || "The customer";

  return (
    <section className={`panel conversation channel-${channel}`} aria-label={`${info.verb} ${customer}`}>
      <div className="conv-head">
        <span className="conv-icon" aria-hidden>{info.icon}</span>
        <div>
          <b>{customer}</b>
          <div className="muted small">{info.label}{channel !== "chat" && " · type what you'd say"}</div>
        </div>
      </div>
      <div className="conv-log" ref={log} aria-live="polite">
        {transcript.map((m, i) => (
          <div key={i} className={`conv-msg ${m.from}`}>
            <span className="sr-only">{m.from === "learner" ? "You" : customer}: </span>
            {m.text}
          </div>
        ))}
        {busy && <div className="conv-typing muted small">{first} {info.typing}</div>}
        {failed && !busy && (
          <div className="conv-note small">
            {first} didn't answer. <button className="link-btn add" onClick={onRetry}>Try again</button>
          </div>
        )}
        {customerLeft && <div className="conv-note small">{channel === "phone" ? `${first} has hung up.` : channel === "chat" ? `${first} has left the chat.` : `${first} has left.`}</div>}
      </div>
      {wrapUp && !customerLeft && <p className="conv-note small">All steps done. Wrap up with {first}, then {info.end.toLowerCase()}.</p>}
      {!customerLeft && (
        <div className="conv-input">
          <textarea
            value={draft}
            rows={2}
            maxLength={2000}
            disabled={disabled}
            placeholder={channel === "chat" ? "Type a message…" : "Type what you say…"}
            aria-label={channel === "chat" ? "Message" : "What you say"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="btn sm primary" onClick={send} disabled={!draft.trim() || busy || disabled}>{channel === "chat" ? "Send" : "Say"}</button>
        </div>
      )}
      <div className="row">
        <button className={`btn sm ${wrapUp || customerLeft ? "primary" : "ghost"}`} onClick={onEnd} disabled={disabled}>{info.end}</button>
      </div>
    </section>
  );
}

/** A saved conversation, for Results and My progress. */
export function TranscriptView({ conversation }: { conversation: { channel: Channel; customer: string; messages: Transcript } }) {
  const info = CHANNEL_INFO[conversation.channel];
  return (
    <details className="transcript">
      <summary>{info.icon} Conversation with {conversation.customer} ({info.label.toLowerCase()}, {conversation.messages.length} messages)</summary>
      <div className={`conv-log channel-${conversation.channel}`}>
        {conversation.messages.map((m, i) => (
          <div key={i} className={`conv-msg ${m.from}`}>
            <span className="sr-only">{m.from === "learner" ? "Learner" : conversation.customer}: </span>
            {m.text}
          </div>
        ))}
        {!conversation.messages.length && <p className="muted small">Nothing was said.</p>}
      </div>
    </details>
  );
}

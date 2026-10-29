/**
 * Chat panel (SPEC §5.4/§7.6/§14) — PLACEHOLDER stub created by the app-shell
 * agent so Room wiring compiles; the parallel panels agent owns this file and
 * will replace the body. Props contract is FIXED: { onSend }.
 * Chat is rendered as plain text nodes, never HTML (§14); the util chat-text
 * helper is identity-by-design and applied at the render seam.
 */

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { useStore } from '../hooks';
import { chatTextContent, formatChatTime } from '../util';

export interface ChatPanelProps {
  onSend: (text: string) => void;
}

export function ChatPanel({ onSend }: ChatPanelProps) {
  const { chat } = useStore();
  const [text, setText] = useState('');
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  const send = (e: FormEvent): void => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  return (
    <div className="jm-chat">
      <p className="jm-chat__note">Chat is heard everywhere.</p>
      <ul className="jm-chat__list" ref={listRef} role="log" aria-live="polite">
        {chat.length === 0 && <li className="jm-chat__empty">No messages yet.</li>}
        {chat.map((m) => (
          <li className="jm-chat__msg" key={m.id}>
            <span className="jm-chat__meta">
              {m.name} · {formatChatTime(m.ts)}
            </span>
            <span className="jm-chat__text">{chatTextContent(m.text)}</span>
          </li>
        ))}
      </ul>
      <form className="jm-chat__form" onSubmit={send}>
        <label className="jm-visually-hidden" htmlFor="jm-chat-input">
          Chat message
        </label>
        <input
          id="jm-chat-input"
          className="jm-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message…"
          maxLength={2000}
        />
        <button className="jm-btn jm-btn--primary" type="submit" disabled={text.trim().length === 0}>
          Send
        </button>
      </form>
    </div>
  );
}

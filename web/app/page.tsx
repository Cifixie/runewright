"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import Terminal from "./terminal";

type WorkspaceTab = { id: number; title: string; sessionId: string };

export default function Home() {
  const [terminals, setTerminals] = useState<WorkspaceTab[]>([
    { id: 1, title: "Project", sessionId: "project" },
  ]);
  const [activeId, setActiveId] = useState(1);
  const [nextId, setNextId] = useState(2);
  const closeHandlers = useRef(new Map<number, () => void>());

  const registerClose = useCallback((id: number, handler: () => void) => {
    closeHandlers.current.set(id, handler);
    return () => { closeHandlers.current.delete(id); };
  }, []);

  function addTerminal() {
    const id = nextId;
    setNextId(id + 1);
    setTerminals((current) => [...current, { id, title: `Terminal ${id}`, sessionId: `terminal-${id}` }]);
    setActiveId(id);
  }

  function closeTerminal(id: number) {
    closeHandlers.current.get(id)?.();
    closeHandlers.current.delete(id);
    setTerminals((current) => {
      const index = current.findIndex((terminal) => terminal.id === id);
      if (index === -1) return current;
      const next = current.filter((terminal) => terminal.id !== id);
      setActiveId((active) => (active === id ? next[Math.min(index, next.length - 1)]?.id ?? 0 : active));
      return next;
    });
  }

  return (
    <main className="workspace-shell">
      <nav className="topbar" aria-label="Main navigation">
        <Link className="brand" href="/" aria-label="Runewright home">
          <span className="brand-mark" aria-hidden="true">r</span>
          <span>runewright</span>
        </Link>
        <div className="topbar-context">
          <span className="context-dot" aria-hidden="true" />
          <span>LOCAL WORKSPACE</span>
        </div>
        <a className="topbar-link" href="https://docs.anthropic.com/en/docs/claude-code" target="_blank" rel="noreferrer">
          Claude Code <span aria-hidden="true">↗</span>
        </a>
      </nav>

      <div className="workspace-content">
        <header className="workspace-heading">
          <div>
            <div className="eyebrow">DEVELOPMENT ENVIRONMENT <span>—</span> LOCAL</div>
            <h1>Your workspace,<br className="mobile-break" /> in motion.</h1>
            <p>A persistent shell for building things with Claude.</p>
          </div>
          <div className="heading-aside">
            <span className="aside-label">CURRENT DIRECTORY</span>
            <span className="directory-value"><span>~/</span>project</span>
          </div>
        </header>

        <div className="section-label">
          <span>01</span>
          <span className="section-rule" />
          <h2>Terminal sessions</h2>
          <span className="session-tag">PERSISTENT PTY</span>
        </div>

        <div className="terminal-workspace">
          <div className="terminal-tabs" role="tablist" aria-label="Terminal sessions">
            {terminals.map((terminal) => (
              <div className={`terminal-tab${terminal.id === activeId ? " terminal-tab-active" : ""}`} key={terminal.id}>
                <button
                  id={`terminal-tab-${terminal.id}`}
                  className="terminal-tab-select"
                  type="button"
                  role="tab"
                  aria-selected={terminal.id === activeId}
                  aria-controls={`terminal-panel-${terminal.id}`}
                  onClick={() => setActiveId(terminal.id)}
                >
                  <span className="terminal-tab-indicator" aria-hidden="true" />
                  <span>{terminal.title}</span>
                </button>
                {terminals.length > 1 && (
                  <button className="terminal-tab-close" type="button" aria-label={`Close ${terminal.title}`} onClick={() => closeTerminal(terminal.id)}>×</button>
                )}
              </div>
            ))}
            <button className="terminal-tab-add" type="button" onClick={addTerminal} aria-label="New terminal">+</button>
          </div>

          {terminals.map((terminal) => (
            <div
              className="terminal-panel"
              id={`terminal-panel-${terminal.id}`}
              key={terminal.id}
              role="tabpanel"
              aria-labelledby={`terminal-tab-${terminal.id}`}
              hidden={terminal.id !== activeId}
              tabIndex={-1}
            >
              <Terminal
                sessionId={terminal.sessionId}
                title={terminal.title}
                active={terminal.id === activeId}
                onClose={() => closeTerminal(terminal.id)}
                registerClose={(handler) => registerClose(terminal.id, handler)}
              />
            </div>
          ))}
        </div>

        <div className="workspace-footnote">
          <span>BUILT FOR THE LONG RUN</span>
          <span>Terminal sessions survive browser disconnects.</span>
        </div>
      </div>
    </main>
  );
}

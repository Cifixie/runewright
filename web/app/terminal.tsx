"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XtermTerminal } from "@xterm/xterm";

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

type ServerMessage =
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number; signal: number }
  | { type: "error"; message: string };

type TerminalProps = {
  sessionId: string;
  title: string;
  active: boolean;
  onClose: () => void;
  registerClose: (handler: () => void) => () => void;
};

const DEFAULT_SIDECAR_URL = "ws://127.0.0.1:4001/pty";

export default function Terminal({ sessionId, title, active, onClose, registerClose }: TerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminatingRef = useRef(false);
  const stateRef = useRef<ConnectionState>("disconnected");
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [message, setMessage] = useState(`Start the terminal to attach to ${title}.`);
  const [started, setStarted] = useState(false);

  const resetTerminal = useCallback((nextState: ConnectionState, nextMessage: string) => {
    const socket = socketRef.current;
    socketRef.current = null;
    socket?.close(1000, "Terminal reset");
    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitRef.current = null;
    stateRef.current = nextState;
    setState(nextState);
    setMessage(nextMessage);
    setStarted(false);
  }, []);

  const connect = useCallback(async () => {
    if (started || !hostRef.current) return;
    socketRef.current?.close(1000, "Replacing terminal connection");
    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitRef.current = null;
    stateRef.current = "connecting";
    setState("connecting");
    setStarted(true);

    try {
      const tokenResponse = await fetch("/api/pty-token", { cache: "no-store" });
      if (!tokenResponse.ok) throw new Error(tokenResponse.status === 503 ? "PTY sidecar is not running. Start it with pnpm dev." : "Token request failed.");
      const { token } = (await tokenResponse.json()) as { token: string };

      const [{ Terminal: TerminalClass }, { FitAddon: FitAddonClass }, { WebLinksAddon }, { Unicode11Addon }, { WebglAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
        import("@xterm/addon-unicode11"),
        import("@xterm/addon-webgl"),
      ]);

      const host = hostRef.current;
      if (!host) throw new Error("Terminal host is unavailable.");

      const terminal = new TerminalClass({
        allowProposedApi: true,
        cursorBlink: true,
        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
        fontSize: 14,
        lineHeight: 1.2,
        scrollback: 10000,
        theme: {
          background: "#0d0f12",
          foreground: "#e6e9ef",
          cursor: "#d3f36b",
          selectionBackground: "#38432e",
          black: "#17191e",
          red: "#f07178",
          green: "#c3e88d",
          yellow: "#ffcb6b",
          blue: "#82aaff",
          magenta: "#c792ea",
          cyan: "#89ddff",
          white: "#d0d4df",
          brightBlack: "#686f7d",
          brightRed: "#ff8b92",
          brightGreen: "#d7f7a0",
          brightYellow: "#ffdc8e",
          brightBlue: "#a5c0ff",
          brightMagenta: "#d9aaff",
          brightCyan: "#a0eaff",
          brightWhite: "#f4f5f8",
        },
      });
      const fit = new FitAddonClass();
      terminal.loadAddon(fit);
      terminal.loadAddon(new WebLinksAddon());
      const unicode = new Unicode11Addon();
      terminal.loadAddon(unicode);
      terminal.unicode.activeVersion = "11";
      terminal.open(host);

      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      try {
        terminal.loadAddon(webgl);
      } catch {
        webgl.dispose();
      }

      await document.fonts.ready;
      fit.fit();
      terminal.focus();
      terminalRef.current = terminal;
      fitRef.current = fit;

      const sidecarBase = process.env.NEXT_PUBLIC_PTY_WS_URL ?? DEFAULT_SIDECAR_URL;
      const sidecarUrl = new URL(sidecarBase);
      sidecarUrl.searchParams.set("session", sessionId);
      sidecarUrl.searchParams.set("token", token);
      const socket = new WebSocket(sidecarUrl);
      socketRef.current = socket;

      terminal.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
      });
      terminal.onResize(({ cols, rows }) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "resize", cols, rows }));
      });
      socket.addEventListener("open", () => {
        stateRef.current = "connected";
        setState("connected");
        setMessage(`Connected to ${title}.`);
        fit.fit();
        socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      });
      socket.addEventListener("message", (event) => {
        let incoming: ServerMessage;
        try {
          incoming = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          stateRef.current = "error";
          setState("error");
          setMessage("The PTY sidecar sent an invalid message.");
          return;
        }
        if (incoming.type === "output") terminal.write(incoming.data);
        if (incoming.type === "error") resetTerminal("error", incoming.message);
        if (incoming.type === "exit") resetTerminal("disconnected", `PTY exited with code ${incoming.exitCode} (signal ${incoming.signal}).`);
      });
      socket.addEventListener("error", () => resetTerminal("error", "Could not connect to the PTY sidecar at the configured WebSocket URL."));
      socket.addEventListener("close", (event) => {
        if (stateRef.current === "error") return;
        resetTerminal("disconnected", event.code === 1000 ? "PTY session ended." : "Connection closed. Reconnect to attach to the running PTY.");
      });
    } catch (error) {
      resetTerminal("error", error instanceof Error ? error.message : "Could not initialize the terminal.");
    }
  }, [resetTerminal, sessionId, started, title]);

  const disconnect = useCallback(() => {
    resetTerminal("disconnected", "Detached. The PTY keeps running; reconnect to reattach.");
  }, [resetTerminal]);

  const kill = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    terminatingRef.current = true;
    // Send the kill even while CONNECTING: the panel unmounts immediately after,
    // so waiting for a React state update would close the socket first and strand
    // the PTY. Queue the frame for the open event when still connecting.
    const sendKill = () => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "kill" }));
      else if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "kill" })), { once: true });
      }
    };
    sendKill();
    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitRef.current = null;
    stateRef.current = "disconnected";
    setState("disconnected");
    setMessage("Closing terminal…");
    const timer = setTimeout(() => { socket.close(1000, "Terminal closed"); resetTerminal("disconnected", "Close requested."); }, 3000);
    socket.addEventListener("message", function onExit(event) {
      let incoming: ServerMessage;
      try {
        incoming = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (incoming.type !== "exit" && incoming.type !== "error") return;
      clearTimeout(timer);
      socket.removeEventListener("message", onExit);
      resetTerminal("disconnected", "Terminal closed.");
    });
  }, [resetTerminal]);

  const close = useCallback(() => {
    if (started) kill();
    onClose();
  }, [kill, onClose, started]);

  // The tab's × unmounts this panel, so it must terminate the PTY first.
  // Register terminate (not close) to avoid re-entering the parent's close path.
  const terminate = useCallback(() => {
    if (started) kill();
  }, [kill, started]);

  useEffect(() => registerClose(terminate), [registerClose, terminate]);

  useEffect(() => {
    if (!started || !active) return;
    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit();
      terminalRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, started]);

  useEffect(() => {
    if (!started || !active) return;
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => fitRef.current?.fit());
    observer.observe(host);
    return () => observer.disconnect();
  }, [active, started]);

  useEffect(() => () => {
    const socket = socketRef.current;
    socketRef.current = null;
    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitRef.current = null;
    if (!socket) return;
    // A terminating socket is closed by kill() once the sidecar confirms exit;
    // closing it here first would strand a CONNECTING session's queued kill.
    if (!terminatingRef.current) socket.close(1000, "Page unmounted");
  }, []);

  return (
    <section className="terminal-card" aria-label={`${title} terminal`}>
      <header className="terminal-toolbar">
        <div className="terminal-identity">
          <div className="terminal-mark" aria-hidden="true">&gt;_</div>
          <div>
            <div className="terminal-title">{title} shell</div>
            <div className="terminal-subtitle">{sessionId} · Local PTY sidecar</div>
          </div>
        </div>
        <div className="terminal-actions">
          <span className={`connection-state state-${state}`}>
            <span className="state-dot" aria-hidden="true" />
            {state === "connected" ? "Connected" : state === "connecting" ? "Connecting" : state === "error" ? "Attention" : "Offline"}
          </span>
          {!started ? (
            <button className="terminal-button primary-button" type="button" onClick={connect} disabled={state === "connecting"}>
              {state === "connecting" ? "Connecting…" : "Connect terminal"}
            </button>
          ) : (
            <>
              <button className="terminal-button" type="button" onClick={disconnect}>Detach</button>
              <button className="terminal-button danger-button" type="button" onClick={kill}>Kill session</button>
            </>
          )}
        </div>
      </header>
      <div className="terminal-screen-wrap">
        {!started && (
          <div className="terminal-placeholder">
            <div className="placeholder-glyph" aria-hidden="true">⌘</div>
            <strong>Ready when you are</strong>
            <span>Connect to open this shell. The terminal session stays alive when you detach.</span>
          </div>
        )}
        <div className={`terminal-screen${started ? " terminal-screen-active" : ""}`} ref={hostRef} />
      </div>
      <footer className="terminal-footer">
        <span className="terminal-message" role="status" aria-live="polite">{message}</span>
        <span className="terminal-hint">Enter sends input <span>·</span> Resize adapts automatically</span>
        <button className="terminal-button danger-button" type="button" onClick={close}>Close terminal</button>
      </footer>
    </section>
  );
}

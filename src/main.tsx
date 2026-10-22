import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";

// Surface UI errors in the terminal running Quazar (there is no visible devtools console).
const log = (level: string, parts: unknown[]) =>
  void invoke("js_log", { level, message: parts.map((p) => (p instanceof Error ? p.stack ?? p.message : typeof p === "string" ? p : JSON.stringify(p))).join(" ") }).catch(() => {});
window.addEventListener("error", (e) => log("error", [e.error ?? e.message]));
window.addEventListener("unhandledrejection", (e) => log("error", ["unhandled rejection:", e.reason]));
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  consoleError(...args);
  log("error", args);
};
(window as unknown as { qlog: typeof log }).qlog = log;

// No StrictMode: its double-mounted effects would register backend listeners twice.
if (import.meta.hot) import.meta.hot.on("vite:beforeUpdate", () => location.reload());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);

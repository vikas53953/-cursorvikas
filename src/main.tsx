import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installWebBridge } from "./lib/webBridge";
import "./styles.css";

installWebBridge();

if (typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent)) {
  document.documentElement.dataset.shell = "electron";
  if (/Macintosh|Mac OS X/i.test(navigator.userAgent)) document.documentElement.dataset.platform = "darwin";
  else if (/Windows/i.test(navigator.userAgent)) document.documentElement.dataset.platform = "win32";
  else document.documentElement.dataset.platform = "linux";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

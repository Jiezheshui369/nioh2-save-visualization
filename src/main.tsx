import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { isNativeApp } from "./runtime";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (!isNativeApp() && "serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}

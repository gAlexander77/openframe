import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Global tokens and base styles first, so component stylesheets (imported by
// the components below) win ties in the cascade.
import "./styles/app.css";
import App from "./App";
import "./automation";
import { installTooltips } from "./components/tooltip";

installTooltips();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

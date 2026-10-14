import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Global tokens and base styles first, so component stylesheets (imported by
// the components below) win ties in the cascade.
import "./styles/app.css";
import App from "./App";
import "./automation";
import { restoreAgents } from "./components/AgentsSection";
import { installTooltips } from "./components/tooltip";

installTooltips();
void restoreAgents();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

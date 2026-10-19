import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Global tokens and base styles first, so component stylesheets (imported by
// the components below) win ties in the cascade.
import "./styles/app.css";
import App from "./App";
import "./automation";
import { restoreAgents } from "./components/AgentsSection";
import { installTooltips } from "./components/tooltip";
import { runHeadlessIfAsked } from "./state/headless";
import { loadSavedFonts } from "./state/fonts";

installTooltips();
void restoreAgents();
// A headless render draws titles in imported fonts too.
void loadSavedFonts().finally(() => runHeadlessIfAsked());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

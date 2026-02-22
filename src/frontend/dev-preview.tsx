/**
 * Dev Preview Entry Point
 *
 * Renders the Settings page without MentraOS auth so it can be
 * previewed in a desktop browser at /dev.
 * Only served in development mode (NODE_ENV=development).
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";

import Settings from "./pages/Settings";

function DevPreview() {
  return <Settings isDarkMode={false} />;
}

const elem = document.getElementById("root")!;

const app = (
  <StrictMode>
    <DevPreview />
  </StrictMode>
);

if (import.meta.hot) {
  const root = (import.meta.hot.data.root ??= createRoot(elem));
  root.render(app);
} else {
  createRoot(elem).render(app);
}

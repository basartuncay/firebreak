import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// The access token is now in an HttpOnly cookie; keep it out of the address bar and history.
if (new URLSearchParams(location.search).has("token")) history.replaceState(null, "", location.pathname);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

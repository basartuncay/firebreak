import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { adoptTokenFromUrl } from "./api";
import "./styles.css";

adoptTokenFromUrl();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

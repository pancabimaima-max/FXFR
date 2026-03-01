import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import "./styles/app.css";
import "flag-icons/css/flag-icons.min.css";
import { applyThemeTokens } from "./styles/themeTokens";

applyThemeTokens("amd");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

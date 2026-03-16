import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./ui/tokens.css";
import "./ui/primitives.css";
import "./ui/radix.css";
import "./legacy/controller.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <App />,
);

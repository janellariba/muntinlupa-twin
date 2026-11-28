// Entry point: mounts the app and loads the Tailwind stylesheet.
//   /        -> the public twin (read only)
//   /admin   -> the admin console (password, then camera config, detection, recording)
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { AdminGate } from "./components/AdminPanels.jsx";
import "./index.css";

const isAdmin = /^\/admin(\/|$)/.test(window.location.pathname);
if (isAdmin) document.title = "Admin · Muntinlupa Twin";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {isAdmin ? <AdminGate>{(logout) => <App admin onLogout={logout} />}</AdminGate> : <App />}
  </StrictMode>
);

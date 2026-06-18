import { useState, useEffect } from "react";
import "./App.css";
import { AppShell } from "./components/layout";
import i18next, { initI18n } from "./i18n";

function App() {
  const [ready, setReady] = useState(() => i18next.isInitialized);

  useEffect(() => {
    if (i18next.isInitialized) return;
    initI18n().then(
      () => setReady(true),
      (err) => { console.error("i18n init failed:", err); setReady(true); },
    );
  }, []);

  if (!ready) return null;
  return <AppShell />;
}

export default App;

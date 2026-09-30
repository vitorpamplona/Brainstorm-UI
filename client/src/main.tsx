import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

async function bootstrap() {
  if (import.meta.env.DEV) {
    const { installDevSigner } = await import("./services/devSigner");
    installDevSigner();
  }
  createRoot(document.getElementById("root")!).render(<App />);
}

bootstrap();

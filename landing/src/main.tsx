import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const element = document.getElementById("root")!;
const app = <App privacy={window.location.pathname.startsWith("/privacy")} />;
if (element.childElementCount) hydrateRoot(element, app);
else createRoot(element).render(app);

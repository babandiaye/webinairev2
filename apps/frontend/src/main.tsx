import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { ThemeProvider } from "./theme/ThemeProvider";
// Polices empaquetées par Vite plutôt que chargées depuis fonts.googleapis.com :
// un réseau universitaire qui filtre les CDN externes ferait retomber toute
// l'interface sur la police système, et le rendu changerait selon le poste.
// Archivo : axe de chasse (wdth) utilisé pour les titres condensés, qui reprend
// le lettrage du logo UNCHK. Public Sans : dessinée pour les services publics,
// avec de vrais chiffres tabulaires pour les données.
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/public-sans";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);

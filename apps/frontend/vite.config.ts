import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // pnpm workspace résout @webinairev2/shared-types (symlink) vers son vrai
  // chemin sous packages/, hors de node_modules — par défaut, le plugin
  // commonjs de Rollup ne traite (détection des exports nommés) que les
  // fichiers sous node_modules/, donc le build échoue avec "X is not exported
  // by .../shared-types/dist/index.js" dès qu'on importe autre chose qu'un
  // type (ex. RECORDING_CONTROL_TOPIC). On élargit explicitement le filtre au
  // lieu de resolve.preserveSymlinks (testé, casse la résolution des
  // dépendances transitives de pnpm — react-router introuvable depuis
  // react-router-dom — car pnpm dépend lui-même des symlinks pour son layout).
  build: {
    commonjsOptions: {
      include: [/node_modules/, /packages\/shared-types/],
    },
  },
});

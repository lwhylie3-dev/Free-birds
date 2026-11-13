import { defineConfig } from "vite";

// Relative asset paths: the .ehpk is served from the Even App's WebView, not a site root.
export default defineConfig({ base: "./" });

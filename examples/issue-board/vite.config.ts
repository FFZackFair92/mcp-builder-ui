import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// vite-plugin-singlefile inlines every asset into one HTML file.
// Without it the view 404s inside the sandboxed iframe, which has no origin.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
    rollupOptions: { input: "mcp-app.html" },
  },
});

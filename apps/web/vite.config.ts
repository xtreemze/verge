import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  base: process.env.BASE_PATH ?? "/",
  server: {
    host: "0.0.0.0",
    port: 5173
  },
  build: {
    target: "chrome140"
  }
});

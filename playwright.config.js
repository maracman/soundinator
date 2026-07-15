import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:8765", headless: true },
  webServer: {
    command: "PYTHONPATH=src .venv/bin/python -m synthesiser.web.server",
    url: "http://127.0.0.1:8765",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});

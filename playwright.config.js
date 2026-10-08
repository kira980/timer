import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test",
  testMatch: /.*\.e2e\.js/,
  use: { baseURL: "http://localhost:47321" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  webServer: {
    command: "python3 -m http.server 47321 --bind 127.0.0.1",
    url: "http://localhost:47321",
    reuseExistingServer: false,
  },
});

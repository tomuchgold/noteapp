import { chromium } from "/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright/index.mjs";
const b = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 })).newPage();
await p.goto("http://localhost:8123/", { waitUntil: "networkidle" });
await p.screenshot({ path: "docs/site-home.png", fullPage: false });
await p.screenshot({ path: "/tmp/site-full.png", fullPage: true });
await b.close(); process.exit(0);

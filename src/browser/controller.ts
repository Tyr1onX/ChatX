import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { getStateDir } from "../config/paths.js";

const MAX_TEXT = 64 * 1024;
const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

function executablePath(): string {
  const found = CHROME_PATHS.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("No supported Chrome or Edge installation was found.");
  return found;
}

export class BrowserController {
  private context: BrowserContext | null = null;
  private headless = true;

  private async page(): Promise<Page> {
    await this.start(this.headless);
    const context = this.context;
    if (!context) throw new Error("Browser context failed to start.");
    const pages = context.pages();
    return pages[0] ?? context.newPage();
  }

  async start(headless = true): Promise<{ running: boolean; headless: boolean }> {
    if (this.context) {
      try {
        if (this.context.browser()?.isConnected()) {
          this.headless = headless;
          return { running: true, headless: this.headless };
        }
      } catch {
        await this.close();
      }
    }
    const profile = path.join(getStateDir(), "browser-profile");
    this.context = await chromium.launchPersistentContext(profile, {
      executablePath: executablePath(),
      headless,
      args: ["--disable-extensions"],
      viewport: { width: 1440, height: 900 },
    });
    this.headless = headless;
    return { running: true, headless };
  }

  status(): { running: boolean; headless: boolean; pages: number } {
    try {
      return {
        running: Boolean(this.context?.browser()?.isConnected()),
        headless: this.headless,
        pages: this.context?.pages().length ?? 0,
      };
    } catch {
      return { running: false, headless: this.headless, pages: 0 };
    }
  }

  async navigate(url: string): Promise<{ url: string; title: string }> {
    const page = await this.page();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return { url: page.url(), title: await page.title() };
  }

  async snapshot(): Promise<{ url: string; title: string; text: string }> {
    const page = await this.page();
    return { url: page.url(), title: await page.title(), text: (await page.locator("body").innerText()).slice(0, MAX_TEXT) };
  }

  async click(selector: string): Promise<{ url: string; text: string }> {
    const page = await this.page();
    await page.locator(selector).first().click({ timeout: 15_000 });
    await page.waitForTimeout(250);
    return { url: page.url(), text: (await page.locator("body").innerText()).slice(0, MAX_TEXT) };
  }

  async type(selector: string, text: string, pressEnter: boolean): Promise<{ url: string }> {
    const page = await this.page();
    await page.locator(selector).first().fill(text, { timeout: 15_000 });
    if (pressEnter) await page.locator(selector).first().press("Enter");
    return { url: page.url() };
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    this.context = null;
  }
}

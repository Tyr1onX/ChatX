import { describe, expect, it } from "vitest";
import { browserExecutableCandidates } from "../src/browser/executable.js";

describe("browser executable discovery", () => {
  it("includes standard macOS application paths", () => {
    const candidates = browserExecutableCandidates("darwin", { HOME: "/Users/tester" });

    expect(candidates).toContain("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    expect(candidates).toContain("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
    expect(candidates).toContain("/Applications/Chromium.app/Contents/MacOS/Chromium");
    expect(candidates).toContain("/Users/tester/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  });

  it("keeps the browser override first", () => {
    const candidates = browserExecutableCandidates("darwin", {
      HOME: "/Users/tester",
      CHATX_BROWSER_BIN: "/opt/custom/chrome",
    });

    expect(candidates[0]).toBe("/opt/custom/chrome");
  });

  it("keeps Windows Chrome and Edge discovery", () => {
    const candidates = browserExecutableCandidates("win32", {
      HOME: "C:\\Users\\tester",
      PROGRAMFILES: "C:\\Program Files",
      "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
      LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
    });

    expect(candidates).toContain("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
    expect(candidates).toContain("C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe");
  });

  it("includes common Linux browser paths", () => {
    const candidates = browserExecutableCandidates("linux", { HOME: "/home/tester" });

    expect(candidates).toContain("/usr/bin/google-chrome");
    expect(candidates).toContain("/usr/bin/chromium");
  });
});

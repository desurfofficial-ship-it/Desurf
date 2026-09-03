import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
function early(args: string[]): Promise<number|null> {
  return new Promise((resolve) => {
    const c = spawn("npx", ["tsx", "src/cli.ts", ...args], { cwd: process.cwd(), env: process.env, stdio: ["ignore","pipe","pipe"] });
    c.stdout?.on("data", () => { c.stdout?.destroy(); c.stderr?.destroy(); });
    const t = setTimeout(() => { try { c.stdout?.destroy(); c.stderr?.destroy(); } catch {} }, 700);
    c.on("close", (code) => { clearTimeout(t); resolve(code); });
  });
}
function normal(args: string[]): Promise<number|null> {
  return new Promise((resolve) => {
    const c = spawn("npx", ["tsx", "src/cli.ts", ...args], { cwd: process.cwd(), env: process.env });
    c.on("close", (code) => resolve(code));
  });
}
describe("EPIPE exit preservation (P0)", { timeout: 25000 }, () => {
  it("PASS normal 0", async () => { expect(await normal(["test","--suite","fixtures/basic"])).toBe(0); });
  it("ERROR normal 2", async () => { expect(await normal(["test","--suite","/no/such"])).toBe(2); });
  it("ERROR+EPIPE not 0", async () => { const c = await early(["test","--suite","/no/such"]); expect(c).not.toBe(0); if (c!==null) expect(c).toBe(2); });
  it("PASS+EPIPE non-error", async () => { expect([0,null]).toContain(await early(["test","--suite","fixtures/basic"])); });
});

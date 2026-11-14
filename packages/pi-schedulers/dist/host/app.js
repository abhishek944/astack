/**
 * The only question this package ever asks the Herdr app: is a window there?
 *
 * It never starts one. `herdr-app status` talks to the running window and
 * fails when there is none, which is exactly the condition under which the
 * scheduler must not dispatch.
 */
import { spawn } from "node:child_process";
export function appReachable(timeoutMs = 10_000) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled)
                return;
            settled = true;
            resolve(value);
        };
        const child = spawn("herdr-app", ["status"], { stdio: "ignore" });
        const timer = setTimeout(() => {
            child.kill();
            finish(false);
        }, timeoutMs);
        child.on("error", () => {
            clearTimeout(timer);
            finish(false);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            finish(code === 0);
        });
    });
}

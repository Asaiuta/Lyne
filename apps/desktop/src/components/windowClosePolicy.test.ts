import assert from "node:assert/strict";
import test from "node:test";
import {
  requestWindowClose,
  resolveWindowCloseAction,
  shouldPromptForWindowClose
} from "./windowClosePolicy";

test("close policy prompts only while the close tip setting is enabled", () => {
  assert.equal(shouldPromptForWindowClose({ showCloseAppTip: true }), true);
  assert.equal(shouldPromptForWindowClose({ showCloseAppTip: false }), false);
});

test("close action comes from settings after the prompt has been disabled", () => {
  assert.equal(
    resolveWindowCloseAction({ closeAppMethod: "exit", showCloseAppTip: false }, null),
    "exit"
  );
  assert.equal(
    resolveWindowCloseAction({ closeAppMethod: "hide", showCloseAppTip: true }, null),
    null
  );
});

test("requestWindowClose persists remembered prompt decisions before applying the action", async () => {
  const calls: string[] = [];
  const applied = await requestWindowClose(
    { closeAppMethod: "hide", showCloseAppTip: true },
    {
      promptForCloseChoice: async () => ({ action: "exit", remember: true }),
      persistCloseChoice: (decision) => {
        calls.push(`persist:${decision.action}:${decision.remember}`);
        return true;
      },
      hideApp: async () => {
        calls.push("hide");
      },
      exitApp: async () => {
        calls.push("exit");
      }
    }
  );

  assert.equal(applied, true);
  assert.deepEqual(calls, ["persist:exit:true", "exit"]);
});

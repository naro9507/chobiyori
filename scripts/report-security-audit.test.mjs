import assert from "node:assert/strict";
import test from "node:test";
import { endMarker, marker, reportSecurityAudit } from "./report-security-audit.mjs";

const env = {
  GH_TOKEN: "test-token",
  GITHUB_REPOSITORY: "owner/repo",
  GITHUB_RUN_ID: "123",
  GITHUB_RUN_ATTEMPT: "2",
  AUDIT_ASSIGNEE: "owner",
  AUDIT_NPM_RESULT: "failure",
  AUDIT_RUST_RESULT: "success",
};

function mockApi(responses) {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, ...options, body: options.body && JSON.parse(options.body) });
    assert.ok(responses.length, "Unexpected API request");
    return { ok: true, json: async () => responses.shift() };
  };
  return { calls, request };
}

test("失敗時は担当者とログを含む Issue を作る", async () => {
  const { calls, request } = mockApi([[], { number: 1 }]);
  await reportSecurityAudit(env, request);
  assert.equal(calls[1].method, "POST");
  assert.deepEqual(calls[1].body.assignees, ["owner"]);
  assert.ok(calls[1].body.body.includes(marker));
  assert.match(calls[1].body.body, /npm: failure/);
  assert.match(calls[1].body.body, /Rust: success/);
  assert.match(calls[1].body.body, /actions\/runs\/123\/attempts\/2/);
});

test("PR のマーカーは無視し、2ページ目の既存 Issue を更新する", async () => {
  const firstPage = Array.from({ length: 100 }, (_, i) => ({
    number: i + 1,
    body: i === 0 ? marker : "unrelated",
    ...(i === 0 ? { pull_request: {} } : {}),
  }));
  const { calls, request } = mockApi([
    firstPage,
    [{ number: 101, body: `対応期限: 来週\n${marker}\nold\n${endMarker}\n調査中` }],
    { number: 101 },
  ]);
  await reportSecurityAudit(env, request);
  assert.match(calls[1].url, /page=2$/);
  assert.equal(calls[2].method, "PATCH");
  assert.match(calls[2].url, /\/issues\/101$/);
  assert.deepEqual(Object.keys(calls[2].body), ["body"]);
  assert.ok(calls[2].body.body.startsWith("対応期限: 来週\n"));
  assert.ok(calls[2].body.body.endsWith("\n調査中"));
  assert.ok(!calls[2].body.body.includes("\nold\n"));
  assert.equal(calls.length, 3);
});

test("npm が成功しても Rust の失敗を通知する", async () => {
  const { calls, request } = mockApi([[], {}]);
  await reportSecurityAudit(
    { ...env, AUDIT_NPM_RESULT: "success", AUDIT_RUST_RESULT: "failure" },
    request,
  );
  assert.match(calls[1].body.body, /Rust: failure/);
});

test("成功時は API を呼ばず、既存 Issue も閉じない", async () => {
  const { calls, request } = mockApi([]);
  await reportSecurityAudit(
    { ...env, AUDIT_NPM_RESULT: "success" },
    request,
  );
  assert.equal(calls.length, 0);
});

test("権限不足や通信エラーは通知処理の失敗として残す", async () => {
  await assert.rejects(
    reportSecurityAudit(env, async () => ({ ok: false, status: 403 })),
    /HTTP 403/,
  );
  await assert.rejects(
    reportSecurityAudit(env, async () => { throw new Error("network error"); }),
    /network error/,
  );
});

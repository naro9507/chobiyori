import { pathToFileURL } from "node:url";

export const marker = "<!-- dcs-security-audit -->";
export const endMarker = "<!-- /dcs-security-audit -->";

export async function reportSecurityAudit(env = process.env, request = fetch) {
  const {
    GH_TOKEN: token,
    GITHUB_REPOSITORY: repository,
    GITHUB_RUN_ID: runId,
    GITHUB_RUN_ATTEMPT: attempt = "1",
    GITHUB_SERVER_URL: server = "https://github.com",
    GITHUB_API_URL: apiUrl = "https://api.github.com",
    AUDIT_ASSIGNEE: assignee,
    AUDIT_NPM_RESULT: npm,
    AUDIT_RUST_RESULT: rust,
  } = env;
  if (![npm, rust].includes("failure")) return;
  if (!token || !repository || !runId || !assignee) {
    throw new Error("Issue の作成に必要な環境変数がありません");
  }

  async function api(path, method = "GET", body) {
    const response = await request(`${apiUrl}/repos/${repository}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${method} ${path}: HTTP ${response.status}`);
    }
    return response.json();
  }

  // Search API のインデックス遅延を避け、全ページの未解決 Issue を直接確認する。
  let existing;
  for (let page = 1; ; page++) {
    const issues = await api(`/issues?state=open&per_page=100&page=${page}`);
    existing = issues.find(
      (issue) => !issue.pull_request && issue.body?.includes(marker),
    );
    if (existing || issues.length < 100) break;
  }

  const body = [
    marker,
    "依存の定期監査に失敗しました。脆弱性の検出か、通信・セットアップなどの実行エラーかをログで確認してください。",
    "",
    `- npm: ${npm}`,
    `- Rust: ${rust}`,
    `- [実行ログ](${server}/${repository}/actions/runs/${runId}/attempts/${attempt})`,
    "",
    "影響と対応期限を確認し、必要な更新や対策を行ってください。対応後は監査を再実行して確認し、この Issue を閉じてください。",
    endMarker,
  ].join("\n");

  if (existing) {
    // 自動更新する範囲の外に書かれた対応メモを保持する。
    const start = existing.body.indexOf(marker);
    const end = existing.body.indexOf(endMarker, start);
    const updated = end < 0
      ? `${body}\n\n${existing.body}`
      : existing.body.slice(0, start) + body + existing.body.slice(end + endMarker.length);
    await api(`/issues/${existing.number}`, "PATCH", { body: updated });
  } else {
    await api("/issues", "POST", {
      title: "依存の定期監査に失敗しています",
      body,
      assignees: [assignee],
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await reportSecurityAudit();
}

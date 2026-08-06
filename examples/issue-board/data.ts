/** In-memory issue store, so the example runs with no external service. */

export interface Issue {
  id: number;
  title: string;
  priority: "P0" | "P1" | "P2";
  status: "open" | "closed";
  assignee: string | null;
  ageDays: number;
}

const issues: Issue[] = [
  { id: 221, title: "Auth timeout on SSO refresh", priority: "P0", status: "open", assignee: "mara", ageDays: 21 },
  { id: 245, title: "Payment retry loops on 402", priority: "P0", status: "open", assignee: "tom", ageDays: 17 },
  { id: 260, title: "CSV export truncates at 10k rows", priority: "P0", status: "open", assignee: "mara", ageDays: 15 },
  { id: 271, title: "Webhook signature mismatch", priority: "P0", status: "open", assignee: "iris", ageDays: 4 },
  { id: 288, title: "Dark mode contrast on tables", priority: "P2", status: "open", assignee: null, ageDays: 9 },
  { id: 290, title: "Slow query on /reports", priority: "P1", status: "open", assignee: "tom", ageDays: 6 },
  { id: 301, title: "Stale cache after plan change", priority: "P1", status: "open", assignee: null, ageDays: 3 },
  { id: 305, title: "Typo in onboarding email", priority: "P2", status: "open", assignee: "iris", ageDays: 1 },
];

export function listIssues(status: "open" | "closed" | "all" = "open"): Issue[] {
  return status === "all" ? issues : issues.filter((i) => i.status === status);
}

export function closeIssue(id: number): Issue | undefined {
  const issue = issues.find((i) => i.id === id);
  if (issue) issue.status = "closed";
  return issue;
}

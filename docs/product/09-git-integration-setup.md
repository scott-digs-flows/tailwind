# Tailwind — Git Integration Setup (Q-06)

**Status:** Runbook · Audience: Product (setup), Systems Architect (design), Full-Stack (build)
**Decision (Q-06):** Yes — the app brokers pull requests on the author's behalf. Business users
never need a git account.

This is what you'll need to set up, and what to hand the engineers. Written for **GitHub**; GitLab
differences in §8. If the org standard is something else, tell me before ADR-010.

---

## 1. Use a GitHub App, not a personal access token

Three ways to do this. Only one is right.

| Approach | Verdict |
|---|---|
| **GitHub App** | ✅ **Use this.** Scoped permissions, short-lived tokens (1 h), built-in webhooks, its own bot identity, higher rate limits, no license seat, revocable independently of any person. |
| Machine user + fine-grained PAT | ⚠️ Fallback only. Consumes a seat, long-lived credential, broader blast radius, and — critically — **a user account can approve pull requests**, which breaks the review guarantee. |
| Deploy keys | ❌ Git access only. Cannot open PRs or read review state. |

## 2. What you need to do

Requires **org owner** access. Roughly 30 minutes.

1. **Create a private repository** for analytics artifacts (semantic models, metrics, dashboards,
   tests). Repo layout comes from ADR-004.
2. **Create the App**: Org Settings → Developer settings → GitHub Apps → *New GitHub App*.
   - Name: e.g. `tailwind-proposals` (this becomes the bot identity, so pick carefully — it appears
     on every commit).
   - Webhook URL: an HTTPS endpoint on the app. For local dev, a tunnel works.
   - Generate a **webhook secret** — a long random string.
3. **Grant repository permissions** — exactly these, no more:

   | Permission | Level | Why |
   |---|---|---|
   | Contents | Read & write | Create branches and commits |
   | Pull requests | Read & write | Open PRs, read and post comments |
   | Metadata | Read | Mandatory for all apps |
   | Checks | Read | Show CI status in-app |
   | Commit statuses | Read | Same |
   | *Organization → Members* | Read | Only if resolving CODEOWNERS teams in-app |

4. **Subscribe to events:** `pull_request`, `pull_request_review`, `pull_request_review_comment`,
   `issue_comment`, `push`, `check_suite` (or `workflow_run`).
5. **Install on that one repository** — not org-wide.
6. **Generate a private key** (`.pem`). This is the credential. Straight into the secret store,
   never into the repo, an image, or an env var in plaintext.
7. **Record** for the engineers: App ID, Installation ID, private key (secret ref), webhook secret
   (secret ref).
8. **Configure branch protection** on `main` — see §4. This is the part that makes the whole
   governance model real, so don't skip it.

## 3. How the app authenticates

For the engineers:

```
private key ──sign RS256──▶ JWT (≤10 min, iss = App ID)
                              │
                              ▼
                    POST /app/installations/{id}/access_tokens
                              │
                              ▼
                installation access token (1 hour, scoped to the install)
```

Mint per operation and hold in memory. **Never persist an installation token** — the whole point of
the App model is that the long-lived secret is the private key, held once, in the secret store.

**Rate limits:** 5,000 requests/hour per installation, scaling upward with org size. Ample for a
POC, but batch writes and respect secondary rate limits — bursts of individual file commits will
trip them.

## 4. Branch protection — the guardrail that matters

Without this, the app is a way to bypass review rather than enforce it.

Require on `main`:
- ✅ Pull request before merging
- ✅ At least 1 approval
- ✅ **Review from Code Owners**
- ✅ Status checks to pass (the CI evidence pipeline: validate, compile, assert, render, metric diff)
- ✅ Dismiss stale approvals when new commits are pushed *(covers edge case 2 in `07-domain-model.md §3` — approval must not outlive a passing build)*

**The structural guarantee:** `CODEOWNERS` accepts users and teams, **not apps**. So requiring code
owner review means a human or team must approve — the bot cannot approve its own proposals, no
matter what permissions it holds. That's a property of the platform, not of our code, which is
exactly where you want a guarantee like this to live.

Belt and braces: don't grant the App any permission it doesn't need, and audit its permission set
whenever ADR-010 changes.

## 5. Commit attribution

Business users have no git account, but authorship must still be truthful and auditable
(FR-GOV-11). Git already models this correctly — **author and committer are separate fields.**

- **Author** = the human. `Morgan Lee <morgan@company.com>`
- **Committer** = the bot. `tailwind-proposals[bot]`
- **Trailers** on every commit:

```
Add regional pipeline dashboard

Proposed-by: Morgan Lee <morgan@company.com>
Tailwind-Draft: drf_01HX8ZK3M4
Tailwind-Authoring: ai-assisted
```

The PR body links back to the draft and states how it was produced. `Tailwind-Authoring` is worth
capturing from day one — it's the field that measures the hypothesis (AI-assisted vs. hand-written
merge rates), and it's painful to backfill.

**Note:** commits created through the API are signed by GitHub, so this coexists with a
require-signed-commits rule if you have one.

## 6. Making a multi-file change atomically

A proposal usually touches several files (a dashboard spec plus a new metric). Don't use the
simple Contents API per file — that's one commit each and a noisy, unreviewable history.

Use the Git Data API: **create blobs → build a tree → create a commit → update the ref.** One
commit, one reviewable diff. This matters more than it sounds, because the readability of that
diff is what makes Sam's review fast.

## 7. Who merges?

**POC:** the human reviewer merges in GitHub. Simplest, and it keeps the decision visibly with the
person accountable for it.

**Later:** the app can auto-merge once checks pass and CODEOWNERS approves — worth it only if
reviewer latency (Q-13) proves to be the bottleneck.

Either way, **publish is driven by the merge webhook, not by the in-app button** — the app is not
the only actor in the repo (`07-domain-model.md §3`, edge case 4).

## 8. If it's GitLab

Same architecture, different primitives:
- **Group or project access token** with `api` scope, on a bot user GitLab provisions automatically
  (no license seat).
- Merge requests instead of pull requests; webhooks instead of App events.
- `CODEOWNERS` exists but code-owner approval enforcement is a paid tier — **verify your plan
  includes it**, because it's the guarantee in §4. If it doesn't, we need a different enforcement
  mechanism and ADR-010 changes materially.

## 9. What I still need from you

- **Which git host**, and confirmation you have org-owner rights to create the App.
- **A public HTTPS endpoint** for webhooks once the app is deployed (a tunnel is fine for dev).
- **Who is in the CODEOWNERS team** for semantic models versus dashboards (FR-GOV-07). This is the
  review routing, and it's a people decision, not a technical one.

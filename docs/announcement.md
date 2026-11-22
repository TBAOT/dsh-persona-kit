# dsh-persona-kit：给 DSH 的角色记忆 + 技能

> 这段文字用于在 `deepseek-ai/deepseek-harness` 的 **Show Your Plugins!** 分类下发帖。
> 发帖入口：https://github.com/deepseek-ai/deepseek-harness/discussions/new?category=show-your-plugins

---

Hi — I built a memory + skills plugin for DSH and would like to share it.

**What it does**

- One independent memory per persona: two resident tiers (your profile + the persona's notes)
  plus a topic library that is read only when relevant. Each persona can also own its own
  `SKILL.md` skills, invisible to other personas.
- A per-turn review writes memory automatically — no "remember this" prompt needed. When a tier
  passes 90%, a background pass rewrites it (one fact per entry, ≤120 characters) and moves the
  prose into topics.
- Recall is injected as **runtime context**, so topic pointers never appear inside your own
  message and never enter the session log.
- **Read-only tiers** via `memory/policy.json`: the agent can be locked out of your profile while
  the panel keeps editing it.
- Deleting a persona moves its memory into `~/.dsh/trash/` with an index snapshot, and the panel
  can restore it — bindings included.

**Install** (DSH `>=0.2.2-rc.1`)

```sh
dsh plugin --profile <profile> add github:TBAOT/dsh-persona-kit
# then add dsh-persona-kit to dsh.profile.bundles and restart the Harness
```

**Honest limitations**

- Retrieval is keyword-based (CJK bigrams + IDF), not embeddings. I tried a local character
  n-gram "semantic" scorer and measured it *worse* than keywords (64% vs 86% hit rate on my
  14-question suite, and it mis-recalled the negative cases), so the default stays keyword.
- Resident memory is frozen at session start, so writes land in the next session.
- The panel UI is Chinese-first (English README provided).

Repo: https://github.com/TBAOT/dsh-persona-kit
Release: https://github.com/TBAOT/dsh-persona-kit/releases
Docs: https://github.com/TBAOT/dsh-persona-kit/blob/main/docs/guide.md

Feedback and breakage reports are welcome — especially after a DSH upgrade.

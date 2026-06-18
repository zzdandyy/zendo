#!/usr/bin/env bash
# sync-upstream.sh — 跟踪上游 anySCP 的变更，找出对自己有用的 commit
#
# 用法：
#   ./scripts/sync-upstream.sh        # 查看上游新增了什么
#   ./scripts/sync-upstream.sh --mark # 查看并更新标记（表示已审查过）
#   ./scripts/sync-upstream.sh --diff # 查看上游新增的完整 diff
#
# 工作原理：
#   1. 从 GitHub 拉取 upstream/main
#   2. 对比上次记录的 commit（存在 .git/upstream-last-seen）
#   3. 如果从未标记过，从 merge-base 开始算
#   4. 列出新增的 commit，方便判断哪些值得合并

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MARKER_FILE="$REPO_ROOT/.git/upstream-last-seen"
UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="upstream/main"
UPSTREAM_URL="https://github.com/macnev2013/anySCP.git"

# ── 确保 upstream remote 存在 ──────────────────────────────────────────────
ensure_upstream() {
  if ! git remote get-url "$UPSTREAM_REMOTE" &>/dev/null; then
    echo "→ 添加 upstream remote: $UPSTREAM_URL"
    git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
  fi
  echo "→ 拉取 upstream 最新..."
  git fetch "$UPSTREAM_REMOTE" --quiet || {
    echo "⚠️  fetch 失败，将使用本地缓存（数据可能不是最新）"
  }
}

# ── 确定起始 commit ────────────────────────────────────────────────────────
resolve_base() {
  if [ -f "$MARKER_FILE" ]; then
    cat "$MARKER_FILE"
  else
    git merge-base main "$UPSTREAM_BRANCH"
  fi
}

# ── 列出新增 commits ───────────────────────────────────────────────────────
list_new_commits() {
  local base="$1"
  local count
  count=$(git rev-list --count "$base..$UPSTREAM_BRANCH" 2>/dev/null || echo "0")

  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  上游 anySCP 新增了 $count 个 commit"
  echo "  基准: $(git log --oneline -1 "$base")"
  echo "  上游 HEAD: $(git log --oneline -1 "$UPSTREAM_BRANCH")"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""

  if [ "$count" -eq 0 ]; then
    echo "✓ 没有新 commit，已是最新。"
    return
  fi

  echo "Commits（正序，旧→新）："
  echo "───"
  git log --oneline --reverse "$base..$UPSTREAM_BRANCH"
  echo "───"
  echo ""

  echo "涉及的文件："
  git diff --stat "$base..$UPSTREAM_BRANCH" | tail -1
  echo ""

  echo "── 下一步 ──"
  echo "  查看完整 diff:     ./scripts/sync-upstream.sh --diff"
  echo "  只看某个文件:       git diff $base..$UPSTREAM_BRANCH -- path/to/file"
  echo "  查看某个 commit:    git show <commit-hash>"
  echo "  合并单个 commit:    git cherry-pick <commit-hash>"
  echo "  合并全部:           git merge $UPSTREAM_BRANCH"
  echo "  标记为已审查:       ./scripts/sync-upstream.sh --mark"
}

# ── 更新标记 ───────────────────────────────────────────────────────────────
mark_seen() {
  local new_marker
  new_marker=$(git rev-parse "$UPSTREAM_BRANCH")
  echo "$new_marker" > "$MARKER_FILE"
  echo "✓ 已标记: $(git log --oneline -1 "$new_marker")"
  echo "  标记文件: $MARKER_FILE"
}

# ── 显示完整 diff ──────────────────────────────────────────────────────────
show_diff() {
  local base
  base=$(resolve_base)
  echo "Diff: $base..$UPSTREAM_BRANCH"
  echo ""
  git diff "$base..$UPSTREAM_BRANCH"
}

# ── Main ────────────────────────────────────────────────────────────────────
cd "$REPO_ROOT"

case "${1:-}" in
  --diff)
    ensure_upstream
    show_diff
    ;;
  --mark)
    ensure_upstream
    base=$(resolve_base)
    list_new_commits "$base"
    echo ""
    mark_seen
    ;;
  --help|-h)
    echo "用法: ./scripts/sync-upstream.sh [--diff|--mark]"
    echo ""
    echo "  (无参数)  查看上游新增的 commit"
    echo "  --diff    查看上游新增的完整 diff"
    echo "  --mark    查看并标记为已审查（更新 .git/upstream-last-seen）"
    echo "  --help    显示此帮助"
    ;;
  *)
    ensure_upstream
    base=$(resolve_base)
    list_new_commits "$base"
    ;;
esac

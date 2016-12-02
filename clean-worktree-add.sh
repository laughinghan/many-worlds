set -e # exit if anything fails
cd /tmp/mathquill

git rev-parse --verify "$branchname" >/dev/null 2>&1 || {
  if git rev-parse --verify "origin/$branchname" >/dev/null 2>&1; then
    git branch --track "$branchname" "origin/$branchname"
  else
    echo "No such branch: $branchname"
    exit 1
  fi
}

# gotta clear out any pre-existing worktree because
# who knows if it succeeded
rm -rf "$worktree_path"
git worktree prune

git worktree add "$worktree_path" "$branchname"
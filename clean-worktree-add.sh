set -e # exit if anything fails
cd /tmp/mathquill.git

git rev-parse --verify "$branchname" >/dev/null 2>&1 || {
  echo "No such branch: $branchname"
  exit 1
}

# gotta clear out any pre-existing worktree because
# who knows if it succeeded
rm -rf "$worktree_path"
git worktree prune

git worktree add "$worktree_path" "$branchname"
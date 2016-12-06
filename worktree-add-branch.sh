set -e # exit if anything fails
cd /tmp/repo.git

git fetch mathquill || true # don't exit on transient network failure
git rev-parse --verify "refs/heads/mathquill/$branchname" >/dev/null 2>&1 || {
  echo "No such branch: $branchname"
  exit 1
}

# gotta clear out any pre-existing worktree because
# who knows if it succeeded
rm -rf "$worktree_path"
git worktree prune

git worktree add "$worktree_path" "refs/heads/mathquill/$branchname"

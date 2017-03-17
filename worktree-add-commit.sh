set -e # exit if anything fails
cd /tmp/repo.git

# gotta clear out any pre-existing worktree because
# who knows if it succeeded
rm -rf "$worktree_path"
git worktree prune

git worktree add "$worktree_path" "$commit"

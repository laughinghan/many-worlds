# gotta clear out any pre-existing worktree because
# who knows if it succeeded
rm -rf $worktree_path
cd /tmp/mathquill.git
git worktree prune

git worktree add $worktree_path $branchname
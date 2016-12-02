test -d /tmp/mathquill && exit

cd /tmp
git clone --no-checkout https://github.com/mathquill/mathquill.git

# even though `git clone --no-checkout` doesn't check out the
# master branch, .git/HEAD is still set to 'ref: refs/heads/master'.
# As far as I can tell, the only thing this is a problem for is doing
# `git worktree add <path> master` (which complains:
#   fatal: 'master' is already checked out at '<path>/mathquill'
#   Exit Status 128
# ), but that's exactly what we want to do, so that's bad.
# We could just do `git checkout --detach`, but we don't actually
# want to check out the files into the working directory (we don't
# even want a working directory in the first place, we basically
# want --bare but with remote tracking branches).
# Next thing we might try is `git rev-parse HEAD > HEAD`, except
# the HEAD file is opened for writing which empties it which
# causes `git rev-parse` to complain. Hence the command
# substitution.
cd mathquill/.git
echo $(git rev-parse HEAD) > HEAD

# also initialize directory structure:
mkdir -p /tmp/public/{branch,pull,commit}

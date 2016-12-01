test -d /tmp/mathquill.git && exit

cd /tmp
git clone --bare https://github.com/mathquill/mathquill.git

# git clone --bare has a bug where, even though it doesn't check
# out the master branch (obviously, because there's no working
# directory to put the checked out files), .git/HEAD is still
# set to 'ref: refs/heads/master'. As far as I can tell, the
# only thing this is a problem for is doing
# `git worktree add <path> master` (which complains:
#   fatal: 'master' is already checked out at '<path>/mathquill.git'
#   Exit Status 128
# ), but that's exactly what we want to do, so that's bad.
# Now, if this weren't a bare repo we could just do
# `git checkout --detach`, but again there's no working
# directory, so no cigar.
# Next thing we might try is `git rev-parse HEAD > HEAD`, except
# the HEAD file is opened for writing which empties it which
# causes `git rev-parse` to complain. Hence the command
# substitution.
cd mathquill.git
echo $(git rev-parse HEAD) > HEAD

# also initialize directory structure
cd ..
mkdir branch pull commit
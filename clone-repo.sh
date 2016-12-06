set -e # exit if anything fails
test -d /tmp/repo.git && exit

owner=mathquill
full_name=mathquill/mathquill

# Unfortunately there aren't really `git clone` options for something like
# "mirror but under a namespace", which is understandable, this is a pretty
# funky use of git, whereas normal mirrors ('refs/*:refs/*') are probably
# pretty common. So we use git plumbing commands to init the bare repo and
# set up the remotes and stuff before fetching, essentially manually
# cloning the repo.
git init --bare /tmp/repo.git
cd /tmp/repo.git
git config remote."$owner".url https://github.com/"$full_name".git
git config --add remote."$owner".fetch '+refs/heads/*:refs/heads/'"$owner"'/*'
git config --add remote."$owner".fetch '+refs/tags/*:refs/tags/'"$owner"'/*'
git config --add remote."$owner".fetch '+refs/pull/*/head:refs/pull/'"$owner"'/*'
git fetch "$owner"

# also initialize directory structure:
mkdir -p /tmp/worktrees/"$full_name"/{branch,pull,commit}

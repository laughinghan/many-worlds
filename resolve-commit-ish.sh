set -e # exit if anything fails
cd /tmp/repo.git

# if a short SHA is both a branch name and a commit hash, we want
# to go with the hash, whereas rev-parse goes with the branchname.
# Also, rev-parse doesn't have a specific error code meant for
# porcelain to indicate ambiguous short SHAs.
# For these two reasons we first do rev-parse --disambiguate

git fetch mathquill 1>&2 || true # don't exit on transient network failure
commits="$(git rev-parse --disambiguate="$commitish")"
if test "$commits"; then
  git rev-parse --verify "$commits" >/dev/null || {
    # the output of rev-parse --disambiguate is always zero or more
    # commit hashes, so the only way this fails is if >1 commits
    printf "300\nCommit SHA hash abbreviation %s is ambiguous, %s\n%s\n" \
      "$commitish" "choose one:" "$commits"
    exit
  }
  full_hash=$commits
else
  # might be a non-SHA commit-ish (branch/tag/etc), some of which are namespaced
  full_hash="$(git rev-parse --verify "$commitish^{commit}" \
            || git rev-parse --verify "mathquill/$commitish^{commit}")" || {
    if echo "$commitish" | grep '^[0-9a-f]\{1,3\}$'; then
      printf "400\nCommit SHA hash abbreviation must be %s%s\n" \
        ">=4 hex digits, $commitish is only ${#commitish} " \
        "digit$(test ${#commit} = 0 || echo s)"
    else
      printf "404\nNo such commit: %s\n" "$commitish"
    fi
    exit
  }
fi
echo $full_hash

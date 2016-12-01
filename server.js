const http = require('http');
const url = require('url');
const fs = require('fs');
const child_process = require('child_process');

const builds = {};

http.createServer((req, res) => {
  const reqTime = new Date();
  res.on('finish', () => console.log('[%s] %s %s %s - %sms', reqTime.toISOString(), res.statusCode, req.method, req.url, Date.now() - reqTime));

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  if (/^\/branch\//.test(pathname)) {
    const [, branchname] = /^\/branch\/([^\/]*)/.exec(pathname)
      .map(decodeURIComponent);
    if (builds[branchname] instanceof Array) {
      // some request is already checking out or pulling this
      // branch, so just queue up this request
      builds[branchname].push({req, res});
      return;
    }
    if (builds[branchname] === 'built') {
      // it's already been built, so serve the files
      serveStatic(req, res);
      return;
    }

    const worktree_path = '/tmp/branch/' + branchname;
    // we do `mkdir` instead of the equivalent of `test -d`
    // to check whether the directory is there, because we
    // want to avoid the race condition where two requests
    // both check whether the directory is there, see it
    // isn't, then both do `git worktree add` and one fails
    // rather than queueing up waiting for the other.
    // We could also just jump straight to `git worktree add`,
    // but then we'd have to parse the error message to see
    // if it's because someone already did it or if it's
    // some other error, and there's no --porcelain option
    // for `git worktree add` (only for `list`) so it'd be
    // brittle, whereas EEXIST is POSIX standard
    fs.mkdir(worktree_path, e => {
      if (e && e.code === 'EEXIST') {
        builds[branchname] = 'built';
        serveStatic(req, res);
        return;
      }
      if (e) throw e;

      // first request for this branch, so queue up requests for
      // it while we check it out and build it
      builds[branchname] = [{req, res}];
      const git_worktree = child_process.spawn('git',
        ['worktree', 'add', worktree_path, branchname],
        { cwd: '/tmp/mathquill.git' });
      git_worktree.stdout.pipe(process.stdout, { end: false });
      git_worktree.stderr.pipe(process.stderr, { end: false });
      git_worktree.on('exit', (code) => {
        if (code === 0) {
          const make_test = child_process.exec('make test',
            { cwd: worktree_path });
          make_test.stdout.pipe(process.stdout, { end: false });
          make_test.stderr.pipe(process.stderr, { end: false });
          make_test.on('exit', (code) => {
            if (code === 0) {
              // boom, done! Clear out queued requests
              builds[branchname].forEach(
                ({req, res}) => serveStatic(req, res));
              builds[branchname] = 'built';
            } else throw new Error(code);
          });
        } else throw new Error(code);
      });
    });
  } else {
    res.statusCode = 404;
    res.end(`404 Not Found: ${req.url}`);
  }
})
.listen(process.env.PORT);

function serveStatic (req, res) {
  const ext = req.url.match(/\.[^.]+$/);
  if (ext) res.setHeader('Content-Type', 'text/' + ext[0].slice(1));
  fs.createReadStream('/tmp'+req.url).pipe(res);
}
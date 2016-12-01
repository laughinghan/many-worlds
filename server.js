const http = require('http');
const url = require('url');
const fs = require('fs');
const child_process = require('child_process');

const serveStatic = require('ecstatic')({
  root: '/tmp/public',
  showDotfiles: false,
  cache: false,
  serverHeader: 'many-worlds/'+require('./package.json').version
});

const builds = {};

http.createServer((req, res) => {
  const reqTime = new Date();
  res.on('finish', () => console.log('[%s] %s %s %s - %sms', reqTime.toISOString(), res.statusCode, req.method, req.url, Date.now() - reqTime));

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  if (/^\/branch(\/|$)/.test(pathname)) {
    const [, branchname] =
      pathname.match(/^\/branch\/?([^\/]*)/)
      .map(decodeURIComponent);
    if (branchname === '') {
      return res.end('You must provide a branch name to use /branch, for example, /branch/master');
    }
    if (builds[branchname] instanceof Array) {
      // some request is already checking out or pulling this
      // branch, so just queue up this request
      return builds[branchname].push({req, res});
    }
    if (builds[branchname] === 'built') {
      // it's already been built, so serve the files
      return serveStatic(req, res);
    }
    const broadcastErr = writeTo => {
      // some kind of error happened; tell everyone who
      // requested this branch and set up so that anyone
      // can refresh to try again
      if (!(builds[branchname] instanceof Array)) return;
      builds[branchname].forEach(({res}) => writeTo(res));
      builds[branchname] = undefined; // try again next request
    };

    const worktree_path = '/tmp/public/branch/' + branchname;
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
        if (builds[branchname] instanceof Array) {
          // race condition: two of requests both found
          // builds[branchname] undefined, both check for
          // existence of the folder; if both see the folder
          // there, then nobody sets builds[branchname] to
          // an Array and we can't be here. So this case can
          // only happen if one of those saw no pre-existing
          // folder and created it and proceeded with
          // checking out and building the branch, while the
          // other saw the newly created folder; its request
          // should get queued up
          return builds[branchname].push({req, res});
        }
        // the normal case when the folder already exists:
        // server was restarted, so `builds` was stale
        builds[branchname] = 'built';
        return serveStatic(req, res);
      }
      if (e) {
        res.end(e);
        return broadcastErr(res => res.end(e));
      }

      // first request for this branch, so queue up requests for
      // it while we check it out and build it
      builds[branchname] = [{req, res}];
      spawnCapturingError(
        'git', ['worktree', 'add', worktree_path, branchname],
        { cwd: '/tmp/mathquill.git' },
        (e) => {
          if (e) return broadcastErr(e.writeTo);
          spawnCapturingError(
            'make', ['test'], { cwd: worktree_path },
            (e) => {
              if (e) return broadcastErr(e.writeTo);
    
              // boom, done! Serve all queued requests
              builds[branchname].forEach(
                ({req, res}) => serveStatic(req, res));
              builds[branchname] = 'built';
            });
        });
    });
    return;
  }
  if (pathname !== '/') {
    res.statusCode = 404;
    res.write(`Sorry, ${req.url.split('/', 2).join('/')} is not supported.\n`);
  }
  res.end('Try /branch/master, or /pull/123, or /commit/da39a3e instead.\n');
})
.listen(process.env.PORT);

function spawnCapturingError (cmd, args, opts, next) {
  const child = child_process.spawn(cmd, args, opts);
  child.on('exit', (exitCode) => {
    // calling .pipe() twice only `tee`s if done synchronously
    function logTo (stdout, stderr) {
      const shellArgs =
        args.map(arg => /^\w+$/.test(arg) ? arg : `'${arg}'`);
      stdout.write(`${cmd} ${shellArgs.join(' ')}\n`);
      child.stdout.pipe(stdout, { end: false });
      child.stderr.pipe(stderr, { end: false });
      if (exitCode) stdout.write(`Exit Code ${code}\n`);
    }
    logTo(process.stdout, process.stderr);
    if (exitCode) next({writeTo: strm => logTo(strm, strm)});
    else next();
  });
}
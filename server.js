const http = require('http');
const url = require('url');
const fs = require('fs');
const child_process = require('child_process');

const serveStatic = require('ecstatic')({
  root: '/tmp/public',
  showDotfiles: false,
  cache: false,
  headers: {
    Server: 'many-worlds/'+require('./package.json').version,
    'X-Powered-By': 'ecstatic on Express'
  }
});

const builds = {};

http.createServer((req, res) => {
  const reqTime = new Date();
  const pad4 = n => '    '.slice(String(n).length) + n
  res.on('finish', () => console.log('[%s]%sms:  %s %s %s', reqTime.toISOString(), pad4(Date.now() - reqTime), res.statusCode, req.method, req.url));

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  if (/^\/branch(\/|$)/.test(pathname)) {
    const [, encodedBranchname] = pathname.match(/^\/branch\/?([^\/]*)/);
    const branchname = decodeURIComponent(encodedBranchname);
    if (branchname === '') {
      return res.end('You must provide a branch name in order to use /branch, for example, /branch/master');
    }
    if (builds[branchname] instanceof Array) {
      // some request is already checking out or pulling this
      // branch, so just queue up this request
      return builds[branchname].push({req, res});
    }
    if (builds[branchname] instanceof Date
        && new Date() - builds[branchname] < 5000) {
      // just built <5s ago, so just serve the files
      return serveStatic(req, res);
    }

    const worktree_path =
      '/tmp/public/branch/' + encodedBranchname;
    const broadcastErr = msg => {
      // some kind of error happened; tell everyone who
      // requested this branch, then forget so that if anyone
      // refreshes we'll try again
      if (!builds[branchname]) return;
      builds[branchname].forEach(({res}) => res.end(msg));
      delete builds[branchname];
    };
    if (builds[branchname] instanceof Date) {
      // it's been previously built, git pull and rebuild
      builds[branchname] = [{req, res}];
      return execLogged('git fetch && git reset --hard @{u}',
        { cwd: worktree_path },
        e => {
          if (e) return broadcastErr(e);
          builds[branchname].forEach(
            ({req, res}) => serveStatic(req, res));
          builds[branchname] = new Date();
        });
    }

    // this branch hasn't been built, so queue up requests for
    // it while we check it out and build it
    builds[branchname] = [{req, res}];
    return execLogged('sh clean-worktree-add.sh',
      { env: { worktree_path, branchname } },
      e => {
        if (e) return broadcastErr(e);
        execLogged('make test', { cwd: worktree_path },
          e => {
            if (e) return broadcastErr(e);
  
            // boom, done! Serve all queued requests
            builds[branchname].forEach(
              ({req, res}) => serveStatic(req, res));
            builds[branchname] = new Date();
          });
      });
  }
  if (pathname !== '/') {
    res.statusCode = 404;
    res.write(`Sorry, ${req.url.split('/', 2).join('/')} is not supported.\n`);
  }
  res.end('Try /branch/master, or /pull/123, or /commit/da39a3e instead.\n');
})
.listen(process.env.PORT);

function execLogged (cmd, opts, cb) {
  // like exec, but prints command and args and exit code
  // if non-zero, and passes them to callback
  child_process.exec(cmd, opts, (e, stdout, stderr) => {
    const exitStatus = (e ? `Exit Code ${e.code}\n` : '');

    const output = cmd + '\n'
      + (stdout + stderr).replace(/^(?=.)/mg, '    ')
      + exitStatus;
    process.stdout.write(output);
    cb(e && output);
  });
}

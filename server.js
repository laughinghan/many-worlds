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
function broadcastErr(buildname, msg) {
  // some kind of error happened; tell everyone who
  // requested this build, then forget so that if anyone
  // refreshes we'll try again
  if (!builds[buildname]) return;
  builds[buildname].forEach(({res}) => {
    res.statusCode = 500;
    res.end(msg);
  });
  delete builds[buildname];
}

http.createServer((req, res) => {
  function send(status, msg) {
    res.statusCode = status;
    res.end(msg);
  }
  const reqTime = new Date();
  const pad4 = n => '    '.slice(String(n).length) + n;
  res.on('finish', () => console.log('[%s]%sms:  %s %s %s', reqTime.toISOString(), pad4(Date.now() - reqTime), res.statusCode, req.method, req.url));

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  if (/^\/commit(\/|$)/.test(pathname)) {
    const [, commit] = pathname.match(/^\/commit\/?([^\/]*)/);
    if (commit === '') return send(400, 'You must provide a commit SHA hash in order to use /commit/, for example, /commit/da39a3e or /commit/da39a3ee5e6b4b0d3255bfef95601890afd80709\n');
    if (!/^[0-9a-f]{1,40}$/i.test(commit)) return send(400, `Invalid commit SHA hash: ${commit}\n`);
    if (commit.length < 4) return send(400, `Commit SHA hash abbreviation must be >=4 hex digits, ${commit} is only ${commit.length} digit${commit.length > 1 ? 's' : ''}\n`);
    if (builds[commit] instanceof Array) {
      // some request is already building this commit,
      // so just queue up this request
      return builds[commit].push({req, res});
    }
    if (builds[commit] === 'built') return serveStatic(req, res);
    const worktree_path = '/tmp/public/commit/' + commit;
    return child_process.exec(
      'git fetch 1>&2; git rev-parse --disambiguate=' + commit,
      { cwd: '/tmp/mathquill' },
      (e, stdout, stderr) => {
        console.error(stderr);
        if (e) return console.log(e), send(500, e);
        const [full_hash, more] = stdout.trim().split('\n');
        if (full_hash === '') return send(404, `No such commit: ${commit}\n`);
        if (more) return send(300, `Commit SHA hash abbreviation ${commit} is ambiguous, choose one:\n${stdout}`);
        if (full_hash !== commit) {
          // permanent redirect to full hash
          res.writeHead(301, { Location: req.url.replace(commit, full_hash) });
          return res.end('See ' + req.url.replace(commit, full_hash));
        }
        
        if (builds[commit] instanceof Array) {
          // some request is already building this commit,
          // so just queue up this request
          return builds[commit].push({req, res});
        }
        if (builds[commit] === 'built') return serveStatic(req, res);
        
        builds[commit] = [{req, res}];
        execLogged('sh worktree-add-commit.sh',
          { env: { worktree_path, commit } },
          e => {
            if (e) return broadcastErr(commit, e);
            execLogged('make test', { cwd: worktree_path },
              e => {
                if (e) return broadcastErr(commit, e);
      
                // boom, done! Serve all queued requests
                builds[commit].forEach(
                  ({req, res}) => serveStatic(req, res));
                builds[commit] = 'built';
              });
          });
      });
  }
  if (/^\/branch(\/|$)/.test(pathname)) {
    const [, encodedBranchname] = pathname.match(/^\/branch\/?([^\/]*)/);
    const branchname = decodeURIComponent(encodedBranchname);
    if (branchname === '') send(400, 'You must provide a branch name in order to use /branch/, for example, /branch/master\n');
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
    if (builds[branchname] instanceof Date) {
      // it's been previously built, git pull and rebuild
      builds[branchname] = [{req, res}];
      return execLogged('git fetch && git reset --hard @{u}',
        { cwd: worktree_path },
        e => {
          // ignore error, likely transient network failure
          builds[branchname].forEach(
            ({req, res}) => serveStatic(req, res));
          builds[branchname] = new Date();
        });
    }

    // this branch hasn't been built, so queue up requests for
    // it while we check it out and build it
    builds[branchname] = [{req, res}];
    return execLogged('sh worktree-add-branch.sh',
      { env: { worktree_path, branchname } },
      e => {
        if (e) return broadcastErr(branchname, e);
        execLogged('make test', { cwd: worktree_path },
          e => {
            if (e) return broadcastErr(branchname, e);
  
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

function execLogged(cmd, opts, cb) {
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

const http = require('http');
const url = require('url');
const fs = require('fs');
const child_process = require('child_process');

const ecstatic = require('ecstatic');
  // ecstatic was chosen because of its directory listing feature
  // and it was easy to use as non-middleware
function serveStatic(req, res) {
  const baseDir = req.url.split('/', 5).join('/');
  const root = '/tmp/worktrees' + baseDir;
  ecstatic(root, {
    baseDir: decodeURIComponent(baseDir),
    showDotfiles: false,
    cache: false,
    headers: {
      Server: 'many-worlds/'+require('./package.json').version,
      'X-Powered-By': 'ecstatic on Express'
    }
  })(req, res);
}

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
  res.on('finish', () => console.log('[%s]%sms:  %s %s %s',
    reqTime.toISOString(), pad4(Date.now() - reqTime),
    res.statusCode, req.method, req.url));

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  if (/^\/mathquill\/mathquill\/commit(\/|$)/.test(pathname)) {
    const [, encodedCommit] = // this regex is just /*/*/commit/*
      pathname.match(/^\/[^\/]+\/[^\/]+\/commit\/?([^\/]*)/);
    const commit = decodeURIComponent(encodedCommit);
    if (commit === '') return send(400, 'You must provide a commit-ish '
      + 'in order to use .../commit/, for example, .../commit/da39a3e '
      + 'or .../commit/da39a3ee5e6b4b0d3255bfef95601890afd80709\n');
    // only full-length hashes are used as keys in `builds` cache,
    // which we can determine before shelling out to `git rev-parse`
    if (builds[commit] === 'built') return serveStatic(req, res);
    if (builds[commit] instanceof Array) {
      // some request is already building this commit,
      // so just queue up this request
      return builds[commit].push({req, res});
    }

    return child_process.exec('sh resolve-commit-ish.sh',
      { env: { commitish: commit } },
      (e, stdout, stderr) => {
        if (e) {
          console.log(stdout + stderr + e);
          return send(500, stdout + stderr + e + '\n');
        }
        else console.error(stderr);
        
        const lines = stdout.trim().split('\n');
        if (lines.length > 1) {
          const [statusCode, ...msgs] = lines;
          return send(+statusCode, msgs.join('\n') + '\n');
        }
        const [full_hash] = lines;
        if (full_hash !== commit) {
          // permanent redirect to full hash
          const newUrl = req.url.replace(encodedCommit, full_hash);
          res.writeHead(301, { Location: newUrl });
          return res.end(`See ${newUrl}\n`);
        }

        const worktree_path =
          '/tmp/worktrees/mathquill/mathquill/commit/' + commit;
        // queue up requests while we build this commit
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
  if (/^\/mathquill\/mathquill\/branch(\/|$)/.test(pathname)) {
    const [, encodedBranchname] = // this regex is just /*/*/branch/*
      pathname.match(/^\/[^\/]+\/[^\/]+\/branch\/?([^\/]*)/);
    const branchname = decodeURIComponent(encodedBranchname);
    if (branchname === '') return send(400, 'You must provide a branch '
      + 'name in order to use .../branch/, for example, '
      + '.../branch/master\n');
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

    const worktree_path = '/tmp/worktrees/mathquill/mathquill/'
      + 'branch/' + encodedBranchname;
    if (builds[branchname] instanceof Date) {
      // it's been previously built, git pull and rebuild
      builds[branchname] = [{req, res}];
      return execLogged(
        'git fetch mathquill --update-head-ok && git reset --hard',
        { cwd: worktree_path },
        e => {
          // ignore error, likely transient network failure
          execLogged('make test', { cwd: worktree_path },
            e => {
              if (e) return broadcastErr(branchname, e);

              builds[branchname].forEach(
                ({req, res}) => serveStatic(req, res));
              builds[branchname] = new Date();
            });
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
  if (/^\/mathquill\/mathquill\/pull(\/|$)/.test(pathname)) {
    const [, encodedPR] = // this regex is just /*/*/pull/*
      pathname.match(/^\/[^\/]+\/[^\/]+\/pull\/?([^\/]*)/);
    const pr = decodeURIComponent(encodedPR);
    const buildname = 'PR: #' + pr;

    if (pr === '') return send(400, 'You must provide a Pull '
      + 'Request number in order to use .../pull/, for example, '
      + '.../pull/123\n');
    if (builds[buildname] instanceof Array) {
      // some request is already checking out or pulling this
      // PR, so just queue up this request
      return builds[buildname].push({req, res});
    }
    if (builds[buildname] instanceof Date
        && new Date() - builds[buildname] < 5000) {
      // just built <5s ago, so just serve the files
      return serveStatic(req, res);
    }

    const worktree_path =
      '/tmp/worktrees/mathquill/mathquill/pull/' + pr;
    if (builds[buildname] instanceof Date) {
      // it's been previously built, git pull and rebuild
      builds[buildname] = [{req, res}];
      return execLogged(
        'git fetch mathquill && git reset --hard',
        { cwd: worktree_path },
        e => {
          // ignore error, likely transient network failure
          execLogged('make test', { cwd: worktree_path },
            e => {
              if (e) return broadcastErr(buildname, e);

              builds[buildname].forEach(
                ({req, res}) => serveStatic(req, res));
              builds[buildname] = new Date();
            });
        });
    }

    // this PR hasn't been built, so queue up requests for it
    // while we check it out and build it
    builds[buildname] = [{req, res}];
    return execLogged('sh worktree-add-pull.sh',
      { env: { worktree_path, pr } },
      e => {
        if (e) return broadcastErr(buildname, e);
        execLogged('make test', { cwd: worktree_path },
          e => {
            if (e) return broadcastErr(buildname, e);
  
            // boom, done! Serve all queued requests
            builds[buildname].forEach(
              ({req, res}) => serveStatic(req, res));
            builds[buildname] = new Date();
          });
      });
  }
  if (pathname !== '/') {
    res.statusCode = 404;
    res.write(`Sorry, ${req.url.split('/', 4).join('/')} `
      + 'is not supported.\n');
  }
  res.end('Try /mathquill/mathquill/branch/master, or '
    + '/mathquill/mathquill/pull/123, or '
    + '/mathquill/mathquill/commit/da39a3e instead.\n');
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

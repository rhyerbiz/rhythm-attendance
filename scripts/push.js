// Push apps-script/ to the dev or prod Apps Script project, and optionally
// redeploy its web app at the same URL. Settings live in deploy/<env>.json.
//
//   node scripts/push.js dev            push to your test copy
//   node scripts/push.js dev --deploy   …and make the web app use it
//   node scripts/push.js prod --deploy  the studio's copy (needs a clean, committed tree)
//
// Needs clasp 3 (npm install -g @google/clasp), signed in once per account:
//   clasp login --user dev      (your Google account)
//   clasp login --user studio   (the studio's Google account)
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const env = process.argv[2];
const deploy = process.argv.includes('--deploy');
if (env !== 'dev' && env !== 'prod') {
  console.error('Usage: node scripts/push.js dev|prod [--deploy]');
  process.exit(2);
}
const settings = JSON.parse(fs.readFileSync(path.join(root, 'deploy', env + '.json'), 'utf8'));
if (!settings.scriptId) fail('Put the Script ID (Apps Script → Project Settings) in deploy/' + env + '.json.');
if (deploy && !settings.deploymentId) fail('Put the web app deployment ID (Deploy → Manage deployments) in deploy/' + env + '.json.');

function run(cmd, args, quiet) {
  // shell: clasp is a .cmd on Windows. Arguments here never contain user input.
  const r = spawnSync(cmd, args.map((a) => (/\s/.test(a) ? '"' + a + '"' : a)), { cwd: root, shell: true, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' });
  if (r.status !== 0) fail(cmd + ' ' + args[0] + ' failed.' + (quiet ? '\n' + (r.stderr || r.stdout) : ''));
  return (r.stdout || '').trim();
}
function fail(msg) { console.error(msg); process.exit(1); }

// The studio only ever gets committed code, so every deploy can be traced to a commit.
const sha = run('git', ['rev-parse', '--short', 'HEAD'], true);
if (env === 'prod' && run('git', ['status', '--porcelain'], true)) fail('Commit your changes before pushing to prod.');

run('node', ['scripts/test_logic.js']);

const version = (fs.readFileSync(path.join(root, 'apps-script', 'Logic.gs'), 'utf8').match(/APP_VERSION = '([^']+)'/) || [])[1];
const project = '.clasp.' + env + '.json';
fs.writeFileSync(path.join(root, project), JSON.stringify({ scriptId: settings.scriptId, rootDir: 'apps-script' }, null, 2));
const clasp = (args) => run('clasp', args.concat(['--user', settings.user, '--project', project]));

clasp(['push', '--force']);
if (deploy) {
  // Same deployment ID → same /exec URL, now serving a new version. Done as settings.user,
  // so prod always runs as the studio's account.
  clasp(['create-deployment', '--deploymentId', settings.deploymentId, '--description', version + ' (' + sha + ')']);
}
console.log('\n' + env + ': pushed ' + version + ' (' + sha + ')' + (deploy ? ' and redeployed.' : '. The web app still serves its last deployed version; add --deploy to update it.'));

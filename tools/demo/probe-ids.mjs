// Probe: every route that takes an :id path param should 400 on a malformed (non-uuid) id,
// never 500. CLAUDE.md: "Validate path/query UUIDs with z.string().uuid() so malformed ids
// return 400, not a Postgres 500."
import { call, login, newBvn, newNin, newPhone } from './lib.mjs';

const p = await login(newPhone(), { nin: newNin(), bvn: newBvn() });
const token = p.body.accessToken;

const BAD = 'not-a-uuid';
const probes = [
  ['GET', `/sub-wallets/${BAD}`],
  ['GET', `/sub-wallets/${BAD}/balance`],
  ['GET', `/sub-wallets/${BAD}/rules`],
  ['GET', `/sub-wallets/${BAD}/transactions`],
  ['PATCH', `/sub-wallets/${BAD}`, { status: 'active' }],
  ['POST', `/sub-wallets/${BAD}/rules`, { rules: [{ kind: 'limit', priority: 1, config: {} }] }],
  ['GET', `/transactions/${BAD}`],
  ['POST', `/transactions/${BAD}/evaluate`],
  ['POST', `/transactions/${BAD}/send`],
  ['POST', `/transactions/${BAD}/attach-media`, { mediaKey: 'k' }],
  ['POST', `/bumps/${BAD}/decision`, { decision: 'approve_once' }],
  ['GET', `/households/${BAD}/sub-wallets`],
  [
    'POST',
    `/households/${BAD}/sub-wallets`,
    { agentUserId: '00000000-0000-0000-0000-000000000000', name: 'x' },
  ],
];

let bad500 = 0;
for (const [method, path, body] of probes) {
  const r = await call(path, { method, token, body });
  const verdict = r.status === 500 ? 'SERVER ERROR (bug)' : `${r.status}`;
  if (r.status === 500) bad500++;
  const mark = r.status === 500 ? '✗' : '·';
  console.log(`${mark} ${method.padEnd(6)} ${path.padEnd(46)} → ${verdict}`);
}
console.log(`\n${bad500} route(s) return 500 on a malformed id.`);
process.exit(bad500 > 0 ? 1 : 0);

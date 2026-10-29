import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand as p, findAgent, complete } from '../../shared/command.js';

const ctx = {
  agents: [
    { id: 'a1', codename: 'NIGHTJAR', name: 'Hallway', label: 'AGENT-01', place: { roomId: 'r-k' } },
    { id: 'a2', codename: 'KESTREL', name: '', label: 'AGENT-02' },
  ],
  rooms: [{ id: 'r-k', name: 'Kitchen' }, { id: 'r-l', name: 'Living room' }],
};

test('terminal commands', () => {
  assert.deepEqual(p('help'), { cmd: 'help' });
  assert.deepEqual(p('STATUS'), { cmd: 'status' });
  assert.deepEqual(p('mode night'), { cmd: 'mode', mode: 'night' });
  assert.deepEqual(p('mode banana').cmd, 'error');
  assert.deepEqual(p('log 5'), { cmd: 'log', n: 5 });
  assert.deepEqual(p('log'), { cmd: 'log', n: 10 });
  assert.deepEqual(p('map plan'), { cmd: 'map', view: 'plan' });
  assert.deepEqual(p('theme navy'), { cmd: 'theme', theme: 'navy' });
  assert.equal(p('theme pink').cmd, 'error');
  assert.deepEqual(p('find nightjar', ctx), { cmd: 'find', agentId: 'a1' });
  assert.deepEqual(p('find agent-02', ctx), { cmd: 'find', agentId: 'a2' });
  assert.deepEqual(p('find 1', ctx), { cmd: 'find', agentId: 'a1' });
  assert.deepEqual(p('live kitchen', ctx), { cmd: 'live', agentId: 'a1' }, 'an Agent can be named by its room');
  assert.equal(p('find bob', ctx).cmd, 'error');
  assert.deepEqual(p('speedtest'), { cmd: 'speedtest' });
  assert.deepEqual(p('standdown'), { cmd: 'standdown' });
  assert.deepEqual(p('panic'), { cmd: 'panic' });
  assert.deepEqual(p('lock'), { cmd: 'lock' });
  assert.deepEqual(p('xyzzy'), { cmd: 'unknown', text: 'xyzzy' });
  assert.deepEqual(p('   '), { cmd: 'none' });
});

test('messages keep their wording and find who they’re for', () => {
  assert.deepEqual(p('send all Dinner is ready!', ctx), { cmd: 'send', target: 'all', text: 'Dinner is ready!' });
  assert.deepEqual(p('broadcast Leaving in 5 minutes', ctx), { cmd: 'send', target: 'all', text: 'Leaving in 5 minutes' });
  assert.deepEqual(p('send living room Lights out', ctx), { cmd: 'send', target: 'room:r-l', text: 'Lights out' });
  assert.deepEqual(p('tell kestrel Come downstairs please', ctx), { cmd: 'send', target: 'a2', text: 'Come downstairs' });
  assert.deepEqual(p('send kitchen kitchen is closed', ctx), { cmd: 'send', target: 'room:r-k', text: 'kitchen is closed' });
  assert.equal(p('send nobody hi', ctx).cmd, 'error');
  assert.equal(p('send all', ctx).cmd, 'error');
});

test('voice phrasing', () => {
  assert.deepEqual(p('Switch to night mode'), { cmd: 'mode', mode: 'night' });
  assert.deepEqual(p('Sentinel, arm away please'), { cmd: 'mode', mode: 'away' });
  assert.deepEqual(p('lockdown'), { cmd: 'mode', mode: 'lockdown' });
  assert.deepEqual(p('initiate lock down'), { cmd: 'mode', mode: 'lockdown' });
  assert.deepEqual(p('home mode'), { cmd: 'mode', mode: 'home' });
  assert.deepEqual(p('good night'), { cmd: 'mode', mode: 'night' });
  assert.deepEqual(p("What's the status?"), { cmd: 'status' });
  assert.deepEqual(p('Stop the alarm'), { cmd: 'standdown' });
  assert.deepEqual(p('run a speed test'), { cmd: 'speedtest' });
  assert.deepEqual(p('where is kestrel', ctx), { cmd: 'find', agentId: 'a2' });
  assert.deepEqual(p('show the camera in the kitchen', ctx), { cmd: 'live', agentId: 'a1' });
  assert.deepEqual(p('show plan'), { cmd: 'map', view: 'plan' });
  assert.deepEqual(p('Tell everyone dinner is ready', ctx), { cmd: 'send', target: 'all', text: 'dinner is ready' });
  assert.deepEqual(p('what time is it'), { cmd: 'time' });
  assert.equal(p('I am home now').cmd, 'unknown', 'chatter that mentions a mode is not a command');
});

test('helpers', () => {
  assert.equal(findAgent('Hallway', ctx).id, 'a1');
  assert.equal(findAgent('agent 2', ctx).id, 'a2');
  assert.equal(complete('spe'), 'speedtest');
  assert.ok(['status', 'send', 'speedtest', 'standdown', 'ship'].every((c) => complete('s').includes(c)));
  assert.equal(complete('zz'), null);
});

test('part 8 commands: where is everyone, briefing, weather, diag', () => {
  assert.deepEqual(p('Sentinel, where is everyone?', ctx), { cmd: 'whereis' });
  assert.deepEqual(p('whos home', ctx), { cmd: 'whereis' });
  assert.deepEqual(p('is anyone home', ctx), { cmd: 'whereis' });
  assert.deepEqual(p('where is kestrel', ctx), { cmd: 'find', agentId: 'a2' }, 'naming an Agent still finds it');
  assert.deepEqual(p('briefing'), { cmd: 'briefing', daysAgo: 1 });
  assert.deepEqual(p('briefing today'), { cmd: 'briefing', daysAgo: 0 });
  assert.deepEqual(p('give me the morning briefing'), { cmd: 'briefing', daysAgo: 1 });
  assert.deepEqual(p("what's the weather like"), { cmd: 'weather' });
  assert.deepEqual(p('is it going to rain'), { cmd: 'weather' });
  assert.deepEqual(p('diag', ctx), { cmd: 'diag', agentId: null });
  assert.deepEqual(p('battery nightjar', ctx), { cmd: 'diag', agentId: 'a1' });
  assert.equal(p('diag bob', ctx).cmd, 'error');
});

test('part 9 commands: replay and heatmap', () => {
  assert.deepEqual(p('replay today'), { cmd: 'replay', daysAgo: 0 });
  assert.deepEqual(p('replay'), { cmd: 'replay', daysAgo: 0 });
  assert.deepEqual(p('replay yesterday'), { cmd: 'replay', daysAgo: 1 });
  assert.deepEqual(p('replay stop'), { cmd: 'replay', stop: true });
  assert.deepEqual(p('heatmap'), { cmd: 'heatmap', on: true, days: 1 });
  assert.deepEqual(p('heatmap week'), { cmd: 'heatmap', on: true, days: 7 });
  assert.deepEqual(p('heatmap off'), { cmd: 'heatmap', on: false, days: 1 });
  assert.deepEqual(p('Sentinel, show the heat map'), { cmd: 'heatmap', on: true, days: 1 });
  assert.deepEqual(p('hide the heatmap'), { cmd: 'heatmap', on: false, days: 1 });
});

test('removed gimmicks: night vision and cinematic are no longer commands', () => {
  assert.equal(p('nightvision on').cmd, 'unknown');
  assert.equal(p('cinematic').cmd, 'unknown');
});

test('part 11 commands: global intel', () => {
  assert.deepEqual(p('global'), { cmd: 'global' });
  assert.deepEqual(p('Sentinel, where is the ISS?'), { cmd: 'global', sel: { type: 'iss' }, say: 'iss' });
  assert.deepEqual(p('when is the next ISS pass'), { cmd: 'global', sel: { type: 'iss' }, say: 'iss' });
  assert.deepEqual(p('any planes overhead'), { cmd: 'global', say: 'air' });
  assert.deepEqual(p('earthquakes'), { cmd: 'global', say: 'quakes' });
  assert.deepEqual(p('ship 235052123'), { cmd: 'global', sel: { type: 'ship', id: '235052123' }, say: 'ship' });
});

import { api, el, clear, toast, medal } from './common.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');

let me = null; // logged-in user
let socket = null;
let room = null; // current game state from the server (null = not in a game)
let myChoice = null; // index I picked this question, 'locked' after a reconnect, or null
let clockOffset = 0; // serverTime - clientTime, so countdowns match the server
let tick = null;
let homeTab = 'play';

const send = (event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve));

// ---------- boot ----------
boot();
async function boot() {
  try {
    me = (await api('/api/auth/me')).user;
  } catch {
    me = null;
  }
  if (me) connect();
  route();
}

function route() {
  clearInterval(tick);
  renderNav();
  if (!me) return renderAuth();
  if (room) return renderRoom();
  renderHome();
}

function renderNav() {
  clear(nav);
  if (!me) return;
  nav.append(
    ...[
      el('span', { class: 'who' }, `Signed in as ${me.username}`),
      me.role === 'admin' ? el('a', { class: 'btn ghost small', href: '/admin.html' }, 'Admin') : null,
      el('button', { class: 'ghost small', onclick: logout }, 'Log out'),
    ].filter(Boolean)
  );
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  socket?.close();
  socket = null;
  me = null;
  room = null;
  route();
}

// ---------- sockets ----------
function connect() {
  socket = io();
  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') {
      me = null;
      room = null;
      route();
    }
  });
  socket.on('room:rejoined', (snap) => {
    room = snap;
    if (snap.question) syncClock(snap.question);
    myChoice = snap.answered ? 'locked' : null;
    route();
  });
  socket.on('room:state', (s) => {
    room = { ...(room || {}), ...s };
    if (room.status === 'lobby') route(); // other screens must not redraw mid-question
  });
  socket.on('question:show', (q) => {
    syncClock(q);
    myChoice = null;
    room = { ...room, status: 'question', question: q, result: null, answerCount: { answered: 0, total: room?.players?.length || 0 } };
    route();
  });
  socket.on('answer:count', (c) => {
    if (!room) return;
    room.answerCount = c;
    const n = document.getElementById('answer-count');
    if (n) n.textContent = `${c.answered} / ${c.total} answered`;
  });
  socket.on('question:result', (r) => {
    room = { ...room, status: 'reveal', result: r };
    route();
  });
  socket.on('game:end', (end) => {
    room = { ...room, status: 'ended', final: end.leaderboard };
    route();
  });
  socket.on('game:cancelled', ({ reason }) => {
    toast(reason || 'The game was cancelled.');
    room = null;
    route();
  });
}

function syncClock(q) {
  clockOffset = q.serverNow - Date.now();
}

// ---------- auth screen ----------
function renderAuth(mode = 'login') {
  const error = el('div', { class: 'error', role: 'alert' });
  const email = el('input', { type: 'email', autocomplete: 'email', required: true });
  const username = el('input', { autocomplete: 'username', minlength: 3, maxlength: 20, pattern: '[A-Za-z0-9_]{3,20}', title: '3-20 letters, numbers or underscores' });
  const password = el('input', { type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', minlength: mode === 'login' ? 1 : 8, required: true });

  const form = el(
    'form',
    {
      class: 'card narrow',
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = '';
        try {
          const body = mode === 'login'
            ? { email: email.value, password: password.value }
            : { email: email.value, username: username.value, password: password.value };
          me = (await api(`/api/auth/${mode}`, { method: 'POST', body })).user;
          connect();
          route();
        } catch (err) {
          error.textContent = err.message;
        }
      },
    },
    el('h2', {}, mode === 'login' ? 'Welcome back' : 'Create your account'),
    el('label', {}, 'Email'), email,
    mode === 'register' ? [el('label', {}, 'Username'), username] : null,
    el('label', {}, 'Password'), password,
    error,
    el('button', { class: 'block', type: 'submit' }, mode === 'login' ? 'Log in' : 'Sign up'),
    el('p', { class: 'muted' },
      mode === 'login' ? 'New here? ' : 'Already have an account? ',
      el('a', { href: '#', onclick: (e) => { e.preventDefault(); renderAuth(mode === 'login' ? 'register' : 'login'); } },
        mode === 'login' ? 'Create an account' : 'Log in'))
  );
  clear(app).append(form);
  email.focus();
}

// ---------- home ----------
function renderHome() {
  const tabs = el('div', { class: 'tabs' },
    ...[['play', 'Play'], ['leaderboard', 'Leaderboard'], ['history', 'My games']].map(([id, label]) =>
      el('button', { class: homeTab === id ? 'active' : '', onclick: () => { homeTab = id; renderHome(); } }, label)));
  const body = el('div');
  clear(app).append(tabs, body);
  if (homeTab === 'play') playTab(body);
  if (homeTab === 'leaderboard') leaderboardTab(body);
  if (homeTab === 'history') historyTab(body);
}

async function playTab(body) {
  const category = el('select', {}, el('option', { value: '' }, 'All categories'));
  const count = el('input', { type: 'number', min: 1, max: 30, value: 10 });
  const hostPlays = el('input', { type: 'checkbox', id: 'host-plays', checked: true });
  const createErr = el('div', { class: 'error', role: 'alert' });
  const code = el('input', { maxlength: 6, placeholder: 'ABC123', autocapitalize: 'characters', style: 'text-transform:uppercase;letter-spacing:.2em;font-size:1.3rem;text-align:center' });
  const joinErr = el('div', { class: 'error', role: 'alert' });

  body.append(el('div', { class: 'grid2' },
    el('div', { class: 'card' },
      el('h3', {}, 'Host a game'),
      el('p', { class: 'muted' }, 'Create a room with a 6-character code. Play along or host for others.'),
      el('label', {}, 'Category'), category,
      el('label', {}, 'Number of questions'), count,
      el('label', { class: 'check-row' }, hostPlays, el('span', {}, 'Participate as a player')),
      createErr,
      el('button', { class: 'block', onclick: async () => {
        createErr.textContent = '';
        const r = await send('game:create', {
          category: category.value || undefined,
          count: Number(count.value) || 10,
          hostPlays: hostPlays.checked,
        });
        if (!r.ok) return (createErr.textContent = r.error);
        room = { ...(room || {}), ...r.snapshot };
        route();
      } }, 'Create game')),
    el('div', { class: 'card' },
      el('h3', {}, 'Join a game'),
      el('p', { class: 'muted' }, 'Enter the 6-character code from the host.'),
      el('label', {}, 'Game code'), code,
      joinErr,
      el('button', { class: 'block', onclick: async () => {
        joinErr.textContent = '';
        const r = await send('room:join', { code: code.value.trim() });
        if (!r.ok) return (joinErr.textContent = r.error);
        room = { ...(room || {}), ...r.snapshot };
        route();
      } }, 'Join'))));

  try {
    const { categories } = await api('/api/categories');
    for (const c of categories) category.append(el('option', { value: c.category }, `${c.category} (${c.count})`));
    if (!categories.length) createErr.textContent = 'No questions yet. An admin needs to add some (or run npm run seed).';
  } catch { /* ignore */ }
}

async function leaderboardTab(body, period = 'all') {
  clear(body).append(el('p', { class: 'muted' }, 'Loading…'));
  const { leaderboard } = await api(`/api/leaderboard?period=${period}`);
  clear(body).append(
    el('div', { class: 'tabs' },
      el('button', { class: period === 'all' ? 'active' : '', onclick: () => leaderboardTab(body, 'all') }, 'All time'),
      el('button', { class: period === 'week' ? 'active' : '', onclick: () => leaderboardTab(body, 'week') }, 'This week')),
    el('div', { class: 'card table-wrap' },
      leaderboard.length
        ? el('table', {},
            el('thead', {}, el('tr', {}, ...['#', 'Player', 'Points', 'Games', 'Wins'].map((h, i) => el('th', { class: i > 1 ? 'num' : '' }, h)))),
            el('tbody', {}, leaderboard.map((r) => el('tr', {},
              el('td', { class: 'medal' }, medal(r.rank)),
              el('td', {}, r.username),
              el('td', { class: 'num' }, r.totalScore.toLocaleString()),
              el('td', { class: 'num' }, r.gamesPlayed),
              el('td', { class: 'num' }, r.wins)))))
        : el('p', { class: 'muted' }, 'No finished games yet. Be the first on the board!')));
}

async function historyTab(body) {
  clear(body).append(el('p', { class: 'muted' }, 'Loading…'));
  const { totals, games } = await api('/api/me/history');
  clear(body).append(
    el('div', { class: 'stats' },
      el('div', { class: 'stat' }, el('b', {}, totals.totalScore.toLocaleString()), 'total points'),
      el('div', { class: 'stat' }, el('b', {}, totals.gamesPlayed), 'games played'),
      el('div', { class: 'stat' }, el('b', {}, totals.wins), 'wins')),
    el('div', { class: 'card table-wrap' },
      games.length
        ? el('table', {},
            el('thead', {}, el('tr', {}, ...['When', 'Category', 'Place', 'Correct', 'Points'].map((h, i) => el('th', { class: i > 1 ? 'num' : '' }, h)))),
            el('tbody', {}, games.map((g) => el('tr', {},
              el('td', {}, g.endedAt?.replace('T', ' ').slice(0, 16)),
              el('td', {}, g.category || 'All'),
              el('td', { class: 'num' }, `${g.rank} of ${g.playerCount}`),
              el('td', { class: 'num' }, `${g.correctCount}/${g.questionCount}`),
              el('td', { class: 'num' }, g.score.toLocaleString())))))
        : el('p', { class: 'muted' }, "You haven't finished a game yet.")));
}

// ---------- room ----------
function renderRoom() {
  const isHost = room.hostId === me.id;
  const isPlayer = !!(room.players || []).some((p) => p.userId === me.id);
  if (room.status === 'lobby') return renderLobby(isHost, isPlayer);
  if (room.status === 'question') return renderQuestion(isHost, isPlayer);
  if (room.status === 'reveal') return renderReveal(isHost, isPlayer);
  if (room.status === 'ended') return renderEnd();
}

function leaveButton() {
  return el('button', { class: 'ghost', onclick: async () => {
    const r = await send('room:leave');
    if (!r.ok) return toast(r.error);
    room = null;
    route();
  } }, 'Leave');
}

function renderLobby(isHost, isPlayer) {
  const players = room.players || [];
  clear(app).append(el('div', { class: 'card' },
    el('p', { class: 'muted', style: 'text-align:center;margin:0' },
      `Hosted by ${room.hostName}${room.hostPlays ? ' (playing)' : ' (presenter)'} · ${room.total} questions · ${room.category || 'All categories'}`),
    el('div', { class: 'code', 'aria-label': 'Game code' }, room.code),
    el('p', { class: 'muted', style: 'text-align:center' }, 'Share this code with your friends'),
    el('h3', {}, `Players (${players.length})`),
    players.length
      ? el('div', { class: 'players' }, players.map((p) => el('span', { class: `player${p.connected ? '' : ' off'}` },
          p.username,
          p.userId === room.hostId ? el('span', { class: 'pill', style: 'margin-left:6px;font-size:.7rem' }, 'host') : null
        )))
      : el('p', { class: 'muted' }, 'Waiting for players to join…'),
    el('div', { class: 'row', style: 'margin-top:16px' },
      isHost ? el('button', { disabled: players.length < 1, onclick: async () => {
        const r = await send('game:start');
        if (!r.ok) toast(r.error);
      } }, 'Start game') : el('span', { class: 'muted grow' }, 'Waiting for the host to start…'),
      leaveButton())));
}

function startCountdown(q, bar, label) {
  const total = q.timeLimit * 1000;
  clearInterval(tick);
  const update = () => {
    const left = Math.max(0, q.endsAt - (Date.now() + clockOffset));
    bar.style.transform = `scaleX(${Math.min(1, left / total)})`;
    label.textContent = `${Math.ceil(left / 1000)}s`;
    if (left <= 0) clearInterval(tick);
  };
  update();
  tick = setInterval(update, 100);
}

function renderQuestion(isHost, isPlayer) {
  const q = room.question;
  const bar = el('i');
  const timeLabel = el('span');
  const banner = el('div', { class: 'banner info', hidden: true });
  const buttons = q.options.map((text, i) => el('button', {
    class: 'opt',
    disabled: !isPlayer || myChoice !== null,
    onclick: async () => {
      if (!isPlayer || myChoice !== null) return;
      myChoice = i;
      buttons.forEach((b, j) => { b.disabled = true; b.classList.toggle('picked', j === i); });
      const r = await send('answer:submit', { choice: i });
      if (!r.ok) { toast(r.error); return; }
      banner.hidden = false;
      banner.textContent = 'Answer locked in. Waiting for the others…';
    },
  }, text));
  if (typeof myChoice === 'number') buttons[myChoice].classList.add('picked');
  if (myChoice !== null) { banner.hidden = false; banner.textContent = 'Answer locked in. Waiting for the others…'; }

  const c = room.answerCount || { answered: 0, total: (room.players || []).length };
  clear(app).append(el('div', { class: 'card' },
    el('div', { class: 'qhead' },
      el('span', {}, `Question ${q.index + 1} of ${q.total}`),
      el('span', { id: 'answer-count', class: 'muted' }, `${c.answered} / ${c.total} answered`),
      timeLabel),
    el('div', { class: 'bar' }, bar),
    el('div', { class: 'qtext' }, q.text),
    !isPlayer ? el('div', { class: 'banner info' }, 'Presenter mode · Answers are hidden on this screen') : banner,
    el('div', { class: 'opts' }, buttons)));
  startCountdown(q, bar, timeLabel);
}

function renderReveal(isHost, isPlayer) {
  const r = room.result;
  const q = { text: r.text, options: r.options }; // included in the result so a reconnecting client can draw it too
  const mine = r.choices.find((c) => c.userId === me.id);
  const meRow = r.leaderboard.find((p) => p.userId === me.id);

  let banner;
  if (!isPlayer) banner = el('div', { class: 'banner info' }, 'Results for this question');
  else if (!mine || mine.choice === null) banner = el('div', { class: 'banner bad' }, "Time's up. You didn't answer.");
  else if (mine.correct) banner = el('div', { class: 'banner good' }, `Correct! +${meRow?.lastGain ?? 0} points`);
  else banner = el('div', { class: 'banner bad' }, 'Not quite.');

  const opts = (q?.options || []).map((text, i) => el('button', {
    class: `opt${i === r.correctIndex ? ' correct' : ' dim'}${mine?.choice === i ? ' picked' : ''}`,
    disabled: true,
  }, text));

  clear(app).append(el('div', { class: 'card' },
    el('div', { class: 'qhead' }, el('span', {}, `Question ${r.index + 1} of ${r.total}`),
      el('span', {}, r.index + 1 >= r.total ? 'Final results next…' : 'Next question soon…')),
    el('div', { class: 'qtext' }, q?.text || ''),
    banner,
    el('div', { class: 'opts' }, opts),
    el('h3', { style: 'margin-top:20px' }, 'Scoreboard'),
    boardTable(r.leaderboard.slice(0, 5), true)));
}

function boardTable(rows, showGain) {
  return el('div', { class: 'table-wrap' }, el('table', {},
    el('tbody', {}, rows.map((p) => el('tr', {},
      el('td', { class: 'medal' }, medal(p.rank)),
      el('td', {}, p.username, p.userId === me.id ? el('span', { class: 'pill', style: 'margin-left:6px' }, 'you') : null),
      el('td', { class: 'num' }, p.score.toLocaleString(),
        showGain && p.lastGain ? el('span', { class: 'gain' }, `+${p.lastGain}`) : null))))));
}

function renderEnd() {
  const board = room.final || [];
  const mine = board.find((p) => p.userId === me.id);
  clear(app).append(el('div', { class: 'card' },
    el('h2', {}, 'Game over!'),
    mine ? el('p', { class: 'muted' }, `You finished ${medal(mine.rank)} with ${mine.score.toLocaleString()} points (${mine.correctCount} correct).`) : null,
    board.length ? boardTable(board, false) : el('p', { class: 'muted' }, 'No players.'),
    el('div', { class: 'row', style: 'margin-top:16px' },
      el('button', { onclick: () => { room = null; homeTab = 'leaderboard'; route(); } }, 'See leaderboard'),
      el('button', { class: 'ghost', onclick: () => { room = null; homeTab = 'play'; route(); } }, 'Back to home'))));
}

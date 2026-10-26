import { api, el, clear, toast } from './common.js';

const app = document.getElementById('app');
let tab = 'stats';

init();
async function init() {
  try {
    const { user } = await api('/api/auth/me');
    if (user.role !== 'admin') return deny('You need an admin account to see this page.');
  } catch {
    return deny('Please log in with an admin account first.');
  }
  render();
}

function deny(msg) {
  clear(app).append(el('div', { class: 'card narrow' }, el('h2', {}, 'Admins only'), el('p', { class: 'muted' }, msg), el('a', { class: 'btn', href: '/' }, 'Go to login')));
}

function render() {
  const body = el('div');
  clear(app).append(
    el('div', { class: 'tabs' }, ...[['stats', 'Stats'], ['questions', 'Questions'], ['users', 'Users']].map(([id, label]) =>
      el('button', { class: tab === id ? 'active' : '', onclick: () => { tab = id; render(); } }, label))),
    body);
  ({ stats: statsTab, questions: questionsTab, users: usersTab })[tab](body);
}

const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

// ---------- stats ----------
async function statsTab(body) {
  const s = await api('/api/admin/stats');
  const stat = (n, label) => el('div', { class: 'stat' }, el('b', {}, n), label);
  body.append(
    el('div', { class: 'stats' },
      stat(s.totals.users, 'users'), stat(s.totals.questions, 'questions'),
      stat(s.totals.gamesPlayed, 'games played'), stat(s.liveGames, 'live games now'), stat(s.totals.bannedUsers, 'banned users')),
    el('div', { class: 'grid2' },
      el('div', { class: 'card' }, el('h3', {}, 'Games per day (last 7 days)'),
        s.gamesPerDay.length ? table(['Day', 'Games'], s.gamesPerDay.map((r) => [r.day, r.games])) : el('p', { class: 'muted' }, 'No games yet.')),
      el('div', { class: 'card' }, el('h3', {}, 'Top players'),
        s.topPlayers.length ? table(['Player', 'Points', 'Games'], s.topPlayers.map((r) => [r.username, r.totalScore.toLocaleString(), r.games])) : el('p', { class: 'muted' }, 'No games yet.'))),
    el('div', { class: 'card' }, el('h3', {}, 'Questions by category'),
      table(['Category', 'Questions'], s.byCategory.map((r) => [r.category, r.count]))));
}

function table(head, rows) {
  return el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, head.map((h, i) => el('th', { class: i > 0 ? 'num' : '' }, h)))),
    el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c, i) => el('td', { class: i > 0 ? 'num' : '' }, c)))))));
}

// ---------- questions ----------
async function questionsTab(body, search = '') {
  const { questions } = await api(`/api/admin/questions?q=${encodeURIComponent(search)}`);
  const q = el('input', { placeholder: 'Search questions…', value: search });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clear(body); questionsTab(body, q.value); } });

  clear(body).append(
    el('div', { class: 'row', style: 'margin-bottom:12px' },
      el('div', { class: 'grow' }, q),
      el('button', { onclick: () => questionForm(body, null) }, 'New question')),
    el('div', { class: 'card table-wrap' }, questions.length
      ? el('table', {},
          el('thead', {}, el('tr', {}, ['Question', 'Category', 'Answer', ''].map((h) => el('th', {}, h)))),
          el('tbody', {}, questions.map((x) => el('tr', {},
            el('td', {}, x.text),
            el('td', {}, el('span', { class: 'pill' }, x.category)),
            el('td', {}, x.options[x.correctIndex]),
            el('td', { class: 'num', style: 'white-space:nowrap' },
              el('button', { class: 'ghost small', onclick: () => questionForm(body, x) }, 'Edit'), ' ',
              el('button', { class: 'danger small', onclick: guard(async () => {
                if (!confirm('Delete this question?')) return;
                await api(`/api/admin/questions/${x.id}`, { method: 'DELETE' });
                toast('Deleted');
                questionsTab(body, search);
              }) }, 'Delete'))))))
      : el('p', { class: 'muted' }, 'No questions found.')));
}

function questionForm(body, existing) {
  const text = el('textarea', { rows: 2, maxlength: 300, value: existing?.text || '' });
  const category = el('input', { maxlength: 40, value: existing?.category || 'General' });
  const time = el('input', { type: 'number', min: 5, max: 60, value: existing?.timeLimit || 20 });
  const opts = [0, 1, 2, 3].map((i) => el('input', { maxlength: 100, placeholder: i < 2 ? `Option ${i + 1} (required)` : `Option ${i + 1} (optional)`, value: existing?.options[i] || '' }));
  const radios = [0, 1, 2, 3].map((i) => el('input', { type: 'radio', name: 'correct', value: i, checked: (existing?.correctIndex ?? 0) === i, 'aria-label': `Option ${i + 1} is correct` }));
  const error = el('div', { class: 'error', role: 'alert' });

  clear(body).append(el('div', { class: 'card' },
    el('h3', {}, existing ? 'Edit question' : 'New question'),
    el('label', {}, 'Question'), text,
    el('label', {}, 'Answers (select the correct one)'),
    opts.map((o, i) => el('div', { class: 'opt-row' }, radios[i], o)),
    el('div', { class: 'grid2' }, el('div', {}, el('label', {}, 'Category'), category), el('div', {}, el('label', {}, 'Time limit (seconds)'), time)),
    error,
    el('div', { class: 'row', style: 'margin-top:12px' },
      el('button', { onclick: async () => {
        error.textContent = '';
        // Keep only non-empty options and re-map which one is correct.
        const filled = opts.map((o, i) => ({ v: o.value.trim(), i })).filter((o) => o.v);
        const correct = radios.findIndex((r) => r.checked);
        const correctIndex = filled.findIndex((o) => o.i === correct);
        if (correctIndex < 0) return (error.textContent = 'The correct answer must not be empty.');
        const payload = { text: text.value, options: filled.map((o) => o.v), correctIndex, category: category.value, timeLimit: Number(time.value) };
        try {
          await api(existing ? `/api/admin/questions/${existing.id}` : '/api/admin/questions', { method: existing ? 'PUT' : 'POST', body: payload });
          toast('Saved');
          questionsTab(body);
        } catch (e) { error.textContent = e.message; }
      } }, 'Save'),
      el('button', { class: 'ghost', onclick: () => questionsTab(body) }, 'Cancel'))));
}

// ---------- users ----------
async function usersTab(body, search = '') {
  const { users } = await api(`/api/admin/users?q=${encodeURIComponent(search)}`);
  const q = el('input', { placeholder: 'Search username or email…', value: search });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clear(body); usersTab(body, q.value); } });
  const patch = (u, change, msg) => guard(async () => {
    await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: change });
    toast(msg);
    usersTab(body, search);
  });

  clear(body).append(
    el('div', { style: 'margin-bottom:12px' }, q),
    el('div', { class: 'card table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, ['User', 'Email', 'Role', 'Games', 'Status', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, users.map((u) => el('tr', {},
        el('td', {}, u.username),
        el('td', { class: 'muted' }, u.email),
        el('td', {}, el('span', { class: `pill${u.role === 'admin' ? ' admin' : ''}` }, u.role)),
        el('td', {}, u.gamesPlayed),
        el('td', {}, u.banned ? el('span', { class: 'pill bad' }, 'banned') : 'active'),
        el('td', { style: 'white-space:nowrap' },
          el('button', { class: 'ghost small', onclick: patch(u, { role: u.role === 'admin' ? 'player' : 'admin' }, 'Role updated') }, u.role === 'admin' ? 'Demote' : 'Make admin'), ' ',
          el('button', { class: `${u.banned ? 'ghost' : 'danger'} small`, onclick: patch(u, { banned: !u.banned }, u.banned ? 'Unbanned' : 'Banned') }, u.banned ? 'Unban' : 'Ban'))))))));
}

import './styles.css';
import { api, ApiError, type Link } from './api.js';
import { renderClicksChart, sparklineSvg } from './charts.js';

const app = document.getElementById('app')!;
let domain = location.host;
let appUrl = location.origin;

// --- Small helpers -----------------------------------------------------------

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c !== null) node.append(c);
  return node;
}

function navigate(path: string): void {
  history.pushState({}, '', path);
  route();
}

function link(href: string, text: string, cls = ''): HTMLAnchorElement {
  const a = h('a', { href, class: cls }, text);
  a.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(href);
  });
  return a;
}

function toast(message: string): void {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast' }, message);
  document.body.append(t);
  setTimeout(() => t.remove(), 1800);
}

async function copyText(text: string, node?: HTMLElement): Promise<void> {
  await navigator.clipboard.writeText(text);
  if (node) {
    node.classList.add('copied');
    setTimeout(() => node.classList.remove('copied'), 1200);
  }
  toast('Copied to clipboard');
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function slugChip(code: string, opts: { big?: boolean } = {}): HTMLButtonElement {
  const chip = h('button', { class: `chip${opts.big ? ' big' : ''}`, title: 'Copy short link' });
  chip.append(h('span', { class: 'domain' }, domain), h('span', { class: 'slash' }, '/'), h('span', { class: 'code' }, code));
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    copyText(`${appUrl}/${code}`, chip);
  });
  return chip;
}

const RANGES = [
  { days: 7, label: '7d' },
  { days: 14, label: '14d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
];

function rangePicker(current: number, onChange: (days: number) => void): HTMLElement {
  const wrap = h('div', { class: 'ranges', role: 'group', 'aria-label': 'Date range' });
  for (const r of RANGES) {
    const b = h('button', { class: `range-btn${r.days === current ? ' active' : ''}` }, r.label);
    b.addEventListener('click', () => onChange(r.days));
    wrap.append(b);
  }
  return wrap;
}

// --- Shell ---------------------------------------------------------------------

function themeToggle(): HTMLButtonElement {
  const btn = h('button', { class: 'iconbtn', title: 'Toggle theme', 'aria-label': 'Toggle theme' }, '◐');
  btn.addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    localStorage.setItem('theme', root.dataset.theme);
    // Re-render so charts pick up the new palette.
    route();
  });
  return btn;
}

function shell(active: 'links' | 'keys', ...content: (Node | string)[]): void {
  const wordmark = link('/dashboard', '', 'wordmark');
  wordmark.append(domain, h('span', { class: 'slash' }, '/'));

  const nav = h('nav', {});
  nav.append(
    link('/dashboard', 'Links', `navlink${active === 'links' ? ' active' : ''}`),
    link('/dashboard/keys', 'API keys', `navlink${active === 'keys' ? ' active' : ''}`),
    h('a', { href: '/docs', target: '_blank', rel: 'noopener', class: 'navlink' }, 'Docs ↗'),
    themeToggle(),
  );
  const logout = h('button', { class: 'iconbtn', title: 'Sign out' }, 'Sign out');
  logout.addEventListener('click', async () => {
    await api.logout();
    navigate('/login');
  });
  nav.append(logout);

  const view = h('div', { class: 'view' }, ...content);
  app.replaceChildren(h('header', { class: 'topbar' }, wordmark, nav), h('main', { class: 'wrap' }, view));
}

// --- Login view -------------------------------------------------------------------

function renderLogin(): void {
  const error = h('p', { class: 'form-error' });
  const input = h('input', {
    class: 'input',
    type: 'password',
    placeholder: 'Password',
    autocomplete: 'current-password',
    autofocus: 'true',
  });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
  const form = h('form', {}, input, error, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    submit.setAttribute('disabled', 'true');
    try {
      await api.login(input.value);
      navigate('/dashboard');
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
      submit.removeAttribute('disabled');
      input.select();
    }
  });

  const card = h('div', { class: 'card login-card' });
  const title = h('div', { class: 'domain' }, domain, h('span', { class: 'slash' }, '/'));
  card.append(title, h('p', {}, 'Sign in to manage short links.'), form);

  app.replaceChildren(h('div', { class: 'login-page view' }, h('div', { class: 'watermark' }, '/'), card));
  input.focus();
}

// --- Dashboard view ------------------------------------------------------------------

let dashboardDays = 7;

async function renderDashboard(): Promise<void> {
  const [stats, links] = await Promise.all([api.stats(dashboardDays), api.links()]);

  // Create bar
  const urlInput = h('input', { class: 'input', type: 'url', placeholder: 'Paste a long URL to shorten…', required: 'true' });
  const codeInput = h('input', { class: 'input mono', type: 'text', placeholder: 'custom-code (optional)' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Shorten');
  const slugbox = h('div', { class: 'slugbox' }, h('span', { class: 'domain' }, `${domain}/`), codeInput);
  const form = h('form', { class: 'createbar' }, h('div', { class: 'grow' }, urlInput), slugbox, submit);
  const createCard = h('div', { class: 'card' }, form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.setAttribute('disabled', 'true');
    try {
      const created = await api.createLink(urlInput.value.trim(), codeInput.value.trim() || undefined);
      createCard.querySelector('.result-banner')?.remove();
      const copyBtn = h('button', { class: 'btn small' }, 'Copy');
      copyBtn.addEventListener('click', () => copyText(created.shortUrl, copyBtn));
      const banner = h(
        'div',
        { class: 'result-banner' },
        h('span', { class: 'short' }, created.shortUrl.replace(/^https?:\/\//, '')),
        copyBtn,
        link(`/dashboard/links/${encodeURIComponent(created.code)}`, 'View stats', ''),
      );
      createCard.append(banner);
      urlInput.value = '';
      codeInput.value = '';
      await refreshTable();
      copyText(created.shortUrl);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create the link.');
    } finally {
      submit.removeAttribute('disabled');
    }
  });

  // Stat tiles
  const top = stats.topLinks[0];
  const tiles = h(
    'div',
    { class: 'tiles' },
    tile('Links', String(stats.totalLinks)),
    tile(`Clicks · last ${stats.days}d`, stats.clicksInRange.toLocaleString()),
    tile('Clicks · all time', stats.totalClicks.toLocaleString()),
    tile('Top link', top ? `/${top.code}` : '—', top ? `${top.clicks.toLocaleString()} clicks in range` : 'no clicks yet'),
  );

  // Account-wide chart
  const chartBody = h('div', { class: 'chart-body' });
  const chartCard = h(
    'div',
    { class: 'card chart-card' },
    h(
      'div',
      { class: 'chart-head' },
      h('h2', {}, 'Clicks'),
      h('span', { class: 'total' }, `${stats.clicksInRange.toLocaleString()} in the last ${stats.days} days`),
      rangePicker(dashboardDays, (days) => {
        dashboardDays = days;
        renderDashboard();
      }),
    ),
    chartBody,
  );

  // Links table
  const search = h('input', { class: 'input search', type: 'search', placeholder: 'Search links…' });
  const tableCard = h('div', { class: 'card table-card' });

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refreshTable, 200);
  });

  async function refreshTable(): Promise<void> {
    const res = await api.links(search.value.trim());
    tableCard.replaceChildren(buildLinksTable(res.items, search.value.trim() !== ''));
  }

  shell(
    'links',
    createCard,
    tiles,
    chartCard,
    h('div', { class: 'toolbar' }, h('h2', {}, 'All links'), search),
    tableCard,
  );

  renderClicksChart(chartBody, stats.clicksByDay);
  tableCard.append(buildLinksTable(links.items, false));
  addEventListener('resize', onResizeOnce(chartBody, () => renderClicksChart(chartBody, stats.clicksByDay)), { once: false });
}

function tile(label: string, value: string, sub?: string): HTMLElement {
  return h(
    'div',
    { class: 'card tile' },
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, value),
    sub ? h('div', { class: 'sub' }, sub) : null,
  );
}

function buildLinksTable(items: Link[], searching: boolean): HTMLElement {
  if (items.length === 0) {
    return h(
      'div',
      { class: 'empty' },
      searching ? 'No links match your search.' : 'No links yet',
      h('div', { class: 'hint' }, searching ? '' : 'Paste a URL above to create your first short link.'),
    );
  }
  const thead = h('thead', {}, h('tr', {},
    h('th', {}, 'Short link'),
    h('th', {}, 'Destination'),
    h('th', { class: 'hide-sm' }, 'Last 7 days'),
    h('th', { class: 'num' }, 'Clicks'),
    h('th', { class: 'num hide-sm' }, 'Created'),
  ));
  const tbody = h('tbody', {});
  for (const item of items) {
    const spark = h('td', { class: 'spark hide-sm' });
    spark.append(sparklineSvg(item.sparkline ?? [0, 0, 0, 0, 0, 0, 0]));
    const dest = h('td', { class: 'dest', title: item.url });
    dest.append(link(`/dashboard/links/${encodeURIComponent(item.code)}`, item.url, 'rowlink'));
    const row = h('tr', {},
      h('td', {}, slugChip(item.code)),
      dest,
      spark,
      h('td', { class: 'num' }, item.clicks.toLocaleString()),
      h('td', { class: 'num hide-sm' }, relTime(item.createdAt)),
    );
    row.style.cursor = 'pointer';
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button, a')) return;
      navigate(`/dashboard/links/${encodeURIComponent(item.code)}`);
    });
    tbody.append(row);
  }
  return h('table', {}, thead, tbody);
}

let resizeTimer: ReturnType<typeof setTimeout> | undefined;
function onResizeOnce(target: HTMLElement, fn: () => void): () => void {
  return () => {
    if (!document.contains(target)) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fn, 150);
  };
}

// --- Link detail view -----------------------------------------------------------------

let detailDays = 7;

async function renderLinkDetail(code: string): Promise<void> {
  let linkData: Link;
  try {
    linkData = await api.getLink(code);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      shell('links', h('div', { class: 'empty' }, `No link with code "${code}".`));
      return;
    }
    throw err;
  }
  const stats = await api.linkStats(code, detailDays);

  const openBtn = h('a', { href: linkData.shortUrl, target: '_blank', rel: 'noopener', class: 'btn small' }, 'Open ↗');

  // Editable destination + note
  const urlInput = h('input', { class: 'input mono', type: 'url', value: linkData.url });
  const noteInput = h('input', { class: 'input', type: 'text', placeholder: 'Add a note…', value: linkData.note ?? '' });
  const saveBtn = h('button', { class: 'btn small' }, 'Save');
  saveBtn.addEventListener('click', async () => {
    saveBtn.setAttribute('disabled', 'true');
    try {
      await api.updateLink(code, { url: urlInput.value.trim(), note: noteInput.value });
      toast('Saved');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      saveBtn.removeAttribute('disabled');
    }
  });

  const head = h('div', {},
    link('/dashboard', '← All links', 'backlink'),
    h('div', { class: 'detail-head' }, slugChip(code, { big: true }), openBtn),
    h('div', { class: 'editrow' }, urlInput, noteInput, saveBtn),
    h('p', { class: 'meta' }, `Created ${relTime(linkData.createdAt)} · updated ${relTime(linkData.updatedAt)}`),
  );

  const tiles = h('div', { class: 'tiles' },
    tile(`Clicks · last ${stats.days}d`, stats.clicksInRange.toLocaleString()),
    tile('Clicks · all time', stats.totalClicks.toLocaleString()),
  );

  const chartBody = h('div', { class: 'chart-body' });
  const chartCard = h('div', { class: 'card chart-card' },
    h('div', { class: 'chart-head' },
      h('h2', {}, 'Clicks'),
      h('span', { class: 'total' }, `${stats.clicksInRange.toLocaleString()} in the last ${stats.days} days`),
      rangePicker(detailDays, (days) => {
        detailDays = days;
        renderLinkDetail(code);
      }),
    ),
    chartBody,
  );

  // Referrers + QR side column
  const refList = h('ul', { class: 'reflist' });
  if (stats.topReferrers.length === 0) {
    refList.append(h('li', {}, h('span', { class: 'ref' }, 'No clicks in this range yet.')));
  }
  for (const r of stats.topReferrers) {
    refList.append(h('li', {},
      h('span', { class: 'ref', title: r.referrer }, r.referrer),
      h('span', { class: 'n' }, r.clicks.toLocaleString()),
    ));
  }
  const refCard = h('div', { class: 'card side-card' }, h('h3', {}, `Referrers · last ${stats.days}d`), refList);

  const qrWrap = h('div', { class: 'qr-wrap' });
  const qrImg = h('img', { src: `/api/links/${encodeURIComponent(code)}/qr`, alt: `QR code for ${linkData.shortUrl}` });
  const qrDownload = h('a', {
    href: `/api/links/${encodeURIComponent(code)}/qr`,
    download: `${code}-qr.svg`,
    class: 'btn small',
    style: 'margin-top:10px;display:inline-block;',
  }, 'Download SVG');
  qrWrap.append(qrImg, h('div', {}, qrDownload));
  const qrCard = h('div', { class: 'card side-card' }, h('h3', {}, 'QR code'), qrWrap);

  const deleteBtn = h('button', { class: 'btn danger' }, 'Delete link');
  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete ${domain}/${code}? The short link will stop working and its stats will be removed.`)) return;
    await api.deleteLink(code);
    toast('Link deleted');
    navigate('/dashboard');
  });

  shell('links',
    head,
    tiles,
    h('div', { class: 'two-col' },
      h('div', {}, chartCard),
      h('div', {}, refCard, h('div', { style: 'height:12px' }), qrCard),
    ),
    h('div', { class: 'danger-zone' }, deleteBtn),
  );
  renderClicksChart(chartBody, stats.clicksByDay);
  addEventListener('resize', onResizeOnce(chartBody, () => renderClicksChart(chartBody, stats.clicksByDay)));
}

// --- API keys view ----------------------------------------------------------------------

async function renderKeys(): Promise<void> {
  const keys = await api.keys();

  const nameInput = h('input', { class: 'input', type: 'text', placeholder: 'Key name (e.g. "CI pipeline")' });
  const createBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Create key');
  const form = h('form', { class: 'createbar' }, h('div', { class: 'grow' }, nameInput), createBtn);
  const createCard = h('div', { class: 'card' }, form);

  const listCard = h('div', { class: 'card table-card' });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!nameInput.value.trim()) return;
    createBtn.setAttribute('disabled', 'true');
    try {
      const created = await api.createKey(nameInput.value.trim());
      document.querySelector('.key-new')?.remove();
      const copyBtn = h('button', { class: 'btn small' }, 'Copy');
      copyBtn.addEventListener('click', () => copyText(created.key, copyBtn));
      const banner = h('div', { class: 'key-new' },
        h('code', {}, created.key),
        copyBtn,
        h('span', { class: 'warn' }, 'Copy this key now — it is shown only once and stored hashed.'),
      );
      createCard.after(banner);
      nameInput.value = '';
      listCard.replaceChildren(await buildKeysTable());
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create the key.');
    } finally {
      createBtn.removeAttribute('disabled');
    }
  });

  async function buildKeysTable(): Promise<HTMLElement> {
    const res = await api.keys();
    if (res.items.length === 0) {
      return h('div', { class: 'empty' }, 'No API keys yet', h('div', { class: 'hint' }, 'Create a key to use the API. Full reference at /docs.'));
    }
    const tbody = h('tbody', {});
    for (const k of res.items) {
      const revoke = h('button', { class: 'btn small danger' }, 'Revoke');
      revoke.addEventListener('click', async () => {
        if (!confirm(`Revoke "${k.name}"? Requests using this key will stop working immediately.`)) return;
        await api.deleteKey(k.id);
        toast('Key revoked');
        listCard.replaceChildren(await buildKeysTable());
      });
      tbody.append(h('tr', {},
        h('td', {}, k.name),
        h('td', {}, h('span', { class: 'keyprefix' }, `${k.prefix}…`)),
        h('td', { class: 'num hide-sm' }, relTime(k.createdAt)),
        h('td', { class: 'num hide-sm' }, k.lastUsedAt ? relTime(k.lastUsedAt) : 'never'),
        h('td', { class: 'num' }, revoke),
      ));
    }
    return h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, 'Name'), h('th', {}, 'Key'), h('th', { class: 'num hide-sm' }, 'Created'),
        h('th', { class: 'num hide-sm' }, 'Last used'), h('th', { class: 'num' }, ''),
      )),
      tbody,
    );
  }

  shell('keys',
    h('h1', { class: 'page-title' }, 'API keys'),
    h('p', { class: 'page-sub' }, 'Keys authenticate API requests as a Bearer token. Docs live at ',
      h('a', { href: '/docs', target: '_blank', rel: 'noopener' }, `${domain}/docs`), '.'),
    createCard,
    h('div', { style: 'height:16px' }),
    listCard,
  );
  listCard.append(await buildKeysTable());
  void keys;
}

// --- Router --------------------------------------------------------------------------------

async function route(): Promise<void> {
  const path = location.pathname;
  if (path === '/login') {
    renderLogin();
    return;
  }
  try {
    const me = await api.me();
    domain = me.domain;
    appUrl = me.appUrl;
    document.title = `${me.domain}/`;
  } catch {
    return; // api.me redirects to /login on 401
  }

  const detail = path.match(/^\/dashboard\/links\/([^/]+)$/);
  if (detail) return renderLinkDetail(decodeURIComponent(detail[1]));
  if (path === '/dashboard/keys') return renderKeys();
  return renderDashboard();
}

addEventListener('popstate', route);
route();

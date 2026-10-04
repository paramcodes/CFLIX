import { api, ses } from '../core.js';

function tintVars(id) {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const hue = (h >>> 0) % 360;
  return `--tint-a:${hue};--tint-b:${(hue + 47) % 360}`;
}

function paint(pic, id, index, tintClass) {
  if (index <= 0) return;
  pic.classList.add(tintClass);
  pic.setAttribute('style', tintVars(id));
}

function divider() {
  const d = document.createElement('div');
  d.className = 'nav__menu-divider';
  d.setAttribute('role', 'separator');
  return d;
}

function menuItem(name, { id, index, blank, current } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'nav__menu-item';
  b.setAttribute('role', 'menuitem');
  b.tabIndex = -1;
  if (id) b.dataset.id = id;
  if (current) b.setAttribute('aria-current', 'true');
  const pic = document.createElement('span');
  pic.className = `nav__menu-pic${blank ? ' nav__menu-pic--blank' : ''}`;
  if (id) paint(pic, id, index, 'nav__menu-pic--tint');
  const label = document.createElement('span');
  label.textContent = name;
  b.append(pic, label);
  return b;
}

function init(navEl) {
  const logo = navEl.querySelector('.nav__logo');
  const tools = navEl.querySelector('.nav__tools');
  const avatarBtn = navEl.querySelector('.nav__avatar');
  const avatarPic = navEl.querySelector('.nav__avatar-pic');
  const menu = navEl.querySelector('.nav__menu');
  if (!tools || !avatarBtn || !avatarPic || !menu) return;

  let open = false;
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')];
  const focusItem = (i) => items()[i]?.focus();

  async function openMenu(focusLast = false) {
    open = true;
    menu.hidden = false;
    avatarBtn.setAttribute('aria-expanded', 'true');
    try {
      await refresh();
    } catch {
      closeMenu(true);
      tools.hidden = true;
      return;
    }
    focusItem(focusLast ? items().length - 1 : 0);
  }

  function closeMenu(refocus) {
    open = false;
    menu.hidden = true;
    avatarBtn.setAttribute('aria-expanded', 'false');
    if (refocus) avatarBtn.focus();
  }

  async function refresh() {
    const { items: profiles } = await api('/api/profiles');
    tools.hidden = false;
    const current = ses.profile;
    const index = current ? profiles.findIndex((p) => p.id === current.id) : -1;
    paint(avatarPic, current?.id ?? '', index, 'nav__avatar-pic--tint');
    avatarBtn.setAttribute(
      'aria-label',
      current
        ? `Profile menu for ${current.name}`
        : 'Profile menu, no profile selected',
    );
    menu.replaceChildren();
    for (const [i, p] of profiles.entries()) {
      const item = menuItem(p.name, {
        id: p.id,
        index: i,
        current: p.id === current?.id,
      });
      item.onclick = () => {
        ses.profile = { id: p.id, name: p.name };
        location.href = '/home';
      };
      menu.append(item);
    }
    menu.append(divider());
    const manage = menuItem('Manage profiles', { blank: true });
    manage.onclick = () => {
      location.href = '/profiles';
    };
    menu.append(manage);
    menu.append(divider());
    const out = menuItem('Sign out', { blank: true });
    out.onclick = signOut;
    menu.append(out);
  }

  avatarBtn.onclick = () => (open ? closeMenu(true) : openMenu());
  avatarBtn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openMenu();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu(true);
    }
  });
  menu.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem((i + 1) % list.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem((i - 1 + list.length) % list.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(list.length - 1);
    } else if (e.key === 'Tab') {
      closeMenu(false);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) closeMenu(true);
  });
  document.addEventListener('click', (e) => {
    if (open && !navEl.contains(e.target)) closeMenu(false);
  });

  if (logo) logo.setAttribute('href', ses.token ? '/home' : '/');

  if (!ses.token) {
    tools.hidden = true;
    return;
  }

  refresh().catch(() => {
    tools.hidden = true;
  });
}

async function signOut() {
  try {
    await api('/api/auth/signout', { method: 'POST' });
  } catch {}
  ses.token = null;
  ses.profile = null;
  location.href = '/signin';
}

const navEl = document.querySelector('.nav');
if (navEl) init(navEl);

import { api, ses } from '../core.js';

export default async function profiles() {
  const list = document.querySelector('#profile-list');
  const avatarStyle = (id) => {
    let h = 2166136261;
    for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const hue = (h >>> 0) % 360;
    return `--tint-a:${hue};--tint-b:${(hue + 47) % 360}`;
  };
  async function load() {
    const { items } = await api('/api/profiles');
    list.innerHTML =
      items
        .map(
          (p, i) =>
            `<button class="avatar-tile" data-id="${p.id}" data-name="${p.name}">
           <span class="avatar-tile__pic${i === 0 ? '' : ' avatar-tile__pic--tint'}" style="${i === 0 ? '' : avatarStyle(p.id)}"></span>
           <span>${p.name} · ${p.maturity}</span>
         </button>`,
        )
        .join('') +
      `<button class="avatar-tile" id="add-profile"><span class="avatar-tile__pic avatar-tile__pic--add">+</span><span>Add</span></button>`;
    for (const b of list.querySelectorAll('.avatar-tile[data-id]')) {
      b.onclick = () => {
        ses.profile = { id: b.dataset.id, name: b.dataset.name };
        location.href = '/home';
      };
    }
    document.querySelector('#add-profile').onclick = () => openAddDialog();
  }
  const backdrop = document.querySelector('#dlg-add');
  const nameEl = document.querySelector('#dlg-name');
  const errEl = document.querySelector('#dlg-error');
  const seg = document.querySelector('#dlg-maturity');
  let maturity = 'adult';
  for (const b of seg.querySelectorAll('button')) {
    b.onclick = () => {
      maturity = b.dataset.m;
      for (const x of seg.querySelectorAll('button'))
        x.classList.toggle('is-active', x === b);
    };
  }
  function openAddDialog() {
    nameEl.value = '';
    errEl.textContent = '';
    maturity = 'adult';
    for (const x of seg.querySelectorAll('button'))
      x.classList.toggle('is-active', x.dataset.m === 'adult');
    backdrop.hidden = false;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => backdrop.classList.add('is-open')),
    );
    nameEl.focus();
  }
  function closeAddDialog() {
    backdrop.classList.remove('is-open');
    setTimeout(() => {
      backdrop.hidden = true;
    }, 200);
  }
  document.querySelector('#dlg-cancel').onclick = closeAddDialog;
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeAddDialog();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !backdrop.hidden) closeAddDialog();
  });
  document.querySelector('#dlg-create').onclick = async () => {
    const name = nameEl.value.trim();
    if (!name) {
      errEl.textContent = 'Name is required.';
      nameEl.focus();
      return;
    }
    try {
      await api('/api/profiles', {
        method: 'POST',
        body: { name, maturity },
      });
      closeAddDialog();
      load();
    } catch (e) {
      errEl.textContent = e.message;
    }
  };
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.querySelector('#dlg-create').click();
  });
  load().catch(() => {
    location.href = '/signin';
  });
}

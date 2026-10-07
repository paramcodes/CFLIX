import { api, ses } from '../core.js';

export default async function signin() {
  const emailEl = document.querySelector('#in-email');
  const pwEl = document.querySelector('#in-password');
  const errEl = document.querySelector('#in-error');
  const btn = document.querySelector('#btn-signin');
  const become = document.querySelector('#btn-signup');
  btn.onclick = async () => {
    try {
      const { user, session } = await api('/api/auth/signin', {
        method: 'POST',
        auth: false,
        body: { email: emailEl.value, password: pwEl.value },
      });
      ses.token = session.token;
      ses.profile = null;
      location.href = '/profiles';
    } catch (e) {
      errEl.textContent = e.message;
    }
  };
  become.onclick = async () => {
    try {
      const { user, session } = await api('/api/auth/signup', {
        method: 'POST',
        auth: false,
        body: { email: emailEl.value, password: pwEl.value },
      });
      ses.token = session.token;
      ses.profile = null;
      location.href = '/profiles';
    } catch (e) {
      errEl.textContent = e.message;
    }
  };
}

const BASE = __BASE_JSON__;
const form = document.querySelector('form');
const input = document.querySelector('#password');
const status = document.querySelector('#status');
const button = form.querySelector('button');
let worker;
function message(data) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    let timer;
    const finish = (error, result) => {
      clearTimeout(timer);
      channel.port1.close();
      error ? reject(error) : resolve(result);
    };
    const armTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(Error('Unlock timed out. Reload and try again.')), 45000);
    };
    armTimer();
    channel.port1.onmessage = event => {
      if (event.data?.progress) {
        armTimer();
        status.textContent = event.data.progress === 'download'
          ? `Downloading encrypted site… ${(event.data.bytes / (1024 * 1024)).toFixed(1)} MB`
          : 'Checking password…';
        return;
      }
      finish(null, event.data);
    };
    channel.port1.onmessageerror = () => finish(Error('Unable to unlock. Reload and try again.'));
    try {
      const active = navigator.serviceWorker.controller || worker;
      active.postMessage(data, [channel.port2]);
    } catch { finish(Error('Unable to unlock. Reload and try again.')); }
  });
}
try {
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !crypto.subtle) throw Error('Open this site over HTTPS (or localhost) in a browser with Service Worker support.');
  const registrations = await navigator.serviceWorker.getRegistrations();
  const conflicting = registrations.find(r => new URL(r.scope).pathname === BASE && ![r.active, r.waiting, r.installing].some(w => w && new URL(w.scriptURL).pathname === BASE + 'sw.js'));
  if (conflicting) throw Error('Another app controls this path. Use a dedicated site origin or remove its Service Worker first.');
  await navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE, type: 'module', updateViaCache: 'none' });
  const registration = await navigator.serviceWorker.ready;
  worker = registration.active;
  if (!navigator.serviceWorker.controller || navigator.serviceWorker.controller.scriptURL !== worker.scriptURL) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Reload to finish installing the unlock runtime.')), 10000);
      navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }
  worker = navigator.serviceWorker.controller;
  button.disabled = false;
  status.textContent = '';
} catch (error) { status.textContent = error.message; }
form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = 'Checking password…';
  input.removeAttribute('aria-invalid');
  const password = input.value;
  input.value = '';
  try {
    const result = await message({ type: 'unlock', password });
    if (!result.ok) {
      if (result.code === 'WRONG_PASSWORD') {
        input.setAttribute('aria-invalid', 'true');
        throw Error('Wrong password');
      }
      if (result.code === 'DOWNLOAD_TIMEOUT') throw Error('Download timed out. Check your connection and try again.');
      if (result.code === 'BUSY') throw Error('An unlock attempt is still running. Wait a moment and try again.');
      throw Error('Unable to unlock. Reload and try again.');
    }
    const target = location.pathname.startsWith(BASE + '_sealed/') ? BASE : location.pathname + location.search + location.hash;
    location.replace(target);
  } catch (error) { status.textContent = error.message; button.disabled = false; input.focus(); }
});
document.querySelector('#lock').addEventListener('click', async () => {
  if (!worker) return;
  await message({ type: 'lock' });
  location.replace(BASE + '_sealed/index.html');
});

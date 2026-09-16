// Trendora — PWA quraşdırma (Install) və Service Worker qeydiyyatı

// ---------- Service Worker qeydiyyatı ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker qeydiyyatı alınmadı:', err);
    });
  });
}

// ---------- "Ana ekrana əlavə et / Tətbiqi quraşdır" düyməsi ----------
let deferredInstallPrompt = null;
const installBtn = document.getElementById('pwa-install-btn');

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

// Chrome/Edge/Android: brauzer quraşdırma təklifini saxlayır və biz özümüz göstəririk
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installBtn && !isStandalone()) {
    installBtn.classList.remove('hidden');
  }
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    installBtn.classList.add('hidden');
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });
}

// Quraşdırıldıqdan sonra düyməni gizlət
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  if (installBtn) installBtn.classList.add('hidden');
});

// Artıq quraşdırılıbsa (standalone rejimdə açılıbsa) düyməni göstərmə
document.addEventListener('DOMContentLoaded', () => {
  if (isStandalone() && installBtn) installBtn.classList.add('hidden');
});

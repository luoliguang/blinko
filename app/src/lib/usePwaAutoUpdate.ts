import { useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import { ToastPlugin } from '@/store/module/Toast/Toast';

// Does the user have an unsaved draft right now? (create editor content, or any
// edit-mode draft). Drafts are persisted to localStorage and restored on load, so
// a reload wouldn't lose them — but we still avoid yanking the page out from under
// someone who's mid-writing.
const hasUnsavedDraft = (): boolean => {
  try {
    const blinko = RootStore.Get(BlinkoStore);
    if ((blinko.createContentStorage.value?.content ?? '').trim().length > 0) return true;
    if (blinko.editContentStorage.list?.some((i) => (i.content ?? '').trim().length > 0)) return true;
  } catch {
    // ignore
  }
  return false;
};

// PWA update handling. With registerType:'prompt', a new build installs but waits.
// When one is ready: if the user has a draft, show a dismissible "refresh" toast and
// let them apply it when ready; otherwise refresh seamlessly. Also re-checks for a
// new build whenever the app regains focus, so a long-open tab doesn't run stale code.
export const usePwaAutoUpdate = () => {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const updateSW = registerSW({
      onNeedRefresh() {
        if (hasUnsavedDraft()) {
          RootStore.Get(ToastPlugin).updateAvailable(() => updateSW(true));
        } else {
          updateSW(true);
        }
      },
    });

    // Ask the service worker to look for a new build when the app is reopened.
    const checkForUpdate = async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.update();
      } catch {
        // best-effort
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);
};

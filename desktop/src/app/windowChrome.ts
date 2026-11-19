// Windows uses its native title bar. The frameless builds provide controls
// and a drag region in the webview. In the browser the calls only move the
// page's own state.

import { inTauri } from '../host/transport';
import { setUi, uiStore } from './ui';

type TauriWindow = Awaited<ReturnType<typeof current>>;
const current = async () => (await import('@tauri-apps/api/window')).getCurrentWindow();
let win: Promise<TauriWindow> | null = null;
const w = () => (win ??= current());

export function usesNativeCaption() { return inTauri() && /\bWindows\b/.test(navigator.userAgent); }

export async function minimize() { if (inTauri()) await (await w()).minimize(); }
export async function toggleMaximize() {
  if (inTauri()) { const x = await w(); await x.toggleMaximize(); setUi({ maximized: await x.isMaximized() }); }
  else setUi({ maximized: !uiStore.getState().maximized });
}
export async function closeWindow() { if (inTauri()) await (await w()).close(); }
export async function setFullScreen(on: boolean) {
  setUi({ fullScreen: on });
  if (inTauri()) await (await w()).setFullscreen(on);
}
export const toggleFullScreen = () => setFullScreen(!uiStore.getState().fullScreen);
export async function setWindowTitle(title: string) {
  document.title = title;
  if (inTauri()) await (await w()).setTitle(title).catch(() => {});
}

/** Follow the window's size and maximised state (the layout rule reads them). */
export function watchWindow(): () => void {
  const onResize = () => setUi({ window: { width: window.innerWidth, height: window.innerHeight } });
  window.addEventListener('resize', onResize);
  onResize();
  let unlisten: (() => void) | null = null;
  if (inTauri()) {
    void w().then(async (x) => {
      setUi({ maximized: await x.isMaximized().catch(() => false) });
      unlisten = await x.onResized(async () => setUi({ maximized: await x.isMaximized().catch(() => false) }));
    }).catch(() => {});
  }
  return () => { window.removeEventListener('resize', onResize); unlisten?.(); };
}

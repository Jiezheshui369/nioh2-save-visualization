import { privateLightAllPreview, privateVisualPreview } from './privateVisualAssets';

type DesignScreen = 'character' | 'loadout' | 'equipment-warehouse' | 'item-warehouse' | 'equipment-detail' | 'scroll-warehouse' | 'scroll-detail' | 'filters' | 'more' | 'settings' | 'data-source' | 'about' | 'build-library' | 'import';
declare global {
  interface Window {
    __niohDesignPreview?: { ready: boolean; screen?: DesignScreen; error?: string; navigate: (screen: DesignScreen) => Promise<void> };
  }
}

/** Private synthetic preview navigation only. It drives existing controls and
 * never reads storage, fetches data, seeds a profile, or imports an archive. */
export function installPrivateDesignPreview(): void {
  if (!import.meta.env.DEV || !privateVisualPreview || !privateLightAllPreview) return;
  const screens: DesignScreen[] = ['character', 'loadout', 'equipment-warehouse', 'item-warehouse', 'equipment-detail', 'scroll-warehouse', 'scroll-detail', 'filters', 'more', 'settings', 'data-source', 'about', 'build-library', 'import'];
  const until = async <T,>(find: () => T | null | false): Promise<T> => {
    for (let i = 0; i < 100; i++) { const value = find(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error('Private design preview control not ready');
  };
  const click = async (selector: string, text?: string, contains = false) => {
    const node = await until(() => [...document.querySelectorAll<HTMLButtonElement>(selector)].find(n => !n.disabled && (text === undefined || (contains ? n.textContent?.includes(text) : n.textContent?.trim() === text))) ?? null);
    node.click(); await new Promise(resolve => setTimeout(resolve, 100));
  };
  const nav = (text: string) => click('.nm-bottom-nav button', text);
  const moreHome = async () => {
    await nav('更多');
    if (document.querySelector('.nm-more-pages .nm-back')) await click('.nm-more-pages .nm-back');
  };
  const bridge = { ready: false, screen: undefined as DesignScreen | undefined, error: undefined as string | undefined, navigate: async (screen: DesignScreen) => {
    if (!screens.includes(screen)) throw new Error('Unknown private design screen');
    bridge.ready = false; bridge.error = undefined;
    await until(() => document.querySelector('.nm-shell.nm-light-all:not(.nd-shell)'));
    if (screen === 'import') {
      await until(() => document.querySelector('.nm-import-intro'));
    } else {
      await until(() => document.querySelector('.nm-light-all[data-synthetic-preview="1"]'));
      if (screen === 'character') await nav('角色');
      if (screen === 'loadout') await nav('配装');
      if (screen === 'equipment-detail') { await nav('配装'); await click('.nm-loadout-list .nm-equipment-row'); }
      if (['equipment-warehouse', 'item-warehouse', 'filters'].includes(screen)) {
        await nav('仓库');
        if (screen === 'item-warehouse') await click('.nm-warehouse [role=tab]', '物品');
        if (screen === 'filters') await click('.nm-filter-bar button');
      }
      if (screen === 'scroll-warehouse' || screen === 'scroll-detail') {
        await nav('配装'); await click('.nm-loadout-list button', '装备中的绘卷尚未识别', true);
        if (screen === 'scroll-detail') await click('.nm-warehouse-list .nm-equipment-row');
      }
      if (['more', 'settings', 'data-source', 'about'].includes(screen)) {
        await moreHome();
        const labels = { settings: '档案管理与设置', 'data-source': '数据来源说明', about: '关于存档资产' };
        if (screen !== 'more') await click('.nm-more-menu button', labels[screen as keyof typeof labels], true);
      }
      if (screen === 'build-library') { await nav('配装'); await click('.nm-loadout-list button', '我的配装册'); }
    }
    document.querySelector('.nm-scroll')?.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    bridge.screen = screen; bridge.ready = true;
    document.documentElement.dataset.niohDesignScreen = screen;
  } };
  window.__niohDesignPreview = bridge;
  const requested = new URLSearchParams(window.location.search).get('screen');
  if (requested && screens.includes(requested as DesignScreen)) {
    void bridge.navigate(requested as DesignScreen).catch(error => { bridge.error = String(error); });
  }
}

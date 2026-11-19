import { useLayoutEffect, useRef } from 'react';
import { desktopMenuEntries } from './desktopNavigation';
import type { DesktopMenuId, DesktopPage } from './desktopNavigation';
import { titleDesignAsset as asset, titleDesignManifest } from './titleDesignAssets';
const variables = ['img','img1','img2','img3','img4','img5','img5','img6','img7','img8'];
const labels = ['menu-imgG1NN000','menu-imgG1NN001','menu-imgG1NN002','menu-imgG1NN003','menu-imgG1NN004','menu-imgAlpha1','menu-imgG1NN005','menu-imgG1NN006','menu-imgG1NN007','menu-imgG1NN008'] as const;
function MenuGlyph({id}:{id:keyof typeof titleDesignManifest}) {
  const m=titleDesignManifest[id];
  return <img src={asset(id)} width={m.width} height={m.height} alt="" style={{transform:'scale(var(--df-scale))',transformOrigin:'top left'}}/>;
}
export function DesktopMenu({ open, page, onClose, onNavigate }: {
  open: boolean; page: DesktopPage; onClose: () => void; onNavigate: (page: DesktopMenuId) => void;
}) {
  const dialog = useRef<HTMLDivElement>(null), restore = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    restore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = dialog.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? dialog.current?.querySelector<HTMLElement>('button');
    target?.focus();
    return () => { if (restore.current?.isConnected) queueMicrotask(() => restore.current?.focus({ preventScroll: true })); };
  }, [open]);
  if (!open) return null;
  const active = page === 'home' ? 'settings' : page;
  return <div ref={dialog} className="df-menu" role="dialog" aria-modal="true" aria-label="呼出菜单" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault();
      buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  }}>
    <div className="df-menu-art" aria-hidden="true">
      <img className="df-menu-moon" src={asset('menu-img135217')} alt="" />
      <img className="df-menu-ink" src={asset('menu-img135215')} alt="" />
      <img className="df-menu-brush" src={asset('menu-img135218')} alt="" />
    </div>
    <nav className="df-menu-row" aria-label="桌面模块">
      {desktopMenuEntries.map((entry,index) => <button key={entry.id} className="df-menu-item"
        aria-label={entry.label} aria-current={active === entry.id ? 'page' : undefined} onClick={() => onNavigate(entry.id)}>
        <span className="df-menu-image" aria-hidden="true">
          <img style={entry.id==='preparation'||entry.id==='underworld'?{opacity:.55,filter:'grayscale(1)'}:undefined} src={asset(entry.id==='preparation'||entry.id==='underworld'?'diamond-raw':('menu-'+variables[index]) as keyof typeof titleDesignManifest)} alt="" />
          {entry.id === 'preparation' || entry.id === 'underworld' ? <span className="df-menu-native-symbol"><MenuGlyph id={entry.id==='preparation'?'menu-imgAlpha0':'menu-imgG1NN038'}/></span> : null}
          {active === entry.id ? <img data-menu-highlight className="df-menu-highlight" src={asset('highlight-img')} alt="" /> : null}
        </span>
        <span className="df-menu-label df-menu-native-label"><MenuGlyph id={labels[index]}/></span>
      </button>)}
    </nav>
    <button className="df-menu-close df-menu-native-close" aria-label="关闭菜单" onClick={onClose}><MenuGlyph id="menuClose-imgG1NN010"/></button>
  </div>;
}

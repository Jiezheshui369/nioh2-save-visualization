declare module 'virtual:nioh-private-visual-assets' {
  const assets: { privatePreview: boolean; bundledUi?: boolean; gameFrames: boolean; roleLight?: boolean; lightAll?: boolean; presentation: 'classic' | 'color-scenes'; images: Record<string, string> } | null;
  export default assets;
}

declare module 'virtual:nioh-bundled-font' {
 const font: import('./GameBitmapText').PrivateBitmapFont | null;
 export default font;
}

declare module 'virtual:nioh-app-font' { const font: import('./AllGameTypography').AppGameFont | null; export default font; }

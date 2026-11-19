import { AllGameTypography } from './AllGameTypography';
import appFont from 'virtual:nioh-app-font';
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { isNativeApp } from "./runtime";
import { privateVisualPreview, bundledPrivateUi, privateMobilePresentation } from './privateVisualAssets';
import bundledFont from 'virtual:nioh-bundled-font';
import { BundledBitmapFontProvider } from './GameBitmapText';
import "./styles.css";
import "./mobileColor.css";
import "./mobileGameFrames.css";
import "./mobileRoleLight.css";
import "./mobileLightAll.css";
import "./saveAssetTheme.css";
import "./desktopMobileSync.css";
import "./bundledBitmapUi.css";
import "./desktopReadable.css";
import "./desktopResponsive.css";
import { installPrivateDesignPreview } from './privateDesignPreview';

if (bundledPrivateUi) document.documentElement.classList.add('gb-bundled-ui');

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BundledBitmapFontProvider font={bundledFont}><AllGameTypography font={isNativeApp() || privateMobilePresentation() ? appFont : null}/><App /></BundledBitmapFontProvider>
  </StrictMode>,
);

installPrivateDesignPreview();

if (import.meta.env.MODE !== "android" && !isNativeApp() && !privateVisualPreview && "serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}

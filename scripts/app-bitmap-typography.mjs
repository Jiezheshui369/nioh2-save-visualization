import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const ID='virtual:nioh-app-font',RESOLVED='\0'+ID;
export function appBitmapTypographyPlugin(mode,root){
 const enabled=process.env.SAVE_ASSET_PRIVATE_UI_BUNDLE==='1'&&['android','windows-portable'].includes(mode);
 return {name:'save-asset-original-app-typography',resolveId(id){return id===ID?RESOLVED:undefined;},load(id){
  if(id!==RESOLVED)return;if(!enabled)return 'export default null;';
  const base=path.join(root,'.local/g1n-app-font-20261020'),atlas=path.join(base,'nioh-g1n-app-minimal.png'),metrics=path.join(base,'nioh-g1n-app-minimal.json'),native=path.join(base,'g1n-native-pixel.woff');
  const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
  const atlasHash=digest(atlas),metricsHash=digest(metrics);
  if(atlasHash!=='4e304a05ee349e8740f403c313ac26ca487a3e50e6fa86e11b7ff1571b068a00'||metricsHash!=='1cf9b994aa0a2c3467191d37b7f03c4dd42ea6270a9bc2d5dbafd1625c38d27c')throw new Error('Original1672 G1N atlas/metrics mismatch');
  const d=JSON.parse(readFileSync(metrics,'utf8'));if(Object.keys(d.glyphs).length!==1672||d.runtimeBindingProven!==false)throw new Error('Unexpected font coverage or unproven binding claim');
  const font={source:d.source,runtimeBindingProven:false,glyphs:d.glyphs,atlasSha256:atlasHash,metricsSha256:metricsHash};
  return 'import atlas from '+JSON.stringify(atlas.replaceAll('\\','/'))+';import native from '+JSON.stringify(native.replaceAll('\\','/'))+';export default {...'+JSON.stringify(font)+',atlasUrl:atlas,nativeFontUrl:native};';
 }};
}

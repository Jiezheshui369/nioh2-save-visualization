import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const ID='virtual:nioh-bundled-font', RESOLVED='\0'+ID;
export function bundledBitmapFontPlugin(mode,root){
 const enabled=process.env.SAVE_ASSET_PRIVATE_UI_BUNDLE==='1'&&['android','windows-portable'].includes(mode);
 return {name:'save-asset-checked-bitmap-subset',resolveId(id){return id===ID?RESOLVED:undefined},load(id){
  if(id!==RESOLVED)return;
  if(!enabled)return 'export default null;';
  const base=path.join(root,'.local/bitmap-font-review-20261018');
  const atlas=path.join(base,'glyphs-private.png');
  if(createHash('sha256').update(readFileSync(atlas)).digest('hex')!=='1a4137934e3a7bf40e6669d57308862f8b39de50265c0cac552ecbf26a06e40a')throw new Error('Authorized glyph subset hash differs');
  const original=JSON.parse(readFileSync(path.join(base,'font-private.json'),'utf8'));
  if(Object.keys(original.glyphs).length!==428||original.nominalBitmapHeight!==40)throw new Error('Expected audited428 glyph subset');
  const font={source:'Nioh2 G1N entry6/table0 audited428-glyph subset',runtimeBindingProven:false,nominalBitmapHeight:40,ascent:original.ascent,descent:original.descent,glyphs:original.glyphs};
  return 'import atlas from '+JSON.stringify(atlas.replaceAll('\\','/'))+';\nexport default {...'+JSON.stringify(font)+',atlasUrl:atlas};';
 }};
}

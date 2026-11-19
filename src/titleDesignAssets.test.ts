import { describe,expect,it } from 'vitest';
import textIndex from './titleTextIndex.json';
import { titleNativeFont,titleDesignAsset,titleDesignManifest } from './titleDesignAssets';
describe('verified local Figma title resources',()=>{
  it('maps every downloaded independent asset to a local nonempty URL',()=>{
    for(const [key,m] of Object.entries(titleDesignManifest)){
      expect(m.bytes).toBeGreaterThan(0);expect(m.width).toBeGreaterThan(0);expect(m.height).toBeGreaterThan(0);
      expect(titleDesignAsset(key as keyof typeof titleDesignManifest)).not.toMatch(/figma\.com/);
    }
  });
  it('covers all 390 native names and conditions without font fallback',()=>{
    const glyphs=titleNativeFont.glyphs as Record<string,unknown>;
    for(const t of Object.values(textIndex.locales['zh-CN']))for(const c of t.name+t.condition){
      if(!c.trim())continue;expect(glyphs[String(c.codePointAt(0))],c).toBeDefined();
    }
    expect(titleNativeFont.glyphCount).toBeGreaterThanOrEqual(607);
  });
});

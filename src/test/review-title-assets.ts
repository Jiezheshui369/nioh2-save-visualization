// Test adapter only. Menu behavior uses the real DesktopMenu; image data is synthetic.
export const titleDesignManifest=new Proxy<Record<string,{width:number;height:number;file:string}>>({}, {get:()=>({width:1,height:1,file:'synthetic'})});
export const titleDesignAsset=(key:string)=>'/synthetic-review-only/'+key;

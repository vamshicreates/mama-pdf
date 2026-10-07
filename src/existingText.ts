import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Mark, PageInfo, Point, TextSource } from './types';
export type ExistingText = Pick<Mark, 'x'|'y'|'width'|'height'|'text'|'fontSize'|'font'|'bold'|'angle'> & { source: TextSource; polygon: Point[] };
export async function readExistingText(pdf: PDFDocumentProxy, page: PageInfo): Promise<ExistingText[]> {
  if (page.source === null) return [];
  const source = await pdf.getPage(page.source + 1);
  const content = await source.getTextContent();
  const viewport = source.getViewport({ scale: 1, rotation: page.originalRotation });
  return content.items.flatMap((item, index) => {
    if (!('str' in item) || !item.str.trim() || item.width <= 0) return [];
    const [a,b,c,d,e,f] = item.transform;
    const baseline = viewport.convertToViewportPoint(e,f);
    const up = viewport.convertToViewportPoint(e+c,f+d);
    const advance = viewport.convertToViewportPoint(e+a,f+b);
    const size = Math.hypot(up[0]-baseline[0],up[1]-baseline[1]);
    const angle = Math.atan2(advance[1]-baseline[1],advance[0]-baseline[0]);
    if (!size || content.styles[item.fontName]?.vertical) return [];
    const style = content.styles[item.fontName];
    const ascent = style?.ascent ?? .85, descent = style?.descent ?? -.2;
    const width = item.width * (page.userUnit || 1);
    const point = (x:number, y:number):Point => ({ x:baseline[0]+Math.cos(angle)*x-Math.sin(angle)*y, y:baseline[1]+Math.sin(angle)*x+Math.cos(angle)*y });
    const polygon = [point(0,-size*ascent),point(width,-size*ascent),point(width,-size*descent),point(0,-size*descent)];
    // PDFium quads are upper-left, upper-right, lower-left, lower-right in PDF user space.
    const quad = [polygon[0],polygon[1],polygon[3],polygon[2]].flatMap(p => viewport.convertToPdfPoint(p.x,p.y));
    const top = point(0,-size*.85);
    const family = style?.fontFamily || '';
    return [{...top,width,height:size*1.25,text:item.str,fontSize:size,font:/mono/i.test(family)?'mono' as const:/^serif$|times/i.test(family)?'serif' as const:'sans' as const,bold:/bold|black|heavy/i.test(family),angle:angle*180/Math.PI,polygon,source:{id:`${page.source}:${index}`,page:page.source!,quad}}];
  });
}

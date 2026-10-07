import { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFString, PDFArray, PDFCheckBox, PDFTextField, PDFDropdown, PDFOptionList, PDFRadioGroup } from 'pdf-lib';
import type { EditorState, PageInfo, Point } from './types';
import { normalizeRotation, safeUrl } from './types';
export { safeUrl } from './types';
import { removeOriginalText, textSources } from './textEditing';
import signatureFontUrl from '@fontsource/caveat/files/caveat-latin-500-normal.woff?url';

const color = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
// Editor coordinates are measured in PDF points, top-left of the original visible page.
export function toPdfPoint(point: Point, page: PageInfo): Point {
  const { x, y } = point;
  const unit = page.userUnit || 1;
  let result: Point;
  switch (normalizeRotation(page.originalRotation)) {
    case 90: result = { x: y, y: x }; break;
    case 180: result = { x: page.width - x, y }; break;
    case 270: result = { x: page.height - y, y: page.width - x }; break;
    default: result = { x, y: page.height - y };
  }
  return { x: result.x / unit + (page.originX || 0), y: result.y / unit + (page.originY || 0) };
}
export async function exportPdf(bytes: Uint8Array, state: EditorState): Promise<Uint8Array> {
  // Reorder the original document in place to retain its AcroForm and document resources.
  const doc = await PDFDocument.load((await removeOriginalText(bytes, textSources(state))).slice());
  const originals = doc.getPages();
  const form = doc.getForm();
  const removedRefs = new Set(originals.filter((_, index) => !state.pages.some(p => p.source === index)).map(p => p.ref.toString()));
  // Remove widgets belonging to discarded pages while preserving shared fields on retained pages.
  for (const field of form.getFields()) {
    const widgets = field.acroField.getWidgets();
    const discarded = widgets.map((widget, index) => ({ widget, index })).filter(({ widget }) => {
      const ref = widget.P();
      if (ref) return removedRefs.has(ref.toString());
      const owner = originals.find(p => p.node.Annots()?.asArray().some(a => doc.context.lookup(a) === widget.dict));
      return owner ? removedRefs.has(owner.ref.toString()) : false;
    });
    if (widgets.length && discarded.length === widgets.length) form.removeField(field);
    else for (const { index } of discarded.reverse()) field.acroField.removeWidget(index);
  }
  for (const field of form.getFields()) {
    const value = state.fields[field.getName()];
    if (value === undefined) continue;
    if (field instanceof PDFTextField) field.setText(String(value));
    else if (field instanceof PDFCheckBox) value ? field.check() : field.uncheck();
    else if (field instanceof PDFDropdown || field instanceof PDFOptionList) field.select(Array.isArray(value) ? value : String(value));
    else if (field instanceof PDFRadioGroup) field.select(String(value));
  }
  if (Object.keys(state.fields).length) form.updateFieldAppearances();
  const fonts = {
    sans: await doc.embedFont(StandardFonts.Helvetica), sansBold: await doc.embedFont(StandardFonts.HelveticaBold),
    serif: await doc.embedFont(StandardFonts.TimesRoman), serifBold: await doc.embedFont(StandardFonts.TimesRomanBold),
    mono: await doc.embedFont(StandardFonts.Courier), monoBold: await doc.embedFont(StandardFonts.CourierBold),
  };
  let signatureFont;
  if (state.marks.some(m => m.font === 'signature')) {
    const { default: fontkit } = await import('@pdf-lib/fontkit');
    doc.registerFontkit(fontkit);
    signatureFont = await doc.embedFont(await (await fetch(signatureFontUrl)).arrayBuffer(), { subset: true });
  }
  for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
  for (const info of state.pages) {
    const page = info.source === null ? doc.addPage([info.width, info.height]) : doc.addPage(originals[info.source]);
    const map = (x: number, y: number) => toPdfPoint({ x, y }, info);
    const rotation = degrees(info.originalRotation);
    const unit = info.userUnit || 1;
    const marks = state.marks.filter(m => m.pageId === info.id);
    for (const mark of marks) {
      const c = color(mark.color);
      if (mark.kind === 'text') {
        const family = mark.font === 'signature' ? 'sans' : mark.font || 'sans';
        const font = mark.font === 'signature' ? signatureFont! : fonts[`${family}${mark.bold ? 'Bold' : ''}`];
        const size = mark.fontSize || 18;
        for (const [i, line] of (mark.text || '').split('\n').entries()) {
          try {
            page.drawText(line, { ...map(mark.x - Math.sin((mark.angle || 0) * Math.PI / 180) * (size * .85 + i * size * 1.25), mark.y + Math.cos((mark.angle || 0) * Math.PI / 180) * (size * .85 + i * size * 1.25)), font, size: size / unit, color: c, rotate: degrees(info.originalRotation - (mark.angle || 0)), opacity: mark.opacity });
          } catch { throw new Error('A text character is not supported by the selected PDF font. Use Latin characters, or add a handwritten signature/image for other scripts.'); }
        }
      } else if (mark.kind === 'image' && mark.src) {
        const data = await (await fetch(mark.src)).arrayBuffer();
        const image = await doc.embedPng(data);
        page.drawImage(image, { ...map(mark.x, mark.y + mark.height), width: mark.width / unit, height: mark.height / unit, rotate: rotation, opacity: mark.opacity });
      } else if (mark.kind === 'line' || mark.kind === 'arrow') {
        const points = mark.points || [{ x: 0, y: 0 }, { x: mark.width, y: mark.height }];
        const a = points[0], b = points[points.length - 1];
        page.drawLine({ start: map(mark.x + a.x, mark.y + a.y), end: map(mark.x + b.x, mark.y + b.y), thickness: mark.stroke / unit, color: c, opacity: mark.opacity });
        if (mark.kind === 'arrow') {
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          for (const offset of [-.5, .5]) page.drawLine({ start: map(mark.x + b.x, mark.y + b.y), end: map(mark.x + b.x - 12 * Math.cos(angle + offset), mark.y + b.y - 12 * Math.sin(angle + offset)), thickness: mark.stroke / unit, color: c, opacity: mark.opacity });
        }
      } else if (mark.kind === 'pen') {
        const points = mark.points || [];
        for (let i = 1; i < points.length; i++) page.drawLine({ start: map(mark.x + points[i-1].x, mark.y + points[i-1].y), end: map(mark.x + points[i].x, mark.y + points[i].y), thickness: mark.stroke / unit, color: c, opacity: mark.opacity });
      } else if (mark.kind === 'ellipse') {
        const swapped = info.originalRotation % 180 !== 0;
        page.drawEllipse({ ...map(mark.x + mark.width / 2, mark.y + mark.height / 2), xScale: (swapped ? mark.height : mark.width) / (2 * unit), yScale: (swapped ? mark.width : mark.height) / (2 * unit), borderColor: c, borderWidth: mark.stroke / unit, color: mark.filled ? c : undefined, opacity: mark.opacity, borderOpacity: mark.opacity });
      } else if (mark.kind === 'link') {
        const uri = safeUrl(mark.url || '');
        if (!uri) throw new Error('A link needs a valid https://, http:// or mailto: address.');
        const a = map(mark.x, mark.y), b = map(mark.x + mark.width, mark.y + mark.height);
        const annotation = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [Math.min(a.x,b.x), Math.min(a.y,b.y), Math.max(a.x,b.x), Math.max(a.y,b.y)], Border: [0,0,0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri) } }));
        let annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
        if (!annots) { annots = doc.context.obj([]); page.node.set(PDFName.of('Annots'), annots); }
        annots.push(annotation);
      } else {
        const filled = mark.kind === 'whiteout' || mark.kind === 'highlight' || mark.filled;
        page.drawRectangle({ ...map(mark.x, mark.y + mark.height), width: mark.width / unit, height: mark.height / unit, rotate: rotation, color: filled ? c : undefined, borderColor: filled ? undefined : c, borderWidth: filled ? 0 : mark.stroke / unit, opacity: mark.opacity, borderOpacity: mark.opacity });
      }
    }
    page.setRotation(degrees(normalizeRotation(info.originalRotation + info.rotation)));
  }
  doc.setProducer('Mama PDF');
  return doc.save();
}
export async function createSample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const coral = rgb(.929,.396,.361), dark = rgb(.14,.14,.13), gray = rgb(.46,.46,.44);
  const p = doc.addPage([595, 842]);
  p.drawRectangle({ x:0,y:790,width:595,height:52,color:dark });
  p.drawText('MAMA / CREATIVE STUDIO', {x:42,y:810,size:11,font:bold,color:rgb(1,1,1)});
  p.drawText('PROJECT BRIEF', {x:42,y:736,size:10,font:bold,color:coral});
  p.drawText('Make something', {x:42,y:678,size:38,font:bold,color:dark});
  p.drawText('worth keeping.', {x:42,y:631,size:38,font:bold,color:dark});
  p.drawText('A small idea. A little attention. A beautiful result.', {x:42,y:590,size:13,font:regular,color:gray});
  p.drawLine({start:{x:42,y:558},end:{x:553,y:558},thickness:1,color:rgb(.85,.85,.83)});
  const sections = [ ['01   THE IDEA', 'Create a short film about the people behind the work.', 'Honest conversations, thoughtful details, and a story that stays.'], ['02   THE APPROACH', 'Start with a conversation. Find the story. Make it feel human.', 'A two-minute film, a handful of portraits, and one clear message.'], ['03   THE DETAILS', 'Shoot date: 18 November     |     Location: Studio 03', 'Deliverables: One hero film + three social edits'] ];
  sections.forEach(([title,line1,line2],i)=>{const y=520-i*104;p.drawText(title,{x:42,y,size:10,font:bold,color:coral});p.drawText(line1,{x:42,y:y-28,size:11,font:regular,color:dark});p.drawText(line2,{x:42,y:y-47,size:11,font:regular,color:gray});});
  p.drawRectangle({x:42,y:128,width:511,height:68,color:rgb(.96,.95,.92)});
  p.drawText('YOUR TURN', {x:58,y:172,size:9,font:bold,color:gray});
  p.drawText('Add a note. Highlight a detail. Make this brief yours.',{x:58,y:149,size:11,font:regular,color:dark});
  p.drawText('Mama PDF / Sample document',{x:42,y:50,size:9,font:regular,color:gray});
  p.drawText('01',{x:539,y:50,size:9,font:bold,color:dark});
  const p2=doc.addPage([595,842]);
  p2.drawText('A few finishing touches.',{x:42,y:752,size:30,font:bold,color:dark});
  p2.drawText('Try the Forms tool to fill in these fields.',{x:42,y:710,size:12,font:regular,color:gray});
  const form=doc.getForm();
  p2.drawText('YOUR NAME',{x:42,y:646,size:10,font:bold,color:gray});
  const name=form.createTextField('Name');name.addToPage(p2,{x:42,y:590,width:360,height:36,borderWidth:1,borderColor:rgb(.8,.8,.78)});
  p2.drawText('PROJECT NOTES',{x:42,y:548,size:10,font:bold,color:gray});
  const notes=form.createTextField('Notes');notes.enableMultiline();notes.addToPage(p2,{x:42,y:420,width:511,height:105,borderWidth:1,borderColor:rgb(.8,.8,.78)});
  const cb=form.createCheckBox('Approved');cb.addToPage(p2,{x:42,y:367,width:16,height:16});
  p2.drawText('Ready to make it happen',{x:70,y:369,size:12,font:regular,color:dark});
  p2.drawText('Signature',{x:42,y:292,size:11,font:regular,color:gray});
  p2.drawLine({start:{x:42,y:214},end:{x:330,y:214},thickness:1,color:rgb(.8,.8,.78)});
  p2.drawText('Add your signature above using the Sign tool.',{x:42,y:190,size:10,font:regular,color:gray});
  p2.drawText('Mama PDF / Sample document',{x:42,y:50,size:9,font:regular,color:gray});
  p2.drawText('02',{x:539,y:50,size:9,font:bold,color:dark});
  return doc.save();
}
export async function createBlank() { const doc=await PDFDocument.create(); doc.addPage([595,842]); return doc.save(); }

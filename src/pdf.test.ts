import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { PDFDocument, degrees, PDFName, PDFNumber } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createSample, exportPdf, safeUrl, toPdfPoint } from './pdf';
import { rotatedToBase } from './types';
import type { EditorState, PageInfo, Mark } from './types';
const page:PageInfo={id:'one',source:0,width:595,height:842,originalRotation:0,rotation:0};
const mark:Mark={id:'text',pageId:'one',kind:'text',x:40,y:200,width:220,height:24,color:'#252322',stroke:2,opacity:1,text:'Added with Mama PDF',font:'sans',fontSize:18};
describe('PDF editing and export',()=>{
  it('keeps selectable text, form values, page order, and rotation after export',async()=>{
    const bytes=await createSample();
    const state:EditorState={pages:[{...page,id:'two',source:1,rotation:90},page],marks:[mark],fields:{Name:'Mama Studio',Notes:'A preserved form value',Approved:true}};
    const result=await exportPdf(bytes,state);
    const doc=await PDFDocument.load(result);
    expect(doc.getPageCount()).toBe(2);expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getForm().getTextField('Name').getText()).toBe('Mama Studio');
    expect(doc.getForm().getTextField('Notes').getText()).toBe('A preserved form value');
    expect(doc.getForm().getCheckBox('Approved').isChecked()).toBe(true);
    const parsed=await getDocument({standardFontDataUrl:resolve('node_modules/pdfjs-dist/standard_fonts')+'/',data:result.slice()}).promise;
    const text=await (await parsed.getPage(2)).getTextContent();
    expect(text.items.map(i=>'str'in i?i.str:'').join(' ')).toContain('Added with Mama PDF');
    await parsed.destroy();
  });
  it('positions exported text correctly on originally rotated PDFs',async()=>{
    for(const rotation of [0,90,180,270]){
      const input=await PDFDocument.create();input.addPage([595,842]).setRotation(degrees(rotation));
      const p={...page,originalRotation:rotation,width:rotation%180?842:595,height:rotation%180?595:842};
      const out=await exportPdf(await input.save(),{pages:[p],marks:[mark],fields:{}});
      const parsed=await getDocument({standardFontDataUrl:resolve('node_modules/pdfjs-dist/standard_fonts')+'/',data:out}).promise;const pdfPage=await parsed.getPage(1),viewport=pdfPage.getViewport({scale:1});
      const text=await pdfPage.getTextContent();const item=text.items.find(i=>'str'in i&&i.str===mark.text);
      expect(item&&'transform'in item).toBe(true);
      if(item&&'transform'in item){const xy=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);expect(xy[0]).toBeCloseTo(40,2);expect(xy[1]).toBeCloseTo(200+18*.85,2);}
      await parsed.destroy();
    }
  });
  it('honors nonzero crop origins and PDF UserUnit scaling',async()=>{
    const input=await PDFDocument.create(); const original=input.addPage([595,842]); original.setCropBox(20,30,500,700); original.node.set(PDFName.of('UserUnit'),PDFNumber.of(2));
    const p:PageInfo={...page,width:1000,height:1400,originX:20,originY:30,userUnit:2};
    const out=await exportPdf(await input.save(),{pages:[p],marks:[mark],fields:{}});
    const parsed=await getDocument({standardFontDataUrl:resolve('node_modules/pdfjs-dist/standard_fonts')+'/',data:out}).promise;
    const pdfPage=await parsed.getPage(1),viewport=pdfPage.getViewport({scale:1});const text=await pdfPage.getTextContent();const item=text.items.find(i=>'str'in i&&i.str===mark.text);
    expect(item&&'transform'in item).toBe(true);if(item&&'transform'in item){const xy=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);expect(xy[0]).toBeCloseTo(40,2);expect(xy[1]).toBeCloseTo(215.3,2);expect(item.transform[0]*2).toBeCloseTo(18,2);}
    await parsed.destroy();
  });
  it('removes pages and inserts new blank pages',async()=>{
    const bytes=await createSample();const result=await exportPdf(bytes,{pages:[{...page,id:'blank',source:null},page],marks:[],fields:{}});
    const parsed=await getDocument({standardFontDataUrl:resolve('node_modules/pdfjs-dist/standard_fonts')+'/',data:result.slice()}).promise;
    expect(parsed.numPages).toBe(2);expect((await (await parsed.getPage(1)).getTextContent()).items).toHaveLength(0);await parsed.destroy();
    expect((await PDFDocument.load(result)).getForm().getFields()).toHaveLength(0);
  });
  it('rejects unsafe or incomplete links before exporting',async()=>{
    expect(safeUrl('javascript:alert(1)')).toBeNull();expect(safeUrl('https://')).toBeNull();expect(safeUrl('https://example.com')).toBe('https://example.com/');
    await expect(exportPdf(await createSample(),{pages:[page],marks:[{...mark,kind:'link',url:'javascript:alert(1)'}],fields:{}})).rejects.toThrow('valid');
  });
  it('maps screen coordinates back into the page after rotation',()=>{
    expect(rotatedToBase({x:200,y:40},{...page,rotation:90})).toEqual({x:40,y:642});
    expect(toPdfPoint({x:40,y:200},page)).toEqual({x:40,y:642});
  });
});

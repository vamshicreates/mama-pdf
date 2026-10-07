import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { FormWidget, Mark, PageInfo } from './types';
import { displaySize, pageTransform } from './types';

export function PdfCanvas({ pdf, page, scale = 1 }: { pdf: PDFDocumentProxy; page: PageInfo; scale?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let task: { cancel: () => void; promise: Promise<void> } | undefined;
    const render = async () => {
      if (!canvas.current) return;
      const target = canvas.current;
      if (page.source === null) { target.width = page.width * scale; target.height = page.height * scale; const ctx = target.getContext('2d'); if (ctx) { ctx.fillStyle = '#fff'; ctx.fillRect(0,0,target.width,target.height); } return; }
      const source = await pdf.getPage(page.source + 1);
      if (disposed) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (page.width * page.height)) / scale);
      const viewport = source.getViewport({ scale: scale * ratio, rotation: page.originalRotation });
      target.width = viewport.width; target.height = viewport.height;
      task = source.render({ canvas: target, viewport });
      await task.promise;
    };
    render().catch(e => { if (!disposed && e.name !== 'RenderingCancelledException') setError('This page could not be displayed.'); });
    return () => { disposed = true; task?.cancel(); };
  }, [pdf, page.source, page.width, page.height, page.originalRotation, scale]);
  return <><canvas aria-hidden="true" ref={canvas} style={{ width: page.width, height: page.height }} />{error && <div className="page-error">{error}</div>}</>;
}
export const fontFamily = (font?: string) => font === 'serif' ? 'Times New Roman, serif' : font === 'mono' ? 'Courier New, monospace' : font === 'signature' ? 'Caveat, cursive' : 'Arial, sans-serif';
export function MarkGraphic({ mark }: { mark: Mark }) {
  const common = { opacity: mark.opacity, stroke: mark.color, strokeWidth: mark.stroke };
  const points = mark.points || [{ x: 0, y: 0 }, { x: mark.width, y: mark.height }];
  if (mark.kind === 'text') return <text transform={mark.angle ? `rotate(${mark.angle} ${mark.x} ${mark.y})` : undefined} x={mark.x} y={mark.y + (mark.fontSize || 18) * .85} fill={mark.color} opacity={mark.opacity} fontFamily={fontFamily(mark.font)} fontSize={mark.fontSize} fontWeight={mark.bold ? 700 : 400} xmlSpace="preserve">{(mark.text || '').split('\n').map((line, i) => <tspan key={i} x={mark.x} dy={i ? (mark.fontSize || 18) * 1.25 : 0}>{line || ' '}</tspan>)}</text>;
  if (mark.kind === 'image') return <image href={mark.src} x={mark.x} y={mark.y} width={mark.width} height={mark.height} opacity={mark.opacity} preserveAspectRatio="none" />;
  if (mark.kind === 'pen') return <polyline points={points.map(p => `${mark.x+p.x},${mark.y+p.y}`).join(' ')} {...common} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
  if (mark.kind === 'line' || mark.kind === 'arrow') {
    const a=points[0], b=points[points.length-1], angle=Math.atan2(b.y-a.y,b.x-a.x);
    return <g {...common} fill="none" strokeLinecap="round"><line x1={mark.x+a.x} y1={mark.y+a.y} x2={mark.x+b.x} y2={mark.y+b.y}/>{mark.kind==='arrow' && <polyline points={[-.5,.5].map(o=>`${mark.x+b.x-12*Math.cos(angle+o)},${mark.y+b.y-12*Math.sin(angle+o)}`).join(` ${mark.x+b.x},${mark.y+b.y} `)}/>}</g>;
  }
  if (mark.kind === 'ellipse') return <ellipse cx={mark.x+mark.width/2} cy={mark.y+mark.height/2} rx={mark.width/2} ry={mark.height/2} {...common} fill={mark.filled ? mark.color : 'none'}/>;
  if (mark.kind === 'link') return <rect x={mark.x} y={mark.y} width={mark.width} height={mark.height} fill="#3976d6" fillOpacity=".09" stroke="#3976d6" strokeWidth="1" strokeDasharray="4 3"/>;
  const fill = mark.kind === 'highlight' || mark.kind === 'whiteout' || mark.filled;
  return <rect x={mark.x} y={mark.y} width={mark.width} height={mark.height} {...common} stroke={fill ? 'none' : mark.color} fill={fill ? mark.color : 'none'}/>;
}
export function Thumbnail({ pdf, page, marks }: { pdf: PDFDocumentProxy; page: PageInfo; marks: Mark[] }) {
  const size = displaySize(page); const scale = 96 / size.width;
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => { const observer = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)), { rootMargin: '200px' }); if (holder.current) observer.observe(holder.current); return () => observer.disconnect(); }, []);
  return <div ref={holder} className="thumbnail-paper" style={{width:96,height:size.height*scale}}><div style={{width:size.width,height:size.height,transform:`scale(${scale})`,transformOrigin:'top left'}}><div style={{width:page.width,height:page.height,position:'relative',transform:pageTransform(page),transformOrigin:'top left'}}>{visible && <PdfCanvas pdf={pdf} page={page} scale={.2}/>}<svg className="marks-svg" width={page.width} height={page.height}>{marks.map(mark=><MarkGraphic key={mark.id} mark={mark}/>)}</svg></div></div></div>;
}
export function FormLayer({ pdf, page, fields, onChange, active }: { pdf: PDFDocumentProxy; page: PageInfo; fields: Record<string,string|boolean|string[]>; onChange:(name:string,value:string|boolean|string[])=>void; active:boolean }) {
  const [widgets,setWidgets]=useState<FormWidget[]>([]);
  useEffect(()=>{
    let cancelled=false;
    setWidgets([]);
    if(page.source===null) return;
    pdf.getPage(page.source+1).then(async source=>{
      const viewport=source.getViewport({scale:1,rotation:page.originalRotation});
      const annotations=await source.getAnnotations();
      if(cancelled)return;
      const w:FormWidget[]=annotations.filter(a=>a.subtype==='Widget' && ['Tx','Btn','Ch'].includes(a.fieldType) && !a.pushButton).map(a=>{
        const [x1,y1,x2,y2]=viewport.convertToViewportRectangle(a.rect);
        return {id:a.id,name:a.fieldName,type:a.fieldType,x:Math.min(x1,x2),y:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1),value:a.checkBox ? a.fieldValue!== 'Off' && a.fieldValue!=='' : a.fieldValue || '',options:a.options,multiline:a.multiLine,radio:a.radioButton,buttonValue:a.buttonValue,readOnly:a.readOnly};
      });setWidgets(w);
    }).catch(()=>{});
    return()=>{cancelled=true;};
  },[pdf,page.source,page.originalRotation]);
  return <div className={`form-layer ${active?'active':''}`}>{widgets.filter(w=>active || fields[w.name]!==undefined).map(w=>{
    const value=fields[w.name]??w.value;
    const props={id:`field-${w.id}`,title:w.name,'aria-label':w.name,disabled:!active||w.readOnly,style:{left:w.x,top:w.y,width:w.width,height:w.height,fontSize:Math.min(13,w.height*.6)}};
    if(w.type==='Btn') return <input {...props} key={w.id} type={w.radio?'radio':'checkbox'} name={w.radio?w.name:undefined} checked={w.radio?value===w.buttonValue:Boolean(value)} onChange={e=>onChange(w.name,w.radio?w.buttonValue||'':e.target.checked)}/>;
    if(w.type==='Ch') return <select {...props} key={w.id} value={Array.isArray(value)?value[0]:String(value)} onChange={e=>onChange(w.name,e.target.value)}>{w.options?.map(o=><option key={o.exportValue} value={o.exportValue}>{o.displayValue}</option>)}</select>;
    return w.multiline ? <textarea {...props} key={w.id} value={String(value)} onChange={e=>onChange(w.name,e.target.value)}/> : <input {...props} key={w.id} type="text" value={String(value)} onChange={e=>onChange(w.name,e.target.value)}/>;
  })}</div>;
}

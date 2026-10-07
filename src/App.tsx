import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Check, CheckSquare, ChevronLeft, ChevronRight, Circle, Copy, Download, FilePlus2, FileText, FolderOpen, Highlighter, ImagePlus, Info, Link2, LoaderCircle, LockKeyhole, Maximize, Minus, MousePointer2, MoveUpRight, PanelLeftClose, PanelLeftOpen, PenLine, Plus, Redo2, RotateCw, ShieldCheck, Square, Trash2, Type, Undo2, Upload, X, Eraser, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Draft, EditorState, Mark, MarkKind, PageInfo, Point, Tool } from './types';
import { displaySize, emptyState, pageTransform, palette, uid } from './types';
import { PdfCanvas, MarkGraphic, Thumbnail, FormLayer, fontFamily } from './PdfPage';
import { SignatureModal } from './SignatureModal';
import type { Signature } from './SignatureModal';
import { safeUrl } from './types';
const createBlank = async () => (await import('./pdf')).createBlank();
const createSample = async () => (await import('./pdf')).createSample();
const exportPdf = async (bytes: Uint8Array, state: EditorState) => (await import('./pdf')).exportPdf(bytes, state);
import { readExistingText } from './existingText';
import type { ExistingText } from './existingText';
import { removeOriginalText, textSources } from './textEditing';
import { readDraft, writeDraft } from './storage';


const tools: {id:Tool;name:string;icon:LucideIcon;shortcut?:string}[] = [
  {id:'select',name:'Select',icon:MousePointer2,shortcut:'V'}, {id:'text',name:'Text',icon:Type,shortcut:'T'},
  {id:'image',name:'Image',icon:ImagePlus}, {id:'signature',name:'Sign',icon:PenLine},
  {id:'highlight',name:'Highlight',icon:Highlighter,shortcut:'H'}, {id:'pen',name:'Draw',icon:PenLine,shortcut:'D'},
  {id:'shape',name:'Shapes',icon:Square}, {id:'whiteout',name:'Whiteout',icon:Eraser,shortcut:'W'},
  {id:'link',name:'Link',icon:Link2}, {id:'forms',name:'Forms',icon:CheckSquare},
];
const hints:Record<Tool,string>={select:'Click existing text to edit it, or select an addition.',text:'Click existing text to replace it. Click a blank area to add text.',image:'Click on the page to place your image.',signature:'Click on the page to place your signature.',highlight:'Drag over an area of the page to highlight it.',pen:'Click and drag to draw on the page.',shape:'Click and drag to draw a shape.',whiteout:'Drag over an area to cover it. Original content remains in the file.',link:'Drag over an area to add a clickable link.',forms:'Click a highlighted form field to fill it in.'};
const labels:Record<MarkKind,string>={text:'Text',rect:'Rectangle',ellipse:'Ellipse',line:'Line',arrow:'Arrow',highlight:'Highlight',pen:'Drawing',whiteout:'Whiteout',image:'Image',link:'Link'};
const MAX_FILE_SIZE=100*1024*1024;
function readableError(e:unknown){return e instanceof Error?e.message:'Something went wrong. Please try again.';}
function download(bytes:Uint8Array,name:string){const blob=new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function Brand({onClick}:{onClick:()=>void}){return <button className="brand" onClick={onClick} aria-label="Mama PDF home"><span className="brand-symbol">m<span>•</span></span><span className="brand-name">mama<span>pdf</span></span></button>;}
function useHistory(){
  const [history,setHistory]=useState<{past:EditorState[];present:EditorState;future:EditorState[]}>({past:[],present:emptyState,future:[]});
  const commit=useCallback((update:EditorState|((old:EditorState)=>EditorState))=>setHistory(h=>({past:[...h.past.slice(-59),h.present],present:typeof update==='function'?update(h.present):update,future:[]})),[]);
  const reset=useCallback((state:EditorState)=>setHistory({past:[],present:state,future:[]}),[]);
  const undo=useCallback(()=>setHistory(h=>h.past.length?{past:h.past.slice(0,-1),present:h.past[h.past.length-1],future:[h.present,...h.future]}:h),[]);
  const redo=useCallback(()=>setHistory(h=>h.future.length?{past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1)}:h),[]);
  return {state:history.present,commit,reset,undo,redo,canUndo:!!history.past.length,canRedo:!!history.future.length};
}
export default function App(){
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[bytes,setBytes]=useState<Uint8Array|null>(null),[name,setName]=useState('');
  const [previewPdf,setPreviewPdf]=useState<PDFDocumentProxy|null>(null),[textBusy,setTextBusy]=useState(false),[textError,setTextError]=useState('');
  const [existingText,setExistingText]=useState<ExistingText[]>([]),[readingText,setReadingText]=useState(false);
  const {state,commit,reset,undo,redo,canUndo,canRedo}=useHistory();
  const [tool,setTool]=useState<Tool>('select'),[selected,setSelected]=useState<string|null>(null),[pageId,setPageId]=useState('');
  const [scale,setScale]=useState(.9),[loading,setLoading]=useState(''),[exporting,setExporting]=useState(false),[notice,setNotice]=useState<{text:string;error?:boolean}|null>(null);
  const [draft,setDraft]=useState<Draft>(),[saveStatus,setSaveStatus]=useState('Saved on this device');
  const [sidebar,setSidebar]=useState(window.innerWidth>700),[properties,setProperties]=useState(window.innerWidth>700),[signatureOpen,setSignatureOpen]=useState(false),[helpOpen,setHelpOpen]=useState(false);
  const [pendingImage,setPendingImage]=useState<{src:string;width:number;height:number}|null>(null),[pendingSignature,setPendingSignature]=useState<Signature|null>(null);
  const [color,setColor]=useState('#252322'),[highlightColor,setHighlightColor]=useState('#ffe36a'),[fontSize,setFontSize]=useState(18),[font,setFont]=useState<Mark['font']>('sans'),[bold,setBold]=useState(false),[stroke,setStroke]=useState(2),[shape,setShape]=useState<MarkKind>('rect'),[filled,setFilled]=useState(false);
  const [working,setWorking]=useState<Mark|null>(null),[dragOver,setDragOver]=useState(false),[confirmClose,setConfirmClose]=useState(false),[confirmDelete,setConfirmDelete]=useState(false);
  const fileInput=useRef<HTMLInputElement>(null),imageInput=useRef<HTMLInputElement>(null),viewport=useRef<HTMLDivElement>(null);
  const interaction=useRef<{type:'create'|'move'|'resize';start:Point;original:Mark}|null>(null);
  const workingRef=useRef<Mark|null>(null);
  const currentPdf=useRef<PDFDocumentProxy|null>(null);
  const notify=useCallback((text:string,error=false)=>setNotice({text,error}),[]);
  useEffect(()=>{readDraft().then(setDraft).catch(()=>{});},[]);
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(null),notice.error?9000:4000);return()=>clearTimeout(t);},[notice]);
  useEffect(()=>{
    if(!bytes||!pdf)return;
    setSaveStatus('Saving draft…');
    const t=setTimeout(()=>{const next={bytes,name,state,updated:Date.now()};writeDraft(next).then(()=>{setDraft(next);setSaveStatus('Saved on this device');}).catch(()=>setSaveStatus('Draft unavailable · download to save'));},700);
    return()=>clearTimeout(t);
  },[bytes,pdf,name,state]);
  useEffect(()=>{if(state.pages.length && !state.pages.some(p=>p.id===pageId))setPageId(state.pages[0].id);},[state.pages,pageId]);
  const page=state.pages.find(p=>p.id===pageId)||state.pages[0];
  useEffect(()=>{
    let cancelled=false;setExistingText([]);
    if(!pdf||!page)return;
    setReadingText(true);
    readExistingText(pdf,page).then(items=>{if(!cancelled)setExistingText(items);}).catch(()=>{if(!cancelled)notify('Text could not be read on this page. You can still add text.',true);}).finally(()=>{if(!cancelled)setReadingText(false);});
    return()=>{cancelled=true;};
  },[pdf,page?.id,notify]);
  const removalKey=JSON.stringify(textSources(state));
  useEffect(()=>{
    let cancelled=false;let generated:PDFDocumentProxy|null=null;
    setPreviewPdf(null);setTextError('');
    const sources=JSON.parse(removalKey);
    if(!bytes||!pdf||!sources.length){setTextBusy(false);return;}
    setTextBusy(true);
    (async()=>{
      const cleaned=await removeOriginalText(bytes,sources);
      if(cancelled)return;
      const pdfjs=await import('pdfjs-dist');
      generated=await pdfjs.getDocument({data:cleaned.slice(),cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/'}).promise;
      if(cancelled){generated.destroy();return;}
      setPreviewPdf(generated);setTextBusy(false);
    })().catch(e=>{if(!cancelled){setTextBusy(false);setTextError(readableError(e));notify(readableError(e),true);}});
    return()=>{cancelled=true;generated?.destroy();};
  },[bytes,pdf,removalKey,notify]);
  const activeMark=state.marks.find(m=>m.id===selected);
  const updateMark=useCallback((patch:Partial<Mark>)=>{if(!selected)return;commit(s=>({...s,marks:s.marks.map(m=>m.id===selected?{...m,...patch}:m)}));},[selected,commit]);
  const removeMark=useCallback(()=>{if(!selected)return;commit(s=>({...s,marks:s.marks.filter(m=>m.id!==selected)}));setSelected(null);},[selected,commit]);
  const duplicateMark=()=>{if(!activeMark)return;const copy={...activeMark,replaces:undefined,id:uid(),x:activeMark.x+12,y:activeMark.y+12};commit(s=>({...s,marks:[...s.marks,copy]}));setSelected(copy.id);};
  const openBytes=async(data:Uint8Array,fileName:string,saved?:EditorState)=>{
    setLoading('Opening your PDF…');
    let nextPdf:PDFDocumentProxy|null=null;
    try{
      const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
      const task=pdfjs.getDocument({data:data.slice(),cMapUrl:"/pdfjs/cmaps/",cMapPacked:true,standardFontDataUrl:"/pdfjs/standard_fonts/",wasmUrl:"/pdfjs/wasm/"});
      task.onPassword=()=>{task.destroy();};
      try{nextPdf=await task.promise;}catch(e){throw new Error(/password|destroyed/i.test(readableError(e))?'This PDF is password protected. Open an unlocked copy to edit it.': 'This file could not be opened. Choose a valid, unencrypted PDF.');}
      if(await nextPdf.getPermissions()!==null)throw new Error('This PDF is encrypted. Save an unlocked copy before editing it here.');
      if(nextPdf.isPureXfa)throw new Error('This PDF uses XFA forms, which this editor does not support. Use a standard PDF copy.');
      const pages:PageInfo[]=[];
      for(let i=1;i<=nextPdf.numPages;i++){const p=await nextPdf.getPage(i),v=p.getViewport({scale:1});pages.push({id:uid(),source:i-1,width:v.width,height:v.height,originalRotation:p.rotate,rotation:0,originX:p.view[0],originY:p.view[1],userUnit:p.userUnit});}
      const previous=currentPdf.current;currentPdf.current=nextPdf;setPdf(nextPdf);setBytes(data);setName(fileName);reset(saved||{pages,marks:[],fields:{}});setPageId((saved?.pages||pages)[0].id);setSelected(null);setTool('select');
      setScale(Math.min(1,Math.max(.35,(window.innerWidth-490)/pages[0].width)));
      if(previous)previous.destroy();
    }catch(e){nextPdf?.destroy();notify(readableError(e),true);}finally{setLoading('');}
  };
  const openFile=async(file?:File)=>{if(!file)return;if(file.size>MAX_FILE_SIZE){notify('Choose a PDF smaller than 100 MB for this browser editor.',true);return;}if(!file.name.toLowerCase().endsWith('.pdf')&&file.type!=='application/pdf'){notify('Choose a PDF file to get started.',true);return;}try{await openBytes(new Uint8Array(await file.arrayBuffer()),file.name);}catch(e){notify(readableError(e),true);}};
  const exportDocument=useCallback(async()=>{
    if(!bytes||exporting)return;
    setExporting(true);
    try{const output=await exportPdf(bytes,state);download(output,name.replace(/\.pdf$/i,'')+'-edited.pdf');notify('Your edited PDF is ready.');}
    catch(e){notify(readableError(e),true);}finally{setExporting(false);}
  },[bytes,state,name,exporting,notify]);
  const closeDocument=async()=>{if(bytes&&pdf){const latest={bytes,name,state,updated:Date.now()};try{await writeDraft(latest);setDraft(latest);}catch{notify('Your draft could not be saved. Download your PDF before leaving.',true);setConfirmClose(false);return;}}setConfirmClose(false);setPdf(null);setBytes(null);currentPdf.current?.destroy();currentPdf.current=null;reset(emptyState);setSelected(null);};
  const fitPage=()=>{if(!page||!viewport.current)return;setScale(Math.min(1.8,Math.max(.25,(viewport.current.clientWidth-96)/displaySize(page).width)));};
  const chooseTool=(next:Tool)=>{
    setSelected(null);
    if(next==='image'){imageInput.current?.click();return;}
    if(next==='signature'){setSignatureOpen(true);return;}
    setTool(next);if(next!=='select')setProperties(true);
  };
  const loadImage=async(file?:File)=>{
    if(!file)return;if(file.size>20*1024*1024){notify('Choose an image smaller than 20 MB.',true);return;}
    const url=URL.createObjectURL(file);
    try{const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');const ratio=Math.min(1,2400/Math.max(img.width,img.height));canvas.width=Math.round(img.width*ratio);canvas.height=Math.round(img.height*ratio);canvas.getContext('2d')!.drawImage(img,0,0,canvas.width,canvas.height);const width=Math.min(240,page?.width? page.width*.6:240,(page?.height||842)*.6*img.width/img.height);setPendingImage({src:canvas.toDataURL('image/png'),width,height:width*img.height/img.width});setTool('image');setSelected(null);notify('Click the page to place your image.');}catch{notify('This image could not be opened. Try PNG, JPG or WebP.',true);}finally{URL.revokeObjectURL(url);}
  };
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if((e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]'))return;
      if(signatureOpen||helpOpen||confirmClose||confirmDelete){if(e.key==='Escape'){setSignatureOpen(false);setHelpOpen(false);setConfirmClose(false);setConfirmDelete(false);}return;}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();exportDocument();return;}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return;}
      if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removeMark();}
      if(e.key==='Escape'){setSelected(null);setTool('select');}
      const shortcuts:Record<string,Tool>={v:'select',t:'text',h:'highlight',d:'pen',w:'whiteout'};
      if(!e.metaKey&&!e.ctrlKey&&shortcuts[e.key.toLowerCase()]){setTool(shortcuts[e.key.toLowerCase()]);setSelected(null);}
      if(activeMark&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const step=e.shiftKey?10:1;updateMark({x:activeMark.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),y:activeMark.y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0)});}
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[undo,redo,removeMark,exportDocument,activeMark,updateMark,signatureOpen,helpOpen,confirmClose,confirmDelete]);
  const setLive=(mark:Mark|null)=>{workingRef.current=mark;setWorking(mark);};
  const pointerPoint=(e:ReactPointerEvent<SVGSVGElement>):Point=>{
    const matrix=e.currentTarget.getScreenCTM();if(!matrix)return{x:0,y:0};
    const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());
    return {x:Math.max(0,Math.min(page.width,p.x)),y:Math.max(0,Math.min(page.height,p.y))};
  };
  const addMark=(mark:Mark)=>{mark={...mark,x:Math.max(0,Math.min(page.width-mark.width,mark.x)),y:Math.max(0,Math.min(page.height-mark.height,mark.y))};setProperties(true);commit(s=>({...s,marks:[...s.marks,mark]}));setSelected(mark.id);setTool('select');};
  const editExisting=(item:ExistingText)=>{
    const found=state.marks.find(m=>m.replaces?.id===item.source.id);
    if(found){setSelected(found.id);setProperties(true);setTool('select');}
    else{
      const mark:Mark={id:uid(),pageId:page.id,kind:'text',x:item.x,y:item.y,width:item.width,height:item.height,text:item.text,fontSize:item.fontSize,font:item.font,bold:item.bold,angle:item.angle,color:'#252322',stroke:0,opacity:1,replaces:item.source};
      commit(old=>({...old,marks:[...old.marks,mark]}));setSelected(mark.id);setProperties(true);setTool('select');
    }
    setTimeout(()=>{const input=document.getElementById('text-content') as HTMLTextAreaElement;input?.focus();input?.select();},50);
  };
  const pointerDown=(e:ReactPointerEvent<SVGSVGElement>)=>{
    if(e.button!==0||!page)return;
    const p=pointerPoint(e);const target=e.target as Element;
    const clicked=target.closest('[data-mark]')?.getAttribute('data-mark');
    const original=target.closest('[data-original]')?.getAttribute('data-original');
    if(original&&(tool==='select'||tool==='text')){const item=existingText.find(t=>t.source.id===original);if(item)editExisting(item);e.preventDefault();return;}
    if(tool==='text'&&clicked){setSelected(clicked);setProperties(true);setTool('select');return;}
    if(tool==='select'){
      if(!clicked){setSelected(null);return;}
      const found=state.marks.find(m=>m.id===clicked);if(!found)return;
      setProperties(true);setSelected(clicked);interaction.current={type:target.hasAttribute('data-resize')?'resize':'move',start:p,original:found};setLive(found);e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();return;
    }
    if(tool==='forms')return;
    const base:Mark={id:uid(),pageId:page.id,kind:'rect',x:p.x,y:p.y,width:1,height:1,color,stroke,opacity:1};
    if(tool==='text'){addMark({...base,kind:'text',text:'Your text',fontSize,font,bold,width:Math.min(240,page.width-p.x),height:fontSize*1.25});setTimeout(()=>{const input=document.getElementById('text-content') as HTMLTextAreaElement;input?.focus();input?.select();},50);return;}
    if(tool==='image'&&pendingImage){addMark({...base,kind:'image',...pendingImage});return;}
    if(tool==='signature'&&pendingSignature){addMark({...base,...pendingSignature,color:'#252322'});return;}
    const kind:MarkKind=tool==='shape'?shape:tool==='highlight'?'highlight':tool==='pen'?'pen':tool==='whiteout'?'whiteout':tool==='link'?'link':'rect';
    const mark:Mark={...base,kind,color:tool==='highlight'?highlightColor:tool==='whiteout'?'#ffffff':color,opacity:tool==='highlight'?.42:1,filled,points:['pen','line','arrow'].includes(kind)?[{x:0,y:0}]:undefined,url:kind==='link'?'https://':undefined};
    interaction.current={type:'create',start:p,original:mark};setLive(mark);setSelected(null);e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();
  };
  const pointerMove=(e:ReactPointerEvent<SVGSVGElement>)=>{
    const drag=interaction.current;if(!drag)return;const p=pointerPoint(e),dx=p.x-drag.start.x,dy=p.y-drag.start.y,m=drag.original;
    if(drag.type==='move'){setLive({...m,x:Math.max(0,Math.min(page.width-m.width,m.x+dx)),y:Math.max(0,Math.min(page.height-m.height,m.y+dy))});return;}
    if(drag.type==='resize'){
      const radians=(m.angle||0)*Math.PI/180,localDx=Math.cos(radians)*dx+Math.sin(radians)*dy,localDy=-Math.sin(radians)*dx+Math.cos(radians)*dy;
      const width=Math.max(12,m.width+localDx),height=m.kind==='image'?width*m.height/m.width:Math.max(12,m.height+localDy);
      const patch:Partial<Mark>={width,height};if(m.kind==='text'){patch.fontSize=Math.max(6,(m.fontSize||18)*width/m.width);patch.height=m.height*width/m.width;}if(m.points)patch.points=m.points.map(p=>({x:p.x*width/m.width,y:p.y*height/m.height}));
      setLive({...m,...patch});return;
    }
    if(m.kind==='pen'){const current=workingRef.current!;setLive({...current,points:[...(current.points||[]),{x:dx,y:dy}]});return;}
    const x=Math.min(drag.start.x,p.x),y=Math.min(drag.start.y,p.y),width=Math.abs(dx),height=Math.abs(dy);
    setLive({...m,x,y,width,height,points:['line','arrow'].includes(m.kind)?[{x:drag.start.x-x,y:drag.start.y-y},{x:p.x-x,y:p.y-y}]:undefined});
  };
  const pointerUp=()=>{
    const drag=interaction.current;let mark=workingRef.current;if(!drag||!mark)return;
    interaction.current=null;
    if(drag.type==='create'){
      if(mark.kind==='pen'){
        const points=mark.points||[];if(points.length<2){setLive(null);return;}
        const xs=points.map(p=>p.x),ys=points.map(p=>p.y),minX=Math.min(...xs),minY=Math.min(...ys);
        mark={...mark,x:mark.x+minX,y:mark.y+minY,width:Math.max(1,Math.max(...xs)-minX),height:Math.max(1,Math.max(...ys)-minY),points:points.map(p=>({x:p.x-minX,y:p.y-minY}))};
      }else if(mark.width<3&&mark.height<3){setLive(null);return;}
      const done=mark;commit(s=>({...s,marks:[...s.marks,done]}));setSelected(mark.id);if(mark.kind==='link')setTool('select');
    }else if(mark.x!==drag.original.x||mark.y!==drag.original.y||mark.width!==drag.original.width||mark.height!==drag.original.height){const done=mark;commit(s=>({...s,marks:s.marks.map(m=>m.id===done.id?done:m)}));}
    setLive(null);
  };
  const rotatePage=()=>{commit(s=>({...s,pages:s.pages.map(p=>p.id===page.id?{...p,rotation:(p.rotation+90)%360}:p)}));};
  const movePage=(direction:number)=>{const index=state.pages.findIndex(p=>p.id===page.id),target=index+direction;if(target<0||target>=state.pages.length)return;commit(s=>{const pages=[...s.pages];[pages[index],pages[target]]=[pages[target],pages[index]];return {...s,pages};});};
  const deletePage=()=>{if(state.pages.length<=1)return;commit(s=>({...s,pages:s.pages.filter(p=>p.id!==page.id),marks:s.marks.filter(m=>m.pageId!==page.id)}));setSelected(null);setConfirmDelete(false);};
  const addPage=()=>{const added:PageInfo={id:uid(),source:null,width:595,height:842,originalRotation:0,rotation:0};commit(s=>{const pages=[...s.pages];pages.splice(pages.findIndex(p=>p.id===pageId)+1,0,added);return {...s,pages};});setPageId(added.id);setSelected(null);};
  const pageMarks=page?state.marks.filter(m=>m.pageId===page.id).map(m=>working?.id===m.id?working:m):[];
  if(working&&!pageMarks.some(m=>m.id===working.id))pageMarks.push(working);
  const selectedMark=pageMarks.find(m=>m.id===selected);
  const pageIndex=state.pages.findIndex(p=>p.id===pageId);
  const updateText=(text:string)=>{const size=activeMark?.fontSize||18;const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;ctx.font=`${activeMark?.bold?'bold ':''}${size}px ${fontFamily(activeMark?.font)}`;const width=Math.max(40,...text.split('\n').map(l=>ctx.measureText(l).width));updateMark({text,width:width+4,height:Math.max(1,text.split('\n').length)*size*1.25});};
  return <div className={`app ${pdf?'editing':'welcome'}`}>
    <input ref={fileInput} className="hidden" type="file" accept=".pdf,application/pdf" onChange={e=>{openFile(e.target.files?.[0]);e.target.value='';}}/>
    <input ref={imageInput} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{loadImage(e.target.files?.[0]);e.target.value='';}}/>
    <header className="app-header"><Brand onClick={()=>pdf?setConfirmClose(true):undefined}/>{pdf?<><div className="header-divider"/><div className="document-name"><FileText size={16}/><span title={name}>{name}</span><span className="edited-dot"/></div><div className="header-actions"><span className="save-status"><Check size={13}/>{saveStatus}</span><button className="icon-button help-button" title="Help and keyboard shortcuts" aria-label="Help and keyboard shortcuts" onClick={()=>setHelpOpen(true)}><Info size={18}/></button><button className="primary download-button" aria-label="Download PDF" title="Download PDF" onClick={exportDocument} disabled={exporting}>{exporting?<LoaderCircle className="spin" size={17}/>:<Download size={17}/>}<span>{exporting?'Preparing…':'Download PDF'}</span></button></div></>:<><span className="header-descriptor">A little tool. A lot of possibilities.</span><div className="header-actions"><span className="private-pill"><span/> Private by design</span><button className="icon-button" title="About Mama PDF" aria-label="About Mama PDF" onClick={()=>setHelpOpen(true)}><Info size={18}/></button></div></>}</header>
    {!pdf?<main className="welcome-main" onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragOver(false);}} onDrop={e=>{e.preventDefault();setDragOver(false);openFile(e.dataTransfer.files[0]);}}>
      <section className="welcome-copy"><div className="eyebrow"><span/> YOUR EVERYDAY PDF EDITOR</div><h1>Your PDF.<br/><em>Your way.</em></h1><p className="intro">The last little change. The signature.<br/>The idea in the margin. Make it yours.</p><div className={`upload-box ${dragOver?'drag-over':''}`}><div className="upload-top"><span className="upload-icon"><Upload size={23}/></span><div><h2>Drop your PDF here</h2><p>Or choose a file to start editing</p></div></div><button className="primary upload-button" onClick={()=>fileInput.current?.click()}>Open a PDF <ArrowUpRight size={20}/></button><div className="upload-note"><LockKeyhole size={12}/> Your files stay on your device.<span>Up to 100 MB</span></div></div><div className="starter-links"><button onClick={async()=>openBytes(await createSample(),'Mama — Project brief.pdf')}>Try a sample <ArrowRight size={14}/></button><span/><button onClick={async()=>openBytes(await createBlank(),'Untitled.pdf')}>Start with a blank page <FilePlus2 size={14}/></button></div>{draft&&<div className="draft-card"><span className="draft-icon"><FileText size={19}/></span><button className="draft-open" onClick={()=>openBytes(draft.bytes,draft.name,draft.state)}><strong>Pick up where you left off</strong><span>{draft.name}</span></button><button className="icon-button" title="Delete saved draft" aria-label="Delete saved draft" onClick={()=>writeDraft().then(()=>{setDraft(undefined);notify('Local draft removed.');}).catch(()=>notify('Could not remove the draft.',true))}><Trash2 size={15}/></button><button className="icon-button" title="Resume draft" aria-label="Resume draft" onClick={()=>openBytes(draft.bytes,draft.name,draft.state)}><ArrowUpRight size={18}/></button></div>}</section>
      <section className="welcome-art" aria-label="A preview of the Mama PDF editing experience"><div className="art-grid"/><div className="art-tools"><span className="art-tool active"><MousePointer2 size={18}/></span><span className="art-tool"><Type size={18}/></span><span className="art-tool"><Highlighter size={18}/></span><span className="art-tool"><PenLine size={18}/></span><span className="art-tool"><ImagePlus size={18}/></span></div><div className="art-paper"><div className="paper-top"><span>mama <b>studio</b></span><span>PROJECT / 001</span></div><div className="paper-rule"/><span className="paper-kicker">THE CREATIVE BRIEF</span><h2>Good things.<br/>Made together.</h2><div className="art-highlight">An idea worth putting on paper.</div><div className="fake-lines"><i/><i/><i/></div><div className="paper-divider"/><div className="paper-columns"><div><small>THE PLAN</small><div className="fake-lines"><i/><i/><i/></div></div><div><small>THE DETAILS</small><div className="fake-lines"><i/><i/><i/></div></div></div><div className="art-note"><span className="selection-dot a"/><span className="selection-dot b"/><span className="selection-dot c"/><span className="selection-dot d"/><span>Let's make it happen.</span><MousePointer2 className="note-cursor" size={22}/></div><div className="art-signature">With love, Mama</div><div className="paper-bottom"><span>MADE WITH A LITTLE HELP FROM MAMA PDF</span><b>01</b></div></div><div className="art-label label-top"><Highlighter size={14}/> A highlight here.</div><div className="art-label label-bottom"><Check size={14}/> A personal touch there.</div><div className="art-caption"><span/> ALL THE LITTLE THINGS, TAKEN CARE OF.</div></section>
      <section className="feature-strip"><div><Type size={21}/><span><strong>Say it your way</strong><small>Add text, images & notes</small></span></div><div><PenLine size={21}/><span><strong>Leave your mark</strong><small>Draw, highlight & sign</small></span></div><div><FileText size={21}/><span><strong>Get it together</strong><small>Fill forms & organize pages</small></span></div><div><ShieldCheck size={21}/><span><strong>Keep it to yourself</strong><small>Edited here. Stored here.</small></span></div></section>
      <footer className="welcome-footer"><span>A little help from <strong className="dedication-name">Vamshi</strong> Mama to <strong className="dedication-name">Melbourne</strong> Mama, with love.</span></footer>
    </main>:<>
      <div className="toolbar"><div className="tools">{tools.map(t=><button key={t.id} className={`tool ${tool===t.id?'active':''}`} title={`${t.name}${t.shortcut?` (${t.shortcut})`:''}`} onClick={()=>chooseTool(t.id)}><t.icon size={18}/><span>{t.name}</span></button>)}</div><div className="history-actions"><button className="icon-button" title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo} onClick={undo}><Undo2 size={18}/></button><button className="icon-button" title="Redo (⌘⇧Z)" aria-label="Redo" disabled={!canRedo} onClick={redo}><Redo2 size={18}/></button></div></div>
      <div className="editor-body">
        {sidebar&&<aside className="pages-panel"><div className="panel-heading"><h2>Pages <span>{state.pages.length}</span></h2><button className="icon-button" title="Hide pages" aria-label="Hide pages" onClick={()=>setSidebar(false)}><PanelLeftClose size={17}/></button></div><div className="page-list">{state.pages.map((p,i)=><button className={`page-thumbnail ${p.id===pageId?'active':''}`} key={p.id} onClick={()=>{setPageId(p.id);setSelected(null);viewport.current?.scrollTo({top:0});}} aria-label={`Page ${i+1}`} aria-current={p.id===pageId?'page':undefined}><Thumbnail pdf={previewPdf||pdf} page={p} marks={state.marks.filter(m=>m.pageId===p.id)}/><span className="page-number">{i+1}{p.id===pageId&&<span/>}</span></button>)}</div><button className="add-page" onClick={addPage}><Plus size={16}/> Add blank page</button></aside>}
        <section className="workspace"><div className="workspace-top"><div className="workspace-top-left">{!sidebar&&<button className="icon-button" title="Show pages" aria-label="Show pages" onClick={()=>setSidebar(true)}><PanelLeftOpen size={17}/></button>}<span>Page {pageIndex+1} <span className="muted">of {state.pages.length}</span></span></div><div className="page-actions"><button className="icon-button" title="Move page earlier" aria-label="Move page earlier" disabled={pageIndex===0} onClick={()=>movePage(-1)}><ArrowUp size={15}/></button><button className="icon-button" title="Move page later" aria-label="Move page later" disabled={pageIndex===state.pages.length-1} onClick={()=>movePage(1)}><ArrowDown size={15}/></button><span className="tiny-divider"/><button className="icon-button" title="Rotate page clockwise" aria-label="Rotate page clockwise" onClick={rotatePage}><RotateCw size={16}/></button><button className="icon-button" title="Delete page" aria-label="Delete page" disabled={state.pages.length===1} onClick={()=>setConfirmDelete(true)}><Trash2 size={15}/></button><button className="icon-button properties-toggle" title="Toggle properties" aria-label="Toggle properties" onClick={()=>setProperties(!properties)}><SlidersHorizontal size={16}/></button></div></div>
        <div className={`canvas-viewport tool-${tool}`} ref={viewport}><div className="canvas-scroll"><div className="page-shadow" style={{width:displaySize(page).width*scale,height:displaySize(page).height*scale}}><div style={{width:displaySize(page).width,height:displaySize(page).height,transform:`scale(${scale})`,transformOrigin:'top left'}}><div className="pdf-page" style={{width:page.width,height:page.height,transform:pageTransform(page),transformOrigin:'top left'}}><PdfCanvas pdf={previewPdf||pdf} page={page} scale={scale}/><svg className={`marks-svg ${tool==='select'?'selectable':''}`} width={page.width} height={page.height} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={()=>{interaction.current=null;setLive(null);}} aria-label="PDF editing canvas">{(tool==='select'||tool==='text')&&existingText.filter(item=>!state.marks.some(m=>m.replaces?.id===item.source.id)).map(item=><polygon key={item.source.id} data-original={item.source.id} points={item.polygon.map(p=>`${p.x},${p.y}`).join(' ')} className="existing-text-target" role="button" tabIndex={0} aria-label={`Edit text: ${item.text}`} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();editExisting(item);}}}><title>Click to edit: {item.text}</title></polygon>)}{pageMarks.map(mark=><g key={mark.id} data-mark={mark.id}><MarkGraphic mark={mark}/>{(tool==='select'||tool==='text')&&<rect transform={mark.angle ? `rotate(${mark.angle} ${mark.x} ${mark.y})` : undefined} x={mark.x-3} y={mark.y-3} width={Math.max(mark.width+6,10)} height={Math.max(mark.height+6,10)} fill="transparent" stroke="none"/>}</g>)}{selectedMark&&tool==='select'&&<g data-mark={selectedMark.id} className="selection" transform={selectedMark.angle ? `rotate(${selectedMark.angle} ${selectedMark.x} ${selectedMark.y})` : undefined}><rect x={selectedMark.x-4} y={selectedMark.y-4} width={Math.max(8,selectedMark.width)+8} height={Math.max(8,selectedMark.height)+8} fill="none" stroke="#ed655c" strokeWidth={1.2/scale} strokeDasharray={`${4/scale} ${2/scale}`}/><rect data-resize="true" x={selectedMark.x+selectedMark.width-4/scale} y={selectedMark.y+selectedMark.height-4/scale} width={8/scale} height={8/scale} fill="#fff" stroke="#ed655c" strokeWidth={1.3/scale} className="resize-handle"/></g>}</svg>{(textBusy||textError)&&<div className="text-processing" role="status">{textBusy?<><LoaderCircle className="spin" size={20}/> Updating original text…</>:<><Info size={20}/>{textError}<button className="secondary" onClick={undo}>Undo text edit</button></>}</div>}<FormLayer pdf={pdf} page={page} fields={state.fields} active={tool==='forms'} onChange={(field,value)=>commit(s=>({...s,fields:{...s.fields,[field]:value}}))}/></div></div></div><div className="page-caption">{name} <span>·</span> {pageIndex+1}</div></div></div>
        <div className="workspace-bottom"><span className="tool-hint"><Info size={13}/>{readingText?'Reading page text…':hints[tool]}</span><div className="zoom-controls"><button className="icon-button" aria-label="Zoom out" title="Zoom out" disabled={scale<=.25} onClick={()=>setScale(s=>Math.max(.25,s-.1))}><Minus size={15}/></button><button className="zoom-value" title="Reset zoom" onClick={()=>setScale(1)}>{Math.round(scale*100)}%</button><button className="icon-button" aria-label="Zoom in" title="Zoom in" disabled={scale>=2.5} onClick={()=>setScale(s=>Math.min(2.5,s+.1))}><Plus size={15}/></button><span className="tiny-divider"/><button className="icon-button" title="Fit page width" aria-label="Fit page width" onClick={fitPage}><Maximize size={15}/></button></div></div></section>
        {properties&&<aside className="properties-panel"><div className="panel-heading"><h2>{activeMark?labels[activeMark.kind]:'Make it yours'}</h2><button className="icon-button mobile-properties-close" title="Close properties" aria-label="Close properties" onClick={()=>setProperties(false)}><X size={16}/></button>{activeMark&&<button className="icon-button" title="Deselect" aria-label="Deselect" onClick={()=>setSelected(null)}><X size={16}/></button>}</div><div className="properties-scroll">
          {(activeMark?.kind==='text'||(!activeMark&&tool==='text'))&&<><div className="property-section">{activeMark&&<><label className="field-label" htmlFor="text-content">{activeMark.replaces?'Edit existing text':'Your text'}</label><textarea id="text-content" value={activeMark.text||''} onChange={e=>updateText(e.target.value)} rows={4}/>{activeMark.replaces&&<p className="field-hint">This replaces the original text. Clear this box to remove it. Choose a matching font and color below.</p>}</>}<label className="field-label" htmlFor="font-family">Font</label><select id="font-family" value={activeMark?.font||font} onChange={e=>{const value=e.target.value as Mark['font'];activeMark?updateMark({font:value}):setFont(value);}}><option value="sans">Helvetica</option><option value="serif">Times Roman</option><option value="mono">Courier</option><option value="signature">Caveat / Signature</option></select><div className="property-row"><div><label className="field-label" htmlFor="font-size">Size</label><input id="font-size" type="number" min={6} max={144} value={activeMark?.fontSize||fontSize} onChange={e=>{const value=Math.min(144,Math.max(6,Number(e.target.value)||6));activeMark?updateMark({fontSize:value,height:(activeMark.text||'').split('\n').length*value*1.25,width:activeMark.width*value/(activeMark.fontSize||18)}):setFontSize(value);}}/></div><div><span className="field-label">Style</span><button className={`bold-button ${(activeMark?.bold??bold)?'active':''}`} onClick={()=>activeMark?updateMark({bold:!activeMark.bold}):setBold(!bold)}>B</button></div></div></div></>}
          {!activeMark&&tool==='shape'&&<div className="property-section"><span className="field-label">Shape</span><div className="shape-options">{([{kind:'rect',icon:Square,label:'Rectangle'},{kind:'ellipse',icon:Circle,label:'Ellipse'},{kind:'line',icon:Minus,label:'Line'},{kind:'arrow',icon:MoveUpRight,label:'Arrow'}] as const).map(s=><button title={s.label} aria-label={s.label} className={shape===s.kind?'active':''} key={s.kind} onClick={()=>setShape(s.kind)}><s.icon size={20}/></button>)}</div></div>}
          {(activeMark?!['image','link','whiteout'].includes(activeMark.kind):['text','pen','shape','highlight'].includes(tool))&&<div className="property-section"><label className="field-label" htmlFor="mark-color">Color</label><div className="color-grid">{(tool==='highlight'&&!activeMark?['#ffe36a','#87e5ac','#8dceff','#f5a7d5','#c3a5f2','#ed655c']:palette).map(c=><button key={c} title={c} aria-label={`Color ${c}`} style={{background:c}} className={(activeMark?.color||(tool==='highlight'?highlightColor:color))===c?'chosen':''} onClick={()=>activeMark?updateMark({color:c}):tool==='highlight'?setHighlightColor(c):setColor(c)}>{(activeMark?.color||(tool==='highlight'?highlightColor:color))===c&&<Check size={13} color={c==='#252322'?'white':'#252322'}/>}</button>)}</div><div className="color-input"><input id="mark-color" aria-label="Custom color" type="color" value={activeMark?.color||(tool==='highlight'?highlightColor:color)} onChange={e=>activeMark?updateMark({color:e.target.value}):tool==='highlight'?setHighlightColor(e.target.value):setColor(e.target.value)}/><span>{(activeMark?.color||(tool==='highlight'?highlightColor:color)).toUpperCase()}</span></div></div>}
          {(activeMark?['pen','rect','ellipse','arrow','line'].includes(activeMark.kind):['pen','shape'].includes(tool))&&<div className="property-section"><label className="field-label" htmlFor="stroke-width">Line weight <span>{activeMark?.stroke||stroke} pt</span></label><input id="stroke-width" type="range" min={1} max={12} value={activeMark?.stroke||stroke} onChange={e=>activeMark?updateMark({stroke:Number(e.target.value)}):setStroke(Number(e.target.value))}/>{(activeMark?['rect','ellipse'].includes(activeMark.kind):['rect','ellipse'].includes(shape))&&<label className="checkbox-label"><input type="checkbox" checked={activeMark?.filled??filled} onChange={e=>activeMark?updateMark({filled:e.target.checked}):setFilled(e.target.checked)}/> Fill shape</label>}</div>}
          {activeMark&&activeMark.kind!=='whiteout'&&activeMark.kind!=='link'&&<div className="property-section"><label className="field-label" htmlFor="opacity">Opacity <span>{Math.round(activeMark.opacity*100)}%</span></label><input id="opacity" type="range" min={10} max={100} value={Math.round(activeMark.opacity*100)} onChange={e=>updateMark({opacity:Number(e.target.value)/100})}/></div>}
          {activeMark?.kind==='link'&&<div className="property-section"><label className="field-label" htmlFor="link-url">Link address</label><input id="link-url" type="url" placeholder="https://example.com" value={activeMark.url||''} onChange={e=>updateMark({url:e.target.value})}/>{!safeUrl(activeMark.url||'')&&<p className="field-hint">Enter a full https:// or mailto: address.</p>}<p className="field-hint">The outlined area becomes clickable in your downloaded PDF.</p></div>}
          {(activeMark?.kind==='whiteout'||tool==='whiteout')&&<div className="info-box"><Eraser size={18}/><h3>Cover a little detail</h3><p>Whiteout hides an area visually. The original content remains underneath. It is not secure redaction.</p></div>}
          {tool==='forms'&&!activeMark&&<div className="info-box"><CheckSquare size={20}/><h3>Fill it in</h3><p>Existing form fields are highlighted on the page. Click a field to enter your details.</p><p>No fields on this page? Use Text to type wherever you need.</p><button className="secondary wide" onClick={()=>chooseTool('text')}><Type size={15}/> Add text instead</button></div>}
          {activeMark?<div className="property-section object-actions"><button className="secondary wide" onClick={duplicateMark}><Copy size={15}/> Duplicate</button><button className="danger-button wide" onClick={removeMark}><Trash2 size={15}/> {activeMark.replaces?'Restore original text':`Delete ${labels[activeMark.kind].toLowerCase()}`}</button></div>:tool==='select'?<><div className="inspector-empty"><span className="empty-cursor"><MousePointer2 size={26}/></span><h3>A little edit goes a long way.</h3><p>Click any text on the page to edit its words. Choose a tool above to add something new.</p></div><div className="quick-actions"><span className="field-label">A good place to start</span><button onClick={()=>chooseTool('text')}><Type size={17}/><span>Edit or add text</span><ChevronRight size={14}/></button><button onClick={()=>chooseTool('signature')}><PenLine size={17}/><span>Make it official</span><ChevronRight size={14}/></button><button onClick={()=>chooseTool('highlight')}><Highlighter size={17}/><span>Pick out a detail</span><ChevronRight size={14}/></button></div></>:<p className="property-hint">{hints[tool]}</p>}
          {!readingText&&page.source!==null&&!existingText.length&&(tool==='text'||tool==='select')&&<div className="info-box"><Info size={18}/><h3>No editable text found</h3><p>This page may be a scan or have text drawn as artwork. OCR is needed to turn it into editable text. You can still add new text with the Text tool.</p></div>}
          {state.marks.filter(m=>m.pageId===pageId).length>0&&<div className="property-section layer-list"><span className="field-label">On this page <span>{state.marks.filter(m=>m.pageId===pageId).length}</span></span>{state.marks.filter(m=>m.pageId===pageId).map(m=><button className={selected===m.id?'active':''} key={m.id} onClick={()=>{setSelected(m.id);setTool('select');}}><span className="layer-dot" style={{background:m.color}}/><span>{m.kind==='text'?m.text?.slice(0,24)||'Text':labels[m.kind]}</span><MousePointer2 size={12}/></button>)}</div>}
        </div><div className="local-note"><ShieldCheck size={15}/><span>Your document stays<br/>on this device.</span></div></aside>}
      </div><footer className="editor-footer"><span className="footer-dedication">A little help from <strong className="dedication-name">Vamshi</strong> Mama to <strong className="dedication-name">Melbourne</strong> Mama, with love.</span><div><button className="text-button" onClick={()=>setConfirmClose(true)}><FolderOpen size={13}/> Open another PDF</button><span className="tiny-divider"/><button className="icon-button" title="Previous page" aria-label="Previous page" disabled={pageIndex<=0} onClick={()=>{setPageId(state.pages[pageIndex-1].id);setSelected(null);}}><ChevronLeft size={14}/></button><span>{pageIndex+1} / {state.pages.length}</span><button className="icon-button" title="Next page" aria-label="Next page" disabled={pageIndex>=state.pages.length-1} onClick={()=>{setPageId(state.pages[pageIndex+1].id);setSelected(null);}}><ChevronRight size={14}/></button></div></footer>
    </>}
    {signatureOpen&&<SignatureModal onClose={()=>setSignatureOpen(false)} onUse={signature=>{setPendingSignature(signature);setSignatureOpen(false);setTool('signature');setSelected(null);notify('Click the page to place your signature.');}}/>}
    {loading&&<div className="loading-overlay"><div><LoaderCircle className="spin" size={32}/><strong>{loading}</strong><span>A little patience. Good things take a moment.</span></div></div>}
    {notice&&<div className={`toast ${notice.error?'error':''}`} role={notice.error?'alert':'status'}>{notice.error?<Info size={18}/>:<Check size={18}/>}<span>{notice.text}</span><button aria-label="Dismiss message" onClick={()=>setNotice(null)}><X size={16}/></button></div>}
    {(confirmClose||confirmDelete)&&<div className="modal-backdrop"><div className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{confirmDelete?'Remove this page?':'Done for now?'}</h2><p>{confirmDelete?'This removes the page and its additions. You can bring it back with Undo.':'Download your PDF to keep a finished copy. Your most recent draft is saved on this device; opening another file replaces it.'}</p><div><button className="secondary" onClick={()=>{setConfirmClose(false);setConfirmDelete(false);}}>Keep editing</button><button className="primary" onClick={confirmDelete?deletePage:closeDocument}>{confirmDelete?'Remove page':'Back to home'}<ArrowRight size={15}/></button></div></div></div>}
    {helpOpen&&<div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)setHelpOpen(false);}}><div className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><button className="icon-button modal-close" aria-label="Close help" onClick={()=>setHelpOpen(false)}><X size={20}/></button><span className="eyebrow">A LITTLE HELP FROM MAMA</span><h2 id="help-title">Make yourself<br/><em>at home.</em></h2><p>Open a PDF, pick a tool, and make it yours. Download when you’re done.</p><div className="help-grid"><span>Select <kbd>V</kbd></span><span>Add text <kbd>T</kbd></span><span>Highlight <kbd>H</kbd></span><span>Draw <kbd>D</kbd></span><span>Whiteout <kbd>W</kbd></span><span>Deselect <kbd>Esc</kbd></span><span>Undo <kbd>⌘ / Ctrl Z</kbd></span><span>Download <kbd>⌘ / Ctrl S</kbd></span></div><div className="info-box"><ShieldCheck size={18}/><h3>Your files belong to you.</h3><p>PDFs are processed in this browser. One recovery draft is stored on this device. Delete it from the home screen at any time.</p></div><p className="field-hint">Click existing text to replace it, or use Text on an empty area to add words. Replacements remove the original text and use the font and color you choose. Scanned text needs OCR, which is not included. Encrypted PDFs, XFA forms, and digital certificate signatures are not supported. Whiteout covers content; it does not remove it.</p><button className="primary wide" onClick={()=>setHelpOpen(false)}>Got it <Check size={17}/></button></div></div>}
  </div>;
}

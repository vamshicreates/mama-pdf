import { useEffect, useRef, useState } from 'react';
import { X, Undo2, ArrowUpRight, PenLine } from 'lucide-react';
import type { Mark } from './types';
export type Signature = Pick<Mark,'kind'|'src'|'text'|'font'|'width'|'height'|'fontSize'>;
export function SignatureModal({ onClose,onUse }: { onClose:()=>void;onUse:(signature:Signature)=>void }) {
  const [tab,setTab]=useState<'type'|'draw'>('type');
  const [name,setName]=useState('');
  const [hasInk,setHasInk]=useState(false);
  const canvas=useRef<HTMLCanvasElement>(null);
  const drawing=useRef(false);
  const modal=useRef<HTMLDivElement>(null);
  useEffect(()=>{ const first=modal.current?.querySelector<HTMLElement>('input,button');first?.focus(); },[]);
  const useSignature=()=>{
    if(tab==='type'){if(!name.trim())return;onUse({kind:'text',text:name.trim(),font:'signature',fontSize:36,width:Math.min(420,name.length*18),height:48});}
    else {
      const c=canvas.current;if(!c||!hasInk)return;
      const ctx=c.getContext('2d')!;const data=ctx.getImageData(0,0,c.width,c.height);let x0=c.width,y0=c.height,x1=0,y1=0;
      for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(data.data[(y*c.width+x)*4+3]>0){x0=Math.min(x,x0);y0=Math.min(y,y0);x1=Math.max(x,x1);y1=Math.max(y,y1);}
      const crop=document.createElement('canvas');crop.width=x1-x0+8;crop.height=y1-y0+8;crop.getContext('2d')!.drawImage(c,x0,y0,x1-x0+1,y1-y0+1,4,4,x1-x0+1,y1-y0+1);
      onUse({kind:'image',src:crop.toDataURL('image/png'),width:200,height:200*crop.height/crop.width});
    }
  };
  return <div className="modal-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={modal} className="signature-modal" role="dialog" aria-modal="true" aria-labelledby="signature-title" onKeyDown={e=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const nodes=modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,canvas[tabindex]');if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}>
    <div className="modal-heading"><span className="coral-icon"><PenLine size={22}/></span><button className="icon-button" aria-label="Close signature dialog" onClick={onClose}><X size={20}/></button></div>
    <h2 id="signature-title">Your signature.<br/><em>Your finishing touch.</em></h2><p>Make a signature, then click the page to place it.</p>
    <div className="segmented"><button className={tab==='type'?'active':''} onClick={()=>setTab('type')}>Type your name</button><button className={tab==='draw'?'active':''} onClick={()=>setTab('draw')}>Draw it yourself</button></div>
    {tab==='type'?<><label className="field-label" htmlFor="signature-name">Full name</label><input id="signature-name" autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" maxLength={50}/><div className="signature-preview">{name||'Your name'}</div></>:<><div className="signature-pad"><canvas ref={canvas} width={920} height={300} aria-label="Draw your signature here" onPointerDown={e=>{const c=e.currentTarget,rect=c.getBoundingClientRect(),ctx=c.getContext('2d')!;drawing.current=true;c.setPointerCapture(e.pointerId);ctx.beginPath();ctx.moveTo((e.clientX-rect.left)*c.width/rect.width,(e.clientY-rect.top)*c.height/rect.height);ctx.strokeStyle='#252322';ctx.lineWidth=4;ctx.lineCap='round';ctx.lineJoin='round';}} onPointerMove={e=>{if(!drawing.current)return;const c=e.currentTarget,rect=c.getBoundingClientRect(),ctx=c.getContext('2d')!;ctx.lineTo((e.clientX-rect.left)*c.width/rect.width,(e.clientY-rect.top)*c.height/rect.height);ctx.stroke();setHasInk(true);}} onPointerUp={()=>{drawing.current=false;}} onPointerCancel={()=>{drawing.current=false;}}/></div><button className="text-button" onClick={()=>{const c=canvas.current;c?.getContext('2d')?.clearRect(0,0,c.width,c.height);setHasInk(false);}}><Undo2 size={14}/> Clear drawing</button></>}
    <button className="primary wide" disabled={tab==='type'?!name.trim():!hasInk} onClick={useSignature}>Use this signature <ArrowUpRight size={18}/></button><small>This adds a visual signature to the page.</small>
  </div></div>;
}

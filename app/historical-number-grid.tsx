"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export default function HistoricalNumberGrid({children, columns, onUpdateCell, onBeginOperation, onEndOperation}: {children:ReactNode; columns:number; onBeginOperation:()=>void; onEndOperation:()=>void; onUpdateCell:(account:string,date:string,value:string)=>void}) {
 const root=useRef<HTMLDivElement>(null);
 const anchor=useRef(0), end=useRef(0);
 const [error,setError]=useState("");
 const drag=useRef<{id:number;x:number;y:number;input:HTMLInputElement}|null>(null);
 const frame=useRef<number|null>(null);
 useEffect(()=>()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);},[]);
 const stopDrag=()=>{const active=drag.current;drag.current=null;if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;if(active?.input.hasPointerCapture(active.id))active.input.releasePointerCapture(active.id);};
 const updateDrag=()=>{
  const active=drag.current, scroller=root.current?.querySelector<HTMLElement>(".historical-grid-wrap");
  if(!active||!scroller)return;
  const rect=scroller.getBoundingClientRect(), margin=28;
  const dx=active.x>rect.right-margin?16:active.x<rect.left+margin?-16:0;
  const dy=active.y>window.innerHeight-margin?16:active.y<margin?-16:0;
  if(dx)scroller.scrollLeft+=dx;
  if(dy)window.scrollBy(0,dy);
  const x=Math.max(rect.left+1,Math.min(active.x,rect.right-1));
  const y=Math.max(Math.max(rect.top+1,1),Math.min(active.y,Math.min(rect.bottom-1,window.innerHeight-1)));
  const input=locate(document.elementFromPoint(x,y));
  if(input&&root.current?.contains(input)){const i=inputs().indexOf(input);if(i>=0&&i!==end.current){end.current=i;paint();}}
  frame.current=requestAnimationFrame(updateDrag);
 };
 const inputs=()=>Array.from(root.current?.querySelectorAll<HTMLInputElement>(".historical-number-input")??[]);
 const bounds=()=>({top:Math.min(Math.floor(anchor.current/columns),Math.floor(end.current/columns)),bottom:Math.max(Math.floor(anchor.current/columns),Math.floor(end.current/columns)),left:Math.min(anchor.current%columns,end.current%columns),right:Math.max(anchor.current%columns,end.current%columns)});
 const paint=()=>{const b=bounds(); inputs().forEach((input,i)=>{const selected=Math.floor(i/columns)>=b.top&&Math.floor(i/columns)<=b.bottom&&i%columns>=b.left&&i%columns<=b.right;input.closest("td")?.classList.toggle("grid-selected",selected);input.closest("td")?.classList.toggle("grid-anchor",i===anchor.current); const cell=input.closest("td"); if(cell){const r=Math.floor(i/columns),c=i%columns;cell.style.boxShadow=selected?[r===b.top?"inset 0 2px #76d6d1":"",r===b.bottom?"inset 0 -2px #76d6d1":"",c===b.left?"inset 2px 0 #76d6d1":"",c===b.right?"inset -2px 0 #76d6d1":""].filter(Boolean).join(","):"";}});};
 const locate=(target:EventTarget|null)=> target instanceof Element ? target.closest("td")?.querySelector<HTMLInputElement>(".historical-number-input")??null:null;
 const write=(input:HTMLInputElement,value:string)=>{input.value=value;onUpdateCell(input.dataset.accountKey!,input.dataset.date!,value);};
 const selected=()=>{const b=bounds();return inputs().filter((_,i)=>Math.floor(i/columns)>=b.top&&Math.floor(i/columns)<=b.bottom&&i%columns>=b.left&&i%columns<=b.right);};
 return <><p className="historical-grid-help">クリックでセル選択・ドラッグまたはShiftで範囲選択。ダブルクリックで編集。選択中はコピー・貼り付け・Deleteが使えます。</p><p role="alert">{error}</p><div ref={root}
 onPointerDownCapture={e=>{const input=locate(e.target);if(e.button!==0||e.pointerType==="touch"||!input||!input.readOnly)return;e.preventDefault();stopDrag();const i=inputs().indexOf(input);if(!e.shiftKey)anchor.current=i;end.current=i;input.focus({preventScroll:true});paint();drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,input};input.setPointerCapture(e.pointerId);frame.current=requestAnimationFrame(updateDrag);}}
 onPointerMove={e=>{if(drag.current?.id!==e.pointerId)return;drag.current.x=e.clientX;drag.current.y=e.clientY;e.preventDefault();if(frame.current!==null)cancelAnimationFrame(frame.current);updateDrag();}}
 onPointerUp={e=>{if(drag.current?.id===e.pointerId)stopDrag();}}
 onPointerCancel={stopDrag}
 onLostPointerCapture={stopDrag}
 onDragStart={e=>{if(locate(e.target)?.readOnly)e.preventDefault();}}
 onFocusCapture={e=>{const input=locate(e.target);if(!input||!input.readOnly)return;const i=inputs().indexOf(input);if(i!==end.current){anchor.current=i;end.current=i;}paint();}}
 onDoubleClick={e=>{const input=locate(e.target);if(!input)return;onBeginOperation();input.readOnly=false;input.focus();input.select();}}
 onBlurCapture={e=>{const input=locate(e.target);if(input){input.readOnly=true;onEndOperation();}}}
 onCopy={e=>{const input=locate(e.target);if(!input||!input.readOnly)return;const list=inputs(),b=bounds(),rows=[];for(let r=b.top;r<=b.bottom;r++){const row=[];for(let c=b.left;c<=b.right;c++)row.push(list[r*columns+c].value);rows.push(row.join("\t"));}e.preventDefault();e.clipboardData.setData("text/plain",rows.join("\n"));}}
 onPaste={e=>{const input=locate(e.target);if(!input||!input.readOnly)return;e.preventDefault();const text=e.clipboardData.getData("text/plain").replace(/\r\n?/g,"\n").replace(/\n$/,"");const rows=text.split("\n").map(row=>row.split("\t"));const list=inputs(),b=bounds(),width=rows[0].length;
 if(rows.some(row=>row.length!==width||row.some(value=>value!==""&&(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))))||b.top+rows.length>list.length/columns||b.left+width>columns){setError("数値・空欄のみ貼り付けできます。貼り付け範囲が表を超えていないか確認してください。");return;}
 onBeginOperation();rows.forEach((row,r)=>row.forEach((value,c)=>write(list[(b.top+r)*columns+b.left+c],value)));anchor.current=b.top*columns+b.left;end.current=(b.top+rows.length-1)*columns+b.left+width-1;paint();onEndOperation();setError("");}}
 onKeyDown={e=>{const input=locate(e.target);if(!input)return;if(!input.readOnly){if(e.key==="Enter"||e.key==="Escape"){e.preventDefault();input.readOnly=true;input.focus();onEndOperation();}return;}
 if(e.key==="Enter"||e.key==="F2"){e.preventDefault();onBeginOperation();input.readOnly=false;input.select();return;}
 if(e.key==="Backspace"||e.key==="Delete"){e.preventDefault();onBeginOperation();selected().forEach(cell=>write(cell,""));onEndOperation();setError("");return;}
 const moves:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-columns,ArrowDown:columns};if(!(e.key in moves))return;e.preventDefault();const list=inputs(),i=end.current,next=i+moves[e.key];if(next<0||next>=list.length||((e.key==="ArrowLeft"||e.key==="ArrowRight")&&Math.floor(next/columns)!==Math.floor(i/columns)))return;if(!e.shiftKey)anchor.current=next;end.current=next;list[next].focus();list[next].scrollIntoView({block:"nearest",inline:"nearest"});paint();}}
 >{children}</div></>;
}

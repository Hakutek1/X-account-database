"use client";
import { useRef, useState, type ReactNode } from "react";

export default function HistoricalNumberGrid({children, columns, onUpdateCell}: {children:ReactNode; columns:number; onUpdateCell:(account:string,date:string,value:string)=>void}) {
 const root=useRef<HTMLDivElement>(null);
 const anchor=useRef(0), end=useRef(0);
 const [error,setError]=useState("");
 const inputs=()=>Array.from(root.current?.querySelectorAll<HTMLInputElement>(".historical-number-input")??[]);
 const bounds=()=>({top:Math.min(Math.floor(anchor.current/columns),Math.floor(end.current/columns)),bottom:Math.max(Math.floor(anchor.current/columns),Math.floor(end.current/columns)),left:Math.min(anchor.current%columns,end.current%columns),right:Math.max(anchor.current%columns,end.current%columns)});
 const paint=()=>{const b=bounds(); inputs().forEach((input,i)=>{const selected=Math.floor(i/columns)>=b.top&&Math.floor(i/columns)<=b.bottom&&i%columns>=b.left&&i%columns<=b.right;input.closest("td")?.classList.toggle("grid-selected",selected);input.closest("td")?.classList.toggle("grid-anchor",i===anchor.current);});};
 const locate=(target:EventTarget|null)=> target instanceof Element ? target.closest<HTMLInputElement>(".historical-number-input"):null;
 const write=(input:HTMLInputElement,value:string)=>{input.value=value;onUpdateCell(input.dataset.accountKey!,input.dataset.date!,value);};
 const selected=()=>{const b=bounds();return inputs().filter((_,i)=>Math.floor(i/columns)>=b.top&&Math.floor(i/columns)<=b.bottom&&i%columns>=b.left&&i%columns<=b.right);};
 return <><p className="historical-grid-help">クリックでセル選択・ドラッグまたはShiftで範囲選択。ダブルクリックで編集。選択中はコピー・貼り付け・Deleteが使えます。</p><p role="alert">{error}</p><div ref={root}
 onPointerDownCapture={e=>{const input=locate(e.target);if(!input||!input.readOnly)return;e.preventDefault();const i=inputs().indexOf(input);if(!e.shiftKey)anchor.current=i;end.current=i;input.focus();paint();}}
 onPointerOver={e=>{if(e.buttons!==1)return;const input=locate(e.target);if(!input||!input.readOnly)return;end.current=inputs().indexOf(input);paint();}}
 onFocusCapture={e=>{const input=locate(e.target);if(!input||!input.readOnly)return;const i=inputs().indexOf(input);if(i!==end.current){anchor.current=i;end.current=i;}paint();}}
 onDoubleClick={e=>{const input=locate(e.target);if(!input)return;input.readOnly=false;input.focus();input.select();}}
 onBlurCapture={e=>{const input=locate(e.target);if(input)input.readOnly=true;}}
 onCopy={e=>{const input=locate(e.target);if(!input||!input.readOnly)return;const list=inputs(),b=bounds(),rows=[];for(let r=b.top;r<=b.bottom;r++){const row=[];for(let c=b.left;c<=b.right;c++)row.push(list[r*columns+c].value);rows.push(row.join("\t"));}e.preventDefault();e.clipboardData.setData("text/plain",rows.join("\n"));}}
 onPaste={e=>{const input=locate(e.target);if(!input||!input.readOnly)return;e.preventDefault();const text=e.clipboardData.getData("text/plain").replace(/\r\n?/g,"\n").replace(/\n$/,"");const rows=text.split("\n").map(row=>row.split("\t"));const list=inputs(),b=bounds(),width=rows[0].length;
 if(rows.some(row=>row.length!==width||row.some(value=>value!==""&&(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))))||b.top+rows.length>list.length/columns||b.left+width>columns){setError("数値・空欄のみ貼り付けできます。貼り付け範囲が表を超えていないか確認してください。");return;}
 rows.forEach((row,r)=>row.forEach((value,c)=>write(list[(b.top+r)*columns+b.left+c],value)));anchor.current=b.top*columns+b.left;end.current=(b.top+rows.length-1)*columns+b.left+width-1;paint();setError("");}}
 onKeyDown={e=>{const input=locate(e.target);if(!input)return;if(!input.readOnly){if(e.key==="Enter"||e.key==="Escape"){e.preventDefault();input.readOnly=true;input.focus();}return;}
 if(e.key==="Enter"||e.key==="F2"){e.preventDefault();input.readOnly=false;input.select();return;}
 if(e.key==="Backspace"||e.key==="Delete"){e.preventDefault();selected().forEach(cell=>write(cell,""));setError("");return;}
 const moves:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-columns,ArrowDown:columns};if(!(e.key in moves))return;e.preventDefault();const list=inputs(),i=end.current,next=i+moves[e.key];if(next<0||next>=list.length||((e.key==="ArrowLeft"||e.key==="ArrowRight")&&Math.floor(next/columns)!==Math.floor(i/columns)))return;if(!e.shiftKey)anchor.current=next;end.current=next;list[next].focus();list[next].scrollIntoView({block:"nearest",inline:"nearest"});paint();}}
 >{children}</div></>;
}

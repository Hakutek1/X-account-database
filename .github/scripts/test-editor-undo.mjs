import assert from "node:assert/strict";
import { chromium } from "playwright";
const origin=process.env.APP_URL??"http://127.0.0.1:4181";
const browser=await chromium.launch({headless:true,channel:process.env.TEST_CHROME_CHANNEL||undefined});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const dates=["2026-11-09","2026-11-10","2026-11-11"];
 let fixture={metric:"followers",revision:1,accounts:[{accountId:"a",handle:"alpha",displayName:"Alpha",status:"active",freezeDate:null},{accountId:"b",handle:"beta",displayName:"Beta",status:"ended",freezeDate:null}],dates,values:{a:{[dates[0]]:1,[dates[1]]:2,[dates[2]]:3},b:{[dates[0]]:4,[dates[1]]:5,[dates[2]]:6}}};
 let failSave=false;
 await page.route("**/api/**",route=>{
  const request=route.request(),url=request.url();
  if(url.includes("/historical-data")&&request.method()==="PUT"){
   if(failSave)return route.fulfill({status:500,json:{error:"合成保存失敗"}});
   const body=request.postDataJSON();fixture={...fixture,...body,revision:fixture.revision+1};
   return route.fulfill({status:200,json:{revision:fixture.revision,accounts:body.accounts.length,dates:body.dates.length,changedRows:1}});
  }
  const data=url.includes("/admin/status")?{configured:true,isAdmin:true,readMode:"public"}:url.includes("/historical-data")?fixture:url.includes("/account-targets")?{handles:[],initialized:true,revision:1}:{runs:[],rows:[],registeredAccountCount:2};
  return route.fulfill({status:200,json:data});
 });
 page.on("dialog",dialog=>dialog.accept());
 await page.goto(origin,{waitUntil:"networkidle"});
 await page.getByRole("tab",{name:"全履歴編集",exact:true}).click();
 const editor=page.locator(".historical-editor"),cells=page.locator(".historical-number-input");
 await cells.first().waitFor();
 const focusEditor=()=>editor.evaluate(element=>element.focus());
 const undo=async (key="Control+z")=>{await focusEditor();await page.keyboard.press(key);};
 const values=()=>cells.evaluateAll(elements=>elements.map(element=>element.value));
 const baseline=["1","2","3","4","5","6"];
 await cells.first().dblclick();await cells.first().fill("123");await cells.first().press("Enter");
 await undo();assert.deepEqual(await values(),baseline,"single numeric edit undo");
 await cells.first().click();await cells.nth(4).click({modifiers:["Shift"]});
 await cells.nth(4).press("Backspace");await undo("Meta+z");assert.deepEqual(await values(),baseline,"range clear is one undo");
 await cells.first().click();
 await cells.first().evaluate(element=>{const data=new DataTransfer();data.setData("text/plain","10\t11\n12\t13");element.dispatchEvent(new ClipboardEvent("paste",{bubbles:true,cancelable:true,clipboardData:data}));});
 assert.deepEqual(await values(),["10","11","3","12","13","6"]);await undo();assert.deepEqual(await values(),baseline,"range paste is one undo");
 const name=page.getByRole("textbox",{name:"aの表示名",exact:true});
 await name.fill("");await name.pressSequentially("Changed");await undo();assert.equal(await name.inputValue(),"Alpha","text editing is grouped");
 const status=page.getByLabel("aの活動状態",{exact:true}),date=page.getByLabel("alphaの凍結日／垢削除日",{exact:true});
 await status.selectOption("ended");await date.fill("2026-11-10");assert.equal(await status.inputValue(),"ended");
 await undo();assert.equal(await date.inputValue(),"");assert.equal(await status.inputValue(),"ended");
 await undo();assert.equal(await status.inputValue(),"active");
 await date.fill("2026-11-10");assert.equal(await status.inputValue(),"active");
 await status.selectOption("non_alt");assert.equal(await date.inputValue(),"2026-11-10");
 await undo();await undo();assert.equal(await date.inputValue(),"");
 await page.getByLabel("新しいアカウントID").fill("c");await page.getByLabel("新しいハンドル名").fill("gamma");await page.getByLabel("新しい表示名").fill("Gamma");await page.locator(".historical-account-add button").click();assert.equal(await cells.count(),9);await undo();assert.equal(await cells.count(),6);
 await page.locator(".historical-row-delete").first().click();assert.equal(await cells.count(),3);await undo();assert.deepEqual(await values(),baseline,"row removal restores values");
 await page.getByRole("button",{name:"26/11/10を削除",exact:true}).click();assert.equal(await cells.count(),4);await undo();assert.deepEqual(await values(),baseline,"date removal restores values");
 await page.getByLabel("日付を追加",{exact:true}).fill("2026-11-12");await page.getByRole("button",{name:"日付を追加",exact:true}).click();assert.equal(await cells.count(),8);await undo();assert.deepEqual(await values(),baseline);
 await cells.first().dblclick();await cells.first().fill("55");await cells.first().press("Enter");failSave=true;await page.getByRole("button",{name:"変更を保存",exact:true}).click();await page.locator(".notice-error").waitFor();assert.match(await page.locator(".notice-error").textContent(),/合成保存失敗/);await undo();assert.deepEqual(await values(),baseline,"failed save retains undo");
 await cells.first().dblclick();await cells.first().fill("77");await cells.first().press("Enter");failSave=false;await page.getByRole("button",{name:"変更を保存",exact:true}).click();await page.getByText(/保存しました/).waitFor();await undo();assert.equal(await cells.first().inputValue(),"77","saved changes cannot be undone");
 await cells.first().dblclick();await cells.first().fill("88");await cells.first().press("Enter");await page.getByRole("button",{name:"再読み込み",exact:true}).click();await cells.first().waitFor();await undo();assert.equal(await cells.first().inputValue(),"77","reload clears undo");
 for(let i=0;i<101;i++)await status.selectOption(i%2===0?"ended":"active");
 for(let i=0;i<101;i++)await undo();
 assert.equal(await status.inputValue(),"ended","only the latest 100 actions are retained");
 await cells.first().dblclick();await cells.first().fill("99");await cells.first().press("Enter");await page.getByRole("tab",{name:"フォロー数",exact:true}).click();await cells.first().waitFor();await undo();assert.equal(await cells.first().inputValue(),"77","metric switch clears undo");
 console.log(JSON.stringify({numeric:true,rangeOperations:true,accountFields:true,lifecycleDate:true,rowAndDateOperations:true,saveFailure:true,saveBoundary:true,reload:true,historyLimit:100,metricSwitch:true}));
}finally{await browser.close();}

import assert from "node:assert/strict";
import test from "node:test";
import { buildFrozenMetricIndex, freezeProjectionCutoff, frozenProjectionDate, isValidFreezeDate, shouldUnfreezeAfterCollection } from "../lib/freeze-date.ts";

test("lifecycle dates require a real calendar date", () => {
 assert.equal(isValidFreezeDate("2026-11-10"),true);
 for(const value of ["2026-02-29","2026-11-3",null]) assert.equal(isValidFreezeDate(value),false);
});
test("projection starts the next day and includes that day's measurements", () => {
 assert.equal(frozenProjectionDate("2026-11-09","2026-11-10"),"2026-11-09");
 assert.equal(frozenProjectionDate("2026-11-10","2026-11-10"),"2026-11-10");
 assert.equal(frozenProjectionDate("2026-11-11","2026-11-10"),"2026-11-11");
 assert.equal(frozenProjectionDate("2026-11-12","2026-11-10"),"2026-11-11");
 assert.equal(frozenProjectionDate("2026-11-12",null),"2026-11-12");
 assert.equal(freezeProjectionCutoff("2026-12-31"),"2027-01-01");
 assert.equal(freezeProjectionCutoff("2024-02-28"),"2024-02-29");
 assert.equal(freezeProjectionCutoff("2024-02-29"),"2024-03-01");
});
test("successful collection must be later than the configured day", () => {
 assert.equal(shouldUnfreezeAfterCollection("2026-11-10","2026-11-10"),false);
 assert.equal(shouldUnfreezeAfterCollection("2026-11-10","2026-11-11"),true);
 assert.equal(shouldUnfreezeAfterCollection("2026-02-30","2026-11-11"),false);
});
test("all statuses use each metric's nearest valid value through the next-day cutoff", () => {
 for(const status of ["active","ended","suspended","non_alt"]) {
  const rows=[
   {account_id:"a",account_status:status,freeze_date:"2026-11-10",fetched_at:"2026-11-09T01:00:00Z",followers:90,following:40,posts:9},
   {account_id:"a",account_status:status,freeze_date:"2026-11-10",fetched_at:"2026-11-10T01:00:00Z",followers:100,following:42,posts:10},
   {account_id:"a",account_status:status,freeze_date:"2026-11-10",fetched_at:"2026-11-11T01:00:00Z",followers:110,following:null,posts:11},
   {account_id:"a",account_status:status,freeze_date:"2026-11-10",fetched_at:"2026-11-12T01:00:00Z",followers:999,following:999,posts:999},
  ];
  const item=buildFrozenMetricIndex(rows,row=>row.fetched_at.slice(0,10)).get("a");
  assert.equal(item.freezeDate,"2026-11-10");assert.equal(item.projectionDate,"2026-11-11");
  assert.equal(item.atFreeze.followers.value,110);assert.equal(item.beforeFreeze.followers.value,100);
  assert.equal(item.atFreeze.following.value,42);assert.equal(item.beforeFreeze.following.value,40);
  assert.equal(item.atFreeze.posts.value,11);assert.equal(item.beforeFreeze.posts.value,10);
  assert.equal(item.latestRow.account_status,status);
 }
});
test("missing measurements remain missing instead of becoming zero",()=>{
 const index=buildFrozenMetricIndex([{account_id:"a",account_status:"ended",freeze_date:"2026-11-10",fetched_at:"2026-11-11T01:00:00Z",followers:null,following:null,posts:null}],row=>row.fetched_at.slice(0,10));
 assert.equal(index.get("a").atFreeze.followers,null);
});

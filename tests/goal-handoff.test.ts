import test from "node:test";
import assert from "node:assert/strict";
import { validConditions, conditionLines } from "../src/goals/handoff";
test("business handoff rejects excessive training, unknown fields and invalid budgets",()=>{
  const conditions={training:{intervalDays:3,cycles:8,exercises:[{name:"引体向上",sets:2,reps:5,unit:"次"}]},travel:{origin:"上海",destination:"杭州",budget:1200,purpose:null,transport:"高铁",accommodation:null},shopping:{name:"鸡蛋",amount:"12个",category:"食品"},meals:{people:1,budget:260,dietaryPreference:null,allergies:"花生",healthGoal:null}};
  assert.ok(validConditions(conditions));assert.ok(conditionLines(conditions).some(t=>t.includes("2 组 × 5 次")));
  assert.equal(validConditions({...conditions,training:{...conditions.training,cycles:0}}),false);
  assert.equal(validConditions({...conditions,travel:{...conditions.travel,id:"replace-existing"}}),false);
  assert.equal(validConditions({...conditions,meals:{...conditions.meals,budget:-1}}),false);
  assert.equal(validConditions({...conditions,training:{...conditions.training,exercises:[{...conditions.training.exercises[0],sets:50}]}}),false);
});

//! Goal relationships are local application state; the public task contract stays unchanged.
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
pub const KEY: &str = "tideplan.goals.v1";
fn text(v: &Value, max: usize) -> bool {
    v.as_str().is_some_and(|s| s.encode_utf16().count() <= max)
}
fn id(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 80
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_:-".contains(&b))
    })
}
fn optional_id(v: &Value) -> bool {
    v == "" || id(v)
}
fn date(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.is_empty()
            || (s.len() == 10
                && ("0100-01-01"..="9999-12-31").contains(&s)
                && chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                    .is_ok_and(|d| d.format("%Y-%m-%d").to_string() == s))
    })
}
fn choice(v: &Value, values: &[&str]) -> bool {
    v.as_str().is_some_and(|s| values.contains(&s))
}
fn number(v: &Value, min: u64, max: u64) -> bool {
    v.as_u64().is_some_and(|n| (min..=max).contains(&n))
}
fn list(v: &Value, max: usize, f: impl Fn(&Value) -> bool) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= max && a.iter().all(f))
}
fn records(v: &Value, max: usize, f: impl Fn(&Value) -> bool) -> bool {
    let mut ids = HashSet::new();
    list(v, max, |x| id(&x["id"]) && f(x))
        && v.as_array()
            .unwrap()
            .iter()
            .all(|x| ids.insert(x["id"].as_str().unwrap()))
}
fn goal(g: &Value) -> bool {
    id(&g["id"])
        && optional_id(&g["parentId"])
        && text(&g["title"], 200)
        && g["title"].as_str().is_some_and(|s| !s.trim().is_empty())
        && text(&g["criterion"], 2000)
        && choice(&g["status"], &["active", "paused", "completed"])
        && date(&g["reviewDate"])
}
fn action(a: &Value) -> bool {
    id(&a["id"])
        && id(&a["goalId"])
        && list(&a["dependsOn"], 50, id)
        && number(&a["minutes"], 5, 1440)
        && choice(&a["energy"], &["low", "normal", "high"])
        && text(&a["blocker"], 1000)
        && date(&a["deferredUntil"])
        && choice(
            &a["destination"],
            &[
                "task",
                "fitness",
                "travel",
                "shopping-list",
                "meal-planner",
                "work-monitor",
                "bead-studio",
            ],
        )
        && optional_id(&a["targetId"])
        && date(&a["targetDate"])
        && a.get("conditions").is_none_or(valid_conditions)
}
fn keys(v: &Value, names: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|o| o.len() == names.len() && names.iter().all(|k| o.contains_key(*k)))
}
fn valid_conditions(v: &Value) -> bool {
    if !keys(v, &["training", "travel", "shopping", "meals"]) {
        return false;
    }
    let t = &v["training"];
    let r = &v["travel"];
    let s = &v["shopping"];
    let m = &v["meals"];
    (t.is_null()
        || keys(t, &["intervalDays", "cycles", "exercises"])
            && (t["intervalDays"].is_null() || number(&t["intervalDays"], 1, 90))
            && (t["cycles"].is_null() || number(&t["cycles"], 1, 104))
            && list(&t["exercises"], 30, |e| {
                keys(e, &["name", "sets", "reps", "unit"])
                    && text(&e["name"], 200)
                    && e["name"].as_str().is_some_and(|s| !s.trim().is_empty())
                    && number(&e["sets"], 1, 30)
                    && number(&e["reps"], 1, 1000)
                    && text(&e["unit"], 40)
                    && e["unit"].as_str().is_some_and(|s| !s.trim().is_empty())
            }))
        && (r.is_null()
            || keys(
                r,
                &[
                    "origin",
                    "destination",
                    "budget",
                    "purpose",
                    "transport",
                    "accommodation",
                ],
            ) && [
                "origin",
                "destination",
                "purpose",
                "transport",
                "accommodation",
            ]
            .iter()
            .all(|k| r[*k].is_null() || text(&r[*k], 1000))
                && (r["budget"].is_null() || number(&r["budget"], 0, 10000000)))
        && (s.is_null()
            || keys(s, &["name", "amount", "category"])
                && text(&s["name"], 80)
                && s["name"].as_str().is_some_and(|s| !s.trim().is_empty())
                && text(&s["amount"], 40)
                && text(&s["category"], 40))
        && (m.is_null()
            || keys(
                m,
                &[
                    "people",
                    "budget",
                    "dietaryPreference",
                    "allergies",
                    "healthGoal",
                ],
            ) && (m["people"].is_null() || number(&m["people"], 1, 12))
                && (m["budget"].is_null() || number(&m["budget"], 1, 1000000))
                && ["dietaryPreference", "allergies", "healthGoal"]
                    .iter()
                    .all(|k| m[*k].is_null() || text(&m[*k], 1000)))
}
fn thought(t: &Value) -> bool {
    text(&t["text"], 12000)
        && choice(&t["status"], &["inbox", "later", "organized"])
        && t["createdAt"]
            .as_str()
            .is_some_and(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok())
}
pub fn graph_valid(goals: &Value, actions: &Value) -> bool {
    let (Some(gs), Some(acts)) = (goals.as_array(), actions.as_array()) else {
        return false;
    };
    let gm: HashMap<_, _> = gs
        .iter()
        .filter_map(|g| Some((g["id"].as_str()?, g["parentId"].as_str()?)))
        .collect();
    let am: HashMap<_, _> = acts
        .iter()
        .filter_map(|a| Some((a["id"].as_str()?, a)))
        .collect();
    if gm.len() != gs.len() || am.len() != acts.len() {
        return false;
    }
    for g in gm.keys() {
        let mut seen = HashSet::new();
        let mut p = *g;
        while !p.is_empty() {
            if !seen.insert(p) {
                return false;
            }
            let Some(next) = gm.get(p) else { return false };
            p = next;
        }
    }
    fn visit<'a>(
        key: &'a str,
        map: &HashMap<&'a str, &'a Value>,
        active: &mut HashSet<&'a str>,
        done: &mut HashSet<&'a str>,
    ) -> bool {
        if done.contains(key) {
            return true;
        }
        if !active.insert(key) {
            return false;
        }
        let Some(a) = map.get(key) else { return false };
        let Some(deps) = a["dependsOn"].as_array() else {
            return false;
        };
        if !deps
            .iter()
            .all(|d| d.as_str().is_some_and(|s| visit(s, map, active, done)))
        {
            return false;
        }
        active.remove(key);
        done.insert(key);
        true
    }
    let mut active = HashSet::new();
    let mut done = HashSet::new();
    acts.iter().all(|a| {
        a["goalId"].as_str().is_some_and(|g| gm.contains_key(g))
            && a["id"]
                .as_str()
                .is_some_and(|k| visit(k, &am, &mut active, &mut done))
    })
}
pub fn valid_plan(p: &Value) -> bool {
    text(&p["summary"], 4000)
        && list(&p["questions"], 3, |x| text(x, 500))
        && list(&p["assumptions"], 12, |x| text(x, 1000))
        && list(&p["later"], 30, |x| text(x, 1000))
        && records(&p["goals"], 100, goal)
        && records(&p["actions"], 100, |a| {
            action(a)
                && optional_id(&a["existingTaskId"])
                && crate::assistant::valid_draft(&a["draft"])
                && text(&a["draft"]["notes"], 4000)
        })
}
pub fn valid_state(s: &Value) -> bool {
    let p = &s["preferences"];
    let prefs = number(&p["minutes"], 5, 1440)
        && number(&p["dailyLimit"], 1, 10)
        && choice(&p["energy"], &["low", "normal", "high"])
        && p["checkins"].is_boolean()
        && p["autoReview"].is_boolean()
        && number(&p["reviewWeekday"], 0, 6)
        && p["reviewTime"]
            .as_str()
            .is_some_and(|s| s.len() == 5 && chrono::NaiveTime::parse_from_str(s, "%H:%M").is_ok());
    s["version"] == 1
        && s.get("conversation").is_none_or(valid_conversation)
        && number(&s["revision"], 0, 9_007_199_254_740_991)
        && text(&s["draft"], 12000)
        && records(&s["thoughts"], 500, thought)
        && records(&s["goals"], 300, goal)
        && records(&s["actions"], 1000, |a| action(a) && id(&a["taskId"]))
        && graph_valid(&s["goals"], &s["actions"])
        && prefs
        && records(&s["proposals"], 100, |p| {
            list(&p["sourceIds"], 500, id)
                && text(&p["createdAt"], 40)
                && text(&p["goalSnapshot"], 300000)
                && p["taskVersions"]
                    .as_object()
                    .is_some_and(|m| m.iter().all(|(k, v)| id(&json!(k)) && text(v, 40)))
                && choice(&p["status"], &["pending", "applied", "undone"])
                && valid_plan(&p["plan"])
                && p.get("waiting").is_none_or(valid_waiting)
        })
        && records(&s["reviews"], 200, |r| {
            date(&r["date"])
                && r["date"] != ""
                && choice(&r["kind"], &["morning", "evening", "weekly"])
                && text(&r["text"], 12000)
                && text(&r["note"], 4000)
                && date(&r["nextCheck"])
                && choice(&r["source"], &["local", "ai"])
        })
        && list(&s["operations"], 2000, id)
        && (s["undo"].is_null() || {
            let u = &s["undo"];
            id(&u["operationId"])
                && u.get("conversation").is_none_or(valid_conversation)
                && u.get("proposalBefore")
                    .is_none_or(|p| id(&p["id"]) && valid_plan(&p["plan"]))
                && u.get("updatedTasks").is_none_or(|p| {
                    list(p, 100, |pair| {
                        id(&pair["before"]["id"])
                            && pair["before"]["id"] == pair["after"]["id"]
                            && text(&pair["before"]["updatedAt"], 40)
                            && text(&pair["after"]["updatedAt"], 40)
                    })
                })
                && id(&u["proposalId"])
                && number(&u["revision"], 0, 9_007_199_254_740_991)
                && records(&u["goals"], 300, goal)
                && records(&u["actions"], 1000, |a| action(a) && id(&a["taskId"]))
                && graph_valid(&u["goals"], &u["actions"])
                && records(&u["thoughts"], 500, thought)
                && list(&u["createdTasks"], 100, |t| {
                    id(&t["id"]) && text(&t["title"], 200) && text(&t["updatedAt"], 40)
                })
        })
}
fn object(properties: Value) -> Value {
    let required: Vec<_> = properties.as_object().unwrap().keys().cloned().collect();
    json!({"type":"object","properties":properties,"required":required,"additionalProperties":false})
}
pub fn valid_understanding(v: &Value) -> bool {
    if !records(v, 80, |n| {
        optional_id(&n["parentId"])
            && text(&n["label"], 500)
            && n["label"].as_str().is_some_and(|s| !s.trim().is_empty())
            && choice(&n["status"], &["clear", "assumed", "unknown"])
            && text(&n["evidence"], 1000)
    }) {
        return false;
    }
    graph_valid(v, &json!([]))
}
pub fn valid_waiting(v: &Value) -> bool {
    let mut seen = HashSet::new();
    list(v, 200, |w| {
        w["key"]
            .as_str()
            .is_some_and(|k| (k.starts_with("g:") || k.starts_with("a:")) && id(&json!(&k[2..])))
            && text(&w["reason"], 1000)
            && w["reason"].as_str().is_some_and(|s| !s.trim().is_empty())
    }) && v
        .as_array()
        .unwrap()
        .iter()
        .all(|w| seen.insert(w["key"].as_str().unwrap()))
}
pub fn valid_conversation(c: &Value) -> bool {
    optional_id(&c["proposalId"])
        && c["needsReply"].is_boolean()
        && valid_understanding(&c["understanding"])
        && records(&c["messages"], 160, |m| {
            choice(&m["role"], &["user", "assistant", "system"])
                && text(&m["text"], 12000)
                && m["createdAt"]
                    .as_str()
                    .is_some_and(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok())
        })
        && records(&c["receipts"], 1000, |r| {
            text(&r["key"], 84)
                && text(&r["title"], 200)
                && text(&r["description"], 4000)
                && optional_id(&r["taskId"])
                && optional_id(&r["goalId"])
                && text(&r["createdAt"], 40)
        })
}
pub fn dialogue_schema() -> Value {
    let string = json!({"type":"string"});
    object(
        json!({"reply":string,"understanding":{"type":"array","items":object(json!({"id":string,"parentId":string,"label":string,"status":{"type":"string","enum":["clear","assumed","unknown"]},"evidence":string}))},"waiting":{"type":"array","items":object(json!({"key":string,"reason":string}))},"plan":plan_schema()}),
    )
}
pub fn valid_dialogue(v: &Value) -> bool {
    if !(text(&v["reply"], 12000)
        && v["reply"].as_str().is_some_and(|s| !s.trim().is_empty())
        && valid_understanding(&v["understanding"])
        && valid_waiting(&v["waiting"])
        && valid_plan(&v["plan"])
        && v["plan"]["questions"]
            .as_array()
            .is_some_and(|a| a.len() <= 2))
    {
        return false;
    }
    let p = &v["plan"];
    let keys: HashSet<String> = p["goals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| format!("g:{}", g["id"].as_str().unwrap()))
        .chain(
            p["actions"]
                .as_array()
                .unwrap()
                .iter()
                .map(|a| format!("a:{}", a["id"].as_str().unwrap())),
        )
        .collect();
    let waiting = v["waiting"].as_array().unwrap();
    waiting
        .iter()
        .all(|w| keys.contains(w["key"].as_str().unwrap()))
        && (keys.is_empty()
            || !waiting.is_empty()
            || (p["questions"].as_array().unwrap().is_empty()
                && p["assumptions"].as_array().unwrap().is_empty()))
}
pub fn plan_schema() -> Value {
    let string = json!({"type":"string"});
    let strings = json!({"type":"array","items":string});
    let maybe_string = json!({"type":["string","null"]});
    let maybe_number = json!({"type":["integer","null"]});
    let nullable = |s: Value| json!({"anyOf":[s,{"type":"null"}]});
    let conditions = object(json!({
      "training":nullable(object(json!({"intervalDays":maybe_number,"cycles":maybe_number,"exercises":{"type":"array","items":object(json!({"name":string,"sets":{"type":"integer"},"reps":{"type":"integer"},"unit":string}))}}))),
      "travel":nullable(object(json!({"origin":maybe_string,"destination":maybe_string,"budget":maybe_number,"purpose":maybe_string,"transport":maybe_string,"accommodation":maybe_string}))),
      "shopping":nullable(object(json!({"name":string,"amount":string,"category":string}))),
      "meals":nullable(object(json!({"people":maybe_number,"budget":maybe_number,"dietaryPreference":maybe_string,"allergies":maybe_string,"healthGoal":maybe_string})))
    }));
    let goal = object(
        json!({"id":string,"parentId":string,"title":string,"criterion":string,"status":{"type":"string","enum":["active","paused","completed"]},"reviewDate":string}),
    );
    let draft = object(
        json!({"title":string,"notes":string,"horizon":{"type":"string","enum":["short","mid","long"]},"priority":{"type":"string","enum":["normal","important"]},"startDate":string,"dueDate":string}),
    );
    let action = object(
        json!({"id":string,"goalId":string,"dependsOn":strings,"minutes":{"type":"integer"},"energy":{"type":"string","enum":["low","normal","high"]},"blocker":string,"deferredUntil":string,"destination":{"type":"string","enum":["task","fitness","travel","shopping-list","meal-planner","work-monitor","bead-studio"]},"targetId":string,"targetDate":string,"existingTaskId":string,"draft":draft,"conditions":conditions}),
    );
    object(
        json!({"summary":string,"questions":strings,"assumptions":strings,"later":strings,"goals":{"type":"array","items":goal},"actions":{"type":"array","items":action}}),
    )
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoalCommit {
    pub expected_revision: u64,
    pub operation_id: String,
    pub next: Value,
    pub create_tasks: Vec<crate::tasks::TaskRecord>,
    #[serde(default)]
    pub update_tasks: Vec<crate::tasks::TaskRecord>,
    pub checks: Vec<TaskCheck>,
    pub undo: bool,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskCheck {
    pub id: String,
    pub updated_at: String,
}
#[derive(Debug, serde::Serialize)]
pub struct GoalReply {
    pub state: Value,
    pub tasks: Vec<crate::tasks::TaskRecord>,
}
#[tauri::command]
pub fn get_goal_state(
    store: tauri::State<'_, crate::tasks::TaskStore>,
) -> Result<Option<Value>, String> {
    store.goal_state()
}
#[tauri::command]
pub fn commit_goal_changes(
    request: GoalCommit,
    store: tauri::State<'_, crate::tasks::TaskStore>,
) -> Result<GoalReply, String> {
    store.commit_goals(request)
}

//! Validate documents before destructive restore, including nested render inputs.
use chrono::NaiveDate;
use serde_json::Value;
use std::collections::HashSet;
fn bead_identity(c: &Value) -> bool {
    if ["brand", "code", "catalog"]
        .iter()
        .all(|k| c.get(*k).is_none())
    {
        return true;
    }
    let Some(brand) = c["brand"].as_str() else {
        return false;
    };
    if !["MARD", "COCO", "漫漫", "盼盼", "咪小窝"].contains(&brand)
        || c["catalog"] != "zippland-2519daf-regular"
    {
        return false;
    }
    static CATALOG: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    let catalog = CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/beads/palettes/catalog.json"))
            .expect("bundled bead catalog")
    });
    catalog.as_object().unwrap().iter().any(|(hex, row)| {
        let code = row["MARD"].as_str().unwrap_or("");
        matches!(code.as_bytes().first(), Some(b'A'..=b'H' | b'M'))
            && code.len() > 1
            && code[1..].bytes().all(|c| c.is_ascii_digit())
            && row[brand] == c["code"]
            && c["hex"]
                .as_str()
                .is_some_and(|value| value.eq_ignore_ascii_case(hex))
    })
}
fn strings(v: &Value, keys: &[&str]) -> bool {
    keys.iter().all(|k| {
        v[*k]
            .as_str()
            .is_some_and(|s| s.encode_utf16().count() <= 12000)
    })
}
fn number(v: &Value, min: f64, max: f64) -> bool {
    v.as_f64()
        .is_some_and(|n| n.is_finite() && n >= min && n <= max)
}
fn integer(v: &Value, min: i64, max: i64) -> bool {
    v.as_i64().is_some_and(|n| n >= min && n <= max)
}
fn date(v: &Value) -> Option<NaiveDate> {
    let s = v.as_str()?;
    if s.len() != 10 {
        return None;
    }
    let d = NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()?;
    (d.format("%Y-%m-%d").to_string() == s).then_some(d)
}
fn time(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.len() == 5
            && s.as_bytes()[2] == b':'
            && s[..2].parse::<u8>().is_ok_and(|n| n < 24)
            && s[3..].parse::<u8>().is_ok_and(|n| n < 60)
    })
}
fn list(v: &Value, max: usize, valid: impl Fn(&Value) -> bool) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() <= max && a.iter().all(valid))
}
fn records(v: &Value, max: usize, valid: impl Fn(&Value) -> bool) -> bool {
    let mut ids = HashSet::new();
    v.as_array().is_some_and(|a| {
        a.len() <= max
            && a.iter().all(|x| {
                x["id"]
                    .as_str()
                    .is_some_and(|id| !id.is_empty() && ids.insert(id))
                    && valid(x)
            })
    })
}
fn nonempty(v: &Value) -> bool {
    v.as_str().is_some_and(|s| !s.trim().is_empty())
}
fn point(v: &Value) -> bool {
    v.as_array()
        .is_some_and(|a| a.len() == 2 && number(&a[0], -180., 180.) && number(&a[1], -90., 90.))
}
fn life(v: &Value) -> bool {
    v["version"] == 1
        && records(&v["people"], 500, |p| {
            strings(
                p,
                &[
                    "name",
                    "birthday",
                    "relationship",
                    "dietary",
                    "preferences",
                    "hobbies",
                    "strengths",
                    "healthNotes",
                    "notes",
                ],
            ) && nonempty(&p["name"])
                && (p["birthday"] == "" || date(&p["birthday"]).is_some())
                && p["archived"].is_boolean()
        })
        && records(&v["training"], 500, |p| {
            strings(p, &["title", "personId", "startDate", "goal", "advice"])
                && nonempty(&p["title"])
                && date(&p["startDate"]).is_some_and(|d| {
                    d.checked_add_signed(chrono::Duration::days(
                        (p["cycles"].as_i64().unwrap_or(0).clamp(0, 104) - 1)
                            * p["intervalDays"].as_i64().unwrap_or(0).clamp(0, 90),
                    ))
                    .is_some_and(|end| end.format("%Y").to_string().len() == 4)
                })
                && integer(&p["intervalDays"], 1, 90)
                && integer(&p["cycles"], 1, 104)
                && p["archived"].is_boolean()
                && (p.get("review").is_none() || p["review"].is_string())
                && p["exercises"].as_array().is_some_and(|a| !a.is_empty())
                && records(&p["exercises"], 30, |e| {
                    strings(e, &["name", "unit"])
                        && nonempty(&e["name"])
                        && nonempty(&e["unit"])
                        && integer(&e["sets"], 1, 30)
                        && integer(&e["reps"], 1, 1000)
                })
        })
        && records(&v["workouts"], 10000, |w| {
            strings(w, &["planId", "date", "notes", "updatedAt"])
                && date(&w["date"]).is_some()
                && w["completed"].is_boolean()
                && w["actual"]
                    .as_object()
                    .is_some_and(|a| a.values().all(|a| list(a, 30, |n| number(n, 0., 10000.))))
        })
        && records(&v["trips"], 500, |t| {
            strings(
                t,
                &[
                    "title",
                    "origin",
                    "destination",
                    "startDate",
                    "endDate",
                    "purpose",
                    "preferences",
                    "transport",
                    "accommodation",
                    "summary",
                ],
            ) && ["title", "origin", "destination"]
                .iter()
                .all(|k| nonempty(&t[*k]))
                && date(&t["startDate"])
                    .zip(date(&t["endDate"]))
                    .is_some_and(|(s, e)| (0..=29).contains(&(e - s).num_days()))
                && number(&t["budget"], 1., 10000000.)
                && t["participantIds"]
                    .as_array()
                    .is_some_and(|a| !a.is_empty())
                && list(&t["participantIds"], 500, Value::is_string)
                && records(&t["stops"], 180, |s| {
                    strings(s, &["name", "address", "date", "time", "kind", "notes"])
                        && nonempty(&s["name"])
                        && date(&s["date"]).is_some()
                        && s["date"].as_str() >= t["startDate"].as_str()
                        && s["date"].as_str() <= t["endDate"].as_str()
                        && time(&s["time"])
                        && number(&s["cost"], 0., f64::MAX)
                        && (s.get("place").is_none_or(Value::is_null)
                            || (strings(&s["place"], &["name", "address"])
                                && number(&s["place"]["lng"], -180., 180.)
                                && number(&s["place"]["lat"], -90., 90.)))
                })
                && list(&t["routes"], 1000, |r| {
                    strings(r, &["fromId", "toId", "mode"])
                        && number(&r["distance"], 0., f64::MAX)
                        && number(&r["duration"], 0., f64::MAX)
                        && list(&r["points"], 50000, point)
                })
        })
}
pub fn valid(key: &str, v: &Value) -> bool {
    match key {
        "tideplan.assistant.v1" => crate::assistant::valid_state(v),
        "tideplan.goals.v1" => crate::goals::valid_state(v),
        "tideplan.life.v1" => life(v),
        "tideplan.reminders.v1" => {
            v["enabled"].is_boolean()
                && v["times"]
                    .as_array()
                    .is_some_and(|a| a.len() == 2 && a.iter().all(time))
                && (v.get("countdownAdvanceDays").is_none()
                    || integer(&v["countdownAdvanceDays"], 0, 365))
        }
        "tideplan.shopping-checked.v1" => list(v, 10000, Value::is_string),
        "tideplan.purchase-list.v1" => records(v, 10000, |p| {
            strings(p, &["name", "amount", "category", "createdAt", "updatedAt"])
                && p["checked"].is_boolean()
                && matches!(p["source"].as_str(), Some("manual" | "ai-recipe"))
        }),
        "tideplan.countdowns.v1" => records(v, 10000, |p| {
            strings(p, &["title", "notes", "createdAt", "updatedAt"])
                && date(&p["targetDate"]).is_some()
        }),
        "tideplan.meal-preferences.v1" => {
            strings(v, &["dietaryPreference", "allergies", "healthGoal"])
                && integer(&v["people"], 1, 12)
                && (number(&v["budget"], 1., 1000000.)
                    || matches!(v["budget"].as_str(), Some("节省" | "适中" | "宽裕")))
        }
        "tideplan.meal-plan.v1" => {
            v.is_null()
                || (strings(v, &["planTitle", "weekSummary"])
                    && list(&v["days"], 7, |d| {
                        integer(&d["dayIndex"], 0, 7)
                            && strings(d, &["weekday"])
                            && ["breakfast", "lunch", "dinner"]
                                .iter()
                                .all(|k| strings(&d[*k], &["name", "note"]))
                    })
                    && list(&v["shoppingList"], 1000, |c| {
                        strings(c, &["category"])
                            && list(&c["items"], 10000, |i| strings(i, &["name", "amount"]))
                    }))
        }
        "tideplan.bead-pattern.v1" => {
            v.is_null()
                || (v["version"] == 1
                    && strings(v, &["title"])
                    && v["title"]
                        .as_str()
                        .is_some_and(|s| s.encode_utf16().count() <= 80)
                    && integer(&v["width"], 1, 160)
                    && integer(&v["height"], 1, 160)
                    && (v.get("beadPitchMm").is_none() || number(&v["beadPitchMm"], 0.5, 20.))
                    && v["palette"].as_array().is_some_and(|a| !a.is_empty())
                    && list(&v["palette"], 256, |c| {
                        bead_identity(c)
                            && strings(c, &["name"])
                            && c["name"]
                                .as_str()
                                .is_some_and(|s| s.encode_utf16().count() <= 40)
                            && c["hex"].as_str().is_some_and(|s| {
                                s.len() == 7
                                    && s.starts_with('#')
                                    && s[1..].bytes().all(|c| c.is_ascii_hexdigit())
                            })
                    })
                    && v["cells"].as_array().is_some_and(|a| {
                        a.len() as i64
                            == v["width"].as_i64().unwrap_or(0) * v["height"].as_i64().unwrap_or(0)
                            && a.iter().all(|c| {
                                integer(
                                    c,
                                    -1,
                                    v["palette"].as_array().map_or(0, |p| p.len()) as i64 - 1,
                                )
                            })
                    }))
        }
        _ => false,
    }
}

#[cfg(test)]
mod bead_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn branded_beads_restore_only_with_matching_catalog_identity() {
        let mut p = json!({"version":1,"title":"test","width":1,"height":1,"cells":[0],"palette":[{"hex":"#faf4c8","name":"MARD","brand":"MARD","code":"A01","catalog":"zippland-2519daf-regular"}]});
        assert!(valid("tideplan.bead-pattern.v1", &p));
        p["palette"][0]["code"] = json!("A99");
        assert!(!valid("tideplan.bead-pattern.v1", &p));
        p["palette"][0] = json!({"hex":"#faf4c8","name":"legacy"});
        assert!(valid("tideplan.bead-pattern.v1", &p));
        p["palette"][0]["brand"] = json!("MARD");
        assert!(!valid("tideplan.bead-pattern.v1", &p));
    }
}

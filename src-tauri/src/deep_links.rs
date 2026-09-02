use chrono::NaiveDate;
use percent_encoding::percent_decode_str;
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use url::Url;
use uuid::Uuid;

const MAX_URL_BYTES: usize = 2048;
const MAX_PENDING_MESSAGES: usize = 32;
pub const DEEP_LINK_EVENT: &str = "oceanseo-deep-link";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "route")]
pub enum DeepLinkAction {
    Open {
        task_id: String,
        mutates_task: bool,
    },
    New {
        requires_user_save: bool,
        title: String,
        horizon: String,
        priority: String,
        start_date: Option<String>,
        due_date: Option<String>,
        source_label: Option<String>,
        source_ref: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "outcome")]
pub enum DeepLinkMessage {
    Accepted {
        correlation_id: String,
        #[serde(flatten)]
        action: DeepLinkAction,
    },
    Rejected {
        correlation_id: String,
        error_code: String,
    },
}

#[derive(Default)]
pub struct DeepLinkQueue {
    pending: Mutex<VecDeque<DeepLinkMessage>>,
}

impl DeepLinkQueue {
    fn push(&self, message: DeepLinkMessage) {
        if let Ok(mut pending) = self.pending.lock() {
            if pending.len() >= MAX_PENDING_MESSAGES {
                pending.pop_front();
            }
            pending.push_back(message);
        }
    }

    fn take_all(&self) -> Vec<DeepLinkMessage> {
        self.pending
            .lock()
            .map(|mut pending| pending.drain(..).collect())
            .unwrap_or_default()
    }
}

pub fn receive_url<R: Runtime>(app: &AppHandle<R>, raw_url: &str) {
    let correlation_id = Uuid::new_v4().to_string();
    let message = match parse_deep_link(raw_url) {
        Ok(action) => {
            let route = match &action {
                DeepLinkAction::Open { .. } => "open",
                DeepLinkAction::New { .. } => "new",
            };
            eprintln!(
                "oceanseo_deep_link route={route} version=1 outcome=accepted correlation_id={correlation_id}"
            );
            DeepLinkMessage::Accepted {
                correlation_id,
                action,
            }
        }
        Err(error_code) => {
            eprintln!(
                "oceanseo_deep_link route=unknown version=unknown outcome=rejected error_code={error_code} correlation_id={correlation_id}"
            );
            DeepLinkMessage::Rejected {
                correlation_id,
                error_code: error_code.to_string(),
            }
        }
    };

    app.state::<DeepLinkQueue>().push(message);
    let _ = app.emit(DEEP_LINK_EVENT, ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn deep_link_argument(args: &[String]) -> Option<&str> {
    args.iter()
        .skip(1)
        .find(|argument| argument.starts_with("oceanseo:"))
        .map(String::as_str)
}

pub fn parse_deep_link(raw_url: &str) -> Result<DeepLinkAction, &'static str> {
    if raw_url.len() > MAX_URL_BYTES {
        return Err("url_too_long");
    }
    let url = Url::parse(raw_url).map_err(|_| "malformed_url")?;
    if url.scheme() != "oceanseo" {
        return Err("unsupported_scheme");
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("userinfo_not_allowed");
    }
    if url.port().is_some() {
        return Err("port_not_allowed");
    }
    if url.fragment().is_some() {
        return Err("fragment_not_allowed");
    }
    if url.host_str() != Some("tasks") {
        return Err("unsupported_route");
    }

    let segments: Vec<_> = url
        .path_segments()
        .ok_or("unsupported_route")?
        .filter(|segment| !segment.is_empty())
        .collect();
    if segments.len() != 2 {
        return Err("unsupported_route");
    }
    if segments[0] != "v1" {
        return Err("unsupported_version");
    }

    let query = parse_query(url.query().unwrap_or_default())?;
    match segments[1] {
        "open" => parse_open(query),
        "new" => parse_new(query),
        _ => Err("unsupported_route"),
    }
}

fn parse_open(query: HashMap<String, String>) -> Result<DeepLinkAction, &'static str> {
    for key in query.keys() {
        if key != "id" {
            return Err(classify_unknown_key(key));
        }
    }
    let id = query.get("id").ok_or("missing_id")?;
    Uuid::parse_str(id).map_err(|_| "invalid_id")?;
    Ok(DeepLinkAction::Open {
        task_id: id.clone(),
        mutates_task: false,
    })
}

fn parse_new(query: HashMap<String, String>) -> Result<DeepLinkAction, &'static str> {
    const ALLOWED: &[&str] = &[
        "title",
        "horizon",
        "priority",
        "start_date",
        "due_date",
        "source_label",
        "source_ref",
    ];
    for key in query.keys() {
        if !ALLOWED.contains(&key.as_str()) {
            return Err(classify_unknown_key(key));
        }
    }

    let title = query.get("title").ok_or("missing_title")?.clone();
    if title.is_empty() {
        return Err("missing_title");
    }
    if title.chars().count() > 200 {
        return Err("value_too_long");
    }
    let horizon = query.get("horizon").map(String::as_str).unwrap_or("short");
    if !matches!(horizon, "short" | "mid" | "long") {
        return Err("invalid_horizon");
    }
    let priority = query
        .get("priority")
        .map(String::as_str)
        .unwrap_or("normal");
    if !matches!(priority, "normal" | "important") {
        return Err("invalid_priority");
    }
    let start_date = optional_nonempty(&query, "start_date")?;
    let due_date = optional_nonempty(&query, "due_date")?;
    if let Some(date) = start_date.as_deref() {
        validate_date(date)?;
    }
    if let Some(date) = due_date.as_deref() {
        validate_date(date)?;
    }
    let source_label = optional_nonempty(&query, "source_label")?;
    if source_label
        .as_ref()
        .is_some_and(|value| value.chars().count() > 80)
    {
        return Err("value_too_long");
    }
    let source_ref = optional_nonempty(&query, "source_ref")?;
    if let Some(reference) = &source_ref {
        if reference.len() > 128 {
            return Err("value_too_long");
        }
        if !reference
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
        {
            return Err("invalid_source_ref");
        }
    }

    Ok(DeepLinkAction::New {
        requires_user_save: true,
        title,
        horizon: horizon.to_string(),
        priority: priority.to_string(),
        start_date,
        due_date,
        source_label,
        source_ref,
    })
}

fn optional_nonempty(
    query: &HashMap<String, String>,
    key: &'static str,
) -> Result<Option<String>, &'static str> {
    match query.get(key) {
        Some(value) if value.is_empty() => Err("empty_optional_value"),
        Some(value) => Ok(Some(value.clone())),
        None => Ok(None),
    }
}

fn validate_date(value: &str) -> Result<(), &'static str> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map(|_| ())
        .map_err(|_| "invalid_date")
}

fn classify_unknown_key(key: &str) -> &'static str {
    if matches!(
        key,
        "notes"
            | "client_name"
            | "order_intake"
            | "relationship"
            | "location"
            | "message"
            | "media"
            | "credential"
            | "token"
    ) {
        "forbidden_query_field"
    } else {
        "unknown_query_field"
    }
}

fn parse_query(raw_query: &str) -> Result<HashMap<String, String>, &'static str> {
    if raw_query.is_empty() {
        return Ok(HashMap::new());
    }
    let mut result = HashMap::new();
    let mut seen = HashSet::new();
    for pair in raw_query.split('&') {
        if pair.is_empty() {
            return Err("malformed_query");
        }
        let (raw_key, raw_value) = pair.split_once('=').ok_or("malformed_query")?;
        let key = strict_percent_decode(raw_key)?;
        let value = strict_percent_decode(raw_value)?;
        if key.is_empty() {
            return Err("malformed_query");
        }
        if !seen.insert(key.clone()) {
            return Err("duplicate_query_field");
        }
        result.insert(key, value);
    }
    Ok(result)
}

fn strict_percent_decode(value: &str) -> Result<String, &'static str> {
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
            {
                return Err("malformed_encoding");
            }
            index += 3;
        } else {
            index += 1;
        }
    }
    percent_decode_str(value)
        .decode_utf8()
        .map(|decoded| decoded.into_owned())
        .map_err(|_| "malformed_encoding")
}

#[tauri::command]
pub fn take_pending_deep_links(queue: tauri::State<'_, DeepLinkQueue>) -> Vec<DeepLinkMessage> {
    queue.take_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_open_and_review_draft_without_mutation() {
        assert_eq!(
            parse_deep_link("oceanseo://tasks/v1/open?id=11111111-1111-4111-8111-111111111111"),
            Ok(DeepLinkAction::Open {
                task_id: "11111111-1111-4111-8111-111111111111".to_string(),
                mutates_task: false,
            })
        );

        let action = parse_deep_link(
            "oceanseo://tasks/v1/new?title=Review%20synthetic%20delivery&horizon=short&priority=important&due_date=2026-09-03&source_label=Fiverr&source_ref=order:sample-001",
        )
        .unwrap();
        assert!(matches!(
            action,
            DeepLinkAction::New {
                requires_user_save: true,
                title,
                due_date: Some(date),
                ..
            } if title == "Review synthetic delivery" && date == "2026-09-03"
        ));
    }

    #[test]
    fn parses_utf8_encoding_and_defaults() {
        let action = parse_deep_link(
            "oceanseo://tasks/v1/new?title=%E6%A3%80%E6%9F%A5%E5%90%88%E6%88%90%E4%BB%BB%E5%8A%A1",
        )
        .unwrap();
        assert!(matches!(
            action,
            DeepLinkAction::New { title, horizon, priority, .. }
                if title == "检查合成任务" && horizon == "short" && priority == "normal"
        ));
    }

    #[test]
    fn rejects_malformed_encoding_unknown_forbidden_and_duplicates() {
        assert_eq!(
            parse_deep_link("oceanseo://tasks/v1/new?title=%E6%A"),
            Err("malformed_encoding")
        );
        assert_eq!(
            parse_deep_link("oceanseo://tasks/v1/new?title=%FF"),
            Err("malformed_encoding")
        );
        assert_eq!(
            parse_deep_link("oceanseo://tasks/v1/new?title=Task&unknown=value"),
            Err("unknown_query_field")
        );
        assert_eq!(
            parse_deep_link("oceanseo://tasks/v1/new?title=Task&notes=private"),
            Err("forbidden_query_field")
        );
        assert_eq!(
            parse_deep_link("oceanseo://tasks/v1/new?title=One&title=Two"),
            Err("duplicate_query_field")
        );
        assert_eq!(
            parse_deep_link("oceanseo://tasks/v1/new?title=One&%74itle=Two"),
            Err("duplicate_query_field")
        );
    }

    #[test]
    fn rejects_oversized_values_urls_and_missing_ids() {
        let long_title = "x".repeat(201);
        assert_eq!(
            parse_deep_link(&format!("oceanseo://tasks/v1/new?title={long_title}")),
            Err("value_too_long")
        );
        let oversized = format!("oceanseo://tasks/v1/new?title={}", "x".repeat(2050));
        assert_eq!(parse_deep_link(&oversized), Err("url_too_long"));
        assert_eq!(
            parse_deep_link("oceanseo://tasks/v1/open"),
            Err("missing_id")
        );
        assert_eq!(
            parse_deep_link("oceanseo://tasks/v1/open?id=not-a-uuid"),
            Err("invalid_id")
        );
    }

    #[test]
    fn rejects_unsupported_structure_userinfo_ports_and_fragments() {
        assert_eq!(
            parse_deep_link("oceanseo://tasks/v2/new?title=Task"),
            Err("unsupported_version")
        );
        assert_eq!(
            parse_deep_link("oceanseo://user@tasks/v1/new?title=Task"),
            Err("userinfo_not_allowed")
        );
        assert_eq!(
            parse_deep_link("oceanseo://tasks:42/v1/new?title=Task"),
            Err("port_not_allowed")
        );
        assert_eq!(
            parse_deep_link("oceanseo://tasks/v1/new?title=Task#fragment"),
            Err("fragment_not_allowed")
        );
    }

    #[test]
    fn repeated_launches_only_produce_review_actions() {
        let url = "oceanseo://tasks/v1/new?title=Review";
        let first = parse_deep_link(url).unwrap();
        let second = parse_deep_link(url).unwrap();
        assert_eq!(first, second);
        assert!(matches!(
            first,
            DeepLinkAction::New {
                requires_user_save: true,
                ..
            }
        ));
    }
}

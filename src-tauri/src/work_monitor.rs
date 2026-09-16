use chrono::{
    DateTime, Datelike, Duration as ChronoDuration, Local, NaiveTime, SecondsFormat, TimeZone, Utc,
};
use reqwest::Client;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::Duration,
};
use tauri::Manager;
use uuid::Uuid;

use crate::ai_settings::AiSettingsStore;

const SYNC_RESULT_PREFIX: &str = "OCEANSEO_SYNC_RESULT:";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkMonitorConfig {
    pub enabled: bool,
    pub workspace_root: String,
    pub gworkspace_root: String,
    pub schedule_weekday: u8,
    pub schedule_time: String,
    pub significance_threshold: u8,
    pub excluded_projects: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkProject {
    pub id: String,
    pub name: String,
    pub branch: String,
    pub version: Option<String>,
    pub commit_count: u32,
    pub changed_file_count: u32,
    pub untracked_file_count: u32,
    pub latest_commit: Option<String>,
    pub latest_commit_at: Option<String>,
    pub activity_score: u8,
    pub activity_status: String,
    pub last_scanned_at: String,
    pub target_public_id: Option<String>,
    pub target_title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkScan {
    pub id: String,
    pub started_at: String,
    pub finished_at: String,
    pub project_count: u32,
    pub active_count: u32,
    pub significant_count: u32,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkReport {
    pub id: String,
    pub scan_id: String,
    pub weekly_summary: String,
    pub feedback: String,
    pub project_analysis: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkDraft {
    pub id: String,
    pub report_id: String,
    pub scan_id: String,
    pub project_id: String,
    pub project_name: String,
    pub target_public_id: Option<String>,
    pub target_title: Option<String>,
    pub highlight_zh: String,
    pub highlight_en: String,
    pub evidence: Vec<String>,
    pub status: String,
    pub created_at: String,
    pub synced_at: Option<String>,
    pub sync_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkDashboard {
    pub config: WorkMonitorConfig,
    pub next_scheduled_at: String,
    pub projects: Vec<WorkProject>,
    pub latest_scan: Option<WorkScan>,
    pub recent_scans: Vec<WorkScan>,
    pub latest_report: Option<WorkReport>,
    pub drafts: Vec<WorkDraft>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GWorkspaceProject {
    pub public_id: String,
    pub slug: String,
    pub title: LocalizedTitle,
    pub status: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalizedTitle {
    pub zh: String,
    pub en: String,
}

#[derive(Debug, Deserialize)]
struct CatalogEnvelope {
    schema_version: String,
    projects: Vec<GWorkspaceProject>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisProjectInput {
    project_id: String,
    project_name: String,
    version: Option<String>,
    commit_count: u32,
    changed_file_count: u32,
    untracked_file_count: u32,
    activity_score: u8,
    commit_titles: Vec<String>,
    changed_paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiWorkReport {
    weekly_summary: String,
    feedback: String,
    projects: Vec<AiProjectAnalysis>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiProjectAnalysis {
    project_id: String,
    status: String,
    summary: String,
    risk: String,
    next_step: String,
    should_sync: bool,
    highlight_zh: String,
    highlight_en: String,
}

#[derive(Debug)]
struct ScannedProject {
    path: String,
    name: String,
    branch: String,
    version: Option<String>,
    head: String,
    commit_titles: Vec<String>,
    changed_paths: Vec<String>,
    untracked_file_count: u32,
    latest_commit: Option<String>,
    latest_commit_at: Option<String>,
}

#[derive(Debug)]
struct PreviousProjectState {
    snapshot_hash: String,
    version: Option<String>,
    id: String,
    last_scanned_at: String,
}

pub struct WorkMonitorStore {
    connection: Mutex<Connection>,
    scan_lock: Mutex<()>,
    export_dir: PathBuf,
}

impl WorkMonitorStore {
    pub fn open(database_path: &Path, export_dir: PathBuf) -> Result<Self, String> {
        let parent = database_path.parent().ok_or("work_monitor_path_invalid")?;
        fs::create_dir_all(parent).map_err(|_| "work_monitor_directory_failed")?;
        fs::create_dir_all(&export_dir).map_err(|_| "work_monitor_export_directory_failed")?;
        let connection = Connection::open(database_path).map_err(|_| "work_monitor_open_failed")?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|_| "work_monitor_config_failed")?;
        connection
            .execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .map_err(|_| "work_monitor_config_failed")?;
        let store = Self {
            connection: Mutex::new(connection),
            scan_lock: Mutex::new(()),
            export_dir,
        };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<(), String> {
        self.connection
            .lock()
            .map_err(|_| "work_monitor_lock_failed")?
            .execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS work_monitor_config (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
                    workspace_root TEXT NOT NULL,
                    gworkspace_root TEXT NOT NULL,
                    schedule_weekday INTEGER NOT NULL CHECK (schedule_weekday BETWEEN 0 AND 6),
                    schedule_time TEXT NOT NULL,
                    significance_threshold INTEGER NOT NULL CHECK (significance_threshold BETWEEN 10 AND 100),
                    excluded_projects_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT OR IGNORE INTO work_monitor_config VALUES (
                    1, 1,
                    '/home/gellar/Desktop/program/personal',
                    '/home/gellar/Desktop/program/personal/GWorkspace',
                    0, '09:30', 45, '[]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                );

                CREATE TABLE IF NOT EXISTS work_projects (
                    id TEXT PRIMARY KEY,
                    path TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    version TEXT NULL,
                    snapshot_hash TEXT NOT NULL,
                    target_public_id TEXT NULL,
                    target_title TEXT NULL,
                    last_scanned_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS work_scans (
                    id TEXT PRIMARY KEY,
                    started_at TEXT NOT NULL,
                    finished_at TEXT NOT NULL,
                    project_count INTEGER NOT NULL,
                    active_count INTEGER NOT NULL,
                    significant_count INTEGER NOT NULL,
                    summary TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_work_scans_finished ON work_scans(finished_at DESC, id);

                CREATE TABLE IF NOT EXISTS work_scan_projects (
                    scan_id TEXT NOT NULL REFERENCES work_scans(id) ON DELETE CASCADE,
                    project_id TEXT NOT NULL REFERENCES work_projects(id) ON DELETE CASCADE,
                    branch TEXT NOT NULL,
                    version TEXT NULL,
                    commit_count INTEGER NOT NULL,
                    changed_file_count INTEGER NOT NULL,
                    untracked_file_count INTEGER NOT NULL,
                    latest_commit TEXT NULL,
                    latest_commit_at TEXT NULL,
                    activity_score INTEGER NOT NULL,
                    activity_status TEXT NOT NULL CHECK (activity_status IN ('steady', 'active', 'significant')),
                    commit_titles_json TEXT NOT NULL,
                    changed_paths_json TEXT NOT NULL,
                    PRIMARY KEY (scan_id, project_id)
                );
                CREATE INDEX IF NOT EXISTS idx_work_scan_projects_score ON work_scan_projects(scan_id, activity_score DESC, project_id);

                CREATE TABLE IF NOT EXISTS work_reports (
                    id TEXT PRIMARY KEY,
                    scan_id TEXT UNIQUE NOT NULL REFERENCES work_scans(id) ON DELETE CASCADE,
                    weekly_summary TEXT NOT NULL,
                    feedback TEXT NOT NULL,
                    project_analysis_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS work_sync_drafts (
                    id TEXT PRIMARY KEY,
                    report_id TEXT NOT NULL REFERENCES work_reports(id) ON DELETE CASCADE,
                    scan_id TEXT NOT NULL REFERENCES work_scans(id) ON DELETE CASCADE,
                    project_id TEXT NOT NULL REFERENCES work_projects(id) ON DELETE CASCADE,
                    target_public_id TEXT NULL,
                    target_title TEXT NULL,
                    highlight_zh TEXT NOT NULL,
                    highlight_en TEXT NOT NULL,
                    evidence_json TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('pending', 'synced', 'rejected')),
                    created_at TEXT NOT NULL,
                    synced_at TEXT NULL,
                    sync_error TEXT NULL,
                    UNIQUE(report_id, project_id)
                );
                CREATE INDEX IF NOT EXISTS idx_work_drafts_status ON work_sync_drafts(status, created_at DESC);
                "#,
            )
            .map_err(|_| "work_monitor_migration_failed".to_string())?;
        Ok(())
    }

    pub fn config(&self) -> Result<WorkMonitorConfig, String> {
        self.connection
            .lock()
            .map_err(|_| "work_monitor_lock_failed".to_string())?
            .query_row(
                "SELECT enabled, workspace_root, gworkspace_root, schedule_weekday, schedule_time, significance_threshold, excluded_projects_json FROM work_monitor_config WHERE id = 1",
                [],
                |row| {
                    let excluded_json: String = row.get(6)?;
                    Ok(WorkMonitorConfig {
                        enabled: row.get::<_, i64>(0)? == 1,
                        workspace_root: row.get(1)?,
                        gworkspace_root: row.get(2)?,
                        schedule_weekday: row.get::<_, i64>(3)? as u8,
                        schedule_time: row.get(4)?,
                        significance_threshold: row.get::<_, i64>(5)? as u8,
                        excluded_projects: serde_json::from_str(&excluded_json).unwrap_or_default(),
                    })
                },
            )
            .map_err(|_| "work_monitor_config_read_failed".to_string())
    }

    pub fn save_config(&self, config: WorkMonitorConfig) -> Result<WorkMonitorConfig, String> {
        validate_config(&config)?;
        self.connection
            .lock()
            .map_err(|_| "work_monitor_lock_failed".to_string())?
            .execute(
                r#"
                UPDATE work_monitor_config SET enabled = ?1, workspace_root = ?2,
                    gworkspace_root = ?3, schedule_weekday = ?4, schedule_time = ?5,
                    significance_threshold = ?6, excluded_projects_json = ?7, updated_at = ?8
                WHERE id = 1
                "#,
                params![
                    config.enabled as i64,
                    config.workspace_root,
                    config.gworkspace_root,
                    config.schedule_weekday as i64,
                    config.schedule_time,
                    config.significance_threshold as i64,
                    serde_json::to_string(&config.excluded_projects)
                        .map_err(|_| "work_monitor_config_invalid")?,
                    now_timestamp()
                ],
            )
            .map_err(|_| "work_monitor_config_save_failed".to_string())?;
        self.config()
    }

    pub fn scan(&self) -> Result<WorkDashboard, String> {
        let _scan_guard = self
            .scan_lock
            .try_lock()
            .map_err(|_| "work_scan_already_running")?;
        let config = self.config()?;
        validate_config(&config)?;
        let root =
            fs::canonicalize(&config.workspace_root).map_err(|_| "workspace_root_unavailable")?;
        let excluded: HashSet<_> = config
            .excluded_projects
            .iter()
            .map(|name| name.as_str())
            .collect();
        let started_at = now_timestamp();
        let scan_id = Uuid::new_v4().to_string();
        let previous = self.previous_project_state()?;
        let mut scanned = Vec::new();

        let mut entries: Vec<_> = fs::read_dir(&root)
            .map_err(|_| "workspace_root_unavailable")?
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
            .collect();
        entries.sort_by_key(|entry| entry.file_name());

        for entry in entries.into_iter().take(100) {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || excluded.contains(name.as_str()) {
                continue;
            }
            if let Some(project) = scan_git_project(
                &entry.path(),
                &name,
                previous.get(&entry.path().to_string_lossy().to_string()),
            ) {
                scanned.push(project);
            }
        }

        let finished_at = now_timestamp();
        self.persist_scan(
            &scan_id,
            &started_at,
            &finished_at,
            &scanned,
            &previous,
            config.significance_threshold,
        )?;
        self.dashboard()
    }

    fn previous_project_state(&self) -> Result<HashMap<String, PreviousProjectState>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "work_monitor_lock_failed".to_string())?;
        let mut statement = connection
            .prepare("SELECT path, snapshot_hash, version, id, last_scanned_at FROM work_projects")
            .map_err(|_| "work_monitor_projects_read_failed".to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    PreviousProjectState {
                        snapshot_hash: row.get(1)?,
                        version: row.get(2)?,
                        id: row.get(3)?,
                        last_scanned_at: row.get(4)?,
                    },
                ))
            })
            .map_err(|_| "work_monitor_projects_read_failed".to_string())?;
        rows.collect::<Result<HashMap<_, _>, _>>()
            .map_err(|_| "work_monitor_projects_read_failed".to_string())
    }

    fn persist_scan(
        &self,
        scan_id: &str,
        started_at: &str,
        finished_at: &str,
        scanned: &[ScannedProject],
        previous: &HashMap<String, PreviousProjectState>,
        threshold: u8,
    ) -> Result<(), String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "work_monitor_lock_failed".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|_| "work_scan_transaction_failed".to_string())?;
        let mut active_count = 0_u32;
        let mut significant_count = 0_u32;
        let mut persisted = Vec::new();

        for project in scanned {
            let prior = previous.get(&project.path);
            let project_id = prior
                .map(|item| item.id.clone())
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            let snapshot_hash = snapshot_hash(project);
            let version_changed = prior.and_then(|item| item.version.as_ref())
                != project.version.as_ref()
                && prior.is_some();
            let snapshot_changed =
                prior.map(|item| item.snapshot_hash.as_str()) != Some(snapshot_hash.as_str());
            let mut score = (project.commit_titles.len() as u32 * 18)
                + (project.changed_paths.len().min(12) as u32 * 4)
                + if version_changed { 25 } else { 0 }
                + if snapshot_changed { 8 } else { 0 };
            score = score.min(100);
            let status = if score >= threshold as u32 {
                significant_count += 1;
                "significant"
            } else if score > 0 {
                active_count += 1;
                "active"
            } else {
                "steady"
            };
            if status == "significant" {
                active_count += 1;
            }

            transaction.execute(
                r#"
                INSERT INTO work_projects(id, path, name, version, snapshot_hash, target_public_id, target_title, last_scanned_at)
                VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6)
                ON CONFLICT(path) DO UPDATE SET name = excluded.name, version = excluded.version,
                    snapshot_hash = excluded.snapshot_hash, last_scanned_at = excluded.last_scanned_at
                "#,
                params![project_id, project.path, project.name, project.version, snapshot_hash, finished_at],
            ).map_err(|_| "work_project_save_failed".to_string())?;
            persisted.push((project_id, project, score, status));
        }

        let summary = if scanned.is_empty() {
            "没有发现可扫描的 Git 项目。".to_string()
        } else {
            format!(
                "检查了 {} 个项目，{} 个近期活跃，{} 个达到明显变化阈值。",
                scanned.len(),
                active_count,
                significant_count
            )
        };
        transaction.execute(
            "INSERT INTO work_scans(id, started_at, finished_at, project_count, active_count, significant_count, summary) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![scan_id, started_at, finished_at, scanned.len() as i64, active_count, significant_count, summary],
        ).map_err(|_| "work_scan_save_failed".to_string())?;

        for (project_id, project, score, status) in persisted {
            transaction
                .execute(
                    r#"
                INSERT INTO work_scan_projects(
                    scan_id, project_id, branch, version, commit_count, changed_file_count,
                    untracked_file_count, latest_commit, latest_commit_at, activity_score,
                    activity_status, commit_titles_json, changed_paths_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                "#,
                    params![
                        scan_id,
                        project_id,
                        project.branch,
                        project.version,
                        project.commit_titles.len() as i64,
                        project.changed_paths.len() as i64,
                        project.untracked_file_count as i64,
                        project.latest_commit,
                        project.latest_commit_at,
                        score as i64,
                        status,
                        serde_json::to_string(&project.commit_titles)
                            .unwrap_or_else(|_| "[]".to_string()),
                        serde_json::to_string(&project.changed_paths)
                            .unwrap_or_else(|_| "[]".to_string())
                    ],
                )
                .map_err(|_| "work_scan_project_save_failed".to_string())?;
        }
        transaction
            .commit()
            .map_err(|_| "work_scan_commit_failed".to_string())
    }

    pub fn dashboard(&self) -> Result<WorkDashboard, String> {
        let config = self.config()?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| "work_monitor_lock_failed".to_string())?;
        let latest_scan = query_optional_scan(&connection, "SELECT id, started_at, finished_at, project_count, active_count, significant_count, summary FROM work_scans ORDER BY finished_at DESC, id DESC LIMIT 1")?;
        let mut recent_statement = connection.prepare("SELECT id, started_at, finished_at, project_count, active_count, significant_count, summary FROM work_scans ORDER BY finished_at DESC, id DESC LIMIT 8").map_err(|_| "work_scans_read_failed")?;
        let recent_scans = recent_statement
            .query_map([], scan_from_row)
            .map_err(|_| "work_scans_read_failed")?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "work_scans_read_failed")?;
        let projects = match latest_scan.as_ref() {
            Some(scan) => query_projects(&connection, &scan.id)?,
            None => Vec::new(),
        };
        let latest_report = query_optional_report(&connection)?;
        let drafts = query_drafts(&connection)?;
        Ok(WorkDashboard {
            next_scheduled_at: next_schedule(&config).to_rfc3339(),
            config,
            projects,
            latest_scan,
            recent_scans,
            latest_report,
            drafts,
        })
    }

    pub fn is_due(&self) -> Result<bool, String> {
        let config = self.config()?;
        if !config.enabled {
            return Ok(false);
        }
        let now = Local::now();
        let next = next_schedule(&config);
        let previous_due = next - ChronoDuration::weeks(1);
        let last_scan = self
            .connection
            .lock()
            .map_err(|_| "work_monitor_lock_failed".to_string())?
            .query_row(
                "SELECT finished_at FROM work_scans ORDER BY finished_at DESC LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|_| "work_scans_read_failed")?;
        Ok(now >= previous_due
            && last_scan
                .and_then(|value| DateTime::parse_from_rfc3339(&value).ok())
                .map(|value| value < previous_due.fixed_offset())
                .unwrap_or(true))
    }

    fn analysis_input(&self, scan_id: &str) -> Result<Vec<AnalysisProjectInput>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "work_monitor_lock_failed".to_string())?;
        let mut statement = connection.prepare(r#"
            SELECT p.id, p.name, sp.version, sp.commit_count, sp.changed_file_count,
                   sp.untracked_file_count, sp.activity_score, sp.commit_titles_json, sp.changed_paths_json
            FROM work_scan_projects sp JOIN work_projects p ON p.id = sp.project_id
            WHERE sp.scan_id = ?1 ORDER BY sp.activity_score DESC, p.id ASC
        "#).map_err(|_| "work_analysis_read_failed")?;
        let projects = statement
            .query_map([scan_id], |row| {
                let commits: String = row.get(7)?;
                let paths: String = row.get(8)?;
                Ok(AnalysisProjectInput {
                    project_id: row.get(0)?,
                    project_name: row.get(1)?,
                    version: row.get(2)?,
                    commit_count: row.get::<_, i64>(3)? as u32,
                    changed_file_count: row.get::<_, i64>(4)? as u32,
                    untracked_file_count: row.get::<_, i64>(5)? as u32,
                    activity_score: row.get::<_, i64>(6)? as u8,
                    commit_titles: serde_json::from_str(&commits).unwrap_or_default(),
                    changed_paths: serde_json::from_str(&paths).unwrap_or_default(),
                })
            })
            .map_err(|_| "work_analysis_read_failed")?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "work_analysis_read_failed".to_string())?;
        Ok(projects)
    }

    fn save_analysis(&self, scan_id: &str, report: &AiWorkReport) -> Result<WorkDashboard, String> {
        if report.weekly_summary.chars().count() > 1200 || report.feedback.chars().count() > 1200 {
            return Err("work_analysis_too_long".to_string());
        }
        let inputs = self.analysis_input(scan_id)?;
        let known: HashMap<_, _> = inputs
            .into_iter()
            .map(|input| (input.project_id.clone(), input))
            .collect();
        if report
            .projects
            .iter()
            .any(|item| !known.contains_key(&item.project_id))
        {
            return Err("work_analysis_unknown_project".to_string());
        }
        let created_at = now_timestamp();
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "work_monitor_lock_failed".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|_| "work_analysis_transaction_failed")?;
        let report_id = transaction
            .query_row(
                "SELECT id FROM work_reports WHERE scan_id = ?1",
                [scan_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|_| "work_analysis_read_failed")?
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        transaction.execute(
            r#"
            INSERT INTO work_reports(id, scan_id, weekly_summary, feedback, project_analysis_json, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(scan_id) DO UPDATE SET
                weekly_summary = excluded.weekly_summary,
                feedback = excluded.feedback,
                project_analysis_json = excluded.project_analysis_json,
                created_at = excluded.created_at
            "#,
            params![report_id, scan_id, report.weekly_summary, report.feedback, serde_json::to_string(&report.projects).map_err(|_| "work_analysis_invalid")?, created_at],
        ).map_err(|_| "work_analysis_save_failed")?;
        transaction
            .execute(
                "DELETE FROM work_sync_drafts WHERE report_id = ?1 AND status = 'pending'",
                [&report_id],
            )
            .map_err(|_| "work_analysis_replace_failed")?;

        for analysis in report.projects.iter().filter(|item| item.should_sync) {
            validate_ai_project(analysis)?;
            let input = known
                .get(&analysis.project_id)
                .ok_or("work_analysis_unknown_project")?;
            let mapping: (Option<String>, Option<String>) = transaction
                .query_row(
                    "SELECT target_public_id, target_title FROM work_projects WHERE id = ?1",
                    [&analysis.project_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(|_| "work_mapping_read_failed")?;
            let evidence = evidence_for(input);
            transaction.execute(r#"
                INSERT OR IGNORE INTO work_sync_drafts(
                    id, report_id, scan_id, project_id, target_public_id, target_title,
                    highlight_zh, highlight_en, evidence_json, status, created_at, synced_at, sync_error
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', ?10, NULL, NULL)
            "#, params![
                Uuid::new_v4().to_string(), report_id, scan_id, analysis.project_id,
                mapping.0, mapping.1, analysis.highlight_zh, analysis.highlight_en,
                serde_json::to_string(&evidence).unwrap_or_else(|_| "[]".to_string()), created_at
            ]).map_err(|_| "work_draft_save_failed")?;
        }
        transaction
            .commit()
            .map_err(|_| "work_analysis_commit_failed")?;
        drop(connection);
        self.dashboard()
    }

    pub fn set_mapping(
        &self,
        project_id: &str,
        target: Option<&GWorkspaceProject>,
    ) -> Result<WorkDashboard, String> {
        let (public_id, title) = target
            .map(|item| (Some(item.public_id.as_str()), Some(item.title.zh.as_str())))
            .unwrap_or((None, None));
        let connection = self
            .connection
            .lock()
            .map_err(|_| "work_monitor_lock_failed".to_string())?;
        let changed = connection
            .execute(
                "UPDATE work_projects SET target_public_id = ?1, target_title = ?2 WHERE id = ?3",
                params![public_id, title, project_id],
            )
            .map_err(|_| "work_mapping_save_failed")?;
        if changed != 1 {
            return Err("work_project_not_found".to_string());
        }
        connection.execute(
            "UPDATE work_sync_drafts SET target_public_id = ?1, target_title = ?2 WHERE project_id = ?3 AND status = 'pending'",
            params![public_id, title, project_id]
        ).map_err(|_| "work_mapping_save_failed")?;
        drop(connection);
        self.dashboard()
    }

    pub fn reject_draft(&self, draft_id: &str) -> Result<WorkDashboard, String> {
        let changed = self.connection.lock().map_err(|_| "work_monitor_lock_failed".to_string())?
            .execute("UPDATE work_sync_drafts SET status = 'rejected', sync_error = NULL WHERE id = ?1 AND status = 'pending'", [draft_id])
            .map_err(|_| "work_draft_reject_failed")?;
        if changed != 1 {
            return Err("work_draft_not_pending".to_string());
        }
        self.dashboard()
    }

    pub fn catalog(&self) -> Result<Vec<GWorkspaceProject>, String> {
        let config = self.config()?;
        let value = run_gworkspace_command(&config.gworkspace_root, &["catalog"])?;
        let catalog: CatalogEnvelope =
            serde_json::from_value(value).map_err(|_| "gworkspace_catalog_invalid")?;
        if catalog.schema_version != "1.0.0" {
            return Err("gworkspace_catalog_version_unsupported".to_string());
        }
        Ok(catalog.projects)
    }

    pub fn sync_draft(
        &self,
        draft_id: &str,
        target_project_id: &str,
        highlight_zh: &str,
        highlight_en: &str,
    ) -> Result<WorkDashboard, String> {
        if !valid_target_id(target_project_id) {
            return Err("gworkspace_target_invalid".to_string());
        }
        if highlight_zh.trim().is_empty()
            || highlight_en.trim().is_empty()
            || highlight_zh.chars().count() > 240
            || highlight_en.chars().count() > 240
        {
            return Err("work_draft_highlight_invalid".to_string());
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| "work_monitor_lock_failed".to_string())?;
        let draft = connection
            .query_row(
                r#"
            SELECT d.scan_id, d.project_id, d.evidence_json, d.status, p.last_scanned_at
            FROM work_sync_drafts d JOIN work_projects p ON p.id = d.project_id WHERE d.id = ?1
        "#,
                [draft_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| "work_draft_read_failed")?
            .ok_or("work_draft_not_found")?;
        if draft.3 != "pending" {
            return Err("work_draft_not_pending".to_string());
        }
        let config = self.config_locked(&connection)?;
        drop(connection);

        let evidence: Vec<String> = serde_json::from_str(&draft.2).unwrap_or_default();
        let payload = json!({
            "schema_version": "1.0.0",
            "update_id": draft_id,
            "source": { "system": "Oceanseo", "scan_id": draft.0, "observed_at": draft.4 },
            "target_project_id": target_project_id,
            "approved_at": now_timestamp(),
            "highlight": { "zh": highlight_zh.trim(), "en": highlight_en.trim() },
            "evidence": evidence
        });
        let export_path = self
            .export_dir
            .join(format!("project-update-{draft_id}.json"));
        fs::write(
            &export_path,
            serde_json::to_vec_pretty(&payload).map_err(|_| "work_sync_payload_invalid")?,
        )
        .map_err(|_| "work_sync_export_failed")?;
        let sync_result = run_gworkspace_command(
            &config.gworkspace_root,
            &["import", export_path.to_string_lossy().as_ref()],
        );
        let connection = self
            .connection
            .lock()
            .map_err(|_| "work_monitor_lock_failed".to_string())?;
        match sync_result {
            Ok(_) => {
                let synced_at = now_timestamp();
                connection.execute(
                    "UPDATE work_sync_drafts SET target_public_id = ?1, highlight_zh = ?2, highlight_en = ?3, status = 'synced', synced_at = ?4, sync_error = NULL WHERE id = ?5",
                    params![target_project_id, highlight_zh.trim(), highlight_en.trim(), synced_at, draft_id]
                ).map_err(|_| "work_sync_receipt_save_failed")?;
                connection
                    .execute(
                        "UPDATE work_projects SET target_public_id = ?1 WHERE id = ?2",
                        params![target_project_id, draft.1],
                    )
                    .map_err(|_| "work_mapping_save_failed")?;
            }
            Err(code) => {
                connection
                    .execute(
                        "UPDATE work_sync_drafts SET sync_error = ?1 WHERE id = ?2",
                        params![code, draft_id],
                    )
                    .ok();
                return Err("gworkspace_sync_failed".to_string());
            }
        }
        drop(connection);
        self.dashboard()
    }

    fn config_locked(&self, connection: &Connection) -> Result<WorkMonitorConfig, String> {
        connection.query_row(
            "SELECT enabled, workspace_root, gworkspace_root, schedule_weekday, schedule_time, significance_threshold, excluded_projects_json FROM work_monitor_config WHERE id = 1",
            [], |row| {
                let excluded: String = row.get(6)?;
                Ok(WorkMonitorConfig {
                    enabled: row.get::<_, i64>(0)? == 1, workspace_root: row.get(1)?, gworkspace_root: row.get(2)?,
                    schedule_weekday: row.get::<_, i64>(3)? as u8, schedule_time: row.get(4)?, significance_threshold: row.get::<_, i64>(5)? as u8,
                    excluded_projects: serde_json::from_str(&excluded).unwrap_or_default()
                })
            }
        ).map_err(|_| "work_monitor_config_read_failed".to_string())
    }
}

fn validate_config(config: &WorkMonitorConfig) -> Result<(), String> {
    if config.schedule_weekday > 6 || !(10..=100).contains(&config.significance_threshold) {
        return Err("work_monitor_config_invalid".to_string());
    }
    NaiveTime::parse_from_str(&config.schedule_time, "%H:%M")
        .map_err(|_| "work_monitor_schedule_invalid")?;
    for path in [&config.workspace_root, &config.gworkspace_root] {
        if !Path::new(path).is_absolute() {
            return Err("work_monitor_path_must_be_absolute".to_string());
        }
    }
    if config.excluded_projects.len() > 100
        || config
            .excluded_projects
            .iter()
            .any(|name| name.contains('/') || name.contains('\\'))
    {
        return Err("work_monitor_exclusions_invalid".to_string());
    }
    Ok(())
}

fn scan_git_project(
    path: &Path,
    name: &str,
    previous: Option<&PreviousProjectState>,
) -> Option<ScannedProject> {
    if !path.join(".git").exists() {
        return None;
    }
    let since = previous
        .map(|item| item.last_scanned_at.as_str())
        .unwrap_or_else(|| "7 days ago");
    let branch =
        git(path, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|| "detached".to_string());
    let head = git(path, &["rev-parse", "HEAD"]).unwrap_or_default();
    let status_output =
        git(path, &["status", "--short", "--untracked-files=normal"]).unwrap_or_default();
    let changed_paths: Vec<String> = status_output
        .lines()
        .filter_map(|line| {
            let value = line.get(3..)?.trim();
            if value.is_empty() {
                None
            } else {
                Some(value.chars().take(160).collect())
            }
        })
        .take(40)
        .collect();
    let untracked_file_count = status_output
        .lines()
        .filter(|line| line.starts_with("??"))
        .count() as u32;
    let log = git(
        path,
        &[
            "log",
            &format!("--since={since}"),
            "--max-count=30",
            "--format=%s%x1f%aI%x1e",
        ],
    )
    .unwrap_or_default();
    let mut commits = Vec::new();
    let mut latest_commit_at = None;
    for item in log.split('\u{1e}').filter(|item| !item.trim().is_empty()) {
        let mut parts = item.trim().split('\u{1f}');
        if let Some(title) = parts.next() {
            commits.push(title.chars().take(180).collect());
            if latest_commit_at.is_none() {
                latest_commit_at = parts.next().map(str::to_string);
            }
        }
    }
    Some(ScannedProject {
        path: path.to_string_lossy().to_string(),
        name: name.to_string(),
        branch,
        version: read_project_version(path),
        head,
        latest_commit: commits.first().cloned(),
        commit_titles: commits,
        changed_paths,
        untracked_file_count,
        latest_commit_at,
    })
}

fn git(path: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn read_project_version(path: &Path) -> Option<String> {
    let package = path.join("package.json");
    if package.exists() {
        let bytes = fs::read(package).ok()?;
        let value: Value = serde_json::from_slice(&bytes).ok()?;
        return value
            .get("version")
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    let cargo = fs::read_to_string(path.join("Cargo.toml")).ok()?;
    let mut in_package = false;
    for line in cargo.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_package = trimmed == "[package]";
        }
        if in_package && trimmed.starts_with("version") {
            return trimmed
                .split_once('=')
                .map(|(_, value)| value.trim().trim_matches('"').to_string());
        }
    }
    None
}

fn snapshot_hash(project: &ScannedProject) -> String {
    let mut hasher = Sha256::new();
    hasher.update(project.head.as_bytes());
    hasher.update(project.version.as_deref().unwrap_or_default().as_bytes());
    for path in &project.changed_paths {
        hasher.update(path.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn next_schedule(config: &WorkMonitorConfig) -> DateTime<Local> {
    let now = Local::now();
    let time = NaiveTime::parse_from_str(&config.schedule_time, "%H:%M").unwrap_or(NaiveTime::MIN);
    let current_weekday = now.weekday().num_days_from_monday() as i64;
    let target_weekday = config.schedule_weekday as i64;
    let mut days_ahead = (target_weekday - current_weekday + 7) % 7;
    let today_candidate = now.date_naive().and_time(time);
    if days_ahead == 0 && today_candidate <= now.naive_local() {
        days_ahead = 7;
    }
    let candidate = today_candidate + ChronoDuration::days(days_ahead);
    Local
        .from_local_datetime(&candidate)
        .single()
        .unwrap_or(now + ChronoDuration::weeks(1))
}

fn query_optional_scan(connection: &Connection, sql: &str) -> Result<Option<WorkScan>, String> {
    connection
        .query_row(sql, [], scan_from_row)
        .optional()
        .map_err(|_| "work_scans_read_failed".to_string())
}

fn scan_from_row(row: &Row<'_>) -> rusqlite::Result<WorkScan> {
    Ok(WorkScan {
        id: row.get(0)?,
        started_at: row.get(1)?,
        finished_at: row.get(2)?,
        project_count: row.get::<_, i64>(3)? as u32,
        active_count: row.get::<_, i64>(4)? as u32,
        significant_count: row.get::<_, i64>(5)? as u32,
        summary: row.get(6)?,
    })
}

fn query_projects(connection: &Connection, scan_id: &str) -> Result<Vec<WorkProject>, String> {
    let mut statement = connection
        .prepare(
            r#"
        SELECT p.id, p.name, sp.branch, sp.version, sp.commit_count, sp.changed_file_count,
               sp.untracked_file_count, sp.latest_commit, sp.latest_commit_at, sp.activity_score,
               sp.activity_status, p.last_scanned_at, p.target_public_id, p.target_title
        FROM work_scan_projects sp JOIN work_projects p ON p.id = sp.project_id
        WHERE sp.scan_id = ?1 ORDER BY sp.activity_score DESC, p.name COLLATE NOCASE ASC, p.id ASC
    "#,
        )
        .map_err(|_| "work_projects_read_failed")?;
    let projects = statement
        .query_map([scan_id], |row| {
            Ok(WorkProject {
                id: row.get(0)?,
                name: row.get(1)?,
                branch: row.get(2)?,
                version: row.get(3)?,
                commit_count: row.get::<_, i64>(4)? as u32,
                changed_file_count: row.get::<_, i64>(5)? as u32,
                untracked_file_count: row.get::<_, i64>(6)? as u32,
                latest_commit: row.get(7)?,
                latest_commit_at: row.get(8)?,
                activity_score: row.get::<_, i64>(9)? as u8,
                activity_status: row.get(10)?,
                last_scanned_at: row.get(11)?,
                target_public_id: row.get(12)?,
                target_title: row.get(13)?,
            })
        })
        .map_err(|_| "work_projects_read_failed")?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "work_projects_read_failed".to_string())?;
    Ok(projects)
}

fn query_optional_report(connection: &Connection) -> Result<Option<WorkReport>, String> {
    connection.query_row("SELECT id, scan_id, weekly_summary, feedback, project_analysis_json, created_at FROM work_reports ORDER BY created_at DESC, id DESC LIMIT 1", [], |row| {
        let analysis: String = row.get(4)?;
        Ok(WorkReport { id: row.get(0)?, scan_id: row.get(1)?, weekly_summary: row.get(2)?, feedback: row.get(3)?, project_analysis: serde_json::from_str(&analysis).unwrap_or(Value::Array(Vec::new())), created_at: row.get(5)? })
    }).optional().map_err(|_| "work_report_read_failed".to_string())
}

fn query_drafts(connection: &Connection) -> Result<Vec<WorkDraft>, String> {
    let mut statement = connection.prepare(r#"
        SELECT d.id, d.report_id, d.scan_id, d.project_id, p.name, d.target_public_id,
               d.target_title, d.highlight_zh, d.highlight_en, d.evidence_json,
               d.status, d.created_at, d.synced_at, d.sync_error
        FROM work_sync_drafts d JOIN work_projects p ON p.id = d.project_id
        ORDER BY CASE d.status WHEN 'pending' THEN 0 WHEN 'synced' THEN 1 ELSE 2 END, d.created_at DESC LIMIT 40
    "#).map_err(|_| "work_drafts_read_failed")?;
    let drafts = statement
        .query_map([], |row| {
            let evidence: String = row.get(9)?;
            Ok(WorkDraft {
                id: row.get(0)?,
                report_id: row.get(1)?,
                scan_id: row.get(2)?,
                project_id: row.get(3)?,
                project_name: row.get(4)?,
                target_public_id: row.get(5)?,
                target_title: row.get(6)?,
                highlight_zh: row.get(7)?,
                highlight_en: row.get(8)?,
                evidence: serde_json::from_str(&evidence).unwrap_or_default(),
                status: row.get(10)?,
                created_at: row.get(11)?,
                synced_at: row.get(12)?,
                sync_error: row.get(13)?,
            })
        })
        .map_err(|_| "work_drafts_read_failed")?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "work_drafts_read_failed".to_string())?;
    Ok(drafts)
}

fn evidence_for(input: &AnalysisProjectInput) -> Vec<String> {
    let mut evidence = vec![
        format!("{} commits", input.commit_count),
        format!("{} changed files", input.changed_file_count),
    ];
    if let Some(version) = &input.version {
        evidence.push(format!("version {version}"));
    }
    evidence.into_iter().take(8).collect()
}

fn validate_ai_project(project: &AiProjectAnalysis) -> Result<(), String> {
    if !matches!(project.status.as_str(), "active" | "steady" | "blocked")
        || project.highlight_zh.chars().count() > 240
        || project.highlight_en.chars().count() > 240
        || project.highlight_zh.trim().is_empty()
        || project.highlight_en.trim().is_empty()
    {
        return Err("work_analysis_project_invalid".to_string());
    }
    Ok(())
}

fn valid_target_id(value: &str) -> bool {
    value.starts_with("project:")
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
}

fn run_gworkspace_command(root: &str, arguments: &[&str]) -> Result<Value, String> {
    let root = fs::canonicalize(root).map_err(|_| "gworkspace_root_unavailable")?;
    let wrapper = root.join("scripts/run-with-backend-node.sh");
    let script = root.join("backend/scripts/oceanseo-project-sync.js");
    if !wrapper.is_file() || !script.is_file() {
        return Err("gworkspace_adapter_unavailable".to_string());
    }
    let output = Command::new("bash")
        .arg(&wrapper)
        .arg("node")
        .arg(&script)
        .args(arguments)
        .current_dir(&root)
        .output()
        .map_err(|_| "gworkspace_adapter_failed")?;
    if !output.status.success() {
        return Err("gworkspace_adapter_rejected".to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let result = stdout
        .lines()
        .find_map(|line| line.strip_prefix(SYNC_RESULT_PREFIX))
        .ok_or("gworkspace_adapter_response_missing")?;
    serde_json::from_str(result).map_err(|_| "gworkspace_adapter_response_invalid".to_string())
}

fn work_report_schema() -> Value {
    json!({
        "type": "object", "additionalProperties": false,
        "properties": {
            "weeklySummary": { "type": "string", "maxLength": 1200 },
            "feedback": { "type": "string", "maxLength": 1200 },
            "projects": { "type": "array", "items": {
                "type": "object", "additionalProperties": false,
                "properties": {
                    "projectId": { "type": "string" },
                    "status": { "enum": ["active", "steady", "blocked"] },
                    "summary": { "type": "string", "maxLength": 500 },
                    "risk": { "type": "string", "maxLength": 300 },
                    "nextStep": { "type": "string", "maxLength": 300 },
                    "shouldSync": { "type": "boolean" },
                    "highlightZh": { "type": "string", "maxLength": 240 },
                    "highlightEn": { "type": "string", "maxLength": 240 }
                },
                "required": ["projectId", "status", "summary", "risk", "nextStep", "shouldSync", "highlightZh", "highlightEn"]
            }}
        },
        "required": ["weeklySummary", "feedback", "projects"]
    })
}

fn extract_output_text(response: &Value) -> Option<&str> {
    response
        .get("output")?
        .as_array()?
        .iter()
        .filter_map(|item| item.get("content")?.as_array())
        .flatten()
        .find(|content| content.get("type").and_then(Value::as_str) == Some("output_text"))?
        .get("text")?
        .as_str()
}

fn now_timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[tauri::command]
pub fn get_work_dashboard(
    store: tauri::State<'_, WorkMonitorStore>,
) -> Result<WorkDashboard, String> {
    store.dashboard()
}

#[tauri::command]
pub fn save_work_monitor_config(
    config: WorkMonitorConfig,
    store: tauri::State<'_, WorkMonitorStore>,
) -> Result<WorkDashboard, String> {
    store.save_config(config)?;
    store.dashboard()
}

#[tauri::command]
pub async fn scan_workspaces(app: tauri::AppHandle) -> Result<WorkDashboard, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<WorkMonitorStore>().scan())
        .await
        .map_err(|_| "work_scan_task_failed".to_string())?
}

#[tauri::command]
pub async fn run_scheduled_work_scan(
    app: tauri::AppHandle,
) -> Result<Option<WorkDashboard>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<WorkMonitorStore>();
        if store.is_due()? {
            store.scan().map(Some)
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(|_| "work_scan_task_failed".to_string())?
}

#[tauri::command]
pub async fn generate_work_report(
    scan_id: String,
    store: tauri::State<'_, WorkMonitorStore>,
    ai_settings: tauri::State<'_, AiSettingsStore>,
) -> Result<WorkDashboard, String> {
    let ai = ai_settings.resolve()?;
    Uuid::parse_str(&scan_id).map_err(|_| "work_scan_id_invalid")?;
    let input = store.analysis_input(&scan_id)?;
    if input.is_empty() {
        return Err("work_scan_empty".to_string());
    }
    let body = json!({
        "model": ai.model,
        "store": false,
        "input": [
            { "role": "system", "content": "你是个人软件项目复盘助手。只能依据给出的 Git 元数据判断，不能猜测源码内容。用简体中文总结，风险和下一步必须具体；只有里程碑、版本或显著功能变化才建议同步。公开亮点不得包含本地路径、提交哈希、凭据或私人信息，并同时给出简洁中英文。" },
            { "role": "user", "content": format!("请总结本次项目检查并逐项目给出判断。项目数据：{}", serde_json::to_string(&input).map_err(|_| "work_analysis_input_invalid")?) }
        ],
        "text": { "format": { "type": "json_schema", "name": "weekly_work_report", "schema": work_report_schema(), "strict": true } }
    });
    let response = Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|_| "openai_client_failed")?
        .post(ai.responses_url)
        .bearer_auth(&ai.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|_| "openai_connection_failed")?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|_| "openai_response_invalid")?;
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 => "openai_api_key_invalid",
            429 => "openai_rate_limited",
            _ => "openai_request_failed",
        }
        .to_string());
    }
    let text = extract_output_text(&value).ok_or("openai_output_missing")?;
    let report: AiWorkReport = serde_json::from_str(text).map_err(|_| "openai_output_invalid")?;
    store.save_analysis(&scan_id, &report)
}

#[tauri::command]
pub async fn get_gworkspace_catalog(
    app: tauri::AppHandle,
) -> Result<Vec<GWorkspaceProject>, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<WorkMonitorStore>().catalog())
        .await
        .map_err(|_| "gworkspace_catalog_task_failed".to_string())?
}

#[tauri::command]
pub fn set_work_project_mapping(
    project_id: String,
    target: Option<GWorkspaceProject>,
    store: tauri::State<'_, WorkMonitorStore>,
) -> Result<WorkDashboard, String> {
    store.set_mapping(&project_id, target.as_ref())
}

#[tauri::command]
pub fn reject_work_draft(
    draft_id: String,
    store: tauri::State<'_, WorkMonitorStore>,
) -> Result<WorkDashboard, String> {
    store.reject_draft(&draft_id)
}

#[tauri::command]
pub async fn sync_work_draft(
    draft_id: String,
    target_project_id: String,
    highlight_zh: String,
    highlight_en: String,
    app: tauri::AppHandle,
) -> Result<WorkDashboard, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<WorkMonitorStore>().sync_draft(
            &draft_id,
            &target_project_id,
            &highlight_zh,
            &highlight_en,
        )
    })
    .await
    .map_err(|_| "gworkspace_sync_task_failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store(temp: &TempDir) -> WorkMonitorStore {
        WorkMonitorStore::open(
            &temp.path().join("monitor.sqlite3"),
            temp.path().join("exports"),
        )
        .unwrap()
    }

    #[test]
    fn config_round_trip_and_schedule_validation() {
        let temp = TempDir::new().unwrap();
        let store = store(&temp);
        let mut config = store.config().unwrap();
        config.schedule_weekday = 4;
        config.schedule_time = "18:45".to_string();
        config.significance_threshold = 60;
        config.excluded_projects = vec!["archive".to_string()];
        assert_eq!(store.save_config(config).unwrap().schedule_time, "18:45");
        let mut invalid = store.config().unwrap();
        invalid.schedule_time = "25:00".to_string();
        assert_eq!(
            store.save_config(invalid).unwrap_err(),
            "work_monitor_schedule_invalid"
        );
    }

    #[test]
    fn scanning_persists_git_metadata_without_source_contents() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("personal");
        let project = root.join("sample");
        fs::create_dir_all(&project).unwrap();
        Command::new("git")
            .arg("init")
            .arg(&project)
            .output()
            .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(&project)
            .args(["config", "user.email", "synthetic@example.test"])
            .output()
            .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(&project)
            .args(["config", "user.name", "Synthetic"])
            .output()
            .unwrap();
        fs::write(project.join("README.md"), "synthetic").unwrap();
        Command::new("git")
            .arg("-C")
            .arg(&project)
            .args(["add", "README.md"])
            .output()
            .unwrap();
        Command::new("git")
            .arg("-C")
            .arg(&project)
            .args(["commit", "-m", "Complete synthetic milestone"])
            .output()
            .unwrap();

        let store = store(&temp);
        let mut config = store.config().unwrap();
        config.workspace_root = root.to_string_lossy().to_string();
        store.save_config(config).unwrap();
        let dashboard = store.scan().unwrap();
        assert_eq!(dashboard.projects.len(), 1);
        assert_eq!(
            dashboard.projects[0].latest_commit.as_deref(),
            Some("Complete synthetic milestone")
        );
        assert!(!serde_json::to_string(&dashboard.projects)
            .unwrap()
            .contains(root.to_string_lossy().as_ref()));
    }

    #[test]
    fn regenerating_report_preserves_reviewed_draft_receipts() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("personal");
        let project = root.join("sample");
        fs::create_dir_all(&project).unwrap();
        Command::new("git")
            .arg("init")
            .arg(&project)
            .output()
            .unwrap();
        fs::write(project.join("README.md"), "synthetic").unwrap();

        let store = store(&temp);
        let mut config = store.config().unwrap();
        config.workspace_root = root.to_string_lossy().to_string();
        config.significance_threshold = 10;
        store.save_config(config).unwrap();
        let dashboard = store.scan().unwrap();
        let scan_id = dashboard.latest_scan.unwrap().id;
        let project_id = dashboard.projects[0].id.clone();
        let mut report = AiWorkReport {
            weekly_summary: "Synthetic weekly summary".to_string(),
            feedback: "Synthetic feedback".to_string(),
            projects: vec![AiProjectAnalysis {
                project_id,
                status: "active".to_string(),
                summary: "Synthetic activity".to_string(),
                risk: "None".to_string(),
                next_step: "Review".to_string(),
                should_sync: true,
                highlight_zh: "完成合成进展。".to_string(),
                highlight_en: "Completed synthetic progress.".to_string(),
            }],
        };
        let first = store.save_analysis(&scan_id, &report).unwrap();
        let draft_id = first.drafts[0].id.clone();
        store
            .connection
            .lock()
            .unwrap()
            .execute(
                "UPDATE work_sync_drafts SET status = 'synced', synced_at = ?1 WHERE id = ?2",
                params![now_timestamp(), draft_id],
            )
            .unwrap();

        report.weekly_summary = "Regenerated weekly summary".to_string();
        report.projects[0].highlight_en =
            "A replacement that must not erase the receipt.".to_string();
        let regenerated = store.save_analysis(&scan_id, &report).unwrap();
        assert_eq!(
            regenerated.latest_report.unwrap().weekly_summary,
            report.weekly_summary
        );
        assert_eq!(regenerated.drafts.len(), 1);
        assert_eq!(regenerated.drafts[0].status, "synced");
        assert_eq!(
            regenerated.drafts[0].highlight_en,
            "Completed synthetic progress."
        );
    }

    #[test]
    fn target_identifiers_are_opaque_and_strict() {
        assert!(valid_target_id("project:synthetic-001"));
        assert!(!valid_target_id("1"));
        assert!(!valid_target_id("project:bad/path"));
    }
}

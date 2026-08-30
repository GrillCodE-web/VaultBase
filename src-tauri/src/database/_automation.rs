// FEAT-004: IF-THEN правила автоматизации.
// Триггер order_status_changed вызывается из _orders.rs::update_order_status
// ПОСЛЕ записи истории перехода. Ошибки правил не прерывают бизнес-поток
// смены статуса — фиксируются в automation_rule_runs и в last_error правила.

/// Статусы карты, которые правилам разрешено выставлять (in_use управляется
/// только профилями — защита в update_card_status).
const RULE_CARD_STATUSES: &[&str] = &["free", "dead", "archive"];

impl Database {
    // ─────────────────────────────────────────
    //  CRUD правил
    // ─────────────────────────────────────────

    pub fn create_automation_rule(
        &self,
        name: &str,
        description: Option<&str>,
        conditions_json: &str,
        actions_json: &str,
        enabled: bool,
    ) -> Result<i64, String> {
        if name.trim().is_empty() {
            return Err("rule_name_empty".into());
        }
        Self::validate_rule_conditions(conditions_json)?;
        Self::validate_rule_actions(actions_json)?;
        self.conn.execute(
            "INSERT INTO automation_rules(name,description,conditions_json,actions_json,enabled) VALUES(?1,?2,?3,?4,?5)",
            params![name.trim(), description, conditions_json, actions_json, enabled],
        ).map_err(|e| {
            if e.to_string().contains("UNIQUE") { "rule_name_taken".into() } else { e.to_string() }
        })?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn list_automation_rules(&self) -> Result<Vec<crate::models::AutomationRule>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id,name,description,trigger_type,conditions_json,actions_json,enabled,
                    times_triggered,last_triggered,last_error,created_at,updated_at
             FROM automation_rules ORDER BY id",
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| {
            Ok(crate::models::AutomationRule {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                trigger_type: r.get(3)?,
                conditions_json: r.get(4)?,
                actions_json: r.get(5)?,
                enabled: r.get(6)?,
                times_triggered: r.get(7)?,
                last_triggered: r.get(8)?,
                last_error: r.get(9)?,
                created_at: r.get(10)?,
                updated_at: r.get(11)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<SqlResult<Vec<_>>>().map_err(|e| e.to_string())
    }

    pub fn update_automation_rule(
        &self,
        id: i64,
        name: Option<&str>,
        description: Option<&str>,
        conditions_json: Option<&str>,
        actions_json: Option<&str>,
        enabled: Option<bool>,
    ) -> Result<(), String> {
        if let Some(n) = name {
            if n.trim().is_empty() {
                return Err("rule_name_empty".into());
            }
        }
        if let Some(c) = conditions_json {
            Self::validate_rule_conditions(c)?;
        }
        if let Some(a) = actions_json {
            Self::validate_rule_actions(a)?;
        }
        let n = self.conn.execute(
            "UPDATE automation_rules SET
                name = COALESCE(?2, name),
                description = COALESCE(?3, description),
                conditions_json = COALESCE(?4, conditions_json),
                actions_json = COALESCE(?5, actions_json),
                enabled = COALESCE(?6, enabled),
                updated_at = datetime('now')
             WHERE id = ?1",
            params![id, name.map(|s| s.trim().to_string()), description, conditions_json, actions_json, enabled],
        ).map_err(|e| {
            if e.to_string().contains("UNIQUE") { "rule_name_taken".into() } else { e.to_string() }
        })?;
        if n == 0 {
            return Err("rule_not_found".into());
        }
        Ok(())
    }

    pub fn delete_automation_rule(&self, id: i64) -> Result<(), String> {
        let n = self.conn.execute("DELETE FROM automation_rules WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("rule_not_found".into());
        }
        Ok(())
    }

    pub fn get_automation_rule_runs(
        &self,
        rule_id: Option<i64>,
        limit: u32,
    ) -> Result<Vec<crate::models::AutomationRuleRun>, String> {
        fn map_run(r: &rusqlite::Row) -> SqlResult<crate::models::AutomationRuleRun> {
            Ok(crate::models::AutomationRuleRun {
                id: r.get(0)?,
                rule_id: r.get(1)?,
                order_id: r.get(2)?,
                card_id: r.get(3)?,
                trigger_value: r.get(4)?,
                actions_applied: r.get(5)?,
                status: r.get(6)?,
                error_message: r.get(7)?,
                created_at: r.get(8)?,
            })
        }
        let limit = limit.clamp(1, 500) as i64;
        let rows = match rule_id {
            Some(rid) => {
                let mut stmt = self.conn.prepare(
                    "SELECT id,rule_id,order_id,card_id,trigger_value,actions_applied,status,error_message,created_at
                     FROM automation_rule_runs WHERE rule_id=?1 ORDER BY id DESC LIMIT ?2",
                ).map_err(|e| e.to_string())?;
                let collected = stmt.query_map(params![rid, limit], map_run).map_err(|e| e.to_string())?
                    .collect::<SqlResult<Vec<_>>>();
                collected
            }
            None => {
                let mut stmt = self.conn.prepare(
                    "SELECT id,rule_id,order_id,card_id,trigger_value,actions_applied,status,error_message,created_at
                     FROM automation_rule_runs ORDER BY id DESC LIMIT ?1",
                ).map_err(|e| e.to_string())?;
                let collected = stmt.query_map(params![limit], map_run).map_err(|e| e.to_string())?
                    .collect::<SqlResult<Vec<_>>>();
                collected
            }
        };
        rows.map_err(|e| e.to_string())
    }

    // ─────────────────────────────────────────
    //  Движок: триггер order_status_changed
    // ─────────────────────────────────────────

    /// Вызывается из update_order_status после смены статуса заказа.
    /// Всегда Ok: ошибки отдельных правил пишутся в runs/last_error,
    /// чтобы сломанное правило не блокировало смену статуса.
    pub fn run_automation_rules_for_order(
        &self,
        order_id: i64,
        from_status: Option<&str>,
        to_status: &str,
    ) -> Result<(), String> {
        let mut stmt = match self.conn.prepare(
            "SELECT id,name,conditions_json,actions_json FROM automation_rules
             WHERE enabled=1 AND trigger_type='order_status_changed' ORDER BY id",
        ) {
            Ok(s) => s,
            Err(_) => return Ok(()), // таблицы нет (старая схема) — молча пропускаем
        };
        let rules: Vec<(i64, String, String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        if rules.is_empty() {
            return Ok(());
        }

        // Контекст заказа: карта (через профиль) и магазин
        let (card_id, shop_id): (Option<i64>, Option<i64>) = self.conn.query_row(
            "SELECT p.card_id, o.shop_id FROM orders o
             LEFT JOIN profiles p ON o.profile_id = p.id WHERE o.id=?1",
            params![order_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap_or((None, None));

        for (rule_id, rule_name, conditions_json, actions_json) in rules {
            match self.try_fire_rule(
                rule_id, &rule_name, &conditions_json, &actions_json,
                order_id, from_status, to_status, card_id, shop_id,
            ) {
                Ok(true) => {
                    let _ = self.conn.execute(
                        "UPDATE automation_rules SET times_triggered=times_triggered+1,
                         last_triggered=datetime('now'), last_error=NULL WHERE id=?1",
                        params![rule_id],
                    );
                }
                Ok(false) => {} // условия не выполнены — молча
                Err(e) => {
                    let _ = self.conn.execute(
                        "UPDATE automation_rules SET last_error=?1 WHERE id=?2",
                        params![e, rule_id],
                    );
                    self.record_rule_run(rule_id, Some(order_id), card_id, Some(to_status), None, "error", Some(&e));
                    let _ = self.log_event(
                        "automation.rule_error",
                        &format!("Правило '{}' (id={}): {}", rule_name, rule_id, e),
                        Some("automation"),
                        None,
                    );
                }
            }
        }
        Ok(())
    }

    /// Ok(true) — правило сработало и действия применены; Ok(false) — условия
    /// не выполнены; Err — ошибка разбора или выполнения действия.
    fn try_fire_rule(
        &self,
        rule_id: i64,
        rule_name: &str,
        conditions_json: &str,
        actions_json: &str,
        order_id: i64,
        from_status: Option<&str>,
        to_status: &str,
        card_id: Option<i64>,
        shop_id: Option<i64>,
    ) -> Result<bool, String> {
        let conditions: Vec<serde_json::Value> = serde_json::from_str(conditions_json)
            .map_err(|e| format!("conditions parse: {}", e))?;
        for c in &conditions {
            if !self.eval_rule_condition(c, from_status, to_status, card_id, shop_id)? {
                return Ok(false);
            }
        }
        let actions: Vec<serde_json::Value> = serde_json::from_str(actions_json)
            .map_err(|e| format!("actions parse: {}", e))?;
        let mut applied: Vec<String> = Vec::new();
        for a in &actions {
            applied.push(self.exec_rule_action(a, rule_id, card_id, order_id)?);
        }
        let applied_json = serde_json::to_string(&applied).unwrap_or_default();
        self.record_rule_run(rule_id, Some(order_id), card_id, Some(to_status), Some(&applied_json), "success", None);
        let _ = self.log_event(
            "automation.rule_fired",
            &format!("Правило '{}' сработало: заказ {} → {} ({})", rule_name, order_id, to_status, applied.join("; ")),
            Some("automation"),
            Some(&order_id.to_string()),
        );
        Ok(true)
    }

    fn eval_rule_condition(
        &self,
        c: &serde_json::Value,
        from_status: Option<&str>,
        to_status: &str,
        card_id: Option<i64>,
        _shop_id: Option<i64>,
    ) -> Result<bool, String> {
        match c.get("type").and_then(|v| v.as_str()).unwrap_or("") {
            // {"type":"status_equals","value":"declined"}
            "status_equals" => Ok(Some(to_status) == c.get("value").and_then(|v| v.as_str())),
            // {"type":"from_status_equals","value":"pending"}
            "from_status_equals" => Ok(from_status == c.get("value").and_then(|v| v.as_str())),
            // {"type":"consecutive_declines_gte","value":3} — серия деклайнов
            // карты (учитывает качество магазина, см. get_consecutive_declines)
            "consecutive_declines_gte" => {
                let n = c.get("value").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                let cid = card_id.ok_or("order_has_no_card")?;
                Ok(self.get_consecutive_declines(cid)? >= n)
            }
            other => Err(format!("unknown condition type: '{}'", other)),
        }
    }

    fn exec_rule_action(
        &self,
        a: &serde_json::Value,
        rule_id: i64,
        card_id: Option<i64>,
        order_id: i64,
    ) -> Result<String, String> {
        match a.get("type").and_then(|v| v.as_str()).unwrap_or("") {
            // {"type":"set_card_status","status":"dead"} — пометить карту
            "set_card_status" => {
                let status = a.get("status").and_then(|v| v.as_str())
                    .ok_or("set_card_status: нет status")?;
                if !RULE_CARD_STATUSES.contains(&status) {
                    return Err(format!("set_card_status: недопустимый статус '{}'", status));
                }
                let cid = card_id.ok_or("order_has_no_card")?;
                self.update_card_status(cid, status, None, Some("automation_rule"))?;
                Ok(format!("set_card_status: карта {} → {}", cid, status))
            }
            // {"type":"append_card_note","text":"3 деклайна подряд"}
            "append_card_note" => {
                let text = a.get("text").and_then(|v| v.as_str())
                    .ok_or("append_card_note: нет text")?;
                let cid = card_id.ok_or("order_has_no_card")?;
                let stamped = format!("[авто #{}] {}", rule_id, text);
                self.conn.execute(
                    "UPDATE credit_cards SET notes = CASE WHEN notes IS NULL OR notes=''
                     THEN ?1 ELSE notes || char(10) || ?1 END WHERE id=?2",
                    params![stamped, cid],
                ).map_err(|e| e.to_string())?;
                Ok(format!("append_card_note: карта {}", cid))
            }
            // {"type":"log_event","message":"..."}
            "log_event" => {
                let message = a.get("message").and_then(|v| v.as_str())
                    .ok_or("log_event: нет message")?;
                self.log_event("automation.rule_action", message, Some("automation"), Some(&order_id.to_string()))?;
                Ok(format!("log_event: {}", message))
            }
            other => Err(format!("unknown action type: '{}'", other)),
        }
    }

    fn record_rule_run(
        &self,
        rule_id: i64,
        order_id: Option<i64>,
        card_id: Option<i64>,
        trigger_value: Option<&str>,
        actions_applied: Option<&str>,
        status: &str,
        error_message: Option<&str>,
    ) {
        let _ = self.conn.execute(
            "INSERT INTO automation_rule_runs(rule_id,order_id,card_id,trigger_value,actions_applied,status,error_message)
             VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![rule_id, order_id, card_id, trigger_value, actions_applied, status, error_message],
        );
    }

    // ─────────────────────────────────────────
    //  Валидация JSON (при создании/обновлении)
    // ─────────────────────────────────────────

    fn validate_rule_conditions(json: &str) -> Result<(), String> {
        let arr: Vec<serde_json::Value> = serde_json::from_str(json)
            .map_err(|e| format!("invalid conditions_json: {}", e))?;
        for c in &arr {
            let t = c.get("type").and_then(|v| v.as_str()).unwrap_or("");
            match t {
                "status_equals" | "from_status_equals" => {
                    let ok = c.get("value").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
                    if !ok {
                        return Err(format!("condition '{}': требуется непустое строковое value", t));
                    }
                }
                "consecutive_declines_gte" => {
                    match c.get("value").and_then(|v| v.as_u64()) {
                        Some(n) if n >= 1 => {}
                        _ => return Err("condition 'consecutive_declines_gte': требуется целое value >= 1".into()),
                    }
                }
                _ => return Err(format!("unknown condition type: '{}'", t)),
            }
        }
        Ok(())
    }

    fn validate_rule_actions(json: &str) -> Result<(), String> {
        let arr: Vec<serde_json::Value> = serde_json::from_str(json)
            .map_err(|e| format!("invalid actions_json: {}", e))?;
        if arr.is_empty() {
            return Err("actions_json: хотя бы одно действие обязательно".into());
        }
        for a in &arr {
            let t = a.get("type").and_then(|v| v.as_str()).unwrap_or("");
            match t {
                "set_card_status" => {
                    let s = a.get("status").and_then(|v| v.as_str()).unwrap_or("");
                    if !RULE_CARD_STATUSES.contains(&s) {
                        return Err(format!("set_card_status: недопустимый статус '{}'. Разрешены: {}", s, RULE_CARD_STATUSES.join(", ")));
                    }
                }
                "append_card_note" => {
                    let ok = a.get("text").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
                    if !ok {
                        return Err("append_card_note: требуется непустой text".into());
                    }
                }
                "log_event" => {
                    let ok = a.get("message").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
                    if !ok {
                        return Err("log_event: требуется непустой message".into());
                    }
                }
                _ => return Err(format!("unknown action type: '{}'", t)),
            }
        }
        Ok(())
    }
}

// ─────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────

#[cfg(test)]
mod automation_rule_tests {
    use crate::database::Database;

    fn test_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let db = Database::open(path.to_str().unwrap()).unwrap();
        (dir, db)
    }

    /// Карта + профиль + заказ в заданном статусе. Возвращает (card_id, order_id).
    fn seed_card_order(db: &Database, order_status: &str) -> (i64, i64) {
        db.conn.execute("INSERT INTO credit_cards(card_number,status) VALUES('4111111111111111','free')", []).unwrap();
        let card_id = db.conn.last_insert_rowid();
        db.conn.execute("INSERT INTO profiles(id, card_id) VALUES('p1', ?1)", rusqlite::params![card_id]).unwrap();
        db.conn.execute("INSERT INTO orders(profile_id,status) VALUES('p1',?1)", rusqlite::params![order_status]).unwrap();
        let order_id = db.conn.last_insert_rowid();
        (card_id, order_id)
    }

    fn card_status(db: &Database, card_id: i64) -> String {
        db.conn.query_row("SELECT status FROM credit_cards WHERE id=?1", rusqlite::params![card_id], |r| r.get(0)).unwrap()
    }

    const COND_DECLINED: &str = r#"[{"type":"status_equals","value":"declined"}]"#;
    const ACT_DEAD: &str = r#"[{"type":"set_card_status","status":"dead"}]"#;

    #[test]
    fn test_create_and_list_rules() {
        let (_dir, db) = test_db();
        let id = db.create_automation_rule("r1", Some("описание"), COND_DECLINED, ACT_DEAD, true).unwrap();
        assert!(id > 0);
        let rules = db.list_automation_rules().unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].name, "r1");
        assert_eq!(rules[0].trigger_type, "order_status_changed");
        assert!(rules[0].enabled);
        assert_eq!(rules[0].times_triggered, 0);
    }

    #[test]
    fn test_create_validation_errors() {
        let (_dir, db) = test_db();
        assert!(db.create_automation_rule("  ", None, COND_DECLINED, ACT_DEAD, true).is_err(), "пустое имя");
        assert!(db.create_automation_rule("r", None, "not-json", ACT_DEAD, true).is_err(), "битый JSON условий");
        assert!(db.create_automation_rule("r", None, r#"[{"type":"nope","value":"x"}]"#, ACT_DEAD, true).is_err(), "неизвестное условие");
        assert!(db.create_automation_rule("r", None, COND_DECLINED, "[]", true).is_err(), "пустые действия");
        assert!(db.create_automation_rule("r", None, COND_DECLINED, r#"[{"type":"set_card_status","status":"in_use"}]"#, true).is_err(), "in_use запрещён");
        assert!(db.create_automation_rule("r", None, COND_DECLINED, ACT_DEAD, true).unwrap() > 0);
        assert!(db.create_automation_rule("r", None, COND_DECLINED, ACT_DEAD, true).is_err(), "дубликат имени");
    }

    #[test]
    fn test_update_toggle_delete() {
        let (_dir, db) = test_db();
        let id = db.create_automation_rule("r1", None, COND_DECLINED, ACT_DEAD, true).unwrap();
        db.update_automation_rule(id, Some("r1-renamed"), None, None, None, Some(false)).unwrap();
        let rule = &db.list_automation_rules().unwrap()[0];
        assert_eq!(rule.name, "r1-renamed");
        assert!(!rule.enabled);
        assert!(db.update_automation_rule(999, Some("x"), None, None, None, None).is_err(), "rule_not_found");
        assert!(db.update_automation_rule(id, None, None, Some("bad"), None, None).is_err(), "битый JSON не обновляет");
        db.delete_automation_rule(id).unwrap();
        assert!(db.list_automation_rules().unwrap().is_empty());
        assert!(db.delete_automation_rule(id).is_err());
    }

    /// Сценарий из чеклиста: status=declined → пометить карту (dead + заметка).
    #[test]
    fn test_declined_marks_card_full_flow() {
        let (_dir, db) = test_db();
        let (card_id, order_id) = seed_card_order(&db, "pending");
        let actions = r#"[{"type":"set_card_status","status":"dead"},{"type":"append_card_note","text":"заказ отклонён"}]"#;
        let rule_id = db.create_automation_rule("declined→dead", None, COND_DECLINED, actions, true).unwrap();

        db.update_order_status(order_id, "declined", None, None).unwrap();

        assert_eq!(card_status(&db, card_id), "dead");
        let notes: String = db.conn.query_row("SELECT notes FROM credit_cards WHERE id=?1", rusqlite::params![card_id], |r| r.get(0)).unwrap();
        assert!(notes.contains("заказ отклонён"), "заметка добавлена: {}", notes);
        let rule = &db.list_automation_rules().unwrap()[0];
        assert_eq!(rule.times_triggered, 1);
        assert!(rule.last_error.is_none());
        let runs = db.get_automation_rule_runs(Some(rule_id), 10).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, "success");
        assert_eq!(runs[0].order_id, Some(order_id));
        assert_eq!(runs[0].card_id, Some(card_id));
    }

    #[test]
    fn test_other_status_does_not_fire() {
        let (_dir, db) = test_db();
        let (card_id, order_id) = seed_card_order(&db, "pending");
        db.create_automation_rule("declined→dead", None, COND_DECLINED, ACT_DEAD, true).unwrap();
        db.update_order_status(order_id, "shipped", None, None).unwrap();
        assert_eq!(card_status(&db, card_id), "free");
        assert_eq!(db.get_automation_rule_runs(None, 10).unwrap().len(), 0, "без срабатывания нет записей");
    }

    #[test]
    fn test_disabled_rule_does_not_fire() {
        let (_dir, db) = test_db();
        let (card_id, order_id) = seed_card_order(&db, "pending");
        db.create_automation_rule("off", None, COND_DECLINED, ACT_DEAD, false).unwrap();
        db.update_order_status(order_id, "declined", None, None).unwrap();
        assert_eq!(card_status(&db, card_id), "free");
    }

    #[test]
    fn test_from_status_condition() {
        let (_dir, db) = test_db();
        let (card_id, order_id) = seed_card_order(&db, "pending");
        let cond = r#"[{"type":"status_equals","value":"declined"},{"type":"from_status_equals","value":"shipped"}]"#;
        db.create_automation_rule("only-from-shipped", None, cond, ACT_DEAD, true).unwrap();
        db.update_order_status(order_id, "declined", None, None).unwrap();
        assert_eq!(card_status(&db, card_id), "free", "переход pending→declined не подходит");
    }

    #[test]
    fn test_consecutive_declines_condition() {
        let (_dir, db) = test_db();
        // магазин с доставленным заказом — success_rate >= 30%, деклайны считаются
        db.conn.execute("INSERT INTO shops(name,domain) VALUES('S','s.example')", []).unwrap();
        let shop_id = db.conn.last_insert_rowid();
        db.conn.execute("INSERT INTO profiles(id) VALUES('p_other')", []).unwrap();
        db.conn.execute("INSERT INTO orders(profile_id,shop_id,status) VALUES('p_other',?1,'delivered')", rusqlite::params![shop_id]).unwrap();
        let (card_id, _) = seed_card_order(&db, "declined");
        db.conn.execute("UPDATE orders SET shop_id=?1", rusqlite::params![shop_id]).unwrap();
        db.conn.execute("INSERT INTO orders(profile_id,shop_id,status) VALUES('p1',?1,'pending')", rusqlite::params![shop_id]).unwrap();
        let order_id = db.conn.last_insert_rowid();

        // порог 5 при 2 деклайнах — не срабатывает
        let cond5 = r#"[{"type":"status_equals","value":"declined"},{"type":"consecutive_declines_gte","value":5}]"#;
        db.create_automation_rule("threshold5", None, cond5, ACT_DEAD, true).unwrap();
        // порог 2 — срабатывает (предыдущий declined + текущий)
        let cond2 = r#"[{"type":"status_equals","value":"declined"},{"type":"consecutive_declines_gte","value":2}]"#;
        db.create_automation_rule("threshold2", None, cond2, r#"[{"type":"append_card_note","text":"серия деклайнов"}]"#, true).unwrap();

        db.update_order_status(order_id, "declined", None, None).unwrap();

        assert_eq!(card_status(&db, card_id), "free", "порог 5 не достигнут");
        let notes: String = db.conn.query_row("SELECT notes FROM credit_cards WHERE id=?1", rusqlite::params![card_id], |r| r.get(0)).unwrap();
        assert!(notes.contains("серия деклайнов"), "порог 2 достигнут");
    }

    #[test]
    fn test_error_does_not_break_status_change() {
        let (_dir, db) = test_db();
        // заказ БЕЗ профиля/карты → set_card_status падает с order_has_no_card
        db.conn.execute("INSERT INTO orders(status) VALUES('pending')", []).unwrap();
        let order_id = db.conn.last_insert_rowid();
        let rule_id = db.create_automation_rule("no-card", None, COND_DECLINED, ACT_DEAD, true).unwrap();

        db.update_order_status(order_id, "declined", None, None).unwrap(); // не падает

        let rule = &db.list_automation_rules().unwrap()[0];
        assert_eq!(rule.last_error.as_deref(), Some("order_has_no_card"));
        let runs = db.get_automation_rule_runs(Some(rule_id), 10).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, "error");
        assert_eq!(runs[0].error_message.as_deref(), Some("order_has_no_card"));
    }

    #[test]
    fn test_delete_cascades_runs() {
        let (_dir, db) = test_db();
        let (_, order_id) = seed_card_order(&db, "pending");
        let rule_id = db.create_automation_rule("r", None, COND_DECLINED, ACT_DEAD, true).unwrap();
        db.update_order_status(order_id, "declined", None, None).unwrap();
        assert_eq!(db.get_automation_rule_runs(Some(rule_id), 10).unwrap().len(), 1);
        db.delete_automation_rule(rule_id).unwrap();
        assert_eq!(db.get_automation_rule_runs(None, 10).unwrap().len(), 0, "runs удалены каскадом");
    }
}

// ============================================================
// PATCH: database.rs — Profile / Drop operations
// Append these methods inside the `impl Database { ... }` block
// ============================================================

// ─── Profiles ────────────────────────────────────────────────

pub fn create_profile(&self, card_id: i64, notes: &str) -> Result<Profile, String> {
    let conn = &self.conn;

    // Verify card exists and is free
    let status: String = conn
        .query_row(
            "SELECT status FROM credit_cards WHERE id = ?1",
            params![card_id],
            |r| r.get(0),
        )
        .map_err(|_| "card_not_found".to_string())?;

    if status != "free" {
        return Err(format!("card_not_free:{}", status));
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO profiles (id, card_id, notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, card_id, notes, now],
    )
    .map_err(|e| format!("insert_profile_failed:{}", e))?;

    conn.execute(
        "UPDATE credit_cards SET status = 'in_use', updated_at = ?1 WHERE id = ?2",
        params![now, card_id],
    )
    .map_err(|e| format!("update_card_status_failed:{}", e))?;

    self.log_event("profile.created", Some(&format!("profile_id={}", id)))?;

    self.get_profile_by_id(&id)
}

fn get_profile_by_id(&self, id: &str) -> Result<Profile, String> {
    self.conn
        .query_row(
            "SELECT p.id, p.card_id, p.notes, p.created_at, p.updated_at,
                    (SELECT COUNT(*) FROM drops d WHERE d.profile_id = p.id) as drop_count,
                    (SELECT COUNT(*) FROM orders o WHERE o.profile_id = p.id) as order_count
             FROM profiles p WHERE p.id = ?1",
            params![id],
            |r| {
                Ok(Profile {
                    id: r.get(0)?,
                    card_id: r.get(1)?,
                    notes: r.get(2)?,
                    created_at: r.get(3)?,
                    updated_at: r.get(4)?,
                    drop_count: r.get(5)?,
                    order_count: r.get(6)?,
                })
            },
        )
        .map_err(|e| format!("get_profile_failed:{}", e))
}

pub fn get_profiles(
    &self,
    filter: ProfileFilter,
    page: u32,
    per_page: u32,
) -> Result<PaginatedProfiles, String> {
    let offset = (page.saturating_sub(1)) * per_page;

    let mut conditions: Vec<String> = Vec::new();
    let mut binds: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(has_drop) = filter.has_drop {
        if has_drop {
            conditions.push(
                "(SELECT COUNT(*) FROM drops d WHERE d.profile_id = p.id) > 0".to_string(),
            );
        } else {
            conditions.push(
                "(SELECT COUNT(*) FROM drops d WHERE d.profile_id = p.id) = 0".to_string(),
            );
        }
    }

    if let Some(ref search) = filter.search {
        if !search.is_empty() {
            // search in holder_name via card join — holder_name is encrypted, so we search last4/bin plaintext
            conditions.push("(cc.last4 LIKE ?1_search OR cc.bin LIKE ?1_search)".to_string());
            // Use positional params instead
            let pat = format!("%{}%", search);
            binds.push(Box::new(pat));
            // Adjust the placeholder
            let idx = binds.len();
            let last = conditions.last_mut().unwrap();
            *last = format!(
                "(cc.last4 LIKE ?{idx} OR cc.bin LIKE ?{idx})",
                idx = idx
            );
        }
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let count_sql = format!(
        "SELECT COUNT(*) FROM profiles p
         LEFT JOIN credit_cards cc ON cc.id = p.card_id
         {}",
        where_clause
    );

    let total: u32 = {
        let mut stmt = self
            .conn
            .prepare(&count_sql)
            .map_err(|e| e.to_string())?;
        let refs: Vec<&dyn rusqlite::types::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
        stmt.query_row(refs.as_slice(), |r| r.get(0))
            .map_err(|e| e.to_string())?
    };

    let data_sql = format!(
        "SELECT p.id, p.card_id, p.notes, p.created_at, p.updated_at,
                cc.bin, cc.last4, cc.bank_name, cc.card_type, cc.country, cc.status as card_status,
                cc.holder_name as holder_enc,
                (SELECT COUNT(*) FROM drops d WHERE d.profile_id = p.id) as drop_count,
                (SELECT COUNT(*) FROM orders o WHERE o.profile_id = p.id) as order_count
         FROM profiles p
         LEFT JOIN credit_cards cc ON cc.id = p.card_id
         {}
         ORDER BY p.created_at DESC
         LIMIT ?{lim} OFFSET ?{off}",
        where_clause,
        lim = binds.len() + 1,
        off = binds.len() + 2
    );

    let mut stmt = self
        .conn
        .prepare(&data_sql)
        .map_err(|e| e.to_string())?;

    binds.push(Box::new(per_page as i64));
    binds.push(Box::new(offset as i64));
    let refs: Vec<&dyn rusqlite::types::ToSql> = binds.iter().map(|b| b.as_ref()).collect();

    let enc = self.encryption.as_ref();

    let items = stmt
        .query_map(refs.as_slice(), |r| {
            let holder_enc: Option<String> = r.get(11)?;
            Ok(ProfileRow {
                id: r.get(0)?,
                card_id: r.get(1)?,
                notes: r.get(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
                bin: r.get(5)?,
                last4: r.get(6)?,
                bank_name: r.get(7)?,
                card_type: r.get(8)?,
                country: r.get(9)?,
                card_status: r.get(10)?,
                holder_name_enc: holder_enc,
                drop_count: r.get(12)?,
                order_count: r.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let profiles: Vec<Profile> = items
        .into_iter()
        .map(|row| {
            let holder_masked = row
                .holder_name_enc
                .as_deref()
                .and_then(|enc_val| {
                    enc.and_then(|e| e.decrypt(enc_val).ok())
                })
                .map(|full| {
                    let mut parts = full.splitn(2, ' ');
                    let first = parts.next().unwrap_or("");
                    let last_initial = parts
                        .next()
                        .and_then(|l| l.chars().next())
                        .map(|c| format!(" {}.", c))
                        .unwrap_or_default();
                    format!("{}{}", first, last_initial)
                });

            Profile {
                id: row.id,
                card_id: row.card_id,
                notes: row.notes,
                created_at: row.created_at,
                updated_at: row.updated_at,
                drop_count: row.drop_count,
                order_count: row.order_count,
                bin: row.bin,
                last4: row.last4,
                bank_name: row.bank_name,
                card_type: row.card_type,
                country: row.country,
                card_status: row.card_status,
                holder_masked,
            }
        })
        .collect();

    let total_pages = ((total as f64) / (per_page as f64)).ceil() as u32;

    Ok(PaginatedProfiles {
        items: profiles,
        total,
        page,
        per_page,
        total_pages,
    })
}

pub fn get_profile_detail(&self, id: &str) -> Result<ProfileDetail, String> {
    // Profile base row
    let profile = self.get_profile_by_id(id)?;

    // Decrypted card
    let card = self.get_card_decrypted(profile.card_id)?;

    // All drops
    let drops = self.get_drops_for_profile(id)?;

    // Last 10 orders
    let orders: Vec<OrderSummary> = {
        let mut stmt = self.conn.prepare(
            "SELECT o.id, o.status, s.name, o.total_amount, o.tracking_number, o.created_at
             FROM orders o
             LEFT JOIN shops s ON s.id = o.shop_id
             WHERE o.profile_id = ?1
             ORDER BY o.created_at DESC
             LIMIT 10",
        ).map_err(|e| e.to_string())?;

        stmt.query_map(params![id], |r| {
            Ok(OrderSummary {
                id: r.get(0)?,
                status: r.get(1)?,
                shop_name: r.get(2)?,
                total_amount: r.get(3)?,
                tracking_number: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    };

    Ok(ProfileDetail {
        profile,
        card,
        drops,
        orders,
    })
}

pub fn update_profile_notes(&self, id: &str, notes: &str) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    self.conn
        .execute(
            "UPDATE profiles SET notes = ?1, updated_at = ?2 WHERE id = ?3",
            params![notes, now, id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_profile(&self, id: &str) -> Result<(), String> {
    // Check active orders
    let active_count: i64 = self
        .conn
        .query_row(
            "SELECT COUNT(*) FROM orders
             WHERE profile_id = ?1 AND status IN ('pending','processing','shipped')",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    if active_count > 0 {
        return Err(format!("active_orders:{}", active_count));
    }

    // Get card_id before deletion
    let card_id: i64 = self
        .conn
        .query_row(
            "SELECT card_id FROM profiles WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|_| "profile_not_found".to_string())?;

    let now = Utc::now().to_rfc3339();

    // Delete orders, drops, profile
    self.conn.execute("DELETE FROM orders WHERE profile_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    self.conn.execute("DELETE FROM drops WHERE profile_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    self.conn.execute("DELETE FROM profiles WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    // Free the card
    self.conn
        .execute(
            "UPDATE credit_cards SET status = 'free', updated_at = ?1 WHERE id = ?2",
            params![now, card_id],
        )
        .map_err(|e| e.to_string())?;

    self.log_event("profile.deleted", Some(&format!("profile_id={}", id)))?;
    Ok(())
}

pub fn duplicate_profile(&self, id: &str) -> Result<Profile, String> {
    // Get original profile drops to find shops already used
    let card_id: i64 = self
        .conn
        .query_row("SELECT card_id FROM profiles WHERE id = ?1", params![id], |r| r.get(0))
        .map_err(|_| "profile_not_found".to_string())?;

    // Get shops used by this profile's orders
    let used_shop_ids: Vec<i64> = {
        let mut stmt = self.conn
            .prepare("SELECT DISTINCT shop_id FROM orders WHERE profile_id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_map(params![id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<i64>, _>>()
            .map_err(|e| e.to_string())?
    };

    // Find a free card not burned in the same shops
    let free_card_id: i64 = if used_shop_ids.is_empty() {
        self.conn
            .query_row(
                "SELECT id FROM credit_cards WHERE status = 'free' LIMIT 1",
                [],
                |r| r.get(0),
            )
            .map_err(|_| "no_free_cards".to_string())?
    } else {
        // Exclude cards that appeared in orders at the same shops
        let placeholders = used_shop_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 2))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT id FROM credit_cards WHERE status = 'free'
             AND id NOT IN (
                 SELECT DISTINCT cc2.id FROM credit_cards cc2
                 JOIN profiles p2 ON p2.card_id = cc2.id
                 JOIN orders o2 ON o2.profile_id = p2.id
                 WHERE o2.shop_id IN ({})
             ) LIMIT 1",
            placeholders
        );
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(card_id)];
        for sid in &used_shop_ids {
            params_vec.push(Box::new(*sid));
        }
        let refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
        stmt.query_row(refs.as_slice(), |r| r.get(0))
            .map_err(|_| "no_unburned_free_card".to_string())?
    };

    // Get original profile notes
    let notes: String = self.conn
        .query_row("SELECT notes FROM profiles WHERE id = ?1", params![id], |r| {
            r.get::<_, Option<String>>(0).map(|v| v.unwrap_or_default())
        })
        .map_err(|e| e.to_string())?;

    // Create new profile
    let new_profile = self.create_profile(free_card_id, &notes)?;

    // Copy drops
    let drops = self.get_drops_for_profile(id)?;
    for drop in &drops {
        self.add_drop(
            &new_profile.id,
            DropInput {
                recipient_name: drop.recipient_name.clone(),
                address: drop.address.clone(),
                city: drop.city.clone(),
                state: drop.state.clone().unwrap_or_default(),
                zip: drop.zip.clone(),
                country: drop.country.clone(),
                phone: drop.phone.clone().unwrap_or_default(),
            },
        )?;
    }

    self.log_event("profile.duplicated", Some(&format!("from={} new={}", id, new_profile.id)))?;
    Ok(new_profile)
}

pub fn find_duplicate_profiles(&self) -> Result<Vec<Vec<Profile>>, String> {
    // Find card IDs used by more than one profile
    let dup_card_ids: Vec<i64> = {
        let mut stmt = self.conn.prepare(
            "SELECT card_id FROM profiles GROUP BY card_id HAVING COUNT(*) > 1"
        ).map_err(|e| e.to_string())?;
        stmt.query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<i64>, _>>()
            .map_err(|e| e.to_string())?
    };

    let mut groups: Vec<Vec<Profile>> = Vec::new();
    for card_id in dup_card_ids {
        let profile_ids: Vec<String> = {
            let mut stmt = self.conn
                .prepare("SELECT id FROM profiles WHERE card_id = ?1")
                .map_err(|e| e.to_string())?;
            stmt.query_map(params![card_id], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<String>, _>>()
                .map_err(|e| e.to_string())?
        };
        let group: Vec<Profile> = profile_ids
            .iter()
            .filter_map(|pid| self.get_profile_by_id(pid).ok())
            .collect();
        if group.len() > 1 {
            groups.push(group);
        }
    }
    Ok(groups)
}

// ─── Drops ───────────────────────────────────────────────────

pub fn get_drops_for_profile(&self, profile_id: &str) -> Result<Vec<Drop>, String> {
    let mut stmt = self.conn.prepare(
        "SELECT id, profile_id, recipient_name, address, city, state, zip, country, phone,
                is_primary, created_at
         FROM drops WHERE profile_id = ?1 ORDER BY is_primary DESC, id ASC"
    ).map_err(|e| e.to_string())?;

    let drops = stmt
        .query_map(params![profile_id], |r| {
            Ok(Drop {
                id: r.get(0)?,
                profile_id: r.get(1)?,
                recipient_name: r.get(2)?,
                address: r.get(3)?,
                city: r.get(4)?,
                state: r.get(5)?,
                zip: r.get(6)?,
                country: r.get(7)?,
                phone: r.get(8)?,
                is_primary: r.get(9)?,
                created_at: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(drops)
}

pub fn add_drop(&self, profile_id: &str, drop: DropInput) -> Result<Drop, String> {
    let existing_count: i64 = self.conn
        .query_row(
            "SELECT COUNT(*) FROM drops WHERE profile_id = ?1",
            params![profile_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let is_primary = existing_count == 0; // First drop is auto-primary
    let now = Utc::now().to_rfc3339();

    self.conn.execute(
        "INSERT INTO drops (profile_id, recipient_name, address, city, state, zip, country, phone, is_primary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            profile_id,
            drop.recipient_name,
            drop.address,
            drop.city,
            drop.state,
            drop.zip,
            drop.country,
            drop.phone,
            is_primary,
            now
        ],
    ).map_err(|e| e.to_string())?;

    let drop_id = self.conn.last_insert_rowid();

    self.log_event("profile.drop_added", Some(&format!("profile_id={} drop_id={}", profile_id, drop_id)))?;

    self.conn.query_row(
        "SELECT id, profile_id, recipient_name, address, city, state, zip, country, phone, is_primary, created_at
         FROM drops WHERE id = ?1",
        params![drop_id],
        |r| Ok(Drop {
            id: r.get(0)?,
            profile_id: r.get(1)?,
            recipient_name: r.get(2)?,
            address: r.get(3)?,
            city: r.get(4)?,
            state: r.get(5)?,
            zip: r.get(6)?,
            country: r.get(7)?,
            phone: r.get(8)?,
            is_primary: r.get(9)?,
            created_at: r.get(10)?,
        }),
    ).map_err(|e| e.to_string())
}

pub fn update_drop(&self, id: i64, drop: DropInput) -> Result<Drop, String> {
    self.conn.execute(
        "UPDATE drops SET recipient_name=?1, address=?2, city=?3, state=?4, zip=?5, country=?6, phone=?7 WHERE id=?8",
        params![drop.recipient_name, drop.address, drop.city, drop.state, drop.zip, drop.country, drop.phone, id],
    ).map_err(|e| e.to_string())?;

    self.conn.query_row(
        "SELECT id, profile_id, recipient_name, address, city, state, zip, country, phone, is_primary, created_at FROM drops WHERE id = ?1",
        params![id],
        |r| Ok(Drop {
            id: r.get(0)?,
            profile_id: r.get(1)?,
            recipient_name: r.get(2)?,
            address: r.get(3)?,
            city: r.get(4)?,
            state: r.get(5)?,
            zip: r.get(6)?,
            country: r.get(7)?,
            phone: r.get(8)?,
            is_primary: r.get(9)?,
            created_at: r.get(10)?,
        }),
    ).map_err(|e| e.to_string())
}

pub fn set_primary_drop(&self, id: i64, profile_id: &str) -> Result<(), String> {
    self.conn
        .execute(
            "UPDATE drops SET is_primary = 0 WHERE profile_id = ?1",
            params![profile_id],
        )
        .map_err(|e| e.to_string())?;
    self.conn
        .execute(
            "UPDATE drops SET is_primary = 1 WHERE id = ?1 AND profile_id = ?2",
            params![id, profile_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_drop(&self, id: i64, profile_id: &str) -> Result<(), String> {
    let is_primary: bool = self.conn
        .query_row(
            "SELECT is_primary FROM drops WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|_| "drop_not_found".to_string())?;

    self.conn
        .execute("DELETE FROM drops WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    // If deleted was primary, promote oldest remaining drop
    if is_primary {
        let _ = self.conn.execute(
            "UPDATE drops SET is_primary = 1 WHERE profile_id = ?1 ORDER BY id ASC LIMIT 1",
            params![profile_id],
        );
    }
    Ok(())
}

pub fn import_drops(
    &self,
    profile_id: &str,
    raw: &str,
    mapping: Vec<String>,
) -> Result<ImportResult, String> {
    let delimiter = crate::parser::detect_delimiter(raw);
    let mut parsed = 0u32;
    let mut skipped = 0u32;
    let mut errors: Vec<String> = Vec::new();

    for (line_no, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let fields: Vec<&str> = trimmed.split(delimiter).collect();

        let mut drop_input = DropInput {
            recipient_name: String::new(),
            address: String::new(),
            city: String::new(),
            state: String::new(),
            zip: String::new(),
            country: String::new(),
            phone: String::new(),
        };

        let mut has_required = false;

        for (i, col_name) in mapping.iter().enumerate() {
            let val = fields.get(i).unwrap_or(&"").trim().to_string();
            match col_name.as_str() {
                "recipient_name" => { drop_input.recipient_name = val; }
                "address"        => { drop_input.address = val; has_required = !drop_input.address.is_empty(); }
                "city"           => { drop_input.city = val; }
                "state"          => { drop_input.state = val; }
                "zip"            => { drop_input.zip = val; }
                "country"        => { drop_input.country = val; }
                "phone"          => { drop_input.phone = val; }
                _                => {}
            }
        }

        if !has_required || drop_input.city.is_empty() {
            skipped += 1;
            errors.push(format!("line {}: missing address or city", line_no + 1));
            continue;
        }

        match self.add_drop(profile_id, drop_input) {
            Ok(_) => parsed += 1,
            Err(e) => {
                skipped += 1;
                errors.push(format!("line {}: {}", line_no + 1, e));
            }
        }
    }

    Ok(ImportResult { parsed, skipped, errors })
}

pub fn find_duplicate_drops(&self) -> Result<Vec<Vec<Drop>>, String> {
    // Find address groups used by more than one drop
    let dup_keys: Vec<(String, String, String, String, String)> = {
        let mut stmt = self.conn.prepare(
            "SELECT address, city, state, zip, country
             FROM drops
             GROUP BY address, city, state, zip, country
             HAVING COUNT(*) > 1"
        ).map_err(|e| e.to_string())?;

        stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    };

    let mut groups: Vec<Vec<Drop>> = Vec::new();
    for (addr, city, state, zip, country) in dup_keys {
        let mut stmt = self.conn.prepare(
            "SELECT id, profile_id, recipient_name, address, city, state, zip, country, phone, is_primary, created_at
             FROM drops
             WHERE address=?1 AND city=?2 AND state=?3 AND zip=?4 AND country=?5"
        ).map_err(|e| e.to_string())?;

        let group: Vec<Drop> = stmt
            .query_map(params![addr, city, state, zip, country], |r| {
                Ok(Drop {
                    id: r.get(0)?,
                    profile_id: r.get(1)?,
                    recipient_name: r.get(2)?,
                    address: r.get(3)?,
                    city: r.get(4)?,
                    state: r.get(5)?,
                    zip: r.get(6)?,
                    country: r.get(7)?,
                    phone: r.get(8)?,
                    is_primary: r.get(9)?,
                    created_at: r.get(10)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        if group.len() > 1 {
            groups.push(group);
        }
    }
    Ok(groups)
}

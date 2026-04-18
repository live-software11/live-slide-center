// Sprint K3 (GUIDA_OPERATIVA_v3 §4.C K3) — mini-parser dei filtri PostgREST.
//
// Pattern coperti (sufficienti per gli endpoint usati dalla SPA):
//   ?col=eq.<val>            → col = ?
//   ?col=neq.<val>           → col <> ?
//   ?col=gt.<val>            → col > ?
//   ?col=gte.<val>           → col >= ?
//   ?col=lt.<val>            → col < ?
//   ?col=lte.<val>           → col <= ?
//   ?col=like.<pat>          → col LIKE ?
//   ?col=ilike.<pat>         → LOWER(col) LIKE LOWER(?)  (SQLite non ha ILIKE nativo)
//   ?col=in.(v1,v2,v3)       → col IN (?, ?, ?)
//   ?col=not.in.(v1,...)     → col NOT IN (?, ?, ?)
//   ?col=is.null             → col IS NULL
//   ?col=is.not.null         → col IS NOT NULL
//   ?col=not.is.null         → col IS NOT NULL  (alias accettato da supabase-js)
//   ?order=col.asc / col.desc (multi separati da virgola)
//   ?limit=N
//   ?offset=N
//   ?select=...              → IGNORATO (ritorniamo sempre tutte le colonne)
//   ?or=(...)                → NON SUPPORTATO (errore esplicito)
//
// Sicurezza:
//   • Le colonne in WHERE/ORDER vengono validate contro la whitelist `allowed_cols`.
//     Colonna non whitelistata → 400 BadRequest. Nessuna SQL injection possibile sui
//     nomi colonna.
//   • I valori vengono SEMPRE bindati come parametri SQLite, mai concatenati.

use std::collections::HashMap;

use serde_json::Value;

use crate::server::error::AppError;

/// Una clausola WHERE single-column.
#[derive(Debug)]
pub struct Clause {
    pub sql: String,
    pub binds: Vec<Value>,
}

/// Sortable column con direction.
#[derive(Debug)]
pub struct OrderBy {
    pub sql: String,
}

/// Result del parsing della query string.
#[derive(Debug, Default)]
pub struct ParsedQuery {
    pub where_clauses: Vec<Clause>,
    pub order_by: Vec<OrderBy>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

impl ParsedQuery {
    /// Costruisce la stringa SQL completa da appendere a `SELECT ... FROM <table>`.
    pub fn render_tail(&self) -> (String, Vec<Value>) {
        let mut sql = String::new();
        let mut binds = Vec::new();

        if !self.where_clauses.is_empty() {
            sql.push_str(" WHERE ");
            let parts: Vec<&str> = self.where_clauses.iter().map(|c| c.sql.as_str()).collect();
            sql.push_str(&parts.join(" AND "));
            for clause in &self.where_clauses {
                binds.extend(clause.binds.clone());
            }
        }

        if !self.order_by.is_empty() {
            sql.push_str(" ORDER BY ");
            let parts: Vec<&str> = self.order_by.iter().map(|o| o.sql.as_str()).collect();
            sql.push_str(&parts.join(", "));
        }

        if let Some(limit) = self.limit {
            sql.push_str(&format!(" LIMIT {}", limit.max(0)));
        }
        if let Some(offset) = self.offset {
            sql.push_str(&format!(" OFFSET {}", offset.max(0)));
        }

        (sql, binds)
    }
}

/// Parsa una query string presa da `axum::extract::Query::<HashMap<String,String>>`.
/// `allowed_cols` e' la whitelist (case-sensitive) delle colonne ammissibili
/// per WHERE / ORDER. `select`, `limit`, `offset`, `order` sono parole chiave
/// PostgREST e non vanno mai trattate come colonne.
pub fn parse_query(
    raw: &HashMap<String, String>,
    allowed_cols: &[&str],
) -> Result<ParsedQuery, AppError> {
    let mut out = ParsedQuery::default();

    for (key, value) in raw.iter() {
        match key.as_str() {
            "select" => {
                // PostgREST embedding non supportato: accettiamo il param ma lo ignoriamo
                // (la SPA continua a funzionare perche' riceve il record completo).
            }
            "limit" => {
                let n: i64 = value
                    .parse()
                    .map_err(|_| AppError::BadRequest(format!("invalid limit: {value}")))?;
                out.limit = Some(n);
            }
            "offset" => {
                let n: i64 = value
                    .parse()
                    .map_err(|_| AppError::BadRequest(format!("invalid offset: {value}")))?;
                out.offset = Some(n);
            }
            "order" => {
                for token in value.split(',') {
                    let trimmed = token.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let mut parts = trimmed.splitn(2, '.');
                    let col = parts.next().unwrap_or_default();
                    let dir = parts.next().unwrap_or("asc").to_ascii_lowercase();
                    if !allowed_cols.contains(&col) {
                        return Err(AppError::BadRequest(format!("order column not allowed: {col}")));
                    }
                    let dir_sql = match dir.as_str() {
                        "asc" => "ASC",
                        "desc" => "DESC",
                        // PostgREST estesi: "asc.nullsfirst", ecc. → ignora il suffix.
                        d if d.starts_with("asc") => "ASC",
                        d if d.starts_with("desc") => "DESC",
                        _ => return Err(AppError::BadRequest(format!("invalid order direction: {dir}"))),
                    };
                    out.order_by.push(OrderBy {
                        sql: format!("{col} {dir_sql}"),
                    });
                }
            }
            "or" | "and" => {
                return Err(AppError::BadRequest(
                    "or/and combined filters not supported by desktop server (Sprint K)".into(),
                ));
            }
            // Ignora gli header che alcuni client passano in querystring per sbaglio.
            "apikey" | "id-only" | "count" | "head" => {}
            // Tutto il resto: filtro su colonna.
            col => {
                if !allowed_cols.contains(&col) {
                    return Err(AppError::BadRequest(format!(
                        "filter column not allowed on this table: {col}"
                    )));
                }
                let clause = parse_filter_value(col, value)?;
                out.where_clauses.push(clause);
            }
        }
    }

    Ok(out)
}

fn parse_filter_value(col: &str, raw: &str) -> Result<Clause, AppError> {
    // Forme accettate (deserializzate da `key=value` HTTP):
    //  - eq.<v>, neq.<v>, gt.<v>, gte.<v>, lt.<v>, lte.<v>
    //  - like.<v>, ilike.<v>
    //  - in.(<v1>,<v2>,...)
    //  - not.in.(<v1>,...)
    //  - is.null, is.not.null, not.is.null
    let raw = raw.trim();

    if raw == "is.null" {
        return Ok(Clause { sql: format!("{col} IS NULL"), binds: vec![] });
    }
    if raw == "is.not.null" || raw == "not.is.null" {
        return Ok(Clause { sql: format!("{col} IS NOT NULL"), binds: vec![] });
    }

    if let Some(rest) = raw.strip_prefix("eq.") {
        return Ok(Clause { sql: format!("{col} = ?"), binds: vec![value_to_json(rest)] });
    }
    if let Some(rest) = raw.strip_prefix("neq.") {
        return Ok(Clause { sql: format!("{col} <> ?"), binds: vec![value_to_json(rest)] });
    }
    if let Some(rest) = raw.strip_prefix("gt.") {
        return Ok(Clause { sql: format!("{col} > ?"), binds: vec![value_to_json(rest)] });
    }
    if let Some(rest) = raw.strip_prefix("gte.") {
        return Ok(Clause { sql: format!("{col} >= ?"), binds: vec![value_to_json(rest)] });
    }
    if let Some(rest) = raw.strip_prefix("lt.") {
        return Ok(Clause { sql: format!("{col} < ?"), binds: vec![value_to_json(rest)] });
    }
    if let Some(rest) = raw.strip_prefix("lte.") {
        return Ok(Clause { sql: format!("{col} <= ?"), binds: vec![value_to_json(rest)] });
    }
    if let Some(rest) = raw.strip_prefix("like.") {
        return Ok(Clause { sql: format!("{col} LIKE ?"), binds: vec![Value::String(rest.to_string())] });
    }
    if let Some(rest) = raw.strip_prefix("ilike.") {
        return Ok(Clause {
            sql: format!("LOWER({col}) LIKE LOWER(?)"),
            binds: vec![Value::String(rest.to_string())],
        });
    }
    if let Some(rest) = raw.strip_prefix("in.") {
        let values = parse_in_list(rest)?;
        let placeholders = vec!["?"; values.len()].join(",");
        return Ok(Clause { sql: format!("{col} IN ({placeholders})"), binds: values });
    }
    if let Some(rest) = raw.strip_prefix("not.in.") {
        let values = parse_in_list(rest)?;
        let placeholders = vec!["?"; values.len()].join(",");
        return Ok(Clause { sql: format!("{col} NOT IN ({placeholders})"), binds: values });
    }

    Err(AppError::BadRequest(format!(
        "unsupported filter expression on {col}: {raw}"
    )))
}

fn parse_in_list(raw: &str) -> Result<Vec<Value>, AppError> {
    let inner = raw
        .strip_prefix('(')
        .and_then(|s| s.strip_suffix(')'))
        .ok_or_else(|| AppError::BadRequest("in.(...) malformed: missing parens".into()))?;
    if inner.is_empty() {
        return Err(AppError::BadRequest("in.() empty list".into()));
    }
    Ok(inner.split(',').map(|s| value_to_json(s.trim())).collect())
}

/// Converte un valore stringa proveniente dalla query string in `serde_json::Value`
/// preservando il tipo logico:
///   "true"/"false" → bool
///   numero → number
///   "null" → null
///   altrimenti → string
fn value_to_json(raw: &str) -> Value {
    let trimmed = raw.trim_matches('"');
    match trimmed {
        "true" => Value::Bool(true),
        "false" => Value::Bool(false),
        "null" => Value::Null,
        _ => {
            if let Ok(i) = trimmed.parse::<i64>() {
                Value::Number(serde_json::Number::from(i))
            } else if let Ok(f) = trimmed.parse::<f64>() {
                serde_json::Number::from_f64(f).map(Value::Number).unwrap_or_else(|| Value::String(trimmed.to_string()))
            } else {
                Value::String(trimmed.to_string())
            }
        }
    }
}

/// Bind helper: trasforma un `serde_json::Value` in un parametro rusqlite usabile.
/// Tenuto qui (anche se ora `routes/rest.rs` usa direttamente `json_to_sql_value`)
/// perche' verra' riusato dagli RPC custom in Sprint M+.
#[allow(dead_code)]
pub fn bind_value(val: &Value) -> Box<dyn rusqlite::ToSql + Send + Sync> {
    match val {
        Value::Null => Box::new(rusqlite::types::Null),
        Value::Bool(b) => Box::new(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else if let Some(f) = n.as_f64() {
                Box::new(f)
            } else {
                Box::new(n.to_string())
            }
        }
        Value::String(s) => Box::new(s.clone()),
        Value::Array(_) | Value::Object(_) => {
            // Per JSONB: serializzato come stringa JSON (le colonne SQLite TEXT
            // come `settings` accettano il JSON e la SPA fa parse lato client).
            Box::new(val.to_string())
        }
    }
}

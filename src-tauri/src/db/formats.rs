//! 取込形式（明細のファイルの読み方と、取込先の口座）。
//!
//! 利用者が作った形式は DB に置く。同梱のプリセット（`presets/*.json`）は、利用者が書き出した
//! 形式のファイルと同じ形のデータで、そのままでは使わず、取込先の口座を選んで複製して使う。

use crate::domain::master::{self, NAME_MAX};
use crate::domain::statement::{FormatDefinition, SourceKind};
use crate::error::{AppError, AppResult, ErrorCode};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

/// 同梱のプリセット。キーと、形式のファイルの中身。
/// 銀行のプリセットは、公開されている情報から様式を推測して作った。実物の明細（個人情報を伏せたもの）で
/// 見出しを確かめるまでは、見出しが違えば自動では当てはまらず、形式エディタが開く。
const PRESETS: &[(&str, &str)] = &[
    ("amex", include_str!("../../presets/amex.json")),
    ("bank-yucho", include_str!("../../presets/bank-yucho.json")),
    ("bank-mufg", include_str!("../../presets/bank-mufg.json")),
    ("bank-smbc", include_str!("../../presets/bank-smbc.json")),
    (
        "bank-rakuten",
        include_str!("../../presets/bank-rakuten.json"),
    ),
    ("bank-sbi", include_str!("../../presets/bank-sbi.json")),
    (
        "bank-yamaguchi",
        include_str!("../../presets/bank-yamaguchi.json"),
    ),
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFormat {
    /// 利用者が作った形式の id。プリセットなら空
    pub id: Option<i64>,
    /// プリセットのキー。利用者の形式なら空
    pub preset: Option<String>,
    pub name: String,
    pub source_kind: SourceKind,
    pub payment_account_id: Option<i64>,
    pub payment_sub_account_id: Option<i64>,
    pub definition: FormatDefinition,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatInput {
    pub name: String,
    pub source_kind: SourceKind,
    pub payment_account_id: i64,
    #[serde(default)]
    pub payment_sub_account_id: Option<i64>,
    pub definition: FormatDefinition,
}

/// 書き出す形式のファイル（JSON）。取込先の口座は含めない（他の人と共有できるように）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatFile {
    pub app: String,
    pub kind: String,
    pub version: u32,
    pub name: String,
    pub source_kind: SourceKind,
    pub definition: FormatDefinition,
}

const APP: &str = "dcs-accounting";
const KIND: &str = "importFormat";

impl FormatFile {
    pub fn of(format: &ImportFormat) -> Self {
        Self {
            app: APP.into(),
            kind: KIND.into(),
            version: 1,
            name: format.name.clone(),
            source_kind: format.source_kind,
            definition: format.definition.clone(),
        }
    }

    /// 形式のファイルを読む。このアプリの形式のファイルでなければエラー。
    pub fn parse(text: &str) -> AppResult<Self> {
        let file: FormatFile = serde_json::from_str(text.trim_start_matches('\u{feff}'))
            .map_err(|_| AppError::new(ErrorCode::FileRead))?;
        if file.app != APP || file.kind != KIND || file.version != 1 {
            return Err(AppError::new(ErrorCode::FileRead));
        }
        Ok(file)
    }
}

pub fn presets() -> Vec<ImportFormat> {
    PRESETS
        .iter()
        .filter_map(|(key, text)| {
            let file = FormatFile::parse(text).ok()?;
            Some(ImportFormat {
                id: None,
                preset: Some((*key).to_string()),
                name: file.name,
                source_kind: file.source_kind,
                payment_account_id: None,
                payment_sub_account_id: None,
                definition: file.definition,
            })
        })
        .collect()
}

fn from_row(row: &Row<'_>) -> rusqlite::Result<ImportFormat> {
    let definition: String = row.get(5)?;
    Ok(ImportFormat {
        id: Some(row.get(0)?),
        preset: None,
        name: row.get(1)?,
        source_kind: row.get(2)?,
        payment_account_id: Some(row.get(3)?),
        payment_sub_account_id: row.get(4)?,
        definition: serde_json::from_str(&definition).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, Box::new(e))
        })?,
    })
}

const SELECT: &str =
    "SELECT id, name, source_kind, payment_account_id, payment_sub_account_id, definition FROM import_formats";

/// 利用者の形式（名前の順）。
pub fn list(conn: &Connection) -> AppResult<Vec<ImportFormat>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY name, id"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<ImportFormat> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], from_row)
        .optional()?
        .ok_or(AppError::field(ErrorCode::NotFound, "formatId"))
}

/// 取込先が口座の科目で、補助科目がその科目のものか。
pub(crate) fn ensure_target(
    conn: &Connection,
    account_id: i64,
    sub_account_id: Option<i64>,
) -> AppResult<()> {
    let is_payment: Option<bool> = conn
        .query_row(
            "SELECT is_payment_account FROM accounts WHERE id = ?1",
            [account_id],
            |r| r.get(0),
        )
        .optional()?;
    match is_payment {
        None => return Err(AppError::field(ErrorCode::NotFound, "paymentAccountId")),
        Some(false) => {
            return Err(AppError::field(
                ErrorCode::InvalidFormat,
                "paymentAccountId",
            ))
        }
        Some(true) => {}
    }
    if let Some(sub) = sub_account_id {
        let owner: Option<i64> = conn
            .query_row(
                "SELECT account_id FROM sub_accounts WHERE id = ?1",
                [sub],
                |r| r.get(0),
            )
            .optional()?;
        if owner != Some(account_id) {
            return Err(AppError::field(
                ErrorCode::InvalidFormat,
                "paymentSubAccountId",
            ));
        }
    }
    Ok(())
}

/// 形式の中身を確かめる。必須の役割（利用日・金額・店名）がそろっているか。
pub fn validate_definition(def: &FormatDefinition) -> AppResult<()> {
    if !def.missing_roles().is_empty() {
        return Err(AppError::field(ErrorCode::Required, "columns"));
    }
    if def.header_row > 0 && def.header.is_empty() {
        return Err(AppError::field(ErrorCode::Required, "headerRow"));
    }
    Ok(())
}

fn validate(conn: &Connection, input: &FormatInput) -> AppResult<String> {
    let name = master::required(&input.name, NAME_MAX, "name")?;
    ensure_target(conn, input.payment_account_id, input.payment_sub_account_id)?;
    validate_definition(&input.definition)?;
    Ok(name)
}

fn definition_json(def: &FormatDefinition) -> AppResult<String> {
    serde_json::to_string(def).map_err(|_| AppError::new(ErrorCode::InvalidFormat))
}

pub fn create(conn: &Connection, input: &FormatInput) -> AppResult<ImportFormat> {
    let name = validate(conn, input)?;
    conn.execute(
        "INSERT INTO import_formats (name, source_kind, payment_account_id, payment_sub_account_id, definition)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            name,
            input.source_kind,
            input.payment_account_id,
            input.payment_sub_account_id,
            definition_json(&input.definition)?
        ],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: &FormatInput) -> AppResult<ImportFormat> {
    let name = validate(conn, input)?;
    let changed = conn.execute(
        "UPDATE import_formats SET name = ?2, source_kind = ?3, payment_account_id = ?4, payment_sub_account_id = ?5,
             definition = ?6, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ?1",
        params![
            id,
            name,
            input.source_kind,
            input.payment_account_id,
            input.payment_sub_account_id,
            definition_json(&input.definition)?
        ],
    )?;
    if changed == 0 {
        return Err(AppError::field(ErrorCode::NotFound, "formatId"));
    }
    get(conn, id)
}

/// 形式を消す。受信箱の候補は残る（どの形式で読んだかだけが消える）。
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM import_formats WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::setup::tests::set_up_db;
    use crate::db::transactions::tests::account;
    use crate::domain::statement::{AmountSign, ColumnRole, Delimiter, TextEncoding};

    pub(crate) fn definition() -> FormatDefinition {
        FormatDefinition {
            encoding: TextEncoding::Utf8,
            delimiter: Delimiter::Comma,
            header_row: 1,
            columns: vec![ColumnRole::Date, ColumnRole::Merchant, ColumnRole::Amount],
            sign: AmountSign::SpendPositive,
            skip_unreadable_dates: true,
            header: vec!["日付".into(), "内容".into(), "金額".into()],
        }
    }

    pub(crate) fn card_format(conn: &Connection) -> ImportFormat {
        create(
            conn,
            &FormatInput {
                name: "テストカード".into(),
                source_kind: SourceKind::Card,
                payment_account_id: account(conn, "204"),
                payment_sub_account_id: None,
                definition: definition(),
            },
        )
        .unwrap()
    }

    /// 普通預金を取込先にした銀行の形式。
    pub(crate) fn bank_format(conn: &Connection) -> ImportFormat {
        create(
            conn,
            &FormatInput {
                name: "テスト銀行".into(),
                source_kind: SourceKind::Bank,
                payment_account_id: account(conn, "104"),
                payment_sub_account_id: None,
                definition: definition(),
            },
        )
        .unwrap()
    }

    #[test]
    fn every_preset_is_a_valid_format() {
        for p in presets() {
            assert!(validate_definition(&p.definition).is_ok(), "{}", p.name);
        }
    }

    #[test]
    fn the_amex_preset_is_an_ordinary_format_file() {
        let presets = presets();
        assert_eq!(presets.len(), PRESETS.len());
        let amex = &presets[0];
        assert_eq!(amex.preset.as_deref(), Some("amex"));
        assert!(validate_definition(&amex.definition).is_ok());
        // 書き出すと同じ形になる
        let file = FormatFile::of(amex);
        assert_eq!(
            FormatFile::parse(&serde_json::to_string(&file).unwrap()).unwrap(),
            file
        );
    }

    #[test]
    fn saves_formats_and_checks_the_target_and_roles() {
        let db = set_up_db();
        let conn = db.conn();
        let format = card_format(&conn);
        assert_eq!(list(&conn).unwrap(), std::slice::from_ref(&format));

        let mut input = FormatInput {
            name: "売上の口座".into(),
            source_kind: SourceKind::Bank,
            payment_account_id: account(&conn, "401"),
            payment_sub_account_id: None,
            definition: definition(),
        };
        assert_eq!(
            create(&conn, &input).unwrap_err(),
            AppError::field(ErrorCode::InvalidFormat, "paymentAccountId")
        );
        input.payment_account_id = account(&conn, "104");
        input.definition.columns = vec![ColumnRole::Date, ColumnRole::Merchant];
        assert_eq!(
            create(&conn, &input).unwrap_err(),
            AppError::field(ErrorCode::Required, "columns")
        );

        delete(&conn, format.id.unwrap()).unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn other_files_are_not_read_as_formats() {
        assert_eq!(
            FormatFile::parse("{}").unwrap_err(),
            AppError::new(ErrorCode::FileRead)
        );
        assert_eq!(
            FormatFile::parse("not json").unwrap_err(),
            AppError::new(ErrorCode::FileRead)
        );
    }
}

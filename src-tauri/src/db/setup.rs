//! 初期設定（事業者情報・申告区分・年度・科目の投入）。

use super::Database;
pub use crate::domain::industry::IndustryTemplate;
use crate::domain::master::{self, FilingType, TaxStatus, NAME_MAX};
use crate::domain::standard_accounts;
use crate::error::{AppError, AppResult, ErrorCode};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const ADDRESS_MAX: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub completed: bool,
    /// いま開いている年度（最も新しい年度）
    pub fiscal_year: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessProfile {
    pub trade_name: String,
    pub owner_name: String,
    pub address: String,
    pub industry: String,
    pub invoice_registration_no: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupInput {
    pub profile: BusinessProfile,
    pub fiscal_year: i64,
    pub filing_type: FilingType,
    pub tax_status: TaxStatus,
    pub template: IndustryTemplate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiscalYear {
    pub year: i64,
    pub filing_type: FilingType,
    pub tax_status: TaxStatus,
    pub closed: bool,
}

impl BusinessProfile {
    fn validated(&self) -> AppResult<Self> {
        Ok(Self {
            trade_name: master::optional(&self.trade_name, NAME_MAX, "tradeName")?,
            owner_name: master::required(&self.owner_name, NAME_MAX, "ownerName")?,
            address: master::optional(&self.address, ADDRESS_MAX, "address")?,
            industry: master::optional(&self.industry, NAME_MAX, "industry")?,
            invoice_registration_no: master::invoice_registration_no(
                self.invoice_registration_no.as_deref(),
            )?,
        })
    }
}

fn validate_year(year: i64) -> AppResult<i64> {
    if (2000..=2100).contains(&year) {
        Ok(year)
    } else {
        Err(AppError::field(ErrorCode::OutOfRange, "fiscalYear"))
    }
}

pub fn status(conn: &Connection) -> AppResult<SetupStatus> {
    let has_profile: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM business_profile)",
        [],
        |row| row.get(0),
    )?;
    let fiscal_year: Option<i64> =
        conn.query_row("SELECT max(year) FROM fiscal_years", [], |row| row.get(0))?;
    Ok(SetupStatus {
        completed: has_profile && fiscal_year.is_some(),
        fiscal_year,
    })
}

/// 初期設定を 1 つのトランザクションで行う。途中で失敗したら何も残さない。
pub fn complete(db: &Database, input: &SetupInput) -> AppResult<SetupStatus> {
    let profile = input.profile.validated()?;
    let year = validate_year(input.fiscal_year)?;

    db.transaction(|tx| {
        if status(tx)?.completed {
            return Err(AppError::new(ErrorCode::AlreadySetUp));
        }
        tx.execute(
            "INSERT INTO business_profile (id, trade_name, owner_name, address, industry, invoice_registration_no)
             VALUES (1, ?1, ?2, ?3, ?4, ?5)",
            params![
                profile.trade_name,
                profile.owner_name,
                profile.address,
                profile.industry,
                profile.invoice_registration_no
            ],
        )?;
        tx.execute(
            "INSERT INTO fiscal_years (year, filing_type, tax_status) VALUES (?1, ?2, ?3)",
            params![year, input.filing_type, input.tax_status],
        )?;
        seed_accounts(tx, input.template)?;
        status(tx)
    })
}

fn seed_accounts(conn: &Connection, template: IndustryTemplate) -> AppResult<()> {
    let accounts = standard_accounts::GENERAL;
    let mut insert = conn.prepare(
        "INSERT INTO accounts (code, name_ja, name_en, kana, category, statement_line, default_tax_category, is_payment_account, is_system, sort)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9)",
    )?;
    for (index, a) in accounts.iter().enumerate() {
        insert.execute(params![
            a.code,
            a.name_ja,
            a.name_en,
            a.kana,
            a.category,
            a.statement_line,
            a.default_tax_category,
            standard_accounts::PAYMENT_ACCOUNTS.contains(&a.code),
            (index as i64 + 1) * 10
        ])?;
    }
    // 業種で足す科目は、標準の経費のあと（雑費の前）に並べる
    let mut extra = conn.prepare(
        "INSERT INTO accounts (code, name_ja, name_en, kana, category, statement_line, default_tax_category, is_system, sort)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, 0,
                 (SELECT sort FROM accounts WHERE code = '699') - 5 + ?7)",
    )?;
    for (index, a) in template.accounts().iter().enumerate() {
        extra.execute(params![
            a.code,
            a.name_ja,
            a.name_en,
            a.kana,
            a.category,
            a.tax,
            index as i64
        ])?;
    }
    let mut rule = conn.prepare(
        "INSERT INTO allocation_rules (code, name_ja, name_en, business_percent, sort) VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for (index, r) in template.allocation_rules().iter().enumerate() {
        rule.execute(params![
            r.code,
            r.name_ja,
            r.name_en,
            r.business_percent,
            (index as i64 + 1) * 10
        ])?;
    }
    Ok(())
}

pub fn profile(conn: &Connection) -> AppResult<BusinessProfile> {
    conn.query_row(
        "SELECT trade_name, owner_name, address, industry, invoice_registration_no FROM business_profile WHERE id = 1",
        [],
        |row| {
            Ok(BusinessProfile {
                trade_name: row.get(0)?,
                owner_name: row.get(1)?,
                address: row.get(2)?,
                industry: row.get(3)?,
                invoice_registration_no: row.get(4)?,
            })
        },
    )
    .optional()?
    .ok_or(AppError::new(ErrorCode::NotSetUp))
}

pub fn update_profile(conn: &Connection, input: &BusinessProfile) -> AppResult<BusinessProfile> {
    let p = input.validated()?;
    let changed = conn.execute(
        "UPDATE business_profile
         SET trade_name = ?1, owner_name = ?2, address = ?3, industry = ?4, invoice_registration_no = ?5,
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = 1",
        params![
            p.trade_name,
            p.owner_name,
            p.address,
            p.industry,
            p.invoice_registration_no
        ],
    )?;
    if changed == 0 {
        return Err(AppError::new(ErrorCode::NotSetUp));
    }
    Ok(p)
}

pub fn fiscal_years(conn: &Connection) -> AppResult<Vec<FiscalYear>> {
    let mut stmt = conn.prepare(
        "SELECT year, filing_type, tax_status, status = 'closed' FROM fiscal_years ORDER BY year DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(FiscalYear {
            year: row.get(0)?,
            filing_type: row.get(1)?,
            tax_status: row.get(2)?,
            closed: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn input() -> SetupInput {
        SetupInput {
            profile: BusinessProfile {
                trade_name: "テスト教室".into(),
                owner_name: " 山田 花子 ".into(),
                address: "".into(),
                industry: "教室".into(),
                invoice_registration_no: Some("t1234567890123".into()),
            },
            fiscal_year: 2026,
            filing_type: FilingType::Blue65,
            tax_status: TaxStatus::Exempt,
            template: IndustryTemplate::General,
        }
    }

    /// 初期設定を済ませた DB。他のテストからも使う。
    pub(crate) fn set_up_db() -> Database {
        let db = Database::open_in_memory().unwrap();
        complete(&db, &input()).unwrap();
        db
    }

    #[test]
    fn industry_templates_add_accounts_before_misc_and_allocation_rules() {
        let db = Database::open_in_memory().unwrap();
        complete(
            &db,
            &SetupInput {
                template: IndustryTemplate::School,
                ..input()
            },
        )
        .unwrap();
        let conn = db.conn();
        let accounts = crate::db::accounts::list(&conn).unwrap();
        let position = |code: &str| accounts.iter().position(|a| a.code == code).unwrap();
        // 教材費は標準の経費（貸倒金）のあと、雑費の前
        assert!(position("617") < position("620") && position("620") < position("699"));
        let materials = &accounts[position("620")];
        assert_eq!(materials.name_ja, "教材費");
        assert!(materials.statement_line.is_none() && !materials.is_system);
        let rules = crate::db::allocation_rules::list(&conn).unwrap();
        assert_eq!(
            rules.iter().map(|r| r.business_percent).collect::<Vec<_>>(),
            [50, 50]
        );
        // 汎用は足さない
        drop(conn);
        let general = set_up_db();
        assert!(crate::db::allocation_rules::list(&general.conn())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn new_database_is_not_set_up() {
        let db = Database::open_in_memory().unwrap();
        assert_eq!(
            status(&db.conn()).unwrap(),
            SetupStatus {
                completed: false,
                fiscal_year: None
            }
        );
        assert_eq!(profile(&db.conn()).unwrap_err().code, ErrorCode::NotSetUp);
    }

    #[test]
    fn complete_saves_profile_year_and_standard_accounts() {
        let db = Database::open_in_memory().unwrap();
        let result = complete(&db, &input()).unwrap();
        assert_eq!(
            result,
            SetupStatus {
                completed: true,
                fiscal_year: Some(2026)
            }
        );

        let conn = db.conn();
        let p = profile(&conn).unwrap();
        assert_eq!(p.owner_name, "山田 花子");
        assert_eq!(p.invoice_registration_no.as_deref(), Some("T1234567890123"));

        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM accounts WHERE is_system = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count as usize, standard_accounts::GENERAL.len());

        let years = fiscal_years(&conn).unwrap();
        assert_eq!(years.len(), 1);
        assert_eq!(years[0].filing_type, FilingType::Blue65);
        assert!(!years[0].closed);
    }

    #[test]
    fn cannot_set_up_twice() {
        let db = set_up_db();
        assert_eq!(
            complete(&db, &input()).unwrap_err().code,
            ErrorCode::AlreadySetUp
        );
    }

    #[test]
    fn invalid_input_leaves_nothing_behind() {
        let db = Database::open_in_memory().unwrap();
        let mut bad = input();
        bad.profile.owner_name = " ".into();
        assert_eq!(
            complete(&db, &bad).unwrap_err(),
            AppError::field(ErrorCode::Required, "ownerName")
        );
        let mut bad = input();
        bad.fiscal_year = 1999;
        assert_eq!(
            complete(&db, &bad).unwrap_err(),
            AppError::field(ErrorCode::OutOfRange, "fiscalYear")
        );
        assert!(!status(&db.conn()).unwrap().completed);
        let count: i64 = db
            .conn()
            .query_row("SELECT count(*) FROM accounts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn update_profile_validates_and_saves() {
        let db = set_up_db();
        let conn = db.conn();
        let mut p = profile(&conn).unwrap();
        p.address = "東京都".into();
        p.invoice_registration_no = None;
        update_profile(&conn, &p).unwrap();
        assert_eq!(profile(&conn).unwrap(), p);

        p.owner_name = "".into();
        assert!(update_profile(&conn, &p).is_err());
    }

    #[test]
    fn deserializes_input_from_camel_case_json() {
        let json = serde_json::json!({
            "profile": {
                "tradeName": "",
                "ownerName": "a",
                "address": "",
                "industry": "",
                "invoiceRegistrationNo": null
            },
            "fiscalYear": 2026,
            "filingType": "blue10",
            "taxStatus": "special20",
            "template": "general"
        });
        let input: SetupInput = serde_json::from_value(json).unwrap();
        assert_eq!(input.filing_type, FilingType::Blue10);
        assert_eq!(input.tax_status, TaxStatus::Special20);
    }
}

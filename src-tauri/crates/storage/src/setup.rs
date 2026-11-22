//! 初期設定（事業者情報・申告区分・年度・科目の投入）。

use super::Database;
use chobiyori_core::error::{AppError, AppResult, ErrorCode};
pub use chobiyori_core::industry::IndustryTemplate;
use chobiyori_core::master::{self, FilingType, TaxStatus, NAME_MAX};
use chobiyori_core::standard_accounts;
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
    #[serde(default)]
    pub accounts: Vec<SetupAccount>,
    #[serde(default)]
    pub opening_balances: Vec<SetupOpening>,
    #[serde(default)]
    pub features: FeatureSettings,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupAccount {
    pub name: String,
    pub kind: SetupAccountKind,
    pub balance: Option<i64>,
}

chobiyori_core::string_enum! {
    pub enum SetupAccountKind {
        Cash => "cash",
        Bank => "bank",
        Card => "card",
        EMoney => "eMoney",
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupOpening {
    pub account_code: String,
    pub amount: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureSettings {
    pub inventory: bool,
    pub receivables: bool,
    pub recurring: bool,
    pub allocation: bool,
}

impl Default for FeatureSettings {
    fn default() -> Self {
        Self {
            inventory: true,
            receivables: true,
            recurring: true,
            allocation: true,
        }
    }
}

/// 保存済みの業種。選択した記録のない古い帳簿では汎用の案内を使う。
pub fn industry_template(conn: &Connection) -> AppResult<IndustryTemplate> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'industry_template'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    match value {
        Some(value) => serde_json::from_value(serde_json::Value::String(value))
            .map_err(|_| AppError::new(ErrorCode::InvalidFormat)),
        None => Ok(IndustryTemplate::General),
    }
}

pub fn features(conn: &Connection) -> AppResult<FeatureSettings> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'features'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    match value {
        Some(value) => {
            serde_json::from_str(&value).map_err(|_| AppError::new(ErrorCode::InvalidFormat))
        }
        None => Ok(FeatureSettings::default()),
    }
}

pub fn save_features(conn: &Connection, input: &FeatureSettings) -> AppResult<FeatureSettings> {
    let value =
        serde_json::to_string(input).map_err(|_| AppError::new(ErrorCode::InvalidFormat))?;
    conn.execute("INSERT INTO settings (key, value) VALUES ('features', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [value])?;
    Ok(input.clone())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiscalYear {
    pub year: i64,
    pub filing_type: FilingType,
    pub tax_status: TaxStatus,
    pub closed: bool,
    /// 課税として扱う最初の日。年の途中でインボイスに登録した年は登録日。免税の年度は `None`
    pub taxable_from: Option<String>,
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
    if input.accounts.len() + input.opening_balances.len() > 100 {
        return Err(AppError::new(ErrorCode::OutOfRange));
    }

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
        let mut asset_total = 0_i64;
        let mut liability_total = 0_i64;
        // 作った口座のコード（W001 から順に）
        let mut created = 0;
        for (index, account) in input.accounts.iter().enumerate() {
            let name = master::required(&account.name, NAME_MAX, "accountName")
                .map_err(|e| AppError::line(e.code, index, "accountName"))?;
            if account.balance.unwrap_or_default().abs_diff(0) > chobiyori_core::journal::AMOUNT_MAX as u64 {
                return Err(AppError::line(ErrorCode::OutOfRange, index, "openingBalance"));
            }
            // 口座は、同じ種類の標準の科目のすぐあとに並べる
            let (category, line, after) = match account.kind {
                SetupAccountKind::Cash => ("asset", "bs.cash", "101"),
                SetupAccountKind::Bank => ("asset", "bs.other_deposits", "104"),
                SetupAccountKind::Card => ("liability", "bs.accrued_payables", "204"),
                SetupAccountKind::EMoney => ("asset", "bs.other_assets", "104"),
            };
            let id = if account.kind == SetupAccountKind::Cash && index == 0 {
                // 名前を変えていなければ（どちらかの言語の既定の名前なら）、標準の名前のままにする
                if name != "現金" && !name.eq_ignore_ascii_case("cash") {
                    tx.execute("UPDATE accounts SET name_ja = ?1 WHERE code = '101'", [&name])?;
                }
                tx.query_row("SELECT id FROM accounts WHERE code = '101'", [], |r| r.get::<_, i64>(0))?
            } else {
                created += 1;
                tx.execute(
                    "INSERT INTO accounts (code, name_ja, category, statement_line, is_payment_account, sort)
                     VALUES (?1, ?2, ?3, ?4, 1, (SELECT sort + 1 FROM accounts WHERE code = ?5))",
                    params![format!("W{created:03}"), name, category, line, after],
                )?;
                tx.last_insert_rowid()
            };
            let Some(balance)=account.balance else {continue;};
            tx.execute("INSERT INTO opening_balances (fiscal_year, account_id, amount) VALUES (?1, ?2, ?3)", params![year, id, balance])?;
            if category == "asset" { asset_total += balance; } else { liability_total += balance; }
        }
        let mut seen = std::collections::HashSet::new();
        for (index, row) in input.opening_balances.iter().enumerate() {
            if !seen.insert(row.account_code.clone()) || row.account_code == "302" {
                return Err(AppError::line(ErrorCode::DuplicateCode, index, "otherBalance"));
            }
            if row.amount.abs_diff(0) > chobiyori_core::journal::AMOUNT_MAX as u64 {
                return Err(AppError::line(ErrorCode::OutOfRange, index, "otherBalance"));
            }
            let (id, category): (i64, String) = tx.query_row("SELECT id, category FROM accounts WHERE code = ?1 AND category IN ('asset', 'liability', 'equity')", [&row.account_code], |r| Ok((r.get(0)?, r.get(1)?))).optional()?.ok_or(AppError::line(ErrorCode::NotFound, index, "otherBalance"))?;
            let exists: bool = tx.query_row("SELECT EXISTS (SELECT 1 FROM opening_balances WHERE fiscal_year = ?1 AND account_id = ?2)", params![year, id], |r| r.get(0))?;
            if exists { return Err(AppError::line(ErrorCode::DuplicateCode, index, "otherBalance")); }
            tx.execute("INSERT INTO opening_balances (fiscal_year, account_id, amount) VALUES (?1, ?2, ?3)", params![year, id, row.amount])?;
            if category == "asset" { asset_total += row.amount; } else { liability_total += row.amount; }
        }
        if (asset_total - liability_total).abs_diff(0) > chobiyori_core::journal::AMOUNT_MAX as u64 {
            return Err(AppError::new(ErrorCode::OutOfRange));
        }
        if input.accounts.iter().any(|a|a.balance.is_some()) || !input.opening_balances.is_empty() {
            tx.execute("INSERT INTO opening_balances (fiscal_year, account_id, amount) SELECT ?1, id, ?2 FROM accounts WHERE code = '302'", params![year, asset_total - liability_total])?;

        }
        save_features(tx, &input.features)?;
        tx.execute("INSERT INTO settings (key, value) VALUES ('industry_template', ?1)", [input.template.as_str()])?;
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
        // ルールの名前にある科目（家賃・光熱費など）の既定の按分ルールにする
        let id = conn.last_insert_rowid();
        for code in r.accounts {
            conn.execute(
                "UPDATE accounts SET default_allocation_rule_id = ?1 WHERE code = ?2",
                params![id, code],
            )?;
        }
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

/// 年度の申告区分（青色・白色）を変える。締めた年度は変えられない。
pub fn set_filing_type(
    db: &Database,
    year: i64,
    filing_type: FilingType,
) -> AppResult<Vec<FiscalYear>> {
    db.transaction(|tx| {
        super::transactions::ensure_year_open(tx, year)?;
        tx.execute(
            "UPDATE fiscal_years SET filing_type = ?1 WHERE year = ?2",
            params![filing_type, year],
        )?;
        super::audit::event(
            tx,
            "filing_type",
            "update",
            Some(year),
            Some(serde_json::json!({ "filingType": filing_type })),
        )?;
        fiscal_years(tx)
    })
}

pub fn fiscal_years(conn: &Connection) -> AppResult<Vec<FiscalYear>> {
    let mut stmt = conn.prepare(
        "SELECT year, filing_type, tax_status, status = 'closed', invoice_tax_start FROM fiscal_years ORDER BY year DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let year: i64 = row.get(0)?;
        let tax_status: TaxStatus = row.get(2)?;
        let start: Option<String> = row.get(4)?;
        Ok(FiscalYear {
            year,
            filing_type: row.get(1)?,
            tax_status,
            closed: row.get(3)?,
            taxable_from: chobiyori_core::filing::taxable_from(
                year,
                tax_status == TaxStatus::Exempt,
                start.as_deref(),
            ),
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::test_support::{input, set_up_db};

    #[test]
    fn industry_templates_add_accounts_before_misc_and_allocation_rules() {
        for template in IndustryTemplate::ALL {
            let db = Database::open_in_memory().unwrap();
            complete(
                &db,
                &SetupInput {
                    template,
                    ..input()
                },
            )
            .unwrap();
            let conn = db.conn();
            assert_eq!(industry_template(&conn).unwrap(), template);
            let accounts = crate::accounts::list(&conn).unwrap();
            let position = |code: &str| accounts.iter().position(|a| a.code == code).unwrap();
            // 追加科目は貸倒金のあと、雑費の前に並ぶ
            let extras = &accounts[position("617") + 1..position("699")];
            assert_eq!(extras.len(), template.accounts().len());
            for (actual, expected) in extras.iter().zip(template.accounts()) {
                assert_eq!(actual.code, expected.code);
                assert_eq!(actual.name_ja, expected.name_ja);
                assert!(actual.statement_line.is_none() && !actual.is_system);
            }
            let rules = crate::allocation_rules::list(&conn).unwrap();
            assert_eq!(rules.len(), template.allocation_rules().len());
            for (actual, expected) in rules.iter().zip(template.allocation_rules()) {
                assert_eq!(actual.code, expected.code);
                assert_eq!(actual.business_percent, expected.business_percent);
                // 家賃・光熱費・通信費・車両費などには、名前の合うルールを既定で付ける
                for code in expected.accounts {
                    assert_eq!(
                        accounts[position(code)].default_allocation_rule_id,
                        Some(actual.id),
                        "{template:?} {code}"
                    );
                }
            }
            // ルールに挙げていない科目には付けない
            let linked = accounts
                .iter()
                .filter(|a| a.default_allocation_rule_id.is_some())
                .count();
            let expected: usize = template
                .allocation_rules()
                .iter()
                .map(|r| r.accounts.len())
                .sum();
            assert_eq!(linked, expected, "{template:?}");
        }
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
    fn filing_type_can_be_changed_until_the_year_is_closed() {
        let db = Database::open_in_memory().unwrap();
        complete(&db, &input()).unwrap();
        let years = set_filing_type(&db, 2026, FilingType::White).unwrap();
        assert_eq!(years[0].filing_type, FilingType::White);
        db.conn()
            .execute(
                "UPDATE fiscal_years SET status = 'closed' WHERE year = 2026",
                [],
            )
            .unwrap();
        let err = set_filing_type(&db, 2026, FilingType::Blue65).unwrap_err();
        assert_eq!(err.code, ErrorCode::YearClosed);
    }

    #[test]
    fn setup_accounts_follow_their_standard_account_and_errors_name_the_row() {
        let db = Database::open_in_memory().unwrap();
        let mut setup = input();
        setup.accounts = vec![
            SetupAccount {
                name: "現金".into(),
                kind: SetupAccountKind::Cash,
                balance: Some(1_000),
            },
            SetupAccount {
                name: "ゆうちょ".into(),
                kind: SetupAccountKind::Bank,
                balance: Some(2_000),
            },
            SetupAccount {
                name: "カード".into(),
                kind: SetupAccountKind::Card,
                balance: Some(500),
            },
        ];
        let mut bad = setup.clone();
        bad.accounts[1].name = " ".into();
        let err = complete(&db, &bad).unwrap_err();
        assert_eq!((err.field, err.line), (Some("accountName"), Some(1)));

        setup.accounts[0].name = "Cash".into();
        complete(&db, &setup).unwrap();
        let conn = db.conn();
        // 英語の画面で既定の名前のまま進めても、標準の和名は変えない
        let cash: String = conn
            .query_row("SELECT name_ja FROM accounts WHERE code = '101'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(cash, "現金");
        let codes: Vec<String> = conn
            .prepare(
                "SELECT code FROM accounts WHERE category IN ('asset', 'liability')
                 ORDER BY CASE category WHEN 'asset' THEN 1 ELSE 2 END, sort, code",
            )
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let at = |code: &str| codes.iter().position(|c| c == code).unwrap();
        assert_eq!(at("W001"), at("104") + 1, "{codes:?}");
        assert_eq!(at("W002"), at("204") + 1, "{codes:?}");
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

#[cfg(test)]
mod extended_tests {
    use super::*;
    use crate::test_support::input;
    #[test]
    fn accounts_opening_capital_and_features_are_saved_together() {
        let db = Database::open_in_memory().unwrap();
        let mut i = input();
        i.accounts = vec![
            SetupAccount {
                name: "Cash".into(),
                kind: SetupAccountKind::Cash,
                balance: Some(20_000),
            },
            SetupAccount {
                name: "Bank".into(),
                kind: SetupAccountKind::Bank,
                balance: Some(100_000),
            },
            SetupAccount {
                name: "Card".into(),
                kind: SetupAccountKind::Card,
                balance: Some(5_000),
            },
            SetupAccount {
                name: "E-money".into(),
                kind: SetupAccountKind::EMoney,
                balance: Some(3_000),
            },
        ];
        i.opening_balances = vec![SetupOpening {
            account_code: "203".into(),
            amount: 30_000,
        }];
        i.features.recurring = false;
        complete(&db, &i).unwrap();
        let conn = db.conn();
        let opening = super::super::closing::opening(&conn, 2026).unwrap();
        assert!(opening.totals.balanced);
        let capital:i64=conn.query_row("SELECT b.amount FROM opening_balances b JOIN accounts a ON a.id=b.account_id WHERE a.code='302'",[],|r|r.get(0)).unwrap();
        assert_eq!(capital, 88_000);
        assert!(!features(&conn).unwrap().recurring);
        let accounts = super::super::accounts::list(&conn).unwrap();
        assert!(accounts.iter().any(|a| a.name_ja == "Card"
            && a.is_payment_account
            && a.category == master::AccountCategory::Liability));
    }
    #[test]
    fn blank_opening_balance_keeps_the_account_and_defers_confirmation() {
        let db = Database::open_in_memory().unwrap();
        let mut s = input();
        s.accounts = vec![SetupAccount {
            kind: SetupAccountKind::Bank,
            name: "Bank".into(),
            balance: None,
        }];
        complete(&db, &s).unwrap();
        let c = db.conn();
        assert!(c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM accounts WHERE code='W001')",
                [],
                |r| r.get::<_, bool>(0)
            )
            .unwrap());
        assert_eq!(
            c.query_row("SELECT count(*) FROM opening_balances", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert!(c
            .query_row(
                "SELECT opening_confirmed_at IS NULL FROM fiscal_years",
                [],
                |r| r.get::<_, bool>(0)
            )
            .unwrap());
    }

    #[test]
    fn invalid_opening_rolls_back_the_entire_setup() {
        let db = Database::open_in_memory().unwrap();
        let mut i = input();
        i.accounts = vec![
            SetupAccount {
                name: "Cash".into(),
                kind: SetupAccountKind::Cash,
                balance: Some(500),
            },
            SetupAccount {
                name: "Bank".into(),
                kind: SetupAccountKind::Bank,
                balance: Some(chobiyori_core::journal::AMOUNT_MAX + 1),
            },
        ];
        assert!(complete(&db, &i).is_err());
        assert!(!status(&db.conn()).unwrap().completed);
        assert!(super::super::accounts::list(&db.conn()).unwrap().is_empty());
        i.accounts.clear();
        i.opening_balances = vec![
            SetupOpening {
                account_code: "106".into(),
                amount: 100,
            },
            SetupOpening {
                account_code: "106".into(),
                amount: 200,
            },
        ];
        assert!(complete(&db, &i).is_err());
        assert!(!status(&db.conn()).unwrap().completed);
    }
    #[test]
    fn existing_books_have_all_features_and_can_change_them() {
        let db = Database::open_in_memory().unwrap();
        assert_eq!(features(&db.conn()).unwrap(), FeatureSettings::default());
        let features = FeatureSettings {
            inventory: false,
            receivables: false,
            recurring: false,
            allocation: false,
        };
        save_features(&db.conn(), &features).unwrap();
        assert_eq!(super::features(&db.conn()).unwrap(), features);
    }
}

#[cfg(test)]
mod help_context_tests {
    use super::*;
    #[test]
    fn industry_help_uses_the_saved_template_and_general_for_older_books() {
        let db = Database::open_in_memory().unwrap();
        assert_eq!(
            industry_template(&db.conn()).unwrap(),
            IndustryTemplate::General
        );
        let input = SetupInput {
            template: IndustryTemplate::School,
            ..crate::test_support::input()
        };
        complete(&db, &input).unwrap();
        assert_eq!(
            industry_template(&db.conn()).unwrap(),
            IndustryTemplate::School
        );
        db.conn()
            .execute("DELETE FROM settings WHERE key='industry_template'", [])
            .unwrap();
        assert_eq!(
            industry_template(&db.conn()).unwrap(),
            IndustryTemplate::General
        );
        db.conn()
            .execute(
                "INSERT INTO settings (key,value) VALUES ('industry_template','invalid')",
                [],
            )
            .unwrap();
        assert_eq!(
            industry_template(&db.conn()).unwrap_err().code,
            ErrorCode::InvalidFormat
        );
    }
}

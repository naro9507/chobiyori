//! 他のテストから使う、初期設定済みの DB と入力の例。
//!
//! storage 自身のテストと、`test-support` feature を付けた他の crate のテストから使う。

use crate::fixed_assets::FixedAssetInput;
use crate::formats::{self, FormatInput, ImportFormat};
use crate::setup::{complete, BusinessProfile, FeatureSettings, SetupInput};
use crate::transactions::{create, create_simple};
use crate::Database;
use chobiyori_core::depreciation::Method;
use chobiyori_core::industry::IndustryTemplate;
use chobiyori_core::journal::{
    EntryMode, LineInput, Side, SimpleInput, SimpleKind, TransactionInput,
};
use chobiyori_core::master::{FilingType, TaxStatus};
use chobiyori_core::statement::{
    AmountSign, ColumnRole, Delimiter, FormatDefinition, SourceKind, TextEncoding,
};
use rusqlite::Connection;

pub fn input() -> SetupInput {
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
        accounts: vec![],
        opening_balances: vec![],
        features: FeatureSettings::default(),
    }
}

/// 初期設定を済ませた DB。他のテストからも使う。
pub fn set_up_db() -> Database {
    let db = Database::open_in_memory().unwrap();
    complete(&db, &input()).unwrap();
    db
}

/// コードから科目の id を引く。
pub fn account(conn: &Connection, code: &str) -> i64 {
    conn.query_row("SELECT id FROM accounts WHERE code = ?1", [code], |r| {
        r.get(0)
    })
    .unwrap()
}

pub fn entry(date: &str, debit: i64, credit: i64, amount: i64) -> TransactionInput {
    TransactionInput {
        date: date.into(),
        entry_mode: EntryMode::Grid,
        memo: String::new(),
        lines: vec![
            LineInput {
                sub_account_id: None,
                tax_category: None,
                is_qualified_invoice: false,
                side: Side::Debit,
                account_id: debit,
                amount,
                partner_id: None,
                memo: String::new(),
            },
            LineInput {
                sub_account_id: None,
                tax_category: None,
                is_qualified_invoice: false,
                side: Side::Credit,
                account_id: credit,
                amount,
                partner_id: None,
                memo: String::new(),
            },
        ],
    }
}

/// 1 か月分（3 月）の帳簿をつける。2 月にも 1 件ある。
pub fn books() -> crate::Database {
    let db = set_up_db();
    let conn = db.conn();
    let id = |code| account(&conn, code);
    let (cash, bank, sales, supplies, utilities, wages, withheld, communication) = (
        id("101"),
        id("104"),
        id("401"),
        id("610"),
        id("603"),
        id("613"),
        id("206"),
        id("605"),
    );
    drop(conn);
    let simple = |kind, date: &str, amount, account_id, payment| SimpleInput {
        allocation_percent: None,
        kind,
        date: date.into(),
        amount,
        account_id,
        payment_account_id: payment,
        partner_id: None,
        memo: String::new(),
    };
    // 2 月: 元手として私用のお金を入れる
    create_simple(
        &db,
        2026,
        &simple(
            SimpleKind::OwnerContribution,
            "2026-02-01",
            100_000,
            None,
            cash,
        ),
    )
    .unwrap();
    // 3 月
    create_simple(
        &db,
        2026,
        &simple(SimpleKind::Income, "2026-03-05", 300_000, Some(sales), bank),
    )
    .unwrap();
    create_simple(
        &db,
        2026,
        &simple(
            SimpleKind::Expense,
            "2026-03-06",
            1_200,
            Some(supplies),
            cash,
        ),
    )
    .unwrap();
    create_simple(
        &db,
        2026,
        &simple(SimpleKind::Transfer, "2026-03-10", 50_000, Some(cash), bank),
    )
    .unwrap();
    create(&db, 2026, &entry("2026-03-20", utilities, bank, 8_800)).unwrap();
    create(&db, 2026, &entry("2026-03-21", communication, cash, 3_300)).unwrap();
    create_simple(
        &db,
        2026,
        &simple(SimpleKind::OwnerDraw, "2026-03-25", 20_000, None, bank),
    )
    .unwrap();
    let line = |side, account_id, amount| LineInput {
        sub_account_id: None,
        tax_category: None,
        is_qualified_invoice: false,
        side,
        account_id,
        amount,
        partner_id: None,
        memo: String::new(),
    };
    create(
        &db,
        2026,
        &TransactionInput {
            date: "2026-03-31".into(),
            entry_mode: EntryMode::Compound,
            memo: "給料".into(),
            lines: vec![
                line(Side::Debit, wages, 100_000),
                line(Side::Credit, bank, 95_000),
                line(Side::Credit, withheld, 5_000),
            ],
        },
    )
    .unwrap();
    db
}

pub fn pc(account_id: i64) -> FixedAssetInput {
    FixedAssetInput {
        name: "パソコン".into(),
        account_id,
        acquired_on: "2026-04-10".into(),
        cost: 240_000,
        useful_life: 4,
        method: Method::StraightLine,
        business_percent: 60,
        book_value_year: None,
        book_value: None,
        disposed_on: None,
        memo: String::new(),
    }
}

pub fn definition() -> FormatDefinition {
    FormatDefinition {
        encoding: TextEncoding::Utf8,
        delimiter: Delimiter::Comma,
        header_row: 1,
        skip_rows: 0,
        columns: vec![ColumnRole::Date, ColumnRole::Merchant, ColumnRole::Amount],
        sign: AmountSign::SpendPositive,
        skip_unreadable_dates: true,
        header: vec!["日付".into(), "内容".into(), "金額".into()],
    }
}

/// 普通預金を取込先にした銀行の形式。
pub fn bank_format(conn: &Connection) -> ImportFormat {
    formats::create(
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

/// テスト用の小さな JPEG（中身の先頭だけそれらしくしたもの）。
pub fn jpeg(seed: u8) -> Vec<u8> {
    let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xE0];
    bytes.extend(std::iter::repeat_n(seed, 64));
    bytes
}

/// レシートの読み取り結果の例（JSON）。
pub const READING: &str = r#"{
    "date": "2026-03-05", "total": "3,240", "merchant": "テスト商店",
    "invoiceNo": "T1234567890123",
    "taxParts": [{"rate": 10, "amount": "2160", "tax": "196"}, {"rate": 8, "amount": "1080", "tax": "80"}],
    "payment": "card"
}"#;

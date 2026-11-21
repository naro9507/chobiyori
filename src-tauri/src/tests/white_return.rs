//! 白色申告の決算書が、集計・申告の案内・出力までつながることを確かめる。
//!
//! 複数の層（db・export）をまたぐので、`db` の中ではなくここに置く。

use crate::export::{self, labels::Locale, ExportFormat, ExportRequest, ExportTarget};
use chobiyori_core::closing;
use chobiyori_core::error::ErrorCode;
use chobiyori_core::journal::{SimpleInput, SimpleKind};
use chobiyori_core::master::FilingType;
use chobiyori_storage::closing::{account_by_line, save_white_deduction, statement};
use chobiyori_storage::{setup, transactions, Database};

#[test]
fn white_deduction_flows_to_statement_guide_and_export() {
    let db = Database::open_in_memory().unwrap();
    let mut initial = chobiyori_storage::test_support::input();
    initial.filing_type = FilingType::White;
    setup::complete(&db, &initial).unwrap();
    let (cash, sales) = {
        let conn = db.conn();
        (
            account_by_line(&conn, "bs.cash").unwrap(),
            account_by_line(&conn, "pl.sales").unwrap(),
        )
    };
    transactions::create_simple(
        &db,
        2026,
        &SimpleInput {
            kind: SimpleKind::Income,
            date: "2026-01-10".into(),
            amount: 1_000_000,
            account_id: Some(sales),
            payment_account_id: cash,
            partner_id: None,
            memo: "Sale".into(),
            allocation_percent: None,
        },
    )
    .unwrap();
    let result = save_white_deduction(&db, 2026, 500_000).unwrap();
    assert_eq!(result.statement.income, 500_000);
    assert!(result
        .statement
        .pl
        .iter()
        .any(|l| l.key == "family_deduction" && l.amount == 500_000));
    let guide = chobiyori_storage::filing::income_guide(&db.conn(), 2026).unwrap();
    assert_eq!(guide.income, 500_000);
    assert_eq!(guide.business_revenue, 1_000_000);
    assert!(guide
        .sections
        .iter()
        .find(|s| s.key == "return")
        .unwrap()
        .items
        .iter()
        .any(|i| i.key == "return_income" && i.value == 500_000));
    let file = export::build(
        &db.conn(),
        &ExportRequest {
            target: ExportTarget::Statement,
            format: ExportFormat::Csv,
            encoding: export::csv::Encoding::Utf8,
            locale: Locale::Ja,
            fiscal_year: 2026,
            from_month: 1,
            to_month: 12,
        },
    )
    .unwrap();
    assert!(file.name.contains("収支内訳書"));
    let csv = String::from_utf8(file.bytes).unwrap();
    assert!(csv.contains("事業専従者控除額"));
    assert!(!csv.contains("青色申告特別控除"));
    assert!(!csv.contains("貸借対照表"));
    let sales_book = chobiyori_storage::books::sales_book(&db.conn(), 2026, 1, 12).unwrap();
    assert_eq!(sales_book.len(), 1);
    assert_eq!(sales_book[0].total_credit, 1_000_000);
    assert!(save_white_deduction(&db, 2026, -1).is_err());
    assert!(save_white_deduction(&db, 2026, 1_000_001).is_err());
    // No.2210: 家事部分を経費に含めない。割合30%は検証用の入力例。
    let utilities = account_by_line(&db.conn(), "pl.utilities").unwrap();
    let payment = transactions::create_simple(
        &db,
        2026,
        &SimpleInput {
            kind: SimpleKind::Expense,
            date: "2026-02-01".into(),
            amount: 120_000,
            account_id: Some(utilities),
            payment_account_id: cash,
            partner_id: None,
            memo: "Shared utility expense".into(),
            allocation_percent: Some(30),
        },
    )
    .unwrap();
    assert!(payment
        .lines
        .iter()
        .any(|l| l.account_id == utilities && l.amount == 36_000));
    let drawings = account_by_line(&db.conn(), "bs.owner_drawings").unwrap();
    assert!(payment
        .lines
        .iter()
        .any(|l| l.account_id == drawings && l.amount == 84_000));
    // 要件を満たす配偶者1人の例: min(860,000, 964,000 / 2)。
    save_white_deduction(&db, 2026, 482_000).unwrap();
    let s = statement(&db.conn(), 2026).unwrap();
    assert_eq!(s.statement.income_before_deduction, 964_000);
    assert_eq!(s.statement.income, 482_000);
    // 所得が後から変わった場合も、保存値を黙って変更せず再計算を促す。
    transactions::create_simple(
        &db,
        2026,
        &SimpleInput {
            kind: SimpleKind::Expense,
            date: "2026-02-02".into(),
            amount: 964_001,
            account_id: Some(utilities),
            payment_account_id: cash,
            partner_id: None,
            memo: String::new(),
            allocation_percent: None,
        },
    )
    .unwrap();
    assert!(save_white_deduction(&db, 2026, 1).is_err());
    assert!(statement(&db.conn(), 2026)
        .unwrap()
        .statement
        .issues
        .iter()
        .any(|i| i.code == closing::StatementIssueCode::WhiteDeductionExceedsIncome));
    save_white_deduction(&db, 2026, 0).unwrap();
    assert!(!statement(&db.conn(), 2026)
        .unwrap()
        .statement
        .issues
        .iter()
        .any(|i| i.code == closing::StatementIssueCode::WhiteDeductionExceedsIncome));
    chobiyori_storage::locks::set_year_closed(&db, 2026, true).unwrap();
    assert_eq!(
        save_white_deduction(&db, 2026, 50_000).unwrap_err().code,
        ErrorCode::YearClosed
    );
}

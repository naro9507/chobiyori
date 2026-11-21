-- フェーズ 2: 取引入力と集計。
-- 「口座」（お金の出入りに使う科目: 現金・預金・カードの未払金）の印を勘定科目に足す。
-- かんたん入力の「どこから払ったか」と、口座残高の表示に使う。
ALTER TABLE accounts ADD COLUMN is_payment_account INTEGER NOT NULL DEFAULT 0 CHECK (is_payment_account IN (0, 1));

-- すでに入っている標準の科目のうち、現金・当座預金・定期預金・普通預金・未払金を口座にする
UPDATE accounts SET is_payment_account = 1
WHERE is_system = 1 AND code IN ('101', '102', '103', '104', '204');

-- 月ごとの一覧と試算表で、取引の明細をまとめて読むため
CREATE INDEX journal_lines_by_transaction ON journal_lines (transaction_id, line_no);

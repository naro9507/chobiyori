-- フェーズ 10: 確定申告・消費税の申告・インボイスの登録の補助（F12）。

-- インボイスの登録日。登録日から課税として扱う（年の途中で登録した年は、登録日の前が免税）
ALTER TABLE business_profile ADD COLUMN invoice_registered_on TEXT;
-- 簡易課税の事業の区分（第 1 種〜第 6 種）。売上の科目ごとに変えられる
ALTER TABLE business_profile ADD COLUMN simplified_tax_category INTEGER CHECK (simplified_tax_category BETWEEN 1 AND 6);
ALTER TABLE accounts ADD COLUMN simplified_tax_category INTEGER CHECK (simplified_tax_category BETWEEN 1 AND 6);

-- 登録番号を利用者が国税庁の公表サイトで確かめた記録（アプリからは問い合わせない）
CREATE TABLE invoice_checks (
    id              INTEGER PRIMARY KEY,
    registration_no TEXT NOT NULL,
    result          TEXT NOT NULL CHECK (result IN ('confirmed', 'revoked')),
    checked_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

CREATE INDEX invoice_checks_by_number ON invoice_checks (registration_no, checked_at);

-- 申告のチェックリストの印（年度ごと）
CREATE TABLE filing_checklists (
    fiscal_year INTEGER NOT NULL REFERENCES fiscal_years (year) ON DELETE CASCADE,
    item        TEXT NOT NULL,
    done_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (fiscal_year, item)
) STRICT;

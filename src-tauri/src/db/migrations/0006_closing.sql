-- フェーズ 7: 期首残高、固定資産と減価償却、棚卸、決算チェックリスト。

-- 期首残高を確定した日時。空なら未確定（入力の途中）
ALTER TABLE fiscal_years ADD COLUMN opening_confirmed_at TEXT;

-- 期首残高。資産・負債・資本の科目ごと。金額は区分の向きで正（資産は借方、負債・資本は貸方）。
-- 補助科目ごとの期首残高は後で足す
CREATE TABLE opening_balances (
    fiscal_year INTEGER NOT NULL REFERENCES fiscal_years (year) ON DELETE CASCADE,
    account_id  INTEGER NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    amount      INTEGER NOT NULL,
    PRIMARY KEY (fiscal_year, account_id)
) STRICT;

-- 固定資産。帳簿価額は book_value_year の年の初めの値（取得した年以後に登録したなら取得価額）。
-- 償却費は毎年ここから計算し、保存しない
CREATE TABLE fixed_assets (
    id               INTEGER PRIMARY KEY,
    name             TEXT NOT NULL,
    account_id       INTEGER NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    acquired_on      TEXT NOT NULL,
    cost             INTEGER NOT NULL CHECK (cost > 0),
    useful_life      INTEGER NOT NULL CHECK (useful_life BETWEEN 0 AND 100),
    method           TEXT NOT NULL CHECK (method IN ('straight_line', 'declining_balance', 'lump_sum', 'small_asset')),
    business_percent INTEGER NOT NULL DEFAULT 100 CHECK (business_percent BETWEEN 1 AND 100),
    book_value_year  INTEGER NOT NULL,
    book_value       INTEGER NOT NULL CHECK (book_value >= 0),
    disposed_on      TEXT,
    memo             TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

-- 年ごとの減価償却を記録した取引。取引を消すと行も消え、その年の償却はまた候補に出る
CREATE TABLE depreciation_postings (
    asset_id       INTEGER NOT NULL REFERENCES fixed_assets (id) ON DELETE RESTRICT,
    fiscal_year    INTEGER NOT NULL,
    transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions (id) ON DELETE CASCADE,
    PRIMARY KEY (asset_id, fiscal_year)
) STRICT;

-- 期末の商品の棚卸高と、それを記録した取引（期末の振替・期首の振替）
CREATE TABLE inventories (
    fiscal_year            INTEGER PRIMARY KEY REFERENCES fiscal_years (year) ON DELETE CASCADE,
    closing_amount         INTEGER NOT NULL CHECK (closing_amount >= 0),
    closing_transaction_id INTEGER REFERENCES transactions (id) ON DELETE SET NULL,
    opening_transaction_id INTEGER REFERENCES transactions (id) ON DELETE SET NULL
) STRICT;

-- 決算整理のチェックリストで、済んだ印を付けた項目
CREATE TABLE closing_checks (
    fiscal_year INTEGER NOT NULL REFERENCES fiscal_years (year) ON DELETE CASCADE,
    item        TEXT NOT NULL,
    done_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (fiscal_year, item)
) STRICT;

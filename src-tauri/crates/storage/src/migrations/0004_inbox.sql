-- フェーズ 5: 取込受信箱（カード・銀行・電子マネーの明細から作る仕訳の候補）、取込形式、自動仕訳ルール。

-- 取込形式。ファイルの読み方（definition: JSON）と、取込先の口座。
-- 同梱のプリセットは DB に入れず、アプリの中のデータとして持つ（利用者が複製して使う）。
CREATE TABLE import_formats (
    id                     INTEGER PRIMARY KEY,
    name                   TEXT NOT NULL,
    source_kind            TEXT NOT NULL CHECK (source_kind IN ('card', 'bank', 'eMoney')),
    payment_account_id     INTEGER NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    payment_sub_account_id INTEGER REFERENCES sub_accounts (id) ON DELETE RESTRICT,
    definition             TEXT NOT NULL,
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

-- 受信箱の候補。1 行 = 明細の 1 行（フェーズ 6 ではレシート 1 枚）。
-- 確定すると transaction_id に取引が入る。取引を消すと空に戻り、また確認待ちになる。
-- row_key は重複を防ぐための鍵（口座・利用日・金額・店名・同じ内容の何回目か）。
CREATE TABLE inbox_items (
    id                     INTEGER PRIMARY KEY,
    source                 TEXT NOT NULL CHECK (source IN ('statement', 'receipt')),
    format_id              INTEGER REFERENCES import_formats (id) ON DELETE SET NULL,
    file_name              TEXT NOT NULL DEFAULT '',
    file_row               INTEGER NOT NULL DEFAULT 0,
    row_key                TEXT NOT NULL UNIQUE,
    payment_account_id     INTEGER NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    payment_sub_account_id INTEGER REFERENCES sub_accounts (id) ON DELETE RESTRICT,
    date                   TEXT NOT NULL,
    -- 出ていったお金。プラスは利用、マイナスは返金・入金
    spend                  INTEGER NOT NULL CHECK (spend <> 0),
    merchant               TEXT NOT NULL DEFAULT '',
    memo                   TEXT NOT NULL DEFAULT '',
    ignored                INTEGER NOT NULL DEFAULT 0 CHECK (ignored IN (0, 1)),
    transaction_id         INTEGER REFERENCES transactions (id) ON DELETE SET NULL,
    imported_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

CREATE INDEX inbox_items_by_date ON inbox_items (date);
CREATE INDEX inbox_items_by_transaction ON inbox_items (transaction_id);

-- 自動仕訳ルール。条件（店名・金額の範囲・取込形式）→ 結果（科目など、または対象外）。
CREATE TABLE journal_rules (
    id                 INTEGER PRIMARY KEY,
    pattern            TEXT NOT NULL,
    match_kind         TEXT NOT NULL DEFAULT 'contains' CHECK (match_kind IN ('contains', 'equals')),
    min_amount         INTEGER,
    max_amount         INTEGER,
    format_id          INTEGER REFERENCES import_formats (id) ON DELETE CASCADE,
    account_id         INTEGER REFERENCES accounts (id) ON DELETE RESTRICT,
    sub_account_id     INTEGER REFERENCES sub_accounts (id) ON DELETE RESTRICT,
    partner_id         INTEGER REFERENCES partners (id) ON DELETE RESTRICT,
    memo               TEXT NOT NULL DEFAULT '',
    tax_category       TEXT,
    allocation_percent INTEGER CHECK (allocation_percent BETWEEN 0 AND 100),
    ignore             INTEGER NOT NULL DEFAULT 0 CHECK (ignore IN (0, 1)),
    is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    sort               INTEGER NOT NULL DEFAULT 0,
    CHECK (ignore = 1 OR account_id IS NOT NULL)
) STRICT;

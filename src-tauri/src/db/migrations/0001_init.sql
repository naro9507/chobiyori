-- 最初のスキーマ。事業者情報・年度・マスタ・仕訳の土台を作る。
-- 金額はすべて円単位の整数。真偽値は 0 / 1。日時は ISO 8601 の文字列（UTC）。

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT;

-- 事業者情報。1 行だけ持つ
CREATE TABLE business_profile (
    id                      INTEGER PRIMARY KEY CHECK (id = 1),
    trade_name              TEXT NOT NULL DEFAULT '',
    owner_name              TEXT NOT NULL,
    address                 TEXT NOT NULL DEFAULT '',
    industry                TEXT NOT NULL DEFAULT '',
    invoice_registration_no TEXT,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

CREATE TABLE fiscal_years (
    year        INTEGER PRIMARY KEY CHECK (year BETWEEN 2000 AND 2100),
    filing_type TEXT NOT NULL CHECK (filing_type IN ('blue65', 'blue55', 'blue10', 'white')),
    tax_status  TEXT NOT NULL CHECK (tax_status IN ('exempt', 'standard', 'simplified', 'special20')),
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    closed_at   TEXT
) STRICT;

CREATE TABLE allocation_rules (
    id               INTEGER PRIMARY KEY,
    code             TEXT NOT NULL UNIQUE,
    name_ja          TEXT NOT NULL,
    name_en          TEXT NOT NULL DEFAULT '',
    business_percent INTEGER NOT NULL CHECK (business_percent BETWEEN 0 AND 100),
    rounding         TEXT NOT NULL DEFAULT 'floor' CHECK (rounding IN ('floor', 'round', 'ceil')),
    is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    sort             INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE accounts (
    id                         INTEGER PRIMARY KEY,
    code                       TEXT NOT NULL UNIQUE,
    name_ja                    TEXT NOT NULL,
    name_en                    TEXT NOT NULL DEFAULT '',
    kana                       TEXT NOT NULL DEFAULT '',
    category                   TEXT NOT NULL CHECK (category IN ('asset', 'liability', 'equity', 'revenue', 'cogs', 'expense')),
    statement_line             TEXT,
    default_tax_category       TEXT,
    default_allocation_rule_id INTEGER REFERENCES allocation_rules (id) ON DELETE RESTRICT,
    is_system                  INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
    is_active                  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    sort                       INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE sub_accounts (
    id         INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    code       TEXT NOT NULL,
    name_ja    TEXT NOT NULL,
    name_en    TEXT NOT NULL DEFAULT '',
    kana       TEXT NOT NULL DEFAULT '',
    is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    sort       INTEGER NOT NULL DEFAULT 0,
    UNIQUE (account_id, code)
) STRICT;

CREATE TABLE partners (
    id                      INTEGER PRIMARY KEY,
    code                    TEXT NOT NULL UNIQUE,
    name_ja                 TEXT NOT NULL,
    name_en                 TEXT NOT NULL DEFAULT '',
    kana                    TEXT NOT NULL DEFAULT '',
    is_customer             INTEGER NOT NULL DEFAULT 0 CHECK (is_customer IN (0, 1)),
    is_vendor               INTEGER NOT NULL DEFAULT 0 CHECK (is_vendor IN (0, 1)),
    invoice_registration_no TEXT,
    memo                    TEXT NOT NULL DEFAULT '',
    is_active               INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    sort                    INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE purposes (
    id                         INTEGER PRIMARY KEY,
    code                       TEXT NOT NULL UNIQUE,
    name_ja                    TEXT NOT NULL,
    name_en                    TEXT NOT NULL DEFAULT '',
    kana                       TEXT NOT NULL DEFAULT '',
    default_debit_account_id   INTEGER REFERENCES accounts (id) ON DELETE RESTRICT,
    default_credit_account_id  INTEGER REFERENCES accounts (id) ON DELETE RESTRICT,
    default_tax_category       TEXT,
    allocation_rule_id         INTEGER REFERENCES allocation_rules (id) ON DELETE RESTRICT,
    default_partner_id         INTEGER REFERENCES partners (id) ON DELETE RESTRICT,
    is_active                  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    sort                       INTEGER NOT NULL DEFAULT 0
) STRICT;

-- 取引（ヘッダ）と明細行。借方合計 = 貸方合計は、保存する処理の側で必ず確かめる
CREATE TABLE transactions (
    id          INTEGER PRIMARY KEY,
    fiscal_year INTEGER NOT NULL REFERENCES fiscal_years (year) ON DELETE RESTRICT,
    date        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal', 'allocation', 'template', 'depreciation', 'opening', 'closing')),
    entry_mode  TEXT NOT NULL DEFAULT 'grid' CHECK (entry_mode IN ('simple', 'grid', 'compound', 'import', 'receipt', 'card')),
    memo        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

CREATE INDEX transactions_by_date ON transactions (fiscal_year, date);

CREATE TABLE journal_lines (
    id                   INTEGER PRIMARY KEY,
    transaction_id       INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    line_no              INTEGER NOT NULL,
    side                 TEXT NOT NULL CHECK (side IN ('debit', 'credit')),
    account_id           INTEGER NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    sub_account_id       INTEGER REFERENCES sub_accounts (id) ON DELETE RESTRICT,
    amount               INTEGER NOT NULL CHECK (amount > 0),
    tax_category         TEXT,
    is_qualified_invoice INTEGER NOT NULL DEFAULT 0 CHECK (is_qualified_invoice IN (0, 1)),
    purpose_id           INTEGER REFERENCES purposes (id) ON DELETE RESTRICT,
    partner_id           INTEGER REFERENCES partners (id) ON DELETE RESTRICT,
    target_month         TEXT,
    memo                 TEXT NOT NULL DEFAULT '',
    UNIQUE (transaction_id, line_no)
) STRICT;

CREATE INDEX journal_lines_by_account ON journal_lines (account_id);
CREATE INDEX journal_lines_by_partner ON journal_lines (partner_id);

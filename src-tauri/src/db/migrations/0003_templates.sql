-- フェーズ 4: 定型仕訳（毎月の家賃・光熱費・会費など、よく使う取引のひな形）。
-- 形は「借方 1 科目 / 貸方 1 科目 / 金額」。家事按分の割合を持てる。
-- 毎月の定型仕訳は、まだ記録していない月を候補として出す（確認なしに記録はしない）。
CREATE TABLE templates (
    id                    INTEGER PRIMARY KEY,
    name                  TEXT NOT NULL,
    memo                  TEXT NOT NULL DEFAULT '',
    debit_account_id      INTEGER NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    debit_sub_account_id  INTEGER REFERENCES sub_accounts (id) ON DELETE RESTRICT,
    credit_account_id     INTEGER NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    credit_sub_account_id INTEGER REFERENCES sub_accounts (id) ON DELETE RESTRICT,
    amount                INTEGER NOT NULL CHECK (amount > 0),
    partner_id            INTEGER REFERENCES partners (id) ON DELETE RESTRICT,
    -- 家事按分の事業割合（0〜100）。空なら按分しない
    allocation_percent    INTEGER CHECK (allocation_percent BETWEEN 0 AND 100),
    -- none: 必要なときに使うだけ / monthly: 毎月
    recurrence            TEXT NOT NULL DEFAULT 'monthly' CHECK (recurrence IN ('none', 'monthly')),
    day_of_month          INTEGER NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 31),
    -- 候補を出しはじめる月（YYYY-MM）
    start_month           TEXT NOT NULL,
    is_active             INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    sort                  INTEGER NOT NULL DEFAULT 0
) STRICT;

-- 毎月の定型仕訳を、どの月の分まで記録したか。transaction_id が空なら「その月は見送った」。
-- 記録した取引を消すと、この行も消え、その月はまた候補に出る。
CREATE TABLE template_postings (
    template_id    INTEGER NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
    fiscal_year    INTEGER NOT NULL,
    month          INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    transaction_id INTEGER REFERENCES transactions (id) ON DELETE CASCADE,
    PRIMARY KEY (template_id, fiscal_year, month)
) STRICT;

CREATE INDEX template_postings_by_transaction ON template_postings (transaction_id);

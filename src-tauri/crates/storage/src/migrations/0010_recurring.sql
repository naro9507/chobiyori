-- フェーズ 11: 定期売上（月謝・会費・顧問料など、毎月決まった売上）。
-- 予定はプランから月ごとに決め、入金は仕訳と結び付けて記録する。集計値は保存しない。

CREATE TABLE recurring_plans (
    id                 INTEGER PRIMARY KEY,
    partner_id         INTEGER NOT NULL REFERENCES partners (id) ON DELETE RESTRICT,
    name               TEXT NOT NULL,
    amount             INTEGER NOT NULL CHECK (amount > 0),
    revenue_account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    -- 予定のある最初の月と最後の月（YYYY-MM）。end_month が空なら続く
    start_month        TEXT NOT NULL,
    end_month          TEXT,
    memo               TEXT NOT NULL DEFAULT '',
    sort               INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

-- 休みにした月（その月は予定なし）
CREATE TABLE recurring_plan_skips (
    plan_id INTEGER NOT NULL REFERENCES recurring_plans (id) ON DELETE CASCADE,
    month   TEXT NOT NULL,
    PRIMARY KEY (plan_id, month)
) STRICT;

-- 入金・返金と仕訳の結び付き。取引を消すとこの行も消える。
-- plan_id が空なら「未割当の入金」。amount は入金なら正、返金なら負
CREATE TABLE recurring_payments (
    transaction_id INTEGER PRIMARY KEY REFERENCES transactions (id) ON DELETE CASCADE,
    plan_id        INTEGER REFERENCES recurring_plans (id) ON DELETE RESTRICT,
    partner_id     INTEGER REFERENCES partners (id) ON DELETE RESTRICT,
    target_month   TEXT,
    amount         INTEGER NOT NULL CHECK (amount <> 0)
) STRICT;

CREATE INDEX recurring_payments_by_plan ON recurring_payments (plan_id, target_month);

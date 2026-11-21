-- フェーズ 8: 月締めと変更履歴。

-- 締めた月。行があればその月の取引は追加・変更・削除できない。外すと行を消し、変更履歴に残す
CREATE TABLE month_locks (
    fiscal_year INTEGER NOT NULL REFERENCES fiscal_years (year) ON DELETE CASCADE,
    month       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    locked_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (fiscal_year, month)
) STRICT;

-- 変更履歴。取引の追加・変更・削除と、締め・締めの解除・復元などの操作を残す。
-- before_json / after_json は取引の内容（変更の前と後）。パスワードや API キーは入れない
CREATE TABLE audit_logs (
    id          INTEGER PRIMARY KEY,
    entity      TEXT NOT NULL,
    entity_id   INTEGER,
    action      TEXT NOT NULL,
    fiscal_year INTEGER,
    before_json TEXT,
    after_json  TEXT,
    at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

CREATE INDEX audit_logs_by_entity ON audit_logs (entity, entity_id);
CREATE INDEX audit_logs_by_time ON audit_logs (at);

-- フェーズ 6: レシートの読み取り、証憑の添付、レシートとカード明細の突合。

-- 証憑（レシートや領収書の画像・PDF）。中身は帳簿の DB の中に置き、帳簿と一緒に暗号化する
-- （SQLCipher。鍵の保管はフェーズ 8）。同じファイル（sha256 が同じ）は 2 回入れない。
-- 取引を消しても証憑は残す（transaction_id が空になる）。
CREATE TABLE attachments (
    id             INTEGER PRIMARY KEY,
    transaction_id INTEGER REFERENCES transactions (id) ON DELETE SET NULL,
    file_name      TEXT NOT NULL,
    mime           TEXT NOT NULL,
    size           INTEGER NOT NULL CHECK (size > 0),
    sha256         TEXT NOT NULL UNIQUE,
    data           BLOB NOT NULL,
    added_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

CREATE INDEX attachments_by_transaction ON attachments (transaction_id);

-- 取り込んだレシート。読み取りの状態と結果。日付と合計が分かったら受信箱の候補（inbox_items）を作る。
--   waiting: 読み取り待ち（オフラインのときもここで待つ） / read: 読み取った
--   failed: 読み取れなかった（手で入力できる） / manual: 手で入力した（送らなかったものも含む）
CREATE TABLE receipts (
    id             INTEGER PRIMARY KEY,
    attachment_id  INTEGER NOT NULL UNIQUE REFERENCES attachments (id) ON DELETE RESTRICT,
    status         TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'read', 'failed', 'manual')),
    -- 読み取りのサービスに送ってよいか（宛名のある領収書などは送らずに手で入力できる）
    send_allowed   INTEGER NOT NULL DEFAULT 1 CHECK (send_allowed IN (0, 1)),
    -- 読み取った内容（JSON）と、自己検算で合わなかった項目（JSON の配列）
    reading        TEXT,
    checks         TEXT NOT NULL DEFAULT '[]',
    -- 読み取れなかった理由（コード）
    error          TEXT,
    -- 軽減税率（8%）の対象額（税込）。確定するときに経費の行を税率ごとに分ける
    reduced_amount INTEGER NOT NULL DEFAULT 0 CHECK (reduced_amount >= 0),
    invoice_no     TEXT,
    inbox_item_id  INTEGER UNIQUE REFERENCES inbox_items (id) ON DELETE SET NULL,
    read_at        TEXT
) STRICT;

-- 受信箱の候補を、新しい取引を作らずに既存の取引に紐付けた印（レシートとカード明細の突合など）
ALTER TABLE inbox_items ADD COLUMN linked INTEGER NOT NULL DEFAULT 0 CHECK (linked IN (0, 1));

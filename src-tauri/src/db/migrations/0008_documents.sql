-- フェーズ 9: 請求書・見積書・納品書・領収書（F11）。

-- 取引先に、書類の送り先を足す
ALTER TABLE partners ADD COLUMN billing_name TEXT NOT NULL DEFAULT '';
ALTER TABLE partners ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE partners ADD COLUMN address TEXT NOT NULL DEFAULT '';

-- 書類。番号は発行したときに、種類と年ごとの連番で付ける（下書きは空）。
-- 発行した書類は書き換えない。直すときは取り消して作り直す（取り消した書類も残す）
CREATE TABLE documents (
    id                  INTEGER PRIMARY KEY,
    kind                TEXT NOT NULL CHECK (kind IN ('invoice', 'estimate', 'delivery', 'receipt')),
    number              TEXT,
    number_year         INTEGER,
    number_seq          INTEGER,
    status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'sent', 'paid', 'canceled')),
    partner_id          INTEGER REFERENCES partners (id) ON DELETE RESTRICT,
    recipient_name      TEXT NOT NULL DEFAULT '',
    recipient_address   TEXT NOT NULL DEFAULT '',
    recipient_email     TEXT NOT NULL DEFAULT '',
    issue_date          TEXT NOT NULL,
    due_date            TEXT,
    title               TEXT NOT NULL DEFAULT '',
    notes               TEXT NOT NULL DEFAULT '',
    -- 発行したときの様式（qualified: 適格請求書、simple: 登録番号なし）と、書いた自分の情報
    tax_mode            TEXT CHECK (tax_mode IN ('qualified', 'simple')),
    issuer_json         TEXT,
    source_document_id  INTEGER REFERENCES documents (id) ON DELETE SET NULL,
    -- 売上の仕訳（請求書を記帳したとき）。取引を消すと空に戻る
    transaction_id      INTEGER REFERENCES transactions (id) ON DELETE SET NULL,
    -- 発行した PDF の控え（帳簿と一緒に暗号化される）
    pdf_attachment_id   INTEGER REFERENCES attachments (id) ON DELETE SET NULL,
    issued_at           TEXT,
    canceled_at         TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (kind, number_year, number_seq)
) STRICT;

CREATE INDEX documents_by_status ON documents (kind, status);

-- 明細。数量は 100 倍した整数（1.5 → 150）。税率は 10・8・0（対象外）
CREATE TABLE document_lines (
    document_id  INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    line_no      INTEGER NOT NULL,
    name         TEXT NOT NULL,
    quantity     INTEGER NOT NULL CHECK (quantity > 0),
    unit         TEXT NOT NULL DEFAULT '',
    unit_price   INTEGER NOT NULL,
    tax_rate     INTEGER NOT NULL CHECK (tax_rate IN (0, 8, 10)),
    PRIMARY KEY (document_id, line_no)
) STRICT;

-- 送った記録。method: smtp（アプリから送った）/ mail_app（メールソフトで送ったと利用者が記録した）
CREATE TABLE document_sends (
    id           INTEGER PRIMARY KEY,
    document_id  INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    method       TEXT NOT NULL CHECK (method IN ('smtp', 'mail_app')),
    to_address   TEXT NOT NULL DEFAULT '',
    subject      TEXT NOT NULL DEFAULT '',
    sent_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) STRICT;

-- 入金。一部入金に対応する。取引を消すと行も消え、入金済みでなくなる
CREATE TABLE document_payments (
    id              INTEGER PRIMARY KEY,
    document_id     INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    transaction_id  INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    amount          INTEGER NOT NULL CHECK (amount > 0)
) STRICT;

CREATE INDEX document_payments_by_document ON document_payments (document_id);

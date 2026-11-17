-- フェーズ 11 の続き: 入金と請求書・定期売上の結び付け。

-- 定期売上のプランと対象月から作った請求書。同じプラン・同じ月の請求書を二重に作らないためと、
-- 請求書への入金をプランの月の入金として数えるために使う。書類を消すと行も消える
CREATE TABLE recurring_invoices (
    plan_id     INTEGER NOT NULL REFERENCES recurring_plans (id) ON DELETE CASCADE,
    month       TEXT NOT NULL,
    document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    PRIMARY KEY (plan_id, month, document_id)
) STRICT;

CREATE INDEX recurring_invoices_by_document ON recurring_invoices (document_id);

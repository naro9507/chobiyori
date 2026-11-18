-- 登録で免税から切り替わった年度だけ、登録日から課税する。
ALTER TABLE fiscal_years ADD COLUMN invoice_tax_start TEXT;

-- 過去の版には切り替え前の区分がない。登録前に課税の記帳がある年度は通年課税として扱う。
UPDATE fiscal_years AS fy SET invoice_tax_start = (SELECT invoice_registered_on FROM business_profile WHERE id = 1)
WHERE fy.tax_status <> 'exempt'
  AND EXISTS (SELECT 1 FROM business_profile p
              WHERE substr(p.invoice_registered_on, 1, 4) = printf('%04d', fy.year)
                AND NOT EXISTS (
                    SELECT 1 FROM transactions t JOIN journal_lines l ON l.transaction_id = t.id
                    WHERE t.fiscal_year = fy.year AND t.date < p.invoice_registered_on
                      AND l.tax_category NOT IN ('out_of_scope', 'non_taxable', 'exempt_sales')
                ));

-- 旧版で帳簿に反映していた貸借の合う残高は、次に編集するまで引き継ぐ。
ALTER TABLE fiscal_years ADD COLUMN opening_legacy INTEGER NOT NULL DEFAULT 0 CHECK (opening_legacy IN (0, 1));
UPDATE fiscal_years AS fy SET opening_legacy = 1
WHERE fy.opening_confirmed_at IS NULL AND 0 = (
    SELECT sum(CASE WHEN a.category = 'asset' THEN b.amount ELSE -b.amount END)
    FROM opening_balances b JOIN accounts a ON a.id = b.account_id
    WHERE b.fiscal_year = fy.year
);

-- 同じ証憑を複数の取引に添付できる。レシートと取引の紐付けは受信箱にある。
CREATE TABLE transaction_attachments (
    transaction_id INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    attachment_id INTEGER NOT NULL REFERENCES attachments (id) ON DELETE RESTRICT,
    PRIMARY KEY (transaction_id, attachment_id)
) STRICT;
CREATE INDEX transaction_attachments_by_attachment ON transaction_attachments (attachment_id);
INSERT INTO transaction_attachments (transaction_id, attachment_id)
SELECT a.transaction_id, a.id FROM attachments a
WHERE a.transaction_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM receipts r JOIN inbox_items i ON i.id = r.inbox_item_id
    WHERE r.attachment_id = a.id AND i.transaction_id = a.transaction_id
);
DROP INDEX attachments_by_transaction;
ALTER TABLE attachments DROP COLUMN transaction_id;

-- 定期売上の請求書を作った時点で、入金を分ける割合を固定する。
ALTER TABLE recurring_invoices ADD COLUMN allocation_weight INTEGER NOT NULL DEFAULT 0 CHECK (allocation_weight >= 0);
WITH links AS (
    SELECT plan_id, month, document_id,
           row_number() OVER (PARTITION BY document_id ORDER BY plan_id, month) AS line_no
    FROM recurring_invoices
)
UPDATE recurring_invoices AS r
SET allocation_weight = coalesce((
    SELECT max(0, (l.quantity * l.unit_price / 100)
                  * (100 + CASE WHEN d.tax_mode = 'qualified' THEN l.tax_rate ELSE 0 END) / 100)
    FROM links x JOIN document_lines l ON l.document_id = x.document_id AND l.line_no = x.line_no
    JOIN documents d ON d.id = x.document_id
    WHERE x.plan_id = r.plan_id AND x.month = r.month AND x.document_id = r.document_id
), (SELECT amount FROM recurring_plans WHERE id = r.plan_id), 0);


-- 仕訳の編集・削除の際、紐付いた売上と入金を探す。
CREATE INDEX documents_by_sale ON documents (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX document_payments_by_transaction ON document_payments (transaction_id);

-- 履歴は追記だけ。取引から参照する名称と、元帳の期首残高の修正も記録する。
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN
    SELECT RAISE(ABORT, 'audit history is append-only');
END;

CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN
    SELECT RAISE(ABORT, 'audit history is append-only');
END;

CREATE TRIGGER opening_history_insert AFTER INSERT ON opening_balances
BEGIN
    INSERT INTO audit_logs (entity, entity_id, action, fiscal_year, after_json)
    SELECT 'opening_balance', NEW.account_id, 'create', NEW.fiscal_year,
           json_object('label', code || ' ' || name_ja, 'amount', NEW.amount)
    FROM accounts WHERE id = NEW.account_id;
END;

CREATE TRIGGER opening_history_delete BEFORE DELETE ON opening_balances
BEGIN
    INSERT INTO audit_logs (entity, entity_id, action, fiscal_year, before_json)
    SELECT 'opening_balance', OLD.account_id, 'delete', OLD.fiscal_year,
           json_object('label', code || ' ' || name_ja, 'amount', OLD.amount)
    FROM accounts WHERE id = OLD.account_id;
END;

CREATE TRIGGER opening_history_update AFTER UPDATE OF amount ON opening_balances
WHEN OLD.amount IS NOT NEW.amount
BEGIN
    INSERT INTO audit_logs (entity, entity_id, action, fiscal_year, before_json, after_json)
    SELECT 'opening_balance', NEW.account_id, 'update', NEW.fiscal_year,
           json_object('label', code || ' ' || name_ja, 'amount', OLD.amount),
           json_object('label', code || ' ' || name_ja, 'amount', NEW.amount)
    FROM accounts WHERE id = NEW.account_id;
END;

CREATE TRIGGER opening_history_visibility AFTER UPDATE OF opening_confirmed_at, opening_legacy ON fiscal_years
WHEN (OLD.opening_confirmed_at IS NOT NULL OR OLD.opening_legacy)
     IS NOT (NEW.opening_confirmed_at IS NOT NULL OR NEW.opening_legacy)
BEGIN
    INSERT INTO audit_logs (entity, action, fiscal_year, before_json, after_json)
    VALUES ('opening_balance', 'update', NEW.year,
            json_object('published', OLD.opening_confirmed_at IS NOT NULL OR OLD.opening_legacy),
            json_object('published', NEW.opening_confirmed_at IS NOT NULL OR NEW.opening_legacy));
END;

CREATE TRIGGER account_label_history AFTER UPDATE OF code, name_ja, name_en ON accounts
WHEN OLD.code IS NOT NEW.code OR OLD.name_ja IS NOT NEW.name_ja OR OLD.name_en IS NOT NEW.name_en
BEGIN
    INSERT INTO audit_logs (entity, entity_id, action, fiscal_year, before_json, after_json)
    SELECT 'account', NEW.id, 'update', fiscal_year,
           json_object('code', OLD.code, 'nameJa', OLD.name_ja, 'nameEn', OLD.name_en),
           json_object('code', NEW.code, 'nameJa', NEW.name_ja, 'nameEn', NEW.name_en)
    FROM (SELECT t.fiscal_year FROM journal_lines l JOIN transactions t ON t.id = l.transaction_id WHERE l.account_id = NEW.id
          UNION SELECT fiscal_year FROM opening_balances WHERE account_id = NEW.id);
END;

CREATE TRIGGER sub_account_label_history AFTER UPDATE OF code, name_ja, name_en ON sub_accounts
WHEN OLD.code IS NOT NEW.code OR OLD.name_ja IS NOT NEW.name_ja OR OLD.name_en IS NOT NEW.name_en
BEGIN
    INSERT INTO audit_logs (entity, entity_id, action, fiscal_year, before_json, after_json)
    SELECT DISTINCT 'sub_account', NEW.id, 'update', t.fiscal_year,
           json_object('code', OLD.code, 'nameJa', OLD.name_ja, 'nameEn', OLD.name_en),
           json_object('code', NEW.code, 'nameJa', NEW.name_ja, 'nameEn', NEW.name_en)
    FROM journal_lines l JOIN transactions t ON t.id = l.transaction_id WHERE l.sub_account_id = NEW.id;
END;

CREATE TRIGGER partner_label_history AFTER UPDATE OF code, name_ja, name_en ON partners
WHEN OLD.code IS NOT NEW.code OR OLD.name_ja IS NOT NEW.name_ja OR OLD.name_en IS NOT NEW.name_en
BEGIN
    INSERT INTO audit_logs (entity, entity_id, action, fiscal_year, before_json, after_json)
    SELECT DISTINCT 'partner', NEW.id, 'update', t.fiscal_year,
           json_object('code', OLD.code, 'nameJa', OLD.name_ja, 'nameEn', OLD.name_en),
           json_object('code', NEW.code, 'nameJa', NEW.name_ja, 'nameEn', NEW.name_en)
    FROM journal_lines l JOIN transactions t ON t.id = l.transaction_id WHERE l.partner_id = NEW.id;
END;

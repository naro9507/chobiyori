-- レシートのポイント払い。経費は「払った額 + ポイント」で記帳し、ポイントの分を別の貸方にする。
--   points: ポイント・商品券などで払った額（お店がポイントを値引きとして扱っているときは 0）
--   points_as: ポイントの分の貸方。owner = 事業主借（個人で貯めたポイント）/ income = 雑収入（事業で貯めたポイント）
ALTER TABLE receipts ADD COLUMN points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0);
ALTER TABLE receipts ADD COLUMN points_as TEXT NOT NULL DEFAULT 'owner' CHECK (points_as IN ('owner', 'income'));

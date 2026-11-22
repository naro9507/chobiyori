ALTER TABLE received_bills ADD COLUMN transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL;

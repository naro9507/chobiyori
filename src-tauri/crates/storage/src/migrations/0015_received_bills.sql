CREATE TABLE received_bills (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    payee     TEXT NOT NULL,
    due_date  TEXT NOT NULL,
    amount    INTEGER CHECK (amount > 0),
    paid      INTEGER NOT NULL DEFAULT 0 CHECK (paid IN (0, 1))
) STRICT;

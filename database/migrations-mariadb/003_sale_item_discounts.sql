ALTER TABLE sale_items
  ADD COLUMN discount_cents INT NOT NULL DEFAULT 0 AFTER line_total_cents,
  ADD CONSTRAINT chk_sale_item_discount_cents
    CHECK (discount_cents >= 0 AND discount_cents <= line_total_cents);

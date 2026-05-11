-- Hook rejection reason — captured when a draft hook flips to status='rejected'.
-- Fed back into the next drafter batch as a structured anti-anchor so each
-- rejection compounds into editorial taste, not just a do-not-repeat signal.

ALTER TABLE "hooks" ADD COLUMN "rejection_reason" TEXT;

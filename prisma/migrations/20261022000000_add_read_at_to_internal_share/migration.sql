-- Add read-receipt timestamp for internal shares.
-- Null = the recipient hasn't opened the shared note yet; set = read, with the time.
ALTER TABLE "noteInternalShare" ADD COLUMN "readAt" TIMESTAMPTZ;
